import type {
  ResidenceStorageAdapter,
  ResidenceStorageReconciliation,
  ResidenceStorageSnapshot,
} from '@arcp/residence-storage';

export interface ResidenceObservation {
  residenceId: string;
  backendKind: string;
  observedAt: string;
  reconciliation: ResidenceStorageReconciliation;
}

export interface ResidenceObservationSink {
  publish(observation: ResidenceObservation): Promise<void>;
}

export interface ResidenceBridgeOptions {
  residenceId: string;
  adapter: ResidenceStorageAdapter;
  sink: ResidenceObservationSink;
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

export class ResidenceBridge {
  private readonly residenceId: string;
  private readonly adapter: ResidenceStorageAdapter;
  private readonly sink: ResidenceObservationSink;

  constructor(options: ResidenceBridgeOptions) {
    this.residenceId = options.residenceId;
    this.adapter = options.adapter;
    this.sink = options.sink;
  }

  async reconcile(previous: ResidenceStorageSnapshot): Promise<ResidenceStorageSnapshot> {
    const result = await this.adapter.diff(previous);

    if (hasChanges(result)) {
      await this.sink.publish({
        residenceId: this.residenceId,
        backendKind: result.snapshot.backendKind,
        observedAt: result.snapshot.observedAt,
        reconciliation: result,
      });
    }

    return result.snapshot;
  }
}
