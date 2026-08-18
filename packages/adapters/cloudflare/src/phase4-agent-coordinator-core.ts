import type {
  AdvanceRunRequest,
  AdvanceRunResponse,
  MetadataStorePort,
} from '@arcp/control-plane-core';
import type { ApprovalGrant, ContainmentRecord, RunRecord } from '@arcp/schema';
import {
  WorkflowError,
  type BoundedRunOrchestrator,
  type RunStateStorePort,
} from '@arcp/workflow-core';
import { AgentDurableObjectCore } from './agent-durable-object-core.js';

/**
 * Phase 4 extension of the per-Agent coordinator core.
 *
 * This class intentionally does not know any model/executor vendor. It owns
 * only the Durable Object side of Phase 4 coordination: Agent-scoped run
 * lookup, fresh fencing for resumes, exact approval persistence, containment
 * mutation, and delegation into the provider-neutral BoundedRunOrchestrator.
 */
export class Phase4AgentCoordinatorCore extends AgentDurableObjectCore {
  constructor(
    metadata: MetadataStorePort,
    private readonly runStore: RunStateStorePort,
    private readonly orchestrator: Pick<BoundedRunOrchestrator, 'advance'>,
  ) {
    super(metadata);
  }

  async getRun(agentId: string, runId: string): Promise<RunRecord | null> {
    const run = await this.runStore.getRun(runId);
    if (!run || run.agent_id !== agentId) return null;
    return run;
  }

  async advanceRun(agentId: string, input: AdvanceRunRequest): Promise<AdvanceRunResponse> {
    const existing = input.run_id === undefined ? null : await this.getRun(agentId, input.run_id);
    if (input.run_id !== undefined && existing === null) {
      throw new WorkflowError('invalid_wake', `Agent-scoped resume run not found: ${input.run_id}`, false);
    }

    const fencingToken = input.fencing_token ?? (existing ? existing.fencing_token + 1 : 1);
    if (existing && fencingToken <= existing.fencing_token) {
      throw new WorkflowError(
        'stale_fencing_token',
        `resume fencing token ${fencingToken} is not fresher than ${existing.fencing_token}`,
        false,
      );
    }

    const result = await this.orchestrator.advance({
      agentId,
      wake: input.wake,
      fencingToken,
      ...(input.run_id === undefined ? {} : { runId: input.run_id }),
    });
    if (result.run.agent_id !== agentId) {
      throw new WorkflowError('invalid_persisted_state', 'orchestrator returned a run for another Agent', false);
    }

    return {
      run: result.run,
      ...(result.manifest === undefined ? {} : { manifest: result.manifest }),
      ...(result.stopReason === undefined ? {} : { stop_reason: result.stopReason }),
      ...(result.pendingApprovalRequestId === undefined
        ? {}
        : { pending_approval_request_id: result.pendingApprovalRequestId }),
    };
  }

  async submitApprovalGrant(
    agentId: string,
    approvalRequestId: string,
    grant: ApprovalGrant,
  ): Promise<{ accepted: boolean }> {
    if (grant.approval_request_id !== approvalRequestId) {
      throw new WorkflowError('approval_invalid', 'grant approval_request_id does not match route request', false);
    }
    const request = await this.runStore.getApprovalRequest(approvalRequestId);
    if (!request) {
      throw new WorkflowError('approval_invalid', `approval request not found: ${approvalRequestId}`, false);
    }
    const run = await this.runStore.getRun(request.run_id);
    if (!run || run.agent_id !== agentId) {
      throw new WorkflowError('approval_invalid', 'approval request does not belong to this Agent', false);
    }
    await this.runStore.appendApprovalGrant(grant);
    return { accepted: true };
  }

  async applyContainment(agentId: string, record: ContainmentRecord): Promise<ContainmentRecord> {
    if (record.agent_id !== agentId) {
      throw new WorkflowError('invalid_persisted_state', 'containment Agent does not match coordinator Agent', false);
    }
    await this.runStore.appendContainment(record);
    return structuredClone(record);
  }

  async releaseContainment(agentId: string, containmentId: string): Promise<{ released: boolean }> {
    const active = await this.runStore.activeContainments(agentId);
    const record = active.find((item) => item.containment_id === containmentId);
    if (!record) return { released: false };
    await this.runStore.appendContainment({ ...record, status: 'released' });
    return { released: true };
  }
}
