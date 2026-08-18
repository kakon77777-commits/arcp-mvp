import { describe, expect, it } from 'vitest';
import { CtclRestTemporalAdapter } from '@arcp/adapter-ctcl';
import type { EventEnvelope } from '@arcp/schema';
import { createFakeCtclService } from '../helpers/fake-ctcl-service.js';

describe('Phase 3 shared-instant handoff', () => {
  it('preserves one registered Common Instant across independent clients and JSON handoff', async () => {
    const service = createFakeCtclService();
    const clientA = new CtclRestTemporalAdapter({ fetch: service.fetch });
    const clientB = new CtclRestTemporalAdapter({ fetch: service.fetch });

    const created = await clientA.registerInstant({
      value: '1786978800.123',
      encoding: 'unix_s',
      timescale: 'posix',
      label: 'agent-handoff',
    });
    const retrieved = await clientB.getInstant(created.instant.instant_id);

    expect(service.registeredIds()).toEqual([created.instant.instant_id]);
    expect(retrieved.instant.instant_id).toBe(created.instant.instant_id);
    expect(retrieved.canonicalUnixNs).toBe(created.canonicalUnixNs);
    expect(retrieved.instant.value).toBe(created.instant.value);

    const event: EventEnvelope = {
      schema: 'arcp/event/0.1',
      event_id: 'arcp:event:phase3-handoff-1',
      agent_id: 'arcp:agent:phase3-handoff',
      event_type: 'agent.handoff.temporal-anchor',
      causal_parent: null,
      producer: 'phase3-shared-instant-test',
      idempotency_key: 'phase3:handoff:1',
      payload_hash: 'sha256:fixture',
      observed_at: created.instant,
      received_local_time: '2026-08-18T03:00:00.000Z',
    };

    const parsed = JSON.parse(JSON.stringify(event)) as EventEnvelope;
    expect(parsed.observed_at).toEqual(created.instant);

    const resolvedAfterHandoff = await clientB.getInstant(parsed.observed_at.instant_id);
    expect(resolvedAfterHandoff.instant.instant_id).toBe(created.instant.instant_id);
    expect(resolvedAfterHandoff.canonicalUnixNs).toBe(created.canonicalUnixNs);
  });

  it('keeps independently constructed clients isolated except for the shared fake registry', async () => {
    const service = createFakeCtclService({ nowUnixNs: '1786980000123000000' });
    const clientA = new CtclRestTemporalAdapter({ fetch: service.fetch });
    const clientB = new CtclRestTemporalAdapter({ fetch: service.fetch });

    const first = await clientA.registerInstant({ label: 'first' });
    const second = await clientB.registerInstant({ label: 'second' });

    expect(first.instant.instant_id).not.toBe(second.instant.instant_id);
    expect(service.registeredIds()).toEqual([
      first.instant.instant_id,
      second.instant.instant_id,
    ]);
    await expect(clientA.getInstant(second.instant.instant_id)).resolves.toMatchObject({
      canonicalUnixNs: second.canonicalUnixNs,
    });
  });
});
