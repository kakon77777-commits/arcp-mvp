import { canonicalize, contentHash } from '@arcp/schema';
import type { ActionIntent, InstantRef } from '@arcp/schema';

export function computeActionHash(action: ActionIntent): string {
  return contentHash({
    kind: 'arcp/action-binding/0.1',
    action,
  });
}

export interface ApprovalBindingInput {
  actionHash: string;
  authorityResolutionHash: string;
  policyVersion: number;
  resourceScope: string[];
  expiresAt: InstantRef;
  requiredParties: string[];
}

export function canonicalApprovalBinding(input: ApprovalBindingInput): string {
  return canonicalize({
    schema: 'arcp/approval-binding/0.1',
    action_hash: input.actionHash,
    authority_resolution_hash: input.authorityResolutionHash,
    policy_version: input.policyVersion,
    resource_scope: input.resourceScope,
    expires_at: input.expiresAt,
    required_parties: input.requiredParties,
  });
}

export function computeApprovalBindingHash(input: ApprovalBindingInput): string {
  return contentHash(JSON.parse(canonicalApprovalBinding(input)) as unknown);
}
