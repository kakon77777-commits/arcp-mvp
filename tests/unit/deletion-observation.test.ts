import { describe, expect, it } from 'vitest';
import {
  isResurrectionBlocked,
  observationsFromSyncReport,
  promoteToTombstone,
  recordDeletionObservation,
} from '@arcp/adapter-drive';
import type { DriveSyncReport } from '@arcp/adapter-drive';

const now = () => '2026-08-17T12:00:00.000Z';

describe('deletion observation / tombstone (§9.7)', () => {
  it('a Drive-side disappearance starts as an observation, not a tombstone', () => {
    const observation = recordDeletionObservation('f1', 'content/papers/gone.md', now);
    expect(observation.status).toBe('observed');
  });

  it('an observation alone does not block resurrection', () => {
    const observation = recordDeletionObservation('f1', 'content/papers/gone.md', now);
    expect(isResurrectionBlocked('content/papers/gone.md', [observation])).toBe(false);
  });

  it('promoting to a tombstone is a separate, explicit step', () => {
    const observation = recordDeletionObservation('f1', 'content/papers/gone.md', now);
    const tombstone = promoteToTombstone(observation);
    expect(tombstone.status).toBe('tombstoned');
    expect(observation.status).toBe('observed'); // the original observation object is not mutated in place
  });

  it('promoting an already-tombstoned observation is idempotent', () => {
    const observation = recordDeletionObservation('f1', 'content/papers/gone.md', now);
    const once = promoteToTombstone(observation);
    const twice = promoteToTombstone(once);
    expect(twice).toEqual(once);
  });

  it('a tombstoned path blocks resurrection, an observed-only path does not', () => {
    const tombstoned = promoteToTombstone(recordDeletionObservation('f1', 'content/papers/gone.md', now));
    const merelyObserved = recordDeletionObservation('f2', 'content/papers/maybe-gone.md', now);
    expect(isResurrectionBlocked('content/papers/gone.md', [tombstoned])).toBe(true);
    expect(isResurrectionBlocked('content/papers/maybe-gone.md', [merelyObserved])).toBe(false);
    expect(isResurrectionBlocked('content/papers/never-touched.md', [tombstoned, merelyObserved])).toBe(false);
  });

  it('derives observations from a sync report’s deleted items', () => {
    const report: DriveSyncReport = {
      schema: 'arcp/drive-sync-report/0.1',
      source: 's',
      target: 't',
      baselineVersion: now(),
      cursor: 'c',
      counts: { added: 0, updated: 0, deleted: 2, unchanged: 0, excluded: 0, conflicted: 0 },
      items: [
        { path: 'a.md', fileId: '', outcome: 'deleted', canonicalRole: 'canonical', sensitivity: 'P1', reasonCode: 'observed_missing_pending_tombstone_approval' },
        { path: 'b.md', fileId: '', outcome: 'unchanged', canonicalRole: 'canonical', sensitivity: 'P1' },
        { path: 'c.md', fileId: '', outcome: 'deleted', canonicalRole: 'canonical', sensitivity: 'P1', reasonCode: 'observed_missing_pending_tombstone_approval' },
      ],
      sourceRootHash: 'sha256:x',
      targetRootHash: 'sha256:y',
      status: 'partial',
      eventInstant: { instant_id: 'ctcl:instant:fake-1' },
      writeInstant: { instant_id: 'ctcl:instant:fake-1' },
      nextSafeRetryAction: 'x',
    };

    const observations = observationsFromSyncReport(report, now);
    expect(observations).toHaveLength(2);
    expect(observations.every((o) => o.status === 'observed')).toBe(true);
    expect(observations.map((o) => o.path)).toEqual(['a.md', 'c.md']);
  });
});
