import type { Stats } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import {
  ResidenceStorageError,
  sha256Bytes,
  type ResidenceStorageEntry,
} from '@arcp/residence-storage';
import { assertResidenceRelativePath, resolveResidencePath } from './path-guard.js';

function invalidPath(message: string, cause?: unknown): ResidenceStorageError {
  return new ResidenceStorageError(
    'invalid_path_or_ref',
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

export function filesystemRef(relativePath: string): string {
  assertResidenceRelativePath(relativePath);
  return `fs:${encodeURIComponent(relativePath)}`;
}

export function filesystemRevision(stats: Stats): string {
  return `fs:${stats.mtimeMs}:${stats.size}`;
}

function directoryEntry(relativePath: string, stats: Stats): ResidenceStorageEntry {
  return {
    ref: filesystemRef(relativePath),
    path: relativePath,
    kind: 'directory',
    size: null,
    modifiedAt: stats.mtime.toISOString(),
    contentHash: null,
    revision: filesystemRevision(stats),
  };
}

async function fileEntry(
  absolutePath: string,
  relativePath: string,
  stats: Stats,
): Promise<ResidenceStorageEntry> {
  const bytes = await readFile(absolutePath);
  return {
    ref: filesystemRef(relativePath),
    path: relativePath,
    kind: 'file',
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    contentHash: await sha256Bytes(bytes),
    revision: filesystemRevision(stats),
  };
}

async function scanDirectory(
  rootRealPath: string,
  absoluteDirectory: string,
  relativeDirectory: string,
  entries: ResidenceStorageEntry[],
): Promise<void> {
  const dirents = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const dirent of dirents) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${dirent.name}` : dirent.name;
    assertResidenceRelativePath(relativePath);

    if (dirent.isSymbolicLink()) {
      throw invalidPath(`symbolic links and junctions are not allowed in residence snapshots: ${relativePath}`);
    }

    const absolutePath = await resolveResidencePath(rootRealPath, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw invalidPath(`symbolic links and junctions are not allowed in residence snapshots: ${relativePath}`);
    }

    if (stats.isDirectory()) {
      entries.push(directoryEntry(relativePath, stats));
      await scanDirectory(rootRealPath, absolutePath, relativePath, entries);
      continue;
    }

    if (stats.isFile()) {
      entries.push(await fileEntry(absolutePath, relativePath, stats));
      continue;
    }

    throw invalidPath(`unsupported filesystem entry inside residence root: ${relativePath}`);
  }
}

export async function scanResidenceRoot(
  rootRealPath: string,
  prefix?: string,
): Promise<ResidenceStorageEntry[]> {
  const entries: ResidenceStorageEntry[] = [];

  if (prefix === undefined || prefix === '') {
    await scanDirectory(rootRealPath, rootRealPath, '', entries);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  assertResidenceRelativePath(prefix);
  const absolutePrefix = await resolveResidencePath(rootRealPath, prefix);

  let stats: Stats;
  try {
    stats = await lstat(absolutePrefix);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw invalidPath(`unable to inspect residence snapshot prefix: ${prefix}`, error);
  }

  if (stats.isSymbolicLink()) {
    throw invalidPath(`symbolic links and junctions are not allowed in residence snapshots: ${prefix}`);
  }
  if (stats.isFile()) {
    entries.push(await fileEntry(absolutePrefix, prefix, stats));
  } else if (stats.isDirectory()) {
    entries.push(directoryEntry(prefix, stats));
    await scanDirectory(rootRealPath, absolutePrefix, prefix, entries);
  } else {
    throw invalidPath(`unsupported filesystem entry inside residence root: ${prefix}`);
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
