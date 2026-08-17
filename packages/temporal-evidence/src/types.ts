import type { InstantRef } from '@arcp/schema';

export type TemporalEncoding = 'unix_s' | 'unix_ms' | 'unix_us' | 'unix_ns' | 'rfc3339';
export type TemporalTimescale = 'utc' | 'posix';
export type TemporalVerification = 'verified' | 'provider-asserted' | 'degraded-local';

export interface TemporalAttestation {
  alg: string;
  keyId: string;
  signedFields: string;
  value: string;
  verified?: boolean;
}

export interface TemporalSourceQuality {
  sourceClass: string;
  precision: string;
  estimatedUncertaintyNs?: number;
  synchronized?: boolean;
}

export interface TemporalEvidence {
  instant: InstantRef;
  canonicalUnixNs: string | null;
  sourceQuality: TemporalSourceQuality;
  attestation?: TemporalAttestation;
  verification: TemporalVerification;
}

export interface RegisterInstantInput {
  value?: string;
  encoding?: TemporalEncoding;
  timescale?: TemporalTimescale;
  label?: string;
  meta?: Record<string, unknown>;
}

export interface TemporalConversionInput {
  input: { value: string; encoding: TemporalEncoding; timescale?: TemporalTimescale };
  output: { encoding: TemporalEncoding; timescale?: TemporalTimescale; timezone?: string };
}

export interface TemporalConversionResult {
  value: string;
  canonicalUnixNs: string;
  lossless: boolean;
}

export interface TemporalBoundaryInput {
  timezone?: string;
  localValue?: string;
  windowHours?: number;
  systemId?: string;
  value?: string;
  encoding?: TemporalEncoding;
}

export type TemporalBoundaryStatus = 'normal' | 'gap' | 'fold' | 'pause' | 'rate_change';

export interface TemporalBoundaryResult {
  status: TemporalBoundaryStatus;
  safe: boolean;
  detail: unknown;
}

export type SharedInstantConstraintType =
  | 'weekday_hours'
  | 'avoid_window'
  | 'prefer_window'
  | 'min_lead_time'
  | 'system_not_paused'
  | 'market_hours';

export type SharedInstantConstraint = Record<string, unknown> & {
  type: SharedInstantConstraintType;
  weight?: number;
};

export interface SharedInstantPlanInput {
  window: { from: number; to: number; stepS?: number };
  constraints: SharedInstantConstraint[];
}

export interface SharedInstantCandidate {
  unixS: string;
  score: number;
  satisfied: unknown[];
  violated: unknown[];
  unsupported: unknown[];
}

export interface SharedInstantPlan {
  best: SharedInstantCandidate | null;
  alternatives: SharedInstantCandidate[];
  explanation: string | null;
}

export interface TemporalEvidencePort {
  now(): Promise<TemporalEvidence>;
  registerInstant(input?: RegisterInstantInput): Promise<TemporalEvidence>;
  getInstant(id: string): Promise<TemporalEvidence>;
  convert(input: TemporalConversionInput): Promise<TemporalConversionResult>;
  inspectBoundary(input: TemporalBoundaryInput): Promise<TemporalBoundaryResult>;
  planSharedInstant(input: SharedInstantPlanInput): Promise<SharedInstantPlan>;
}
