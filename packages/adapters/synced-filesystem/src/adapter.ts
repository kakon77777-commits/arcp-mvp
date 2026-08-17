import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ResidenceStorageError,
  diffResidenceSnapshots,
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
import { assertResidenceRelativePath, resolveResidencePath } from './path-guard.js';
import { filesystemRef, scanResidenceRoot } from './scan.js';

export interface SyncedFilesystemAdapterOptions {
  root: string;
  now?: () => Date;
  afterWriteBeforeVerify?: (absolutePath: string) => Promise<void>;
}

interface InspectedTarget {
  absolutePath: string;
  kind: 'file' | 'directory';
  contentHash: string | null;
}

function storageError(
  code: ConstructorParameters<typeof ResidenceStorageError>[0],
  message: string,
  retryable = false,
  cause?: unknown,
): ResidenceStorageError {
  return new ResidenceStorageError(
    code,
    message,
    retryable,
    cause === undefined ? undefined : { cause },
  );
}

function invalidPath(message: string, cause?: unknown): ResidenceStorageError {
  return storageError('invalid_path_or_ref', message, false, cause);
}

function conflict(message: string): ResidenceStorageError {
  return storageError('conflict', message);
}

function unsupported(message: string): ResidenceStorageError {
  return storageError('unsupported_operation', message);
}

function integrityMismatch(message: string, cause?: unknown): ResidenceStorageError {
  return storageError('integrity_mismatch', message, false, cause);
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

export class SyncedFilesystemAdapter implements ResidenceStorageAdapter {
  readonly backendKind = 'synced-filesystem';
  private readonly rootRealPath: string;
  private readonly now: () => Date;
  private readonly afterWriteBeforeVerify?: (absolutePath: string) => Promise<void>;

  constructor(options: SyncedFilesystemAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.afterWriteBeforeVerify = options.afterWriteBeforeVerify;

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
      revision: null,
    };
  }

  async write(
    target: ResidenceWriteTarget,
    bytes: Uint8Array,
    options: ResidenceWriteOptions = {},
  ): Promise<ResidenceWriteReceipt> {
    assertResidenceRelativePath(target.path);
    if (options.ifRevision !== undefined) {
      throw unsupported('synced filesystem does not support revision preconditions');
    }

    const desiredHash = await sha256Bytes(bytes);
    const current = await this.inspectTarget(target.path);

    if (options.ifAbsent && current !== null) {
      throw conflict(`residence target already exists: ${target.path}`);
    }
    if (options.ifContentHash !== undefined) {
      if (current === null || current.kind !== 'file' || current.contentHash !== options.ifContentHash) {
        throw conflict(`residence content hash precondition failed: ${target.path}`);
      }
    }
    if (current?.kind === 'directory') {
      throw unsupported(`cannot replace a residence directory with file content: ${target.path}`);
    }

    if (current?.contentHash === desiredHash) {
      return {
        status: 'unchanged',
        ref: filesystemRef(target.path),
        path: target.path,
        contentHash: desiredHash,
        revision: null,
        providerReplication: 'unknown',
      };
    }

    const absolutePath = await this.ensureWriteTarget(target.path);
    const temporaryPath = join(
      dirname(absolutePath),
      `.${basename(absolutePath)}.arcp-tmp-${randomUUID()}`,
    );
    let temporaryExists = false;

    try {
      await writeFile(temporaryPath, bytes, { flag: 'wx' });
      temporaryExists = true;
      await rename(temporaryPath, absolutePath);
      temporaryExists = false;

      await this.afterWriteBeforeVerify?.(absolutePath);

      let verified: ResidenceBlob | null;
      try {
        verified = await this.read(filesystemRef(target.path));
      } catch (error) {
        throw integrityMismatch(`unable to verify residence write: ${target.path}`, error);
      }
      if (verified === null || verified.contentHash !== desiredHash) {
        throw integrityMismatch(`post-write content hash mismatch: ${target.path}`);
      }

      return {
        status: 'written',
        ref: filesystemRef(target.path),
        path: target.path,
        contentHash: verified.contentHash,
        revision: null,
        providerReplication: 'unknown',
      };
    } finally {
      if (temporaryExists) {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
  }

  async remove(
    target: ResidenceWriteTarget,
    options: ResidenceRemoveOptions = {},
  ): Promise<ResidenceRemoveReceipt> {
    assertResidenceRelativePath(target.path);
    if (options.ifRevision !== undefined) {
      throw unsupported('synced filesystem does not support revision preconditions');
    }

    const current = await this.inspectTarget(target.path);
    if (current === null) {
      if (options.ifContentHash !== undefined) {
        throw conflict(`residence content hash precondition failed because target is absent: ${target.path}`);
      }
      return {
        status: 'already_absent',
        ref: null,
        path: target.path,
        providerReplication: 'unknown',
      };
    }
    if (current.kind === 'directory') {
      throw unsupported(`recursive residence directory removal is not supported: ${target.path}`);
    }
    if (options.ifContentHash !== undefined && current.contentHash !== options.ifContentHash) {
      throw conflict(`residence content hash precondition failed: ${target.path}`);
    }

    const absolutePath = await resolveResidencePath(this.rootRealPath, target.path);
    try {
      await unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.ifContentHash === undefined) {
        return {
          status: 'already_absent',
          ref: null,
          path: target.path,
          providerReplication: 'unknown',
        };
      }
      throw error;
    }

    return {
      status: 'removed',
      ref: filesystemRef(target.path),
      path: target.path,
      providerReplication: 'unknown',
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

  private async inspectTarget(relativePath: string): Promise<InspectedTarget | null> {
    assertResidenceRelativePath(relativePath);

    const segments = relativePath.split('/');
    let current = this.rootRealPath;

    for (let index = 0; index < segments.length; index += 1) {
      const candidate = join(current, segments[index]!);
      let stats;
      try {
        stats = await lstat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw invalidPath(`unable to inspect residence target: ${relativePath}`, error);
      }

      if (stats.isSymbolicLink()) {
        throw invalidPath(`symbolic links and junctions are not allowed in residence targets: ${relativePath}`);
      }
      if (index < segments.length - 1) {
        if (!stats.isDirectory()) {
          throw invalidPath(`non-directory component in residence target: ${relativePath}`);
        }
        current = await resolveResidencePath(this.rootRealPath, segments.slice(0, index + 1).join('/'));
        continue;
      }

      const absolutePath = await resolveResidencePath(this.rootRealPath, relativePath);
      if (stats.isDirectory()) {
        return { absolutePath, kind: 'directory', contentHash: null };
      }
      if (!stats.isFile()) {
        throw unsupported(`unsupported filesystem entry at residence target: ${relativePath}`);
      }
      const contentHash = await sha256Bytes(await readFile(absolutePath));
      return { absolutePath, kind: 'file', contentHash };
    }

    return null;
  }

  private async ensureWriteTarget(relativePath: string): Promise<string> {
    assertResidenceRelativePath(relativePath);
    const segments = relativePath.split('/');

    for (let index = 0; index < segments.length - 1; index += 1) {
      const parentRelativePath = segments.slice(0, index + 1).join('/');
      const candidate = await resolveResidencePath(this.rootRealPath, parentRelativePath);

      try {
        const stats = await lstat(candidate);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw invalidPath(`write parent is not a safe directory: ${parentRelativePath}`);
        }
      } catch (error) {
        if (error instanceof ResidenceStorageError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw invalidPath(`unable to inspect write parent: ${parentRelativePath}`, error);
        }
        try {
          await mkdir(candidate);
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw invalidPath(`unable to create write parent: ${parentRelativePath}`, mkdirError);
          }
        }

        const verifiedParent = await resolveResidencePath(this.rootRealPath, parentRelativePath);
        const verifiedStats = await lstat(verifiedParent);
        if (verifiedStats.isSymbolicLink() || !verifiedStats.isDirectory()) {
          throw invalidPath(`created write parent is not a safe directory: ${parentRelativePath}`);
        }
      }
    }

    return resolveResidencePath(this.rootRealPath, relativePath);
  }
}
