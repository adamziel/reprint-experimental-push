# Queue / Integration Critique 31 - 2026-05-28

Role: independent critic for queue/integration roster 31.

## Current lane truth

- Audit started from `origin/lane/evidence-integration-20260527` at
  `7282d12e3` with checklist lint `124/876` and release `NO-GO`.
- During the audit, `rpp-28` fast-forwarded the lane with `RPP-0062`.
  Current lane is `9aa0441ad` (`docs: refresh progress for rpp-0062`).
- Fresh checklist lint on `9aa0441ad` is `125 checked / 875 open`, no risky
  claims, and `RPP-0062` is now the only new integrated checklist movement.
- Release remains `NO-GO`; `check-release-gates` still fails closed with
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` and no mutation attempt.

## Findings

### High - queue top five is stale after RPP-0062

Session: `rpp-35`

Evidence: `rpp-35` first printed a raw top queue of `RPP-0062`, `RPP-0063`,
`RPP-0340`, `RPP-0452`, and `RPP-0454`, then later printed a post-RPP-0062
top five of `RPP-0064`, `RPP-0236`, `RPP-0457`, `RPP-0458`, and `RPP-0144`.
Independent merge probes show `RPP-0064` conflicts when applied on top of the
actual `RPP-0062` integration branch:

- `origin/session/rpp-25-rpp-0064-packaged-fallback-rejection` onto
  `session/rpp-28-rpp-0062-integration-20260528` conflicts in
  `docs/evidence/ao-release-gates.md`.
- `origin/session/rpp-25-rpp-0063-missing-remote-changed-url-gate` also
  conflicts in `docs/evidence/ao-release-gates.md` after `RPP-0062`.

Correction: remove `RPP-0064` and `RPP-0063` from the immediate post-RPP-0062
top slot until their release-gate evidence docs are restacked. Safer next
queue entries from the same probe were `RPP-0236`, `RPP-0457`, `RPP-0458`, and
`RPP-0144`.

### High - branch-local work must not be counted

Sessions: `rpp-24`, `rpp-25`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`,
`rpp-36`, `rpp-37`

Evidence:

- `rpp-24/RPP-0145` is one commit ahead with generated harness edits only.
- `rpp-25/RPP-0065` had an untracked
  `test/release-gate-wrong-remote-alias-regression.test.js` during inspection.
- `rpp-29/RPP-0236` is one pushed branch commit ahead of lane.
- `rpp-32/RPP-0458` is one pushed branch commit ahead of lane.
- `rpp-30/RPP-0343`, `rpp-33/RPP-0146`, and `rpp-34/RPP-0459` were still at
  lane head with no committed delta at the status snapshot.
- `rpp-36` and `rpp-37` have branch-local progress/critic outputs only.

Correction: count only lane `9aa0441ad` and checklist lint `125/875`. Do not
count `RPP-0065`, `RPP-0145`, `RPP-0146`, `RPP-0236`, `RPP-0343`, `RPP-0458`,
or `RPP-0459` until an integrator moves them onto the lane and lint confirms.

### Medium - generated-harness ordering still needs explicit merge probes

Sessions: `rpp-24`, `rpp-29`, `rpp-32`, `rpp-33`

Evidence: current-lane merge probes were clean for `RPP-0145`, `RPP-0236`, and
`RPP-0458`, and pairwise probes for `RPP-0145` with `RPP-0236` and `RPP-0458`
were also clean. That is useful, but the generated harness is a high-churn
surface and prior rosters already saw stale generated-harness conflicts.

Correction: before each generated-harness integration, run pairwise
`merge-tree` against the most recently integrated generated-harness branch and
rerun full generated harness tests. Do not rely on single-branch current-lane
cleanliness.

### Medium - redaction evidence is synthetic and branch-local

Sessions: `rpp-25`, `rpp-28`, `rpp-32`

Evidence:

- `RPP-0062` and `RPP-0063` diffs contain synthetic sentinel values such as
  `RPP_0062_SHOULD_NOT_LEAK` / `RPP_0063_SHOULD_NOT_LEAK` and assertions that
  stdout, stderr, and serialized reports omit them.
- `RPP-0458` contains synthetic plugin payload tokens and asserts they are not
  emitted in JSON evidence.

Correction: keep these as local redaction regression sentinels only. They are
not production credential proof. Continue running the artifact redaction scan
over `docs/evidence audits progress.html` and any branch-local docs before
integration.

### Medium - local and generated proofs do not move release readiness

Sessions: all active/refilled developers and `rpp-28`

Evidence: `check-release-gates` on the current lane reports `NO-GO` with
`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; source/local/remote-changed production
URLs and production credential binding are still missing. `RPP-0062` raises
the checklist count but preserves final-release hold.

Correction: progress and queue reports should keep the release wording at
`NO-GO` and label generated/local proofs as support evidence only.

## Roster status observed

- Integrator: `rpp-28/RPP-0062` landed during audit and moved lane to
  `9aa0441ad`.
- Queue: `rpp-35` active but printed conflicting queue views; post-RPP-0062
  ranking needs correction.
- Progress: `rpp-36` branch-local progress heartbeat only.
- Critic: `rpp-37` live roster 30 branch-local audit only.
- Developers: seven developer sessions were active/refilled, but most work was
  branch-local or still uncommitted at inspection time.

## Checks run

- `git fetch origin lane/evidence-integration-20260527 +refs/heads/session/rpp-*:refs/remotes/origin/session/rpp-* --prune`
- `node scripts/release/checklist-completion-lint.mjs`
- `node scripts/release/check-release-gates.mjs` (expected `NO-GO` nonzero)
- `git status --short --branch` across target worktrees
- `git merge-tree --write-tree` for `RPP-0062`, queue top entries, and selected
  generated-harness/plugin-driver candidates
- redaction keyword probe over target branch diffs
- dashboard `curl -fsSI http://127.0.0.1:8080/`
