import {
  ResidenceStorageError,
  diffResidenceSnapshots,
  emptyResidenceDiff,
  sha256Bytes,
  type ResidenceBlob,
  type ResidenceRemoveOptions,
  type ResidenceRemoveReceipt,
  type ResidenceStorageAdapter,
  type ResidenceStorageCapabilities,
  type ResidenceStorageReconciliation,
  type ResidenceStorageScope,
  type ResidenceStorageSnapshot,
  type ResidenceWriteOptions,
  type ResidenceWriteReceipt,
  type ResidenceWriteTarget,
} from '@arcp/residence-storage';
import {
  GOOGLE_DRIVE_FOLDER_MIME,
  googleDriveContentHash,
  googleDriveRef,
  googleDriveRevision,
  isGoogleNativeDocument,
  listGoogleDriveTree,
  type GoogleDriveTreeNode,
} from './tree.js';
import type { GoogleDriveFileRecord, GoogleDriveTransport } from './types.js';

export interface GoogleDriveApiAdapterOptions {
  transport: GoogleDriveTransport;
  rootId: string;
  driveId?: string;
  now?: () => Date;
}

function conflict(message: string): ResidenceStorageError {
  return new ResidenceStorageError('conflict', message, false);
}

function unsupported(message: string): ResidenceStorageError {
  return new ResidenceStorageError('unsupported_operation', message, false);
}

function normalizeRelativePath(path: string, allowEmpty = false): string {
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new ResidenceStorageError('invalid_path_or_ref', `invalid residence path: ${path}`, false);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    if (allowEmpty && path === '') return '';
    throw new ResidenceStorageError('invalid_path_or_ref', `invalid residence path: ${path}`, false);
  }
  if (!allowEmpty && path.length === 0) {
    throw new ResidenceStorageError('invalid_path_or_ref', 'residence path must not be empty', false);
  }
  return path;
}

function scopeEntries(nodes: GoogleDriveTreeNode[], scope?: ResidenceStorageScope) {
  if (scope === undefined) return nodes.map((node) => node.entry);
  const prefix = normalizeRelativePath(scope.prefix, true);
  if (prefix === '') return nodes.map((node) => node.entry);
  return nodes
    .filter((node) => node.path === prefix || node.path.startsWith(`${prefix}/`))
    .map((node) => node.entry);
}

function splitTarget(path: string): { parentPath: string; name: string } {
  const slash = path.lastIndexOf('/');
  return slash < 0
    ? { parentPath: '', name: path }
    : { parentPath: path.slice(0, slash), name: path.slice(slash + 1) };
}

function parseRef(ref: string): string {
  if (!ref.startsWith('gdrive:') || ref.length === 'gdrive:'.length) {
    throw new ResidenceStorageError('invalid_path_or_ref', `invalid Google Drive ref: ${ref}`, false);
  }
  return ref.slice('gdrive:'.length);
}

export class GoogleDriveApiAdapter implements ResidenceStorageAdapter {
  readonly backendKind = 'google-drive-api';

  private readonly transport: GoogleDriveTransport;
  private readonly rootId: string;
  private readonly driveId: string | undefined;
  private readonly now: () => Date;
  private cachedNodes: GoogleDriveTreeNode[] | null = null;

  constructor(options: GoogleDriveApiAdapterOptions) {
    if (options.rootId.length === 0) {
      throw new ResidenceStorageError('invalid_path_or_ref', 'Google Drive rootId must not be empty', false);
    }
    this.transport = options.transport;
    this.rootId = options.rootId;
    this.driveId = options.driveId;
    this.now = options.now ?? (() => new Date());
  }

  capabilities(): ResidenceStorageCapabilities {
    return {
      watchHints: false,
      changeCursor: true,
      stableObjectIds: true,
      providerReplicationConfirmation: true,
      sharedDrives: this.driveId !== undefined,
      nativeDocuments: false,
      remotePermissions: false,
    };
  }

  async snapshot(scope?: ResidenceStorageScope): Promise<ResidenceStorageSnapshot> {
    // Cursor first: a change racing with the following full tree enumeration may
    // be re-observed later, but it cannot disappear into a blind interval.
    const cursor = await this.transport.getStartPageToken(this.driveId);
    const nodes = await this.loadTree(true);
    return {
      backendKind: this.backendKind,
      observedAt: this.now().toISOString(),
      cursor,
      entries: scopeEntries(nodes, scope),
    };
  }

  async diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation> {
    if (previous.cursor === null) {
      const snapshot = await this.snapshot(scope);
      return { snapshot, diff: diffResidenceSnapshots(previous, snapshot) };
    }

    let pageToken = previous.cursor;
    let sawChange = false;
    let terminalCursor: string | null = null;

    while (true) {
      const page = await this.transport.listChanges(pageToken, this.driveId);
      if (page.changes.length > 0) sawChange = true;
      if (page.nextPageToken !== null) {
        pageToken = page.nextPageToken;
        continue;
      }
      terminalCursor = page.newStartPageToken;
      break;
    }

    if (terminalCursor === null) {
      throw new ResidenceStorageError(
        'unknown_backend_error',
        'Google Drive terminal change page did not provide newStartPageToken',
        false,
      );
    }

    if (!sawChange) {
      return {
        snapshot: {
          backendKind: this.backendKind,
          observedAt: this.now().toISOString(),
          cursor: terminalCursor,
          entries: [...previous.entries],
        },
        diff: emptyResidenceDiff(),
      };
    }

    const nodes = await this.loadTree(true);
    const snapshot: ResidenceStorageSnapshot = {
      backendKind: this.backendKind,
      observedAt: this.now().toISOString(),
      cursor: terminalCursor,
      entries: scopeEntries(nodes, scope),
    };
    return { snapshot, diff: diffResidenceSnapshots(previous, snapshot) };
  }

  async read(ref: string): Promise<ResidenceBlob | null> {
    const fileId = parseRef(ref);
    let node = this.findByRef(ref);
    if (node === undefined) {
      await this.loadTree(true);
      node = this.findByRef(ref);
    }
    if (node === undefined || node.record.id !== fileId) return null;
    if (node.record.mimeType === GOOGLE_DRIVE_FOLDER_MIME) return null;
    if (isGoogleNativeDocument(node.record)) {
      throw unsupported(`Google-native document byte read is not enabled: ${node.path}`);
    }

    const bytes = await this.transport.download(fileId);
    return {
      ref,
      path: node.path,
      bytes: Uint8Array.from(bytes),
      contentHash: await sha256Bytes(bytes),
      revision: googleDriveRevision(node.record),
    };
  }

  async write(
    target: ResidenceWriteTarget,
    bytes: Uint8Array,
    options: ResidenceWriteOptions = {},
  ): Promise<ResidenceWriteReceipt> {
    const path = normalizeRelativePath(target.path);
    const nodes = await this.loadTree(true);
    const existing = nodes.find((node) => node.path === path);

    if (options.ifAbsent && existing !== undefined) {
      throw conflict(`ifAbsent precondition failed for ${path}`);
    }
    if (existing?.record.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      throw unsupported(`cannot replace Google Drive directory with bytes: ${path}`);
    }
    if (existing !== undefined && isGoogleNativeDocument(existing.record)) {
      throw unsupported(`Google-native document byte write is not enabled: ${path}`);
    }

    if (options.ifRevision !== undefined) {
      if (existing === undefined || existing.entry.revision !== options.ifRevision) {
        throw conflict(`revision precondition failed for ${path}`);
      }
    }
    if (options.ifContentHash !== undefined) {
      if (existing === undefined || (await this.verifiedSha256(existing)) !== options.ifContentHash) {
        throw conflict(`content hash precondition failed for ${path}`);
      }
    }

    const intendedHash = await sha256Bytes(bytes);
    if (existing !== undefined && (await this.verifiedSha256(existing)) === intendedHash) {
      return {
        status: 'unchanged',
        ref: existing.entry.ref,
        path,
        contentHash: intendedHash,
        revision: existing.entry.revision,
        providerReplication: 'provider-confirmed',
      };
    }

    let record: GoogleDriveFileRecord;
    if (existing !== undefined) {
      record = await this.transport.updateFile(existing.record.id, bytes);
    } else {
      const { parentPath, name } = splitTarget(path);
      const parentId = this.resolveParentId(nodes, parentPath);
      record = await this.transport.createFile(parentId, name, bytes);
    }

    await this.verifyMutation(record, intendedHash);
    this.cachedNodes = null;
    return {
      status: 'written',
      ref: googleDriveRef(record.id),
      path,
      contentHash: intendedHash,
      revision: googleDriveRevision(record),
      providerReplication: 'provider-confirmed',
    };
  }

  async remove(
    target: ResidenceWriteTarget,
    options: ResidenceRemoveOptions = {},
  ): Promise<ResidenceRemoveReceipt> {
    const path = normalizeRelativePath(target.path);
    const nodes = await this.loadTree(true);
    const existing = nodes.find((node) => node.path === path);
    if (existing === undefined) {
      return {
        status: 'already_absent',
        ref: null,
        path,
        providerReplication: 'provider-confirmed',
      };
    }
    if (existing.record.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      throw unsupported(`recursive Google Drive directory removal is not enabled: ${path}`);
    }
    if (isGoogleNativeDocument(existing.record)) {
      throw unsupported(`Google-native document removal is not enabled in the byte-file MVP: ${path}`);
    }
    if (options.ifRevision !== undefined && existing.entry.revision !== options.ifRevision) {
      throw conflict(`revision precondition failed for ${path}`);
    }
    if (options.ifContentHash !== undefined && (await this.verifiedSha256(existing)) !== options.ifContentHash) {
      throw conflict(`content hash precondition failed for ${path}`);
    }

    await this.transport.deleteFile(existing.record.id);
    this.cachedNodes = null;
    return {
      status: 'removed',
      ref: existing.entry.ref,
      path,
      providerReplication: 'provider-confirmed',
    };
  }

  private async loadTree(force = false): Promise<GoogleDriveTreeNode[]> {
    if (!force && this.cachedNodes !== null) return this.cachedNodes;
    const nodes = await listGoogleDriveTree(this.transport, this.rootId, this.driveId);
    this.cachedNodes = nodes;
    return nodes;
  }

  private findByRef(ref: string): GoogleDriveTreeNode | undefined {
    return this.cachedNodes?.find((node) => node.entry.ref === ref);
  }

  private resolveParentId(nodes: GoogleDriveTreeNode[], parentPath: string): string {
    if (parentPath === '') return this.rootId;
    const parent = nodes.find((node) => node.path === parentPath);
    if (parent === undefined) {
      throw new ResidenceStorageError('not_found', `Google Drive parent path not found: ${parentPath}`, false);
    }
    if (parent.record.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new ResidenceStorageError('invalid_path_or_ref', `Google Drive parent is not a directory: ${parentPath}`, false);
    }
    return parent.record.id;
  }

  private async verifiedSha256(node: GoogleDriveTreeNode): Promise<string> {
    const providerHash = googleDriveContentHash(node.record);
    if (providerHash?.startsWith('sha256:')) return providerHash;
    const bytes = await this.transport.download(node.record.id);
    return sha256Bytes(bytes);
  }

  private async verifyMutation(record: GoogleDriveFileRecord, intendedHash: string): Promise<void> {
    const providerHash = googleDriveContentHash(record);
    let verified: string;
    if (providerHash?.startsWith('sha256:')) {
      verified = providerHash;
    } else {
      verified = await sha256Bytes(await this.transport.download(record.id));
    }
    if (verified !== intendedHash) {
      throw new ResidenceStorageError(
        'integrity_mismatch',
        `Google Drive post-write content hash mismatch for ${record.id}`,
        false,
      );
    }
  }
}
