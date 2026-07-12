import { contentHash } from './canonical.js';

/**
 * H_r = H(sort(O_v) || E_c || P_v || F_l) per
 * arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §5.5.
 * Not a blockchain — just a stable comparison basis for export, sync,
 * recovery and migration.
 */
export interface RootHashInput {
  objectVersions: Array<{ object_id: string; version: number; content_hash: string }>;
  eventCursor: string;
  policyVersion: number;
  fencingToken: number;
}

export function computeRootHash(input: RootHashInput): string {
  const sortedVersions = [...input.objectVersions].sort((a, b) => {
    if (a.object_id !== b.object_id) return a.object_id < b.object_id ? -1 : 1;
    return a.version - b.version;
  });
  return contentHash({
    object_versions: sortedVersions,
    event_cursor: input.eventCursor,
    policy_version: input.policyVersion,
    fencing_token: input.fencingToken,
  });
}
