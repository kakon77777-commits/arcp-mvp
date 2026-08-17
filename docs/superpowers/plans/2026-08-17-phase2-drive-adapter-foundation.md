# Phase 2 Drive Adapter Foundation Implementation Plan

> **For agentic workers:** Continue test-first. Do not request Google OAuth or
> service-account credentials until Gate B below. This slice is comparison
> and reporting only — no bytes are transferred into the Residence yet.

**Goal:** Build the credential-free application logic for the Google Drive
Residence Adapter (MVP spec §9) so a real OAuth/service-account client can be
plugged in later without changing any comparison, classification, or
reporting logic.

**Scope boundary (MVP spec §17 Phase 2 acceptance):** produce an explainable
count/hash/diff report for `unbounded-axiom`; never read or write excluded
secrets; report `partial` honestly rather than claiming `equal`. Actual file
transfer into the Residence is out of scope for this slice.

**Prior art checked:** `unbounded-axiom/scripts/ingest.py` reads from a local
folder (`ingest/01-before`), not the Drive API — there is no existing
OAuth/service-account precedent in this codebase to reuse. ADR #3
(authentication mode) is still genuinely open and deferred to Gate B.

## Global constraints

- No Google OAuth client secrets, refresh tokens, or service-account keys in
  Git, ever — this repo is public.
- `DriveApiClientLike` is a minimal structural interface (same pattern as
  `D1DatabaseLike`/`R2BucketLike` in the Cloudflare adapter) — no
  `googleapis` npm dependency, no real network calls in this slice.
- Path-based exclusion is a first filter, not a security boundary by itself —
  every object still needs a P0-P3 sensitivity classification, and a
  content-level secret scan flags what path rules miss.
- Never guess a missing event. A lost/expired change cursor triggers a full
  rebaseline signal, not an inferred diff.
- A file whose Drive-side rename/move can't be resolved from the change feed
  alone is flagged `path_uncertain`, never silently assigned a guessed path.

---

### Task 1: Drive API types + glob matcher — COMPLETE

- [x] `DriveFileLike`, `DriveApiClientLike` (listFiles/getStartPageToken/listChanges/getFileContent) matching real Drive API v3 shapes closely enough to be a faithful contract. Includes `version` (§9.3's "Drive version" requirement).
- [x] Dependency-free glob matcher (`**`, `*`) shared by exclusion and canonical-role rules. Escapes all 12 JS regex metacharacters (including `?`), optional case-insensitive mode.

### Task 2: Sensitivity/exclusion rules (§9.5) — COMPLETE

- [x] Default exclusion glob patterns from the spec, plus `.npmrc`/`.netrc`/bare `credentials`/SSH private keys/`.pem`/`.key`/GCP service-account key filenames — matched case-insensitively.
- [x] P0-P3 sensitivity classifier, `isPublished` wired to a real (caller-supplied) `publishedPaths` input.
- [x] Heuristic secret-content scanner — PEM, AWS access key, JWT, Google OAuth access/refresh token, Google API key, and a generic key-name-assignment pattern that matches compound identifiers (`client_secret`, `AWS_SECRET_ACCESS_KEY`) and base64-shaped values. Never logs the matched content.

### Task 3: Canonical/derived classifier (§9.4) — COMPLETE

- [x] Configurable path-pattern rule table; unclassified paths default to `inbox`, never `canonical`.
- [x] Ships the spec's own `unbounded-axiom` example rule set as the default.

### Task 4: Change discovery (§9.3) — COMPLETE

- [x] Baseline: start-page-token fetched *before* the recursive folder scan, so no change during the scan is missed.
- [x] Recursive BFS over the folder tree with real path resolution via the parent chain. A baseline-scan-time path that can't be verified (e.g. a multi-parent file whose `parents[0]` isn't the folder actually discovered via BFS) is flagged `pathUncertain` on the entry itself, not silently reduced to a bare filename.
- [x] Incremental `changes.list` application; content-only changes update in place; renames/moves/first-seen-via-change-feed files that can't be resolved from the change feed alone are flagged `path_uncertain`, not guessed.
- [x] Cursor-lost/expired triggers an explicit rebaseline signal.

### Task 5: Sync/compare engine + report (§9.6) — COMPLETE

- [x] `compareDriveBaselineToResidence()` produces the full report: source/target, baseline version/cursor, added/updated/deleted/unchanged/excluded/conflicted counts, per-item reason codes, source/target root hash, status (`equal|ahead|partial|policy_blocked|conflict|integrity_failed`), event/write instant, next safe retry action.
- [x] Status precedence resolved deterministically: `path_uncertain` > exclusion > normal compare; `conflicted` > `partial` (hash-disagreement) > `equal` overall.
- [x] `tombstonedPaths` option wires §9.7's resurrection-blocking into the compare pass itself (see Task 6).
- [x] `publishedPaths` option makes the `P0`/`isPublished` sensitivity tier genuinely reachable.

### Task 6: Deletion observation / tombstone (§9.7) — COMPLETE

- [x] Drive-side disappearance creates an observation, never an immediate tombstone.
- [x] Tombstone promotion is a separate, explicit call (real policy-gating is the caller's job, same separation of concerns as the rest of this codebase).
- [x] A tombstoned path blocks resurrection from a stale replica on reverse sync — wired end-to-end into `compareDriveBaselineToResidence` via `tombstonedPaths`, verified with an integration test crossing both modules, not just each one in isolation.

## Task 7: Explicit human/live-integration gate

#### Gate B — first live Google Drive adapter test

Only after Tasks 1-6 are green against fakes/fixtures (they are):

- [ ] Fix ADR #3 (user OAuth vs. service account + shared Drive) — Neo's call, no existing precedent to default to.
- [ ] Complete the required OAuth consent / service-account human step.
- [ ] Store tokens outside Git.
- [ ] Run the real adapter read-only against the actual `unbounded-axiom` Drive folder and compare its report to what `ingest.py`'s manual process already knows.

## Adversarial review (Workflow, 2026-08-17)

Ran a 4-dimension parallel review (correctness, spec-fidelity, security,
test-quality) over the finished diff, each finding independently checked by
3 skeptical verifiers. 27 candidate findings, 26 survived verification. All
26 were fixed before this was considered done — none deferred:

- **Correctness (5, all fixed):** `targetRootHash` filtered inconsistently
  with `sourceRootHash` (false `partial` for a routinely-excluded path
  present on both sides); `deleted` items hardcoded `canonicalRole`/
  `sensitivity` instead of real classification; the exclusion check ran
  *before* the `path_uncertain` check, silently dropping the uncertainty
  signal for any unverified path that happened to look excluded — the most
  serious one, since it directly defeated the "never guess" principle this
  slice is built around; `resolvePath` trusted `parents[0]` even though
  Drive doesn't guarantee that ordering for multi-parent files; `glob.ts`
  didn't escape `?` (a JS regex metacharacter, not a wildcard in this
  dialect).
- **Spec-fidelity (5, all fixed):** §9.4's "website declares 1,391, Drive
  has 1,348" example wasn't really implemented — no `published` role, no
  code path consuming a live site's declared count, `isPublished` was dead
  code (now reachable via `publishedPaths`, with the actual site-crawl
  input honestly documented as a separate, later dependency); native Google
  Docs/Sheets (`contentHash: null` on both sides forever) were silently
  reported `unchanged` regardless of real edits (now `conflicted`, never a
  false negative); the spec's required "Drive version" baseline field was
  missing entirely; excluded items lost their real canonical role/sensitivity
  to a hardcoded placeholder; tombstones existed but were never consulted by
  the compare pass itself (now wired via `tombstonedPaths`).
- **Security (4, all fixed):** the generic-secret regex's word boundary
  couldn't match compound identifiers (`client_secret`, `AWS_SECRET_ACCESS_KEY`
  all failed); its value character class excluded `/+=` (most of the base64
  alphabet real secrets are encoded in); the default exclusion list missed
  `.aws/credentials`, GCP service-account key filenames, SSH private keys,
  `.npmrc`/`.netrc`; zero coverage for Google's own credential formats
  (OAuth access/refresh tokens, API keys) despite this adapter's whole
  purpose being Google Drive integration.
- **Test-quality (12, all fixed):** several tests asserted only a name/flag
  change and never inspected the resulting `path`, so a regression that
  reintroduced path-guessing would still pass; the fake Drive client ignored
  the query string entirely, so a missing `trashed = false` clause would go
  undetected (now genuinely parses it); pagination was never exercised for
  either `listFiles` or `listChanges` (fixing this caught a real indexing bug
  in the *test fixture itself* — see below); the hash-disagreement safety
  branch and the conflict-vs-partial status priority were both completely
  untested; several narrower gaps (case-sensitivity, one of four secret
  patterns, most of the regex-escape set, call-ordering, the new Drive
  version field).

**A real bug in my own test fixture, caught by fixing a test-quality gap
the review flagged:** adding pagination coverage for `FakeDriveApiClient`
exposed a double-offsetting bug in its `listChanges` pagination — it sliced
by the absolute `pageToken` first, then ran a generic paginator that
computed `nextPageToken` relative to that already-offset slice, so a
follow-up call re-interpreted it as an absolute index again and looped
effectively forever (the test took 36s and threw `RangeError: Invalid array
length` before the fix). Fixed by keeping all of `listChanges`'s indexing in
one absolute frame.

## Verified checkpoint

- `pnpm install --frozen-lockfile`: pass
- `pnpm typecheck`: pass
- Vitest: **191 / 191 pass** (25 files, up from 161/18 before this review-and-fix pass)
- No Google account, OAuth consent, or live Drive API call used.
