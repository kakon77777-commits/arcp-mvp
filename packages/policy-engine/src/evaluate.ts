import type { PolicyInput, PolicyResult } from '@arcp/schema';
import { DEFAULT_DECISION_BY_RISK } from './risk-matrix.js';

/**
 * Deterministic Permit() evaluation per
 * arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §10.2-10.4.
 * Same input always yields the same decision — no model call, no randomness.
 */
export interface EvaluateOptions {
  /** A currently valid approval covering this exact action hash/scope/target. */
  hasValidApproval?: boolean;
}

function isExportOrMigrationIntent(intent: string): boolean {
  return intent.includes('export') || intent.includes('migration') || intent.includes('delete-all');
}

export function evaluate(input: PolicyInput, options: EvaluateOptions = {}): PolicyResult {
  const base = (reason: string, decision = DEFAULT_DECISION_BY_RISK[input.risk]): PolicyResult => ({
    decision,
    reason,
    risk: input.risk,
    policy_version: input.policy_version,
  });

  // §10.4: unauthorized requests (no valid lease) are denied outright.
  if (!Number.isFinite(input.lease_fencing_token) || input.lease_fencing_token <= 0) {
    return base('missing or invalid primary lease fencing token', 'deny');
  }

  // §10.4: P2/P3 export defaults to deny unless an explicit approval already covers it.
  if ((input.sensitivity === 'P2' || input.sensitivity === 'P3') && isExportOrMigrationIntent(input.intent)) {
    if (options.hasValidApproval) {
      return base(`${input.sensitivity} export covered by existing valid approval`, 'allow-with-log');
    }
    return base(`${input.sensitivity} export/migration requires explicit approval`, 'deny');
  }

  // R4 always needs multi-party approval, regardless of budget.
  if (input.risk === 'R4') {
    if (options.hasValidApproval) {
      return base('R4 action covered by existing multi-party approval', 'allow-with-log');
    }
    return base('R4 action requires multi-step explicit approval', 'require-multi-party');
  }

  // R2/R3: an existing valid approval satisfies the request-approval requirement.
  if ((input.risk === 'R2' || input.risk === 'R3') && options.hasValidApproval) {
    return base(`${input.risk} action covered by existing valid approval`, 'allow-with-log');
  }

  // R2 without an approval: allow only if budget remains, else must be requested.
  if (input.risk === 'R2') {
    if (input.budget.remaining <= 0) {
      return base('budget exhausted for R2 action, approval required', 'request-approval');
    }
    return base('R2 action within budget, external mirror write allowed with log', 'allow-with-log');
  }

  return base(`default decision for risk ${input.risk}`);
}
