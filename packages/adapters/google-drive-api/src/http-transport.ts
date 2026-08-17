import { ResidenceStorageError } from '@arcp/residence-storage';
import type {
  AccessTokenProvider,
  GoogleDriveChangePage,
  GoogleDriveChangeRecord,
  GoogleDriveFilePage,
  GoogleDriveFileRecord,
  GoogleDriveTransport,
} from './types.js';

const GOOGLE_ORIGIN = 'https://www.googleapis.com';
const FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'parents',
  'modifiedTime',
  'size',
  'md5Checksum',
  'sha256Checksum',
  'trashed',
].join(',');
const FILE_LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const CHANGE_LIST_FIELDS = `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`;
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
]);

type JsonObject = Record<string, unknown>;

export interface FetchGoogleDriveTransportOptions {
  accessTokenProvider: AccessTokenProvider;
  fetch?: typeof globalThis.fetch;
}

function storageError(
  code: ConstructorParameters<typeof ResidenceStorageError>[0],
  message: string,
  retryable: boolean,
  cause?: unknown,
): ResidenceStorageError {
  return new ResidenceStorageError(
    code,
    message,
    retryable,
    cause === undefined ? undefined : { cause },
  );
}

function asObject(value: unknown, context: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw storageError('unknown_backend_error', `malformed Google Drive ${context}`, false);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw storageError('unknown_backend_error', `malformed Google Drive field: ${field}`, false);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw storageError('unknown_backend_error', `malformed Google Drive field: ${field}`, false);
  }
  return value;
}

function optionalToken(value: unknown, field: string): string | null {
  return nullableString(value, field);
}

function parseParents(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw storageError('unknown_backend_error', 'malformed Google Drive field: parents', false);
  }
  return [...value] as string[];
}

function parseFileRecord(value: unknown): GoogleDriveFileRecord {
  const record = asObject(value, 'file record');
  if (record.trashed !== undefined && typeof record.trashed !== 'boolean') {
    throw storageError('unknown_backend_error', 'malformed Google Drive field: trashed', false);
  }

  return {
    id: requiredString(record.id, 'id'),
    name: requiredString(record.name, 'name'),
    mimeType: requiredString(record.mimeType, 'mimeType'),
    parents: parseParents(record.parents),
    modifiedTime: nullableString(record.modifiedTime, 'modifiedTime'),
    size: nullableString(record.size, 'size'),
    md5Checksum: nullableString(record.md5Checksum, 'md5Checksum'),
    sha256Checksum: nullableString(record.sha256Checksum, 'sha256Checksum'),
    trashed: record.trashed ?? false,
  };
}

function parseChangeRecord(value: unknown): GoogleDriveChangeRecord {
  const record = asObject(value, 'change record');
  if (typeof record.removed !== 'boolean') {
    throw storageError('unknown_backend_error', 'malformed Google Drive field: removed', false);
  }
  return {
    fileId: requiredString(record.fileId, 'fileId'),
    removed: record.removed,
    file: record.file === undefined || record.file === null ? null : parseFileRecord(record.file),
  };
}

async function parseJson(response: Response, context: string): Promise<JsonObject> {
  try {
    return asObject(await response.json(), context);
  } catch (error) {
    if (error instanceof ResidenceStorageError) throw error;
    throw storageError('unknown_backend_error', `malformed Google Drive ${context}`, false, error);
  }
}

async function readErrorPayload(response: Response): Promise<{ message: string; reasons: string[] }> {
  const fallback = `Google Drive HTTP ${response.status}`;
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { message: fallback, reasons: [] };
  }
  if (text.length === 0) return { message: fallback, reasons: [] };

  try {
    const root = asObject(JSON.parse(text) as unknown, 'error response');
    const error = asObject(root.error, 'error response');
    const message = typeof error.message === 'string' ? error.message : fallback;
    const reasons: string[] = [];
    if (Array.isArray(error.errors)) {
      for (const item of error.errors) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
        const reason = (item as JsonObject).reason;
        if (typeof reason === 'string') reasons.push(reason);
      }
    }
    return { message, reasons };
  } catch {
    return { message: fallback, reasons: [] };
  }
}

async function mapHttpError(response: Response): Promise<ResidenceStorageError> {
  const payload = await readErrorPayload(response);
  const message = `${payload.message} (${response.status})`;

  if (response.status === 401) {
    return storageError('authentication_required', message, false);
  }
  if (response.status === 403) {
    if (payload.reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) {
      return storageError('rate_limited', message, true);
    }
    return storageError('permission_denied', message, false);
  }
  if (response.status === 404) {
    return storageError('not_found', message, false);
  }
  if (response.status === 409 || response.status === 412) {
    return storageError('conflict', message, false);
  }
  if (response.status === 429) {
    return storageError('rate_limited', message, true);
  }
  if (response.status >= 500 && response.status <= 599) {
    return storageError('temporarily_unavailable', message, true);
  }
  return storageError('unknown_backend_error', message, false);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function multipartBody(boundary: string, metadata: JsonObject, bytes: Uint8Array): ArrayBuffer {
  const encoder = new TextEncoder();
  const before = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const after = encoder.encode(`\r\n--${boundary}--\r\n`);
  const joined = new Uint8Array(before.byteLength + bytes.byteLength + after.byteLength);
  joined.set(before, 0);
  joined.set(bytes, before.byteLength);
  joined.set(after, before.byteLength + bytes.byteLength);
  return joined.buffer;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class FetchGoogleDriveTransport implements GoogleDriveTransport {
  private readonly accessTokenProvider: AccessTokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: FetchGoogleDriveTransportOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async getStartPageToken(driveId?: string): Promise<string> {
    const url = new URL('/drive/v3/changes/startPageToken', GOOGLE_ORIGIN);
    url.searchParams.set('supportsAllDrives', 'true');
    if (driveId !== undefined) url.searchParams.set('driveId', driveId);

    const response = await this.request(url);
    const body = await parseJson(response, 'start-page-token response');
    return requiredString(body.startPageToken, 'startPageToken');
  }

  async listChanges(pageToken: string, driveId?: string): Promise<GoogleDriveChangePage> {
    const url = new URL('/drive/v3/changes', GOOGLE_ORIGIN);
    url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('fields', CHANGE_LIST_FIELDS);
    if (driveId !== undefined) url.searchParams.set('driveId', driveId);

    const response = await this.request(url);
    const body = await parseJson(response, 'changes response');
    if (body.changes !== undefined && !Array.isArray(body.changes)) {
      throw storageError('unknown_backend_error', 'malformed Google Drive field: changes', false);
    }
    const changes = (body.changes ?? []).map(parseChangeRecord);
    return {
      changes,
      nextPageToken: optionalToken(body.nextPageToken, 'nextPageToken'),
      newStartPageToken: optionalToken(body.newStartPageToken, 'newStartPageToken'),
    };
  }

  async listChildren(
    parentId: string,
    pageToken?: string,
    driveId?: string,
  ): Promise<GoogleDriveFilePage> {
    const url = new URL('/drive/v3/files', GOOGLE_ORIGIN);
    url.searchParams.set('q', `'${escapeDriveQueryLiteral(parentId)}' in parents and trashed = false`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('fields', FILE_LIST_FIELDS);
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
    if (driveId !== undefined) {
      url.searchParams.set('corpora', 'drive');
      url.searchParams.set('driveId', driveId);
    }

    const response = await this.request(url);
    const body = await parseJson(response, 'file-list response');
    if (body.files !== undefined && !Array.isArray(body.files)) {
      throw storageError('unknown_backend_error', 'malformed Google Drive field: files', false);
    }
    return {
      files: (body.files ?? []).map(parseFileRecord),
      nextPageToken: optionalToken(body.nextPageToken, 'nextPageToken'),
    };
  }

  async download(fileId: string): Promise<Uint8Array> {
    const url = new URL(`/drive/v3/files/${encodeURIComponent(fileId)}`, GOOGLE_ORIGIN);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.request(url);
    return new Uint8Array(await response.arrayBuffer());
  }

  async createFile(
    parentId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<GoogleDriveFileRecord> {
    const url = new URL('/upload/drive/v3/files', GOOGLE_ORIGIN);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', FILE_FIELDS);
    const boundary = `arcp-${globalThis.crypto.randomUUID()}`;
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(boundary, { name, parents: [parentId] }, bytes),
    });
    return parseFileRecord(await parseJson(response, 'file-create response'));
  }

  async updateFile(fileId: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord> {
    const url = new URL(`/upload/drive/v3/files/${encodeURIComponent(fileId)}`, GOOGLE_ORIGIN);
    url.searchParams.set('uploadType', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', FILE_FIELDS);
    const response = await this.request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/octet-stream' },
      body: copyArrayBuffer(bytes),
    });
    return parseFileRecord(await parseJson(response, 'file-update response'));
  }

  async deleteFile(fileId: string): Promise<void> {
    const url = new URL(`/drive/v3/files/${encodeURIComponent(fileId)}`, GOOGLE_ORIGIN);
    url.searchParams.set('supportsAllDrives', 'true');
    await this.request(url, { method: 'DELETE' });
  }

  private async request(url: URL, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessTokenProvider.getAccessToken();
    if (token.length === 0) {
      throw storageError('authentication_required', 'Google Drive access token is empty', false);
    }

    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, headers });
    } catch (error) {
      throw storageError(
        'temporarily_unavailable',
        'Google Drive request failed before receiving a response',
        true,
        error,
      );
    }

    if (!response.ok) throw await mapHttpError(response);
    return response;
  }
}
