/**
 * Minimal structural subset of Cloudflare's real R2Bucket binding — just
 * enough surface for R2ObjectStore, mirroring the D1DatabaseLike pattern.
 */
export interface R2ObjectBodyLike {
  key: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  put(key: string, value: Uint8Array | ArrayBuffer): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
}
