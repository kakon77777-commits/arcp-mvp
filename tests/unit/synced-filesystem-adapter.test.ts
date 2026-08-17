import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncedFilesystemAdapter } from '@arcp/adapter-synced-filesystem';

const cleanupRoots: string[] = [];
const fixedNow = new Date('2026-08-17T09:45:00.000Z');

function digest(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'arcp-synced-adapter-'));
  cleanupRoots.push(root);
  return root;
}

async function makePopulatedRoot(): Promise<string> {
  const root = await makeRoot();
  await mkdir(join(root, 'notes'));
  await writeFile(join(root, 'notes', 'a.txt'), 'hello');
  await writeFile(join(root, 'z.txt'), 'last');
  return root;
}

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('SyncedFilesystemAdapter observation path', () => {
  it('returns deterministic path-sorted file and directory entries with raw-byte hashes', async () => {
    const root = await makePopulatedRoot();
    const adapter = new SyncedFilesystemAdapter({ root, now: () => fixedNow });

    const snapshot = await adapter.snapshot();

    expect(snapshot.backendKind).toBe('synced-filesystem');
    expect(snapshot.observedAt).toBe(fixedNow.toISOString());
    expect(snapshot.cursor).toBeNull();
    expect(snapshot.entries.map((entry) => entry.path)).toEqual(['notes', 'notes/a.txt', 'z.txt']);

    const notes = snapshot.entries[0]!;
    expect(notes).toMatchObject({
      ref: 'fs:notes',
      path: 'notes',
      kind: 'directory',
      size: null,
      contentHash: null,
    });

    const a = snapshot.entries[1]!;
    expect(a).toMatchObject({
      ref: 'fs:notes%2Fa.txt',
      path: 'notes/a.txt',
      kind: 'file',
      size: 5,
      contentHash: digest('hello'),
    });

    const z = snapshot.entries[2]!;
    expect(z).toMatchObject({
      ref: 'fs:z.txt',
      path: 'z.txt',
      kind: 'file',
      size: 4,
      contentHash: digest('last'),
    });
  });

  it('reads only canonical fs refs and returns copied bytes', async () => {
    const root = await makePopulatedRoot();
    const adapter = new SyncedFilesystemAdapter({ root });

    const first = await adapter.read('fs:notes%2Fa.txt');
    expect(new TextDecoder().decode(first?.bytes)).toBe('hello');
    expect(first).toMatchObject({
      ref: 'fs:notes%2Fa.txt',
      path: 'notes/a.txt',
      contentHash: digest('hello'),
    });

    first!.bytes[0] = 0;
    const second = await adapter.read('fs:notes%2Fa.txt');
    expect(new TextDecoder().decode(second?.bytes)).toBe('hello');

    await expect(adapter.read('memory:notes%2Fa.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
    await expect(adapter.read('fs:notes/a.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
    await expect(adapter.read('fs:..%2Fescape.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
    await expect(adapter.read('fs:%E0%A4%A')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
  });

  it('returns null for missing refs and directory refs', async () => {
    const root = await makePopulatedRoot();
    const adapter = new SyncedFilesystemAdapter({ root });

    await expect(adapter.read('fs:missing.txt')).resolves.toBeNull();
    await expect(adapter.read('fs:notes')).resolves.toBeNull();
  });

  it('advertises local observation capabilities without claiming stable ids or provider sync confirmation', async () => {
    const root = await makeRoot();
    const adapter = new SyncedFilesystemAdapter({ root });

    expect(adapter.capabilities()).toEqual({
      watchHints: true,
      changeCursor: false,
      stableObjectIds: false,
      providerReplicationConfirmation: false,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    });
  });

  it('rejects a missing root or a root that is not a directory during construction', async () => {
    const base = await makeRoot();
    const missing = join(base, 'missing');
    const file = join(base, 'file.txt');
    await writeFile(file, 'not a directory');

    expect(() => new SyncedFilesystemAdapter({ root: missing })).toThrowError(
      expect.objectContaining({ code: 'invalid_path_or_ref' }),
    );
    expect(() => new SyncedFilesystemAdapter({ root: file })).toThrowError(
      expect.objectContaining({ code: 'invalid_path_or_ref' }),
    );
  });

  it('fails closed when a scan encounters a symlink or junction inside the residence root', async (context) => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, 'secret.txt'), 'outside');

    try {
      await symlink(
        outside,
        join(root, 'escape-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        context.skip(`symlink creation unavailable on this runner: ${code}`);
      }
      throw error;
    }

    const adapter = new SyncedFilesystemAdapter({ root });
    await expect(adapter.snapshot()).rejects.toMatchObject({ code: 'invalid_path_or_ref' });
  });
});

describe('SyncedFilesystemAdapter mutation path', () => {
  it('creates missing parent directories and atomically publishes a verified file', async () => {
    const root = await makeRoot();
    const adapter = new SyncedFilesystemAdapter({ root });

    const receipt = await adapter.write(
      { path: 'nested/deeper/paper.md' },
      new TextEncoder().encode('draft'),
    );

    expect(receipt).toMatchObject({
      status: 'written',
      ref: 'fs:nested%2Fdeeper%2Fpaper.md',
      path: 'nested/deeper/paper.md',
      contentHash: digest('draft'),
      providerReplication: 'unknown',
    });
    expect(await readFile(join(root, 'nested', 'deeper', 'paper.md'), 'utf8')).toBe('draft');
    expect((await readdir(join(root, 'nested', 'deeper'))).filter((name) => name.includes('.arcp-tmp-'))).toEqual([]);
  });

  it('returns unchanged only after verifying identical existing bytes', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'paper.md'), 'same');
    const adapter = new SyncedFilesystemAdapter({ root });

    const receipt = await adapter.write({ path: 'paper.md' }, new TextEncoder().encode('same'));

    expect(receipt).toMatchObject({
      status: 'unchanged',
      contentHash: digest('same'),
      providerReplication: 'unknown',
    });
  });

  it('enforces ifAbsent before mutation', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'paper.md'), 'existing');
    const adapter = new SyncedFilesystemAdapter({ root });

    await expect(
      adapter.write({ path: 'paper.md' }, new TextEncoder().encode('replacement'), { ifAbsent: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await readFile(join(root, 'paper.md'), 'utf8')).toBe('existing');
  });

  it('detects an external content change through ifContentHash before writing', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'paper.md'), 'before');
    const adapter = new SyncedFilesystemAdapter({ root });
    const baseline = await adapter.read('fs:paper.md');
    await writeFile(join(root, 'paper.md'), 'external-change');

    await expect(
      adapter.write(
        { path: 'paper.md' },
        new TextEncoder().encode('ours'),
        { ifContentHash: baseline!.contentHash },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await readFile(join(root, 'paper.md'), 'utf8')).toBe('external-change');
  });

  it('removes only with matching preconditions and makes repeated removal idempotent', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'paper.md'), 'draft');
    const adapter = new SyncedFilesystemAdapter({ root });

    await expect(
      adapter.remove({ path: 'paper.md' }, { ifContentHash: digest('wrong') }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const removed = await adapter.remove({ path: 'paper.md' }, { ifContentHash: digest('draft') });
    expect(removed).toMatchObject({
      status: 'removed',
      ref: 'fs:paper.md',
      path: 'paper.md',
      providerReplication: 'unknown',
    });

    const removedAgain = await adapter.remove({ path: 'paper.md' });
    expect(removedAgain).toEqual({
      status: 'already_absent',
      ref: null,
      path: 'paper.md',
      providerReplication: 'unknown',
    });
  });

  it('never claims provider replication confirmation for local writes or removals', async () => {
    const root = await makeRoot();
    const adapter = new SyncedFilesystemAdapter({ root });

    const written = await adapter.write({ path: 'paper.md' }, new TextEncoder().encode('draft'));
    const removed = await adapter.remove({ path: 'paper.md' });

    expect(written.providerReplication).toBe('unknown');
    expect(removed.providerReplication).toBe('unknown');
  });

  it('rejects revision preconditions because filesystem revisions are not a supported concurrency contract', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'paper.md'), 'draft');
    const adapter = new SyncedFilesystemAdapter({ root });

    await expect(
      adapter.write({ path: 'paper.md' }, new TextEncoder().encode('next'), { ifRevision: '1' }),
    ).rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(
      adapter.remove({ path: 'paper.md' }, { ifRevision: '1' }),
    ).rejects.toMatchObject({ code: 'unsupported_operation' });
  });

  it('does not perform recursive directory removal', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'a.txt'), 'hello');
    const adapter = new SyncedFilesystemAdapter({ root });

    await expect(adapter.remove({ path: 'notes' })).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
    expect(await readFile(join(root, 'notes', 'a.txt'), 'utf8')).toBe('hello');
  });

  it('raises integrity_mismatch when the final file changes before post-write verification', async () => {
    const root = await makeRoot();
    const adapter = new SyncedFilesystemAdapter({
      root,
      afterWriteBeforeVerify: async (absolutePath) => {
        await writeFile(absolutePath, 'tampered');
      },
    });

    await expect(
      adapter.write({ path: 'paper.md' }, new TextEncoder().encode('intended')),
    ).rejects.toMatchObject({ code: 'integrity_mismatch' });
    expect(await readFile(join(root, 'paper.md'), 'utf8')).toBe('tampered');
  });
});
