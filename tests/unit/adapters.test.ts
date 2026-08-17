import { describe, expect, it } from 'vitest';
import { FakeCtclAdapter } from '@arcp/adapter-ctcl';
import { FakeModelAdapter, ScriptExhaustedError } from '@arcp/adapter-model';

describe('FakeCtclAdapter', () => {
  it('returns monotonically increasing fake instants', () => {
    const ctcl = new FakeCtclAdapter();
    const a = ctcl.now();
    const b = ctcl.now();
    expect(a.instant_id).not.toBe(b.instant_id);
    expect(a.unverified).toBeUndefined();
  });

  it('degrades to an unverified local instant when unavailable, never forging a real one', () => {
    const ctcl = new FakeCtclAdapter();
    ctcl.setUnavailable(true);
    const instant = ctcl.now();
    expect(instant.unverified).toBe(true);
    expect(instant.instant_id.startsWith('ctcl:')).toBe(false);
  });
});

describe('FakeModelAdapter', () => {
  it('replays scripted turns in order', () => {
    const model = new FakeModelAdapter([{ actionIntents: [] }, { actionIntents: [] }]);
    expect(() => model.nextTurn()).not.toThrow();
    expect(() => model.nextTurn()).not.toThrow();
    expect(() => model.nextTurn()).toThrow(ScriptExhaustedError);
  });
});
