# AO critic live roster 5 audit - 2026-05-28

Lane: critic-live-roster-5
Branch: session/rpp-31-critic-live-roster-5
Latest lane inspected: `origin/lane/evidence-integration-20260527` at `a0f650fb6` (`feat: add file create update delete generated cases`)

## Verdict

Release posture remains **NO-GO**. The requested `5a636b8b2` lane had the required release checks report integrated; during this critic pass the lane advanced once more to `a0f650fb6` with the RPP-0101 generated-harness candidate integrated. That latest head still lacks production-backed release proof and now has a current-repo checklist-linter failure.

Primary blockers observed on the latest lane:

- `node ./scripts/release/check-release-gates.mjs` exits 1 with `releaseStatus: "NO-GO"`, `primaryFailureCode: "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"`, and 17 blocking missing gates out of 20.
- `node ./scripts/release/required-release-checks-report.mjs --now 2026-05-28T02:05:00.000Z` exits 1 in current-repo mode with 10 required local observations missing and 0 passed observations.
- `node scripts/release/checklist-completion-lint.mjs` exits 1 because `docs/evidence/ao-required-release-checks.md:92` uses completion-shaped wording for unchecked `RPP-0056`.
- Two focused regression probes still fail: authenticated push revocation coverage stops at preflight/dry-run, and the snapshot apply table guard still errors with `Call to undefined function apply_filters()` instead of the expected unsupported-table rejection.

## Integrated lane status

The lane now contains, in order after `fdb02ab6a`:

1. `9617ad4fc` - release evidence provenance validator.
2. `bfcaa1216` - provenance wired into `scripts/release/check-release-gates.mjs`.
3. `c22966b16` - checklist linter hardening.
4. `6d6b2077c` - release artifact redaction scanner.
5. `a7d6facb9` and `5a636b8b2` - required release checks contract and report command.
6. `a0f650fb6` - RPP-0101 generated harness file create/update/delete cases.

The RPP-0101 remote candidate (`origin/session/rpp-24-rpp-0101-generated-harness` at `da7ee6f70`) is patch-equivalent to `a0f650fb6` (`git cherry` reports it with `-`). It should be considered integrated and not merged as a branch, because the branch ref itself is still behind the lane and would carry revert risk if used directly.

## Pushed but not yet integrated branches

- `origin/session/rpp-25-rpp-0026-auth-readback` (`cca48431d`) touches `scripts/release/check-release-gates.mjs`, release-gate tests, release-gate evidence docs, and the checklist. `git merge-tree` showed no textual conflict against `a0f650fb6`, but it overlaps the release CLI that provenance already changed. It needs focused review to ensure it does not weaken the provenance hold or mask the current required-check linter failure.
- `origin/session/rpp-29-rpp-0201-independent-file-row` (`81e6f4245`) touches `test/generated-push-harness.test.js`, which now also contains the integrated RPP-0101 test. `git merge-tree` reported `changed in both` for that file, with adjacent/overlapping test additions. This is the highest immediate conflict risk.
- `origin/session/rpp-30-rpp-0302-featured-image-graph` (`a762cd276`) touches `test/push-planner.test.js` and `docs/evidence/ao-graph-identity.md`. `git merge-tree` showed no textual conflict against the latest lane; evidence remains focused-only.
- `origin/session/rpp-32` (`dcfc23022`) adds a Docker local-production release-gate artifact path across the Docker harness, its tests, and Docker evidence docs. It is behind the new generated-harness lane by one commit and should be rebased or cherry-picked, not branch-merged.

All non-integrated candidate refs are behind the current lane. Direct branch merge/push would risk dropping recent lane commits; integration should cherry-pick or rebase onto `a0f650fb6` one candidate at a time.

## Standalone versus wired release movement

- Provenance is wired into `check-release-gates`, but it is required only when the base release-gate evaluator would otherwise allow release movement. On current evidence it reports `required: false` and `ready: true` because release movement is already blocked earlier.
- The artifact redaction scanner passes the current docs/evidence/audits/progress surfaces, but it is not called by `verify:release`, `check:release-gates`, or the release-gate CLI.
- The checklist linter is standalone and currently red on the lane. This is a real integration gap: the linter's own current-repo test is intended to hold risky claims, but the lane advanced with a new risky claim.
- The required release checks report is standalone. It is useful and fail-closed, but it is not wired into `verify:release` or `check-release-gates`.
- The generated harness integration adds valuable focused cases, but it does not change the release movement gates and does not replace production-backed evidence.

## False-positive and false-negative risks

- Checklist linter: the failing line mentions a schema field name plus unchecked `RPP-0056`. It may be a field-name false positive, but the current implementation explicitly treats this as risky completion language, so the lane is red until the doc or linter is corrected.
- Redaction scanner: current lane scan passed with 35 files and zero rejected files. The scanner allows loopback port 8080 and specific Docker service hostnames; that is reasonable for sandbox evidence docs, but must not become a blanket production URL allowlist.
- Provenance: artifact paths and subject hashes are validated, but provenance does not surface as the primary blocker until all earlier release gates pass.
- Required checks: fixture mode proves summary shape; current-repo mode proves fail-closed missing-observation behavior. Neither proves the 10 required commands were run against production-backed evidence.

## Live roster and ongoing follow-up risk

Current live branches observed after the lane moved to `a0f650fb6`:

- `rpp-24` moved on to `session/rpp-24-rpp-0102-directory-descendant-conflict`, with local changes to generated-harness files. It is already marked behind the lane by one commit in its worktree and must refresh before committing.
- `rpp-25` moved on to `session/rpp-25-rpp-0027-production-secret`, again changing release-gate CLI/test/docs/checklist files. This overlaps the just-pushed RPP-0026 branch and the provenance/required-check area.
- `rpp-26` progress-report docs are local and behind the lane by one commit, so any report must be refreshed before commit.
- `rpp-29` moved on to `session/rpp-29-rpp-0202-independent-row-file`, changing `src/apply.js` and `test/push-planner.test.js`; it is behind the lane by one commit.
- `rpp-30` moved on to `session/rpp-30-rpp-0303-post-author-graph`, changing generated harness code and behind the lane by one commit.
- `rpp-32` has pushed its Docker artifact branch but remains a separate candidate.

Several prior panes printed final reports and then accepted generic prompts. The roster is productive, but it requires prompt reassignments and stale-base warnings; otherwise panes can appear active while working from pre-integration bases.

## AO lifecycle and dashboard

The hand-run `rpp-ao-lifecycle` tmux session is alive and heartbeating, and `curl -I http://127.0.0.1:8080/` returned `HTTP/1.1 200 OK`. This proves the local dashboard workaround is available on the allowed sandbox port. It does not prove normal AO lifecycle helpers are stable; supervision still depends on tmux, git, and bounded commands.

## Checks run

- `git fetch origin lane/evidence-integration-20260527` and fast-forward to `a0f650fb6`.
- `node ./scripts/release/check-release-gates.mjs` - expected exit 1, release held.
- `node scripts/release/checklist-completion-lint.mjs` - exit 1, one risky current-lane claim.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence audits docs/progress-log.md docs/supervisor-feedback.md progress.html` - exit 0, 35 files scanned.
- `node ./scripts/release/required-release-checks-report.mjs --now 2026-05-28T02:05:00.000Z` - expected exit 1, 10 required observations missing.
- `node --test test/generated-push-harness.test.js` - exit 0, 2 tests passed.
- `node --test test/checklist-completion-lint.test.js` - exit 1, current-repo linter assertion fails.
- `node --test test/required-release-checks.test.js test/artifact-redaction-scan.test.js test/release-evidence-provenance.test.js test/release-gate-cli.test.js` - exit 0, 33 tests passed.
- Focused red probes: authenticated push revocation test and snapshot apply table guard both still fail.
- `curl -sS -I --max-time 5 http://127.0.0.1:8080/` - dashboard responds 200.
- `git merge-tree` conflict checks for rpp-25/rpp-29/rpp-30/rpp-32 candidates.

No full suite was run in this critic pass; the evidence is focused/read-only by assignment.
