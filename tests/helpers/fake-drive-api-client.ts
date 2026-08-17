import type {
  DriveApiClientLike,
  DriveChange,
  DriveChangeListPage,
  DriveFileLike,
  DriveFileListPage,
} from '@arcp/adapter-drive';
import { DRIVE_FOLDER_MIME_TYPE, DriveCursorExpiredError } from '@arcp/adapter-drive';

function deterministicContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (Math.imul(31, hash) + content.charCodeAt(i)) | 0;
  }
  return `fakehash-${(hash >>> 0).toString(16)}`;
}

function paginate<T>(items: T[], pageToken: string | undefined, pageSize: number | undefined): { page: T[]; nextPageToken?: string } {
  if (!pageSize || pageSize >= items.length) {
    return { page: pageToken ? items.slice(Number(pageToken)) : items };
  }
  const start = pageToken ? Number(pageToken) : 0;
  const page = items.slice(start, start + pageSize);
  const nextStart = start + pageSize;
  return { page, nextPageToken: nextStart < items.length ? String(nextStart) : undefined };
}

/**
 * A DriveApiClientLike test double with an append-only change log — page
 * tokens are just indices into that log, so listChanges({pageToken}) is a
 * simple, honest slice. Mutating helper methods (addFile/updateFileContent/
 * moveFile/deleteFile) both update current state and append a change entry,
 * mirroring how the real API keeps a change feed alongside current state.
 *
 * `listFiles` actually parses the `trashed = false` clause out of the query
 * string (rather than always self-filtering regardless of what was asked),
 * so a test can catch a real caller regression that drops that clause.
 * `pageSize` (constructor option) forces real multi-page pagination for
 * both `listFiles` and `listChanges` when set below the item count.
 */
export class FakeDriveApiClient implements DriveApiClientLike {
  private readonly filesById = new Map<string, DriveFileLike>();
  private readonly contentById = new Map<string, Uint8Array>();
  private readonly changeLog: DriveChange[] = [];
  private cursorExpired = false;

  constructor(private readonly pageSize?: number) {}

  async listFiles({ query, pageToken }: { query: string; pageToken?: string }): Promise<DriveFileListPage> {
    const parentMatch = query.match(/'([^']+)' in parents/);
    const parentId = parentMatch?.[1] ?? null;
    const requiresNotTrashed = /trashed\s*=\s*false/.test(query);

    const matching = [...this.filesById.values()].filter((f) => {
      if (!parentId || !f.parents?.includes(parentId)) return false;
      if (requiresNotTrashed && f.trashed) return false;
      return true;
    });
    const { page, nextPageToken } = paginate(matching, pageToken, this.pageSize);
    return { files: page, nextPageToken };
  }

  async getStartPageToken(): Promise<string> {
    return String(this.changeLog.length);
  }

  async listChanges({ pageToken }: { pageToken: string }): Promise<DriveChangeListPage> {
    if (this.cursorExpired) throw new DriveCursorExpiredError();
    // pageToken/nextPageToken are always an absolute index into changeLog --
    // never re-based against an already-sliced view, which would silently
    // replay or skip entries once a caller followed nextPageToken.
    const fromIndex = Number(pageToken);
    const pageSize = this.pageSize && this.pageSize > 0 ? this.pageSize : this.changeLog.length - fromIndex;
    const endIndex = Math.min(fromIndex + Math.max(pageSize, 0), this.changeLog.length);
    const page = this.changeLog.slice(fromIndex, endIndex);
    const hasMore = endIndex < this.changeLog.length;
    return {
      changes: page,
      nextPageToken: hasMore ? String(endIndex) : undefined,
      newStartPageToken: hasMore ? undefined : String(endIndex),
    };
  }

  async getFileContent(fileId: string): Promise<Uint8Array> {
    const content = this.contentById.get(fileId);
    if (!content) throw new Error(`fake drive: no content for ${fileId}`);
    return content;
  }

  addFolder(id: string, name: string, parentId: string | null): void {
    this.filesById.set(id, { id, name, mimeType: DRIVE_FOLDER_MIME_TYPE, parents: parentId ? [parentId] : [] });
  }

  addFile(id: string, name: string, parentId: string, content: string, modifiedTime = '2026-08-17T00:00:00.000Z'): void {
    const bytes = new TextEncoder().encode(content);
    const file: DriveFileLike = {
      id,
      name,
      mimeType: 'text/markdown',
      parents: [parentId],
      size: String(bytes.byteLength),
      modifiedTime,
      md5Checksum: deterministicContentHash(content),
      version: '1',
    };
    this.filesById.set(id, file);
    this.contentById.set(id, bytes);
    this.changeLog.push({ fileId: id, removed: false, file, time: modifiedTime });
  }

  /** For exercising multi-parent files, where Drive does not guarantee parents[0] is the BFS-discovered folder. */
  addFileWithParents(id: string, name: string, parentIds: string[], content: string, modifiedTime = '2026-08-17T00:00:00.000Z'): void {
    const bytes = new TextEncoder().encode(content);
    const file: DriveFileLike = {
      id,
      name,
      mimeType: 'text/markdown',
      parents: parentIds,
      size: String(bytes.byteLength),
      modifiedTime,
      md5Checksum: deterministicContentHash(content),
      version: '1',
    };
    this.filesById.set(id, file);
    this.contentById.set(id, bytes);
    this.changeLog.push({ fileId: id, removed: false, file, time: modifiedTime });
  }

  updateFileContent(id: string, content: string, modifiedTime = '2026-08-17T01:00:00.000Z'): void {
    const existing = this.filesById.get(id);
    if (!existing) throw new Error(`fake drive: unknown file ${id}`);
    const bytes = new TextEncoder().encode(content);
    const nextVersion = String(Number(existing.version ?? '1') + 1);
    const updated: DriveFileLike = {
      ...existing,
      size: String(bytes.byteLength),
      md5Checksum: deterministicContentHash(content),
      modifiedTime,
      version: nextVersion,
    };
    this.filesById.set(id, updated);
    this.contentById.set(id, bytes);
    this.changeLog.push({ fileId: id, removed: false, file: updated, time: modifiedTime });
  }

  renameFile(id: string, newName: string): void {
    const existing = this.filesById.get(id);
    if (!existing) throw new Error(`fake drive: unknown file ${id}`);
    const updated = { ...existing, name: newName };
    this.filesById.set(id, updated);
    this.changeLog.push({ fileId: id, removed: false, file: updated, time: new Date().toISOString() });
  }

  moveFile(id: string, newParentId: string): void {
    const existing = this.filesById.get(id);
    if (!existing) throw new Error(`fake drive: unknown file ${id}`);
    const updated = { ...existing, parents: [newParentId] };
    this.filesById.set(id, updated);
    this.changeLog.push({ fileId: id, removed: false, file: updated, time: new Date().toISOString() });
  }

  deleteFile(id: string): void {
    this.filesById.delete(id);
    this.contentById.delete(id);
    this.changeLog.push({ fileId: id, removed: true });
  }

  /** Soft-trash: the file stays present via the API (as real Drive does) but is marked `trashed`. */
  trashFile(id: string): void {
    const existing = this.filesById.get(id);
    if (!existing) throw new Error(`fake drive: unknown file ${id}`);
    const updated = { ...existing, trashed: true };
    this.filesById.set(id, updated);
    this.changeLog.push({ fileId: id, removed: false, file: updated, time: new Date().toISOString() });
  }

  expireCursor(): void {
    this.cursorExpired = true;
  }
}
