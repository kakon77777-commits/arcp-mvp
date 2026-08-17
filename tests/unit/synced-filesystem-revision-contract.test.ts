import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SyncedFilesystemAdapter } from '@arcp/adapter-synced-filesystem';

it('does not expose pseudo revision tokens when revision preconditions are unsupported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcp-synced-revision-'));
  try {
    await writeFile(join(root, 'paper.md'), 'draft');
    const adapter = new SyncedFilesystemAdapter({ root });

    const snapshot = await adapter.snapshot();
    const entry = snapshot.entries.find((item) => item.path === 'paper.md');
    const blob = await adapter.read('fs:paper.md');

    expect(entry?.revision).toBeNull();
    expect(blob?.revision).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
