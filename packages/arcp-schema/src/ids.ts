import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Stable ID formats per arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §5.1.
 * ULIDs give local sort convenience only — they never substitute for a CTCL instant
 * or a causal parent reference.
 */

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTimestamp(ms: number): string {
  let out = '';
  let remaining = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD_BASE32[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function encodeRandomness(): string {
  const bytes = randomBytes(10); // 80 bits
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 16; i++) {
    const chunk = bits.slice(i * 5, i * 5 + 5);
    out += CROCKFORD_BASE32[parseInt(chunk, 2)];
  }
  return out;
}

/** 26-char ULID: 10 chars ms-timestamp + 16 chars randomness, Crockford base32. */
export function ulid(now: number = Date.now()): string {
  return encodeTimestamp(now) + encodeRandomness();
}

export function agentId(namespace: string, uuid: string = randomUUID()): string {
  return `arcp:agent:${namespace}:${uuid}`;
}

export function residenceId(uuid: string = randomUUID()): string {
  return `arcp:residence:${uuid}`;
}

export function objectId(uuid: string = randomUUID()): string {
  return `arcp:object:${uuid}`;
}

export function objectVersionId(parentObjectId: string, version: number): string {
  const uuid = parentObjectId.split(':').pop();
  return `arcp:object-version:${uuid}:${version}`;
}

export function eventId(now?: number): string {
  return `arcp:event:${ulid(now)}`;
}

export function taskId(uuid: string = randomUUID()): string {
  return `arcp:task:${uuid}`;
}

export function commitmentId(uuid: string = randomUUID()): string {
  return `arcp:commitment:${uuid}`;
}

export function wakeId(uuid: string = randomUUID()): string {
  return `arcp:wake:${uuid}`;
}

export function leaseId(uuid: string = randomUUID()): string {
  return `arcp:lease:${uuid}`;
}

export function actionId(uuid: string = randomUUID()): string {
  return `arcp:action:${uuid}`;
}

export function approvalId(uuid: string = randomUUID()): string {
  return `arcp:approval:${uuid}`;
}

export function migrationId(uuid: string = randomUUID()): string {
  return `arcp:migration:${uuid}`;
}

export function auditId(uuid: string = randomUUID()): string {
  return `arcp:audit:${uuid}`;
}

const ID_PATTERNS = {
  agent: /^arcp:agent:[a-z0-9-]+:[0-9a-fA-F-]{36}$/,
  residence: /^arcp:residence:[0-9a-fA-F-]{36}$/,
  object: /^arcp:object:[0-9a-fA-F-]{36}$/,
  'object-version': /^arcp:object-version:[0-9a-fA-F-]{36}:\d+$/,
  event: /^arcp:event:[0-9A-Z]{26}$/,
  task: /^arcp:task:[0-9a-fA-F-]{36}$/,
  commitment: /^arcp:commitment:[0-9a-fA-F-]{36}$/,
  wake: /^arcp:wake:[0-9a-fA-F-]{36}$/,
  lease: /^arcp:lease:[0-9a-fA-F-]{36}$/,
  action: /^arcp:action:[0-9a-fA-F-]{36}$/,
  approval: /^arcp:approval:[0-9a-fA-F-]{36}$/,
  migration: /^arcp:migration:[0-9a-fA-F-]{36}$/,
  audit: /^arcp:audit:[0-9a-fA-F-]{36}$/,
} as const;

export type ArcpResourceKind = keyof typeof ID_PATTERNS;

export function isValidArcpId(kind: ArcpResourceKind, id: string): boolean {
  return ID_PATTERNS[kind].test(id);
}
