import { describe, expect, it } from 'vitest';
import { LeaseManager } from '@arcp/coordinator';

describe('primary lease / fencing token', () => {
  it('issues monotonically increasing fencing tokens', () => {
    const manager = new LeaseManager();
    const first = manager.acquire('agent-a', 'residence:write', 60_000, 1_000);
    const second = manager.acquire('agent-a', 'residence:write', 60_000, 2_000);
    expect(second.fencing_token).toBe(first.fencing_token + 1);
  });

  it('rejects a commit attempt carrying a stale (superseded) fencing token', () => {
    const manager = new LeaseManager();
    const staleLease = manager.acquire('run-1', 'residence:write', 60_000, 1_000);
    manager.acquire('run-2', 'residence:write', 60_000, 2_000); // supersedes run-1's lease

    expect(manager.isValidFencingToken(staleLease.fencing_token)).toBe(false);
    expect(manager.isValidFencingToken(manager.getCurrent()!.fencing_token)).toBe(true);
  });
});
