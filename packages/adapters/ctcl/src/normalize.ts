import {
  TemporalEvidenceError,
  type SharedInstantCandidate,
  type SharedInstantPlan,
  type TemporalBoundaryResult,
  type TemporalBoundaryStatus,
  type TemporalConversionResult,
  type TemporalEvidence,
} from '@arcp/temporal-evidence';
import {
  asCtclObject,
  ctclRequiredBoolean,
  ctclRequiredNumber,
  ctclRequiredString,
} from './http.js';

const BOUNDARY_STATUSES = new Set<TemporalBoundaryStatus>([
  'normal',
  'gap',
  'fold',
  'pause',
  'rate_change',
]);

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return ctclRequiredNumber(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return ctclRequiredBoolean(value, field);
}

function normalizeTimescale(value: unknown): 'utc' | 'posix' {
  const timescale = ctclRequiredString(value, 'instant.reference.timescale');
  if (timescale !== 'utc' && timescale !== 'posix') {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `unsupported CTCL timescale in evidence: ${timescale}`,
      false,
    );
  }
  return timescale;
}

export function normalizeCtclInstantEvidence(data: unknown): TemporalEvidence {
  const root = asCtclObject(data, 'instant data');
  const instant = asCtclObject(root.instant, 'instant');
  const reference = asCtclObject(instant.reference, 'instant reference');
  const encodings = asCtclObject(root.encodings, 'encodings');
  const source = asCtclObject(root.source, 'source');
  const quality = asCtclObject(root.quality, 'quality');

  const id = ctclRequiredString(instant.id, 'instant.id');
  const timescale = normalizeTimescale(reference.timescale);
  const canonicalUnixNs = ctclRequiredString(encodings.unix_ns, 'encodings.unix_ns');
  const sourceClass = ctclRequiredString(source.class, 'source.class');
  const precision = ctclRequiredString(quality.precision, 'quality.precision');
  const estimatedUncertaintyNs = optionalNumber(
    quality.estimated_uncertainty_ns,
    'quality.estimated_uncertainty_ns',
  );
  const synchronized = optionalBoolean(quality.synchronized, 'quality.synchronized');

  let attestation: TemporalEvidence['attestation'];
  let persistedAttestation: TemporalEvidence['instant']['attestation'];
  if (root.signature !== undefined && root.signature !== null) {
    const signature = asCtclObject(root.signature, 'signature');
    const alg = ctclRequiredString(signature.alg, 'signature.alg');
    const keyId = ctclRequiredString(signature.key_id, 'signature.key_id');
    const signedFields = ctclRequiredString(signature.signed_fields, 'signature.signed_fields');
    const value = ctclRequiredString(signature.value, 'signature.value');
    attestation = { alg, keyId, signedFields, value };
    persistedAttestation = {
      alg,
      key_id: keyId,
      signed_fields: signedFields,
      value,
    };
  }

  return {
    instant: {
      instant_id: id,
      timescale,
      encoding: 'unix_ns',
      value: canonicalUnixNs,
      source_quality: {
        source_class: sourceClass,
        precision,
        ...(estimatedUncertaintyNs === undefined
          ? {}
          : { estimated_uncertainty_ns: estimatedUncertaintyNs }),
        ...(synchronized === undefined ? {} : { synchronized }),
      },
      ...(persistedAttestation === undefined ? {} : { attestation: persistedAttestation }),
    },
    canonicalUnixNs,
    sourceQuality: {
      sourceClass,
      precision,
      ...(estimatedUncertaintyNs === undefined ? {} : { estimatedUncertaintyNs }),
      ...(synchronized === undefined ? {} : { synchronized }),
    },
    ...(attestation === undefined ? {} : { attestation }),
    verification: 'provider-asserted',
  };
}

export function normalizeCtclConversion(data: unknown): TemporalConversionResult {
  const root = asCtclObject(data, 'conversion data');
  const output = asCtclObject(root.output, 'conversion output');
  const quality = asCtclObject(root.quality, 'conversion quality');
  return {
    value: ctclRequiredString(output.value, 'output.value'),
    canonicalUnixNs: ctclRequiredString(root.canonical_unix_ns, 'canonical_unix_ns'),
    lossless: ctclRequiredBoolean(quality.lossless, 'quality.lossless'),
  };
}

export function normalizeCtclBoundary(data: unknown): TemporalBoundaryResult {
  const root = asCtclObject(data, 'boundary data');
  const rawStatus = ctclRequiredString(root.status, 'status');
  if (!BOUNDARY_STATUSES.has(rawStatus as TemporalBoundaryStatus)) {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `malformed CTCL boundary status: ${rawStatus}`,
      false,
    );
  }
  return {
    status: rawStatus as TemporalBoundaryStatus,
    safe: ctclRequiredBoolean(root.safe, 'safe'),
    detail: root.detail ?? null,
  };
}

function normalizeCandidate(value: unknown, field: string): SharedInstantCandidate {
  const candidate = asCtclObject(value, field);
  if (!Array.isArray(candidate.satisfied)) {
    throw new TemporalEvidenceError('unknown_backend_error', `malformed CTCL ${field}.satisfied`, false);
  }
  if (!Array.isArray(candidate.violated)) {
    throw new TemporalEvidenceError('unknown_backend_error', `malformed CTCL ${field}.violated`, false);
  }
  if (!Array.isArray(candidate.unsupported)) {
    throw new TemporalEvidenceError('unknown_backend_error', `malformed CTCL ${field}.unsupported`, false);
  }
  return {
    unixS: ctclRequiredString(candidate.unix_s, `${field}.unix_s`),
    score: ctclRequiredNumber(candidate.score, `${field}.score`),
    satisfied: [...candidate.satisfied],
    violated: [...candidate.violated],
    unsupported: [...candidate.unsupported],
  };
}

export function normalizeCtclPlan(data: unknown): SharedInstantPlan {
  const root = asCtclObject(data, 'planner data');
  if (!Array.isArray(root.alternatives)) {
    throw new TemporalEvidenceError('unknown_backend_error', 'malformed CTCL alternatives', false);
  }

  let best: SharedInstantCandidate | null;
  if (root.best === null || root.best === undefined) {
    best = null;
  } else {
    best = normalizeCandidate(root.best, 'best');
  }

  let explanation: string | null = null;
  if (root.explanation !== null && root.explanation !== undefined) {
    explanation = ctclRequiredString(root.explanation, 'explanation');
  }

  return {
    best,
    alternatives: root.alternatives.map((candidate, index) =>
      normalizeCandidate(candidate, `alternatives[${index}]`),
    ),
    explanation,
  };
}
