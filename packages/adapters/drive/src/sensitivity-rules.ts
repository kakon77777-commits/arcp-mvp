import type { CanonicalRole, Sensitivity } from '@arcp/schema';
import { matchesAnyGlob } from './glob.js';

/**
 * Default exclusion patterns (§9.5). This is a first filter, not a security
 * boundary by itself — a path that isn't excluded still gets a P0-P3
 * sensitivity classification, and content is still scanned for secrets that
 * a path-based rule alone would miss. Matched case-insensitively, since a
 * differently-cased equivalent (`MY-SECRET.txt`, `.ENV`) is exactly as
 * sensitive on a case-preserving filesystem like Drive.
 */
export const DEFAULT_EXCLUSION_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/.git/**',
  '**/.wrangler/**',
  '**/*secret*',
  '**/*private-key*',
  '**/credentials',
  '**/credentials.*',
  '**/token.*',
  '**/node_modules/**',
  '**/.npmrc',
  '**/.netrc',
  '**/id_rsa',
  '**/id_ed25519',
  '**/id_ecdsa',
  '**/*.pem',
  '**/*.key',
  '**/service-account*.json',
  '**/*serviceaccount*.json',
];

export function isExcludedPath(path: string, patterns: string[] = DEFAULT_EXCLUSION_PATTERNS): boolean {
  return matchesAnyGlob(path, patterns, { caseInsensitive: true });
}

export interface SensitivityClassificationInput {
  path: string;
  canonicalRole: CanonicalRole;
  /** Only set true once cross-referenced against an actual public source (e.g. the live site) — Phase 2 never assumes this on its own. */
  isPublished?: boolean;
  exclusionPatterns?: string[];
}

export interface SensitivityClassification {
  sensitivity: Sensitivity;
  reason: string;
}

/**
 * Conservative-by-default classifier: excluded paths are P3 regardless of
 * role; unclassified ("inbox") content is P2 rather than P1, since nothing
 * is yet known about it; canonical/derived content is P1 unless the caller
 * has independently confirmed publication.
 */
export function classifySensitivity(input: SensitivityClassificationInput): SensitivityClassification {
  if (isExcludedPath(input.path, input.exclusionPatterns)) {
    return { sensitivity: 'P3', reason: 'path matches a default exclusion pattern' };
  }

  if (input.canonicalRole === 'inbox') {
    return { sensitivity: 'P2', reason: 'unclassified inbox content — sensitivity unknown, default to restricted' };
  }

  if (input.isPublished) {
    return { sensitivity: 'P0', reason: 'confirmed published (cross-referenced against a public source)' };
  }

  return {
    sensitivity: 'P1',
    reason: `${input.canonicalRole} content not yet confirmed published — default internal tier`,
  };
}

export interface SecretScanResult {
  suspected: boolean;
  matchedPatternName?: string;
}

/**
 * Heuristic scan for secret-shaped content that a path-based exclusion rule
 * would miss (§9.5: "路徑看起來安全不代表內容安全"). Deliberately never
 * returns the matched substring — only which pattern class fired — so a
 * caller can never accidentally log the secret itself.
 *
 * `generic-api-key-assignment` intentionally does not anchor the key-name
 * term to the start of the identifier: real secrets are overwhelmingly
 * named as prefixed/compound identifiers (`client_secret`, `AWS_SECRET_ACCESS_KEY`,
 * `refresh_token`), and `_`/camelCase joins are `\w` characters with no
 * regex word boundary between them and a preceding word. The value class
 * includes `/+=`, the base64 alphabet most real secret values are encoded in.
 */
const GENERIC_KEY_ASSIGNMENT = new RegExp(
  "(?:api[_-]?key|access[_-]?key|secret|token|password|passwd)[A-Za-z0-9_]*\\s*[:=]\\s*['\"][A-Za-z0-9_\\-/+=]{16,}['\"]",
  'i',
);

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'pem-private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'jwt-token', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: 'google-oauth-access-token', pattern: /\bya29\.[A-Za-z0-9_\-.]{20,}\b/ },
  { name: 'google-oauth-refresh-token', pattern: /\b1\/\/[0-9A-Za-z_-]{20,}\b/ },
  { name: 'google-api-key', pattern: /\bAIzaSy[0-9A-Za-z_-]{20,}\b/ },
  { name: 'generic-api-key-assignment', pattern: GENERIC_KEY_ASSIGNMENT },
];

export function scanForSuspectedSecret(content: string): SecretScanResult {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return { suspected: true, matchedPatternName: name };
    }
  }
  return { suspected: false };
}
