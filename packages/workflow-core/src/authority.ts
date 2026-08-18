import { contentHash } from '@arcp/schema';
import type {
  AuthorityResolution,
  AuthoritySource,
  ContinuityPrecondition,
} from '@arcp/schema';
import type {
  ActionAuthorityInput,
  StaticAuthorityGrant,
  StaticWakeAuthorityGrant,
  WakeAuthorityInput,
  WakeAuthorityResult,
} from './types.js';
import type { ActionAuthorityResolverPort, WakeAuthorityResolverPort } from './ports.js';
import { compareRisk } from './budget.js';

export interface StaticActionAuthorityResolverOptions {
  grants: StaticAuthorityGrant[];
}

function resolutionId(runId: string, actionHash: string): string {
  return `arcp:authority:${contentHash({ runId, actionHash }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function resourceScope(resourceRefs: string[], scopes: string[]): string[] {
  const result: string[] = [];
  for (const resource of resourceRefs) {
    for (const scope of scopes) result.push(`${resource}#${scope}`);
  }
  return result;
}

function isContinuitySafe(precondition: ContinuityPrecondition | undefined): boolean {
  return precondition === 'verified-replica' ||
    precondition === 'checkpoint' ||
    precondition === 'migration' ||
    precondition === 'separate-governance';
}

function strongestContinuityPrecondition(grants: StaticAuthorityGrant[]): ContinuityPrecondition {
  const values = grants.map((grant) => grant.continuityPrecondition ?? 'none');
  if (values.includes('separate-governance')) return 'separate-governance';
  if (values.includes('migration')) return 'migration';
  if (values.includes('checkpoint')) return 'checkpoint';
  if (values.includes('verified-replica')) return 'verified-replica';
  return 'none';
}

export class StaticActionAuthorityResolver implements ActionAuthorityResolverPort {
  private readonly grants: StaticAuthorityGrant[];

  constructor(options: StaticActionAuthorityResolverOptions) {
    this.grants = structuredClone(options.grants);
  }

  async resolveAction(input: ActionAuthorityInput): Promise<AuthorityResolution> {
    const subject = input.action.subject_entity_ref ?? input.action.actor;
    const resources = input.action.resource_refs?.length
      ? [...new Set(input.action.resource_refs)]
      : [input.action.target];
    const requested = [...new Set(input.action.requested_scopes)];
    const destructive =
      input.action.continuity_impact === 'migration-required' ||
      input.action.continuity_impact === 'continuity-destructive';

    const eligible = this.grants.filter((grant) =>
      grant.subjectEntityRef === subject &&
      resources.includes(grant.resourceRef) &&
      (grant.maxRisk === undefined || compareRisk(input.action.risk, grant.maxRisk) <= 0),
    );

    // Authority is conjunctive across every affected resource and requested
    // scope. One grant for resource A must never authorize resource B merely
    // because both resources appear in the same ActionIntent.
    const covering: StaticAuthorityGrant[] = [];
    let fullyCovered = true;
    for (const resource of resources) {
      const scopes = requested.length > 0 ? requested : [''];
      for (const scope of scopes) {
        let candidates = eligible.filter((grant) =>
          grant.resourceRef === resource && (scope === '' || grant.scopes.includes(scope)),
        );
        if (destructive) {
          candidates = candidates.filter((grant) => isContinuitySafe(grant.continuityPrecondition));
        }
        if (candidates.length === 0) {
          fullyCovered = false;
        } else {
          covering.push(...candidates);
        }
      }
    }

    const accepted = fullyCovered ? [...new Set(covering)] : [];
    const sources = [...new Set(accepted.map((grant) => grant.source))] as AuthoritySource[];
    const status: AuthorityResolution['status'] = accepted.length === 0 ? 'denied' : 'authorized';
    const continuityPrecondition: ContinuityPrecondition = destructive
      ? (accepted.length === 0 ? 'separate-governance' : strongestContinuityPrecondition(accepted))
      : strongestContinuityPrecondition(accepted);

    return {
      schema: 'arcp/authority-resolution/0.1',
      resolution_id: resolutionId(input.runId, input.actionHash),
      run_id: input.runId,
      action_id: input.action.action_id,
      action_hash: input.actionHash,
      status,
      sources,
      subject_entity_ref: subject,
      resource_scope: status === 'authorized' ? resourceScope(resources, requested) : [],
      relation_refs: [...(input.action.relation_refs ?? [])],
      contract_refs: [...(input.action.contract_refs ?? [])],
      revocable: accepted.every((grant) => grant.revocable !== false),
      continuity_precondition: continuityPrecondition,
    };
  }
}

export class StaticWakeAuthorityResolver implements WakeAuthorityResolverPort {
  constructor(private readonly grants: StaticWakeAuthorityGrant[]) {}

  async resolveWake(input: WakeAuthorityInput): Promise<WakeAuthorityResult> {
    const match = this.grants.find((grant) =>
      grant.requiredAuthority === input.wake.required_authority &&
      (grant.agentId === undefined || grant.agentId === input.agentId),
    );
    if (!match) {
      return { authorized: false, reason: `wake authority denied: ${input.wake.required_authority}` };
    }
    return {
      authorized: true,
      source: input.wake.required_authority,
      reason: 'wake authority matched explicit static grant',
    };
  }
}
