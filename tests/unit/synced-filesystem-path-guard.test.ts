import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertResidenceRelativePath,
  resolveResidencePath,
} from '@arcp/adapter-synced-filesystem';

const cleanupRoots: string[] = [];

async function makeSandbox(): Promise<{
  base: string;
  root: string;
  rootRealPath: string;
  outside: string;
}> {
  const base = await mkdtemp(join(tmpdir(), 'arcp-synced-fs-'));
  cleanupRoots.push(base);
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  return { base, root, rootRealPath: await realpath(root), outside };
}

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('synced filesystem path guard', () => {
  it.each([
    '',
    '../escape.txt',
    'nested/../../escape.txt',
    '/absolute.txt',
    '\\\\server\\share\\escape.txt',
    'C:\\escape.txt',
    'C:/escape.txt',
    'nested\\windows-style.txt',
    'bad\0name.txt',
    './paper.md',
    'nested/./paper.md',
    'nested//paper.md',
    'nested/',
  ])('rejects non-canonical residence path %j', (candidate) => {
    expect(() => assertResidenceRelativePath(candidate)).toThrowError(
      expect.objectContaining({ code: 'invalid_path_or_ref' }),
    );
  });

  it('accepts canonical POSIX-style relative paths', () => {
    expect(() => assertResidenceRelativePath('notes/a.txt')).not.toThrow();
    expect(() => assertResidenceRelativePath('paper.md')).not.toThrow();
  });

  it('resolves an existing entry under the real root', async () => {
    const { root, rootRealPath } = await makeSandbox();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'a.txt'), 'hello');

    await expect(resolveResidencePath(rootRealPath, 'notes/a.txt')).resolves.toBe(
      join(rootRealPath, 'notes', 'a.txt'),
    );
  });

  it('resolves a not-yet-existing child only when its real parent is inside the root', async () => {
    const { root, rootRealPath } = await makeSandbox();
    await mkdir(join(root, 'notes'));

    await expect(resolveResidencePath(rootRealPath, 'notes/new.txt')).resolves.toBe(
      join(rootRealPath, 'notes', 'new.txt'),
    );
  });

  it('fails closed when any traversed component is a symlink or junction', async (context) => {
    const { root, rootRealPath, outside } = await makeSandbox();
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

    await expect(resolveResidencePath(rootRealPath, 'escape-link/secret.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
  });
});
