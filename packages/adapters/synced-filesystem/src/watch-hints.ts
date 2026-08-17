import { watch } from 'node:fs';

export interface ResidenceWatchHintSource {
  start(onHint: () => void, signal: AbortSignal): Promise<void>;
}

export interface NodeFsWatchHintSourceOptions {
  root: string;
}

export class NodeFsWatchHintSource implements ResidenceWatchHintSource {
  private readonly root: string;

  constructor(options: NodeFsWatchHintSourceOptions) {
    this.root = options.root;
  }

  async start(onHint: () => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    try {
      const watcher = watch(
        this.root,
        { recursive: true, signal },
        () => {
          if (!signal.aborted) onHint();
        },
      );

      // Watcher events are latency hints only. An asynchronous watcher failure
      // must not become a residence-storage failure because periodic scans are
      // the correctness path.
      watcher.on('error', () => {
        try {
          watcher.close();
        } catch {
          // Best-effort shutdown only.
        }
      });
    } catch {
      // Some filesystems/platforms cannot provide recursive fs.watch(). In
      // that case silently degrade to periodic reconciliation.
    }
  }
}
