import { describe, expect, it } from 'vitest';
import {
  ResidenceBridge,
  type ResidenceObservation,
  type ResidenceObservationSink,
} from '@arcp/residence-bridge';
import { InMemoryResidenceStorageAdapter } from '@arcp/residence-storage';

class CollectingSink implements ResidenceObservationSink {
  readonly observations: ResidenceObservation[] = [];

  async publish(observation: ResidenceObservation): Promise<void> {
    this.observations.push(observation);
  }
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('ResidenceBridge', () => {
  it('publishes nothing for an unchanged reconciliation and returns the new baseline', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    const sink = new CollectingSink();
    const bridge = new ResidenceBridge({ residenceId: 'residence:test', adapter, sink });
    const previous = await adapter.snapshot();

    const next = await bridge.reconcile(previous);

    expect(sink.observations).toEqual([]);
    expect(next).not.toBe(previous);
    expect(next.backendKind).toBe('memory');
    expect(next.entries).toEqual(previous.entries);
  });

  it('publishes one observation for a backend-side write', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    const sink = new CollectingSink();
    const bridge = new ResidenceBridge({ residenceId: 'residence:test', adapter, sink });
    const previous = await adapter.snapshot();
    await adapter.applyExternalWrite('notes/new.txt', bytes('evidence'));

    const next = await bridge.reconcile(previous);

    expect(sink.observations).toHaveLength(1);
    expect(sink.observations[0]).toMatchObject({
      residenceId: 'residence:test',
      backendKind: 'memory',
      observedAt: next.observedAt,
    });
    expect(sink.observations[0]!.reconciliation.snapshot).toEqual(next);
    expect(sink.observations[0]!.reconciliation.diff.added.map((entry) => entry.path)).toEqual([
      'notes/new.txt',
    ]);
  });

  it('publishes backend removal as observation evidence and does not imply canonical erasure', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    await adapter.write({ path: 'paper.md' }, bytes('draft'));
    const previous = await adapter.snapshot();
    const sink = new CollectingSink();
    const bridge = new ResidenceBridge({ residenceId: 'residence:test', adapter, sink });

    await adapter.remove({ path: 'paper.md' });
    const next = await bridge.reconcile(previous);

    expect(sink.observations).toHaveLength(1);
    expect(sink.observations[0]!.reconciliation.diff.removed.map((entry) => entry.path)).toEqual([
      'paper.md',
    ]);
    expect(next.entries).toEqual([]);
    expect(Object.keys(sink.observations[0]!)).toEqual([
      'residenceId',
      'backendKind',
      'observedAt',
      'reconciliation',
    ]);
  });

  it('returns each successful reconciliation snapshot as the next caller-owned baseline', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    const sink = new CollectingSink();
    const bridge = new ResidenceBridge({ residenceId: 'residence:test', adapter, sink });
    const first = await adapter.snapshot();

    await adapter.applyExternalWrite('one.txt', bytes('one'));
    const second = await bridge.reconcile(first);
    await adapter.applyExternalWrite('two.txt', bytes('two'));
    const third = await bridge.reconcile(second);

    expect(sink.observations).toHaveLength(2);
    expect(sink.observations[0]!.reconciliation.snapshot).toEqual(second);
    expect(sink.observations[1]!.reconciliation.snapshot).toEqual(third);
    expect(sink.observations[1]!.reconciliation.diff.added.map((entry) => entry.path)).toEqual([
      'two.txt',
    ]);
  });
});
