import type {
  ResidenceStorageDiff,
  ResidenceStorageEntry,
  ResidenceStorageSnapshot,
} from './types.js';

export function emptyResidenceDiff(): ResidenceStorageDiff {
  return { added: [], changed: [], removed: [], moved: [] };
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function entryChanged(before: ResidenceStorageEntry, after: ResidenceStorageEntry): boolean {
  return (
    before.kind !== after.kind ||
    before.size !== after.size ||
    before.modifiedAt !== after.modifiedAt ||
    before.contentHash !== after.contentHash ||
    before.revision !== after.revision
  );
}

export function diffResidenceSnapshots(
  previous: ResidenceStorageSnapshot,
  current: ResidenceStorageSnapshot,
): ResidenceStorageDiff {
  const diff = emptyResidenceDiff();
  const previousByRef = new Map(previous.entries.map((entry) => [entry.ref, entry]));
  const currentByRef = new Map(current.entries.map((entry) => [entry.ref, entry]));

  for (const after of current.entries) {
    const before = previousByRef.get(after.ref);
    if (!before) {
      diff.added.push(after);
      continue;
    }

    if (before.path !== after.path) {
      diff.moved.push({ before, after });
      continue;
    }

    if (entryChanged(before, after)) {
      diff.changed.push({ before, after });
    }
  }

  for (const before of previous.entries) {
    if (!currentByRef.has(before.ref)) {
      diff.removed.push(before);
    }
  }

  diff.added.sort((left, right) => comparePath(left.path, right.path));
  diff.removed.sort((left, right) => comparePath(left.path, right.path));
  diff.changed.sort((left, right) => comparePath(left.after.path, right.after.path));
  diff.moved.sort((left, right) => comparePath(left.after.path, right.after.path));

  return diff;
}
