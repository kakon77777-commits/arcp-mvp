import type { CanonicalRole } from '@arcp/schema';
import { matchesGlob } from './glob.js';

export interface CanonicalClassificationRule {
  pattern: string;
  role: CanonicalRole;
  description: string;
}

/** Ships the spec's own `unbounded-axiom` example table (§9.4) as the default. */
export const DEFAULT_CANONICAL_RULES: CanonicalClassificationRule[] = [
  { pattern: 'content/papers/**', role: 'canonical', description: 'human/Git-authored source papers' },
  { pattern: 'dist/raw/**', role: 'derived', description: 'build copy of source content' },
  { pattern: 'dist/p/**', role: 'derived', description: 'published web artifact' },
  { pattern: 'mirrors/**', role: 'replica', description: 'Drive mirror — may lag, needs cursor and hash proof' },
];

export interface CanonicalClassificationResult {
  role: CanonicalRole;
  matchedRule?: CanonicalClassificationRule;
}

/**
 * A path matching no rule defaults to `inbox` — "尚未信任與分類的外部輸入"
 * (§7.3) — never silently promoted to `canonical`. An unrecognized file
 * earns its classification through an explicit rule, not by omission.
 */
export function classifyCanonicalRole(
  path: string,
  rules: CanonicalClassificationRule[] = DEFAULT_CANONICAL_RULES,
): CanonicalClassificationResult {
  for (const rule of rules) {
    if (matchesGlob(path, rule.pattern)) {
      return { role: rule.role, matchedRule: rule };
    }
  }
  return { role: 'inbox' };
}
