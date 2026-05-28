# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-28 - Checklist Completion Starts Moving Under AO

- Last update: 2026-05-28 21:27 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527` through
  the current release-gate focused regression and session/rpp integration
  refresh.
- Checklist status:
  [docs/reprint-push-completion-checklist.md](reprint-push-completion-checklist.md)
  still contains exactly 1000 near-to-far `RPP-0001` through `RPP-1000`
  goals, but it is no longer a static all-unchecked inventory. It now marks 213
  items checked and leaves 787 open.
- Checked slices: 81 release-gate foundation items, 19 graph identity items,
  28 plugin-driver boundary items, 10 executor/auth items, 12 recovery items,
  7 chunking/performance items, 2 production-topology items, 34 generated
  harness items, and 20 merge-invariant items. No release-ops items are checked
  yet.
- Focused tmux stdout marker refresh: the current lane now contains
  `test/release-gate-tmux-status-marker-focused-regression.test.js` for
  `RPP-0077`. The command
  `node --test test/release-gate-tmux-status-marker-focused-regression.test.js`
  passed 1/1, proving malformed marker refusal and exact final marker stdout
  evidence with `mutationAttempted: false`. Final release remains `NO-GO`.
- Focused progress timestamp refresh: the current lane now contains
  `test/release-gate-progress-release-timestamp-focused-regression.test.js`
  for `RPP-0078`. The command
  `node --test test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  passed 32/32, proving the progress report links the focused command and
  observed `pass` status, non-ISO timestamp evidence fails closed with exact
  `PROGRESS_RELEASE_TIMESTAMP_REQUIRED` evidence, and `mutationAttempted`
  remains `false`. Final release remains `NO-GO`.
- Focused `.agents/RELEASE_GATES.md` status row refresh: the current lane now
  contains `test/release-gate-agents-status-row-focused-regression.test.js`
  for `RPP-0079`. The command
  `node --test test/release-gate-agents-status-row-focused-regression.test.js test/release-gates-status-row.test.js test/release-gate-status-row-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  passed 34/34, proving the negative/positive scenario matrix: dishonest
  `release_verdict: 4/4` evidence fails closed with exact
  `AGENTS_RELEASE_GATES_ROW_REQUIRED` evidence, and the honest `0/4`
  `.agents/RELEASE_GATES.md` row passes the gate while release remains
  `NO-GO`.
- Focused `verify:release` failure-marker refresh: the current lane now
  contains `test/release-gate-verify-release-failure-focused-regression.test.js`
  for `RPP-0080`. The command
  `node --test test/release-gate-verify-release-failure-focused-regression.test.js test/verify-release-failure-reason.test.js test/release-gate-verify-release-failure-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  passed 35/35, proving the checked missing-source verifier exits `1`, prints
  `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`,
  avoids mutating verifier startup, preserves exact gate evidence, and rejects
  forged zero-exit evidence. Final release remains `NO-GO`.
- Release verifier missing-source carry-through refresh: the current lane now
  contains
  `test/release-verifier-missing-source-url-carry-through-focused-regression.test.js`
  for `RPP-0081`. The command
  `node --test test/release-verifier-missing-source-url-carry-through-focused-regression.test.js test/release-gate-missing-source-url-regression.test.js test/release-gate-source-url-generated.test.js test/release-gate-verify-release-failure-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  passed 36/36, proving the checked verifier exits `1` with local/changed URLs
  and credentials present but `REPRINT_PUSH_SOURCE_URL` empty, carries through
  the missing live-source boundary and topology blocker, starts no live verifier
  server, redacts credentials, and preserves the exact release-gate `source-url`
  evidence with `final=19/20`. Final release remains `NO-GO`.
- Branch integration audit: all freshly fetched `origin/session/rpp*` refs are
  ancestors of `lane/evidence-integration-20260527` (397 checked, 0 unmerged).
  The broader local/remote `rpp`/session-like sweep checked 843 refs and also
  reports 0 unmerged after preserving the old auth-session boundary/code lane
  ancestry and carrying forward the missing packaged auth source candidate
  fallback tests. This did not move the checklist count because it was
  integration hygiene plus auth helper coverage, not a new checklist slice.
- Manage_options variant-2 refresh: the current lane now contains an explicit
  negative/positive scenario matrix for `RPP-0029` in
  `test/release-gate-manage-options-capability-regression.test.js`. The
  command
  `node --test test/release-gate-manage-options-capability-regression.test.js`
  passed 3/3, proving subscriber-denied and admin-approved capability paths
  with `mutationAttempted: false`. Final release remains `NO-GO`.
- Focused route/recovery/releaseMovement refresh: the current lane now contains
  `test/release-gate-route-recovery-focused-regression.test.js` for
  `RPP-0073` through `RPP-0076`. The command
  `node --test test/release-gate-route-recovery-focused-regression.test.js`
  passed 4/4, covering apply route pre-mutation, journal route read-only,
  recovery inspect read-only, and releaseMovement summary evidence. Final
  release remains `NO-GO`.
- Focused route-regression refresh: the current lane already contains
  preflight route identity and dry-run route eligibility focused regression
  tests for `RPP-0071` and `RPP-0072`. The command
  `node --test test/release-gate-preflight-route-identity-regression.test.js test/release-gate-dry-run-route-eligibility-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  passed 33/33, so those 2 items are now checked. Final release remains
  `NO-GO`.
- Session/rpp cleanup: the current lane now integrates `session/rpp-33`'s
  branch-local `RPP-0156` generated-harness proof for atomic plugin install
  stack coverage. The generated harness exposes ready and non-ready
  `atomicPluginInstallStack` cases across all 10 tiers, keeps private install
  option evidence redacted, and `node --test test/generated-push-harness.test.js`
  passed 36/36. `session/rpp-31` live-roster 10 critic output was also
  integrated as dated support-only audit evidence without moving counts.
- Release-gate evidence-count refresh: the current lane already contains
  generated and focused release-gate tests for `RPP-0027`, `RPP-0029`,
  `RPP-0041` through `RPP-0049`, `RPP-0052` through `RPP-0057`,
  `RPP-0059` through `RPP-0061`, `RPP-0063` through `RPP-0066`, and
  `RPP-0068` through `RPP-0069`. The
  expanded command
  `node --test test/release-gates.test.js test/release-gate-source-url-generated.test.js test/release-gate-local-url-generated.test.js test/release-gate-remote-changed-url-generated.test.js test/release-gate-packaged-fallback-generated.test.js test/release-gate-wrong-remote-alias-generated.test.js test/release-gate-auth-source-readback-generated.test.js test/release-gate-missing-production-secret-generated.test.js test/release-gate-application-password-binding-generated.test.js test/release-gate-manage-options-generated.test.js test/release-gate-dry-run-route-eligibility-generated.test.js test/release-gate-apply-route-pre-mutation-generated.test.js test/release-gate-journal-route-read-only-generated.test.js test/release-gate-recovery-inspect-read-only-generated.test.js test/release-gate-release-movement-summary-generated.test.js test/release-gate-tmux-status-marker-generated.test.js test/release-gate-status-row-generated.test.js test/release-gate-verify-release-failure-generated.test.js test/release-gate-missing-source-url-regression.test.js test/release-gate-missing-remote-changed-url-regression.test.js test/release-gate-packaged-fallback-regression.test.js test/release-gate-wrong-remote-alias-regression.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-application-password-binding-regression.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-cli.test.js`
  passed 73/73, so those 26 items are now checked. Final release remains
  `NO-GO`.
- Evidence movement: the local `session/rpp-*` cleanup integrated executable
  branch-local proof for `RPP-0221`, `RPP-0222`, and `RPP-0223`. The generated
  run now covers 620 deterministic cases, including independent local-file /
  remote-row, independent local-row / remote-file, and local-delete /
  remote-edit targets across all 10 tiers. Previous movement also checked
  `RPP-0150`, `RPP-0342`, `RPP-0443`, `RPP-0456`, `RPP-0457`, `RPP-0469`,
  `RPP-0470`, and `RPP-0471`.
- Validation: focused `RPP-0221` through `RPP-0223` planner tests passed 3/3,
  `npm run test:generated-push-harness` passed 35/35, the current integrated
  `node --test test/generated-push-harness.test.js` pass is 36/36, and the plugin/planner
  focused suite passed 167/167.
- Public progress publishing is now explicit: GitHub Pages serves
  `progress.html` from the existing `main` branch, so AO must run
  `npm run publish:progress-page` after validated lane pushes that change
  `progress.html`. The publisher copies only `progress.html` to existing
  `main`, creates no PR, and creates no new branch.
- Ancestry backlog reduction: `793c2a7d` normal-merged
  `origin/session/rpp-5` after `git merge-tree --write-tree` showed the merge
  result matched the current lane tree. This records the already-represented
  executor auth/lease read-only inspect branch ancestry without moving
  checklist counts. Validation passed with
  `node --test --test-name-pattern 'read-only|journal inspect|recovery inspect' test/authenticated-http-push-client.test.js`
  (19/19), `node --test test/authenticated-http-push-client.test.js`
  (127/127), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `3d512918` normal-merged
  `origin/session/rpp-6` after the dry merge-tree result matched the current
  lane tree. This records the already-represented guarded chunk benchmark
  branch ancestry without moving checklist counts. Validation passed with
  `node --test --test-name-pattern 'guarded benchmark|CLI benchmark|production claim|rollout safety|transfer projection' test/guarded-executor-benchmark.test.js`
  (5/5), `node --test test/guarded-executor-benchmark.test.js` (6/6),
  checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `bfb231b9` normal-merged
  `origin/session/rpp-7` after the dry merge-tree result matched the current
  lane tree. This records the already-represented independent audit branch
  ancestry without moving checklist counts. Validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `95d21c9d` normal-merged
  `origin/session/rpp-8` after the dry merge-tree result matched the current
  lane tree. This records the already-represented critic audit branch ancestry
  without moving checklist counts. Validation passed with the docs/progress
  suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `e6b5b6f7` normal-merged
  `origin/session/rpp-23`, adding the critic-continuation-2 audit artifacts
  `audits/ao-critic-continuation-2-20260528.md` and
  `docs/evidence/ao-critic-continuation-2.md`. The audit records historical
  red-suite observations from an older base, so it is counted as support-only
  critic evidence, not current release readiness. Current validation passed
  with the docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), `node --test test/authenticated-http-push-client.test.js`
  (127/127), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `f7cd2cef` normal-merged
  `origin/session/rpp-31`, adding the critic-continuation-3 audit artifacts
  `audits/ao-critic-continuation-3-20260528.md` and
  `docs/evidence/ao-critic-continuation-3.md`. The audit records historical
  observations from the older `a19deaf9e` lane and remains support-only critic
  evidence. Current validation passed with the docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `4d37d490` normal-merged
  `origin/session/rpp-31-critic-live-roster-5`, adding
  `audits/ao-critic-live-roster-5-20260528.md` and
  `docs/evidence/ao-critic-live-roster-5.md`. The audit records historical
  live-roster and merge-risk observations from the older `460ba7ad6` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `40f341dd` normal-merged
  `origin/session/rpp-31-critic-live-roster-6`, adding
  `audits/ao-critic-live-roster-6-20260528.md` and
  `docs/evidence/ao-critic-live-roster-6.md`. The audit records historical
  live-roster and merge-risk observations from the older `543a4376` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `c045dbda` normal-merged
  `origin/session/rpp-31-critic-live-roster-7`, adding
  `audits/ao-critic-live-roster-7-20260528.md` and
  `docs/evidence/ao-critic-live-roster-7.md`. The audit records historical
  live-roster and merge-risk observations from the older `6763451a0` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `8e5834b4` normal-merged
  `origin/session/rpp-31-critic-live-roster-8`, adding
  `audits/ao-critic-live-roster-8-20260528.md` and
  `docs/evidence/ao-critic-live-roster-8.md`. The audit records historical
  live-roster and merge-risk observations from the older `9118fb678` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `f7785848` normal-merged
  `origin/session/rpp-31-critic-live-roster-9`, adding
  `audits/ao-critic-live-roster-9-20260528.md` and
  `docs/evidence/ao-critic-live-roster-9.md`. The audit records historical
  live-roster and merge-risk observations from the older `19d9d8034` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `52af69f9` normal-merged
  `origin/session/rpp-31-critic-live-roster-11`, adding
  `audits/ao-critic-live-roster-11-20260528.md` and
  `docs/evidence/ao-critic-live-roster-11.md`. The audit records historical
  live-roster and merge-risk observations from the older `3081bfab1` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `b70479be` normal-merged
  `origin/session/rpp-31-critic-live-roster-12`, adding
  `audits/ao-critic-live-roster-12-20260528.md` and
  `docs/evidence/ao-critic-live-roster-12.md`. The audit records historical
  live-roster and merge-risk observations from the older `3bd9dc676` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `18f70040` normal-merged
  `origin/session/rpp-31-critic-live-roster-13`, adding
  `audits/ao-critic-live-roster-13-20260528.md` and
  `docs/evidence/ao-critic-live-roster-13.md`. The audit records historical
  live-roster and merge-risk observations from the older `67d50f384` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Audit backlog reduction: `178cf06b` normal-merged
  `origin/session/rpp-31-critic-live-roster-14`, adding
  `audits/ao-critic-live-roster-14-20260528.md` and
  `docs/evidence/ao-critic-live-roster-14.md`. The audit records historical
  live-roster and merge-risk observations from the older `3d4a985dd` lane and
  remains support-only critic evidence. Current validation passed with the
  docs/progress suite
  `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js test/progress-html-release-timestamp.test.js`
  (24/24), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), checklist lint, artifact redaction scan, and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `86875367` used
  `git merge -s ours --no-ff origin/session/rpp-18` after verifying
  `git log --right-only --cherry-pick HEAD...origin/session/rpp-18` was
  empty. This preserves the already-represented evidence coverage manifest
  branch ancestry (`56a1e533b`) without moving checklist counts or tree
  content. Validation passed with
  `node --test test/evidence-coverage-manifest.test.js` (5/5),
  `node --test test/progress-html-release-timestamp.test.js` (1/1),
  checklist lint, artifact redaction scan, a current fail-closed
  release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`), and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `9b197a01` used
  `git merge -s ours --no-ff origin/session/rpp-20` after verifying
  `git log --right-only --cherry-pick HEAD...origin/session/rpp-20` was
  empty. This preserves the already-represented route proof matrix branch
  ancestry (`8f2770fec`) without moving checklist counts or tree content.
  Validation passed with `node --test test/route-proof-matrix.test.js
  test/progress-html-release-timestamp.test.js` (8/8), checklist lint,
  artifact redaction scan, a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  3/20 gates), and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `1b3e8ad1` used
  `git merge -s ours --no-ff origin/session/rpp-21` after verifying
  `git log --right-only --cherry-pick HEAD...origin/session/rpp-21` was
  empty. This preserves the already-represented operator proof status
  branch ancestry (`286a9b18e`) without moving checklist counts or tree
  content. Validation passed with `node --test
  test/operator-proof-status.test.js test/progress-html-release-timestamp.test.js`
  (10/10), checklist lint, artifact redaction scan, a current fail-closed
  release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates), and
  `git diff --check origin/lane/evidence-integration-20260527..HEAD`.
- Ancestry backlog reduction: `61706f905` normal-merged
  `origin/session/rpp-22`, preserving the combined `rpp-15` critic
  continuation, `rpp-10` Docker local-production harness, and `rpp-18`
  evidence coverage manifest ancestry without a tree delta relative to the
  first parent. Validation succeeded with `node --check
  scripts/docker/production-complex-site-harness.mjs` and `node --check
  scripts/release/evidence-coverage-manifest.mjs`, `node --test
  test/production-complex-site-harness.test.js
  test/evidence-coverage-manifest.test.js` (15/15), `node
  scripts/release/evidence-coverage-manifest.mjs` (`ok: true`), `node
  scripts/docker/production-complex-site-harness.mjs --probe` fail-closed with
  `DOCKER_CLI_MISSING`, checklist lint, artifact redaction scan (67 files), a
  current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check
  origin/lane/evidence-integration-20260527..HEAD` plus a worktree
  `git diff --check`.
- Ancestry backlog reduction: `6194b0bd` used
  `git merge -s ours --no-ff origin/session/rpp-24` after verifying
  `git log --right-only --cherry-pick HEAD...origin/session/rpp-24` was
  empty. This preserves the already-represented release evidence provenance
  branch ancestry (`0134fc053`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  src/release-evidence-provenance.js` and `node --check
  scripts/release/check-release-gates.mjs`, `node --test
  test/release-evidence-provenance.test.js test/release-gate-cli.test.js
  test/release-gates.test.js` (36/36), checklist lint, artifact redaction scan
  (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `787ac659` used
  `git merge -s ours --no-ff origin/session/rpp-24-provenance-gate` after
  verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-provenance-gate` was empty. This preserves the
  already-represented release-gate provenance wiring branch ancestry
  (`baada0d62`) without moving checklist counts or tree content. Validation
  succeeded with the same provenance syntax checks, `node --test
  test/release-evidence-provenance.test.js test/release-gate-cli.test.js
  test/release-gates.test.js` (36/36), checklist lint, artifact redaction scan
  (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `7df3a73f` used
  `git merge -s ours --no-ff
  origin/session/rpp-24-rpp-0101-generated-harness` after verifying
  `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-rpp-0101-generated-harness` was empty. This
  preserves the already-represented `RPP-0101` generated file create/update/delete
  harness branch ancestry (`da7ee6f70`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/harness/generated-push-cases.js`, `node --test
  test/generated-push-harness.test.js` (12/12), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `455912018` used
  `git merge -s ours --no-ff
  origin/session/rpp-24-rpp-0102-directory-descendant-conflict` after verifying
  `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-rpp-0102-directory-descendant-conflict` was
  empty. This preserves the already-represented `RPP-0102` generated directory
  descendant conflict branch ancestry (`892eed724`) without moving checklist
  counts or tree content. Validation succeeded with `node --check
  scripts/harness/generated-push-cases.js`, `node --test
  test/generated-push-harness.test.js` (12/12), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `5753933a` used
  `git merge -s ours --no-ff
  origin/session/rpp-24-rpp-0103-file-type-swap-conflict` after verifying
  `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-rpp-0103-file-type-swap-conflict` was empty.
  This preserves the already-represented `RPP-0103` generated file type-swap
  branch ancestry (`866767ef3`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/harness/generated-push-cases.js`, `node --test
  test/generated-push-harness.test.js` (12/12), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `5729dd05` used
  `git merge -s ours --no-ff
  origin/session/rpp-24-rpp-0104-row-create-update-delete-mix` after verifying
  `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-rpp-0104-row-create-update-delete-mix` was
  empty. This preserves the already-represented `RPP-0104` generated row
  create/update/delete mix branch ancestry (`c6e2de4eb`) without moving
  checklist counts or tree content. Validation succeeded with `node --check
  scripts/harness/generated-push-cases.js`, `node --test
  test/generated-push-harness.test.js` (12/12), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Generated harness conflict resolution: `3582471e9` normal-merged
  `origin/session/rpp-24-rpp-0105-wp-options-scalar` after confirming the
  candidate changed only `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`. The lane resolution preserved the
  current generated harness targets and added the non-plugin-owned `wp_options`
  scalar ready/conflict families from `ce443fef7`, raising the default run to
  390 deterministic cases so every target family keeps per-tier coverage.
  Validation succeeded with `npm run test:generated-push-harness` (13/13),
  checklist lint, artifact redaction scan, `git diff --check`, and a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates).
- Generated harness conflict resolution: `3dd96b2fa` normal-merged
  `origin/session/rpp-24-rpp-0106-wp-options-serialized` after confirming the
  candidate changed only `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`. The lane resolution preserved the
  current generated harness targets and added non-plugin-owned `wp_options`
  serialized array/object ready and conflict families from `39a10a537`,
  raising the default run to 410 deterministic cases with 219 ready, 162
  conflict, and 29 blocked outcomes. Validation succeeded with
  `npm run test:generated-push-harness` (14/14), checklist lint, artifact
  redaction scan, `git diff --check`, and a current fail-closed release-gate
  status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates).
- Generated harness conflict resolution: `00987b359` normal-merged
  `origin/session/rpp-24-rpp-0108-wp-postmeta-create-update-delete` after
  confirming the candidate changed only `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`. The lane resolution preserved the
  current generated harness targets and added `wp_postmeta` create/update/delete
  ready and conflict families from `28209dbd5`, raising the default run to 430
  deterministic cases with 232 ready, 164 conflict, and 34 blocked outcomes.
  Validation succeeded with `npm run test:generated-push-harness` (15/15),
  checklist lint, artifact redaction scan, `git diff --check`, and a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates).
- Generated harness conflict resolution: `400d9072b` normal-merged
  `origin/session/rpp-24-rpp-0109-wp-users-usermeta-graph` after confirming
  the candidate changed only `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`. The lane resolution preserved the
  current generated harness targets and added `wp_users`/`wp_usermeta` ready
  and stale graph families from `0e99a80a7`, raising the default run to 450
  deterministic cases with 243 ready, 175 conflict, and 32 blocked outcomes.
  Validation succeeded with `npm run test:generated-push-harness` (16/16),
  checklist lint, artifact redaction scan, `git diff --check`, and a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates).
- Ancestry backlog reduction: `8851a742` used
  `git merge -s ours --no-ff
  origin/session/rpp-24-rpp-0112-wp-term-taxonomy-graph` after verifying
  `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-24-rpp-0112-wp-term-taxonomy-graph` was empty.
  This preserves the already-represented `RPP-0112` generated term-taxonomy
  graph branch ancestry (`583733ef3`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/harness/generated-push-cases.js`, `node --test
  test/generated-push-harness.test.js` (12/12), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `af00dd07` used
  `git merge -s ours --no-ff origin/session/rpp-25` after verifying
  `git log --right-only --cherry-pick HEAD...origin/session/rpp-25` was
  empty. This preserves the already-represented checklist completion linter
  branch ancestry (`4549c1119`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/release/checklist-completion-lint.mjs`, `node --test
  test/checklist-completion-lint.test.js` (13/13), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `228d7e2f` used
  `git merge -s ours --no-ff origin/session/rpp-25-checklist-lint-current`
  after verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-25-checklist-lint-current` was empty. This
  preserves the already-represented current-tree checklist linter hardening
  branch ancestry (`7a9da9d66`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/release/checklist-completion-lint.mjs`, `node --test
  test/checklist-completion-lint.test.js` (13/13), checklist lint, artifact
  redaction scan (67 files), a current fail-closed release-gate status check
  (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, 3/20
  gates), and `git diff --check` for the worktree and merge diff.
- Ancestry backlog reduction: `873fee36` used
  `git merge -s ours --no-ff origin/session/rpp-25-checklist-lint-current-v2`
  after verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-25-checklist-lint-current-v2` was empty. This
  preserves the already-represented current-tree checklist linter hardening v2
  branch ancestry (`a8bc9b499`) without moving checklist counts or tree
  content. Validation succeeded with `node --check
  scripts/release/checklist-completion-lint.mjs`, `node --test
  test/checklist-completion-lint.test.js test/progress-html-release-timestamp.test.js`
  (14/14), checklist lint, artifact redaction scan (67 files), a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates), and `git diff --check` for the
  worktree and merge diff.
- Ancestry backlog reduction: `cc29719c` used
  `git merge -s ours --no-ff origin/session/rpp-25-rpp-0026-auth-readback`
  after verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-25-rpp-0026-auth-readback` was empty. This preserves
  the already-represented `RPP-0026` auth source readback drift gate branch
  ancestry (`cca48431d`) without moving checklist counts or tree content.
  Validation succeeded with `node --test test/release-gates.test.js
  test/release-gate-cli.test.js test/checklist-completion-lint.test.js`
  (41/41), checklist lint, artifact redaction scan (67 files), a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates), and `git diff --check` for the
  worktree and merge diff.
- Ancestry backlog reduction: `7310b522` used
  `git merge -s ours --no-ff origin/session/rpp-25-rpp-0028-app-password`
  after verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-25-rpp-0028-app-password` was empty. This preserves
  the already-represented `RPP-0028` Application Password binding gate branch
  ancestry (`75b9b21a`) without moving checklist counts or tree content.
  Validation succeeded with `node --test test/release-gates.test.js
  test/release-gate-cli.test.js test/checklist-completion-lint.test.js`
  (41/41), checklist lint, artifact redaction scan (67 files), a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates), and `git diff --check` for the
  worktree and merge diff.
- Ancestry backlog reduction: `2c6b4852` used
  `git merge -s ours --no-ff origin/session/rpp-25-rpp-0030-same-source`
  after verifying `git log --right-only --cherry-pick
  HEAD...origin/session/rpp-25-rpp-0030-same-source` was empty. This preserves
  the already-represented `RPP-0030` same-source identity gate branch ancestry
  (`a3433efdd`) without moving checklist counts or tree content. Validation
  succeeded with `node --test test/release-gates.test.js
  test/release-gate-cli.test.js test/checklist-completion-lint.test.js`
  (41/41), checklist lint, artifact redaction scan (67 files), a current
  fail-closed release-gate status check (`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`,
  `releaseMovement.allowed: false`, 3/20 gates), and `git diff --check` for the
  worktree and merge diff.
- `rpp-28` then landed recovery repair, release-gate CI checks, evidence
  redaction, protocol compatibility, route proof matrix, and operator proof
  status on the integration branch. The checklist only moved for exact matches:
  `RPP-0613`, `RPP-0673`, `RPP-0801`, and `RPP-0820`.
- Additional integrated wave: `fdb02ab6a` added the checklist completion
  linter, `9617ad4fc`/`bfcaa1216` added release evidence provenance and wired
  it into release-gate CLI checks, `c22966b16` hardened the linter against the
  current progress surfaces, and `6d6b2077c` added the artifact redaction
  scanner. `a7d6facb9`/`5a636b8b2` then added the required release checks
  contract and operator-runnable report command. `a0f650fb6` integrated
  `RPP-0101`, proving a generated file create/update/delete mix with at least
  one ready and one non-ready case. `281fcf797`/`2f079e09f` then integrated
  command-level `RPP-0026` auth source readback drift evidence and updated the
  checklist totals. `32326c2a5`/`69893ed24` integrated `RPP-0102` directory
  descendant conflict coverage with per-tier summary evidence. These guardrails
  and harness additions do not change final release readiness.
- Docker/local-production artifact update: `912bdfbd4` integrates the `rpp-32`
  harness change that emits deterministic release-gate input when Docker is
  available while still failing closed as `DOCKER_CLI_MISSING` in this sandbox.
- Generated harness continuation: `e345e724f`/`c3cdc079d` integrated
  `RPP-0103` file type-swap coverage with ready and non-ready generated cases.
- Application Password continuation: `d18921cfd`/`49710acee` integrated
  command-level `RPP-0028` binding drift coverage with an exact
  `APPLICATION_PASSWORD_BINDING_REQUIRED` failure before mutation.
- Row-mix generated harness continuation: `4d12f8a47`/`15290691e` integrated
  `RPP-0104` row create/update/delete coverage with ready, conflict, and stale
  replay refusal evidence.
- Same-source continuation: `89b8d184f`/`460ba7ad6` integrated `RPP-0030`
  same source URL identity proof with a final bracketed status marker and
  mutation-free CLI failure path.
- Preflight and dry-run route continuation: `c382b091f`/`d400b1fe1` integrated
  `RPP-0031` preflight route identity drift proof, and `35d8d4601` integrated
  `RPP-0032` dry-run route eligibility proof. Both run
  `check-release-gates` from fixture evidence, exit nonzero with the named
  route failure code, and record `mutationAttempted: false`.
- Apply-route continuation: `2b75f7fb6` integrated `RPP-0033` apply route
  pre-mutation proof with exact `APPLY_ROUTE_PRE_MUTATION_REQUIRED` evidence
  and no mutation attempt.
- Journal-route continuation: `6763451a0` integrated `RPP-0034` journal route
  read-only proof with exact `JOURNAL_ROUTE_READ_ONLY_REQUIRED` evidence and
  no mutation attempt.
- Recovery-inspect continuation: `f051dc124` integrated `RPP-0035` recovery
  inspect read-only proof with final bracketed status markers, stable recovery
  row counts, exact `RECOVERY_INSPECT_READ_ONLY_REQUIRED` evidence for the
  negative path, and no mutation attempt from the release-gates CLI.
- Release-movement continuation: `4a5367b39` integrated `RPP-0036`
  releaseMovement allowed/denied summary proof with exact summary evidence,
  named exit codes, and no mutation attempt.
- Tmux-status continuation: `2864ad636` integrated `RPP-0037` tmux stdout
  proof status marker coverage with exact final bracketed marker evidence and
  no mutation attempt from the release-gates CLI.
- Progress timestamp continuation: `0f3b2e4af` integrated `RPP-0038`
  progress.html release timestamp proof. The focused Node test links
  `progress.html#release-proof-timestamp`, exact timestamp evidence, observed
  test status, and release-gate report evidence while keeping release status
  `NO-GO` and mutation-free.
- Status-row continuation: `6035273b9` integrated `RPP-0039`
  `.agents/RELEASE_GATES.md` status-row proof. The focused Node test parses the
  generated `0/4` row as honest `NO-GO` evidence, rejects dishonest `4/4` rows
  with `AGENTS_RELEASE_GATES_ROW_REQUIRED`, and keeps the CLI mutation-free.
- Verify-release failure continuation: `87f53b06f` integrated `RPP-0040`
  `verify:release` nonzero failure reason proof. Focused command:
  `node --test test/verify-release-failure-reason.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (29 passing release-gate tests). The checked `npm run verify:release`
  missing-source path exits `1`, prints final marker
  `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`,
  starts no Playground server, and feeds exact mutation-free evidence through
  `check-release-gates` while final release remains `NO-GO`.
- Generated same-source continuation: `ff1b3dbb7` integrated `RPP-0050`
  same source URL identity generated coverage. Focused command:
  `node --test test/release-gate-same-source-generated.test.js test/verify-release-failure-reason.test.js test/progress-html-release-timestamp.test.js test/release-gates-status-row.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (33 passing release-gate tests). The generated matching fixture exposes the
  final release-ready bracketed marker while still ending `NO-GO` without
  provenance, and the drifted apply-source fixture fails closed with
  `SAME_SOURCE_IDENTITY_REQUIRED`, exact same-source evidence, held marker, and
  `mutationAttempted: false`.
- Generated preflight-route continuation: `bb6b422e7` integrated `RPP-0051`
  preflight route identity generated coverage. Focused command:
  `node --test test/release-gate-preflight-route-identity-generated.test.js test/release-gate-same-source-generated.test.js test/verify-release-failure-reason.test.js test/progress-html-release-timestamp.test.js test/release-gates-status-row.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (35 passing release-gate tests). The matching fixture preserves exact
  preflight route identity evidence while release remains `NO-GO` without
  provenance, and the mismatched route fixture fails closed with
  `PREFLIGHT_ROUTE_IDENTITY_REQUIRED`, exact route evidence, held marker, and
  `mutationAttempted: false`.
- Generated progress-timestamp continuation: `cb6c29f31` integrated
  `RPP-0058` progress.html release timestamp generated coverage. Focused
  command:
  `node --test test/release-gate-progress-release-timestamp-generated.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (31 passing release-gate tests). The broader release-gate suite with
  generated same-source, generated preflight, status-row, verify-release, and
  progress timestamp coverage passes 37/37. The generated fixtures link the
  focused command and observed `pass` status to
  `progress.html#release-proof-timestamp`, reject invalid timestamp evidence
  with `PROGRESS_RELEASE_TIMESTAMP_REQUIRED`, preserve exact timestamp-gate
  evidence, and keep final release `NO-GO` without provenance.
- Missing local URL continuation: `a9a1610a4` integrated `RPP-0062`
  `REPRINT_PUSH_LOCAL_URL` gate regression coverage. Focused command:
  `node --test test/release-gate-missing-local-url-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (30 passing release-gate tests). The broader generated release-gate suite
  with missing-local-url, generated progress timestamp, generated preflight,
  generated same-source, status-row, verify-release, and core gate coverage
  passes 39/39. The fixture supplies every other final-release gate while
  leaving `REPRINT_PUSH_LOCAL_URL` empty, asserts exact
  `REPRINT_PUSH_LOCAL_URL_REQUIRED` evidence, keeps credential output redacted,
  records `mutationAttempted: false`, and leaves final release `NO-GO`.
- Missing production secret continuation: `16962f5f4` integrated `RPP-0067`
  missing production secret gate regression coverage. Focused command:
  `node --test --test-name-pattern=RPP-0067 test/release-gate-missing-production-secret-regression.test.js`
  (2 passing release-gate tests). The broader release-gate suite with missing
  production secret, missing local URL, generated progress timestamp, generated
  preflight, generated same-source, status-row, CLI, and core gate coverage
  passes 39/39. The fixture supplies production URLs while omitting the
  production secret, asserts exact `REPRINT_PUSH_SECRET_REQUIRED` evidence,
  keeps credential output redacted, records `mutationAttempted: false`, and
  leaves final release `NO-GO`.
- Same-source regression continuation: `678255f0e` integrated `RPP-0070`
  same source URL identity proof variant 4. Focused command:
  `node --test test/release-gate-same-source-identity-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  (30 passing release-gate tests). The broader release-gate suite with the new
  same-source regression, missing production secret, missing local URL,
  generated progress timestamp, generated preflight, generated same-source,
  status-row, verify-release, CLI, and core gate coverage passes 43/43. The
  fixture supplies every other final-release gate while drifting the
  recovery-inspect source URL, asserts exact `SAME_SOURCE_IDENTITY_REQUIRED`
  evidence, keeps credential output redacted, records `mutationAttempted:
  false`, and leaves final release `NO-GO`.
- Graph importer/exporter continuation: `165031908` integrated `RPP-0340`
  production importer/exporter identity-map proof. Focused command:
  `node --test test/local-production-complex-site-proof.test.js`
  (18 passing local-production graph tests). The broader graph/planner command
  `node --test test/local-production-complex-site-proof.test.js test/push-planner.test.js test/graph-mapping-inventory.test.js`
  passes 122/122. The proof carries immutable-base `pushIdentityMap` metadata,
  rewrites dependent child post and postmeta rows to the imported remote target,
  blocks stale imported targets, records only hashes/resource keys/rewrite
  hashes, and leaves final release `NO-GO`.
- Comment-user graph generated continuation: `a4260f8d8` integrated `RPP-0347`
  comment user reference generated coverage. Focused command:
  `node --test --test-name-pattern=RPP-0347 test/generated-push-harness.test.js`
  (1 passing generated-harness test). The full generated harness passes 12/12,
  and focused graph checks across `test/push-planner.test.js` and
  `test/local-production-complex-site-proof.test.js` pass 23/23. The generated
  proof emits ready and stale comment-user graph cases, blocks stale remote user
  references before mutation, keeps raw target labels out of serialized stale
  plan evidence, and leaves final release `NO-GO`.
- Merge-invariant continuation: `687b3954e` integrated `RPP-0207` stale plugin
  owner context rejection in the planner/apply path.
- File type-swap descendant continuation: `1ab4941a4` merged the existing
  `origin/session/rpp-29-rpp-0205-file-type-swap-remote-descendant` branch
  (`e0d49cf08`) with ancestry preserved. Focused command:
  `node --test --test-name-pattern=RPP-0205 test/push-planner.test.js`
  (1 passing planner/apply proof), plus `node --test test/push-planner.test.js`
  (105 passing planner/apply tests). The proof covers a local
  directory-to-file type swap while the remote has created a descendant under
  the same directory, verifies `file-topology-conflict` evidence with
  `type-change` versus remote descendant `create`, emits no mutation or live
  precondition for the unsafe ancestor path, rejects `applyPlan()` with
  `PLAN_NOT_READY`, leaves remote state unchanged, and keeps local replacement
  bytes plus remote descendant bytes out of serialized planner evidence.
  Caveat: this is deterministic local planner/apply evidence, not production
  filesystem durability proof or final release evidence.
- Already-in-sync continuation: `c703859c1` merged the existing
  `origin/session/rpp-29-rpp-0214-already-in-sync-decision` branch
  (`bcf03c599`) with ancestry preserved. Focused command:
  `node --test --test-name-pattern=RPP-0214 test/push-planner.test.js`
  (1 passing planner/apply proof), plus `node --test test/push-planner.test.js`
  (106 passing planner/apply tests). The proof covers matching local/remote
  file, plugin, and row changes, emits only `already-in-sync` decisions, keeps
  mutations and preconditions at zero, verifies deterministic summary counts,
  and serializes only hash-only/redacted evidence. Caveat: this is deterministic
  local planner/apply evidence, not production filesystem durability proof or
  final release evidence.
- Blocked-plan continuation: `4cd502b7` merged the existing
  `origin/session/rpp-29-rpp-0216-blocked-plan-apply-refusal` branch
  (`311d3b553`) with ancestry preserved. Focused command:
  `node --test --test-name-pattern=RPP-0216 test/push-planner.test.js`
  (1 passing planner/apply proof). The proof covers a blocked plan that also
  contains an otherwise valid local mutation, rejects `applyPlan()` with stable
  `PLAN_NOT_READY` evidence before any mutation, writes no durable journal
  event, and leaves the remote snapshot unchanged. Caveat: this is
  deterministic local planner/apply evidence, not production durability proof
  or final release evidence.
- Unknown plugin-owned resource continuation: `913f65771` merged the existing
  `origin/session/rpp-29-rpp-0228-unknown-plugin-owned-resource-refusal` branch
  (`c9cdf7e7d`) with ancestry preserved. Focused command:
  `node --test --test-name-pattern=RPP-0228 test/push-planner.test.js`
  (1 passing planner/apply proof), plus `node --test test/push-planner.test.js`
  (108 passing planner/apply tests). The proof covers a local plugin-owned
  custom-table row with no supported resource driver policy, emits an
  `unsupported-plugin-owned-resource` blocker with zero mutations and zero live
  preconditions, rejects the blocked plan with `PLAN_NOT_READY`, rejects a
  forged ready mutation with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE`, keeps the
  remote plugin-owned row unchanged, and serializes only deterministic
  hash/redacted evidence. Caveat: this is focused local planner/apply evidence,
  not final production plugin-driver proof.
- Auth/recovery reconciliation: `e53a068ac` merged
  `origin/session/rpp-17` with normal ancestry and no checklist-count change.
  `node --test test/authenticated-http-push-client.test.js` passes 127/127.
  The authenticated playground smoke still fails at the existing
  `/db-journal` 401 assertion on both this head and a detached pre-merge lane,
  so that smoke remains baseline follow-up rather than new release evidence.
- Release-gate ancestry reduction: `07bd720bc` merged
  `origin/session/rpp-1` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and
  `node --test test/release-gates.test.js test/release-gate-cli.test.js`
  passes 28/28.
- Recovery-journal ancestry reduction: `c1edc85a` merged
  `origin/session/rpp-2` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, focused recovery tests pass 26/26,
  and `npm run test:recovery:file-journal` passes.
- Graph-identity ancestry reduction: `5773b093` merged
  `origin/session/rpp-3` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, graph inventory plus planner tests
  pass 110/110, and `npm run bench:graph-mapping-inventory` runs cleanly.
- Plugin-driver ancestry reduction: `ebf3710b` merged
  `origin/session/rpp-4` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, plugin scenario tests pass 7/7, and
  the plugin-driver verifier guard smoke passes.
- Docker local-production ancestry reduction: `3a5afcfd` merged
  `origin/session/rpp-10` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and the Docker local-production
  harness tests pass 10/10.
- Recovery-repair ancestry reduction: `89daa4dd` merged
  `origin/session/rpp-11` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and focused recovery repair tests
  pass 5/5.
- Evidence-redaction ancestry reduction: `3b7de126` merged
  `origin/session/rpp-13` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and the focused evidence redaction,
  recovery journal, release-gate, and release-gate CLI suite passes 56/56.
- Protocol-compatibility ancestry reduction: `42f99323` merged
  `origin/session/rpp-14` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and the focused protocol
  compatibility plus required release checks suite passes 17/17.
- Critic-continuation ancestry reduction: `78f697ce` merged
  `origin/session/rpp-15` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and the release-gate smoke suite
  passes 28/28.
- Progress-evidence ancestry reduction: `43d18cd6` merged
  `origin/session/rpp-16` with the `ours` strategy after
  `git log --right-only --cherry-pick` confirmed no unrepresented commits. The
  tree is unchanged from the first parent, and the progress timestamp plus
  release-gate suite passes 29/29.
- Planner-summary continuation: `137ae0102` integrated `RPP-0210` planner
  summary count consistency. The focused local Node proof checks ready,
  conflict, blocked, and atomic fixtures, verifies `plan.summary` against the
  emitted mutations, decisions, conflicts, blockers, and atomic groups, and
  records the caveat that this is not final production release evidence.
- Keep-remote continuation: `c371eb8d2e` integrated `RPP-0215` keep-remote
  decision count consistency. Focused command:
  `node --test test/push-planner.test.js` (91 passing planner tests). The proof
  checks deterministic file, plugin, and row `keep-remote` decisions, confirms
  they emit no mutation or precondition, preserves remote values during apply,
  and keeps serialized planner evidence hash-only/redacted. Caveat: this is a
  focused local planner/apply invariant proof, not final production release
  evidence.
- Conflict-plan refusal continuation: `6d92f9517` integrated `RPP-0217`
  conflict plan apply refusal. Focused command:
  `node --test test/push-planner.test.js` (92 passing planner tests). The proof
  plans one independent local file mutation plus one divergent row conflict,
  verifies stable summary/conflict evidence without raw row values, and confirms
  `applyPlan()` fails with `PLAN_NOT_READY` before durable journal events or
  target mutation. Caveat: this is a focused local planner/apply invariant proof,
  not final production release evidence.
- Forged-ready defense continuation: `753d9ae2a` integrated `RPP-0218`
  forged ready plan defense. Focused command:
  `node --test test/push-planner.test.js` (93 passing planner tests). The
  executor now validates ready-plan mutation/precondition evidence before atomic
  dependency checks, durable journal events, precondition checks, or mutation;
  forged ready plans fail with `PLAN_INVARIANT_VIOLATION`, stale ready plans
  fail with `PRECONDITION_FAILED`, and refusal evidence omits raw private
  values. Caveat: this is a focused local planner/apply invariant proof, not
  final production release evidence.
- Redacted raw-value evidence continuation: `73c3e70a4` integrated `RPP-0219`
  redacted raw value evidence. Focused command:
  `node --test test/push-planner.test.js` (94 passing planner tests). The proof
  covers conflict-plan evidence plus interrupted apply recovery-journal evidence:
  operator-facing details keep resource keys, reasons, hashes, digest, and shape
  metadata while omitting raw local, remote, and base site values. Caveat: this
  is a focused local planner/apply evidence proof, not final production release
  evidence.
- Atomic-group blocker continuation: `c641f9c92` integrated `RPP-0220`
  atomic group blocker propagation. Focused command:
  `node --test test/push-planner.test.js` (95 passing planner tests). The proof
  builds an atomic group with a direct unsupported plugin-owned row blocker and
  two otherwise valid sibling mutations, verifies propagated blockers reference
  the source blocker without raw values, and confirms `applyPlan()` fails with
  `PLAN_NOT_READY` before durable journal events or target mutation. Caveat:
  this is a focused local planner/apply invariant proof, not final production
  release evidence.
- Stale plugin data owner-context continuation: `b1f58e9a5` integrated
  `RPP-0227` local plugin data with stale owner context. Focused command:
  `node --test --test-name-pattern='RPP-0227' test/push-planner.test.js`
  (1 passing focused proof), plus `node --test test/push-planner.test.js`
  (100 passing planner/apply tests). The proof starts from an allowed
  plugin-owned option update, then rejects live owner-plugin drift and forged
  ready plans with missing or invalid owner-context hashes before mutation while
  keeping the plugin-owned row and remote owner file protected. Caveat: this is
  focused local planner/apply evidence, not final production release proof.
- Conflict evidence redaction continuation: `22fa5b642` integrated
  `RPP-0229` conflict evidence hash redaction. Focused command:
  `node --test --test-name-pattern='RPP-0229' test/push-planner.test.js`
  (1 passing focused proof), plus `node --test test/push-planner.test.js`
  (101 passing planner/apply tests). The proof serializes direct row conflict
  evidence with resource keys, classes, resolution policy, change states, and
  hashes only, confirms an independent file mutation can still be planned, and
  proves `applyPlan()` refuses the conflict plan with `PLAN_NOT_READY` before
  durable journal events or mutation. Caveat: this is focused local
  planner/apply evidence, not final production release proof.
- Generated planner-summary continuation: `ca47c11b1` integrated `RPP-0230`
  planner summary count consistency variant 2. Focused command:
  `node --test --test-name-pattern='RPP-0230' test/generated-push-harness.test.js`
  (1 passing focused proof), plus `node --test test/generated-push-harness.test.js`
  (8 passing generated-harness tests) and `node --test test/push-planner.test.js`
  (101 passing planner/apply tests). The generated harness replans all 360
  deterministic cases twice, verifies `plan.summary` exactly matches emitted
  mutations, decisions, conflicts, blockers, and atomic groups, and compares
  aggregate evidence with harness report totals. Caveat: this is deterministic
  local generated-harness evidence, not final production release proof.
- LocalHash correctness continuation: `e9f56fef8` integrated `RPP-0233`
  localHash correctness variant 2. Focused commands:
  `node --test --test-name-pattern=RPP-0233 test/push-planner.test.js` and
  `node --test --test-name-pattern=RPP-0233 test/generated-push-harness.test.js`
  (1 passing proof each), plus `node --test test/generated-push-harness.test.js`
  (9 passing generated-harness tests) and `node --test test/push-planner.test.js`
  (102 passing planner/apply tests). The executor validates ready-plan
  `localHash` evidence against the planned mutation value, rejects missing,
  malformed, forged, stale-value, and stale-snapshot hash evidence before
  mutation, and keeps serialized refusal evidence hash-only/redacted. Caveat:
  this is focused local planner/apply evidence, not final production release
  proof.
- Conflict-plan refusal variant continuation: `a56d10f94` integrated
  `RPP-0237` conflict plan apply refusal variant 2. Focused command:
  `node --test --test-name-pattern=RPP-0237 test/push-planner.test.js test/generated-push-harness.test.js`
  (2 passing focused proofs), plus
  `node --test test/push-planner.test.js test/generated-push-harness.test.js`
  (113 passing planner/generated tests). The proof rejects non-ready conflict
  plans, forged ready status, and stale mutation attempts before durable
  journal events or target mutation while keeping refusal evidence hash-only
  and redacted. Caveat: this is deterministic local planner/generated evidence,
  not final production release proof.
- Atomic-group blocker variant continuation: `4b1d16b6c` integrated
  `RPP-0240` atomic group blocker propagation variant 2. Focused commands:
  `node --test --test-name-pattern=RPP-0240 test/push-planner.test.js` and
  `node --test --test-name-pattern=RPP-0240 test/generated-push-harness.test.js`
  (1 passing proof each), plus
  `node --test test/generated-push-harness.test.js test/push-planner.test.js`
  (115 passing planner/generated tests). The focused planner proof and
  generated harness proof both show atomic group blockers propagate to every
  grouped mutation, then `applyPlan()` refuses before durable journal events or
  target mutation while evidence remains hash-only/redacted. Caveat: this is
  deterministic local planner/generated evidence, not final production release
  proof.
- Stale plugin metadata owner continuation: `43beb7c9c` integrated
  `RPP-0414` stale plugin metadata owner context refusal. Focused planner
  tests reject stale plugin-owned row and plugin file mutations before mutation
  with stable redacted evidence, while preserving a ready plugin-driver row
  when owner metadata independently matches remote.
- Plugin-driver registration continuation: `78323671d` integrated `RPP-0421`
  driver registration API proof. Focused command:
  `node --test test/playground-snapshot-lib.test.js` (4 passing
  snapshot/plugin-driver tests). The PHP probe proves the default
  `reprint-push-release-state` row driver, filter-registered extension driver,
  lookup by name/table, and fail-closed malformed registration cases while
  hashing error-message evidence. Caveat: this is focused local
  snapshot-library proof, not arbitrary plugin-driver production readiness.
- Plugin-delete refusal continuation: `85682de19` integrated `RPP-0431`
  plugin uninstall/delete refusal. Focused command:
  `node --test --test-name-pattern 'plugin uninstall/delete' test/push-planner.test.js`
  (1 passing focused proof), plus `node --test test/push-planner.test.js`
  (96 passing planner tests). The proof blocks plugin delete plans without an
  explicit `plugin-delete` driver, verifies redacted blocker evidence, and
  confirms a forged ready plugin delete fails with `UNSUPPORTED_PLUGIN_DELETE`
  before durable journal events or target mutation. Caveat: this is focused
  local planner/apply plugin-driver boundary evidence, not production plugin
  lifecycle readiness.
- Driver-apply validation continuation: `9570a6110` integrated `RPP-0438`
  driver apply validation hook evidence. Focused command:
  `node --test --test-name-pattern 'RPP-0438|fixture forms lab table journal redacts raw payload values' test/push-planner.test.js`
  (3 passing focused proofs), plus `node --test test/push-planner.test.js`
  (98 passing planner/apply tests). The proof carries one valid fixture driver
  row mutation through the apply `beforeMutation` hook with hash-only
  `PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED` evidence, and forged driver evidence
  fails closed before hook execution, durable journal events, or target mutation
  with `PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED`. Caveat: this is focused local
  plugin-driver boundary evidence, not broad production plugin-driver readiness.
- Driver-audit redaction continuation: `e117f6aba` integrated `RPP-0439`
  driver audit evidence redaction. Focused command:
  `node --test --test-name-pattern 'RPP-0439|plugin-owned option rows|plugin-owned data' test/push-planner.test.js`
  (9 passing focused proofs), plus `node --test test/push-planner.test.js`
  (99 passing planner/apply tests). The planner now records hash-only
  plugin-driver audit evidence on supported plugin-owned mutations, and the
  stale apply proof preserves drifted plugin-owned remote data before mutation
  while keeping base, local, and drifted remote private values out of audit and
  proof JSON. Caveat: this is focused local plugin-driver boundary evidence,
  not broad production plugin-driver readiness.
- Driver-registration regression continuation: `955ea001b` integrated
  `RPP-0461` driver registration API focused regression. Focused command:
  `node --test --test-name-pattern='RPP-0461|plugin-owned row driver registration API' test/playground-snapshot-lib.test.js`
  (2 passing focused proofs), plus
  `node --test test/playground-snapshot-lib.test.js` (5 passing
  snapshot/plugin-driver tests). The proof checks accepted built-in and
  extension driver registration, lookup by name/table, non-array filter
  fallback, and invalid/ambiguous registration refusal with hash-only accepted
  and refusal evidence. Caveat: this is focused local plugin-driver boundary
  evidence, not broad production plugin-driver readiness.
- Serialized option validator continuation: `d31d927fe` integrated `RPP-0468`
  serialized option validator focused regression. Focused command:
  `node --test --test-name-pattern 'RPP-0468|plugin-owned option rows|plugin-owned data' test/push-planner.test.js`
  (10 passing focused planner/apply tests), plus
  `node --test test/push-planner.test.js` (105 passing planner/apply tests).
  The proof accepts a valid serialized `wp_options` payload with hash-only
  validator evidence, rejects malformed and shape-mismatched serialized option
  payloads before mutation, keeps raw serialized payload strings out of plan,
  audit, journal, and refusal evidence, and leaves final release `NO-GO`.
  Caveat: this is focused local plugin-driver boundary evidence, not broad
  production plugin-driver readiness.
- Activation-hook effects continuation: `a18426a31` merged the existing
  `origin/session/rpp-32-rpp-0415-plugin-activation-hook-effects` branch
  (`cbf5a1a85`) with ancestry preserved. Focused commands:
  `node --check scripts/playground/production-plugin-package-scenarios.js scripts/playground/production-plugin-package-smoke.mjs scripts/playground/production-shaped-release-verify.mjs test/production-plugin-package-scenarios.test.js test/production-shaped-proof.test.js`,
  `node --test --test-name-pattern 'activation hook|production plugin-driver boundary proof accepts one owned row' test/production-shaped-proof.test.js`
  (3 passing production-shaped plugin-driver tests),
  `node --test test/production-plugin-package-scenarios.test.js` (7 passing
  scenario parser tests), and
  `REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-activation-hook-effects-guards node scripts/playground/production-plugin-package-smoke.mjs`
  (driver activation-hook effects boundary reports blocked unproven effects and
  quarantined driver-proofed effects as support-only). The broader touched
  command
  `node --test test/production-shaped-proof.test.js test/production-plugin-package-scenarios.test.js`
  still has 15 pre-existing failures: the RPP-0415 merge produced the same 15
  normalized failure names and first-line error summaries as clean
  `origin/lane/evidence-integration-20260527`, while adding only passing
  activation-hook tests. Caveat: this is focused local plugin-driver support
  evidence, not broad production plugin-driver readiness or a broad-suite pass.
- Generated wp_posts continuation: `b01b009a9` integrated `RPP-0107`
  `wp_posts` create/update/delete coverage. The generated harness now exposes
  20 `wp_posts` target cases across all 10 tiers, split into 10 ready and 10
  conflict cases, with ready plans preserving unplanned remote data.
- Generated wp_postmeta continuation: `00987b359` integrated `RPP-0108`
  `wp_postmeta` create/update/delete coverage. The generated harness now
  exposes 20 `wp_postmeta` target cases across all 10 tiers, split into 10
  ready and 10 conflict cases, with ready plans preserving unplanned remote data
  and rejecting stale replays before mutation.
- Generated users/usermeta continuation: `400d9072b` integrated `RPP-0109`
  `wp_users`/`wp_usermeta` graph coverage. The generated harness now exposes
  20 users/usermeta graph target cases across all 10 tiers, with ready cases
  creating the user and usermeta row together and stale cases refusing drifted
  remote users before mutation.
- Generated comments/commentmeta continuation: `ec0e41d49` integrated
  `RPP-0110` `wp_comments`/`wp_commentmeta` graph coverage. The generated
  harness now exposes 20 comments/commentmeta graph target cases across all 10
  tiers, with ready cases creating the comment and commentmeta row together and
  stale cases refusing drifted remote comments before mutation.
- Generated terms/termmeta continuation: `7dcc06bc` integrated `RPP-0111`
  `wp_terms`/`wp_termmeta` graph coverage. The generated harness now exposes
  20 terms/termmeta graph target cases across all 10 tiers, with ready cases
  creating the term and termmeta row together and stale cases refusing drifted
  remote terms before mutation.
- Generated plugin-owned option continuation: `5a73abe79` integrated
  `RPP-0114` plugin-owned `wp_options` update coverage. The generated harness
  now exposes 20 plugin-owned option target cases across all 10 tiers, split
  into ready and conflict cases, with ready cases carrying owner/driver evidence
  and rejecting stale replay before mutation.
- Generated stale-replay target continuation: `24c061259` integrated
  `RPP-0117` stale remote after dry-run coverage. The generated harness keeps
  the 510-case run and now exposes a `staleRemoteAfterDryRun` target with 268
  ready stale-replay rejections spread across all 10 tiers, excluding
  zero-mutation ready cases that have no planned target to drift.
- Generated same-content continuation: `9409be010` integrated `RPP-0118` same
  independent content coverage. The generated harness keeps the 510-case run and
  now exposes 10 same-independent-content target cases across all 10 tiers, with
  ready cases applying as already-in-sync decisions and preserving unplanned
  remote resources.
- Generated large-ready-plan continuation: `a82afb2d7` integrated `RPP-0120`
  large ready plan tier coverage. The generated harness keeps the 510-case run
  and now exposes 10 large ready plan target cases across all 10 tiers, with
  ready cases combining row/file create-update-delete work, same-plan
  taxonomy/comment graph rows, remote-only drift preservation, and stale replay
  rejection before mutation.
- Generated file-mix target continuation: `ff2506b9d` integrated `RPP-0121`
  file create/update/delete mix target coverage. The generated harness keeps
  the 510-case run and now exposes 20 file create/update/delete mix target cases
  across all 10 tiers, with ready cases creating, updating, and deleting one
  file while rejecting stale replay before mutation, and conflict cases drifting
  the updated file remotely and refusing apply.
- Generated directory-descendant continuation: `c85072c67` integrated
  `RPP-0122` directory descendant target coverage. The generated harness keeps
  the 510-case run and now exposes 20 directory descendant target cases across
  all 10 tiers, with ready directory deletes preserving unplanned remote data
  and rejecting stale replay before mutation while remote-descendant conflicts
  continue to refuse apply.
- Generated file type-swap continuation: `6f3da8760` integrated `RPP-0123`
  file type-swap target coverage. The generated harness keeps the 510-case run
  and now exposes 20 file type-swap target cases across all 10 tiers, with ready
  directory-to-file swaps preserving unplanned remote data and rejecting stale
  replay before mutation while remote descendant conflicts continue to refuse
  apply.
- Generated row CUD continuation: `8deda47ef` integrated `RPP-0124`
  row create/update/delete mix target coverage. The generated harness keeps the
  510-case run and now exposes 20 row create/update/delete mix target cases
  across all 10 tiers, with ready row creates, updates, and deletes rejecting
  stale replay before mutation while concurrent remote row drift continues to
  refuse apply.
- Generated wp_options scalar continuation: `40e43286d` integrated `RPP-0125`
  `wp_options` scalar target coverage. The generated harness keeps the 510-case
  run and now exposes 20 `wp_options` scalar option target cases across all 10
  tiers, with ready scalar option updates preserving unplanned remote data and
  rejecting stale replay before mutation while remote scalar drift continues to
  refuse apply.
- Generated wp_options serialized continuation: `27d31cba2` integrated
  `RPP-0126` `wp_options` serialized target coverage. The generated harness
  keeps the 510-case run and now exposes 20 serialized `wp_options` target cases
  across all 10 tiers, with ready serialized option updates preserving unplanned
  remote data and rejecting stale replay before mutation while remote serialized
  drift continues to refuse apply with private payload evidence redacted to
  hashes and metadata.
- Generated wp_posts continuation: `92430ed12` integrated `RPP-0127`
  `wp_posts` create/update/delete target proof. The generated harness keeps the
  510-case run and now proves 10 ready and 10 conflict `wp_posts`
  create/update/delete target cases across all 10 tiers, with every ready case
  applying create/update/delete mutations, preserving unplanned remote data, and
  rejecting stale replay before mutation while remote post drift remains a
  conflict that refuses apply.
- Generated wp_postmeta continuation: `0eda594cf` integrated `RPP-0128`
  `wp_postmeta` create/update/delete target proof. The generated harness keeps
  the 510-case run and now proves 10 ready and 10 conflict `wp_postmeta`
  create/update/delete target cases across all 10 tiers, with every ready case
  applying create/update/delete mutations, preserving unplanned remote data, and
  rejecting stale replay before mutation while remote postmeta drift remains a
  conflict that refuses apply.
- Generated wp_users/usermeta continuation: `2b8e28dec` integrated `RPP-0129`
  `wp_users`/`wp_usermeta` graph target proof. The generated harness keeps the
  510-case run and now proves the user/usermeta graph target across all 10 tiers,
  with ready cases creating the user plus usermeta row, preserving unplanned
  remote data, and rejecting stale replay before mutation while stale remote user
  drift remains non-ready and private user password, activation-token, and
  usermeta payload evidence is represented only by redacted hashes and metadata.
- Generated wp_comments/commentmeta continuation: `d0c829d50` integrated
  `RPP-0130` `wp_comments`/`wp_commentmeta` graph target proof. The generated
  harness keeps the 510-case run and now proves 10 ready and 10 non-ready
  comments/commentmeta graph target cases across all 10 tiers, with ready cases
  creating the comment plus commentmeta row, preserving unplanned remote data,
  and rejecting stale replay before mutation while stale remote comment drift
  remains non-ready and refuses apply.
- Generated wp_terms/termmeta continuation: `c0115aa9f` integrated `RPP-0131`
  `wp_terms`/`wp_termmeta` graph target proof. The generated harness keeps the
  510-case run and now proves one ready terms/termmeta graph case in every tier
  plus stale non-ready graph references in tiers 0 through 8, with ready cases
  creating the term plus termmeta row, preserving unplanned remote data, and
  rejecting stale replay before mutation while stale remote term drift remains
  non-ready and refuses apply.
- Generated term-taxonomy continuation: `64ef8c0b3` integrated `RPP-0132`
  `wp_term_taxonomy` graph target proof. The generated harness keeps the
  510-case run and now proves the 18 current term-taxonomy graph cases across
  all 10 tiers, split into nine ready cases and nine stale non-ready cases, with
  ready cases creating the term plus taxonomy row, preserving unplanned remote
  data, rejecting stale replay before mutation, and keeping generated taxonomy
  descriptions plus stale term drift values in redacted hash-only evidence.
- Generated term-relationships continuation: `91d342d67` integrated
  `RPP-0113` and `RPP-0133` `wp_term_relationships` graph target proof. The
  generated harness keeps the 510-case run and now proves one relationship
  target in every tier, split into five ready cases and five stale blocked
  cases, with ready cases creating the term, taxonomy, and relationship rows,
  preserving unplanned remote data, rejecting stale replay before mutation, and
  keeping generated relationship term/taxonomy values plus stale taxonomy drift
  values in redacted hash-only evidence.
- Generated plugin-owned option continuation: `426fab7b8` integrated
  `RPP-0134` plugin-owned `wp_options` target proof. The generated harness
  keeps the 510-case run and now proves 18 plugin-owned option target cases
  across all 10 tiers, split into nine ready cases and nine conflict cases,
  with ready cases carrying owner/driver evidence, preserving unplanned remote
  data, rejecting stale replay before mutation, and keeping private option
  tokens and notes in redacted hash-only evidence.
- Generated plugin-owned custom-table continuation: `d5998ce84` integrated
  `RPP-0135` forms-lab custom-table target proof. The generated harness keeps
  the 510-case run and now proves 20 plugin-owned custom-table target cases
  across all 10 tiers, split into 10 ready, three blocked, and seven conflict
  cases, with ready cases carrying fixture driver evidence, preserving unplanned
  remote data, rejecting stale replay before mutation, and refusing custom-table
  deletes when the driver lacks delete support.
- Graph-identity continuation: `1df596398` integrated `RPP-0310` `post_tag`
  taxonomy evidence. Focused planner and local-production proof tests now carry
  same-plan `wp_terms`, `wp_term_taxonomy`, and `wp_term_relationships` rows for
  a `post_tag` surface through live precondition, apply-time revalidation, and
  post-apply snapshot matching while unsupported taxonomy/menu surfaces remain
  fail-closed.
- Generated term-taxonomy continuation: `63840e538` integrated `RPP-0112`
  `wp_term_taxonomy` graph coverage. The generated harness now exposes 20
  `wp_term_taxonomy` target cases across all 10 tiers, split into ready and
  stale/non-ready graph cases, with stale remote term drift held before
  mutation.
- AO topology cleanup: stale worker sessions, the orphaned `rpp-orchestrator`
  pane, and the AO dashboard child tree were stopped after the dashboard parent
  was killed by memory pressure. The next handoff keeps one visible AO process
  in `main:1` and keeps integration-lane updates serialized.
- Verification for this entry: checklist counts, focused Docker/evidence
  manifest tests, `node --test test/release-gates.test.js test/release-gate-cli.test.js`
  with 28 passing
  release-gate tests, `node --test test/plugin-owner-context-metadata-refusal.test.js`
  with 3 passing tests, `node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  with 29 passing tests, `node --test test/progress-html-release-timestamp.test.js test/release-gates-status-row.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  with 30 passing tests,
  `node --test test/verify-release-failure-reason.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  with 29 passing tests, `node --test test/playground-snapshot-lib.test.js`
  with 4 passing tests,
  `node --test test/release-gate-preflight-route-identity-generated.test.js test/release-gate-same-source-generated.test.js test/verify-release-failure-reason.test.js test/progress-html-release-timestamp.test.js test/release-gates-status-row.test.js test/release-gates.test.js test/release-gate-cli.test.js`
  with 35 passing tests,
  `node --test --test-name-pattern 'RPP-0438|fixture forms lab table journal redacts raw payload values' test/push-planner.test.js`
  with 3 passing focused tests,
  `node --test --test-name-pattern 'RPP-0439|plugin-owned option rows|plugin-owned data' test/push-planner.test.js`
  with 9 passing focused tests, the `rpp-28`
  `node --test --test-name-pattern='RPP-0227' test/push-planner.test.js`
  focused test with 1 passing proof,
  `node --test --test-name-pattern=RPP-0228 test/push-planner.test.js`
  focused test with 1 passing proof,
  `node --test --test-name-pattern='RPP-0229' test/push-planner.test.js`
  focused test with 1 passing proof,
  `node --test --test-name-pattern='RPP-0230' test/generated-push-harness.test.js`
  focused test with 1 passing proof,
  `node --test test/generated-push-harness.test.js` with 8 passing tests,
  `node --test test/push-planner.test.js`
  with 108 passing planner tests, provenance/linter/artifact focused tests,
  evidence manifest
  generation, artifact redaction scan over evidence/report paths, and
  `git diff --check`.
- Release posture: final release remains **NO-GO**. This update makes tracking
  stricter and integrates fail-closed/local audit surfaces; it does not supply
  external production WordPress, production credentials, final release gate
  evidence, broad plugin semantics, production chunk receipts, or red-suite
  fixes.

## 2026-05-28 - Gate, Recovery, Chunk, Plugin, Audit, Graph, Auth, and Supervision Hold Refresh

- Last update: 2026-05-28 03:22 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527` at
  `25c667cd4` (`Refresh AO supervision handoff`).
- New integrated release-gate evidence: `ab0340786` extends
  [docs/evidence/ao-release-gates.md](evidence/ao-release-gates.md) and
  [test/release-gates.test.js](../test/release-gates.test.js) so the first 20
  modeled gates now have 11 focused tests, including missing/failed auth,
  route, read-only, operator-proof, timestamp, status-row, and nonzero
  `verify:release` failure evidence.
- New integrated recovery evidence:
  [docs/evidence/ao-journal-recovery.md](evidence/ao-journal-recovery.md),
  [src/recovery-journal.js](../src/recovery-journal.js),
  [src/recovery-inspect.js](../src/recovery-inspect.js), and
  [test/recovery-journal.test.js](../test/recovery-journal.test.js).
  Recovery journals now have deterministic paged restart readback,
  claim-scoped stale lease identity, append-only same-claim retry evidence, and
  a fail-closed guard that refuses `journal-completed` after incomplete apply.
- New integrated chunking evidence:
  [docs/evidence/ao-chunking-benchmark.md](evidence/ao-chunking-benchmark.md),
  [scripts/bench/guarded-executor-benchmark.js](../scripts/bench/guarded-executor-benchmark.js),
  [test/guarded-executor-benchmark.test.js](../test/guarded-executor-benchmark.test.js),
  and [docs/fast-paths.md](fast-paths.md). The benchmark names 10 rollout
  safety gates before throughput; 7 pass in the lab model and 3 remain blocked
  for production storage receipts, production row batch execution, and
  production atomic group commit evidence.
- New integrated plugin-driver evidence:
  [docs/evidence/ao-plugin-driver.md](evidence/ao-plugin-driver.md) records
  exact owner/driver/table binding for the production release-state row plus
  fail-closed guards for arbitrary custom tables, serialized plugin-owned
  options, direct activation/update, and direct `active_plugins` mutation.
- New integrated audit evidence:
  [docs/evidence/ao-independent-audit.md](evidence/ao-independent-audit.md),
  [docs/evidence/ao-critic.md](evidence/ao-critic.md),
  [audits/ao-independent-audit-20260528.md](../audits/ao-independent-audit-20260528.md),
  and [audits/ao-critic-20260528.md](../audits/ao-critic-20260528.md). The
  audits keep release at no-go, cite the fail-closed `verify:release` posture,
  missing repo-local CI workflow, and red broader-suite/auth/plugin/snapshot
  risks.
- New integrated graph evidence:
  [docs/evidence/ao-graph-identity.md](evidence/ao-graph-identity.md),
  [src/planner.js](../src/planner.js),
  [scripts/bench/graph-mapping-inventory.js](../scripts/bench/graph-mapping-inventory.js),
  [test/push-planner.test.js](../test/push-planner.test.js), and
  [test/graph-mapping-inventory.test.js](../test/graph-mapping-inventory.test.js)
  add explicit identity-map rewrites and fail-closed collision handling for a
  defined WordPress graph slice.
- New integrated executor auth/lease evidence:
  [docs/evidence/ao-executor-auth-leases.md](evidence/ao-executor-auth-leases.md),
  [src/authenticated-http-push-client.js](../src/authenticated-http-push-client.js),
  [test/authenticated-http-push-client.test.js](../test/authenticated-http-push-client.test.js),
  [docs/protocol.md](protocol.md), and protocol fixtures prove idempotency-free
  signed read-only journal/recovery inspect requests, canonical signed query
  ordering, fresh retry nonces, and idempotency-bound mutation paths. The
  evidence doc keeps broader authenticated-client production-shaped failures as
  blockers rather than readiness evidence.
- New integrated supervision evidence:
  [docs/evidence/ao-supervision-handoff.md](evidence/ao-supervision-handoff.md)
  now records the live `rpp-10` through `rpp-21` team, retired stale
  `rpp-1` through `rpp-9` panes after pushed branch verification, and reiterates
  no AO lifecycle helpers/no remote tunnels for this sandbox.
- RPP evidence carried by the integrated commits includes `RPP-0008` through
  `RPP-0020`, `RPP-0301`, `RPP-0304`, `RPP-0305`, `RPP-0312`, `RPP-0313`,
  `RPP-0314`, `RPP-0318`, `RPP-0319`, `RPP-0320`, `RPP-0321`, `RPP-0324`,
  `RPP-0325`, `RPP-0332`, `RPP-0333`, `RPP-0334`, `RPP-0402`, `RPP-0403`,
  `RPP-0404`, `RPP-0408`, `RPP-0409`, `RPP-0410`, `RPP-0412`, `RPP-0422`,
  `RPP-0423`, `RPP-0424`, `RPP-0428`, `RPP-0429`, `RPP-0430`,
  `RPP-0431`, `RPP-0432`, `RPP-0505`, `RPP-0506`, `RPP-0512`,
  `RPP-0513`, `RPP-0515`, `RPP-0525`, `RPP-0526`, `RPP-0532`, `RPP-0533`,
  `RPP-0535`, `RPP-0603`, `RPP-0604`, `RPP-0606`, `RPP-0614`,
  `RPP-0618`, `RPP-0619`,
  `RPP-0623`, `RPP-0624`, `RPP-0626`, `RPP-0634`, `RPP-0706`, `RPP-0707`,
  `RPP-0708`, `RPP-0720`, `RPP-0726`, `RPP-0727`, `RPP-0728`, `RPP-0901`
  through `RPP-0915`, `RPP-0921` through `RPP-0924`, `RPP-0926`, `RPP-0932`,
  `RPP-0933`, and supervision-handoff evidence for the current active roster.
- Progress-reporter verification passed:
  `node --test test/release-gates.test.js`,
  `node --test test/recovery-journal.test.js`,
  `npm run test:recovery:file-journal`, and
  `node --test test/guarded-executor-benchmark.test.js`,
  `node --test test/graph-mapping-inventory.test.js test/generated-push-harness.test.js`,
  `node --test test/push-planner.test.js`, targeted read-only authenticated-client checks,
  `node --check src/authenticated-http-push-client.js`, and protocol fixture JSON parsing.
- Checked results: release-gate evaluator 11 pass / 0 fail; recovery journal
  tests 21 pass / 0 fail; file-journal restart smoke kept fail-after-2 in
  `blocked-recovery` with 6 old / 2 new targets, replay applied 0 extra
  mutations, and drift exposed 1 blocked-unknown target; guarded benchmark
  tests 6 pass / 0 fail; graph inventory/generated harness checks 3 pass / 0 fail;
  push planner checks 87 pass / 0 fail; targeted auth read-only inspect checks,
  source syntax check, and protocol fixture JSON parsing passed.
- Active AO roster from tmux: developer lanes `rpp-10` through `rpp-14` are
  working on Docker/local production, rollback repair, release CI gates,
  evidence redaction, and protocol compatibility; `rpp-15` is the critic;
  `rpp-16` is this progress reporter; `rpp-17` through `rpp-21` are active
  integration/route/operator-proof workers; `rpp-orchestrator` remains visible.
  Remaining branch-local outputs are `rpp-9` prior progress evidence and
  `rpp-18` evidence coverage manifest `56a1e533b`; `rpp-1` through `rpp-8` are
  represented by integrated commits listed above.
- Release posture: final release remains held. The new commits improve gate
  precision, local recovery boundaries, benchmark safety gates, plugin-driver
  support guards, audit visibility, graph identity mapping, read-only auth inspect coverage,
  and supervision freshness, but
  Docker/external WordPress durability, production credential lifecycle,
  broader graph/plugin-driver semantics, rollback/repair completion, production
  chunk receipts/executors, redaction, protocol compatibility, required CI
  gates, broader production auth lifecycle fixes, and red-suite fixes still
  require production-backed evidence.
- Percent movement: no final readiness movement. This is integrated hardening
  and progress-report freshness, not final production proof.

## 2026-05-28 - Release Gate Evaluator and AO Progress Hold

- Last update: 2026-05-28 03:02 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527` at
  `243dfe777` (`Add fail-closed release gate evaluator`).
- New release-gate evidence:
  [src/release-gates.js](../src/release-gates.js),
  [test/release-gates.test.js](../test/release-gates.test.js), and
  [docs/evidence/ao-release-gates.md](evidence/ao-release-gates.md).
- What changed: `evaluateReleaseGates()` now emits a machine-readable
  `releaseMovement`, `candidateMovement`, exact per-gate evidence objects, and
  a tmux-friendly bracketed status marker. The first 20 release-gate foundation
  items now have executable evaluator coverage rather than stale percentages.
- Verification passed:
  `node --check src/release-gates.js`,
  `node --test test/release-gates.test.js`, and `git diff --check`.
- Checked test result: 8 pass / 0 fail in `test/release-gates.test.js`.
- Release posture: the evaluator can report `candidate-for-review` for complete
  local candidate evidence, but final `releaseMovement.allowed` remains `false`
  until every gate is backed by `final-release` evidence. This keeps Docker or
  external WordPress, production credential lifecycle, durable journal, broader
  graph/plugin coverage, rollback/repair, and benchmark rollout as required
  work.
- AO supervision update:
  [docs/evidence/ao-supervision-handoff.md](evidence/ao-supervision-handoff.md)
  now records the tmux-visible AO team and the no-helper operating rule:
  supervise with tmux/process/git inspection and bounded `ao spawn`, not
  hanging AO lifecycle helpers.
- Progress report:
  [docs/evidence/ao-progress-report.md](evidence/ao-progress-report.md) records
  the current no-go decision and separates integrated proof from unintegrated
  worker output.
- Percent movement: no final readiness movement. This is stronger release-gate
  machinery and operator evidence, not production release proof.

## 2026-05-28 - 1000-Item Completion Checklist

- Last update: 2026-05-28 02:43 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New tracker:
  `docs/reprint-push-completion-checklist.md`.
- Checklist shape at creation: exactly 1000 unchecked items, `RPP-0001` through
  `RPP-1000`, ordered from near-term release-gate foundation work through
  farthest release/operations work.
- Near-to-far sections:
  - `RPP-0001` through `RPP-0100`: release gate foundation;
  - `RPP-0101` through `RPP-0200`: generated harness expansion;
  - `RPP-0201` through `RPP-0300`: planner no-data-loss invariants;
  - `RPP-0301` through `RPP-0400`: WordPress graph identity mapping;
  - `RPP-0401` through `RPP-0500`: plugin-driver ownership boundary;
  - `RPP-0501` through `RPP-0600`: production executor and auth protocol;
  - `RPP-0601` through `RPP-0700`: durable journal and recovery;
  - `RPP-0701` through `RPP-0800`: storage, chunking, and performance;
  - `RPP-0801` through `RPP-0900`: production topology and integrations;
  - `RPP-0901` through `RPP-1000`: audit, release, and operations.
- Completion rule: an item is not complete until the named success evidence is
  present in repository files, command output, tmux proof, release gate status,
  or production run cited by the progress report. The checklist explicitly
  warns against marking items done from intent, design notes, or too-narrow
  fixtures.
- Team supervision: the next tmux-visible worker lanes are being started from
  this checklist, one slice at a time, with separate worktrees and branches so
  they can make progress without overwriting the integration branch.
- Verification:
  `rg -c '^- \\[ \\] RPP-[0-9]{4}' docs/reprint-push-completion-checklist.md`
  returned `1000`.

## 2026-05-28 - Generated Push Harness

- Last update: 2026-05-28 02:35 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command: `npm run test:generated-push-harness`.
- New harness: `scripts/harness/generated-push-cases.js` generates 360
  deterministic Reprint push cases by default, with a hard minimum of 300.
  The generator spans 10 complexity tiers and 24 scenario families, then adds
  seeded variation instead of storing exact-shaped fixture outputs.
- Coverage from the checked summary command:
  - 360 total cases;
  - statuses: 203 ready, 129 conflict, 28 blocked;
  - 36 cases in every tier from 0 through 9;
  - tier-9 still includes 16 ready/apply cases;
  - max resource count 69, max mutation count 44;
  - max ready resource count 66, max ready mutation count 43;
  - totals across all cases: 5008 planned mutations, 312 conflicts,
    375 blockers, and 929 decisions.
- Scenario surfaces include local edits, remote-only edits, independent merge,
  same independent content, deletes, delete/edit conflicts, file topology
  conflicts, supported and unsupported plugin-owned data, plugin owner-context
  drift, supported forms-lab custom-table rows, forms-lab delete refusal,
  atomic plugin install ready and missing-dependency paths, same-plan
  post-parent, taxonomy, comment, and usermeta graph closures, and stale graph
  references.
- General invariants checked for every generated case:
  plan summary counts match actual arrays; every mutation has a matching
  live-remote precondition and hash; ready plans apply only planned local
  values while preserving every unplanned remote resource; ready plans reject
  stale remotes before mutation; non-ready plans refuse apply and leave the
  remote unchanged; conflicts and blockers do not still carry mutations for
  the same blocked/conflicted resource; plugin-owned mutations carry explicit
  owner and driver evidence.
- Focused checks passed:
  `node --check scripts/harness/generated-push-cases.js`,
  `npm run test:generated-push-harness`,
  `node scripts/harness/generated-push-cases.js`, and `git diff --check`.
- Caveat: this is a pure generated model harness. It is intentionally broad,
  reusable, and fast, but it does not replace the live local production,
  Docker/external WordPress, auth/session, durable journal, or plugin-driver
  release-boundary proofs.
- Percent movement: merge invariants move from 71% to 72%; independent
  evidence moves from 72% to 74%. Recovery boundaries stay at 60%, reliable
  executor/protocol stays at 75%, and fast path/chunking stays at 37%.

## 2026-05-28 - Local Plugin Driver Release Evidence

- Last update: 2026-05-28 02:24 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:plugin-driver`
  passed in tmux window `main:plugin-driver-local-proof` with
  `[PLUGIN_DRIVER_LOCAL_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof now extracts a
  production-owned release-state plugin driver boundary for
  `row:["wp_reprint_push_release_state","state_id:1"]`. The proof records the
  exact owner `reprint-push`, driver `reprint-push-release-state`, custom
  table `wp_reprint_push_release_state`, plugin-owned allowlist entry,
  live-remote precondition, remote-drift conflict evidence, and apply-time
  revalidation.
- Planner evidence: the ready plan had 22 mutations, 22 live-remote
  preconditions, 0 blockers, and mutation families `file: 3`,
  `row:wp_options: 1`, `row:wp_postmeta: 5`, `row:wp_posts: 12`, and
  `row:wp_reprint_push_release_state: 1`. The remote-drift plan still failed
  closed with 9 preserve-remote conflicts.
- Plugin-driver evidence: the source release-state row hashed to
  `66e0ed254af87dc8528a54ef2f51f7a61d48b6f515d52e7959f31ff23b320549`,
  the local edited row hashed to
  `5a646c3411196965f91b027b8906486a47ee26b7d2ab5e82265c9e2b21fab9ba`,
  and the remote changed row hashed to
  `c5928d13e184cf03c37734c60271610918deb14fc97afad5313131255e3d3ab9`.
  The checked invariants prove the allowlist owner/driver match is exact,
  mutation `mutation-22` is driver-owned, the precondition is checked against
  the live remote and matches the source/base/remote-before hash, remote drift
  fails closed as `plugin-data-conflict`, direct `active_plugins` mutation is
  absent, unowned option mutation is absent, and the custom-table mutation is
  driver-owned.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `6b2e4ade17525e5d1c08e99f4f745257a41a19cba2e1cf5c8819e323bf337b13`,
  reported 74 durable DB-journal rows, `mutationApplied: 22`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 22`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK`, replay equivalence, and
  `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 22 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing with
  previous claim identity, 22/22 fully updated recovery inspect, and blocked
  apply-time revalidation state with `old: 21`, `new: 0`,
  `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:plugin-driver`.
- Caveat: this is local Playground loopback evidence for one
  production-owned release-state plugin-driver row. It does not prove arbitrary
  plugin semantics, arbitrary custom tables, plugin activation/update flows,
  rollback, Docker/external WordPress durability, or the final live production
  source boundary.
- Percent movement: merge invariants move from 70% to 71%; reliable
  executor/protocol moves from 73% to 75%; independent evidence moves from 70%
  to 72%. Recovery boundaries stay at 60%, and fast path/chunking stays at
  37%.

## 2026-05-28 - Plugin Driver Boundary Test Hardening

- Last update: 2026-05-28 02:13 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- Code change: the production-shaped proof tests now include a reusable
  plugin-driver proof fixture and three additional GATE-4 guard cases.
- New executable support evidence:
  - unknown plugin-owned custom-table data blocks before mutation with
    `unsupported-plugin-owned-resource`;
  - plugin-driver boundary proof rejects an allowlist entry whose owner and
    driver do not exactly match the production boundary;
  - direct `active_plugins` mutation and unowned serialized option mutation
    both fail the production plugin-driver boundary summary.
- Focused checks passed:
  `node --check test/production-shaped-proof.test.js`,
  `node --test --test-name-pattern "production plugin-driver boundary" test/production-shaped-proof.test.js`,
  and `git diff --check`.
- Caveat: this is support test coverage on the production-shaped proof
  summarizer and planner. It does not prove a live external WordPress
  plugin-owned mutation, arbitrary plugin semantics, activation/update flows,
  rollback, or Docker/external production durability.
- Percent movement: merge invariants move from 69% to 70%; reliable
  executor/protocol moves from 72% to 73%; independent evidence moves from 69%
  to 70%. Recovery boundaries stay at 60%, and fast path/chunking stays at
  37%.

## 2026-05-28 - Comment Graph Evidence And Journal Claim Readback

- Last update: 2026-05-28 02:06 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:comment-graph`
  passed in tmux window `main:comment-graph-proof4` with
  `[COMMENT_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a same-plan comment graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF=1`. The fixture
  creates a parent comment `row:["wp_comments","comment_ID:72801"]`, child
  comment `row:["wp_comments","comment_ID:72802"]`, and marker commentmeta
  row `row:["wp_commentmeta","meta_id:72811"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local comment parent, 1 local comment child, and 1 local commentmeta
  row. The ready plan had 25 mutations, 25 live-remote preconditions,
  0 blockers, and mutation families `file: 3`, `row:wp_commentmeta: 1`,
  `row:wp_comments: 2`, `row:wp_options: 1`, `row:wp_postmeta: 5`,
  `row:wp_posts: 12`, and `row:wp_reprint_push_release_state: 1`.
- Comment graph evidence: the parent comment references the fixture post, the
  child comment references the same-plan parent comment, the commentmeta row
  references the same-plan child comment, all three resources were planned
  with live preconditions, and `staleGraphBlockers: 0`. The remote-drift plan
  still failed closed with 9 preserve-remote conflicts and 3 blockers.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `a617629dfc086d29ffbbf907a425e54a90f6ca231d4de8c73dad3d39827018af`,
  reported 83 durable DB journal rows, `mutationApplied: 25`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 25`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 25 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing with
  previous claim id `psh_3547ecddfc8152e839d96b43bf2`, 25/25 fully updated
  recovery inspect, and blocked apply-time revalidation state with `old: 24`,
  `new: 0`, `blockedUnknown: 1`.
- Journal hardening: the 25-mutation run exposed that stale retry proof could
  lose the previous claim identity when a thinner recovery-inspect journal was
  selected. The checked JS durable-journal contract now requires previous
  claim identity whenever stale-claim rejection is asserted, checked recovery
  journal readback uses the 500-row window and can fetch the previous claim row
  by cursor, the release proof builder selects the strongest journal evidence
  candidate, and the authenticated client requests a 370-row first journal
  window for 25-mutation plans.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `node --check scripts/playground/production-shaped-live-release-verify-lib.js`,
  `node --check src/authenticated-http-push-client.js`,
  `node --check src/recovery-journal.js`,
  `php -l scripts/playground/snapshot-lib.php`,
  `php -l scripts/playground/push-db-journal-lib.php`,
  `php -l scripts/playground/push-remote-rest-plugin.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "comment|commentmeta|post parent|same-plan post|graph closure|featured image|taxonomy" test/push-planner.test.js`,
  `node --test --test-name-pattern "db journal proof requires the checked durable-journal contract|db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `node --test --test-name-pattern "checked durable journal" test/recovery-journal.test.js`,
  `node --test --test-name-pattern "durable recovery journal release proof" test/production-shaped-proof.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:comment-graph`.
- Caveat: this closes one local Playground same-plan comment/commentmeta
  fixture with stable fixture identities. It does not prove general WordPress
  identity rewriting for arbitrary comments, comment authors, comment
  moderation state, threaded comment imports, GUIDs, menus, serialized blocks,
  production importer/exporter identity maps, Docker/external WordPress
  durability, rollback, or general plugin-driver correctness.
- Percent movement: merge invariants move from 66% to 69%; recovery
  boundaries move from 58% to 60%; reliable executor/protocol moves from 71%
  to 72%; independent evidence moves from 67% to 69%. Fast path/chunking stays
  at 37% because this proof adds graph and journal correctness, not a new
  transfer benchmark.

## 2026-05-28 - Post Parent Graph Evidence

- Last update: 2026-05-28 01:37 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:post-parent-graph`
  passed in tmux window `main:post-parent-graph-proof` with
  `[POST_PARENT_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a same-plan `post_parent` graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF=1`. The
  fixture creates a local-only parent page
  `row:["wp_posts","ID:71801"]` and child page
  `row:["wp_posts","ID:71802"]`, where the child row's `post_parent` points at
  the same-plan parent row.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local post-parent graph parent, and 1 local post-parent graph child.
  The ready plan had 24 mutations, 24 live-remote preconditions, 0 blockers,
  and mutation families `file: 3`, `row:wp_options: 1`,
  `row:wp_postmeta: 5`, `row:wp_posts: 14`, and
  `row:wp_reprint_push_release_state: 1`.
- Graph evidence: the parent and child post resources were both planned with
  live preconditions, `childReferencesParent: true`, and
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `23d0f2068a5cff0b6ef62b4b3b40919e938f8d7d47d0a41198414cc3f1f6ddef`,
  reported 80 durable DB journal rows, `mutationApplied: 24`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 24`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 24 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 24/24
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 23`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "post parent|same-plan post|graph closure|featured image|taxonomy" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:post-parent-graph`.
- Caveat: this closes one local Playground same-plan `post_parent` fixture with
  stable fixture identities. It does not prove general WordPress identity
  rewriting for arbitrary parent/child pages, arbitrary attachments, GUIDs,
  menus, serialized blocks, custom taxonomies, production importer/exporter
  identity maps, external WordPress durability, rollback, or general
  plugin-driver correctness.
- Percent movement: merge invariants move from 64% to 66%; reliable
  executor/protocol stays at 71%; independent evidence moves from 66% to 67%.
  Recovery boundaries stay at 58%, and fast path/chunking stays at 37% because
  this proof adds graph coverage, not external crash durability or a larger
  transfer benchmark.

## 2026-05-28 - Taxonomy Graph Evidence

- Last update: 2026-05-28 01:20 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:taxonomy-graph`
  passed in tmux window `main:taxonomy-graph-proof` with
  `[TAXONOMY_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a category taxonomy graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF=1`. The fixture
  creates a local-only term row `row:["wp_terms","term_id:72901"]`, term
  taxonomy row `row:["wp_term_taxonomy","term_taxonomy_id:72911"]`, post-term
  relationship row
  `row:["wp_term_relationships","object_id:71001|term_taxonomy_id:72911"]`,
  and marker termmeta row `row:["wp_termmeta","meta_id:72921"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local taxonomy term, 1 local term taxonomy, 1 local term
  relationship, and 1 local termmeta row. The ready plan had 26 mutations,
  26 live-remote preconditions, 0 blockers, and mutation families `file: 3`,
  `row:wp_options: 1`, `row:wp_postmeta: 5`, `row:wp_posts: 12`,
  `row:wp_reprint_push_release_state: 1`, `row:wp_term_relationships: 1`,
  `row:wp_term_taxonomy: 1`, `row:wp_termmeta: 1`, and `row:wp_terms: 1`.
- Taxonomy graph evidence: the term, term taxonomy, relationship, and termmeta
  resources were all planned with live preconditions, and the planner reported
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts and 1 blocker.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `59a91092bc6b928fb8e2e25a2ea6151018af15525b5aea7f05cc475e545b9d93`,
  reported 88 durable DB journal rows, `mutationApplied: 26`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 26`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 26 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 26/26
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 25`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `php -l scripts/playground/snapshot-lib.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "featured image|taxonomy|termmeta|term relationship|same-plan post|graph closure|menu item graph|postmeta references" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:taxonomy-graph`.
- Caveat: this closes one local Playground category taxonomy fixture with
  stable fixture identities. It does not prove general WordPress identity
  rewriting for arbitrary terms, term splitting, custom taxonomies, GUIDs,
  menus, serialized blocks, `post_parent`, production importer/exporter
  identity maps, external WordPress durability, rollback, or general
  plugin-driver correctness.
- Percent movement: merge invariants move from 61% to 64%; reliable
  executor/protocol moves from 70% to 71%; independent evidence moves from 64%
  to 66%. Recovery boundaries stay at 58%, and fast path/chunking stays at 37%
  because this proof adds graph coverage, not external crash durability or a
  larger transfer benchmark.

## 2026-05-28 - Featured Image Graph Evidence

- Last update: 2026-05-28 01:08 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:graph`
  passed in tmux window `main:graph-featured-proof` with
  `[GRAPH_FEATURED_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a featured-image attachment graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF=1`. The fixture creates a
  local-only attachment row `row:["wp_posts","ID:71901"]` and matching
  `_thumbnail_id` postmeta row
  `row:["wp_postmeta","post_id:71001:meta_key:_thumbnail_id"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local featured image attachment, and 1 local featured image meta row.
  The ready plan had 24 mutations, 24 live-remote preconditions, 0 blockers,
  and mutation families `file: 3`, `row:wp_options: 1`,
  `row:wp_postmeta: 6`, `row:wp_posts: 13`, and
  `row:wp_reprint_push_release_state: 1`.
- Graph evidence: the attachment resource and `_thumbnail_id` resource were
  both planned with live preconditions, and the planner reported
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts and 2 blockers.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `3dfc96ccc1a4688078cc53a624de366dd4aa11e797b33e90ad83476b85e1c00b`,
  reported 80 durable DB journal rows, `mutationApplied: 24`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 24`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 24 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 24/24
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 23`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `php -l scripts/playground/snapshot-lib.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "featured image|postmeta references|same-plan post|graph closure|taxonomy|menu item graph|post author|comment|link owner" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:graph`.
- Caveat: this closes one local Playground featured-image attachment graph
  surface with stable fixture identities. It does not prove general WordPress
  identity rewriting for arbitrary attachments, GUIDs, menus, terms,
  serialized blocks, production importer/exporter identity maps, external
  WordPress durability, rollback, or general plugin-driver correctness.
- Percent movement: merge invariants move from 58% to 61%; reliable
  executor/protocol moves from 69% to 70%; independent evidence moves from 62%
  to 64%. Recovery boundaries stay at 58%, and fast path/chunking stays at 37%
  because this proof adds graph coverage, not external crash durability or a
  larger transfer benchmark.

## 2026-05-28 - Paged Journal Restart Evidence

- Last update: 2026-05-28 00:59 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run test:playground:db-journal-process-kill`
  passed in tmux window `main:journal-restart-pages` with
  `[JOURNAL_RESTART_PAGES_STATUS:0]`.
- Code change: the local process-kill smoke now builds the crash plan from a
  live host-mounted Playground `/snapshot` response, waits for the DB journal
  to cross the restart readback page size before sending `SIGKILL`, and then
  verifies paged DB-journal readback after restart and after exact retry.
- Recovery evidence: after the restart and after retry, the smoke read
  `/db-journal` with `limit=10` cursor pages until the oldest sequence was
  reached. Both readbacks were complete and non-truncated, crossed 10 pages,
  recovered 99 rows, and covered sequences 1 through 99.
- Crash evidence: the kill happened after the DB journal had at least 11 rows,
  while the apply was in flight. The restarted site reported no false
  `apply-committed` state, classified 160 planned targets as `32 new`,
  `128 old`, `0 blockedUnknown`, and exposed `blocked-recovery` without using
  the legacy option journal for classification.
- Retry evidence: exact same key/body retry returned
  `409 RECOVERY_BLOCKED`, left the target snapshot unchanged, preserved the
  same old/new classifications, and did not overwrite the partial state.
- Focused checks passed:
  `node --check scripts/playground/db-journal-process-kill-smoke.mjs`,
  `git diff --check`, and
  `npm run test:playground:db-journal-process-kill`.
- Caveat: this is still local Playground SQLite/host-mount hard-kill evidence.
  It does not prove Docker/external WordPress crash durability, storage
  `fsync`, generic MySQL/InnoDB behavior, rollback, broader graph recovery, or
  arbitrary plugin-driver safety.
- Percent movement: recovery boundaries move from 55% to 58%; reliable
  executor/protocol moves from 68% to 69%; fast path and chunking moves from
  36% to 37%; independent evidence moves from 60% to 62%. Merge invariants stay
  at 58% because this proof strengthens recovery readback, not new graph
  identity coverage.

## 2026-05-28 - Journal Pages Complex-Site Evidence

- Last update: 2026-05-28 00:49 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:journal-pages`
  passed in tmux window `main:journal-pages-proof` with
  `[JOURNAL_PAGES_PROOF_FINAL_STATUS:0]`.
- Code change: the DB-journal REST surface now supports paged readback with
  `beforeSequence`/`beforeCursor`, keeps page metadata, and allows up to 500
  rows per DB-journal page. The authenticated push client now reads the first
  mutation-sized journal page and follows older pages until the reported
  journal `rowCount` is covered or the page cap is hit.
- Release-client guardrail: a paginated DB-journal proof is rejected if the
  readback is incomplete or truncated. The same work also fixed signed retry
  behavior so retried authenticated requests regenerate their nonce while
  preserving the idempotency key and body.
- Unit regression: the focused authenticated client test now fakes a 602-row
  durable journal and verifies three readback requests:
  `?limit=80`, `?limit=500&beforeSequence=523`, and
  `?limit=500&beforeSequence=23`. It asserts 602 recovered rows,
  600 `mutation-applied` events, `readbackPages: 3`,
  `paginationComplete: true`, and `paginationTruncated: false`.
- Planner evidence: the journal-pages command expanded the local production
  topology to 180 complex posts per site, 182 exported posts per site,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 release-state row, and 12 plugin-owned allowlist entries. The ready
  plan had 190 mutations and 190 live-remote preconditions. The remote-drift
  plan still failed closed with 9 `preserve-remote-and-stop` conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `2b533a363d288706575ae2772edd54aa51a150aa97c96b436d36f64ced3222dd`,
  reported 580 durable DB journal rows, `mutationApplied: 190`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 190`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session and durable journal, replay
  equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery evidence now includes same-key/body replay with 190 mutation
  events, same-key/different-body conflict before mutation, stale-owner
  fencing, 190/190 fully updated recovery inspect, and blocked apply-time
  revalidation state with `old: 189`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check src/authenticated-http-push-client.js`,
  `node --check scripts/playground/production-shaped-release-verify.mjs`,
  `node --check scripts/playground/production-shaped-live-release-verify.mjs`,
  `php -l scripts/playground/push-remote-rest-plugin.php`,
  `php -l scripts/playground/push-db-journal-lib.php`,
  `node --test --test-name-pattern "retries idempotent signed posts|paginates durable db journal readback|db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:journal-pages`.
- Caveat: this is still local Playground loopback WordPress evidence. It does
  not prove Docker/external restart behavior, external crash durability,
  rollback, broader WordPress graph surfaces, or arbitrary plugin-driver
  correctness.
- Percent movement: merge invariants move from 57% to 58%; recovery boundaries
  move from 50% to 55%; reliable executor/protocol moves from 64% to 68%;
  fast path and chunking moves from 30% to 36% because the proof now crosses
  more than one durable journal page; independent evidence moves from 56% to
  60%.

## 2026-05-28 - Journal Window Complex-Site Evidence

- Last update: 2026-05-28 00:16 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:journal-window`
  passed in tmux window `main:journal-window-proof`.
- Code change: the authenticated release client now sizes the
  `/db-journal` readback window from the planned mutation count instead of
  always requesting `limit=80`. The local WordPress journal endpoint already
  accepted up to 500 rows; the verifier now requests enough rows for the
  checked mutation set.
- Dense-shape verifier change: the complex local production proof can now be
  expanded with `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT`. The journal
  window command uses 25 complex posts, yielding a 35-mutation ready plan.
- Planner evidence: 27 exported posts per site, 25 complex posts, 5 complex
  form-schema postmeta rows, 3 complex upload files, 4 forms-lab rows,
  1 release-state row, and 12 plugin-owned allowlist entries. The ready plan
  had 35 mutations and 35 live-remote preconditions. The remote-drift plan
  still failed closed with 9 `preserve-remote-and-stop` conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `449044f7c65c27d27679eaee7c1ecf4b270b484444c1a2550dc1cc034f11d15f`,
  reported 115 durable DB journal rows, `mutationApplied: 35`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 35`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session and durable journal, replay
  equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery evidence now includes same-key/body replay with 35 mutation events,
  same-key/different-body conflict before mutation, stale-owner fencing,
  35/35 fully updated recovery inspect, and blocked apply-time revalidation
  state with `old: 34`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check src/authenticated-http-push-client.js`,
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `node --test --test-name-pattern "db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:journal-window`.
- Broad-suite caveat: the large
  `node --test test/authenticated-http-push-client.test.js` run still reports
  existing release-boundary expectation failures outside the journal-window
  regression; the focused regression added here passes.
- Caveat: this is still local Playground loopback WordPress evidence. It does
  not prove Docker/external restart behavior, external crash durability,
  rollback, broader WordPress graph surfaces, or general plugin-driver proof.
- Percent movement: merge invariants move from 55% to 57%; recovery boundaries
  move from 46% to 50%; reliable executor/protocol moves from 61% to 64%;
  fast path and chunking moves from 24% to 30% because the previously rejected
  35-mutation journal-window run is now accepted; independent evidence moves
  from 53% to 56%.

## 2026-05-28 - Complex Local Production Evidence

- Last update: 2026-05-28 00:03 CEST.
- Current complex-site lane:
  `lane/complex-site-local-production-20260527`.
- Full Brewcommerce/WooCommerce import attempt:

  ```bash
  REPRINT_PUSH_LOCAL_PRODUCTION_FULL_BREWCOMMERCE=1 \
  REPRINT_PUSH_LOCAL_PROD_STARTUP_TIMEOUT_MS=120000 \
  NODE_NO_WARNINGS=1 \
  timeout 240s node ./scripts/playground/local-production-release-verify.mjs
  ```

  It booted all four local Playground WordPress sites, then failed closed in the
  checked release verifier with `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`
  because the live source auth/session preflight read timed out. This is not
  accepted release evidence.
- New bounded proof command:
  `npm run verify:release:local-production:complex-site` passed.
- Complex-site planner evidence: the Brewcommerce-derived local topology now
  seeds 14 exported posts per site, including 12 complex fixture posts, 5
  complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab rows,
  1 release-state row, and 12 plugin-owned allowlist entries. The ready plan
  has 22 mutations and 22 live-remote preconditions. The remote-drift plan
  fails closed with 9 conflicts, all `preserve-remote-and-stop`.
- Complex-site release evidence: the checked verifier applied 22 mutations,
  emitted dry-run receipt
  `e43b5f22433929fbea204fb0cd7e4d8ad8ce7a031badea3b89377416614804f6`,
  reported 74 durable DB journal rows, `mutationApplied: 22`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `AUTH_SESSION_BOUNDARY_OK`, `LIVE_RELEASE_BOUNDARY_OK` for auth session and
  durable journal, replay equivalence, and
  `releaseMovement.gates: candidate-for-review`.
- Guardrail learned during implementation: a larger 35-mutation dense run
  correctly failed closed because the current DB-journal readback window only
  retained 25 mutation-applied events. The accepted proof is therefore bounded
  to 22 mutations until journal pagination/receipt windows are expanded.
- Targeted checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `npm run test:playground:local-production-complex-site-proof`, and
  `npm run verify:release:local-production:complex-site`.
- Caveat: this remains local Playground production-shaped evidence. Docker or
  external WordPress, external crash durability, rollback, broader WordPress
  graph surfaces, and general plugin-driver proof still block final release
  readiness.
- Percent movement: merge invariants move from 54% to 55%; recovery boundaries
  move from 45% to 46%; reliable executor/protocol moves from 60% to 61%;
  fast path and chunking moves from 20% to 24% because there is now a bounded
  complex-site receipt/journal proof, not a large chunk proof; independent
  evidence moves from 51% to 53%.

## 2026-05-27 - Runtime And Graph Identity Evidence

- Last update: 2026-05-27 23:39 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- Runtime capability proof: `origin/lane/runtime-proof-feasibility-20260527`
  adds
  [scripts/playground/runtime-capability-proof.mjs](../scripts/playground/runtime-capability-proof.mjs),
  its focused test, and
  [docs/audits/runtime-capability-proof-20260527.md](audits/runtime-capability-proof-20260527.md).
  In this sandbox the proof exits `1` with `DOCKER_RUNTIME_UNAVAILABLE`,
  records `npm run verify:release:local-production` as the closest checked
  local substitute, and prints the exact external `REPRINT_PUSH_* npm run
  verify:release` command required on a Docker or external WordPress host.
- Graph identity proof:
  `origin/lane/graph-identity-local-durable-20260527` maps the real Playground
  post/postmeta author graph identity that had blocked the push protocol smoke.
  The snapshot exporter now includes stable author identity rows as graph
  targets, while user mutation remains unsupported. Menu/navigation graph
  surfaces remain fail-closed.
- Graph proof commands passed in `main:graph-id-proof`:
  `php -l scripts/playground/snapshot-lib.php`,
  `node --test test/push-planner.test.js`,
  `node --test test/graph-mapping-inventory.test.js`,
  `npm run test:playground:push-protocol`, and `git diff --check`. The protocol
  smoke reported an 8-mutation ready plan and no `wp_users` mutation.
- Broad-suite caveat: `npm test` still reports existing unrelated failures in
  production-auth/package/snapshot areas. The focused graph planner and
  protocol evidence above passed.
- Percent movement: merge invariants move from 48% to 54%; reliable
  executor/protocol moves from 58% to 60% because the runtime blocker is now
  executable and fail-closed; independent evidence moves from 44% to 51%.
  Recovery boundaries stay 45%, and fast path stays 20%.
- Remaining release blockers: Docker or external WordPress proof, real
  crash/restart durability outside Playground, general plugin-driver ownership,
  broader WordPress graph surfaces, rollback, and large-site chunk benchmarks.

## 2026-05-27 - Durable Local Production Journal Proof

- Last update: 2026-05-27 23:22 CEST.
- Current durable proof branch:
  `lane/durable-journal-local-production-20260527`.
- New proof: `npm run verify:release:local-production` passed in the
  `main:durable-proof2` tmux window and printed `DURABLE_PROOF_STATUS:0`.
- Release movement: the live local topology now reports
  `releaseMovement.allowed: true`, `gates: candidate-for-review`, and
  `reason: checked live source/local/changed topology passed without packaged
  fallback`.
- Durable journal boundary: the checked live path reports
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, and
  replay/retry. The accepted DB journal includes `ownsJournal: true`,
  `restartReadable: true`, `productionAdapter: wpdb-single-statement-cas`,
  `writerLease.storageGuard: wpdb-single-statement-cas`, and
  `leaseFence.storageGuard: wpdb-single-statement-cas`.
- Code evidence:
  [scripts/playground/push-db-journal-lib.php](../scripts/playground/push-db-journal-lib.php)
  now carries the `leaseFence.storageGuard` contract through the checked PHP
  journal summary, and
  [test/authenticated-http-push-client.test.js](../test/authenticated-http-push-client.test.js)
  keeps the strict JS client proof closed unless that guard is present.
- Targeted checks passed:
  `php -l scripts/playground/push-db-journal-lib.php`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `git diff --check -- scripts/playground/push-db-journal-lib.php test/authenticated-http-push-client.test.js`,
  `node --test test/recovery-journal.test.js`, and
  `node --test --test-name-pattern='db journal proof requires the checked durable-journal contract when explicitly requested' test/authenticated-http-push-client.test.js`.
- Caveat: this is still local Playground production-shaped evidence. Docker is
  not installed in the sandbox, and final release readiness still needs the
  same proof on Docker or external WordPress plus graph identity mapping and
  general plugin-driver coverage.
- Percent movement: recovery boundaries move from 36% to 45%; reliable
  executor/protocol moves from 51% to 58%; independent evidence moves from 38%
  to 44%; merge invariants get a small local-proof bump from 47% to 48%; fast
  path remains 20%.

## 2026-05-27 - Local Production Topology Proof

- Last update: 2026-05-27 19:26 CEST.
- Current local-production proof head: `540723dc8` (`Add local production
  release topology proof`) on `origin/lane/local-production-topology-20260527`.
- New proof: `npm run verify:release:local-production` passed in the
  `main:local-prod-proof` tmux window after rebasing onto
  `origin/supervisor/release-boundary-consolidated-20260527`; the shell
  reported `POST_REBASE_LAST_STATUS:0`.
- Topology: the harness boots four live loopback WordPress sites derived from
  the Brewcommerce blueprint assets: source, remote-changed, local-edited, and
  apply-revalidation-source. Docker is unavailable in this sandbox, so this is
  local Playground production-shaped evidence, not Docker evidence.
- Boundary improvement: the checked release path now has auth-session source
  readback for the local production source URL, durable-journal evidence
  preservation, and apply-time revalidation that rejects a production-owned
  `wp_reprint_push_release_state` row drift before mutation with
  `PRECONDITION_FAILED`.
- Code evidence:
  [scripts/playground/local-production-release-verify.mjs](../scripts/playground/local-production-release-verify.mjs),
  [scripts/playground/snapshot-lib.php](../scripts/playground/snapshot-lib.php),
  [scripts/playground/production-shaped-apply-revalidation-smoke.mjs](../scripts/playground/production-shaped-apply-revalidation-smoke.mjs),
  and [src/authenticated-http-push-client.js](../src/authenticated-http-push-client.js).
- Gate posture: release movement remains closed at `0/4`. The run still reports
  durable production journal storage as the remaining boundary, and graph
  identity/general plugin-driver proof still need independent audit.
- Cleanup: stale `/tmp/reprint-local-production-release-*` topology directories
  from failed runs were removed after confirming no Playground processes were
  active.

## 2026-05-26 - Release Journal Smoke Update

- Last update: 2026-05-26 11:58 CEST.
- Current reliable head: `998e856f` (`Surface replay equivalence in release verify`).
- New proof: the checked release verifier now surfaces top-level
  `replayEquivalence` evidence, and the focused release-proof test passed under
  `timeout 90s`.
- Trend: release-verify visibility improved, but the release gate remains
  closed at `0/4` because production auth/session lifecycle and durable journal
  ownership are still blocked.
- Audit note: the current head is `998e856f`; older head references in history
  are historical only and should not be published as current.
- Next nudge: keep the next proof tied to the audit decision and the next
  production-boundary auth/session, journal, or replay evidence.
- Public page: [progress.html](../progress.html) now reflects the current head
  and the replay-equivalence boundary in the visible summary.

## 2026-05-25 - Current Supervisor Snapshot

- Last update: 2026-05-25 00:47 CEST.
- Status: `89` Node tests pass after supervised lane merges.
- New proof: planner coverage now covers independent delete/edit cases; recovery
  keeps a concise acceptable-state contract; fast-path docs and tests pin
  hashing, chunking, row batching, and rejected shortcuts; protocol docs keep
  journal and recovery semantics tight; critic and objective audits match the
  evidence.
- Trend: no-data-loss, recovery, fast-path, reliable-executor, and audit lanes
  improved inside lab/model scope. Production readiness is still blocked.
- Supervision: next-proof fast-path, critic, and reliable-executor outputs were
  reviewed and integrated. The same-plan graph worker remains active and
  unmerged; the stale progress-publisher output was rejected because it used a
  future timestamp and heavy screenshot assets.
- Blocker: production credential lifecycle, durable storage, leases/fencing,
  full WordPress graph identity mapping, Docker/full Playground integration,
  and arbitrary plugin drivers remain unproven.
- Next nudge: keep production gates blocked until a worker proves production
  auth/session/journal internals and graph identity mapping.
- Public page: [progress.html](../progress.html) carries the visible update
  date and keeps details behind links.

<details>
<summary>Earlier progress entries</summary>

## 2026-05-24 - Integrated Feedback And Verification Refresh

- Integrated the feedback supervisor progress refresh into `main`.
  [progress.html](../progress.html) now shows a visible "Last updated:
  May 24, 2026" marker, a short supervisor feedback panel, and concise lane
  summaries.
- Fresh post-merge verification passed: `npm test` reported `64` Node scenarios,
  and the no-server Playground, authenticated CLI/HTTP push, file-journal
  recovery, storage-guarded DB/file write, DB process-kill, missing-commit
  finalization, stale-claim retry, forms table, and plugin atomic-install smokes
  all passed.
- Production readiness is unchanged. The next useful proof is still a
  production-shaped Reprint endpoint/auth/audit/recovery contract.

## 2026-05-24 - Progress Publisher Verification Refresh

- `npm test` passed in the integrated tree with `64` Node scenarios. Evidence:
  [package.json](../package.json),
  [test/push-planner.test.js](../test/push-planner.test.js),
  [test/recovery-journal.test.js](../test/recovery-journal.test.js), and
  [test/performance-model.test.js](../test/performance-model.test.js).
- `npm run test:playground` passed in this lane. Its three no-server
  Playground legs verified snapshot planning, guarded apply, and fixture
  protocol behavior. The plan leg reported the expected row, file, and
  plugin-data conflict classes; the apply leg verified eight fixture mutations;
  the protocol leg verified dry-run receipts, receipt mismatch refusal, stale
  precondition refusal, and conflict refusal. Evidence:
  [docs/playground-topology.md](playground-topology.md),
  [scripts/playground/plan-from-blueprints.mjs](../scripts/playground/plan-from-blueprints.mjs),
  [scripts/playground/apply-ready-plan.mjs](../scripts/playground/apply-ready-plan.mjs), and
  [scripts/playground/push-protocol-smoke.mjs](../scripts/playground/push-protocol-smoke.mjs).
- [progress.html](../progress.html) now separates the currently verified slice
  from linked standalone local-server lab evidence. It keeps percentages flat
  because the production gates did not move in this pass.
- Explicit pending gates remain: real WordPress push executor, production
  recovery journal, Docker/full Playground integration beyond disposable
  fixtures, and arbitrary plugin drivers. Current Playground proof is useful
  fixture evidence, not a production executor or recovery claim.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 42 Node test scenarios covering the deterministic JSON
  snapshot planner, applicator, and file-backed recovery journal. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js) and
  [test/performance-model.test.js](../test/performance-model.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, dependency version/hash
  checks, stale remote dependency blocking, and precondition hashes. Evidence:
  [src/planner.js](../src/planner.js).
- The current applicator validates preconditions, stages mutations, rejects
  non-ready plans, and returns in-memory lab journal/recovery evidence for old
  remote, fully updated remote, and blocked recovery cases. Evidence:
  [src/apply.js](../src/apply.js) and
  [docs/recovery/apply-journal.md](recovery/apply-journal.md).
- `scripts/playground/smoke-blueprints.sh` passed with three no-server
  WordPress Playground blueprints for remote base, local edited, and remote
  changed fixture states. Evidence:
  [docs/playground-topology.md](playground-topology.md).
- `npm run test:playground` passed. It mounts this repository into three
  Playground runtimes, exports real WordPress posts/options/files with
  [scripts/playground/export-site-snapshot.php](../scripts/playground/export-site-snapshot.php),
  and asserts the planner sees the expected row, file, and plugin-data
  conflicts plus local-only mutations and remote-only preservation.
- Protocol, executor, fast-path, objective-audit, and critic documents have
  landed from supervised lanes. Evidence: [docs/protocol.md](protocol.md),
  [docs/executor.md](executor.md), [docs/fast-paths.md](fast-paths.md),
  [audits/objective-audit.md](../audits/objective-audit.md), and
  [audits/critic.md](../audits/critic.md).
- The page at [progress.html](../progress.html) reports this as a safety model,
  not a production WordPress transport.

## 2026-05-24 - Lab Recovery Inspection Slice

- `npm run test:playground:recovery` passed as a standalone local-only
  Playground recovery harness against a server bound to `127.0.0.1`.
- The harness verifies the PHP protocol failpoint
  `REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
  fail-after-2 case, apply returns `LAB_INJECTED_APPLY_FAILURE` after two
  successful whole-resource mutations.
- The bounded option journal records planned recovery entries,
  `mutation-applied`, `apply-failed`, `recovery-required`, and current hashes
  without raw values. CLI inspect and REST `GET /recovery/inspect` classify the
  target as `blocked-recovery`, with `2 new` targets and `6 old` targets; retry
  refuses with `PRECONDITION_FAILED`.
- This is lab recovery inspection evidence only. It is not a durable production
  recovery journal, not a hard-kill or `fsync` path, and not auto-repair.
  Evidence: [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - File-Backed JSONL Recovery Journal Slice

- `npm run test:recovery:file-journal` passed as a JSON-model restart smoke for
  file-backed recovery journal evidence.
- `src/recovery-journal.js` writes append-only JSONL records with monotonic
  sequences and `fsync` evidence after each append; `src/recovery-inspect.js`
  performs restart-style inspection over the persisted journal plus the current
  JSON snapshot.
- The smoke verifies old-remote before mutation; fail-after-2
  `blocked-recovery` with `2 new`, `6 old`, and `0` unknown targets; retry
  refusal with `PRECONDITION_FAILED` and no remote change; completed replay
  applying `0` additional mutations; drift outside before/after hashes with
  `blockedUnknown > 0`; and journal files with no raw fixture fields/data.
- Caveats remain explicit: this is JSON-model lab evidence, not production
  WordPress recovery. It does not replace a production DB table journal or
  the local Playground process-kill smoke. Journal paths must be unique or
  reset intentionally because opening a plan recovery journal defaults to
  `truncate`, and raw-value prevention is forbidden-key/fixture-string based
  rather than a full allowlist schema. Evidence:
  [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - Playground Guarded Apply Target

- `npm run test:playground` passed as a two-leg Playground harness: first it
  exported real WordPress Playground snapshots and asserted conflict planning,
  then it created a separate ready plan with `remote=base`, applied it inside a
  fresh Playground source site, and verified WordPress-visible posts, options,
  and files after the apply.
- The apply leg reports `status: ready` and verifies the exact ready mutations,
  including shared and local-only upload files, plugin-owned options, edited
  shared/local-only posts, and the allowlisted forms fixture resources.
- This target remains lab-scoped. It does not claim production Reprint HTTP
  source mutation support; the real HTTP transport/source mutation endpoint is
  still a pending proof gate.

## 2026-05-24 - Playground Fixture Protocol Smoke

- `npm run test:playground` now includes
  `scripts/playground/push-protocol-smoke.mjs`, which mounts the lab-only
  `scripts/playground/push-remote-endpoint.php` and
  `scripts/playground/push-remote-lib.php` files into no-server Playground.
- The smoke proves dry-run is read-only by same-process WordPress before/after
  readback, applies a ready fixture plan with a supplied dry-run receipt,
  verifies eight fixture mutations and hashes, rejects missing receipts with
  `MISSING_DRY_RUN_RECEIPT`, rejects tampered receipts with
  `RECEIPT_MISMATCH`, rejects stale apply with `PRECONDITION_FAILED`, and
  preserves the drifted remote fixture.
- Conflict dry-run and apply both refuse with `PLAN_NOT_READY` and return audit
  evidence for row, file, and plugin-data conflict classes.
- Receipts are bound to the plan fingerprint/hash, mutation and precondition
  sets, ordered resource keys, and dry-run actual hashes. The PHP endpoint
  records bounded fixture-scoped lab journal/audit option events for dry-run,
  apply, stale, non-ready, missing-receipt, and mismatch outcomes. This remains
  fixture-scoped lab evidence, not durable production journaling. Production
  Reprint HTTP source mutation support remains pending.

## 2026-05-24 - Local-Only Playground REST Lab Slice

- `npm run test:playground:http-push` passed as a standalone harness that
  starts disposable WordPress Playground servers bound only to `127.0.0.1` and
  exercises real HTTP against a local lab REST namespace,
  `reprint-push-lab/v1`.
- The lab routes are `GET /snapshot`, `GET /journal`, `POST /dry-run`, and
  `POST /apply`. The script verifies namespace discovery, snapshot readback,
  journal readback, dry-run read-only behavior, missing receipt refusal with
  `428 MISSING_DRY_RUN_RECEIPT`, dry-run receipt creation, and successful apply
  of the eight expected fixture mutations.
- Negative HTTP-style cases are also covered: tampered receipts fail with
  `409 RECEIPT_MISMATCH`, stale remote state fails with
  `412 PRECONDITION_FAILED`, and conflict dry-run/apply fail with
  `409 PLAN_NOT_READY` while reporting row, file, and plugin-data conflict
  classes.
- This is still lab-only and fixture-scoped. The REST plugin is public only
  because it is mounted into local disposable Playground. It does not prove
  production auth, sessions, nonce checks, signed receipts, durable journals,
  crash recovery, or production source mutation. The script is intentionally
  outside `npm run test:playground` because it starts real servers and takes
  around two minutes.

## 2026-05-24 - Authenticated Local Playground Source Mutation Slice

- `npm run test:playground:authenticated-http-push` passed as a standalone
  local-only Playground REST harness for authenticated source-site mutation
  evidence under `/wp-json/reprint-push-lab/v1/authenticated/*`.
- The authenticated aliases use Basic-auth-shaped WordPress Application
  Password credentials for bootstrapped Playground users and require
  `manage_options`. Playground fallback caveat: core Application Password auth
  did not establish `/wp-json/wp/v2/users/me` in this local Playground run, so
  the lab route validates stored hashed app-password entries, sets the current
  WordPress user, and then runs the capability check.
- Preflight returns identity, capability, scope, session, expiry, and journal
  evidence. Authenticated dry-run is read-only by authenticated snapshot
  comparison and mints auth-bound receipts.
- Authenticated apply validates receipt scope, expiry, identity, session,
  route/request binding, and request body binding before DB idempotency claim
  and mutation; requires `X-Reprint-Push-Idempotency-Key`; applies over real
  local HTTP; and verifies the source changes through a fresh authenticated
  snapshot.
- Negative proof covers missing, bad, and malformed auth; insufficient
  capability; forged `reprint_push_lab_auth` query/body/header values;
  `AUTH_RECEIPT_MISMATCH` for tampered or wrong-identity receipts;
  `AUTH_RECEIPT_EXPIRED` for expired receipts; missing idempotency key; stale
  remote no-data-loss with no idempotency claim; and replay with zero fresh
  mutation work.
- Public legacy lab routes remain intentionally public for old smokes. This
  authenticated evidence applies only to `/authenticated/*` and remains
  authenticated local Playground source-site mutation evidence, not production
  Reprint auth.
- The same smoke now requires lab HMAC/signed requests for
  `/authenticated/preflight`, `/authenticated/dry-run`, and
  `/authenticated/apply`, with signature verification before JSON parsing,
  receipt validation, idempotency lookup/claim, journal writes, or mutation.
  `X-Auth-Content-Hash` is SHA-256 over raw request body bytes,
  `X-Auth-Signature` covers nonce/timestamp/content hash, and
  `X-Reprint-Push-Signature` binds method, actual path, canonical query,
  content hash, server-minted session, and idempotency key.
- Preflight mints short-lived lab push sessions; dry-run/apply require the
  session plus `X-Reprint-Push-Idempotency-Key`. Nonce replay rejects before
  idempotency replay, while replay with a fresh nonce/signature performs zero
  fresh mutation work.
- New negative signature proof covers unsigned, malformed, bad hash, body
  changed after signing, stale/future timestamp, wrong method/path/query, wrong
  session, idempotency mismatch, public-route signature attempts, and nonce
  replay. Positive proof covers signed preflight, dry-run, apply, and replay.
- Caveats remain explicit: this is lab HMAC evidence only. Public legacy lab
  routes remain public/mutable; HMAC applies only to `/authenticated/*`
  aliases. Responses expose stable hash evidence such as
  credential/signing-key hashes for lab proof, not a production response
  contract. No production TLS deployment, nonce/replay store cleanup,
  production session handling, real exporter credential binding, durable
  production audit records, or full production push exists yet.

## 2026-05-24 - DB Journal Idempotency Slice

- `npm run test:playground:db-journal-idempotency` passed as a standalone
  local-only Playground REST harness for DB-native apply journal and
  idempotency behavior.
- `POST /apply` now requires `X-Reprint-Push-Idempotency-Key`; missing keys
  return `400 MISSING_IDEMPOTENCY_KEY` before mutation.
- The table `wp_reprint_push_lab_push_journal` records DB-native events:
  `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`
  before each target write, per-mutation `mutation-applied` after observed hash
  calculation, `apply-committed`, `apply-replayed`, and conflict evidence.
  Compact mutation evidence stores hashes/metadata only: mutation
  order/id/resource key/type, before hash, planned after hash, observed hash,
  phase/status, and request/plan/receipt/idempotency hashes.
- Same key plus same body returns `BATCH_ALREADY_COMMITTED` with
  `idempotency.replayed: true`, performs no fresh mutation work, writes no
  extra per-mutation events, and leaves the snapshot unchanged. Same key plus a
  different body returns `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- The same harness now covers concurrent duplicate first applies. The unique
  `claim_key_hash` column opens exactly one `idempotency-opened` claim before
  mutation; concurrent same-key/same-body requests produce exactly one fresh
  mutation executor, and the duplicate returns safe in-progress/retry/replay
  behavior without mutation. Concurrent same-key/different-body requests reject
  the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- This DB journal is separate from the legacy `wp_options` lab journal read by
  `GET /journal`; the legacy `/journal` route still exists. Caveats remain:
  fixture-scoped local Playground evidence only, no production durability, and
  redaction checks are key-based plus fixture-value smoke checks rather than a
  full sanitizer for arbitrary future messages.

## 2026-05-24 - DB Journal Process-Kill Smoke

- `npm run test:playground:db-journal-process-kill` passed as a local-only
  Playground SQLite/host-mount process-kill smoke.
- The harness starts a localhost Playground server against a host-mounted
  WordPress directory, begins a DB-journaled REST apply, waits for
  `idempotency-opened` and `apply-started`, sends a real `SIGKILL` to the
  Playground server process group, and restarts against the same mount.
- After restart, DB opened/started rows and target data persist, the DB journal
  does not falsely report `apply-committed` or replay, live target hashes are
  explainable as old/new from DB planned evidence plus live hashes, recovery
  inspection returns non-mutating `RECOVERY_BLOCKED`, and retry over the same
  key is blocked without overwriting the partial state. This path no longer
  relies on the legacy option journal for recovery classification.
- Caveats remain: this is local Playground lab evidence, not production
  durability, storage `fsync`, rollback, exactly-once production writes,
  arbitrary plugin data safety, or full MySQL/InnoDB behavior.

## 2026-05-24 - DB Journal Missing-Commit Finalization Smoke

- `npm run test:playground:db-journal-missing-commit-finalization` passed as a
  local-only Playground smoke for DB-native missing-commit finalization.
- The smoke uses a deterministic lab hook to apply fixture target writes and DB
  mutation evidence while omitting the terminal `apply-committed` row. It then
  verifies every live target hash is already at the planned after hash.
- Before finalization, the same idempotency key with a different body still
  rejects with `409 IDEMPOTENCY_KEY_CONFLICT` and does not mutate or finalize.
- Replaying the same key/body returns `BATCH_RECOVERY_FINALIZED`, appends the
  missing commit row, reports `fully-updated-remote`, performs zero fresh
  mutation work, and does not add new mutation rows. A later replay returns
  `BATCH_ALREADY_COMMITTED`.
- Residual risks remain explicit: this is Playground/local DB lab evidence only
  and not proof of production durability, storage `fsync`, rollback,
  exactly-once production writes, arbitrary plugin data safety, or full
  MySQL/InnoDB behavior. Tests mostly count mutation evidence rows rather than
  deeply asserting every observed hash, and production auth, live source
  mutation, and full push remain pending.

## 2026-05-24 - DB Journal All-Old Stale-Claim Retry Smoke

- `npm run test:playground:db-journal-stale-claim-all-old` passed as a
  local-only Playground SQLite/host-mount lab smoke for deterministic all-old
  stale-claim safe retry.
- The first lab hook writes `idempotency-opened`, `apply-started`, and
  `stale-claim-abandoned`, then returns
  `LAB_SIMULATED_STALE_CLAIM_ALL_OLD` with no mutation rows, no terminal row,
  and no target mutation.
- Same idempotency key with a different body still returns
  `409 IDEMPOTENCY_KEY_CONFLICT` before retry work.
- Exact same key/body retry requires abandonment evidence tied to the started
  row being retried, validated started targets, zero mutation evidence, and all
  live target hashes at old values. It then appends the derived unique
  `stale-claim-retry-started`, performs exactly one fresh mutation set,
  commits, and later replays as `BATCH_ALREADY_COMMITTED`.
- The smoke also proves the derived retry-claim guard: when that retry claim
  already exists before retry `apply-started` or mutation, a later exact retry
  returns `IDEMPOTENCY_KEY_IN_PROGRESS` and does not mutate.
- The retry-start negative proves a retry `apply-started` without matching
  abandonment evidence blocks with `RECOVERY_BLOCKED` instead of reusing older
  abandonment evidence.
- Residual risks remain explicit: this is lab evidence only, not production
  DB durability, storage `fsync`, rollback, exactly-once production writes,
  MySQL/InnoDB behavior, cross-process/shared-DB lock proof, stale-claim
  leases/fencing/claim expiry, arbitrary production repair, or production retry
  policy.

## 2026-05-24 - Supervisor Feedback Loop And Concise Progress Page

- Added a dedicated `feedback-supervisor` lane and
  `scripts/supervision/start-feedback-session.sh` so a separate session can
  keep nudging the supervisor on what is going well, what is not, progress
  deltas, and the next proof gap.
- Added [supervisor feedback](supervisor-feedback.md) with a dated short status
  entry. The current nudge is to prioritize a production-shaped source-site
  mutation slice: authenticated dry-run, one guarded DB row, one guarded file,
  DB journal, replay, and conflict refusal.
- Updated [progress.html](../progress.html) to show a prominent visible
  "Last updated: May 24, 2026" marker and to move detailed proof text into
  linked Markdown docs. The page now has a short supervisor feedback panel and
  shorter lane summaries.
- This is a visibility/process improvement only. It does not change the core
  production proof status: production Reprint HTTP mutation, production auth,
  durable production journal, and arbitrary plugin data safety are still
  pending.

## 2026-05-24 - Plugin-Owned Forms Fixture Slice

- A verified fixture-scoped plugin-owned data slice now covers nested
  `reprint_push_forms_fixture` option data, fixture-marked parent posts with
  `_reprint_push_forms_schema` postmeta, exact
  `wp_reprint_push_forms_lab` custom-table rows through driver
  `fixture-forms-lab-table`, and detection-only
  `reprint-push-forms-fixture` plugin metadata.
- Snapshot/apply is intentionally allowlist-based. Safe apply covers only the
  allowlisted option, the allowlisted postmeta key when the parent post is
  fixture-marked, and the exact forms lab table driver with owner `forms`,
  positive `id:N`, explicit policy, unchanged active
  `reprint-push-forms-fixture` evidence, precondition hashes, exact PHP
  table/column/payload validation, delete blocked, idempotent replay with zero
  fresh mutation work, and redacted hash-only journal/recovery evidence. Plugin
  metadata is exported/detected but not applied.
- The planner requires an explicit row driver policy for plugin-owned rows.
  Unknown plugin-owned custom-table rows block as
  `unsupported-plugin-owned-resource`. Conflict evidence exposes hashes and
  resource evidence, not raw plugin values.
- The smokes verify eight exact ready mutations for the base apply path, one
  exact forms lab table mutation in `npm run test:playground:forms-lab-table`,
  and detection-only plugin metadata is not a ready mutation. Caveat: this is
  still not a claim about arbitrary production plugin semantics; real plugin
  activation, generic custom-table drivers, recovery, auth/session/nonce proof,
  and production source mutation remain pending.

## 2026-05-24 - Playground Fixture Plugin Install Atomicity Slice

- `npm run test:playground:plugin-atomic-install` is the standalone local-only
  Playground REST smoke for hard-coded fixture plugin install atomicity.
- Positive proof: the base/remote fixture lacks the atomic fixture plugins; the
  local fixture includes `reprint-push-atomic-dependency-fixture`,
  `reprint-push-atomic-dependent-fixture`, and
  `reprint_push_atomic_fixture_data` in the same atomic group. Apply activates
  both fixture plugins, writes only the exact fixture plugin file/resource
  allowlist plus allowlisted plugin-owned option data, and WordPress-visible
  readback verifies versions, activation state, plugin files, and option data.
  Replay with the same idempotency key/body returns
  `BATCH_ALREADY_COMMITTED`, performs zero fresh mutation work, and adds no
  fresh mutation events.
- Negative proof: missing dependency, dependency outside group, incompatible
  version, hash mismatch, activation requirement mismatch, remote dependency
  drift, stale precondition, stale live-remote dependency evidence, forged
  ready plans omitting dependency mutation/`atomicGroups`/dependency
  requirements, and row-only plugin-owned data bypass attempts all reject
  before mutation or preserve/classify safely. The row-only bypass is rejected
  as `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`.
- Executor-side validation now runs in JavaScript and PHP before mutation or
  preconditions where relevant. The lab keeps an exact fixture plugin file
  allowlist; arbitrary plugin files, direct `active_plugins` row mutation,
  custom tables outside the exact forms lab driver, and arbitrary plugin-owned
  data remain blocked.
- Failure injection remains classification evidence, not rollback. A
  before-commit failure preserves the old remote. During-publish and activation
  failures classify blocked recovery and prevent fresh retry mutation work.
- Caveat: this is hard-coded Playground fixture plugin install atomicity
  evidence only. It is not arbitrary production plugin installation/update,
  production activation support, production rollback, plugin semantic drivers,
  generic custom-table drivers, arbitrary plugin-owned data safety, or production
  durability/auth proof.

## 2026-05-24 - Lab JIT Pre-Write Drift Guard Slice

- `npm run test:playground:mid-apply-drift` passed as a standalone local-only
  Playground REST smoke for the just-in-time per-mutation pre-write check.
- The smoke drifts one target after dry-run and after initial apply validation,
  but after that mutation's `mutation-prepared` event and before its write.
  The PHP apply path re-hashes that mutation's own target immediately before
  `reprint_push_apply_resource()`, returns `412 PRECONDITION_FAILED`, preserves
  the drifted value, writes no `mutation-applied` event for the failed mutation,
  writes no later mutations, and writes no `apply-committed`.
- DB journal evidence is hash-only: `preWriteExpectedHash`,
  `preWriteActualHash`, `preconditionCheck`, mutation metadata, recovery counts,
  and redacted recovery targets. Same key/body replay after the rejected JIT
  failure returns the rejected result with `idempotency.replayed: true` and no
  fresh mutation work; same key/different body remains
  `409 IDEMPOTENCY_KEY_CONFLICT`; recovery inspect is non-mutating.
- `npm run test:playground:plugin-atomic-install` now also verifies the
  positive `same-apply-staged` plugin activation proof and negative staged
  shortcut cases. The inactive staged plugin hash is accepted only when the
  planned plugin value is activation-style (`active: true`), an earlier
  same-apply fixture plugin file mutation already applied, and the declared
  ready atomic group covers both mutations by `mutationIds` and `resources`.
  Forged mutation-local group ids without declared coverage and planned
  inactive plugin mutations reject before activation/commit.
- `npm run test:playground:db-journal-idempotency` passed after the smoke's
  different-body concurrency request was made deterministic by waiting for the
  winning idempotency claim before sending the conflicting request. `npm test`
  now passes with 64 Node test scenarios.
- Caveats remain explicit: this is lab-scoped JIT pre-write evidence, not
  storage-level compare-and-swap, locking, production DB durability, rollback,
  production Reprint push, generic plugin/custom-table safety, or arbitrary
  production plugin install/update/activation support.

## 2026-05-24 - Storage-Boundary Guarded DB Update Slice

- `npm run test:playground:storage-guarded-db-write` passed as a standalone
  local-only Playground/SQLite smoke for fixture-scoped update-only guarded DB
  row writes.
- The existing JIT pre-write resource hash still runs first. After it passes,
  supported update mutations use one guarded
  `$wpdb->query($wpdb->prepare(...))` SQL `UPDATE` with `WHERE` predicates over
  the expected storage representation observed after JIT.
- Positive coverage exists for existing fixture `wp_posts` rows, allowlisted
  `wp_options` rows, allowlisted single-row `wp_postmeta` rows, and exact
  positive-id `wp_reprint_push_forms_lab` fixture rows.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary, driver, logical table, physical table, operation,
  compared column names, expected resource hash, expected storage hash, rows
  affected, outcome, and SQL shape hash. It does not include raw SQL values,
  post content, option values, meta values, forms payloads, snapshots, or
  plugin payloads.
- Drift after JIT but before SQL fails closed with
  `PRECONDITION_FAILED`, including value drift for each supported table,
  marker-empty ownership drift for posts/postmeta parents, and absent/delete
  drift. The drifted target is preserved, the guarded write reports rows
  affected `0` and outcome `stale-at-write`, no `mutation-applied` is written
  for the failed target, no later mutations run, and no `apply-committed` is
  written.
- Same key/body replay after a storage-boundary rejection is non-mutating with
  no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`. Failure/recovery evidence keeps the JIT proof
  (`preWriteActualHash === expectedHash`) while using the fresh post-failure
  current hash for actual/observed/recovery state.
- Caveats remain explicit: this is local Playground/SQLite fixture evidence
  only. It is not production DB durability, production Reprint HTTP mutation,
  generic MySQL/InnoDB CAS proof, transactions, locking, rollback,
  inserts/deletes/files/plugin activation storage guarding, arbitrary
  plugin/custom-table semantic safety, or a production crash/fsync proof.

## 2026-05-24 - Storage-Boundary Guarded Fixture File Write Slice

- `npm run test:playground:storage-guarded-file-write` passed as a standalone
  local-only Playground smoke for fixture-scoped upload file update, create,
  and delete writes.
- The existing JIT pre-write resource hash still runs first. In the standalone
  smoke, fixture upload-file update/create mutations compare live file
  bytes/hash against the storage value observed after JIT, write planned
  content to a temp file in the same directory, and rename after the boundary
  comparison. Fixture upload-file deletes compare the same storage value before
  unlinking.
- Positive coverage exists for an existing fixture upload file update, a
  fixture upload file create, and a fixture upload file delete with
  `storageGuard` outcome `applied`. The code path also supports named fixture
  plugin file update paths, but this standalone smoke exercises upload-file
  update/create/delete only.
- Drift after JIT but before update, create, or delete fails closed with
  `PRECONDITION_FAILED`. The drifted file state is preserved, no
  `mutation-applied` is written for the failed file, no later mutations run,
  and no `apply-committed` is written.
- Same key/body replay after a storage-boundary file rejection is non-mutating
  with no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary `filesystem-compare-rename` for update/create or
  `filesystem-compare-unlink` for delete, driver, operation, logical fixture
  path, compared fields, expected resource/storage hashes, actual/planned
  storage hashes, physical path hash, and outcome. It does not expose raw file
  contents or absolute host paths.
- Caveats remain explicit: this is local Playground fixture evidence only. It
  is not production filesystem durability, storage `fsync`, a production
  filesystem CAS/lock, rollback, arbitrary file guarding, production Reprint
  HTTP mutation, generic WordPress filesystem safety proof, or a production
  crash proof.

## 2026-05-24 - Authenticated CLI Push Smoke

- `npm run test:playground:authenticated-cli-push` passed as a standalone
  local-only Playground smoke for the `reprint-push-lab push-authenticated`
  command.
- The command fetches a source snapshot over the authenticated lab REST route,
  builds the three-way push plan from `base` and `local` snapshot files, signs
  preflight/dry-run/apply requests, and applies with an idempotency key.
- Positive proof covers a non-mutating dry-run, then an apply of the eight
  current fixture mutations with DB journal `apply-committed` evidence and a
  final source snapshot matching the local fixture surface.
- Negative proof covers a changed source site: the CLI reports
  `PLAN_NOT_READY_LOCALLY` with conflict evidence and does not call dry-run or
  apply.
- Live-source drift proof covers the source changing after the CLI fetches its
  snapshot but before dry-run. A lab-only post-snapshot drift hook changes a
  fixture post title; the CLI-built plan is locally `ready`, authenticated
  dry-run returns `412 PRECONDITION_FAILED`, apply is not called, and the
  concurrent source change is preserved.
- The authenticated CLI client now retries transient socket failures only for
  unsigned read-only GET routes without side-effect lab query parameters and
  sends `Connection: close`; signed requests remain single-shot so nonce replay
  protections are not weakened.
- Caveat: this makes the lab source-site flow usable from the CLI, but it still
  targets the lab endpoint. It is not a production Reprint endpoint, production
  credential binding, or production durability proof.

## 2026-05-24 - Supervisor Feedback Refresh

- The feedback supervisor lane pushed
  `origin/lane/feedback-supervisor` with a refreshed dated status entry,
  concise blocked-by-evidence language, and audit links.
- The main progress page now folds that feedback into the CLI push update:
  reliable executor moved up in the lab, while production endpoint/auth/journal
  claims remain blocked.

## 2026-05-24 - Supervisor Evidence Checkpoint

- The current checkpoint found no newer merged executable evidence after the
  authenticated CLI push smoke and feedback refresh. The visible trend is
  therefore flat, not a readiness increase.
- [progress.html](../progress.html) keeps the current status to a concise
  one-screen summary with a visible May 24, 2026 update date and links to the
  detailed evidence instead of embedding long audit text.
- [supervisor feedback](supervisor-feedback.md) now names the next nudge per
  lane: production-shaped Reprint endpoint/auth/audit proof for reliable
  executor, WordPress graph identity for invariants, production crash-boundary
  durability for recovery, real plugin validator coverage for plugin data,
  executable chunking benchmarks for fast paths, and live-integration re-audit
  for audit lanes.
- Production readiness is unchanged. The repository still lacks a production
  Reprint source-site mutation endpoint, production credential binding,
  nonce/session cleanup proof, durable production audit/recovery records,
  production filesystem/DB durability proof, and arbitrary plugin data safety.

## 2026-05-24 - Status By Area

| Area | Progress | What changed | Next proof |
| --- | ---: | --- | --- |
| Merge invariants | 42% | Planner/apply tests, Playground snapshots, fixture plugin/data checks, unsafe topology mutation suppression, stale owner-plugin context blocking, JIT drift refusal, and storage-boundary DB/file guards are passing. | Production resource identity, semantic preservation, and storage-level guards over real WordPress data. |
| Recovery boundaries | 27% | DB journal idempotency, process-kill, missing-commit finalization, all-old stale-claim retry, durable old-remote retry evidence, durable replay envelopes, journal-write failure recovery artifacts, and stale-at-write refusal are lab/model-proved. | Production DB journal durability, `fsync`/locking/leases/fencing, and crash-boundary behavior. |
| Reliable executor and protocol | 40% | Lab preflight, dry-run receipts, signed auth routes, idempotency, replay, conflict refusal, hash-only guard evidence, authenticated CLI push, post-snapshot drift refusal, production transport binding docs, production-shaped route smoke, packaged-plugin route activation, and signed session/nonce cleanup evidence exist. | Production auth/TLS/session/nonce lifecycle, real exporter credentials, durable audit records, leases/fencing, and arbitrary plugin drivers. |
| Fast path and chunking | 17% | Performance model now records safe fast-path proof obligations for each speedup area, plus staged chunks, group finalization, idempotency, missing receipts, pressure budgets, and rejected unsafe shortcuts. | Transfer benchmarks, streaming/chunking implementation, and large-site runtime evidence. |
| Independent evidence and critique | 30% | Objective audit, critic production gate, source notes, and supervisor feedback were refreshed against the production-shaped/package evidence. | External review against live integration behavior. |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress push executor: still pending. A real source site must be
  mutated through the intended production-shaped Reprint protocol and verified
  after apply, with persisted executor state and no lab-only route assumptions.
- Production recovery journal: still pending. Lab JSONL/DB journals prove
  useful slices, but not production DB durability, `fsync`, locks, leases,
  rollback, or exactly-once writes.
- Docker/full Playground integration: still pending. No-server and localhost
  Playground fixtures prove useful WordPress-facing behavior, but Docker is
  unavailable in this sandbox and the full integration path is not production
  proof.
- Plugin drivers: still pending. Current safety is limited to allowlisted
  fixture data, one forms custom-table driver, detection-only plugin metadata,
  and hard-coded fixture plugin install atomicity; arbitrary plugin-owned
  options, postmeta, custom tables, activation hooks, and rollback are not
  solved.

</details>
