import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncedFilesystemAdapter } from '@arcp/adapter-synced-filesystem';
import {
  InMemoryResidenceStorageAdapter,
  diffResidenceSnapshots,
  emptyResidenceDiff,
  type ResidenceStorageEntry,
  type ResidenceStorageSnapshot,
} from '@arcp/residence-storage';
import { runResidenceStorageConformance } from '../helpers/residence-storage-conformance.js';

function entry(overrides: Partial<ResidenceStorageEntry> = {}): ResidenceStorageEntry {
  return {
    ref: 'memory:a',
    path: 'a.txt',
    kind: 'file',
    size: 1,
    modifiedAt: '2026-08-17T00:00:00.000Z',
    contentHash: 'sha256:a',
    revision: '1',
    ...overrides,
  };
}

function snapshot(entries: ResidenceStorageEntry[]): ResidenceStorageSnapshot {
  return {
    backendKind: 'test',
    observedAt: '2026-08-17T00:00:00.000Z',
    cursor: null,
    entries,
  };
}

describe('residence storage reference semantics', () => {
  it('satisfies the shared adapter conformance contract', async () => {
    await runResidenceStorageConformance(async () => new InMemoryResidenceStorageAdapter());
  });

  it('satisfies the shared adapter conformance contract with synced filesystem mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-residence-conformance-'));
    try {
      await runResidenceStorageConformance(async () => new SyncedFilesystemAdapter({ root }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes synced filesystem snapshot/read observations through the provider-neutral shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-residence-parity-'));
    try {
      await mkdir(join(root, 'notes'));
      await writeFile(join(root, 'notes', 'bridge.txt'), 'bridge-evidence');

      const adapter = new SyncedFilesystemAdapter({
        root,
        now: () => new Date('2026-08-17T09:45:00.000Z'),
      });
      const observed = await adapter.snapshot();
      const file = observed.entries.find((item) => item.path === 'notes/bridge.txt');

      expect(observed.backendKind).toBe('synced-filesystem');
      expect(observed.observedAt).toBe('2026-08-17T09:45:00.000Z');
      expect(file).toMatchObject({ kind: 'file', ref: 'fs:notes%2Fbridge.txt', revision: null });

      const blob = await adapter.read(file!.ref);
      expect(blob?.path).toBe('notes/bridge.txt');
      expect(new TextDecoder().decode(blob?.bytes)).toBe('bridge-evidence');
      expect(blob?.contentHash).toBe(file?.contentHash);
      expect(blob?.revision).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports backend removal as evidence without performing any canonical action', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    await adapter.write({ path: 'paper.md' }, new TextEncoder().encode('draft'));
    const baseline = await adapter.snapshot();
    await adapter.remove({ path: 'paper.md' });
    const result = await adapter.diff(baseline);
    expect(result.diff.removed.map((item) => item.path)).toEqual(['paper.md']);
  });

  it('classifies stable refs deterministically as moved, changed, added, and removed', () => {
    const previous = snapshot([
      entry({ ref: 'stable:moved', path: 'z-old.txt', contentHash: 'sha256:moved' }),
      entry({ ref: 'stable:changed-b', path: 'b.txt', contentHash: 'sha256:before-b' }),
      entry({ ref: 'stable:changed-a', path: 'a.txt', contentHash: 'sha256:before-a' }),
      entry({ ref: 'stable:removed-b', path: 'removed-b.txt' }),
      entry({ ref: 'stable:removed-a', path: 'removed-a.txt' }),
    ]);
    const current = snapshot([
      entry({ ref: 'stable:moved', path: 'moved.txt', contentHash: 'sha256:moved' }),
      entry({ ref: 'stable:changed-b', path: 'b.txt', contentHash: 'sha256:after-b' }),
      entry({ ref: 'stable:changed-a', path: 'a.txt', revision: '2' }),
      entry({ ref: 'stable:added-b', path: 'new-b.txt' }),
      entry({ ref: 'stable:added-a', path: 'new-a.txt' }),
    ]);

    const diff = diffResidenceSnapshots(previous, current);

    expect(diff.moved.map((move) => move.after.path)).toEqual(['moved.txt']);
    expect(diff.changed.map((change) => change.after.path)).toEqual(['a.txt', 'b.txt']);
    expect(diff.added.map((item) => item.path)).toEqual(['new-a.txt', 'new-b.txt']);
    expect(diff.removed.map((item) => item.path)).toEqual(['removed-a.txt', 'removed-b.txt']);
  });

  it('treats a path change as a move even when other metadata also changes', () => {
    const previous = snapshot([entry({ ref: 'stable:1', path: 'before.txt' })]);
    const current = snapshot([
      entry({ ref: 'stable:1', path: 'after.txt', contentHash: 'sha256:after', revision: '2' }),
    ]);

    const diff = diffResidenceSnapshots(previous, current);

    expect(diff.moved).toHaveLength(1);
    expect(diff.changed).toEqual([]);
  });

  it('returns a fresh empty diff shape', () => {
    const first = emptyResidenceDiff();
    const second = emptyResidenceDiff();
    expect(first).toEqual({ added: [], changed: [], removed: [], moved: [] });
    expect(first).not.toBe(second);
    expect(first.added).not.toBe(second.added);
  });
});
