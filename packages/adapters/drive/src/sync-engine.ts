import { contentHash } from '@arcp/schema';
import type { CanonicalRole, InstantRef, Sensitivity } from '@arcp/schema';
import type { DriveBaseline } from './change-discovery.js';
import { DEFAULT_CANONICAL_RULES, classifyCanonicalRole } from './canonical-classifier.js';
import type { CanonicalClassificationRule } from './canonical-classifier.js';
import { DEFAULT_EXCLUSION_PATTERNS, classifySensitivity, isExcludedPath } from './sensitivity-rules.js';

export type DriveSyncStatus = 'equal' | 'ahead' | 'partial' | 'policy_blocked' | 'conflict' | 'integrity_failed';
export type DriveSyncItemOutcome = 'added' | 'updated' | 'deleted' | 'unchanged' | 'excluded' | 'conflicted';

export interface DriveSyncItem {
  path: string;
  fileId: string;
  outcome: DriveSyncItemOutcome;
  canonicalRole: CanonicalRole;
  sensitivity: Sensitivity;
  reasonCode?: string;
}

export interface DriveSyncReport {
  schema: 'arcp/drive-sync-report/0.1';
  source: string;
  target: string;
  baselineVersion: string;
  cursor: string;
  counts: {
    added: number;
    updated: number;
    deleted: number;
    unchanged: number;
    excluded: number;
    conflicted: number;
  };
  items: DriveSyncItem[];
  sourceRootHash: string;
  targetRootHash: string;
  status: DriveSyncStatus;
  eventInstant: InstantRef;
  writeInstant: InstantRef;
  nextSafeRetryAction: string;
}

export interface ResidenceKnownObject {
  path: string;
  objectId: string;
  contentHash: string | null;
}

export interface CompareDriveOptions {
  source: string;
  target: string;
  now: () => string;
  eventInstant: InstantRef;
  writeInstant: InstantRef;
  exclusionPatterns?: string[];
  canonicalRules?: CanonicalClassificationRule[];
  /**
   * From `applyChanges()` — files whose current path could not be verified
   * during incremental change application. Merged with each entry's own
   * `pathUncertain` flag (which also covers files flagged uncertain during
   * the *initial* baseline scan itself, e.g. an unresolvable multi-parent
   * ancestor chain) — either source is enough to report `conflicted`.
   */
  pathUncertainFileIds?: string[];
  /**
   * Paths independently confirmed live on a public source (e.g. cross-
   * referenced against the deployed site's own page list) — feeds
   * `classifySensitivity`'s `isPublished` flag so the P0 tier is reachable.
   * This function does not fetch or verify that list itself: §9.4's "the
   * website declares 1,391 while Drive has 1,348" scenario needs a separate
   * site-crawl step to produce it, which is a distinct external dependency
   * out of scope for this credential-free slice. Omitting this option keeps
   * every item at P1 or below, exactly as before.
   */
  publishedPaths?: Set<string>;
  /**
   * Paths currently under an active tombstone (§9.7 — build this with
   * `deletion-observation.ts`'s `isResurrectionBlocked` over your tombstone
   * list; taking a plain path set here, rather than importing that module's
   * types, avoids a circular import since `deletion-observation.ts` already
   * imports `DriveSyncReport` from this file). A Drive entry reappearing at
   * one of these paths is reported `conflicted`, never silently re-`added`
   * — "反向同步時有效 tombstone 優先於舊 replica，防止被刪資料復活".
   */
  tombstonedPaths?: Set<string>;
}

function sortedPathHashPairs(items: Array<{ path: string; contentHash: string | null }>) {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function nextSafeRetryActionFor(status: DriveSyncStatus): string {
  switch (status) {
    case 'equal':
      return 'none — source and target already agree';
    case 'partial':
      return 'resolve the added/updated/deleted items (or accept them) and rebaseline';
    case 'conflict':
      return 'rescan the path_uncertain files (a targeted or full rebaseline) before retrying compare';
    case 'policy_blocked':
      return 'review the flagged items for policy approval before retrying';
    case 'ahead':
      return 'reconcile target-side changes back to the source before retrying';
    case 'integrity_failed':
      return 'do not retry automatically — verify hashes manually first';
  }
}

interface Classified {
  role: CanonicalRole;
  sensitivity: Sensitivity;
  excluded: boolean;
}

function classify(
  path: string,
  canonicalRules: CanonicalClassificationRule[],
  exclusionPatterns: string[],
  publishedPaths: Set<string> | undefined,
): Classified {
  const { role } = classifyCanonicalRole(path, canonicalRules);
  const { sensitivity } = classifySensitivity({
    path,
    canonicalRole: role,
    exclusionPatterns,
    isPublished: publishedPaths?.has(path),
  });
  return { role, sensitivity, excluded: isExcludedPath(path, exclusionPatterns) };
}

/**
 * §9.6 compare stage. This is metadata-only — content-level secret scanning
 * (§9.5's `scanForSuspectedSecret`) is a separate, later step that runs when
 * a file's bytes are actually about to be transferred, not during this
 * compare pass. Because of that, `policy_blocked`/`ahead`/`integrity_failed`
 * are not reachable from this function alone in Phase 2 v0.1 — they're
 * defined here for the full status vocabulary but only become reachable
 * once transfer, content scanning, and reverse-sync exist.
 */
export function compareDriveBaselineToResidence(
  baseline: DriveBaseline,
  residenceObjects: ResidenceKnownObject[],
  options: CompareDriveOptions,
): DriveSyncReport {
  const exclusionPatterns = options.exclusionPatterns ?? DEFAULT_EXCLUSION_PATTERNS;
  const canonicalRules = options.canonicalRules ?? DEFAULT_CANONICAL_RULES;
  const uncertainFileIds = new Set(options.pathUncertainFileIds ?? []);

  const items: DriveSyncItem[] = [];
  const residenceByPath = new Map(residenceObjects.map((object) => [object.path, object]));
  const seenPaths = new Set<string>();

  for (const entry of baseline.entries) {
    seenPaths.add(entry.path);
    const { role, sensitivity, excluded } = classify(entry.path, canonicalRules, exclusionPatterns, options.publishedPaths);

    // Not knowing the file's real location takes priority over any
    // path-based judgement about that (possibly wrong) location — including
    // whether it looks excluded. Checked first, ahead of exclusion.
    if (uncertainFileIds.has(entry.fileId) || entry.pathUncertain) {
      items.push({
        path: entry.path,
        fileId: entry.fileId,
        outcome: 'conflicted',
        canonicalRole: role,
        sensitivity,
        reasonCode: 'path_uncertain_needs_rescan',
      });
      continue;
    }

    if (excluded) {
      items.push({
        path: entry.path,
        fileId: entry.fileId,
        outcome: 'excluded',
        canonicalRole: role,
        sensitivity,
        reasonCode: 'path_excluded',
      });
      continue;
    }

    const known = residenceByPath.get(entry.path);
    if (!known && options.tombstonedPaths?.has(entry.path)) {
      items.push({
        path: entry.path,
        fileId: entry.fileId,
        outcome: 'conflicted',
        canonicalRole: role,
        sensitivity,
        reasonCode: 'possible_tombstone_resurrection',
      });
    } else if (!known) {
      items.push({ path: entry.path, fileId: entry.fileId, outcome: 'added', canonicalRole: role, sensitivity });
    } else if (entry.contentHash === null) {
      // Drive never populates a checksum for some MIME types (native Google
      // Docs/Sheets/Slides chief among them). We have no reliable signal
      // either way here — never claim `unchanged` when we can't verify that,
      // matching this codebase's "don't claim more certainty than you have"
      // rule everywhere else (§2.5).
      items.push({
        path: entry.path,
        fileId: entry.fileId,
        outcome: 'conflicted',
        canonicalRole: role,
        sensitivity,
        reasonCode: 'no_content_hash_available_needs_review',
      });
    } else if (known.contentHash !== entry.contentHash) {
      items.push({ path: entry.path, fileId: entry.fileId, outcome: 'updated', canonicalRole: role, sensitivity });
    } else {
      items.push({ path: entry.path, fileId: entry.fileId, outcome: 'unchanged', canonicalRole: role, sensitivity });
    }
  }

  for (const known of residenceObjects) {
    if (seenPaths.has(known.path)) continue;
    const { role, sensitivity, excluded } = classify(known.path, canonicalRules, exclusionPatterns, options.publishedPaths);
    items.push({
      path: known.path,
      fileId: '',
      outcome: excluded ? 'excluded' : 'deleted',
      canonicalRole: role,
      sensitivity,
      reasonCode: excluded ? 'path_excluded' : 'observed_missing_pending_tombstone_approval',
    });
  }

  const counts = { added: 0, updated: 0, deleted: 0, unchanged: 0, excluded: 0, conflicted: 0 };
  for (const item of items) counts[item.outcome] += 1;

  const sourceRootHash = contentHash(
    sortedPathHashPairs(
      baseline.entries
        .filter((entry) => !isExcludedPath(entry.path, exclusionPatterns))
        .map((entry) => ({ path: entry.path, contentHash: entry.contentHash })),
    ),
  );
  const targetRootHash = contentHash(
    sortedPathHashPairs(
      residenceObjects
        .filter((object) => !isExcludedPath(object.path, exclusionPatterns))
        .map((object) => ({ path: object.path, contentHash: object.contentHash })),
    ),
  );

  let status: DriveSyncStatus;
  if (counts.conflicted > 0) {
    status = 'conflict';
  } else if (counts.added > 0 || counts.updated > 0 || counts.deleted > 0) {
    status = 'partial';
  } else if (sourceRootHash !== targetRootHash) {
    // Counts alone reconciled to zero-diff, but the aggregate hash disagrees
    // — trust the hash, not the count, and never report `equal` here.
    status = 'partial';
  } else {
    status = 'equal';
  }

  return {
    schema: 'arcp/drive-sync-report/0.1',
    source: options.source,
    target: options.target,
    baselineVersion: baseline.capturedAt,
    cursor: baseline.startPageToken,
    counts,
    items,
    sourceRootHash,
    targetRootHash,
    status,
    eventInstant: options.eventInstant,
    writeInstant: options.writeInstant,
    nextSafeRetryAction: nextSafeRetryActionFor(status),
  };
}
