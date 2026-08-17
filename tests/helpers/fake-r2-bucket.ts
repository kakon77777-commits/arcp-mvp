import type { R2BucketLike, R2ObjectBodyLike } from '@arcp/adapter-cloudflare';

/** In-memory R2BucketLike test double — R2 has no local engine equivalent to node:sqlite. */
export function createFakeR2Bucket(): R2BucketLike {
  const objects = new Map<string, Uint8Array>();

  return {
    async put(key: string, value: Uint8Array | ArrayBuffer): Promise<unknown> {
      const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value.slice(0));
      objects.set(key, bytes);
      return { key };
    },
    async get(key: string): Promise<R2ObjectBodyLike | null> {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        key,
        async arrayBuffer(): Promise<ArrayBuffer> {
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          return copy.buffer as ArrayBuffer;
        },
      };
    },
  };
}
