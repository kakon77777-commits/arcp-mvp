import type { PolicyDecision, ResidenceManifest, WakeRecord } from '@arcp/schema';
import type {
  AgentStatusSnapshot,
  CoordinatorControlPort,
  WakeAcceptance,
} from './contracts.js';

export interface CoordinatorFetchTransport {
  fetch(request: Request): Promise<Response>;
}

export interface CoordinatorClientOptions {
  transport: CoordinatorFetchTransport;
  baseUrl?: string;
  nextRequestId: () => string;
}

export class CoordinatorProtocolError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'CoordinatorProtocolError';
  }
}

interface CoordinatorEnvelope {
  request_id: string;
  result: unknown;
  policy_decision: PolicyDecision | null;
  committed_version: number | null;
  commit_status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is CoordinatorEnvelope {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'result')) return false;
  return (
    typeof value.request_id === 'string' &&
    (value.committed_version === null || typeof value.committed_version === 'number') &&
    typeof value.commit_status === 'string'
  );
}

function isManifest(value: unknown): value is ResidenceManifest {
  if (!isRecord(value)) return false;
  return (
    value.schema === 'arcp/residence-manifest/0.1' &&
    typeof value.agent_id === 'string' &&
    typeof value.residence_id === 'string' &&
    typeof value.manifest_version === 'number' &&
    typeof value.root_hash === 'string' &&
    typeof value.event_cursor === 'string'
  );
}

function isStatus(value: unknown): value is AgentStatusSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.agent_id === 'string' &&
    typeof value.state === 'string' &&
    typeof value.manifest_version === 'number' &&
    typeof value.root_hash === 'string'
  );
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return (
    value === 'allow' ||
    value === 'allow-with-log' ||
    value === 'simulate' ||
    value === 'delay' ||
    value === 'request-approval' ||
    value === 'require-multi-party' ||
    value === 'deny'
  );
}

/**
 * Only `result.status` lives inside `result` on the wire — `policy_decision`
 * and `committed_version` are envelope-level fields, exactly as they are for
 * manifest/status reads (see `read()` below, which already takes
 * `committed_version` from the envelope, not from `result`). A wake response
 * whose `result` is just `{ status }` is not a partial/malformed payload.
 */
function isWakeResult(value: unknown): value is { status: 'accepted' | 'duplicate' } {
  return isRecord(value) && (value.status === 'accepted' || value.status === 'duplicate');
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CoordinatorProtocolError('coordinator returned non-JSON content', response.status);
  }
}

export function createCoordinatorClient(options: CoordinatorClientOptions): CoordinatorControlPort {
  const baseUrl = options.baseUrl ?? 'https://coordinator.internal';

  const pathFor = (agentId: string, resource: 'manifest' | 'status' | 'wakes'): string =>
    `/internal/v1/agents/${encodeURIComponent(agentId)}/${resource}`;

  async function read(
    agentId: string,
    resource: 'manifest' | 'status',
  ): Promise<unknown | null> {
    const request = new Request(new URL(pathFor(agentId, resource), baseUrl), {
      method: 'GET',
      headers: { 'X-ARCP-Request-ID': options.nextRequestId() },
    });
    const response = await options.transport.fetch(request);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new CoordinatorProtocolError(
        `coordinator read failed with HTTP ${response.status}`,
        response.status,
      );
    }
    const body = await parseJson(response);
    if (!isEnvelope(body)) {
      throw new CoordinatorProtocolError('coordinator returned a malformed success envelope', response.status);
    }
    return body.result;
  }

  return {
    async getManifest(agentId) {
      const result = await read(agentId, 'manifest');
      if (result === null) return null;
      if (!isManifest(result)) {
        throw new CoordinatorProtocolError('coordinator manifest payload is invalid');
      }
      return result;
    },

    async getStatus(agentId) {
      const result = await read(agentId, 'status');
      if (result === null) return null;
      if (!isStatus(result)) {
        throw new CoordinatorProtocolError('coordinator status payload is invalid');
      }
      return result;
    },

    async acceptWake(agentId, wake: WakeRecord) {
      const request = new Request(new URL(pathFor(agentId, 'wakes'), baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Idempotency-Key': wake.idempotency_key,
          'X-ARCP-Request-ID': options.nextRequestId(),
        },
        body: JSON.stringify(wake),
      });
      const response = await options.transport.fetch(request);
      if (!response.ok) {
        throw new CoordinatorProtocolError(
          `coordinator wake submission failed with HTTP ${response.status}`,
          response.status,
        );
      }
      const body = await parseJson(response);
      if (!isEnvelope(body) || !isWakeResult(body.result) || !isPolicyDecision(body.policy_decision)) {
        throw new CoordinatorProtocolError('coordinator wake response is malformed', response.status);
      }
      return {
        status: body.result.status,
        policy_decision: body.policy_decision,
        committed_version: body.committed_version,
      };
    },
  };
}
