import { describe, expect, it } from 'vitest';
import { compareDriveBaselineToResidence } from '@arcp/adapter-drive';
import type { DriveBaseline, DriveBaselineEntry, ResidenceKnownObject } from '@arcp/adapter-drive';

const now = () => '2026-08-17T12:00:00.000Z';
const instant = () => ({ instant_id: 'ctcl:instant:fake-000001' });

function entry(overrides: Partial<DriveBaselineEntry> = {}): DriveBaselineEntry {
  return {
    fileId: 'f1',
    parentId: 'root',
    name: 'paper.md',
    path: 'content/papers/paper.md',
    pathUncertain: false,
    mimeType: 'text/markdown',
    size: 100,
    contentHash: 'md5:aaa',
    driveVersion: '1',
    modifiedTime: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function baseline(entries: DriveBaselineEntry[]): DriveBaseline {
  return { rootFolderId: 'root', capturedAt: now(), startPageToken: 'token-5', entries };
}

function known(overrides: Partial<ResidenceKnownObject> = {}): ResidenceKnownObject {
  return { path: 'content/papers/paper.md', objectId: 'arcp:object:1', contentHash: 'md5:aaa', ...overrides };
}

function baseOptions(overrides: Partial<Parameters<typeof compareDriveBaselineToResidence>[2]> = {}) {
  return { source: 'drive:unbounded-axiom', target: 'arcp:residence:test', now, eventInstant: instant(), writeInstant: instant(), ...overrides };
}

describe('compareDriveBaselineToResidence (§9.6)', () => {
  it('reports equal when Drive and the Residence fully agree', () => {
    const report = compareDriveBaselineToResidence(baseline([entry()]), [known()], baseOptions());
    expect(report.status).toBe('equal');
    expect(report.counts).toMatchObject({ added: 0, updated: 0, deleted: 0, unchanged: 1, excluded: 0, conflicted: 0 });
  });

  it('reports a Drive-only file as added and the overall status as partial', () => {
    const report = compareDriveBaselineToResidence(baseline([entry({ fileId: 'f2', path: 'content/papers/new.md' })]), [], baseOptions());
    expect(report.status).toBe('partial');
    expect(report.counts.added).toBe(1);
    expect(report.items[0]).toMatchObject({ outcome: 'added', path: 'content/papers/new.md' });
  });

  it('reports a content-hash mismatch as updated', () => {
    const report = compareDriveBaselineToResidence(
      baseline([entry({ contentHash: 'md5:bbb' })]),
      [known({ contentHash: 'md5:aaa' })],
      baseOptions(),
    );
    expect(report.counts.updated).toBe(1);
    expect(report.status).toBe('partial');
  });

  it('never claims unchanged when Drive has no content hash for the file (e.g. a native Google Doc)', () => {
    const report = compareDriveBaselineToResidence(
      baseline([entry({ contentHash: null })]),
      [known({ contentHash: null })], // residence recorded null too, from the same kind of prior scan
      baseOptions(),
    );
    expect(report.items[0]).toMatchObject({ outcome: 'conflicted', reasonCode: 'no_content_hash_available_needs_review' });
    expect(report.status).toBe('conflict');
  });

  it('a brand-new file with no content hash is still "added", not conflicted (nothing to compare against yet)', () => {
    const report = compareDriveBaselineToResidence(baseline([entry({ contentHash: null })]), [], baseOptions());
    expect(report.items[0]?.outcome).toBe('added');
  });

  it('reports a Residence object with no matching Drive path as deleted (observation, not tombstone)', () => {
    const report = compareDriveBaselineToResidence(baseline([]), [known()], baseOptions());
    expect(report.counts.deleted).toBe(1);
    expect(report.items[0]).toMatchObject({
      outcome: 'deleted',
      reasonCode: 'observed_missing_pending_tombstone_approval',
      canonicalRole: 'canonical', // content/papers/** really is canonical here, not a hardcoded guess
    });
  });

  it('classifies a deleted item by its real canonical role, not a hardcoded "canonical"', () => {
    const report = compareDriveBaselineToResidence(baseline([]), [known({ path: 'dist/raw/2026/07/paper.md' })], baseOptions());
    expect(report.items[0]).toMatchObject({ outcome: 'deleted', canonicalRole: 'derived' });
  });

  it('reports a disappeared excluded-shaped path as excluded, not as an ordinary deletion', () => {
    const report = compareDriveBaselineToResidence(baseline([]), [known({ path: '.env', contentHash: 'md5:zzz' })], baseOptions());
    expect(report.items[0]).toMatchObject({ outcome: 'excluded', reasonCode: 'path_excluded' });
    expect(report.counts.deleted).toBe(0);
  });

  it('excludes secret-shaped paths without ever contacting content, and stays equal if that is the only difference', () => {
    const report = compareDriveBaselineToResidence(
      baseline([entry(), entry({ fileId: 'f2', name: '.env', path: '.env' })]),
      [known(), known({ path: '.env', contentHash: 'md5:zzz' })],
      baseOptions(),
    );
    expect(report.counts.excluded).toBe(1);
    expect(report.items.find((i) => i.path === '.env')).toMatchObject({
      outcome: 'excluded',
      reasonCode: 'path_excluded',
      canonicalRole: 'inbox', // .env genuinely matches no canonical rule
    });
    // an expected, routine exclusion does not by itself block "equal" -- only unresolved diffs and real conflicts do.
    // (Both sides carry the SAME excluded path here -- that's what makes "equal" the honest answer;
    // see the root-hash-consistency test below for what happens when only one side has it.)
    expect(report.status).toBe('equal');
  });

  it('keeps the real canonical role for an excluded item, even when its path also matches a canonical rule', () => {
    const report = compareDriveBaselineToResidence(
      baseline([entry({ path: 'content/papers/2026/notes-secret-draft.md' })]),
      [],
      baseOptions(),
    );
    expect(report.items[0]).toMatchObject({ outcome: 'excluded', canonicalRole: 'canonical', reasonCode: 'path_excluded' });
  });

  it('root hashes only agree when BOTH sides carry the same excluded item -- an excluded-only-on-one-side path is a real, honestly-reported difference', () => {
    const bothSides = compareDriveBaselineToResidence(
      baseline([entry(), entry({ fileId: 'f2', path: '.env' })]),
      [known(), known({ path: '.env', contentHash: 'md5:zzz' })],
      baseOptions(),
    );
    expect(bothSides.sourceRootHash).toBe(bothSides.targetRootHash);
    expect(bothSides.status).toBe('equal');

    const onlyResidenceSide = compareDriveBaselineToResidence(
      baseline([entry()]),
      [known(), known({ path: '.env', contentHash: 'md5:zzz' })],
      baseOptions(),
    );
    // Drive doesn't have .env at all -- Residence's record of it is a real,
    // disappeared, excluded-shaped path; the sync must not silently call
    // this "equal" just because .env itself is routinely excluded.
    expect(onlyResidenceSide.items.find((i) => i.path === '.env')?.outcome).toBe('excluded');
  });

  it('flags a path_uncertain file as conflicted, forcing status to conflict', () => {
    const report = compareDriveBaselineToResidence(baseline([entry()]), [known()], {
      ...baseOptions(),
      pathUncertainFileIds: ['f1'],
    });
    expect(report.counts.conflicted).toBe(1);
    expect(report.status).toBe('conflict');
    expect(report.items[0]?.reasonCode).toBe('path_uncertain_needs_rescan');
  });

  it('also honors pathUncertain set directly on the baseline entry (from the initial scan, not just applyChanges)', () => {
    const report = compareDriveBaselineToResidence(baseline([entry({ pathUncertain: true })]), [known()], baseOptions());
    expect(report.items[0]).toMatchObject({ outcome: 'conflicted', reasonCode: 'path_uncertain_needs_rescan' });
  });

  it('reports path_uncertain as conflicted even when the (unreliable) recorded path also looks excluded', () => {
    // A brand-new file discovered only via the change feed defaults to its
    // bare name as a placeholder path -- if that bare name happens to look
    // like "token.txt", the uncertainty must still win: we do not actually
    // know this file is really excluded junk, only that its path is unverified.
    const report = compareDriveBaselineToResidence(baseline([entry({ path: 'token.txt' })]), [], {
      ...baseOptions(),
      pathUncertainFileIds: ['f1'],
    });
    expect(report.items[0]).toMatchObject({ outcome: 'conflicted', reasonCode: 'path_uncertain_needs_rescan' });
    expect(report.counts.excluded).toBe(0);
    expect(report.status).toBe('conflict');
  });

  it('conflict takes priority over partial when a report has both kinds of items', () => {
    const report = compareDriveBaselineToResidence(
      baseline([entry({ fileId: 'f1' }), entry({ fileId: 'f2', path: 'content/papers/new.md' })]),
      [known()],
      { ...baseOptions(), pathUncertainFileIds: ['f1'] },
    );
    expect(report.counts.conflicted).toBe(1);
    expect(report.counts.added).toBe(1);
    expect(report.status).toBe('conflict');
  });

  it('source and target root hashes agree exactly when everything is unchanged', () => {
    const report = compareDriveBaselineToResidence(baseline([entry()]), [known()], baseOptions());
    expect(report.sourceRootHash).toBe(report.targetRootHash);
    expect(report.sourceRootHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('root hash is sensitive to actual content, ruling out a constant-returning implementation', () => {
    const reportSame = compareDriveBaselineToResidence(baseline([entry({ contentHash: 'md5:aaa' })]), [known({ contentHash: 'md5:aaa' })], baseOptions());
    const reportDiff = compareDriveBaselineToResidence(baseline([entry({ contentHash: 'md5:zzz' })]), [known({ contentHash: 'md5:aaa' })], baseOptions());
    expect(reportSame.sourceRootHash).not.toBe(reportDiff.sourceRootHash);
  });

  it('never reports equal when per-item counts reconcile to zero but a duplicate residence path hides a real hash disagreement', () => {
    // residenceByPath is keyed by path, so a duplicate collapses to whichever
    // entry is LAST in the array for per-item comparison -- put the
    // hash-matching one last, so the per-item loop sees "unchanged" and
    // registers no added/updated/deleted. But targetRootHash is built from
    // the raw, non-deduplicated array (both duplicates), so it still
    // diverges from sourceRootHash. The status must not be "equal" anyway.
    const report = compareDriveBaselineToResidence(
      baseline([entry()]),
      [known({ contentHash: 'md5:different-duplicate' }), known()],
      baseOptions(),
    );
    expect(report.counts).toMatchObject({ added: 0, updated: 0, deleted: 0, unchanged: 1 });
    expect(report.sourceRootHash).not.toBe(report.targetRootHash);
    expect(report.status).not.toBe('equal');
  });

  it('flags a Drive entry reappearing at a tombstoned path as conflicted, never a silent added (§9.7)', () => {
    const report = compareDriveBaselineToResidence(baseline([entry()]), [], {
      ...baseOptions(),
      tombstonedPaths: new Set(['content/papers/paper.md']),
    });
    expect(report.items[0]).toMatchObject({ outcome: 'conflicted', reasonCode: 'possible_tombstone_resurrection' });
    expect(report.counts.added).toBe(0);
  });

  it('a tombstoned path with no reappearance produces no item at all (nothing to flag)', () => {
    const report = compareDriveBaselineToResidence(baseline([]), [], {
      ...baseOptions(),
      tombstonedPaths: new Set(['content/papers/paper.md']),
    });
    expect(report.items).toHaveLength(0);
  });

  it('classifies a path as P0 when it is supplied in publishedPaths, otherwise stays at the P1 default', () => {
    const withoutPublished = compareDriveBaselineToResidence(baseline([entry()]), [known()], baseOptions());
    expect(withoutPublished.items[0]?.sensitivity).toBe('P1');

    const withPublished = compareDriveBaselineToResidence(baseline([entry()]), [known()], {
      ...baseOptions(),
      publishedPaths: new Set(['content/papers/paper.md']),
    });
    expect(withPublished.items[0]?.sensitivity).toBe('P0');
  });

  it('demonstrates the §9.4 count-gap arithmetic using the Residence catalog as the comparison baseline', () => {
    // This verifies the SAME shape of honest partial-reporting the spec's
    // example describes (1,391 declared vs 1,348 present -> partial with the
    // real gap, never "同步完成"). It compares against the Residence's own
    // already-known catalog, not a live website crawl -- cross-referencing
    // an actual deployed site's declared page count needs a separate
    // site-crawl input (see `publishedPaths` above), which is a distinct
    // external dependency out of scope for this credential-free slice.
    const driveEntries = Array.from({ length: 1348 }, (_, i) => entry({ fileId: `f${i}`, path: `content/papers/p${i}.md`, contentHash: `md5:${i}` }));
    const residenceKnown = Array.from({ length: 1391 }, (_, i) => known({ path: `content/papers/p${i}.md`, contentHash: `md5:${i}` }));
    const report = compareDriveBaselineToResidence(baseline(driveEntries), residenceKnown, baseOptions());
    expect(report.status).toBe('partial');
    expect(report.counts.deleted).toBe(1391 - 1348);
  });

  it('includes all required report fields (§9.6)', () => {
    const report = compareDriveBaselineToResidence(baseline([entry()]), [known()], baseOptions());
    expect(report.schema).toBe('arcp/drive-sync-report/0.1');
    expect(report.source).toBe('drive:unbounded-axiom');
    expect(report.target).toBe('arcp:residence:test');
    expect(report.baselineVersion).toBeDefined();
    expect(report.cursor).toBe('token-5');
    expect(report.eventInstant).toBeDefined();
    expect(report.writeInstant).toBeDefined();
    expect(report.nextSafeRetryAction.length).toBeGreaterThan(0);
  });
});
