import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GoogleDriveApiAdapter } from '@arcp/adapter-google-drive-api';
import { SyncedFilesystemAdapter } from '@arcp/adapter-synced-filesystem';
import {
  ResidenceStorageError,
  sha256Bytes,
  type ResidenceStorageCapabilities,
} from '@arcp/residence-storage';
import { InMemoryGoogleDriveTransport } from '../helpers/fake-google-drive-transport.js';

describe('@arcp/residence-storage public contract', () => {
  it('hashes bytes as sha256:<hex>', async () => {
    const digest = await sha256Bytes(new TextEncoder().encode('abc'));
    expect(digest).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('normalizes backend failures into an explicit retryable error', () => {
    const error = new ResidenceStorageError('temporarily_unavailable', 'backend unavailable', true);
    expect(error.code).toBe('temporarily_unavailable');
    expect(error.retryable).toBe(true);
  });

  it('keeps capability claims explicit', () => {
    const capabilities: ResidenceStorageCapabilities = {
      watchHints: false,
      changeCursor: false,
      stableObjectIds: false,
      providerReplicationConfirmation: false,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    };
    expect(capabilities.changeCursor).toBe(false);
  });

  it('constructs both final Phase 2 residence backends without live credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-final-backends-'));
    try {
      const filesystem = new SyncedFilesystemAdapter({ root });
      const drive = new GoogleDriveApiAdapter({
        transport: new InMemoryGoogleDriveTransport('root-id'),
        rootId: 'root-id',
      });

      expect(filesystem.backendKind).toBe('synced-filesystem');
      expect(drive.backendKind).toBe('google-drive-api');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
