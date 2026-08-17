import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUSION_PATTERNS,
  classifySensitivity,
  isExcludedPath,
  scanForSuspectedSecret,
} from '@arcp/adapter-drive';

describe('exclusion patterns (§9.5)', () => {
  it('excludes .env and its variants', () => {
    expect(isExcludedPath('.env')).toBe(true);
    expect(isExcludedPath('config/.env.production')).toBe(true);
  });

  it('excludes .git and .wrangler internals at any depth', () => {
    expect(isExcludedPath('.git/config')).toBe(true);
    expect(isExcludedPath('project/.wrangler/state/v3/db')).toBe(true);
  });

  it('excludes anything with "secret" or "private-key" in the name', () => {
    expect(isExcludedPath('config/my-secret-value.json')).toBe(true);
    expect(isExcludedPath('keys/server-private-key.pem')).toBe(true);
  });

  it('excludes credentials.* and bare "credentials" files (e.g. the AWS CLI convention)', () => {
    expect(isExcludedPath('auth/credentials.json')).toBe(true);
    expect(isExcludedPath('.aws/credentials')).toBe(true);
  });

  it('excludes token.* files', () => {
    expect(isExcludedPath('auth/token.txt')).toBe(true);
  });

  it('excludes node_modules at any depth', () => {
    expect(isExcludedPath('packages/foo/node_modules/bar/index.js')).toBe(true);
  });

  it('excludes .npmrc, .netrc, and unqualified SSH private key filenames', () => {
    expect(isExcludedPath('.npmrc')).toBe(true);
    expect(isExcludedPath('home/.netrc')).toBe(true);
    expect(isExcludedPath('ssh/id_rsa')).toBe(true);
    expect(isExcludedPath('ssh/id_ed25519')).toBe(true);
    expect(isExcludedPath('ssh/id_ecdsa')).toBe(true);
  });

  it('does not exclude SSH public keys — they are meant to be shared', () => {
    expect(isExcludedPath('ssh/id_rsa.pub')).toBe(false);
    expect(isExcludedPath('ssh/id_ed25519.pub')).toBe(false);
  });

  it('excludes .pem/.key files and common GCP service-account key filenames', () => {
    expect(isExcludedPath('keys/server.pem')).toBe(true);
    expect(isExcludedPath('keys/server.key')).toBe(true);
    expect(isExcludedPath('gcp/service-account.json')).toBe(true);
    expect(isExcludedPath('gcp/my-project-460512-a1b2c3d4e5f6-serviceaccount.json')).toBe(true);
  });

  it('matches exclusion patterns case-insensitively', () => {
    expect(isExcludedPath('MY-SECRET.txt')).toBe(true);
    expect(isExcludedPath('.ENV')).toBe(true);
    expect(isExcludedPath('AUTH/CREDENTIALS.JSON')).toBe(true);
  });

  it('does not exclude ordinary content paths', () => {
    expect(isExcludedPath('content/papers/2026/paper.md')).toBe(false);
    expect(DEFAULT_EXCLUSION_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('sensitivity classification', () => {
  it('classifies an excluded path as P3 regardless of canonical role', () => {
    expect(classifySensitivity({ path: '.env', canonicalRole: 'inbox' }).sensitivity).toBe('P3');
    expect(classifySensitivity({ path: '.env', canonicalRole: 'canonical' }).sensitivity).toBe('P3');
    expect(classifySensitivity({ path: '.env', canonicalRole: 'derived' }).sensitivity).toBe('P3');
  });

  it('classifies canonical/derived content as P1 by default (not yet known to be published)', () => {
    expect(classifySensitivity({ path: 'content/papers/x.md', canonicalRole: 'canonical' }).sensitivity).toBe('P1');
    expect(classifySensitivity({ path: 'dist/raw/x.md', canonicalRole: 'derived' }).sensitivity).toBe('P1');
  });

  it('classifies canonical content as P0 when explicitly known to be published', () => {
    const result = classifySensitivity({ path: 'content/papers/x.md', canonicalRole: 'canonical', isPublished: true });
    expect(result.sensitivity).toBe('P0');
  });

  it('classifies unclassified inbox content as P2, the conservative default for the unknown', () => {
    expect(classifySensitivity({ path: 'random/dropped-file.txt', canonicalRole: 'inbox' }).sensitivity).toBe('P2');
  });

  it('always includes a human-readable reason', () => {
    const result = classifySensitivity({ path: 'content/papers/x.md', canonicalRole: 'canonical' });
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('secret content heuristic scan (§9.5 — stop the file, do not log the value)', () => {
  it('flags a PEM private key header', () => {
    const result = scanForSuspectedSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----');
    expect(result.suspected).toBe(true);
    expect(result.matchedPatternName).toBe('pem-private-key');
  });

  it('flags the private_key field of a GCP service-account JSON key by its embedded PEM header', () => {
    const gcpKeyJson = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQ...\\n-----END PRIVATE KEY-----\\n"}';
    const result = scanForSuspectedSecret(gcpKeyJson);
    expect(result.suspected).toBe(true);
    expect(result.matchedPatternName).toBe('pem-private-key');
  });

  it('flags an AWS access key ID pattern', () => {
    const result = scanForSuspectedSecret('aws_access_key_id = AKIAABCDEFGHIJKLMNOP');
    expect(result.suspected).toBe(true);
  });

  it('flags a JWT-shaped token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = scanForSuspectedSecret(`token: ${jwt}`);
    expect(result.suspected).toBe(true);
  });

  it('flags Google OAuth access tokens, refresh tokens, and API keys', () => {
    expect(scanForSuspectedSecret('access_token: ya29.a0AfH6SMC1234567890abcdefgh').suspected).toBe(true);
    expect(scanForSuspectedSecret('refresh: 1//0habcdefghijklmnopqrstuvwxyz').suspected).toBe(true);
    expect(scanForSuspectedSecret('key = AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345').suspected).toBe(true);
  });

  it('flags compound/prefixed key-name identifiers, not only a bare leading key name', () => {
    expect(scanForSuspectedSecret('client_secret: "abcdefghijklmnopqrstuvwxyz"').suspected).toBe(true);
    expect(scanForSuspectedSecret('CLIENT_SECRET = "abcdefghijklmnopqrstuvwxyz"').suspected).toBe(true);
    expect(scanForSuspectedSecret('AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"').suspected).toBe(true);
    expect(scanForSuspectedSecret('refresh_token: "abcdefghijklmnopqrstuvwxyz"').suspected).toBe(true);
    expect(scanForSuspectedSecret('apiToken = "abcdefghijklmnopqrstuvwxyz"').suspected).toBe(true);
  });

  it('flags the generic-api-key-assignment pattern directly, including base64-shaped values', () => {
    const bareKey = scanForSuspectedSecret('api_key: "abcdefghijklmnopqrstuvwxyz"');
    expect(bareKey.suspected).toBe(true);
    expect(bareKey.matchedPatternName).toBe('generic-api-key-assignment');

    // Base64 secret values commonly contain '/', '+', and '=' padding.
    expect(scanForSuspectedSecret('secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"').suspected).toBe(true);
    expect(scanForSuspectedSecret('secret = "wJalrXUtnFEMIK7MDENGbPxRfiCY+EXAMPLEKEY=="').suspected).toBe(true);
    expect(scanForSuspectedSecret('password: "correct-horse-battery-staple-9000"').suspected).toBe(true);
  });

  it('does not flag ordinary prose, including incidental use of the word "secret"', () => {
    const result = scanForSuspectedSecret('# Introduction\n\nThis paper studies the residence continuity protocol. The secret to a good API is a stable contract.');
    expect(result.suspected).toBe(false);
    expect(result.matchedPatternName).toBeUndefined();
  });

  it('never includes the matched secret text itself in the result', () => {
    const cases = [
      'aws_access_key_id = AKIAABCDEFGHIJKLMNOP',
      'client_secret: "abcdefghijklmnopqrstuvwxyz"',
      'access_token: ya29.a0AfH6SMC1234567890abcdefgh',
    ];
    for (const content of cases) {
      const result = scanForSuspectedSecret(content);
      expect(JSON.stringify(result)).not.toContain('AKIAABCDEFGHIJKLMNOP');
      expect(JSON.stringify(result)).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect(JSON.stringify(result)).not.toContain('ya29.a0AfH6SMC1234567890abcdefgh');
    }
  });
});
