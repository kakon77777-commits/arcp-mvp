import { describe, expect, it } from 'vitest';
import { FakeCtclAdapter } from '@arcp/adapter-ctcl';
import { FakeDriveAdapter, type FakeDriveFile } from '@arcp/adapter-drive';
import { FakeModelAdapter, ScriptExhaustedError } from '@arcp/adapter-model';

describe('FakeCtclAdapter', () => {
  it('returns monotonically increasing fake instants', () => {
    const ctcl = new FakeCtclAdapter();
    const a = ctcl.now();
    const b = ctcl.now();
    expect(a.instant_id).not.toBe(b.instant_id);
    expect(a.unverified).toBeUndefined();
  });

  it('degrades to an unverified local instant when unavailable, never forging a real one', () => {
    const ctcl = new FakeCtclAdapter();
    ctcl.setUnavailable(true);
    const instant = ctcl.now();
    expect(instant.unverified).toBe(true);
    expect(instant.instant_id.startsWith('ctcl:')).toBe(false);
  });
});

describe('FakeDriveAdapter', () => {
  const file = (overrides: Partial<FakeDriveFile>): FakeDriveFile => ({
    fileId: 'f1',
    name: 'paper.md',
    path: '/papers/paper.md',
    modifiedTime: '2026-07-12T00:00:00Z',
    contentHash: 'sha256:aaa',
    mimeType: 'text/markdown',
    ...overrides,
  });

  it('diffs added/changed/removed files against a prior baseline', () => {
    const baseline = [file({ fileId: 'f1' }), file({ fileId: 'f2' })];
    const drive = new FakeDriveAdapter(baseline);

    drive.applyChange(file({ fileId: 'f1', contentHash: 'sha256:bbb' })); // changed
    drive.applyChange(file({ fileId: 'f3', name: 'new.md' })); // added
    drive.removeFile('f2'); // removed

    const diff = drive.diffAgainst(baseline);
    expect(diff.added.map((f) => f.fileId)).toEqual(['f3']);
    expect(diff.changed.map((f) => f.fileId)).toEqual(['f1']);
    expect(diff.removed.map((f) => f.fileId)).toEqual(['f2']);
  });

  it('reports no diff when nothing changed', () => {
    const baseline = [file({ fileId: 'f1' })];
    const drive = new FakeDriveAdapter(baseline);
    const diff = drive.diffAgainst(baseline);
    expect(diff).toEqual({ added: [], changed: [], removed: [] });
  });
});

describe('FakeModelAdapter', () => {
  it('replays scripted turns in order', () => {
    const model = new FakeModelAdapter([{ actionIntents: [] }, { actionIntents: [] }]);
    expect(() => model.nextTurn()).not.toThrow();
    expect(() => model.nextTurn()).not.toThrow();
    expect(() => model.nextTurn()).toThrow(ScriptExhaustedError);
  });
});
