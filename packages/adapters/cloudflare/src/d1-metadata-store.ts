import type { EventEnvelope, ResidenceManifest } from '@arcp/schema';
import type { EventAppendResult, ManifestCasResult, MetadataStorePort } from '@arcp/control-plane-core';
import type { D1DatabaseLike } from './d1-types.js';

/**
 * MetadataStorePort backed by Cloudflare D1 (migrations/d1/0001_init.sql).
 * CAS is a single atomic UPDATE/INSERT statement guarded by manifest_version
 * (or, on first write, guarded by row absence) — D1/SQLite statements are
 * individually atomic, so no external transaction wrapper is needed for this
 * single-row compare-and-swap.
 */
export class D1MetadataStore implements MetadataStorePort {
  constructor(private readonly db: D1DatabaseLike) {}

  async getManifest(agentId: string): Promise<ResidenceManifest | null> {
    const row = await this.db
      .prepare('SELECT manifest_json FROM residence_manifests WHERE agent_id = ?')
      .bind(agentId)
      .first<{ manifest_json: string }>();
    return row ? (JSON.parse(row.manifest_json) as ResidenceManifest) : null;
  }

  async compareAndSwapManifest(
    agentId: string,
    expectedVersion: number | null,
    nextManifest: ResidenceManifest,
  ): Promise<ManifestCasResult> {
    if (nextManifest.agent_id !== agentId) {
      throw new Error('manifest agent_id must match CAS key');
    }

    const manifestJson = JSON.stringify(nextManifest);

    if (expectedVersion === null) {
      const result = await this.db
        .prepare(
          `INSERT INTO residence_manifests (agent_id, manifest_version, manifest_json)
           SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM residence_manifests WHERE agent_id = ?)`,
        )
        .bind(agentId, nextManifest.manifest_version, manifestJson, agentId)
        .run();
      if ((result.meta?.changes ?? 0) === 1) {
        return { status: 'committed', manifest_version: nextManifest.manifest_version };
      }
      return { status: 'conflict', actual_version: await this.currentVersion(agentId) };
    }

    const result = await this.db
      .prepare(
        `UPDATE residence_manifests SET manifest_version = ?, manifest_json = ?
         WHERE agent_id = ? AND manifest_version = ?`,
      )
      .bind(nextManifest.manifest_version, manifestJson, agentId, expectedVersion)
      .run();
    if ((result.meta?.changes ?? 0) === 1) {
      return { status: 'committed', manifest_version: nextManifest.manifest_version };
    }
    return { status: 'conflict', actual_version: await this.currentVersion(agentId) };
  }

  async appendEvent(event: EventEnvelope): Promise<EventAppendResult> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO residence_events (event_id, agent_id, event_json, inserted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(event.event_id, event.agent_id, JSON.stringify(event), new Date().toISOString())
      .run();
    return { status: (result.meta?.changes ?? 0) === 1 ? 'appended' : 'duplicate' };
  }

  async listEvents(agentId: string): Promise<EventEnvelope[]> {
    const { results } = await this.db
      .prepare(
        `SELECT event_json FROM residence_events
         WHERE agent_id = ? ORDER BY inserted_at ASC, event_id ASC`,
      )
      .bind(agentId)
      .all<{ event_json: string }>();
    return results.map((row) => JSON.parse(row.event_json) as EventEnvelope);
  }

  private async currentVersion(agentId: string): Promise<number | null> {
    const manifest = await this.getManifest(agentId);
    return manifest?.manifest_version ?? null;
  }
}
