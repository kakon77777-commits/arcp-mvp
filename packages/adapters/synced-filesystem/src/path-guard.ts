import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { ResidenceStorageError } from '@arcp/residence-storage';

function invalidPath(message: string, cause?: unknown): ResidenceStorageError {
  return new ResidenceStorageError(
    'invalid_path_or_ref',
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function isContained(rootRealPath: string, absolutePath: string): boolean {
  const rel = relative(rootRealPath, absolutePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertContained(rootRealPath: string, absolutePath: string): void {
  if (!isContained(rootRealPath, absolutePath)) {
    throw invalidPath('resolved residence path escapes the configured root');
  }
}

export function assertResidenceRelativePath(path: string): void {
  if (path.length === 0) {
    throw invalidPath('residence path must not be empty');
  }
  if (path.includes('\0')) {
    throw invalidPath('residence path must not contain NUL');
  }
  if (path.includes('\\')) {
    throw invalidPath('residence path must use POSIX separators only');
  }
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw invalidPath('residence path must be relative to the configured root');
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidPath('residence path must be normalized without empty, dot, or dot-dot segments');
  }
}

export async function resolveResidencePath(
  rootRealPath: string,
  relativePath: string,
): Promise<string> {
  assertResidenceRelativePath(relativePath);

  const segments = relativePath.split('/');
  let current = rootRealPath;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const candidate = join(current, segment);

    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw invalidPath(`symbolic links and junctions are not allowed in residence paths: ${relativePath}`);
      }
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw invalidPath(`non-directory component in residence path: ${relativePath}`);
      }
      current = candidate;
    } catch (error) {
      if (error instanceof ResidenceStorageError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw invalidPath(`unable to inspect residence path: ${relativePath}`, error);
      }

      if (index !== segments.length - 1) {
        throw invalidPath(`parent directory does not exist inside residence root: ${relativePath}`);
      }

      let parentRealPath: string;
      try {
        parentRealPath = await realpath(current);
      } catch (parentError) {
        throw invalidPath(`unable to resolve parent directory for residence path: ${relativePath}`, parentError);
      }
      assertContained(rootRealPath, parentRealPath);
      return join(parentRealPath, segment);
    }
  }

  let targetRealPath: string;
  try {
    targetRealPath = await realpath(current);
  } catch (error) {
    throw invalidPath(`unable to resolve residence path: ${relativePath}`, error);
  }
  assertContained(rootRealPath, targetRealPath);
  return targetRealPath;
}
