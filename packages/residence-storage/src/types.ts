export type ResidenceEntryKind = 'file' | 'directory';
export type ProviderReplicationStatus = 'unknown' | 'provider-confirmed';

export interface ResidenceStorageScope {
  prefix: string;
}

export interface ResidenceStorageEntry {
  ref: string;
  path: string;
  kind: ResidenceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  contentHash: string | null;
  revision: string | null;
}

export interface ResidenceStorageSnapshot {
  backendKind: string;
  observedAt: string;
  cursor: string | null;
  entries: ResidenceStorageEntry[];
}

export interface ResidenceStorageMove {
  before: ResidenceStorageEntry;
  after: ResidenceStorageEntry;
}

export interface ResidenceStorageChange {
  before: ResidenceStorageEntry;
  after: ResidenceStorageEntry;
}

export interface ResidenceStorageDiff {
  added: ResidenceStorageEntry[];
  changed: ResidenceStorageChange[];
  removed: ResidenceStorageEntry[];
  moved: ResidenceStorageMove[];
}

export interface ResidenceStorageReconciliation {
  snapshot: ResidenceStorageSnapshot;
  diff: ResidenceStorageDiff;
}

export interface ResidenceStorageCapabilities {
  watchHints: boolean;
  changeCursor: boolean;
  stableObjectIds: boolean;
  providerReplicationConfirmation: boolean;
  sharedDrives: boolean;
  nativeDocuments: boolean;
  remotePermissions: boolean;
}

export interface ResidenceBlob {
  ref: string;
  path: string;
  bytes: Uint8Array;
  contentHash: string;
  revision: string | null;
}

export interface ResidenceWriteTarget {
  path: string;
}

export interface ResidenceWriteOptions {
  ifAbsent?: boolean;
  ifContentHash?: string;
  ifRevision?: string;
}

export interface ResidenceWriteReceipt {
  status: 'written' | 'unchanged';
  ref: string;
  path: string;
  contentHash: string;
  revision: string | null;
  providerReplication: ProviderReplicationStatus;
}

export interface ResidenceRemoveOptions {
  ifContentHash?: string;
  ifRevision?: string;
}

export interface ResidenceRemoveReceipt {
  status: 'removed' | 'already_absent';
  ref: string | null;
  path: string;
  providerReplication: ProviderReplicationStatus;
}

export interface ResidenceStorageAdapter {
  readonly backendKind: string;
  snapshot(scope?: ResidenceStorageScope): Promise<ResidenceStorageSnapshot>;
  diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation>;
  read(ref: string): Promise<ResidenceBlob | null>;
  write(
    target: ResidenceWriteTarget,
    bytes: Uint8Array,
    options?: ResidenceWriteOptions,
  ): Promise<ResidenceWriteReceipt>;
  remove(
    target: ResidenceWriteTarget,
    options?: ResidenceRemoveOptions,
  ): Promise<ResidenceRemoveReceipt>;
  capabilities(): ResidenceStorageCapabilities;
}
