import { watch, type FSWatcher } from 'node:fs';

export interface ResidenceWatchHintSource {
  start(onHint: () => void, signal: AbortSignal): Promise<void>;
}

export interface NodeFsWatchHintSourceOptions {
  root: string;
}

export class NodeFsWatchHintSource implements ResidenceWatchHintSource {
  private readonly root: string;
  private watcher: FSWatcher | undefined;

  constructor(options: NodeFsWatchHintSourceOptions) {
    this.root = options.root;
  }

  async start(onHint: () => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    try {
      this.watcher = watch(
        this.root,
        { recursive: true, signal },
        () => {
          if (!signal.aborted) onHint();
        },
      );

      // Watcher events are latency hints only. An asynchronous watcher failure
      // must not become a residence-storage failure because periodic scans are
      // the correctness path.
      this.watcher.on('error', () => {
        try {
          this.watcher?.close();
        } catch {
          // Best-effort shutdown only.
        } finally {
          this.watcher = undefined;
        }
      });
      this.watcher.on('close', () => {
        this.watcher = undefined;
      });
    } catch {
      this.watcher = undefined;
      // Some filesystems/platforms cannot provide recursive fs.watch(). In
      // that case silently degrade to periodic reconciliation.
    }
  }
}
