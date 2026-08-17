import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NodeFsWatchHintSource,
  ResidenceReconciler,
  type ResidenceWatchHintSource,
} from '@arcp/adapter-synced-filesystem';
import {
  InMemoryResidenceStorageAdapter,
  type ResidenceStorageReconciliation,
  type ResidenceStorageScope,
  type ResidenceStorageSnapshot,
} from '@arcp/residence-storage';

class FakeHintSource implements ResidenceWatchHintSource {
  private onHint: (() => void) | undefined;

  async start(onHint: () => void, signal: AbortSignal): Promise<void> {
    this.onHint = onHint;
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  fire(): void {
    this.onHint?.();
  }
}

class FailingHintSource implements ResidenceWatchHintSource {
  async start(_onHint: () => void, _signal: AbortSignal): Promise<void> {
    throw new Error('watch unavailable');
  }
}

class CountingInMemoryAdapter extends InMemoryResidenceStorageAdapter {
  diffCalls = 0;

  override async diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation> {
    this.diffCalls += 1;
    return super.diff(previous, scope);
  }
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ResidenceReconciler', () => {
  it('finds a missed backend change even when no watcher hint fired', async () => {
    const adapter = new InMemoryResidenceStorageAdapter();
    const previous = await adapter.snapshot();
    await adapter.applyExternalWrite('missed.txt', bytes('evidence'));

    const reconciler = new ResidenceReconciler({
      adapter,
      intervalMs: 10_000,
      debounceMs: 50,
    });

    const result = await reconciler.reconcileOnce(previous);
    expect(result.diff.added.map((entry) => entry.path)).toEqual(['missed.txt']);
  });

  it('uses a watcher hint only to request a fast debounced reconciliation', async () => {
    vi.useFakeTimers();
    const adapter = new CountingInMemoryAdapter();
    const initial = await adapter.snapshot();
    const hints = new FakeHintSource();
    const controller = new AbortController();
    const observed: ResidenceStorageReconciliation[] = [];
    const reconciler = new ResidenceReconciler({
      adapter,
      hintSource: hints,
      intervalMs: 10_000,
      debounceMs: 50,
    });

    const running = reconciler.start(
      initial,
      async (result) => {
        observed.push(result);
      },
      controller.signal,
    );
    await flushMicrotasks();
    await adapter.applyExternalWrite('hinted.txt', bytes('hinted'));

    hints.fire();
    await vi.advanceTimersByTimeAsync(49);
    expect(adapter.diffCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.diffCalls).toBe(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.diff.added.map((entry) => entry.path)).toEqual(['hinted.txt']);

    controller.abort();
    await running;
  });

  it('collapses multiple hints in one debounce window into one scan', async () => {
    vi.useFakeTimers();
    const adapter = new CountingInMemoryAdapter();
    const initial = await adapter.snapshot();
    const hints = new FakeHintSource();
    const controller = new AbortController();
    const reconciler = new ResidenceReconciler({
      adapter,
      hintSource: hints,
      intervalMs: 10_000,
      debounceMs: 40,
    });

    const running = reconciler.start(initial, async () => {}, controller.signal);
    await flushMicrotasks();

    hints.fire();
    await vi.advanceTimersByTimeAsync(10);
    hints.fire();
    await vi.advanceTimersByTimeAsync(10);
    hints.fire();
    await vi.advanceTimersByTimeAsync(39);
    expect(adapter.diffCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.diffCalls).toBe(1);

    controller.abort();
    await running;
  });

  it('keeps periodic reconciliation alive when the hint source fails', async () => {
    vi.useFakeTimers();
    const adapter = new CountingInMemoryAdapter();
    const initial = await adapter.snapshot();
    const controller = new AbortController();
    const observed: ResidenceStorageReconciliation[] = [];
    const reconciler = new ResidenceReconciler({
      adapter,
      hintSource: new FailingHintSource(),
      intervalMs: 100,
      debounceMs: 20,
    });

    const running = reconciler.start(
      initial,
      async (result) => {
        observed.push(result);
      },
      controller.signal,
    );
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.diffCalls).toBe(1);
    expect(observed).toHaveLength(0);

    await adapter.applyExternalWrite('periodic.txt', bytes('periodic'));
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.diffCalls).toBe(2);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.diff.added.map((entry) => entry.path)).toEqual(['periodic.txt']);

    controller.abort();
    await running;
  });

  it('stops future periodic and debounced scans after abort', async () => {
    vi.useFakeTimers();
    const adapter = new CountingInMemoryAdapter();
    const initial = await adapter.snapshot();
    const hints = new FakeHintSource();
    const controller = new AbortController();
    const reconciler = new ResidenceReconciler({
      adapter,
      hintSource: hints,
      intervalMs: 100,
      debounceMs: 25,
    });

    const running = reconciler.start(initial, async () => {}, controller.signal);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.diffCalls).toBe(1);

    hints.fire();
    controller.abort();
    await running;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(adapter.diffCalls).toBe(1);
  });
});

describe('NodeFsWatchHintSource', () => {
  it('is constructible as the production watcher-hint implementation', () => {
    expect(new NodeFsWatchHintSource({ root: process.cwd() })).toBeInstanceOf(NodeFsWatchHintSource);
  });
});
