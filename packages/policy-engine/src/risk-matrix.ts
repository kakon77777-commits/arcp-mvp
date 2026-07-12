import type { PolicyDecision, RiskLevel } from '@arcp/schema';

/**
 * Default decision per risk level, per
 * arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §10.1.
 *
 *   R0  read P0, compute hash, rebuild index          -> allow-with-log
 *   R1  write internal draft, schedule low-risk wake,
 *       update derived index                          -> allow-with-log
 *   R2  write external mirror, call paid model,
 *       modify P2                                      -> budget + scoped approval
 *   R3  publish, send message, grant connector scope,
 *       delete canonical                                -> request-approval
 *   R4  primary cutover, identity-root/key ops,
 *       delete-all                                       -> multi-step explicit approval
 *
 * R2's "budget + scoped approval" is modelled here as request-approval by
 * default; evaluate() downgrades it to allow-with-log only when budget remains
 * and no P2/P3 export is involved.
 */
export const DEFAULT_DECISION_BY_RISK: Record<RiskLevel, PolicyDecision> = {
  R0: 'allow-with-log',
  R1: 'allow-with-log',
  R2: 'request-approval',
  R3: 'request-approval',
  R4: 'require-multi-party',
};
