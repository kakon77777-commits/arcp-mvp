/**
 * Minimal structural subset of the real Google Drive API v3 — just enough
 * surface for the change-discovery/sync-engine modules, mirroring the
 * D1DatabaseLike/R2BucketLike pattern in the Cloudflare adapter. No
 * `googleapis` dependency; no real network calls until Gate B.
 */
export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface DriveFileLike {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  trashed?: boolean;
  /** Drive's monotonically increasing per-file revision counter (§9.3 requires it be retained). */
  version?: string;
}

export interface DriveFileListPage {
  files: DriveFileLike[];
  nextPageToken?: string;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFileLike;
  time?: string;
}

export interface DriveChangeListPage {
  changes: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export class DriveCursorExpiredError extends Error {
  constructor() {
    super('Drive change cursor is lost or expired — a full rebaseline is required, not a guess');
    this.name = 'DriveCursorExpiredError';
  }
}

export interface DriveApiClientLike {
  listFiles(params: { query: string; pageToken?: string }): Promise<DriveFileListPage>;
  getStartPageToken(): Promise<string>;
  listChanges(params: { pageToken: string }): Promise<DriveChangeListPage>;
  getFileContent(fileId: string): Promise<Uint8Array>;
}
