# Queue / Integration Critique 33 - 2026-05-28

Role: independent critic for queue/integration roster 33.

## Findings

### High - RPP-0340 landed during the audit, making pre-landing queue claims stale

Sessions: `rpp-28`, `rpp-35`, `rpp-36`

Evidence:

- The audit started from lane `9aa0441ad`, checklist lint `125 checked / 875
  open`, release `NO-GO`, while `rpp-28` had active branch
  `session/rpp-28-rpp-0340-integration-20260528`.
- A pre-commit refresh found `origin/lane/evidence-integration-20260527` had
  advanced by two commits to `5fcd3008e`: `165031908` (`test: prove importer
  exporter identity map`) and `5fcd3008e` (`docs: refresh progress for
  rpp-0340`).
- Post-landing checklist lint reports `126 checked / 874 open`, `ok: true`,
  `risky: 0`, `errors: 0`.
- The `rpp-28` pane confirms RPP-0340 was pushed to the lane and then reassigned
  to `RPP-0064`.

Correction: treat all pre-RPP-0340 queue rankings as stale. New integration
work must start from `5fcd3008e`, not `9aa0441ad`, and progress/count reports
must use `126/874` while preserving release `NO-GO`.

### High - RPP-0064 was assigned as clean but merge-tree conflicts on the current lane

Sessions: `rpp-28`, `rpp-25`, `rpp-35`

Evidence:

- The current integrator prompt says `rpp-28` is assigned
  `RPP-0064 packaged fallback rejection` from
  `origin/session/rpp-25-rpp-0064-packaged-fallback-rejection` at `68eabb1f0`.
- Fresh merge-tree against current lane `5fcd3008e` reports:
  `RPP-0064|conflict|68eabb1f0|docs/evidence/ao-release-gates.md,test/release-gate-packaged-fallback-regression.test.js`.
- Conflict details include `Auto-merging docs/evidence/ao-release-gates.md` and
  `CONFLICT (content): Merge conflict in docs/evidence/ao-release-gates.md`.
- `RPP-0065` also conflicts in the same file:
  `docs/evidence/ao-release-gates.md`.

Correction: stop treating `RPP-0064` as clean unless the integrator has a newer
restacked ref. Rebase/cherry-pick the single test commit onto `5fcd3008e`, keep
the current lane version of `docs/evidence/ao-release-gates.md`, and reapply
only the small RPP-0064 evidence row/section. If it still conflicts, switch to
a clean fallback such as `RPP-0237` or `RPP-0457`.

### High - RPP-0343 now conflicts with lane truth after RPP-0340

Sessions: `rpp-30`, `rpp-35`

Evidence:

- Before RPP-0340 landed, `RPP-0343` was clean against `9aa0441ad` but already
  conflicted when merge-probed on top of the RPP-0340 integration branch.
- After the lane advanced to `5fcd3008e`, fresh merge-tree reports:
  `RPP-0343|conflict|3f08af387|docs/evidence/ao-graph-identity.md,docs/generated-push-harness.md,scripts/harness/generated-push-cases.js,test/generated-push-harness.test.js`.
- Conflict details include `Auto-merging docs/evidence/ao-graph-identity.md`
  and `CONFLICT (content): Merge conflict in docs/evidence/ao-graph-identity.md`.

Correction: do not queue `RPP-0343` until it is restacked onto `5fcd3008e` and
the graph identity evidence doc is merged deliberately.

### Medium - branch-local developer work must not be counted

Sessions: `rpp-24`, `rpp-25`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`,
`rpp-34`

Evidence:

- `rpp-24` has moved to `RPP-0148` on a branch behind the new lane by two commits
  with dirty generated-harness edits in `scripts/harness/generated-push-cases.js`
  and `test/generated-push-harness.test.js`.
- `rpp-25/RPP-0066` has a committed branch head `2abf6ba04` (`test: add auth
  readback drift regression`) but it is not integrated into lane truth.
- `rpp-29/RPP-0238` is behind by two commits with dirty edits in
  `test/generated-push-harness.test.js` and `test/push-planner.test.js`.
- `rpp-30/RPP-0344` is behind by two commits with dirty generated/graph edits in
  `scripts/harness/generated-push-cases.js`,
  `scripts/playground/local-production-complex-site-proof.js`, and
  `test/generated-push-harness.test.js`.
- `rpp-32/RPP-0460` is one commit ahead at `17855ea33`, but still branch-local.
- `rpp-33/RPP-0149` is behind by two commits with dirty generated-harness docs
  and tests.
- `rpp-34` has moved on to `RPP-0462` at lane head; the requested `RPP-0461`
  exists as a pushed clean candidate but is no longer the visible active pane.

Correction: count only integrated lane evidence. Current lane truth is
`5fcd3008e`, `126/874`, `NO-GO`; active branch-local work is evidence in
progress, not checklist movement.

### Medium - local/generated evidence still does not move final release

Sessions: `rpp-28`, active developers

Evidence:

- `node scripts/release/check-release-gates.mjs --now 2026-05-28T00:00:00.000Z`
  exits nonzero on the current lane.
- The release-gate output reports `releaseStatus: "NO-GO"`,
  `primaryFailureCode: "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"`,
  `mutationAttempted: false`, and release movement `gates: "3/20"`,
  `finalGates: "3/20"`.

Correction: keep RPP-0340 and related graph/plugin/generated proofs labeled as
local or generated support evidence. They do not prove the production-owned
source boundary required for release movement.

### Medium - dashboard health is degraded during the cycle

Session: `rpp-ao-web`

Evidence:

- A dashboard HEAD request first failed with `curl: (56) Recv failure:
  Connection reset by peer`.
- The retry failed with `curl: (7) Failed to connect to 127.0.0.1 port 8080`.
- The `rpp-ao-web` pane tail shows Next.js restarted earlier and then exited
  with `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation
  failed - JavaScript heap out of memory`.

Correction: restart or repair the dashboard before using it as liveness proof.
Queue/integration truth should come from git/tmux/check scripts until 8080 is
healthy again.

### Low - redaction sentinels are local test fixtures

Sessions: `rpp-28`, `rpp-33`

Evidence:

- RPP-0340 introduces `importerExporterPrivateTokens` and asserts evidence JSON
  does not include those tokens.
- RPP-0146 dirty work includes serialized option `private_token` fixtures and
  an assertion that emitted evidence omits `private-serialized-`.

Correction: keep these as local redaction regression sentinels only. They are
not production credential evidence and should not be described as such.

## Current clean queue after RPP-0340

- Clean against `5fcd3008e`: `RPP-0236`, `RPP-0237`, `RPP-0457`, `RPP-0458`,
  `RPP-0461`, `RPP-0145`, `RPP-0147`, and `RPP-0459`.
- Conflicting against `5fcd3008e`: `RPP-0064` and `RPP-0065` in
  `docs/evidence/ao-release-gates.md`; `RPP-0343` in
  `docs/evidence/ao-graph-identity.md`.
- Previously rejected: `RPP-0063` failed dry-run apply to
  `docs/evidence/ao-release-gates.md` before the RPP-0340 fallback landed.

## Checks run

- `git fetch origin lane/evidence-integration-20260527
  +refs/heads/session/rpp-*:refs/remotes/origin/session/rpp-* --prune`
- `node scripts/release/checklist-completion-lint.mjs`
- `node scripts/release/check-release-gates.mjs --now 2026-05-28T00:00:00.000Z`
- worktree `git status`, `rev-list`, and `log` for `rpp-24`, `rpp-25`,
  `rpp-28`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`, `rpp-35`,
  `rpp-36`, and `rpp-37`
- tmux pane tails for queue and integration sessions
- `git merge-tree --write-tree` for post-RPP-0340 queue candidates
- redaction keyword probes over targeted branch diffs
- dashboard `curl -fsSI` health checks and `rpp-ao-web` tail
