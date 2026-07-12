import type { Lease } from '@arcp/schema';

/**
 * Single-writer primary lease with a monotonically increasing fencing token,
 * per §2.2 (single write coordinator) and §6.1 (fencing token in run_context).
 * A stale token from a superseded lease must never be accepted at commit time.
 */
export class LeaseManager {
  private current: Lease | null = null;
  private tokenCounter = 0;

  acquire(holder: string, scope: string, ttlMs: number, now: number = Date.now()): Lease {
    this.tokenCounter += 1;
    this.current = {
      lease_id: `arcp:lease:${this.tokenCounter}`,
      holder,
      scope,
      valid_from: new Date(now).toISOString(),
      valid_until: new Date(now + ttlMs).toISOString(),
      fencing_token: this.tokenCounter,
    };
    return this.current;
  }

  getCurrent(): Lease | null {
    return this.current;
  }

  isValidFencingToken(token: number): boolean {
    return this.current !== null && this.current.fencing_token === token;
  }
}

export class StaleFencingTokenError extends Error {
  constructor(
    public readonly attemptedToken: number,
    public readonly currentToken: number | null,
  ) {
    super(`stale fencing token ${attemptedToken}: current lease token is ${currentToken ?? 'none'}`);
    this.name = 'StaleFencingTokenError';
  }
}
