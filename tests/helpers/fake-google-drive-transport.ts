import { ResidenceStorageError, sha256Bytes } from '@arcp/residence-storage';
import type {
  GoogleDriveChangePage,
  GoogleDriveChangeRecord,
  GoogleDriveFilePage,
  GoogleDriveFileRecord,
  GoogleDriveTransport,
} from '@arcp/adapter-google-drive-api';

export const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface FakeGoogleDriveSeed {
  record: GoogleDriveFileRecord;
  bytes?: Uint8Array;
}

interface SequencedChange {
  sequence: number;
  change: GoogleDriveChangeRecord;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

async function checksumHex(bytes: Uint8Array): Promise<string> {
  return (await sha256Bytes(bytes)).slice('sha256:'.length);
}

function revisionFields(version: number): { headRevisionId: string; version: string } {
  return {
    headRevisionId: `head-${version}`,
    version: String(version),
  };
}

export function fakeGoogleDriveRecord(
  overrides: Partial<GoogleDriveFileRecord> & Record<string, unknown> = {},
): GoogleDriveFileRecord {
  return {
    id: 'file-1',
    name: 'file.txt',
    mimeType: 'text/plain',
    parents: ['root-id'],
    modifiedTime: '2026-08-17T14:00:00.000Z',
    size: '0',
    md5Checksum: null,
    sha256Checksum: null,
    trashed: false,
    headRevisionId: null,
    version: null,
    ...overrides,
  } as GoogleDriveFileRecord;
}

export class InMemoryGoogleDriveTransport implements GoogleDriveTransport {
  readonly calls: string[] = [];

  private readonly records = new Map<string, GoogleDriveFileRecord>();
  private readonly contents = new Map<string, Uint8Array>();
  private readonly changes: SequencedChange[] = [];
  private sequence = 0;
  private nextId = 1;

  constructor(
    readonly rootId = 'root-id',
    seeds: FakeGoogleDriveSeed[] = [],
  ) {
    for (const seed of seeds) {
      this.records.set(seed.record.id, { ...seed.record, parents: [...seed.record.parents] });
      if (seed.bytes !== undefined) this.contents.set(seed.record.id, copyBytes(seed.bytes));
    }
  }

  async getStartPageToken(driveId?: string): Promise<string> {
    this.calls.push(`start:${driveId ?? ''}`);
    return String(this.sequence);
  }

  async listChanges(pageToken: string, driveId?: string): Promise<GoogleDriveChangePage> {
    this.calls.push(`changes:${pageToken}:${driveId ?? ''}`);
    const parsed = Number(pageToken);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ResidenceStorageError('invalid_path_or_ref', `invalid fake Drive cursor: ${pageToken}`, false);
    }
    return {
      changes: this.changes.filter((item) => item.sequence > parsed).map((item) => item.change),
      nextPageToken: null,
      newStartPageToken: String(this.sequence),
    };
  }

  async listChildren(
    parentId: string,
    pageToken?: string,
    driveId?: string,
  ): Promise<GoogleDriveFilePage> {
    this.calls.push(`children:${parentId}:${pageToken ?? ''}:${driveId ?? ''}`);
    const files = [...this.records.values()]
      .filter((record) => !record.trashed && record.parents.includes(parentId))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((record) => ({ ...record, parents: [...record.parents] }));
    return { files, nextPageToken: null };
  }

  async download(fileId: string): Promise<Uint8Array> {
    this.calls.push(`download:${fileId}`);
    const bytes = this.contents.get(fileId);
    if (bytes === undefined) {
      throw new ResidenceStorageError('not_found', `fake Drive content missing: ${fileId}`, false);
    }
    return copyBytes(bytes);
  }

  async createFile(parentId: string, name: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord> {
    this.calls.push(`create:${parentId}:${name}`);
    const id = `created-${this.nextId++}`;
    const stored = copyBytes(bytes);
    const record = fakeGoogleDriveRecord({
      id,
      name,
      parents: [parentId],
      size: String(stored.byteLength),
      sha256Checksum: await checksumHex(stored),
      modifiedTime: new Date(1_000 + this.sequence).toISOString(),
      ...revisionFields(1),
    });
    this.records.set(id, record);
    this.contents.set(id, stored);
    this.pushChange({ fileId: id, removed: false, file: record });
    return { ...record, parents: [...record.parents] };
  }

  async updateFile(fileId: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord> {
    this.calls.push(`update:${fileId}`);
    const current = this.records.get(fileId);
    if (current === undefined) {
      throw new ResidenceStorageError('not_found', `fake Drive file missing: ${fileId}`, false);
    }
    const currentVersion = Number((current as GoogleDriveFileRecord & { version?: string | null }).version ?? '0');
    const nextVersion = Number.isSafeInteger(currentVersion) ? currentVersion + 1 : 1;
    const stored = copyBytes(bytes);
    const record = fakeGoogleDriveRecord({
      ...current,
      size: String(stored.byteLength),
      sha256Checksum: await checksumHex(stored),
      modifiedTime: new Date(1_000 + this.sequence).toISOString(),
      ...revisionFields(nextVersion),
    });
    this.records.set(fileId, record);
    this.contents.set(fileId, stored);
    this.pushChange({ fileId, removed: false, file: record });
    return { ...record, parents: [...record.parents] };
  }

  async deleteFile(fileId: string): Promise<void> {
    this.calls.push(`delete:${fileId}`);
    const current = this.records.get(fileId);
    if (current === undefined) {
      throw new ResidenceStorageError('not_found', `fake Drive file missing: ${fileId}`, false);
    }
    this.records.delete(fileId);
    this.contents.delete(fileId);
    this.pushChange({ fileId, removed: true, file: null });
  }

  moveFileForTest(fileId: string, parentId: string, name?: string): void {
    const current = this.records.get(fileId);
    if (current === undefined) throw new Error(`unknown fake Drive file: ${fileId}`);
    const next = fakeGoogleDriveRecord({
      ...current,
      parents: [parentId],
      name: name ?? current.name,
      modifiedTime: new Date(1_000 + this.sequence).toISOString(),
    });
    this.records.set(fileId, next);
    this.pushChange({ fileId, removed: false, file: next });
  }

  private pushChange(change: GoogleDriveChangeRecord): void {
    this.sequence += 1;
    this.changes.push({ sequence: this.sequence, change });
  }
}
