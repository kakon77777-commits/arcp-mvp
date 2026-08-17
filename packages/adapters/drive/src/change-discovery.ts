import { DRIVE_FOLDER_MIME_TYPE, DriveCursorExpiredError } from './google-drive-types.js';
import type { DriveApiClientLike, DriveFileLike } from './google-drive-types.js';

export interface DriveBaselineEntry {
  fileId: string;
  parentId: string | null;
  name: string;
  path: string;
  mimeType: string;
  size: number | null;
  contentHash: string | null;
  modifiedTime: string;
  /** §9.3's required "Drive version" field — null only if the client never populated it. */
  driveVersion: string | null;
  /**
   * True when `path` could not be verified against the scanned folder tree
   * and must not be trusted for comparison — see `resolvePath` and
   * `applyChanges`'s `pathUncertainFileIds`. Kept on the entry itself (not
   * only in the separate incremental-changes list) so a caller consuming
   * just `DriveBaseline.entries` still sees the signal.
   */
  pathUncertain: boolean;
}

export interface DriveBaseline {
  rootFolderId: string;
  capturedAt: string;
  startPageToken: string;
  entries: DriveBaselineEntry[];
}

/**
 * §9.3 step 1-4: the start page token is fetched *before* the recursive
 * scan begins, so any change that lands mid-scan is still covered by the
 * very first incremental `applyChanges` call afterward — nothing in that
 * window is silently missed.
 */
export async function scanBaseline(
  client: DriveApiClientLike,
  rootFolderId: string,
  now: () => string,
): Promise<DriveBaseline> {
  const startPageToken = await client.getStartPageToken();

  const allById = new Map<string, DriveFileLike>();
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);

    let pageToken: string | undefined;
    do {
      const page = await client.listFiles({
        query: `'${folderId}' in parents and trashed = false`,
        pageToken,
      });
      for (const file of page.files) {
        allById.set(file.id, file);
        if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) queue.push(file.id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  const entries = [...allById.values()]
    .filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE)
    .map((file) => toBaselineEntry(file, allById, rootFolderId));

  return { rootFolderId, capturedAt: now(), startPageToken, entries };
}

function toBaselineEntry(
  file: DriveFileLike,
  allById: Map<string, DriveFileLike>,
  rootFolderId: string,
): DriveBaselineEntry {
  const resolved = resolvePath(file, allById, rootFolderId);
  return {
    fileId: file.id,
    parentId: file.parents?.[0] ?? null,
    name: file.name,
    path: resolved.path,
    pathUncertain: resolved.uncertain,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : null,
    contentHash: file.md5Checksum ? `md5:${file.md5Checksum}` : null,
    driveVersion: file.version ?? null,
    modifiedTime: file.modifiedTime ?? '',
  };
}

/**
 * Walks the ancestor chain via `parents[0]`. Google Drive does not guarantee
 * that a multi-parent file's first `parents` entry is the folder it was
 * actually discovered under via this scan's BFS — if that walk can't reach
 * `rootFolderId` (the recorded parent isn't in the scanned set, or a cycle
 * is hit), the path is not trustworthy. Returning it anyway (as a
 * best-effort, possibly-bare name) together with `uncertain: true` lets a
 * caller still see *something* while never treating it as verified.
 */
function resolvePath(
  file: DriveFileLike,
  allById: Map<string, DriveFileLike>,
  rootFolderId: string,
): { path: string; uncertain: boolean } {
  const segments: string[] = [file.name];
  let currentParent = file.parents?.[0];
  const guard = new Set<string>();
  while (currentParent && currentParent !== rootFolderId && !guard.has(currentParent)) {
    guard.add(currentParent);
    const parent = allById.get(currentParent);
    if (!parent) {
      return { path: segments.join('/'), uncertain: true };
    }
    segments.unshift(parent.name);
    currentParent = parent.parents?.[0];
  }
  return { path: segments.join('/'), uncertain: currentParent !== rootFolderId };
}

export interface DriveChangeApplication {
  baseline: DriveBaseline;
  cursorLost: boolean;
  /**
   * Files whose correct current path could not be established from the
   * change feed alone: renames, moves, and brand-new files first seen
   * through `changes.list` (its payload doesn't carry the new parent's own
   * path, and a newly-discovered file's ancestor chain isn't guaranteed to
   * be in this baseline). Never silently assigned a guessed path — a
   * caller should re-verify these via the next full rescan. Mirrors each
   * affected entry's own `pathUncertain: true`.
   */
  pathUncertainFileIds: string[];
}

/**
 * §9.3 step 5-6: applies the incremental change feed to an existing
 * baseline. A lost/expired cursor returns `cursorLost: true` with the
 * baseline untouched — the caller must call `scanBaseline` again, never
 * infer what might have happened during the gap.
 */
export async function applyChanges(
  client: DriveApiClientLike,
  baseline: DriveBaseline,
  now: () => string,
): Promise<DriveChangeApplication> {
  let firstPage;
  try {
    firstPage = await client.listChanges({ pageToken: baseline.startPageToken });
  } catch (error) {
    if (error instanceof DriveCursorExpiredError) {
      return { baseline, cursorLost: true, pathUncertainFileIds: [] };
    }
    throw error;
  }

  const allChanges = [...firstPage.changes];
  let newStartPageToken = firstPage.newStartPageToken ?? baseline.startPageToken;
  let pageToken = firstPage.nextPageToken;
  while (pageToken) {
    const page = await client.listChanges({ pageToken });
    allChanges.push(...page.changes);
    newStartPageToken = page.newStartPageToken ?? newStartPageToken;
    pageToken = page.nextPageToken;
  }

  const entriesById = new Map(baseline.entries.map((entry) => [entry.fileId, entry]));
  const pathUncertainFileIds: string[] = [];

  for (const change of allChanges) {
    if (change.removed || !change.file || change.file.trashed) {
      entriesById.delete(change.fileId);
      continue;
    }
    if (change.file.mimeType === DRIVE_FOLDER_MIME_TYPE) continue;

    const priorEntry = entriesById.get(change.fileId);
    const newParentId = change.file.parents?.[0] ?? null;
    const moved = priorEntry !== undefined && priorEntry.parentId !== newParentId;
    const renamed = priorEntry !== undefined && priorEntry.name !== change.file.name;
    const uncertain = !priorEntry || moved || renamed;

    if (uncertain) {
      pathUncertainFileIds.push(change.fileId);
    }

    entriesById.set(change.fileId, {
      fileId: change.fileId,
      parentId: newParentId,
      name: change.file.name,
      // Content-only edits keep the known-good path. A move/rename/new file
      // keeps whatever path is available (stale for a move/rename, a bare
      // name for a genuinely new file) — it is flagged uncertain, not trusted.
      path: priorEntry?.path ?? change.file.name,
      pathUncertain: uncertain,
      mimeType: change.file.mimeType,
      size: change.file.size ? Number(change.file.size) : null,
      contentHash: change.file.md5Checksum ? `md5:${change.file.md5Checksum}` : null,
      driveVersion: change.file.version ?? priorEntry?.driveVersion ?? null,
      modifiedTime: change.file.modifiedTime ?? now(),
    });
  }

  return {
    baseline: { ...baseline, startPageToken: newStartPageToken, capturedAt: now(), entries: [...entriesById.values()] },
    cursorLost: false,
    pathUncertainFileIds,
  };
}
