import type {
  ApprovalGrant,
  ContainmentRecord,
  PolicyDecision,
  ResidenceManifest,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import type {
  AdvanceRunRequest,
  AdvanceRunResponse,
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
  return isRecord(value) &&
    value.schema === 'arcp/residence-manifest/0.1' &&
    typeof value.agent_id === 'string' &&
    typeof value.residence_id === 'string' &&
    typeof value.manifest_version === 'number' &&
    typeof value.root_hash === 'string' &&
    typeof value.event_cursor === 'string';
}

function isStatus(value: unknown): value is AgentStatusSnapshot {
  return isRecord(value) &&
    typeof value.agent_id === 'string' &&
    typeof value.state === 'string' &&
    typeof value.manifest_version === 'number' &&
    typeof value.root_hash === 'string';
}

function isRun(value: unknown): value is RunRecord {
  return isRecord(value) &&
    value.schema === 'arcp/run/0.1' &&
    typeof value.run_id === 'string' &&
    typeof value.agent_id === 'string' &&
    typeof value.phase === 'string' &&
    typeof value.fencing_token === 'number' &&
    typeof value.turn_index === 'number' &&
    typeof value.checkpoint_sequence === 'number' &&
    isRecord(value.budget_spec);
}

function isAdvanceRunResponse(value: unknown): value is AdvanceRunResponse {
  return isRecord(value) && isRun(value.run) &&
    (value.stop_reason === undefined || typeof value.stop_reason === 'string') &&
    (value.pending_approval_request_id === undefined || typeof value.pending_approval_request_id === 'string') &&
    (value.manifest === undefined || isManifest(value.manifest));
}

function isContainment(value: unknown): value is ContainmentRecord {
  return isRecord(value) &&
    value.schema === 'arcp/containment/0.1' &&
    typeof value.containment_id === 'string' &&
    typeof value.agent_id === 'string' &&
    Array.isArray(value.scope) &&
    typeof value.status === 'string';
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return value === 'allow' || value === 'allow-with-log' || value === 'simulate' ||
    value === 'delay' || value === 'request-approval' ||
    value === 'require-multi-party' || value === 'deny';
}

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
  const agentBase = (agentId: string): string =>
    `/internal/v1/agents/${encodeURIComponent(agentId)}`;

  async function send(path: string, init?: RequestInit): Promise<CoordinatorEnvelope> {
    const headers = new Headers(init?.headers);
    headers.set('X-ARCP-Request-ID', options.nextRequestId());
    const response = await options.transport.fetch(new Request(new URL(path, baseUrl), { ...init, headers }));
    if (!response.ok) {
      throw new CoordinatorProtocolError(`coordinator request failed with HTTP ${response.status}`, response.status);
    }
    const body = await parseJson(response);
    if (!isEnvelope(body)) {
      throw new CoordinatorProtocolError('coordinator returned a malformed success envelope', response.status);
    }
    return body;
  }

  async function read(agentId: string, resource: 'manifest' | 'status'): Promise<unknown | null> {
    const response = await options.transport.fetch(new Request(new URL(`${agentBase(agentId)}/${resource}`, baseUrl), {
      method: 'GET',
      headers: { 'X-ARCP-Request-ID': options.nextRequestId() },
    }));
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new CoordinatorProtocolError(`coordinator read failed with HTTP ${response.status}`, response.status);
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
      if (!isManifest(result)) throw new CoordinatorProtocolError('coordinator manifest payload is invalid');
      return result;
    },

    async getStatus(agentId) {
      const result = await read(agentId, 'status');
      if (result === null) return null;
      if (!isStatus(result)) throw new CoordinatorProtocolError('coordinator status payload is invalid');
      return result;
    },

    async acceptWake(agentId, wake: WakeRecord): Promise<WakeAcceptance> {
      const body = await send(`${agentBase(agentId)}/wakes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Idempotency-Key': wake.idempotency_key,
        },
        body: JSON.stringify(wake),
      });
      if (!isWakeResult(body.result) || !isPolicyDecision(body.policy_decision)) {
        throw new CoordinatorProtocolError('coordinator wake response is malformed');
      }
      return {
        status: body.result.status,
        policy_decision: body.policy_decision,
        committed_version: body.committed_version,
      };
    },

    async getRun(agentId, runId) {
      const response = await options.transport.fetch(new Request(new URL(
        `${agentBase(agentId)}/runs/${encodeURIComponent(runId)}`,
        baseUrl,
      ), {
        method: 'GET',
        headers: { 'X-ARCP-Request-ID': options.nextRequestId() },
      }));
      if (response.status === 404) return null;
      if (!response.ok) throw new CoordinatorProtocolError(`coordinator run read failed with HTTP ${response.status}`, response.status);
      const body = await parseJson(response);
      if (!isEnvelope(body) || !isRun(body.result)) {
        throw new CoordinatorProtocolError('coordinator run payload is invalid', response.status);
      }
      return body.result;
    },

    async advanceRun(agentId, input: AdvanceRunRequest) {
      if (!input.run_id) {
        throw new CoordinatorProtocolError('internal Phase 4 advance requires run_id; new runs are created by the per-Agent wake runtime');
      }
      const body = await send(`${agentBase(agentId)}/runs/${encodeURIComponent(input.run_id)}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(input),
      });
      if (!isAdvanceRunResponse(body.result)) {
        throw new CoordinatorProtocolError('coordinator run advance payload is invalid');
      }
      return body.result;
    },

    async submitApprovalGrant(agentId, approvalRequestId, grant: ApprovalGrant) {
      const body = await send(`${agentBase(agentId)}/approvals/${encodeURIComponent(approvalRequestId)}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(grant),
      });
      if (!isRecord(body.result) || typeof body.result.accepted !== 'boolean') {
        throw new CoordinatorProtocolError('coordinator approval grant payload is invalid');
      }
      return { accepted: body.result.accepted };
    },

    async applyContainment(agentId, record: ContainmentRecord) {
      const body = await send(`${agentBase(agentId)}/containments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(record),
      });
      if (!isContainment(body.result)) throw new CoordinatorProtocolError('coordinator containment payload is invalid');
      return body.result;
    },

    async releaseContainment(agentId, containmentId) {
      const body = await send(`${agentBase(agentId)}/containments/${encodeURIComponent(containmentId)}/release`, {
        method: 'POST',
      });
      if (!isRecord(body.result) || typeof body.result.released !== 'boolean') {
        throw new CoordinatorProtocolError('coordinator containment release payload is invalid');
      }
      return { released: body.result.released };
    },
  };
}
