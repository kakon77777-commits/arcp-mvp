/**
 * Minimal, dependency-free glob matcher shared by the exclusion and
 * canonical-role rule tables. Supports exactly two wildcard forms:
 *   `**` — any sequence of characters, including `/`; a `**` immediately
 *          followed by a `/` also matches zero path segments (so a pattern
 *          like "content/papers/**" plus "/*.md" matches a file directly
 *          under `papers/`, not only nested ones).
 *   `*`  — any sequence of characters except `/`.
 * Everything else — including `.` and `?`, both of which are JS regex
 * metacharacters but not glob wildcards in this dialect — is a literal
 * character: a pattern like `content.papers` must not accidentally match
 * `contentXpapers`, and `notes?.md` must match a literal `?`, not become an
 * "optional preceding character" quantifier.
 */
const REGEX_SPECIAL_CHARS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\', '?']);

export function globToRegExp(pattern: string, options: { caseInsensitive?: boolean } = {}): RegExp {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 3;
      } else {
        source += '.*';
        i += 2;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      i += 1;
      continue;
    }
    source += REGEX_SPECIAL_CHARS.has(char!) ? `\\${char}` : char;
    i += 1;
  }
  return new RegExp(`^${source}$`, options.caseInsensitive ? 'i' : undefined);
}

export function matchesGlob(path: string, pattern: string, options: { caseInsensitive?: boolean } = {}): boolean {
  return globToRegExp(pattern, options).test(path);
}

export function matchesAnyGlob(path: string, patterns: string[], options: { caseInsensitive?: boolean } = {}): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern, options));
}
