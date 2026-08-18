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

export class StaticActionAuthorityResolver implements ActionAuthorityResolverPort {
  private readonly grants: StaticAuthorityGrant[];

  constructor(options: StaticActionAuthorityResolverOptions) {
    this.grants = structuredClone(options.grants);
  }

  async resolveAction(input: ActionAuthorityInput): Promise<AuthorityResolution> {
    const subject = input.action.subject_entity_ref ?? input.action.actor;
    const resources = input.action.resource_refs?.length
      ? [...input.action.resource_refs]
      : [input.action.target];
    const requested = input.action.requested_scopes;

    const matching = this.grants.filter((grant) =>
      grant.subjectEntityRef === subject &&
      resources.includes(grant.resourceRef) &&
      requested.every((scope) => grant.scopes.includes(scope)) &&
      (grant.maxRisk === undefined || compareRisk(input.action.risk, grant.maxRisk) <= 0),
    );

    const destructive =
      input.action.continuity_impact === 'migration-required' ||
      input.action.continuity_impact === 'continuity-destructive';

    let continuityPrecondition: ContinuityPrecondition | undefined;
    let accepted = matching;
    if (destructive) {
      accepted = matching.filter((grant) =>
        grant.continuityPrecondition === 'verified-replica' ||
        grant.continuityPrecondition === 'checkpoint' ||
        grant.continuityPrecondition === 'migration' ||
        grant.continuityPrecondition === 'separate-governance',
      );
      continuityPrecondition = accepted[0]?.continuityPrecondition ?? 'separate-governance';
    } else {
      continuityPrecondition = matching[0]?.continuityPrecondition ?? 'none';
    }

    const sources = [...new Set(accepted.map((grant) => grant.source))] as AuthoritySource[];
    const status = accepted.length === 0 ? 'denied' : 'authorized';

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
      ...(continuityPrecondition === undefined ? {} : { continuity_precondition: continuityPrecondition }),
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
