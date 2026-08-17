/**
 * Minimal structural subset of Cloudflare's real D1Database binding — just
 * enough surface for D1MetadataStore. Kept narrow (rather than depending on
 * @cloudflare/workers-types) so it can be satisfied by any SQLite-compatible
 * test double, matching the DurableObjectNamespaceLike pattern already used
 * in this package.
 */
export interface D1RunResultLike {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResultLike>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}
