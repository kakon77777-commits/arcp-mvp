import type { InstantRef } from '@arcp/schema';
import type { MonotonicClockPort, ProvenanceClockPort } from '@arcp/workflow-core';

export class FakeMonotonicClock implements MonotonicClockPort {
  constructor(private value = 0) {}

  nowMs(): number {
    return this.value;
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }

  set(milliseconds: number): void {
    this.value = milliseconds;
  }
}

export function fixedProvenanceClock(value: InstantRef): ProvenanceClockPort {
  return { now: () => structuredClone(value) };
}
