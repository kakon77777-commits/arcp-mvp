import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys sorted recursively, arrays keep
 * their given order, `undefined`-valued object keys are dropped (matching
 * JSON.stringify's own behavior for objects). This is what root-hash and
 * content-hash computation must run on — never on JSON.stringify's own
 * key-insertion-order output.
 */
export function canonicalize(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringify(entry)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `sha256:<hex>` content hash of the canonicalized value. */
export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}
