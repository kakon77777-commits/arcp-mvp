import { describe, expect, it } from 'vitest';
import { applyChanges, scanBaseline } from '@arcp/adapter-drive';
import { FakeDriveApiClient } from '../helpers/fake-drive-api-client.js';

const now = () => '2026-08-17T12:00:00.000Z';

function buildClientWithNestedTree(pageSize?: number): FakeDriveApiClient {
  const client = new FakeDriveApiClient(pageSize);
  client.addFolder('root', 'ARCP-Agent-Residence', null);
  client.addFolder('papers', 'papers', 'root');
  client.addFolder('papers-2026', '2026', 'papers');
  client.addFile('f1', 'alpha.md', 'papers-2026', 'alpha content');
  client.addFile('f2', 'beta.md', 'root', 'beta content');
  return client;
}

describe('scanBaseline (§9.3)', () => {
  it('recursively resolves full paths through nested folders', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);

    const alpha = baseline.entries.find((e) => e.fileId === 'f1');
    expect(alpha?.path).toBe('papers/2026/alpha.md');
    expect(alpha?.pathUncertain).toBe(false);
    const beta = baseline.entries.find((e) => e.fileId === 'f2');
    expect(beta?.path).toBe('beta.md');
    expect(beta?.pathUncertain).toBe(false);
  });

  it('never includes folders themselves as baseline entries', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    expect(baseline.entries.some((e) => e.fileId === 'papers' || e.fileId === 'papers-2026')).toBe(false);
  });

  it('flags pathUncertain when a multi-parent file was not actually discovered under parents[0]', async () => {
    const client = new FakeDriveApiClient();
    client.addFolder('root', 'root', null);
    client.addFolder('sub', 'sub', 'root');
    client.addFolder('outside-scan', 'outside-scan', null); // never reachable from root
    // Real Drive query membership ('sub' in parents) is independent of array
    // order -- this file is legitimately discovered under 'sub', but its
    // parents[0] happens to be a folder this scan never visited.
    client.addFileWithParents('f1', 'ambiguous.md', ['outside-scan', 'sub'], 'content');

    const baseline = await scanBaseline(client, 'root', now);
    const entry = baseline.entries.find((e) => e.fileId === 'f1');
    expect(entry).toBeDefined();
    expect(entry?.pathUncertain).toBe(true);
  });

  it('excludes trashed files when the query requests trashed = false, honoring the query itself', async () => {
    const client = new FakeDriveApiClient();
    client.addFolder('root', 'root', null);
    client.addFile('f1', 'kept.md', 'root', 'kept');
    client.addFile('f2', 'trashed.md', 'root', 'gone');
    client.trashFile('f2');

    const baseline = await scanBaseline(client, 'root', now);
    expect(baseline.entries.map((e) => e.fileId)).toEqual(['f1']);

    // Prove the exclusion is genuinely query-driven, not a fake-client
    // default: a query without the trashed clause returns the trashed file too.
    const rawPage = await client.listFiles({ query: "'root' in parents" });
    expect(rawPage.files.some((f) => f.id === 'f2')).toBe(true);
  });

  it('excludes files removed entirely (hard-deleted, not just trashed)', async () => {
    const client = new FakeDriveApiClient();
    client.addFolder('root', 'root', null);
    client.addFile('f1', 'kept.md', 'root', 'kept');
    client.addFile('f2', 'gone.md', 'root', 'gone');
    client.deleteFile('f2');
    const baseline = await scanBaseline(client, 'root', now);
    expect(baseline.entries.map((e) => e.fileId)).toEqual(['f1']);
  });

  it('records a content hash, Drive version, and the start page token captured before the scan', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    const alpha = baseline.entries.find((e) => e.fileId === 'f1');
    expect(alpha?.contentHash).toMatch(/^md5:/);
    expect(alpha?.driveVersion).toBe('1');
    expect(baseline.startPageToken).toBeDefined();
    expect(baseline.rootFolderId).toBe('root');
  });

  it('gets the start page token before scanning, so a change landing mid-scan is still covered afterward', async () => {
    const client = buildClientWithNestedTree();
    const originalGetStartPageToken = client.getStartPageToken.bind(client);
    let tokenFetchedBeforeAnyListFiles = false;
    let listFilesCalled = false;
    client.getStartPageToken = async () => {
      tokenFetchedBeforeAnyListFiles = !listFilesCalled;
      return originalGetStartPageToken();
    };
    const originalListFiles = client.listFiles.bind(client);
    client.listFiles = async (params) => {
      listFilesCalled = true;
      return originalListFiles(params);
    };

    await scanBaseline(client, 'root', now);
    expect(tokenFetchedBeforeAnyListFiles).toBe(true);

    // Demonstrate the guarantee this ordering buys: a file added "during" the
    // scan (simulated here as added right after, using the token captured
    // before the scan) is still visible to the very next applyChanges call.
    const baseline = await scanBaseline(client, 'root', now);
    client.addFile('mid-scan-file', 'late.md', 'root', 'late content');
    const result = await applyChanges(client, baseline, now);
    expect(result.baseline.entries.some((e) => e.fileId === 'mid-scan-file')).toBe(true);
  });

  it('paginates listFiles across multiple pages and still returns every file', async () => {
    const client = buildClientWithNestedTree(1); // force one file per page
    const baseline = await scanBaseline(client, 'root', now);
    expect(baseline.entries.map((e) => e.fileId).sort()).toEqual(['f1', 'f2']);
  });
});

describe('applyChanges (§9.3 incremental changes)', () => {
  it('updates content hash, Drive version, and path in place for a pure content edit', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    const before = baseline.entries.find((e) => e.fileId === 'f1')!;

    client.updateFileContent('f1', 'alpha content v2');
    const result = await applyChanges(client, baseline, now);

    const after = result.baseline.entries.find((e) => e.fileId === 'f1')!;
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.driveVersion).not.toBe(before.driveVersion);
    expect(after.path).toBe(before.path); // content-only change never touches the path
    expect(after.pathUncertain).toBe(false);
    expect(result.pathUncertainFileIds).not.toContain('f1');
    expect(result.cursorLost).toBe(false);
  });

  it('removes a deleted file from the baseline', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);

    client.deleteFile('f2');
    const result = await applyChanges(client, baseline, now);

    expect(result.baseline.entries.some((e) => e.fileId === 'f2')).toBe(false);
  });

  it('flags a rename as path_uncertain and keeps the stale path rather than guessing a new one', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    const before = baseline.entries.find((e) => e.fileId === 'f1')!;

    client.renameFile('f1', 'alpha-renamed.md');
    const result = await applyChanges(client, baseline, now);

    expect(result.pathUncertainFileIds).toContain('f1');
    const after = result.baseline.entries.find((e) => e.fileId === 'f1')!;
    expect(after.name).toBe('alpha-renamed.md');
    expect(after.path).toBe(before.path); // stale, not guessed at the new name
    expect(after.pathUncertain).toBe(true);
  });

  it('flags a move (parent change) as path_uncertain, keeps the stale path, and does not guess', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    const before = baseline.entries.find((e) => e.fileId === 'f1')!;

    client.moveFile('f1', 'root');
    const result = await applyChanges(client, baseline, now);

    expect(result.pathUncertainFileIds).toContain('f1');
    const after = result.baseline.entries.find((e) => e.fileId === 'f1')!;
    expect(after.path).toBe(before.path);
    expect(after.parentId).toBe('root');
    expect(after.pathUncertain).toBe(true);
  });

  it('flags a brand-new file discovered only through the change feed as path_uncertain', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);

    client.addFile('f3', 'gamma.md', 'papers-2026', 'gamma content');
    const result = await applyChanges(client, baseline, now);

    const entry = result.baseline.entries.find((e) => e.fileId === 'f3');
    expect(entry).toBeDefined();
    expect(entry?.pathUncertain).toBe(true);
    expect(result.pathUncertainFileIds).toContain('f3');
  });

  it('signals cursorLost rather than guessing when the cursor has expired', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);

    client.expireCursor();
    client.updateFileContent('f1', 'alpha content v2');
    const result = await applyChanges(client, baseline, now);

    expect(result.cursorLost).toBe(true);
    expect(result.pathUncertainFileIds).toEqual([]);
    // baseline is returned unchanged -- the caller must rebaseline, not trust this result.
    expect(result.baseline).toEqual(baseline);
  });

  it('advances the cursor to the new start page token after applying changes', async () => {
    const client = buildClientWithNestedTree();
    const baseline = await scanBaseline(client, 'root', now);
    client.updateFileContent('f1', 'v2');
    const result = await applyChanges(client, baseline, now);
    expect(result.baseline.startPageToken).not.toBe(baseline.startPageToken);
  });

  it('paginates listChanges across multiple pages and applies every change', async () => {
    const client = buildClientWithNestedTree(1); // force one change per page
    const baseline = await scanBaseline(client, 'root', now);

    client.updateFileContent('f1', 'v2');
    client.updateFileContent('f2', 'v2');
    client.addFile('f3', 'gamma.md', 'papers-2026', 'gamma content');

    const result = await applyChanges(client, baseline, now);
    expect(result.baseline.entries.map((e) => e.fileId).sort()).toEqual(['f1', 'f2', 'f3']);
    const f1 = result.baseline.entries.find((e) => e.fileId === 'f1')!;
    expect(f1.contentHash).not.toBe(baseline.entries.find((e) => e.fileId === 'f1')!.contentHash);
  });
});
