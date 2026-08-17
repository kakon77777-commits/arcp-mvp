import type {
  ResidenceStorageAdapter,
  ResidenceStorageReconciliation,
  ResidenceStorageSnapshot,
} from '@arcp/residence-storage';
import type { ResidenceWatchHintSource } from './watch-hints.js';

export interface ResidenceReconcilerOptions {
  adapter: ResidenceStorageAdapter;
  hintSource?: ResidenceWatchHintSource;
  intervalMs: number;
  debounceMs: number;
}

function hasChanges(result: ResidenceStorageReconciliation): boolean {
  const { diff } = result;
  return (
    diff.added.length > 0 ||
    diff.changed.length > 0 ||
    diff.removed.length > 0 ||
    diff.moved.length > 0
  );
}

export class ResidenceReconciler {
  private readonly adapter: ResidenceStorageAdapter;
  private readonly hintSource: ResidenceWatchHintSource | undefined;
  private readonly intervalMs: number;
  private readonly debounceMs: number;

  constructor(options: ResidenceReconcilerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new RangeError('ResidenceReconciler intervalMs must be greater than zero');
    }
    if (!Number.isFinite(options.debounceMs) || options.debounceMs < 0) {
      throw new RangeError('ResidenceReconciler debounceMs must be zero or greater');
    }

    this.adapter = options.adapter;
    this.hintSource = options.hintSource;
    this.intervalMs = options.intervalMs;
    this.debounceMs = options.debounceMs;
  }

  async reconcileOnce(
    previous: ResidenceStorageSnapshot,
  ): Promise<ResidenceStorageReconciliation> {
    return this.adapter.diff(previous);
  }

  async start(
    initial: ResidenceStorageSnapshot,
    onReconciliation: (result: ResidenceStorageReconciliation) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;

    let baseline = initial;
    let intervalTimer: ReturnType<typeof setInterval> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let scanQueue: Promise<void> = Promise.resolve();
    let fatalSignaled = false;

    const hintController = new AbortController();

    const clearTimers = (): void => {
      if (intervalTimer !== undefined) {
        clearInterval(intervalTimer);
        intervalTimer = undefined;
      }
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    };

    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });

    let rejectFatal!: (error: unknown) => void;
    const fatal = new Promise<never>((_resolve, reject) => {
      rejectFatal = reject;
    });

    const onAbort = (): void => {
      clearTimers();
      hintController.abort();
      resolveAbort();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const runScan = async (): Promise<void> => {
      if (signal.aborted || fatalSignaled) return;

      const result = await this.reconcileOnce(baseline);
      // A successful scan always advances the baseline, even when there is
      // nothing to emit.
      baseline = result.snapshot;

      if (hasChanges(result)) {
        await onReconciliation(result);
      }
    };

    const enqueueScan = (): void => {
      if (signal.aborted || fatalSignaled) return;

      const run = scanQueue.then(runScan);
      scanQueue = run.catch((error: unknown) => {
        if (!fatalSignaled) {
          fatalSignaled = true;
          clearTimers();
          hintController.abort();
          rejectFatal(error);
        }
      });
    };

    const onHint = (): void => {
      if (signal.aborted || fatalSignaled) return;

      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        enqueueScan();
      }, this.debounceMs);
    };

    // Periodic reconciliation is installed before watcher startup so a broken
    // or unsupported watcher can never disable the correctness path.
    intervalTimer = setInterval(enqueueScan, this.intervalMs);

    let hintStart: Promise<void> | undefined;
    if (this.hintSource !== undefined) {
      try {
        hintStart = Promise.resolve(this.hintSource.start(onHint, hintController.signal));
        // Watcher startup/lifetime failure is explicitly non-fatal.
        void hintStart.catch(() => {});
      } catch {
        // Synchronous watcher startup failure also degrades to periodic scans.
      }
    }

    try {
      await Promise.race([aborted, fatal]);
    } finally {
      clearTimers();
      hintController.abort();
      signal.removeEventListener('abort', onAbort);
      await scanQueue;
      if (hintStart !== undefined) await hintStart.catch(() => {});
    }
  }
}
