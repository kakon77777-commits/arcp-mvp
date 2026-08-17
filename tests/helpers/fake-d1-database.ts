import { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from '@arcp/adapter-cloudflare';

/**
 * A D1DatabaseLike backed by Node's real built-in SQLite engine (node:sqlite,
 * stable since Node 22.5). D1 is itself SQLite-compatible, so this exercises
 * genuine constraint/CAS semantics instead of a hand-rolled reimplementation
 * of SQL that could silently diverge from real D1 behavior.
 */
export function createFakeD1Database(migrationSql: string): D1DatabaseLike {
  const db = new DatabaseSync(':memory:');
  db.exec(migrationSql);

  return {
    prepare(query: string): D1PreparedStatementLike {
      let boundValues: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          boundValues = values;
          return statement;
        },
        async run(): Promise<D1RunResultLike> {
          const stmt = db.prepare(query);
          const result = stmt.run(...(boundValues as never[]));
          return {
            success: true,
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
        async first<T>(): Promise<T | null> {
          const stmt = db.prepare(query);
          const row = stmt.get(...(boundValues as never[]));
          return (row as T | undefined) ?? null;
        },
        async all<T>(): Promise<{ results: T[]; success: boolean }> {
          const stmt = db.prepare(query);
          const rows = stmt.all(...(boundValues as never[]));
          return { results: rows as T[], success: true };
        },
      };
      return statement;
    },
  };
}
