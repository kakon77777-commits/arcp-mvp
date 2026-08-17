import type { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CtclRestTemporalAdapter } from '@arcp/adapter-ctcl';
import type { TemporalEvidence } from '@arcp/temporal-evidence';
import { createFakeCtclFetch } from '../helpers/fake-ctcl-fetch.js';

async function makeSignedEvidence(): Promise<{
  evidence: TemporalEvidence;
  publicJwk: webcrypto.JsonWebKey;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as webcrypto.CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const evidence: TemporalEvidence = {
    instant: {
      instant_id: 'ctcl:instant:signed-1',
      timescale: 'utc',
      encoding: 'unix_ns',
      value: '1786980000123000000',
      source_quality: {
        source_class: 'edge_wall_clock',
        precision: 'millisecond_representation',
        estimated_uncertainty_ns: 5_000_000,
        synchronized: true,
      },
      attestation: {
        alg: 'Ed25519',
        key_id: 'ctcl-ed25519-test',
        signed_fields: 'instant_id|unix_ns|timescale',
        value: '',
      },
    },
    canonicalUnixNs: '1786980000123000000',
    sourceQuality: {
      sourceClass: 'edge_wall_clock',
      precision: 'millisecond_representation',
      estimatedUncertaintyNs: 5_000_000,
      synchronized: true,
    },
    attestation: {
      alg: 'Ed25519',
      keyId: 'ctcl-ed25519-test',
      signedFields: 'instant_id|unix_ns|timescale',
      value: '',
    },
    verification: 'provider-asserted',
  };

  const payload = `${evidence.instant.instant_id}|${evidence.canonicalUnixNs}|${evidence.instant.timescale ?? 'utc'}`;
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(payload),
  );
  const encoded = Buffer.from(new Uint8Array(signature)).toString('base64');
  evidence.attestation!.value = encoded;
  evidence.instant.attestation!.value = encoded;

  return { evidence, publicJwk };
}

function expectAttestationInvalid(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    code: 'attestation_invalid',
    retryable: false,
  });
}

describe('CTCL Ed25519 attestation', () => {
  it('fetches and validates the CTCL public JWK shape', async () => {
    const { publicJwk } = await makeSignedEvidence();
    const fake = createFakeCtclFetch([
      new Response(JSON.stringify({
        ok: true,
        data: {
          alg: 'Ed25519',
          key_id: 'ctcl-ed25519-test',
          public_jwk: publicJwk,
        },
        meta: { api_version: 'v1', request_id: 'pubkey-test' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);
    const adapter = new CtclRestTemporalAdapter({ fetch: fake.fetch });

    await expect(adapter.getPublicKey()).resolves.toEqual(publicJwk);
    expect(fake.requests[0]?.url).toBe('https://commoninstant.org/v1/pubkey');
    expect(fake.requests[0]?.method).toBe('GET');
  });

  it('verifies the canonical signed payload and returns a verified clone', async () => {
    const { evidence, publicJwk } = await makeSignedEvidence();
    const adapter = new CtclRestTemporalAdapter();

    const verified = await adapter.verifyEvidence(evidence, publicJwk);

    expect(verified).not.toBe(evidence);
    expect(verified.verification).toBe('verified');
    expect(verified.attestation?.verified).toBe(true);
    expect(verified.instant.attestation?.verified).toBe(true);
    expect(evidence.verification).toBe('provider-asserted');
    expect(evidence.attestation?.verified).toBeUndefined();
    expect(evidence.instant.attestation?.verified).toBeUndefined();
  });

  it('rejects id, unix-ns, timescale, signature, algorithm, or signed-field tampering', async () => {
    const { evidence, publicJwk } = await makeSignedEvidence();
    const adapter = new CtclRestTemporalAdapter();

    const cases: TemporalEvidence[] = [
      { ...evidence, instant: { ...evidence.instant, instant_id: 'ctcl:instant:tampered' } },
      { ...evidence, canonicalUnixNs: '1786980000123000001' },
      { ...evidence, instant: { ...evidence.instant, timescale: 'posix' } },
      {
        ...evidence,
        attestation: { ...evidence.attestation!, value: `${evidence.attestation!.value.slice(0, -2)}AA` },
      },
      {
        ...evidence,
        attestation: { ...evidence.attestation!, alg: 'RSA' },
      },
      {
        ...evidence,
        attestation: { ...evidence.attestation!, signedFields: 'instant_id|unix_ms|timescale' },
      },
    ];

    for (const candidate of cases) {
      await expectAttestationInvalid(adapter.verifyEvidence(candidate, publicJwk));
    }
  });

  it('rejects missing attestation instead of treating provider assertion as verified', async () => {
    const { evidence, publicJwk } = await makeSignedEvidence();
    const adapter = new CtclRestTemporalAdapter();
    const unsigned: TemporalEvidence = {
      ...evidence,
      attestation: undefined,
      instant: { ...evidence.instant, attestation: undefined },
    };

    await expectAttestationInvalid(adapter.verifyEvidence(unsigned, publicJwk));
  });
});
