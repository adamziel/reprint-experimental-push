# Queue / Integration Critique 36 - 2026-05-28

Role: independent critic for queue/integration roster 36.

## Findings

### High - lane moved during the audit; RPP-0461 is lane truth now

Sessions: `rpp-28`, `rpp-31`, `rpp-36`

Evidence:

- The audit started from `origin/lane/evidence-integration-20260527` at
  `9140a7645`, checklist lint `128 checked / 872 open`, release `NO-GO`.
- During the audit, `origin/lane/evidence-integration-20260527` advanced to
  `460df8894` with `955ea001b` (`test: prove driver registration regression`)
  and `460df8894` (`docs: refresh progress for rpp-0461`).
- After resetting the critic branch to the new lane, checklist lint reports
  `129 checked / 871 open`, `ok: true`, `risky: 0`, `errors: 0`.
- Release remains `NO-GO` with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `3/20`
  final gates, and `mutationAttempted: false`.

Correction: treat queue output that still says `RPP-0461` is active or that
reports `9140a7645` / `128/872` as stale. Current critic truth is `460df8894`,
`129/871`, `NO-GO`.

### High - RPP-0462 is now assigned but conflicts immediately after RPP-0461

Sessions: `rpp-28`, `rpp-34`, `rpp-35`

Evidence:

- `rpp-28` has moved to `session/rpp-28-rpp-0462-integration-20260528`, which
  is still at lane head `460df8894` with no candidate delta.
- Candidate `origin/session/rpp-34-rpp-0462-driver-owner-identity-binding` is
  `7c7b84fc8`.
- Fresh merge-tree against current lane reports a conflict in
  `docs/evidence/ao-plugin-driver.md` and auto-merges
  `test/push-planner.test.js`.

Correction: do not integrate `RPP-0462` from the stale candidate ref. Restack it
on `460df8894`, reconcile the plugin-driver evidence doc, then rerun focused
plugin-driver tests and redaction checks.

### High - plugin-driver candidates must be serialized and restacked

Sessions: `rpp-32`, `rpp-34`, `rpp-35`

Evidence:

- `RPP-0466` conflicts against current lane in
  `docs/evidence/ao-plugin-driver.md`.
- `RPP-0467` conflicts against current lane in
  `docs/evidence/ao-plugin-driver.md`.
- Active `RPP-0468` has an unresolved worktree conflict:
  `UU docs/evidence/ao-plugin-driver.md`, plus staged/modified
  `src/apply.js`, `src/planner.js`, `test/push-planner.test.js`, and untracked
  `src/serialized-option-validator.js`.
- Active `RPP-0469` is at lane head with no committed delta at the snapshot.

Correction: land only one plugin-driver branch at a time and require every
other plugin-driver worker to restack after the new lane. The evidence doc is a
single serialized surface, not parallel-safe.

### High - release-gate branch conflict remains after RPP-0067

Sessions: `rpp-25`, `rpp-35`

Evidence:

- `RPP-0069` conflicts against current lane in
  `docs/evidence/ao-release-gates.md`.
- `RPP-0070` is clean individually against current lane, changing
  `docs/evidence/ao-release-gates.md` and
  `test/release-gate-same-source-identity-regression.test.js`.
- Active `RPP-0071` has no committed delta and only an untracked
  `test/release-gate-preflight-route-identity-regression.test.js` in the
  `rpp-25` worktree.
- Pairwise probes show `RPP-0070` and `RPP-0069` conflict in
  `docs/evidence/ao-release-gates.md`.

Correction: keep release-gate candidates out of the clean queue unless the
candidate has been restacked on `460df8894`. Do not count `RPP-0071` until it
has a committed, pushed candidate branch.

### Medium - generated-harness and graph branches are individually clean but collide in sequence

Sessions: `rpp-24`, `rpp-29`, `rpp-30`, `rpp-33`

Evidence:

- `RPP-0152`, `RPP-0153`, `RPP-0240`, `RPP-0241`, `RPP-0345`, and `RPP-0346`
  are clean individually against current lane.
- Pairwise probes show `RPP-0152` with `RPP-0153` conflicts in
  `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`,
  and `test/generated-push-harness.test.js`.
- `RPP-0152` with `RPP-0345` conflicts in `docs/generated-push-harness.md`.
- `RPP-0153` with `RPP-0345` conflicts in `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`.
- `RPP-0240` with active `RPP-0241` conflicts in
  `test/generated-push-harness.test.js`.
- `RPP-0345` with active `RPP-0346` conflicts in
  `docs/evidence/ao-graph-identity.md`, `docs/generated-push-harness.md`,
  `scripts/harness/generated-push-cases.js`, and
  `test/generated-push-harness.test.js`.

Correction: integrate generated/graph work one branch at a time and restack the
rest after each landing. Do not rank these branches as independent just because
they are clean alone.

### Medium - active/no-delta branches must not be counted

Sessions: `rpp-25`, `rpp-32`, `rpp-34`

Evidence:

- `RPP-0071`, `RPP-0468`, and `RPP-0469` have no committed candidate delta at
  the branch refs used for queue ranking.
- `RPP-0468` also has unresolved local conflicts, so it is not integration-ready.

Correction: count only lane-integrated evidence. Active or conflicted worktree
state is not checklist movement.

### Medium - release remains NO-GO; candidate proofs are local/generated

Sessions: all active developers

Evidence:

- `node scripts/release/check-release-gates.mjs --now 2026-05-28T00:00:00.000Z`
  reports `releaseStatus: "NO-GO"`,
  `primaryFailureCode: "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"`,
  `mutationAttempted: false`, `gates: "3/20"`, and `finalGates: "3/20"`.
- Candidate branches here are regression, generated-harness, graph, or
  plugin-driver proofs. They do not supply live production source evidence.

Correction: preserve `NO-GO` wording and local/generated caveats in queue,
critic, and progress surfaces.

### Low - redaction-sensitive fixtures require focused verification on integration

Sessions: `rpp-25`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`

Evidence:

- Candidate diffs contain sentinel strings such as `RPP_0070_SHOULD_NOT_LEAK`,
  `RPP_0069_SHOULD_NOT_LEAK`, private term taxonomy fields, private plugin
  dependency metadata, private comment-post/comment-parent payloads, and
  `rpp0466`/`rpp0467` private plugin-driver values.
- The audit redaction scan over `docs/evidence audits progress.html` passes,
  but branch integration still needs focused redaction assertions for each
  candidate.

Correction: require focused tests plus artifact redaction scan for every branch
that introduces these sentinel fixtures.

## Queue State

- Current lane: `460df8894`; checklist lint: `129 checked / 871 open`; release:
  `NO-GO`.
- Clean individually against current lane: `RPP-0152`, `RPP-0070`, `RPP-0240`,
  `RPP-0345`, `RPP-0153`, `RPP-0241`, and `RPP-0346`.
- Conflicting against current lane: `RPP-0462`, `RPP-0466`, `RPP-0467`, and
  `RPP-0069`.
- Active/no-delta or conflicted: `RPP-0071`, `RPP-0468`, and `RPP-0469`.

## Checks Run

- `git fetch origin lane/evidence-integration-20260527
  +refs/heads/session/rpp-*:refs/remotes/origin/session/rpp-* --prune`
- `node scripts/release/checklist-completion-lint.mjs`
- `node scripts/release/check-release-gates.mjs --now 2026-05-28T00:00:00.000Z`
- worktree status and tmux pane tails for `rpp-24`, `rpp-25`, `rpp-28`,
  `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`, `rpp-35`, `rpp-36`, and
  `rpp-37`
- `git merge-tree --write-tree` against current lane and pairwise hot-file
  candidate combinations
- targeted diff keyword scans for redaction-sensitive fixture strings
