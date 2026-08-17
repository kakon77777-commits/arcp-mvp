import { ResidenceStorageError, type ResidenceStorageEntry } from '@arcp/residence-storage';
import type { GoogleDriveFileRecord, GoogleDriveTransport } from './types.js';

export const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

export interface GoogleDriveTreeNode {
  record: GoogleDriveFileRecord;
  path: string;
  entry: ResidenceStorageEntry;
}

function conflict(message: string): ResidenceStorageError {
  return new ResidenceStorageError('conflict', message, false);
}

function assertRepresentableSegment(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw conflict(`Google Drive name cannot be represented as a canonical residence path segment: ${JSON.stringify(name)}`);
  }
}

function safeSize(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function googleDriveRef(fileId: string): string {
  return `gdrive:${fileId}`;
}

export function googleDriveRevision(record: GoogleDriveFileRecord): string | null {
  if (record.headRevisionId != null) return `gdrive-head:${record.headRevisionId}`;
  if (record.version != null) return `gdrive-version:${record.version}`;
  return null;
}

export function googleDriveContentHash(record: GoogleDriveFileRecord): string | null {
  if (record.sha256Checksum !== null) {
    return record.sha256Checksum.startsWith('sha256:')
      ? record.sha256Checksum
      : `sha256:${record.sha256Checksum}`;
  }
  if (record.md5Checksum !== null) {
    return record.md5Checksum.startsWith('md5:') ? record.md5Checksum : `md5:${record.md5Checksum}`;
  }
  return null;
}

export function isGoogleNativeDocument(record: GoogleDriveFileRecord): boolean {
  return record.mimeType.startsWith(GOOGLE_NATIVE_PREFIX) && record.mimeType !== GOOGLE_DRIVE_FOLDER_MIME;
}

export function googleDriveEntry(record: GoogleDriveFileRecord, path: string): ResidenceStorageEntry {
  const directory = record.mimeType === GOOGLE_DRIVE_FOLDER_MIME;
  return {
    ref: googleDriveRef(record.id),
    path,
    kind: directory ? 'directory' : 'file',
    size: directory ? null : safeSize(record.size),
    modifiedAt: record.modifiedTime,
    contentHash: directory ? null : googleDriveContentHash(record),
    revision: googleDriveRevision(record),
  };
}

export async function listGoogleDriveTree(
  transport: GoogleDriveTransport,
  rootId: string,
  driveId?: string,
): Promise<GoogleDriveTreeNode[]> {
  const queue: Array<{ parentId: string; parentPath: string }> = [
    { parentId: rootId, parentPath: '' },
  ];
  const visitedFolders = new Set<string>();
  const pathOwners = new Map<string, string>();
  const idPaths = new Map<string, string>();
  const nodes: GoogleDriveTreeNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visitedFolders.has(current.parentId)) continue;
    visitedFolders.add(current.parentId);

    let pageToken: string | undefined;
    do {
      const page = await transport.listChildren(current.parentId, pageToken, driveId);
      for (const record of page.files) {
        if (record.trashed) continue;
        assertRepresentableSegment(record.name);
        const path = current.parentPath === '' ? record.name : `${current.parentPath}/${record.name}`;

        const existingOwner = pathOwners.get(path);
        if (existingOwner !== undefined && existingOwner !== record.id) {
          throw conflict(`multiple Google Drive IDs map to the same residence path: ${path}`);
        }
        const existingPath = idPaths.get(record.id);
        if (existingPath !== undefined && existingPath !== path) {
          throw conflict(`Google Drive ID appears at multiple residence paths: ${record.id}`);
        }
        pathOwners.set(path, record.id);
        idPaths.set(record.id, path);

        const entry = googleDriveEntry(record, path);
        nodes.push({ record: { ...record, parents: [...record.parents] }, path, entry });
        if (record.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
          queue.push({ parentId: record.id, parentPath: path });
        }
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken !== undefined);
  }

  nodes.sort((left, right) => left.path.localeCompare(right.path));
  return nodes;
}
