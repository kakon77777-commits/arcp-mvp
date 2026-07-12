import { describe, expect, it } from 'vitest';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput } from '@arcp/schema';

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    actor: 'arcp:agent:evemisslab:test',
    intent: 'index.rebuild',
    target: 'arcp:object:test',
    sensitivity: 'P0',
    risk: 'R0',
    reversibility: 'reversible',
    requested_scopes: [],
    lease_fencing_token: 1,
    budget: { remaining: 10, unit: 'USD' },
    policy_version: 1,
    ...overrides,
  };
}

describe('policy engine risk matrix', () => {
  it('R0 read/hash/reindex -> allow-with-log', () => {
    expect(evaluate(input({ risk: 'R0' })).decision).toBe('allow-with-log');
  });

  it('R1 internal draft write -> allow-with-log', () => {
    expect(evaluate(input({ risk: 'R1', intent: 'draft.write' })).decision).toBe('allow-with-log');
  });

  it('R2 with remaining budget -> allow-with-log', () => {
    const result = evaluate(input({ risk: 'R2', intent: 'drive.file.write', sensitivity: 'P1' }));
    expect(result.decision).toBe('allow-with-log');
  });

  it('R2 with exhausted budget -> request-approval', () => {
    const result = evaluate(
      input({ risk: 'R2', intent: 'drive.file.write', sensitivity: 'P1', budget: { remaining: 0, unit: 'USD' } }),
    );
    expect(result.decision).toBe('request-approval');
  });

  it('R3 publish/delete-canonical -> request-approval by default', () => {
    expect(evaluate(input({ risk: 'R3', intent: 'canonical.delete' })).decision).toBe('request-approval');
  });

  it('R3 with a valid existing approval -> allow-with-log', () => {
    const result = evaluate(input({ risk: 'R3', intent: 'canonical.delete' }), { hasValidApproval: true });
    expect(result.decision).toBe('allow-with-log');
  });

  it('R4 primary cutover / identity-root ops -> require-multi-party', () => {
    expect(evaluate(input({ risk: 'R4', intent: 'lease.cutover' })).decision).toBe('require-multi-party');
  });

  it('R4 with multi-party approval already granted -> allow-with-log', () => {
    const result = evaluate(input({ risk: 'R4', intent: 'lease.cutover' }), { hasValidApproval: true });
    expect(result.decision).toBe('allow-with-log');
  });

  it('P2 export without approval -> deny', () => {
    const result = evaluate(input({ risk: 'R2', sensitivity: 'P2', intent: 'residence.export' }));
    expect(result.decision).toBe('deny');
  });

  it('P3 export without approval -> deny, even at low risk', () => {
    const result = evaluate(input({ risk: 'R0', sensitivity: 'P3', intent: 'residence.export' }));
    expect(result.decision).toBe('deny');
  });

  it('P2 export with a valid approval -> allow-with-log', () => {
    const result = evaluate(
      input({ risk: 'R2', sensitivity: 'P2', intent: 'residence.export' }),
      { hasValidApproval: true },
    );
    expect(result.decision).toBe('allow-with-log');
  });

  it('missing/invalid lease fencing token -> deny regardless of risk', () => {
    const result = evaluate(input({ risk: 'R0', lease_fencing_token: 0 }));
    expect(result.decision).toBe('deny');
  });

  it('is deterministic: identical input always yields identical output', () => {
    const a = evaluate(input({ risk: 'R2', intent: 'drive.file.write' }));
    const b = evaluate(input({ risk: 'R2', intent: 'drive.file.write' }));
    expect(a).toEqual(b);
  });
});
