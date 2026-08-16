import type { WakeRecord } from '@arcp/schema';
import type {
  AuthorizationOperation,
  ControlPlaneDependencies,
  ControlPlaneHandler,
} from './contracts.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    request_id: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): Response {
  const body: ErrorBody = {
    error: {
      code,
      message,
      request_id: requestId,
      retryable,
      ...(details ? { details } : {}),
    },
  };
  return jsonResponse(body, status);
}

function isWakeRecord(value: unknown): value is WakeRecord {
  if (value === null || typeof value !== 'object') return false;
  const wake = value as Record<string, unknown>;
  const triggerTypes = new Set(['human', 'schedule', 'webhook', 'state', 'goal', 'peer', 'instant']);
  return (
    wake.schema === 'arcp/wake/0.1' &&
    typeof wake.wake_id === 'string' &&
    typeof wake.trigger_type === 'string' &&
    triggerTypes.has(wake.trigger_type) &&
    typeof wake.trigger_ref === 'string' &&
    typeof wake.required_authority === 'string' &&
    typeof wake.revalidate_on_wake === 'boolean' &&
    typeof wake.idempotency_key === 'string' &&
    wake.idempotency_key.length > 0
  );
}

async function authorized(
  deps: ControlPlaneDependencies,
  request: Request,
  agentId: string,
  operation: AuthorizationOperation,
): Promise<boolean> {
  return deps.authorization.authorize({
    authorization: request.headers.get('Authorization'),
    agentId,
    operation,
  });
}

export function createControlPlaneHandler(deps: ControlPlaneDependencies): ControlPlaneHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const requestId = deps.nextRequestId();
      const url = new URL(request.url);

      try {
        if (url.pathname === '/api/v1/health') {
          if (request.method !== 'GET') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Health endpoint only accepts GET.');
          }
          return jsonResponse(
            {
              request_id: requestId,
              result: { status: 'ok' },
              policy_decision: null,
              committed_version: null,
              commit_status: 'not_applicable',
            },
            200,
          );
        }

        const match = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/(manifest|status|wakes)$/);
        if (!match) {
          return errorResponse(requestId, 404, 'ARCP_ROUTE_NOT_FOUND', 'No ARCP API route matches this request.');
        }

        const agentId = decodeURIComponent(match[1]!);
        const resource = match[2]!;

        if (resource === 'manifest') {
          if (request.method !== 'GET') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Manifest endpoint only accepts GET.');
          }
          if (!(await authorized(deps, request, agentId, 'read-manifest'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          const manifest = await deps.coordinator.getManifest(agentId);
          if (!manifest) {
            return errorResponse(requestId, 404, 'ARCP_AGENT_NOT_FOUND', 'Agent manifest was not found.');
          }
          return jsonResponse(
            {
              request_id: requestId,
              result: manifest,
              policy_decision: null,
              committed_version: manifest.manifest_version,
              commit_status: 'committed',
            },
            200,
          );
        }

        if (resource === 'status') {
          if (request.method !== 'GET') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Status endpoint only accepts GET.');
          }
          if (!(await authorized(deps, request, agentId, 'read-status'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          const status = await deps.coordinator.getStatus(agentId);
          if (!status) {
            return errorResponse(requestId, 404, 'ARCP_AGENT_NOT_FOUND', 'Agent status was not found.');
          }
          return jsonResponse(
            {
              request_id: requestId,
              result: status,
              policy_decision: null,
              committed_version: status.manifest_version,
              commit_status: 'committed',
            },
            200,
          );
        }

        if (request.method !== 'POST') {
          return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Wake endpoint only accepts POST.');
        }
        if (!(await authorized(deps, request, agentId, 'submit-wake'))) {
          return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
        }

        const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
        if (!contentType.startsWith('application/json')) {
          return errorResponse(
            requestId,
            415,
            'ARCP_VALIDATION_CONTENT_TYPE_REQUIRED',
            'Wake mutations require Content-Type: application/json.',
          );
        }

        const httpIdempotencyKey = request.headers.get('Idempotency-Key')?.trim();
        if (!httpIdempotencyKey) {
          return errorResponse(
            requestId,
            400,
            'ARCP_VALIDATION_IDEMPOTENCY_REQUIRED',
            'Wake mutations require Idempotency-Key.',
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(requestId, 400, 'ARCP_VALIDATION_JSON_INVALID', 'Request body is not valid JSON.');
        }

        if (!isWakeRecord(body)) {
          return errorResponse(
            requestId,
            400,
            'ARCP_VALIDATION_WAKE_SCHEMA_INVALID',
            'Request body must be an arcp/wake/0.1 record.',
          );
        }

        if (body.idempotency_key !== httpIdempotencyKey) {
          return errorResponse(
            requestId,
            400,
            'ARCP_VALIDATION_IDEMPOTENCY_MISMATCH',
            'HTTP Idempotency-Key must match WakeRecord.idempotency_key.',
          );
        }

        const acceptance = await deps.coordinator.acceptWake(agentId, body);
        return jsonResponse(
          {
            request_id: requestId,
            result: { wake_id: body.wake_id, status: acceptance.status },
            policy_decision: acceptance.policy_decision,
            committed_version: acceptance.committed_version,
            commit_status:
              acceptance.committed_version === null ? 'pending_coordinator_commit' : 'committed',
          },
          acceptance.status === 'accepted' ? 202 : 200,
        );
      } catch {
        return errorResponse(
          requestId,
          500,
          'ARCP_INTERNAL_ERROR',
          'The control plane could not complete the request.',
          true,
        );
      }
    },
  };
}
