import { describe, expect, it } from 'vitest';
import { canonicalize, computeRootHash, contentHash } from '@arcp/schema';

describe('canonical serialization', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = { b: 2, a: 1, c: { z: 9, y: 8 } };
    const b = { c: { y: 8, z: 9 }, a: 1, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined-valued object keys, like JSON.stringify does', () => {
    const withUndefined = canonicalize({ a: 1, b: undefined });
    expect(withUndefined).toBe('{"a":1}');
  });

  it('content hash is deterministic for equivalent objects', () => {
    const h1 = contentHash({ x: 1, y: 2 });
    const h2 = contentHash({ y: 2, x: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('content hash differs when content differs', () => {
    expect(contentHash({ x: 1 })).not.toBe(contentHash({ x: 2 }));
  });
});

describe('root hash', () => {
  const baseInput = {
    objectVersions: [
      { object_id: 'arcp:object:b', version: 1, content_hash: 'sha256:bbb' },
      { object_id: 'arcp:object:a', version: 2, content_hash: 'sha256:aaa' },
    ],
    eventCursor: 'arcp:event:01ABC',
    policyVersion: 1,
    fencingToken: 4,
  };

  it('is independent of the input object-version array order (sorted internally)', () => {
    const reordered = {
      ...baseInput,
      objectVersions: [...baseInput.objectVersions].reverse(),
    };
    expect(computeRootHash(baseInput)).toBe(computeRootHash(reordered));
  });

  it('changes when the event cursor changes', () => {
    const other = { ...baseInput, eventCursor: 'arcp:event:01XYZ' };
    expect(computeRootHash(baseInput)).not.toBe(computeRootHash(other));
  });

  it('changes when the fencing token changes', () => {
    const other = { ...baseInput, fencingToken: 5 };
    expect(computeRootHash(baseInput)).not.toBe(computeRootHash(other));
  });
});
