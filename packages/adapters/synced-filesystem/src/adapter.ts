import { lstatSync, realpathSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ResidenceStorageError,
  diffResidenceSnapshots,
  sha256Bytes,
  type ResidenceBlob,
  type ResidenceStorageCapabilities,
  type ResidenceStorageReconciliation,
  type ResidenceStorageScope,
  type ResidenceStorageSnapshot,
} from '@arcp/residence-storage';
import { assertResidenceRelativePath, resolveResidencePath } from './path-guard.js';
import { filesystemRef, filesystemRevision, scanResidenceRoot } from './scan.js';

export interface SyncedFilesystemAdapterOptions {
  root: string;
  now?: () => Date;
}

function invalidPath(message: string, cause?: unknown): ResidenceStorageError {
  return new ResidenceStorageError(
    'invalid_path_or_ref',
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function parseFilesystemRef(ref: string): string {
  if (!ref.startsWith('fs:')) {
    throw invalidPath('synced filesystem reads require an fs: reference');
  }

  const encodedPath = ref.slice(3);
  if (encodedPath.length === 0) {
    throw invalidPath('filesystem reference must include a relative path');
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(encodedPath);
  } catch (error) {
    throw invalidPath('filesystem reference contains invalid percent encoding', error);
  }

  assertResidenceRelativePath(relativePath);
  if (filesystemRef(relativePath) !== ref) {
    throw invalidPath('filesystem reference is not in canonical encoded form');
  }

  return relativePath;
}

export class SyncedFilesystemAdapter {
  readonly backendKind = 'synced-filesystem';
  private readonly rootRealPath: string;
  private readonly now: () => Date;

  constructor(options: SyncedFilesystemAdapterOptions) {
    this.now = options.now ?? (() => new Date());

    try {
      const rootRealPath = realpathSync(resolve(options.root));
      const stats = lstatSync(rootRealPath);
      if (!stats.isDirectory()) {
        throw invalidPath('synced filesystem root must be a directory');
      }
      this.rootRealPath = rootRealPath;
    } catch (error) {
      if (error instanceof ResidenceStorageError) throw error;
      throw invalidPath('synced filesystem root must exist and be a directory', error);
    }
  }

  async snapshot(scope?: ResidenceStorageScope): Promise<ResidenceStorageSnapshot> {
    return {
      backendKind: this.backendKind,
      observedAt: this.now().toISOString(),
      cursor: null,
      entries: await scanResidenceRoot(this.rootRealPath, scope?.prefix),
    };
  }

  async diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation> {
    const snapshot = await this.snapshot(scope);
    return {
      snapshot,
      diff: diffResidenceSnapshots(previous, snapshot),
    };
  }

  async read(ref: string): Promise<ResidenceBlob | null> {
    const relativePath = parseFilesystemRef(ref);
    const absolutePath = await resolveResidencePath(this.rootRealPath, relativePath);

    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw invalidPath(`unable to inspect filesystem reference: ${relativePath}`, error);
    }

    if (stats.isSymbolicLink()) {
      throw invalidPath(`symbolic links and junctions are not allowed in residence reads: ${relativePath}`);
    }
    if (!stats.isFile()) return null;

    const bytes = await readFile(absolutePath);
    return {
      ref,
      path: relativePath,
      bytes: Uint8Array.from(bytes),
      contentHash: await sha256Bytes(bytes),
      revision: filesystemRevision(stats),
    };
  }

  capabilities(): ResidenceStorageCapabilities {
    return {
      watchHints: true,
      changeCursor: false,
      stableObjectIds: false,
      providerReplicationConfirmation: false,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    };
  }
}
