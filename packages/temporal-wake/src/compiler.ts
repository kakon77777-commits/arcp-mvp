import {
  TemporalEvidenceError,
  type TemporalEvidencePort,
} from '@arcp/temporal-evidence';
import { parseLocalDateTime, resolveIanaLocalDateTime } from './local-time.js';
import type { CompiledWakeTime, TemporalWakeIntent } from './types.js';

function invalidInput(message: string): TemporalEvidenceError {
  return new TemporalEvidenceError('invalid_input', message, false);
}

export class TemporalWakeCompiler {
  constructor(private readonly temporal: TemporalEvidencePort) {}

  async compile(intent: TemporalWakeIntent): Promise<CompiledWakeTime> {
    if (intent.kind === 'registered-instant') {
      if (intent.instantId.length === 0) throw invalidInput('registered instant id must not be empty');
      const evidence = await this.temporal.getInstant(intent.instantId);
      return { notBefore: evidence.instant };
    }

    if (intent.kind === 'local-datetime') {
      // Validate lexical/calendar shape before any provider call. CTCL remains
      // responsible for classifying the temporal boundary itself.
      parseLocalDateTime(intent.localValue);

      const boundary = await this.temporal.inspectBoundary({
        timezone: intent.timezone,
        localValue: intent.localValue,
      });

      if (boundary.status === 'gap') throw invalidInput('nonexistent local time');
      if (boundary.status === 'fold' && intent.foldResolution === undefined) {
        throw invalidInput('ambiguous local time requires foldResolution');
      }
      if (boundary.status !== 'normal' && boundary.status !== 'fold') {
        throw invalidInput(`unsupported local-time boundary status: ${boundary.status}`);
      }

      const unixMs = resolveIanaLocalDateTime({
        localValue: intent.localValue,
        timezone: intent.timezone,
        ...(intent.foldResolution === undefined ? {} : { foldResolution: intent.foldResolution }),
      });
      const evidence = await this.temporal.registerInstant({
        value: String(unixMs),
        encoding: 'unix_ms',
        timescale: 'posix',
        ...(intent.label === undefined ? {} : { label: intent.label }),
      });
      return { notBefore: evidence.instant, planningEvidence: boundary };
    }

    const plan = await this.temporal.planSharedInstant({
      window: intent.window,
      constraints: intent.constraints,
    });
    if (plan.best === null) throw invalidInput('CTCL planner found no candidate instant');

    const evidence = await this.temporal.registerInstant({
      value: plan.best.unixS,
      encoding: 'unix_s',
      timescale: 'posix',
      ...(intent.label === undefined ? {} : { label: intent.label }),
      meta: { planner_score: plan.best.score },
    });
    return { notBefore: evidence.instant, planningEvidence: plan };
  }
}
