import { describe, expect, it } from 'vitest';
import { DEFAULT_CANONICAL_RULES, classifyCanonicalRole } from '@arcp/adapter-drive';

describe('canonical/derived classifier (§9.4)', () => {
  it('classifies source papers as canonical', () => {
    expect(classifyCanonicalRole('content/papers/2026/07/paper.md').role).toBe('canonical');
  });

  it('classifies build copies as derived', () => {
    expect(classifyCanonicalRole('dist/raw/2026/07/paper.md').role).toBe('derived');
  });

  it('classifies published web artifacts as derived', () => {
    expect(classifyCanonicalRole('dist/p/some-paper/index.html').role).toBe('derived');
  });

  it('classifies the Drive mirror tree as replica', () => {
    expect(classifyCanonicalRole('mirrors/unbounded-axiom/paper.md').role).toBe('replica');
  });

  it('classifies an unrecognized path as inbox, never as canonical', () => {
    const result = classifyCanonicalRole('random/dropped-file.txt');
    expect(result.role).toBe('inbox');
    expect(result.matchedRule).toBeUndefined();
  });

  it('reports which rule matched for classified paths', () => {
    const result = classifyCanonicalRole('content/papers/x.md');
    expect(result.matchedRule?.role).toBe('canonical');
    expect(result.matchedRule?.description.length).toBeGreaterThan(0);
  });

  it('accepts a custom rule table, ignoring the default when one is supplied', () => {
    const customRules = [{ pattern: 'other-project/**', role: 'canonical' as const, description: 'a different project' }];
    expect(classifyCanonicalRole('content/papers/x.md', customRules).role).toBe('inbox');
    expect(classifyCanonicalRole('other-project/x.md', customRules).role).toBe('canonical');
  });

  it('ships a non-empty default rule table', () => {
    expect(DEFAULT_CANONICAL_RULES.length).toBeGreaterThan(0);
  });
});
