import type { ObjectPutResult, ObjectStorePort } from '@arcp/control-plane-core';
import type { R2BucketLike } from './r2-types.js';

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * ObjectStorePort backed by Cloudflare R2. Keys are content digests, so a
 * pre-put existence check plus a byte comparison distinguishes a redundant
 * write of the same content (already_exists) from a genuine digest collision
 * (conflict) — matching InMemoryObjectStore semantics exactly.
 */
export class R2ObjectStore implements ObjectStorePort {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(digest: string, bytes: Uint8Array): Promise<ObjectPutResult> {
    const existing = await this.bucket.get(digest);
    if (existing) {
      const existingBytes = new Uint8Array(await existing.arrayBuffer());
      return { status: bytesEqual(existingBytes, bytes) ? 'already_exists' : 'conflict', digest };
    }
    await this.bucket.put(digest, bytes);
    return { status: 'stored', digest };
  }

  async get(digest: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(digest);
    if (!object) return null;
    return new Uint8Array(await object.arrayBuffer());
  }
}
