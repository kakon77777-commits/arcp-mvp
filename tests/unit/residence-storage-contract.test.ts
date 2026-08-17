import { describe, expect, it } from 'vitest';
import {
  ResidenceStorageError,
  sha256Bytes,
  type ResidenceStorageCapabilities,
} from '@arcp/residence-storage';

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
});
