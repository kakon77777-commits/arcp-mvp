import { diffResidenceSnapshots } from './diff.js';
import { ResidenceStorageError } from './errors.js';
import { sha256Bytes } from './hash.js';
import type {
  ResidenceBlob,
  ResidenceRemoveOptions,
  ResidenceRemoveReceipt,
  ResidenceStorageAdapter,
  ResidenceStorageCapabilities,
  ResidenceStorageEntry,
  ResidenceStorageReconciliation,
  ResidenceStorageScope,
  ResidenceStorageSnapshot,
  ResidenceWriteOptions,
  ResidenceWriteReceipt,
  ResidenceWriteTarget,
} from './types.js';

interface MemoryRecord {
  ref: string;
  bytes: Uint8Array;
  modifiedAt: string;
  revision: number;
}

function conflict(message: string): ResidenceStorageError {
  return new ResidenceStorageError('conflict', message, false);
}

function normalizeRelativePath(path: string, allowEmpty = false): string {
  const slashed = path.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw new ResidenceStorageError('invalid_path_or_ref', `path must be relative: ${path}`, false);
  }

  const parts: string[] = [];
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      throw new ResidenceStorageError('invalid_path_or_ref', `path escapes residence scope: ${path}`, false);
    }
    parts.push(part);
  }

  const normalized = parts.join('/');
  if (!allowEmpty && normalized.length === 0) {
    throw new ResidenceStorageError('invalid_path_or_ref', 'path must not be empty', false);
  }
  return normalized;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export class InMemoryResidenceStorageAdapter implements ResidenceStorageAdapter {
  readonly backendKind = 'memory';

  private readonly records = new Map<string, MemoryRecord>();
  private logicalClock = 0;

  capabilities(): ResidenceStorageCapabilities {
    return {
      watchHints: false,
      changeCursor: false,
      stableObjectIds: false,
      providerReplicationConfirmation: false,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    };
  }

  async snapshot(scope?: ResidenceStorageScope): Promise<ResidenceStorageSnapshot> {
    const prefix = scope ? normalizeRelativePath(scope.prefix, true) : '';
    const paths = [...this.records.keys()]
      .filter((path) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`))
      .sort();

    const entries = await Promise.all(paths.map((path) => this.entryFor(path, this.records.get(path)!)));
    return {
      backendKind: this.backendKind,
      observedAt: this.nextInstant(),
      cursor: null,
      entries,
    };
  }

  async diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation> {
    const current = await this.snapshot(scope);
    return { snapshot: current, diff: diffResidenceSnapshots(previous, current) };
  }

  async read(ref: string): Promise<ResidenceBlob | null> {
    const path = this.pathFromRef(ref);
    if (!path) return null;
    const record = this.records.get(path);
    if (!record || record.ref !== ref) return null;

    return {
      ref: record.ref,
      path,
      bytes: record.bytes.slice(),
      contentHash: await sha256Bytes(record.bytes),
      revision: String(record.revision),
    };
  }

  async write(
    target: ResidenceWriteTarget,
    bytes: Uint8Array,
    options: ResidenceWriteOptions = {},
  ): Promise<ResidenceWriteReceipt> {
    const path = normalizeRelativePath(target.path);
    const current = this.records.get(path);
    await this.assertWritePreconditions(path, current, options);

    const contentHash = await sha256Bytes(bytes);
    if (current && bytesEqual(current.bytes, bytes)) {
      return {
        status: 'unchanged',
        ref: current.ref,
        path,
        contentHash,
        revision: String(current.revision),
        providerReplication: 'unknown',
      };
    }

    const record: MemoryRecord = {
      ref: current?.ref ?? this.refFor(path),
      bytes: bytes.slice(),
      modifiedAt: this.nextInstant(),
      revision: (current?.revision ?? 0) + 1,
    };
    this.records.set(path, record);

    return {
      status: 'written',
      ref: record.ref,
      path,
      contentHash,
      revision: String(record.revision),
      providerReplication: 'unknown',
    };
  }

  async remove(
    target: ResidenceWriteTarget,
    options: ResidenceRemoveOptions = {},
  ): Promise<ResidenceRemoveReceipt> {
    const path = normalizeRelativePath(target.path);
    const current = this.records.get(path);
    if (!current) {
      return {
        status: 'already_absent',
        ref: null,
        path,
        providerReplication: 'unknown',
      };
    }

    if (options.ifContentHash !== undefined) {
      const currentHash = await sha256Bytes(current.bytes);
      if (currentHash !== options.ifContentHash) {
        throw conflict(`content hash precondition failed for ${path}`);
      }
    }
    if (options.ifRevision !== undefined && String(current.revision) !== options.ifRevision) {
      throw conflict(`revision precondition failed for ${path}`);
    }

    this.records.delete(path);
    return {
      status: 'removed',
      ref: current.ref,
      path,
      providerReplication: 'unknown',
    };
  }

  async applyExternalWrite(pathInput: string, bytes: Uint8Array): Promise<void> {
    const path = normalizeRelativePath(pathInput);
    const current = this.records.get(path);
    this.records.set(path, {
      ref: current?.ref ?? this.refFor(path),
      bytes: bytes.slice(),
      modifiedAt: this.nextInstant(),
      revision: (current?.revision ?? 0) + 1,
    });
  }

  private async assertWritePreconditions(
    path: string,
    current: MemoryRecord | undefined,
    options: ResidenceWriteOptions,
  ): Promise<void> {
    if (options.ifAbsent && current) {
      throw conflict(`ifAbsent precondition failed for ${path}`);
    }
    if (options.ifContentHash !== undefined) {
      if (!current || (await sha256Bytes(current.bytes)) !== options.ifContentHash) {
        throw conflict(`content hash precondition failed for ${path}`);
      }
    }
    if (options.ifRevision !== undefined) {
      if (!current || String(current.revision) !== options.ifRevision) {
        throw conflict(`revision precondition failed for ${path}`);
      }
    }
  }

  private async entryFor(path: string, record: MemoryRecord): Promise<ResidenceStorageEntry> {
    return {
      ref: record.ref,
      path,
      kind: 'file',
      size: record.bytes.byteLength,
      modifiedAt: record.modifiedAt,
      contentHash: await sha256Bytes(record.bytes),
      revision: String(record.revision),
    };
  }

  private refFor(path: string): string {
    return `memory:${encodeURIComponent(path)}`;
  }

  private pathFromRef(ref: string): string | null {
    if (!ref.startsWith('memory:')) return null;
    try {
      const path = normalizeRelativePath(decodeURIComponent(ref.slice('memory:'.length)));
      return this.refFor(path) === ref ? path : null;
    } catch {
      return null;
    }
  }

  private nextInstant(): string {
    this.logicalClock += 1;
    return new Date(this.logicalClock).toISOString();
  }
}
