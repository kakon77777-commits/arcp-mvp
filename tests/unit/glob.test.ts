import { describe, expect, it } from 'vitest';
import { matchesAnyGlob, matchesGlob } from '@arcp/adapter-drive';

describe('glob matcher', () => {
  it('matches a literal path exactly', () => {
    expect(matchesGlob('content/papers/2026/paper.md', 'content/papers/2026/paper.md')).toBe(true);
    expect(matchesGlob('content/papers/2026/paper.md', 'content/papers/2026/other.md')).toBe(false);
  });

  it('* matches any characters except a path separator', () => {
    expect(matchesGlob('content/papers/2026/paper.md', 'content/papers/2026/*.md')).toBe(true);
    expect(matchesGlob('content/papers/2026/07/paper.md', 'content/papers/2026/*.md')).toBe(false);
  });

  it('** matches across path separators, including zero segments', () => {
    expect(matchesGlob('content/papers/2026/07/paper.md', 'content/papers/**/*.md')).toBe(true);
    expect(matchesGlob('content/papers/paper.md', 'content/papers/**/*.md')).toBe(true);
    expect(matchesGlob('other/paper.md', 'content/papers/**/*.md')).toBe(false);
  });

  it('matches a leading **/ prefix against any depth, including the root', () => {
    expect(matchesGlob('.env', '**/.env')).toBe(true);
    expect(matchesGlob('a/b/.env', '**/.env')).toBe(true);
  });

  it('does not treat dots or other regex metacharacters as wildcards', () => {
    expect(matchesGlob('contentXpapers', 'content.papers')).toBe(false);
    expect(matchesGlob('content.papers', 'content.papers')).toBe(true);
  });

  it('every character in the escape set is a literal, not regex syntax', () => {
    const cases: Array<[string, string]> = [
      ['notes?.md', 'notes?.md'],
      ['report (final).pdf', 'report (final).pdf'],
      ['data[1].csv', 'data[1].csv'],
      ['a+b.txt', 'a+b.txt'],
      ['100%.md', '100%.md'],
    ];
    for (const [path, pattern] of cases) {
      expect(matchesGlob(path, pattern), `expected literal match for ${pattern}`).toBe(true);
    }
    // '?' must not become an optional-preceding-character quantifier.
    expect(matchesGlob('notes.md', 'notes?.md')).toBe(false);
    expect(matchesGlob('notesX.md', 'notes?.md')).toBe(false);
  });

  it('matchesAnyGlob is true if any pattern matches', () => {
    const patterns = ['**/.env', '**/*secret*'];
    expect(matchesAnyGlob('a/my-secret-key.txt', patterns)).toBe(true);
    expect(matchesAnyGlob('a/b/.env', patterns)).toBe(true);
    expect(matchesAnyGlob('a/b/readme.md', patterns)).toBe(false);
  });

  it('supports case-insensitive matching as an explicit opt-in', () => {
    expect(matchesGlob('MY-SECRET.txt', '**/*secret*')).toBe(false);
    expect(matchesGlob('MY-SECRET.txt', '**/*secret*', { caseInsensitive: true })).toBe(true);
    expect(matchesAnyGlob('.ENV', ['**/.env'], { caseInsensitive: true })).toBe(true);
  });
});
