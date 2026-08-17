export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleDriveFileRecord {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string | null;
  size: string | null;
  md5Checksum: string | null;
  sha256Checksum: string | null;
  headRevisionId: string | null;
  version: string | null;
  trashed: boolean;
}

export interface GoogleDriveChangeRecord {
  fileId: string;
  removed: boolean;
  file: GoogleDriveFileRecord | null;
}

export interface GoogleDriveChangePage {
  changes: GoogleDriveChangeRecord[];
  nextPageToken: string | null;
  newStartPageToken: string | null;
}

export interface GoogleDriveFilePage {
  files: GoogleDriveFileRecord[];
  nextPageToken: string | null;
}

export interface GoogleDriveTransport {
  getStartPageToken(driveId?: string): Promise<string>;
  listChanges(pageToken: string, driveId?: string): Promise<GoogleDriveChangePage>;
  listChildren(parentId: string, pageToken?: string, driveId?: string): Promise<GoogleDriveFilePage>;
  download(fileId: string): Promise<Uint8Array>;
  createFile(parentId: string, name: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord>;
  updateFile(fileId: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord>;
  deleteFile(fileId: string): Promise<void>;
}
