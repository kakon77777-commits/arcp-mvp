import { contentHash } from '@arcp/schema';
import type {
  ApprovalGrant,
  ApprovalRequest,
  AuthorityResolution,
  InstantRef,
} from '@arcp/schema';
import { computeApprovalBindingHash } from './hashing.js';

function numericUnixMs(instant: InstantRef | undefined): number | null {
  if (!instant?.encoding || instant.value === undefined) return null;
  try {
    if (instant.encoding === 'unix_ms') return Number(instant.value);
    if (instant.encoding === 'unix_s') return Number(instant.value) * 1_000;
    if (instant.encoding === 'unix_us') return Number(BigInt(instant.value) / 1_000n);
    if (instant.encoding === 'unix_ns') return Number(BigInt(instant.value) / 1_000_000n);
    if (instant.encoding === 'rfc3339') {
      const parsed = Date.parse(instant.value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }
  return null;
}

export interface CreateApprovalRequestInput {
  runId: string;
  actionId: string;
  actionHash: string;
  authority: AuthorityResolution;
  policyVersion: number;
  requiredParties: string[];
  /** Human/agent grant verbs such as read/write/delete. */
  requestedScope: string[];
  /** Fully qualified authority scope such as resource:report#write. */
  bindingResourceScope: string[];
  createdAt: InstantRef;
  expiresAt: InstantRef;
}

export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequest {
  const requiredParties = [...new Set(input.requiredParties)];
  const requestedScope = [...new Set(input.requestedScope)];
  const bindingResourceScope = [...new Set(input.bindingResourceScope)];
  const authorityResolutionHash = contentHash(input.authority);
  const bindingHash = computeApprovalBindingHash({
    actionHash: input.actionHash,
    authorityResolutionHash,
    policyVersion: input.policyVersion,
    resourceScope: bindingResourceScope,
    expiresAt: input.expiresAt,
    requiredParties,
  });
  return {
    schema: 'arcp/approval-request/0.1',
    approval_request_id: `arcp:approval-request:${bindingHash.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    run_id: input.runId,
    action_id: input.actionId,
    action_hash: input.actionHash,
    authority_resolution_hash: authorityResolutionHash,
    policy_version: input.policyVersion,
    binding_hash: bindingHash,
    required_parties: requiredParties,
    requested_scope: requestedScope,
    created_at: structuredClone(input.createdAt),
    expires_at: structuredClone(input.expiresAt),
    status: 'pending',
  };
}

export interface ApprovalSatisfactionResult {
  satisfied: boolean;
  validApproverRefs: string[];
  reason: string;
}

export function evaluateApprovalSatisfaction(
  request: ApprovalRequest,
  grants: readonly ApprovalGrant[],
  now?: InstantRef,
): ApprovalSatisfactionResult {
  if (request.status === 'expired' || request.status === 'revoked' || request.status === 'cancelled') {
    return { satisfied: false, validApproverRefs: [], reason: `approval request is ${request.status}` };
  }

  const nowMs = numericUnixMs(now);
  const requestExpiryMs = numericUnixMs(request.expires_at);
  if (nowMs !== null && requestExpiryMs !== null && nowMs > requestExpiryMs) {
    return { satisfied: false, validApproverRefs: [], reason: 'approval request expired' };
  }

  const validByApprover = new Map<string, ApprovalGrant>();
  for (const grant of grants) {
    if (grant.approval_request_id !== request.approval_request_id) continue;
    const grantExpiryMs = numericUnixMs(grant.expires_at);
    if (nowMs !== null && grantExpiryMs !== null && nowMs > grantExpiryMs) continue;
    if (!request.requested_scope.every((scope) => grant.granted_scope.includes(scope))) continue;
    if (!request.required_parties.includes(grant.approver_entity_ref)) continue;
    validByApprover.set(grant.approver_entity_ref, grant);
  }

  const required = [...new Set(request.required_parties)];
  const satisfied = required.length > 0 && required.every((party) => validByApprover.has(party));
  return {
    satisfied,
    validApproverRefs: [...validByApprover.keys()],
    reason: satisfied ? 'all required approval parties satisfied exact scope' : 'required approval parties remain unsatisfied',
  };
}
