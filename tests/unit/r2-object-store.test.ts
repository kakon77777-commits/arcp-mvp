import { describe, expect, it } from 'vitest';
import { R2ObjectStore } from '@arcp/adapter-cloudflare';
import { createFakeR2Bucket } from '../helpers/fake-r2-bucket.js';

const enc = (text: string) => new TextEncoder().encode(text);

describe('R2ObjectStore', () => {
  it('get returns null for a digest that was never stored', async () => {
    const store = new R2ObjectStore(createFakeR2Bucket());
    expect(await store.get('sha256:missing')).toBeNull();
  });

  it('put stores new bytes under their digest and reports stored', async () => {
    const store = new R2ObjectStore(createFakeR2Bucket());
    const result = await store.put('sha256:aaa', enc('hello'));
    expect(result).toEqual({ status: 'stored', digest: 'sha256:aaa' });
    expect(await store.get('sha256:aaa')).toEqual(enc('hello'));
  });

  it('re-putting identical bytes under the same digest reports already_exists', async () => {
    const store = new R2ObjectStore(createFakeR2Bucket());
    await store.put('sha256:aaa', enc('hello'));
    const result = await store.put('sha256:aaa', enc('hello'));
    expect(result).toEqual({ status: 'already_exists', digest: 'sha256:aaa' });
  });

  it('putting different bytes under an already-used digest reports conflict without overwriting', async () => {
    const store = new R2ObjectStore(createFakeR2Bucket());
    await store.put('sha256:aaa', enc('hello'));
    const result = await store.put('sha256:aaa', enc('goodbye'));
    expect(result).toEqual({ status: 'conflict', digest: 'sha256:aaa' });
    expect(await store.get('sha256:aaa')).toEqual(enc('hello'));
  });
});
