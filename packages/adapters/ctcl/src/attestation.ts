import type { webcrypto } from 'node:crypto';
import {
  TemporalEvidenceError,
  type TemporalEvidence,
} from '@arcp/temporal-evidence';
import { asCtclObject, ctclRequiredString } from './http.js';

const EXPECTED_ALG = 'Ed25519';
const EXPECTED_SIGNED_FIELDS = 'instant_id|unix_ns|timescale';

function attestationError(message: string, cause?: unknown): TemporalEvidenceError {
  return new TemporalEvidenceError(
    'attestation_invalid',
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch (error) {
    throw attestationError('CTCL attestation signature is not valid base64', error);
  }
}

export function parseCtclPublicJwk(data: unknown): webcrypto.JsonWebKey {
  const object = asCtclObject(data, 'public-key response');
  const alg = ctclRequiredString(object.alg, 'pubkey.alg');
  ctclRequiredString(object.key_id, 'pubkey.key_id');
  if (alg !== EXPECTED_ALG) {
    throw attestationError(`unsupported CTCL attestation algorithm: ${alg}`);
  }
  const jwk = asCtclObject(object.public_jwk, 'public_jwk') as webcrypto.JsonWebKey;
  return { ...jwk };
}

export async function verifyTemporalEvidenceAttestation(
  evidence: TemporalEvidence,
  publicJwk: webcrypto.JsonWebKey,
): Promise<TemporalEvidence> {
  const attestation = evidence.attestation;
  const compact = evidence.instant.attestation;
  if (attestation === undefined || compact === undefined) {
    throw attestationError('CTCL temporal evidence is missing attestation data');
  }
  if (attestation.alg !== EXPECTED_ALG || compact.alg !== EXPECTED_ALG) {
    throw attestationError('CTCL attestation algorithm must be Ed25519');
  }
  if (
    attestation.signedFields !== EXPECTED_SIGNED_FIELDS ||
    compact.signed_fields !== EXPECTED_SIGNED_FIELDS
  ) {
    throw attestationError(`CTCL attestation signed_fields must be ${EXPECTED_SIGNED_FIELDS}`);
  }
  if (
    attestation.keyId !== compact.key_id ||
    attestation.value !== compact.value ||
    attestation.alg !== compact.alg
  ) {
    throw attestationError('CTCL operational and compact attestation views do not match');
  }
  if (evidence.canonicalUnixNs === null) {
    throw attestationError('CTCL attestation requires canonical unix_ns evidence');
  }

  let publicKey: webcrypto.CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch (error) {
    throw attestationError('CTCL Ed25519 public key could not be imported', error);
  }

  // instant_id and canonicalUnixNs are pipe-joined into the signed payload below.
  // Neither is charset-restricted upstream, so a value containing '|' could shift
  // the field boundaries and let one signed triple be reinterpreted as another
  // (e.g. instant_id "A|123" + canonicalUnixNs "456" collides with instant_id "A"
  // + canonicalUnixNs "123|456"). Reject rather than silently canonicalize.
  if (evidence.instant.instant_id.includes('|') || evidence.canonicalUnixNs.includes('|')) {
    throw attestationError('CTCL attestation fields must not contain the "|" payload delimiter');
  }

  const payload = `${evidence.instant.instant_id}|${evidence.canonicalUnixNs}|${evidence.instant.timescale ?? 'utc'}`;
  const signature = decodeBase64(attestation.value);
  let verified: boolean;
  try {
    verified = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signature,
      new TextEncoder().encode(payload),
    );
  } catch (error) {
    throw attestationError('CTCL Ed25519 verification failed', error);
  }

  if (!verified) {
    throw attestationError('CTCL temporal attestation signature mismatch');
  }

  const result = structuredClone(evidence);
  result.verification = 'verified';
  result.attestation = { ...result.attestation!, verified: true };
  result.instant.attestation = { ...result.instant.attestation!, verified: true };
  return result;
}
