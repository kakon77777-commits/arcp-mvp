import {
  TemporalEvidenceError,
  type RegisterInstantInput,
  type SharedInstantPlan,
  type SharedInstantPlanInput,
  type TemporalBoundaryInput,
  type TemporalBoundaryResult,
  type TemporalConversionInput,
  type TemporalConversionResult,
  type TemporalEvidence,
  type TemporalEvidencePort,
} from '@arcp/temporal-evidence';
import { CtclHttpClient, type CtclHttpClientOptions } from './http.js';
import {
  normalizeCtclBoundary,
  normalizeCtclConversion,
  normalizeCtclInstantEvidence,
  normalizeCtclPlan,
} from './normalize.js';

export interface CtclRestTemporalAdapterOptions extends CtclHttpClientOptions {}

function definedEntries(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export class CtclRestTemporalAdapter implements TemporalEvidencePort {
  private readonly http: CtclHttpClient;

  constructor(options: CtclRestTemporalAdapterOptions = {}) {
    this.http = new CtclHttpClient(options);
  }

  async now(): Promise<TemporalEvidence> {
    return normalizeCtclInstantEvidence(await this.http.get('/v1/now'));
  }

  async registerInstant(input: RegisterInstantInput = {}): Promise<TemporalEvidence> {
    const body = definedEntries({
      value: input.value,
      encoding: input.encoding,
      timescale: input.timescale,
      label: input.label,
      meta: input.meta,
    });
    return normalizeCtclInstantEvidence(await this.http.post('/v1/instants', body));
  }

  async getInstant(id: string): Promise<TemporalEvidence> {
    if (id.length === 0) {
      throw new TemporalEvidenceError('invalid_input', 'CTCL instant id must not be empty', false);
    }
    return normalizeCtclInstantEvidence(
      await this.http.get(`/v1/instant/${encodeURIComponent(id)}`),
    );
  }

  async convert(input: TemporalConversionInput): Promise<TemporalConversionResult> {
    return normalizeCtclConversion(await this.http.post('/v1/convert', input));
  }

  async inspectBoundary(input: TemporalBoundaryInput): Promise<TemporalBoundaryResult> {
    const body = definedEntries({
      timezone: input.timezone,
      local_value: input.localValue,
      window_hours: input.windowHours,
      system_id: input.systemId,
      value: input.value,
      encoding: input.encoding,
    });
    return normalizeCtclBoundary(await this.http.post('/v1/boundaries/inspect', body));
  }

  async planSharedInstant(input: SharedInstantPlanInput): Promise<SharedInstantPlan> {
    const window = definedEntries({
      from: input.window.from,
      to: input.window.to,
      step_s: input.window.stepS,
    });
    return normalizeCtclPlan(
      await this.http.post('/v1/planner/shared-instant', {
        window,
        constraints: input.constraints,
      }),
    );
  }
}
