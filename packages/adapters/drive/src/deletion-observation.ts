import type { DriveSyncReport } from './sync-engine.js';

export interface DeletionObservation {
  fileId: string;
  path: string;
  observedAt: string;
  status: 'observed' | 'tombstoned';
}

/**
 * §9.7: a Drive-side disappearance is never treated as an immediate delete
 * request. It starts here — an observation only.
 */
export function recordDeletionObservation(fileId: string, path: string, now: () => string): DeletionObservation {
  return { fileId, path, observedAt: now(), status: 'observed' };
}

/**
 * Promotion is a separate, explicit call — real policy-gating (who approved
 * it, under what risk tier) is the caller's job, not this module's, matching
 * how the rest of this codebase keeps policy decisions out of storage/sync
 * primitives. Idempotent: promoting an already-tombstoned observation is a
 * no-op, not an error.
 */
export function promoteToTombstone(observation: DeletionObservation): DeletionObservation {
  if (observation.status === 'tombstoned') return observation;
  return { ...observation, status: 'tombstoned' };
}

/**
 * A tombstone wins over a stale replica reappearing on reverse sync; a
 * mere observation does not — the file might come back legitimately (e.g.
 * a Drive move that briefly looked like a disappearance) and an observation
 * alone doesn't yet carry the authority to say otherwise.
 */
export function isResurrectionBlocked(path: string, tombstones: DeletionObservation[]): boolean {
  return tombstones.some((t) => t.path === path && t.status === 'tombstoned');
}

export function observationsFromSyncReport(report: DriveSyncReport, now: () => string): DeletionObservation[] {
  return report.items
    .filter((item) => item.outcome === 'deleted')
    .map((item) => recordDeletionObservation(item.fileId, item.path, now));
}
