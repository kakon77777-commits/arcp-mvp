import { describe, expect, it } from 'vitest';
import {
  FetchGoogleDriveTransport,
  type GoogleDriveFileRecord,
} from '@arcp/adapter-google-drive-api';
import { createFakeGoogleDriveFetch } from '../helpers/fake-google-drive-fetch.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fileRecord(overrides: Partial<GoogleDriveFileRecord> = {}): GoogleDriveFileRecord {
  return {
    id: 'file-1',
    name: 'paper.md',
    mimeType: 'text/markdown',
    parents: ['root-id'],
    modifiedTime: '2026-08-17T13:00:00.000Z',
    size: '5',
    md5Checksum: 'md5-value',
    sha256Checksum: 'sha256-value',
    trashed: false,
    ...overrides,
  };
}

function makeTransport(responses: Parameters<typeof createFakeGoogleDriveFetch>[0]) {
  const fake = createFakeGoogleDriveFetch(responses);
  const transport = new FetchGoogleDriveTransport({
    accessTokenProvider: {
      async getAccessToken(): Promise<string> {
        return 'token-for-test';
      },
    },
    fetch: fake.fetch,
  });
  return { fake, transport };
}

function bodyText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('FetchGoogleDriveTransport', () => {
  it('attaches bearer auth and parses the start page token', async () => {
    const { fake, transport } = makeTransport([jsonResponse({ startPageToken: 'token-100' })]);

    await expect(transport.getStartPageToken('shared-drive-1')).resolves.toBe('token-100');

    const request = fake.requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(request.headers.get('authorization')).toBe('Bearer token-for-test');
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(url.pathname).toBe('/drive/v3/changes/startPageToken');
    expect(url.searchParams.get('driveId')).toBe('shared-drive-1');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
  });

  it('preserves one page of changes and both continuation token kinds', async () => {
    const record = fileRecord();
    const { fake, transport } = makeTransport([
      jsonResponse({
        changes: [{ fileId: 'file-1', removed: false, file: record }],
        nextPageToken: 'next-2',
        newStartPageToken: 'start-3',
      }),
    ]);

    const page = await transport.listChanges('page-1', 'shared-drive-1');

    expect(page).toEqual({
      changes: [{ fileId: 'file-1', removed: false, file: record }],
      nextPageToken: 'next-2',
      newStartPageToken: 'start-3',
    });
    const url = new URL(fake.requests[0]!.url);
    expect(url.pathname).toBe('/drive/v3/changes');
    expect(url.searchParams.get('pageToken')).toBe('page-1');
    expect(url.searchParams.get('driveId')).toBe('shared-drive-1');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
  });

  it('lists children with an escaped parent query, explicit fields, and all-drives flags', async () => {
    const record = fileRecord({ parents: ["folder'one"] });
    const { fake, transport } = makeTransport([
      jsonResponse({ files: [record], nextPageToken: 'children-2' }),
    ]);

    await expect(transport.listChildren("folder'one", 'children-1', 'shared-drive-1')).resolves.toEqual({
      files: [record],
      nextPageToken: 'children-2',
    });

    const url = new URL(fake.requests[0]!.url);
    expect(url.pathname).toBe('/drive/v3/files');
    expect(url.searchParams.get('q')).toBe("'folder\\'one' in parents and trashed = false");
    expect(url.searchParams.get('pageToken')).toBe('children-1');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(url.searchParams.get('corpora')).toBe('drive');
    expect(url.searchParams.get('driveId')).toBe('shared-drive-1');
    expect(url.searchParams.get('fields')).toContain('nextPageToken');
    expect(url.searchParams.get('fields')).toContain('sha256Checksum');
  });

  it('downloads ordinary file bytes through alt=media', async () => {
    const { fake, transport } = makeTransport([
      new Response(new Uint8Array([0, 1, 2, 255]), { status: 200 }),
    ]);

    await expect(transport.download('file/id')).resolves.toEqual(new Uint8Array([0, 1, 2, 255]));

    const url = new URL(fake.requests[0]!.url);
    expect(url.pathname).toBe('/drive/v3/files/file%2Fid');
    expect(url.searchParams.get('alt')).toBe('media');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
  });

  it('creates a byte-backed file with multipart metadata under the requested parent', async () => {
    const created = fileRecord({ id: 'created-1' });
    const { fake, transport } = makeTransport([jsonResponse(created)]);

    await expect(
      transport.createFile('root-id', 'paper.md', new TextEncoder().encode('hello')),
    ).resolves.toEqual(created);

    const request = fake.requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe('POST');
    expect(url.pathname).toBe('/upload/drive/v3/files');
    expect(url.searchParams.get('uploadType')).toBe('multipart');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(request.headers.get('content-type')).toMatch(/^multipart\/related; boundary=/);
    expect(bodyText(request.body)).toContain('"name":"paper.md"');
    expect(bodyText(request.body)).toContain('"parents":["root-id"]');
    expect(bodyText(request.body)).toContain('hello');
  });

  it('updates byte content through the upload endpoint and deletes with Drive support enabled', async () => {
    const updated = fileRecord({ id: 'file-1', size: '4' });
    const { fake, transport } = makeTransport([
      jsonResponse(updated),
      new Response(null, { status: 204 }),
    ]);

    await expect(
      transport.updateFile('file-1', new TextEncoder().encode('next')),
    ).resolves.toEqual(updated);
    await expect(transport.deleteFile('file-1')).resolves.toBeUndefined();

    const update = fake.requests[0]!;
    const updateUrl = new URL(update.url);
    expect(update.method).toBe('PATCH');
    expect(updateUrl.pathname).toBe('/upload/drive/v3/files/file-1');
    expect(updateUrl.searchParams.get('uploadType')).toBe('media');
    expect(updateUrl.searchParams.get('supportsAllDrives')).toBe('true');
    expect(update.headers.get('content-type')).toBe('application/octet-stream');
    expect(update.body).toEqual(new TextEncoder().encode('next'));

    const deletion = fake.requests[1]!;
    const deleteUrl = new URL(deletion.url);
    expect(deletion.method).toBe('DELETE');
    expect(deleteUrl.pathname).toBe('/drive/v3/files/file-1');
    expect(deleteUrl.searchParams.get('supportsAllDrives')).toBe('true');
  });

  it.each([
    [401, { error: { message: 'invalid credentials' } }, 'authentication_required', false],
    [403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } }, 'permission_denied', false],
    [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 'rate_limited', true],
    [429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'rate_limited', true],
    [404, { error: { errors: [{ reason: 'notFound' }] } }, 'not_found', false],
    [409, { error: { message: 'conflict' } }, 'conflict', false],
    [412, { error: { message: 'precondition' } }, 'conflict', false],
    [503, { error: { message: 'backend unavailable' } }, 'temporarily_unavailable', true],
  ] as const)(
    'normalizes HTTP %i into %s semantics',
    async (status, payload, code, retryable) => {
      const { transport } = makeTransport([jsonResponse(payload, status)]);

      await expect(transport.getStartPageToken()).rejects.toMatchObject({ code, retryable });
    },
  );

  it('fails closed when a successful JSON response is malformed', async () => {
    const { transport } = makeTransport([
      new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);

    await expect(transport.getStartPageToken()).rejects.toMatchObject({
      code: 'unknown_backend_error',
      retryable: false,
    });
  });
});
