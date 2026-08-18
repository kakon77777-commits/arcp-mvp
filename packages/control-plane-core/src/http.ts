import type { ApprovalGrant, ContainmentRecord, WakeRecord } from '@arcp/schema';
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

function successEnvelope(
  requestId: string,
  result: unknown,
  options: {
    policyDecision?: unknown;
    committedVersion?: number | null;
    commitStatus?: string;
  } = {},
): Response {
  return jsonResponse({
    request_id: requestId,
    result,
    policy_decision: options.policyDecision ?? null,
    committed_version: options.committedVersion ?? null,
    commit_status: options.commitStatus ?? 'not_applicable',
  }, 200);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWakeRecord(value: unknown): value is WakeRecord {
  if (!isRecord(value)) return false;
  const triggerTypes = new Set(['human', 'schedule', 'webhook', 'state', 'goal', 'peer', 'instant']);
  return (
    value.schema === 'arcp/wake/0.1' &&
    typeof value.wake_id === 'string' &&
    typeof value.trigger_type === 'string' &&
    triggerTypes.has(value.trigger_type) &&
    typeof value.trigger_ref === 'string' &&
    typeof value.required_authority === 'string' &&
    typeof value.revalidate_on_wake === 'boolean' &&
    typeof value.idempotency_key === 'string' &&
    value.idempotency_key.length > 0
  );
}

function isApprovalGrant(value: unknown): value is ApprovalGrant {
  return isRecord(value) &&
    value.schema === 'arcp/approval-grant/0.1' &&
    typeof value.approval_grant_id === 'string' &&
    typeof value.approval_request_id === 'string' &&
    typeof value.approver_entity_ref === 'string' &&
    Array.isArray(value.granted_scope) && value.granted_scope.every((item) => typeof item === 'string') &&
    isRecord(value.granted_at) && typeof value.granted_at.instant_id === 'string' &&
    typeof value.idempotency_key === 'string';
}

function isContainmentRecord(value: unknown): value is ContainmentRecord {
  return isRecord(value) &&
    value.schema === 'arcp/containment/0.1' &&
    typeof value.containment_id === 'string' &&
    typeof value.agent_id === 'string' &&
    Array.isArray(value.scope) && value.scope.every((item) => typeof item === 'string') &&
    typeof value.reason === 'string' &&
    typeof value.authority_source === 'string' &&
    isRecord(value.entered_at) && typeof value.entered_at.instant_id === 'string' &&
    isRecord(value.expires_at) && typeof value.expires_at.instant_id === 'string' &&
    typeof value.review_required === 'boolean' &&
    Array.isArray(value.exit_conditions) && value.exit_conditions.every((item) => typeof item === 'string') &&
    ['active', 'review-due', 'renewed', 'released', 'escalated'].includes(String(value.status));
}

function acceptsJson(request: Request): boolean {
  return (request.headers.get('Content-Type')?.toLowerCase() ?? '').startsWith('application/json');
}

async function parseJsonBody(request: Request): Promise<unknown> {
  return request.json();
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

function capabilityUnavailable(requestId: string, capability: string): Response {
  return errorResponse(
    requestId,
    501,
    'ARCP_CAPABILITY_NOT_IMPLEMENTED',
    `Coordinator capability is not implemented: ${capability}.`,
  );
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
          return successEnvelope(requestId, { status: 'ok' });
        }

        // -----------------------------------------------------------------
        // Phase 4 operational run API. These routes expose persisted run
        // control while keeping authority/execution semantics behind the
        // coordinator/workflow boundary.
        // -----------------------------------------------------------------
        const runMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/runs\/([^/]+)(\/advance)?$/);
        if (runMatch) {
          const agentId = decodeURIComponent(runMatch[1]!);
          const runId = decodeURIComponent(runMatch[2]!);
          const isAdvance = runMatch[3] === '/advance';

          if (!isAdvance) {
            if (request.method !== 'GET') {
              return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Run read endpoint only accepts GET.');
            }
            if (!(await authorized(deps, request, agentId, 'read-run'))) {
              return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
            }
            if (!deps.coordinator.getRun) return capabilityUnavailable(requestId, 'getRun');
            const run = await deps.coordinator.getRun(agentId, runId);
            if (!run) return errorResponse(requestId, 404, 'ARCP_RUN_NOT_FOUND', 'Run was not found.');
            return successEnvelope(requestId, run);
          }

          if (request.method !== 'POST') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Run advance endpoint only accepts POST.');
          }
          if (!(await authorized(deps, request, agentId, 'advance-run'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          if (!acceptsJson(request)) {
            return errorResponse(requestId, 415, 'ARCP_VALIDATION_CONTENT_TYPE_REQUIRED', 'Run advance requires Content-Type: application/json.');
          }
          let body: unknown;
          try {
            body = await parseJsonBody(request);
          } catch {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_JSON_INVALID', 'Request body is not valid JSON.');
          }
          if (!isRecord(body) || !isWakeRecord(body.wake)) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_RUN_ADVANCE_INVALID', 'Run advance requires a valid wake record.');
          }
          if (body.run_id !== undefined && body.run_id !== runId) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_RUN_ID_MISMATCH', 'Path run id must match body run_id.');
          }
          if (body.fencing_token !== undefined && typeof body.fencing_token !== 'number') {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_FENCING_TOKEN_INVALID', 'fencing_token must be a number when supplied.');
          }
          if (!deps.coordinator.advanceRun) return capabilityUnavailable(requestId, 'advanceRun');
          const result = await deps.coordinator.advanceRun(agentId, {
            wake: body.wake,
            run_id: runId,
            ...(typeof body.fencing_token === 'number' ? { fencing_token: body.fencing_token } : {}),
          });
          return successEnvelope(requestId, result, {
            committedVersion: result.manifest?.manifest_version ?? null,
            commitStatus: result.manifest ? 'committed' : 'not_applicable',
          });
        }

        const approvalMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/approvals\/([^/]+)\/grants$/);
        if (approvalMatch) {
          const agentId = decodeURIComponent(approvalMatch[1]!);
          const requestRef = decodeURIComponent(approvalMatch[2]!);
          if (request.method !== 'POST') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Approval grant endpoint only accepts POST.');
          }
          if (!(await authorized(deps, request, agentId, 'submit-approval'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          if (!acceptsJson(request)) {
            return errorResponse(requestId, 415, 'ARCP_VALIDATION_CONTENT_TYPE_REQUIRED', 'Approval grant requires Content-Type: application/json.');
          }
          let body: unknown;
          try { body = await parseJsonBody(request); }
          catch { return errorResponse(requestId, 400, 'ARCP_VALIDATION_JSON_INVALID', 'Request body is not valid JSON.'); }
          if (!isApprovalGrant(body)) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_APPROVAL_GRANT_INVALID', 'Request body must be an arcp/approval-grant/0.1 record.');
          }
          if (body.approval_request_id !== requestRef) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_APPROVAL_REQUEST_MISMATCH', 'Path approval request must match grant.approval_request_id.');
          }
          if (!deps.coordinator.submitApprovalGrant) return capabilityUnavailable(requestId, 'submitApprovalGrant');
          const result = await deps.coordinator.submitApprovalGrant(agentId, requestRef, body);
          return jsonResponse({
            request_id: requestId,
            result,
            policy_decision: null,
            committed_version: null,
            commit_status: 'not_applicable',
          }, 202);
        }

        const containmentReleaseMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/containments\/([^/]+)\/release$/);
        if (containmentReleaseMatch) {
          const agentId = decodeURIComponent(containmentReleaseMatch[1]!);
          const containmentId = decodeURIComponent(containmentReleaseMatch[2]!);
          if (request.method !== 'POST') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Containment release endpoint only accepts POST.');
          }
          if (!(await authorized(deps, request, agentId, 'release-containment'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          if (!deps.coordinator.releaseContainment) return capabilityUnavailable(requestId, 'releaseContainment');
          const result = await deps.coordinator.releaseContainment(agentId, containmentId);
          return successEnvelope(requestId, result);
        }

        const containmentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/containments$/);
        if (containmentMatch) {
          const agentId = decodeURIComponent(containmentMatch[1]!);
          if (request.method !== 'POST') {
            return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Containment endpoint only accepts POST.');
          }
          if (!(await authorized(deps, request, agentId, 'apply-containment'))) {
            return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
          }
          if (!acceptsJson(request)) {
            return errorResponse(requestId, 415, 'ARCP_VALIDATION_CONTENT_TYPE_REQUIRED', 'Containment requires Content-Type: application/json.');
          }
          let body: unknown;
          try { body = await parseJsonBody(request); }
          catch { return errorResponse(requestId, 400, 'ARCP_VALIDATION_JSON_INVALID', 'Request body is not valid JSON.'); }
          if (!isContainmentRecord(body)) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_CONTAINMENT_INVALID', 'Request body must be an arcp/containment/0.1 record.');
          }
          if (body.agent_id !== agentId) {
            return errorResponse(requestId, 400, 'ARCP_VALIDATION_AGENT_MISMATCH', 'Containment agent_id must match route agent id.');
          }
          if (!deps.coordinator.applyContainment) return capabilityUnavailable(requestId, 'applyContainment');
          const result = await deps.coordinator.applyContainment(agentId, body);
          return jsonResponse({
            request_id: requestId,
            result,
            policy_decision: null,
            committed_version: null,
            commit_status: 'not_applicable',
          }, 202);
        }

        // -----------------------------------------------------------------
        // Phase 1 routes retained unchanged in semantics.
        // -----------------------------------------------------------------
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
          return successEnvelope(requestId, manifest, {
            committedVersion: manifest.manifest_version,
            commitStatus: 'committed',
          });
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
          return successEnvelope(requestId, status, {
            committedVersion: status.manifest_version,
            commitStatus: 'committed',
          });
        }

        if (request.method !== 'POST') {
          return errorResponse(requestId, 405, 'ARCP_METHOD_NOT_ALLOWED', 'Wake endpoint only accepts POST.');
        }
        if (!(await authorized(deps, request, agentId, 'submit-wake'))) {
          return errorResponse(requestId, 401, 'ARCP_AUTHENTICATION_REQUIRED', 'Authorization is required.');
        }
        if (!acceptsJson(request)) {
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
          body = await parseJsonBody(request);
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
