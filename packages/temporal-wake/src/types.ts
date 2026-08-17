import type { InstantRef } from '@arcp/schema';
import type { SharedInstantConstraint } from '@arcp/temporal-evidence';

export type TemporalWakeIntent =
  | {
      kind: 'registered-instant';
      instantId: string;
    }
  | {
      kind: 'local-datetime';
      localValue: string;
      timezone: string;
      foldResolution?: 'earlier' | 'later';
      label?: string;
    }
  | {
      kind: 'bounded-constraints';
      window: { from: number; to: number; stepS?: number };
      constraints: SharedInstantConstraint[];
      label?: string;
    };

export interface CompiledWakeTime {
  notBefore: InstantRef;
  planningEvidence?: unknown;
}

export interface ParsedLocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}
