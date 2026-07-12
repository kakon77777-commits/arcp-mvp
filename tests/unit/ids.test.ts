import { describe, expect, it } from 'vitest';
import {
  agentId,
  eventId,
  isValidArcpId,
  objectId,
  objectVersionId,
  residenceId,
  ulid,
} from '@arcp/schema';

describe('stable ID formats', () => {
  it('generates agent IDs matching arcp:agent:<namespace>:<uuid>', () => {
    const id = agentId('evemisslab');
    expect(id).toMatch(/^arcp:agent:evemisslab:[0-9a-f-]{36}$/);
    expect(isValidArcpId('agent', id)).toBe(true);
  });

  it('generates residence and object IDs', () => {
    expect(isValidArcpId('residence', residenceId())).toBe(true);
    expect(isValidArcpId('object', objectId())).toBe(true);
  });

  it('generates object-version IDs derived from the parent object ID', () => {
    const obj = objectId();
    const version = objectVersionId(obj, 3);
    expect(version).toBe(`arcp:object-version:${obj.split(':').pop()}:3`);
    expect(isValidArcpId('object-version', version)).toBe(true);
  });

  it('generates event IDs as ULIDs (26 Crockford base32 chars)', () => {
    const id = eventId();
    expect(isValidArcpId('event', id)).toBe(true);
  });

  it('ULIDs generated at increasing timestamps sort lexicographically', () => {
    const a = ulid(1_000_000);
    const b = ulid(1_000_001);
    expect(a < b).toBe(true);
  });

  it('rejects malformed IDs', () => {
    expect(isValidArcpId('agent', 'not-an-id')).toBe(false);
    expect(isValidArcpId('event', 'arcp:event:short')).toBe(false);
  });
});
