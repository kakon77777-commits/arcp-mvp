import { describe, expect, it } from 'vitest';
import {
  GoogleDriveApiAdapter,
  type GoogleDriveChangePage,
  type GoogleDriveFilePage,
  type GoogleDriveFileRecord,
  type GoogleDriveTransport,
} from '@arcp/adapter-google-drive-api';
import type { ResidenceStorageSnapshot } from '@arcp/residence-storage';
import {
  GOOGLE_DRIVE_FOLDER_MIME,
  InMemoryGoogleDriveTransport,
  fakeGoogleDriveRecord,
} from '../helpers/fake-google-drive-transport.js';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

class ScriptedTransport implements GoogleDriveTransport {
  readonly calls: string[] = [];
  startToken = 'start-0';
  readonly changePages = new Map<string, GoogleDriveChangePage>();
  readonly childPages = new Map<string, GoogleDriveFilePage[]>();

  async getStartPageToken(driveId?: string): Promise<string> {
    this.calls.push(`start:${driveId ?? ''}`);
    return this.startToken;
  }

  async listChanges(pageToken: string, driveId?: string): Promise<GoogleDriveChangePage> {
    this.calls.push(`changes:${pageToken}:${driveId ?? ''}`);
    const page = this.changePages.get(pageToken);
    if (page === undefined) throw new Error(`missing scripted change page ${pageToken}`);
    return page;
  }

  async listChildren(parentId: string, pageToken?: string, driveId?: string): Promise<GoogleDriveFilePage> {
    this.calls.push(`children:${parentId}:${pageToken ?? ''}:${driveId ?? ''}`);
    const pages = this.childPages.get(parentId) ?? [];
    if (pages.length === 0) return { files: [], nextPageToken: null };
    if (pageToken === undefined) return pages[0]!;
    const numeric = Number(pageToken.replace('page-', ''));
    return pages[numeric - 1] ?? { files: [], nextPageToken: null };
  }

  async download(_fileId: string): Promise<Uint8Array> {
    throw new Error('unused scripted download');
  }
  async createFile(_parentId: string, _name: string, _bytes: Uint8Array): Promise<GoogleDriveFileRecord> {
    throw new Error('unused scripted create');
  }
  async updateFile(_fileId: string, _bytes: Uint8Array): Promise<GoogleDriveFileRecord> {
    throw new Error('unused scripted update');
  }
  async deleteFile(_fileId: string): Promise<void> {
    throw new Error('unused scripted delete');
  }
}

function emptySnapshot(cursor: string): ResidenceStorageSnapshot {
  return {
    backendKind: 'google-drive-api',
    observedAt: '2026-08-17T14:00:00.000Z',
    cursor,
    entries: [],
  };
}

describe('GoogleDriveApiAdapter', () => {
  it('acquires the race-safe cursor before recursively enumerating and maps stable IDs/revisions', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      {
        record: fakeGoogleDriveRecord({
          id: 'folder-docs',
          name: 'docs',
          mimeType: GOOGLE_DRIVE_FOLDER_MIME,
          parents: ['root-id'],
          size: null,
          version: '7',
        }),
      },
      {
        record: fakeGoogleDriveRecord({
          id: 'paper-1',
          name: 'paper.md',
          parents: ['folder-docs'],
          size: '5',
          sha256Checksum: 'abc123',
          headRevisionId: 'head-9',
          version: '10',
        }),
        bytes: bytes('hello'),
      },
    ]);
    const adapter = new GoogleDriveApiAdapter({
      transport,
      rootId: 'root-id',
      now: () => new Date('2026-08-17T14:30:00.000Z'),
    });

    const snapshot = await adapter.snapshot();

    expect(transport.calls[0]).toBe('start:');
    expect(transport.calls[1]).toBe('children:root-id::');
    expect(snapshot).toMatchObject({
      backendKind: 'google-drive-api',
      observedAt: '2026-08-17T14:30:00.000Z',
      cursor: '0',
    });
    expect(snapshot.entries.map((entry) => entry.path)).toEqual(['docs', 'docs/paper.md']);
    expect(snapshot.entries[0]).toMatchObject({
      ref: 'gdrive:folder-docs',
      kind: 'directory',
      revision: 'gdrive-version:7',
    });
    expect(snapshot.entries[1]).toMatchObject({
      ref: 'gdrive:paper-1',
      kind: 'file',
      contentHash: 'sha256:abc123',
      revision: 'gdrive-head:head-9',
    });
  });

  it('follows every child-list page during scoped tree reconstruction', async () => {
    const transport = new ScriptedTransport();
    transport.childPages.set('root-id', [
      {
        files: [fakeGoogleDriveRecord({ id: 'a', name: 'a.txt', parents: ['root-id'] })],
        nextPageToken: 'page-2',
      },
      {
        files: [fakeGoogleDriveRecord({ id: 'b', name: 'b.txt', parents: ['root-id'] })],
        nextPageToken: null,
      },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });

    const snapshot = await adapter.snapshot();

    expect(snapshot.entries.map((entry) => entry.path)).toEqual(['a.txt', 'b.txt']);
    expect(transport.calls).toContain('children:root-id:page-2:');
  });

  it('classifies a stable Drive ID move as moved rather than removed plus added', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'left', name: 'left', mimeType: GOOGLE_DRIVE_FOLDER_MIME, parents: ['root-id'], size: null }) },
      { record: fakeGoogleDriveRecord({ id: 'right', name: 'right', mimeType: GOOGLE_DRIVE_FOLDER_MIME, parents: ['root-id'], size: null }) },
      { record: fakeGoogleDriveRecord({ id: 'same-file', name: 'x.txt', parents: ['left'], sha256Checksum: 'abc' }), bytes: bytes('x') },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const baseline = await adapter.snapshot();

    transport.moveFileForTest('same-file', 'right');
    const result = await adapter.diff(baseline);

    expect(result.diff.moved.map((move) => [move.before.path, move.after.path])).toEqual([
      ['left/x.txt', 'right/x.txt'],
    ]);
    expect(result.diff.added).toEqual([]);
    expect(result.diff.removed).toEqual([]);
  });

  it('drains all change pages and advances the cursor without rebuilding when there are no changes', async () => {
    const transport = new ScriptedTransport();
    transport.changePages.set('cursor-0', {
      changes: [],
      nextPageToken: 'cursor-1',
      newStartPageToken: null,
    });
    transport.changePages.set('cursor-1', {
      changes: [],
      nextPageToken: null,
      newStartPageToken: 'cursor-2',
    });
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const previous = emptySnapshot('cursor-0');

    const result = await adapter.diff(previous);

    expect(result.snapshot.cursor).toBe('cursor-2');
    expect(result.snapshot.entries).toEqual(previous.entries);
    expect(result.diff).toEqual({ added: [], changed: [], removed: [], moved: [] });
    expect(transport.calls).toEqual(['changes:cursor-0:', 'changes:cursor-1:']);
  });

  it('rebuilds after provider change evidence and reports removals without implying canonical erasure', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'paper', name: 'paper.md', parents: ['root-id'], sha256Checksum: 'abc' }), bytes: bytes('draft') },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const baseline = await adapter.snapshot();

    await transport.deleteFile('paper');
    const result = await adapter.diff(baseline);

    expect(result.snapshot.cursor).toBe('1');
    expect(result.diff.removed.map((entry) => entry.path)).toEqual(['paper.md']);
    expect(result.snapshot.entries).toEqual([]);
  });

  it('supports ordinary byte-backed read/write/remove with provider-confirmed receipts and preconditions', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'notes', name: 'notes', mimeType: GOOGLE_DRIVE_FOLDER_MIME, parents: ['root-id'], size: null, version: '1' }) },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });

    const created = await adapter.write({ path: 'notes/a.txt' }, bytes('hello'), { ifAbsent: true });
    expect(created).toMatchObject({ status: 'written', providerReplication: 'provider-confirmed' });
    expect(created.contentHash.startsWith('sha256:')).toBe(true);
    const blob = await adapter.read(created.ref);
    expect(blob?.bytes).toEqual(bytes('hello'));

    await expect(adapter.write({ path: 'notes/a.txt' }, bytes('other'), { ifAbsent: true })).rejects.toMatchObject({ code: 'conflict' });

    const updated = await adapter.write(
      { path: 'notes/a.txt' },
      bytes('next'),
      { ifContentHash: created.contentHash },
    );
    expect(updated).toMatchObject({ status: 'written', providerReplication: 'provider-confirmed' });
    expect(updated.revision).not.toBe(created.revision);

    const removed = await adapter.remove(
      { path: 'notes/a.txt' },
      { ifContentHash: updated.contentHash, ifRevision: updated.revision ?? undefined },
    );
    expect(removed).toMatchObject({ status: 'removed', providerReplication: 'provider-confirmed' });
    await expect(adapter.remove({ path: 'notes/a.txt' })).resolves.toMatchObject({ status: 'already_absent' });
  });

  it('rejects byte reads of Google-native documents', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      {
        record: fakeGoogleDriveRecord({
          id: 'doc-1',
          name: 'native-doc',
          mimeType: 'application/vnd.google-apps.document',
          parents: ['root-id'],
          size: null,
        }),
      },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const snapshot = await adapter.snapshot();

    await expect(adapter.read(snapshot.entries[0]!.ref)).rejects.toMatchObject({
      code: 'unsupported_operation',
      retryable: false,
    });
  });

  it('fails closed when two Drive IDs collapse onto the same normalized path', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'one', name: 'same.txt', parents: ['root-id'] }) },
      { record: fakeGoogleDriveRecord({ id: 'two', name: 'same.txt', parents: ['root-id'] }) },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });

    await expect(adapter.snapshot()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rebuilds instead of echoing a stale scope when a differently-scoped diff sees no provider changes', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'folder-a', name: 'a', mimeType: GOOGLE_DRIVE_FOLDER_MIME, parents: ['root-id'], size: null }) },
      { record: fakeGoogleDriveRecord({ id: 'folder-b', name: 'b', mimeType: GOOGLE_DRIVE_FOLDER_MIME, parents: ['root-id'], size: null }) },
      { record: fakeGoogleDriveRecord({ id: 'x', name: 'x.txt', parents: ['folder-a'], sha256Checksum: 'abc' }), bytes: bytes('x') },
      { record: fakeGoogleDriveRecord({ id: 'y', name: 'y.txt', parents: ['folder-b'], sha256Checksum: 'def' }), bytes: bytes('y') },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });

    const baselineScopedToA = await adapter.snapshot({ prefix: 'a' });
    expect(baselineScopedToA.entries.map((entry) => entry.path)).toEqual(['a', 'a/x.txt']);

    const result = await adapter.diff(baselineScopedToA, { prefix: 'b' });

    expect(result.snapshot.entries.map((entry) => entry.path)).toEqual(['b', 'b/y.txt']);
  });

  it('verifies existing content at most once per write when a matching ifContentHash and the unchanged check both need it', async () => {
    const transport = new InMemoryGoogleDriveTransport('root-id', [
      { record: fakeGoogleDriveRecord({ id: 'note', name: 'note.txt', parents: ['root-id'] }), bytes: bytes('same') },
    ]);
    const adapter = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const snapshot = await adapter.snapshot();
    const ref = snapshot.entries[0]!.ref;
    const blob = await adapter.read(ref);
    transport.calls.length = 0;

    const result = await adapter.write({ path: 'note.txt' }, bytes('same'), { ifContentHash: blob!.contentHash });

    expect(result.status).toBe('unchanged');
    expect(transport.calls.filter((call) => call.startsWith('download:'))).toEqual(['download:note']);
  });

  it('advertises cursor/stable-ID/provider-confirmation capabilities and Shared Drive mode explicitly', () => {
    const transport = new InMemoryGoogleDriveTransport();
    const personal = new GoogleDriveApiAdapter({ transport, rootId: 'root-id' });
    const shared = new GoogleDriveApiAdapter({ transport, rootId: 'root-id', driveId: 'drive-1' });

    expect(personal.capabilities()).toEqual({
      watchHints: false,
      changeCursor: true,
      stableObjectIds: true,
      providerReplicationConfirmation: true,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    });
    expect(shared.capabilities().sharedDrives).toBe(true);
  });
});
