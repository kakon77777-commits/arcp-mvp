import type { PolicyDecision, ResidenceManifest, WakeRecord } from '@arcp/schema';

export interface AgentStatusSnapshot {
  agent_id: string;
  state: string;
  manifest_version: number;
  root_hash: string;
}

export interface WakeAcceptance {
  status: 'accepted' | 'duplicate';
  policy_decision: PolicyDecision;
  committed_version: number | null;
}

export interface CoordinatorControlPort {
  getManifest(agentId: string): Promise<ResidenceManifest | null>;
  getStatus(agentId: string): Promise<AgentStatusSnapshot | null>;
  acceptWake(agentId: string, wake: WakeRecord): Promise<WakeAcceptance>;
}

export type AuthorizationOperation = 'read-manifest' | 'read-status' | 'submit-wake';

export interface AuthorizationInput {
  authorization: string | null;
  agentId: string;
  operation: AuthorizationOperation;
}

export interface AuthorizationPort {
  authorize(input: AuthorizationInput): boolean | Promise<boolean>;
}

export interface ControlPlaneDependencies {
  coordinator: CoordinatorControlPort;
  authorization: AuthorizationPort;
  nextRequestId: () => string;
}

export interface ControlPlaneHandler {
  fetch(request: Request): Promise<Response>;
}
