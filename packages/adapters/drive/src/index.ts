/**
 * Fake Google Drive Residence Adapter for Phase 0 (§9). This is a fixture-
 * backed stand-in for change discovery and canonical/derived mapping — no
 * network calls, no OAuth. The real adapter (Phase 2) implements the same
 * `diffAgainst` contract against the actual Drive changes API.
 */
export interface FakeDriveFile {
  fileId: string;
  name: string;
  path: string;
  modifiedTime: string;
  contentHash: string;
  mimeType: string;
}

export interface DriveDiff {
  added: FakeDriveFile[];
  changed: FakeDriveFile[];
  removed: FakeDriveFile[];
}

export class FakeDriveAdapter {
  private files: FakeDriveFile[];

  constructor(initialFiles: FakeDriveFile[] = []) {
    this.files = [...initialFiles];
  }

  listBaseline(): FakeDriveFile[] {
    return [...this.files];
  }

  /** Simulates a Drive-side create or update. */
  applyChange(file: FakeDriveFile): void {
    const index = this.files.findIndex((f) => f.fileId === file.fileId);
    if (index >= 0) this.files[index] = file;
    else this.files.push(file);
  }

  /** Simulates a Drive-side delete (observation only — no cascading delete). */
  removeFile(fileId: string): void {
    this.files = this.files.filter((f) => f.fileId !== fileId);
  }

  diffAgainst(baseline: FakeDriveFile[]): DriveDiff {
    const baselineById = new Map(baseline.map((f) => [f.fileId, f]));
    const currentById = new Map(this.files.map((f) => [f.fileId, f]));

    const added = this.files.filter((f) => !baselineById.has(f.fileId));
    const changed = this.files.filter((f) => {
      const prior = baselineById.get(f.fileId);
      return prior !== undefined && prior.contentHash !== f.contentHash;
    });
    const removed = baseline.filter((f) => !currentById.has(f.fileId));

    return { added, changed, removed };
  }
}
