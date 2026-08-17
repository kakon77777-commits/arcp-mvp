import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
