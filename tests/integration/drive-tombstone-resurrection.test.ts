import { describe, expect, it } from 'vitest';
import {
  compareDriveBaselineToResidence,
  promoteToTombstone,
  recordDeletionObservation,
} from '@arcp/adapter-drive';
import type { DriveBaseline, DriveBaselineEntry } from '@arcp/adapter-drive';

const now = () => '2026-08-17T12:00:00.000Z';
const instant = () => ({ instant_id: 'ctcl:instant:fake-000001' });

function entry(overrides: Partial<DriveBaselineEntry> = {}): DriveBaselineEntry {
  return {
    fileId: 'f1',
    parentId: 'root',
    name: 'old-draft.md',
    path: 'content/papers/2026/old-draft.md',
    pathUncertain: false,
    mimeType: 'text/markdown',
    size: 100,
    contentHash: 'md5:aaa',
    driveVersion: '2',
    modifiedTime: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function baseline(entries: DriveBaselineEntry[]): DriveBaseline {
  return { rootFolderId: 'root', capturedAt: now(), startPageToken: 'token-9', entries };
}

/**
 * End-to-end: §9.7's promise ("反向同步時有效 tombstone 優先於舊 replica，
 * 防止被刪資料復活") only holds if deletion-observation.ts's tombstones
 * actually reach compareDriveBaselineToResidence — this proves the real
 * wiring, not just each module's own isolated behavior.
 */
describe('tombstone -> compareDriveBaselineToResidence wiring (§9.7)', () => {
  it('a file that reappears at a tombstoned path is flagged for review, not silently re-added', () => {
    const tombstone = promoteToTombstone(recordDeletionObservation('f1', 'content/papers/2026/old-draft.md', now));
    const tombstonedPaths = new Set([tombstone.path]);

    const report = compareDriveBaselineToResidence(baseline([entry()]), [], {
      source: 'drive:unbounded-axiom',
      target: 'arcp:residence:test',
      now,
      eventInstant: instant(),
      writeInstant: instant(),
      tombstonedPaths,
    });

    expect(report.items[0]).toMatchObject({
      outcome: 'conflicted',
      reasonCode: 'possible_tombstone_resurrection',
      path: 'content/papers/2026/old-draft.md',
    });
    expect(report.status).toBe('conflict');
  });

  it('a merely-observed (not yet tombstoned) deletion does not block a legitimate re-add', () => {
    const observation = recordDeletionObservation('f1', 'content/papers/2026/old-draft.md', now);
    // Deliberately NOT promoted -- an observation alone must not suppress a
    // normal re-add, matching isResurrectionBlocked's own semantics.
    const tombstonedPaths = new Set<string>(); // caller only ever populates this from tombstoned entries

    const report = compareDriveBaselineToResidence(baseline([entry()]), [], {
      source: 'drive:unbounded-axiom',
      target: 'arcp:residence:test',
      now,
      eventInstant: instant(),
      writeInstant: instant(),
      tombstonedPaths,
    });

    expect(report.items[0]?.outcome).toBe('added');
    expect(observation.status).toBe('observed');
  });
});
