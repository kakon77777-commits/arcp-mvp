import type { InstantRef } from '@arcp/schema';

/**
 * Fake CTCL adapter for Phase 0 (§8, §2.6). Real adapter talks to
 * commoninstant.org's /v1/now; this one returns deterministic, monotonically
 * increasing fake instants so tests never depend on wall-clock time. A real
 * CTCL outage is modelled by `unavailable()`, per the degrade-don't-forge rule:
 * low-risk events get `unverified: true` local time, high-risk callers must
 * check `available` themselves before proceeding.
 */
export class FakeCtclAdapter {
  private counter = 0;
  private available = true;

  now(): InstantRef {
    if (!this.available) {
      return {
        instant_id: `local:unverified:${Date.now()}`,
        unverified: true,
      };
    }
    this.counter += 1;
    return {
      instant_id: `ctcl:instant:fake-${String(this.counter).padStart(6, '0')}`,
      timescale: 'utc',
      encoding: 'unix_ms',
      source_quality: {
        source_class: 'fake_test_clock',
        precision: 'millisecond',
        estimated_uncertainty_ns: 0,
      },
    };
  }

  setUnavailable(unavailable: boolean): void {
    this.available = !unavailable;
  }

  reset(): void {
    this.counter = 0;
    this.available = true;
  }
}
