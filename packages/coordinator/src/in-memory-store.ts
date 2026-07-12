import type { EventEnvelope, ObjectVersion, ResidenceManifest } from '@arcp/schema';

/**
 * Phase 0 in-memory stand-in for the Metadata/Object Store split described in
 * §3.3. Events only append; object versions are appended (never mutated in
 * place); manifests are appended, forming the commit history.
 */
export class InMemoryResidenceStore {
  readonly objectVersions: ObjectVersion[] = [];
  readonly events: EventEnvelope[] = [];
  readonly manifests: ResidenceManifest[] = [];
  private readonly seenWakeKeys = new Set<string>();
  private readonly seenActionKeys = new Set<string>();

  addObjectVersion(version: ObjectVersion): void {
    this.objectVersions.push(version);
  }

  addEvent(event: EventEnvelope): void {
    this.events.push(event);
  }

  latestManifest(): ResidenceManifest | undefined {
    return this.manifests.at(-1);
  }

  commitManifest(manifest: ResidenceManifest): void {
    this.manifests.push(manifest);
  }

  isDuplicateWake(idempotencyKey: string): boolean {
    return this.seenWakeKeys.has(idempotencyKey);
  }

  recordWake(idempotencyKey: string): void {
    this.seenWakeKeys.add(idempotencyKey);
  }

  isDuplicateAction(idempotencyKey: string): boolean {
    return this.seenActionKeys.has(idempotencyKey);
  }

  recordAction(idempotencyKey: string): void {
    this.seenActionKeys.add(idempotencyKey);
  }
}
