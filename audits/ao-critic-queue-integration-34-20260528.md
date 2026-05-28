# Queue / Integration Critique 34 - 2026-05-28

Role: independent critic for queue/integration roster 34.

## Findings

### High - RPP-0238 is assigned next, but the current candidate conflicts after RPP-0237

Sessions: `rpp-28`, `rpp-29`, `rpp-35`

Evidence:

- Current lane truth after the supervisor lane move is
  `origin/lane/evidence-integration-20260527` at `a180f44e9`, checklist lint
  `127 checked / 873 open`, release `NO-GO`.
- `rpp-28` has switched to `session/rpp-28-rpp-0238-integration-20260528` from
  `a180f44e9`.
- The assigned candidate remains
  `origin/session/rpp-29-rpp-0238-forged-ready-plan-defense-v2` at
  `26824faea`.
- Fresh merge-tree against `a180f44e9` reports:
  `RPP-0238|conflict|26824faea|files=test/generated-push-harness.test.js,test/push-planner.test.js`.
- Conflict details include `Auto-merging test/generated-push-harness.test.js`
  and `CONFLICT (content): Merge conflict in test/generated-push-harness.test.js`.

Correction: do not treat the current RPP-0238 ref as a clean next integration.
Restack it on `a180f44e9` or switch to a clean fallback such as `RPP-0067`,
`RPP-0462`, `RPP-0463`, `RPP-0464`, or `RPP-0459`.

### High - generated-harness branches are clean individually only in some cases

Sessions: `rpp-24`, `rpp-29`, `rpp-30`, `rpp-33`, `rpp-35`

Evidence:

- `RPP-0148` conflicts against current lane in
  `test/generated-push-harness.test.js`.
- `RPP-0238` conflicts against current lane in
  `test/generated-push-harness.test.js`.
- Older clean-looking generated branches `RPP-0147`, `RPP-0145`, and `RPP-0458`
  also conflict after RPP-0237 in `test/generated-push-harness.test.js`.
- `RPP-0149` is clean against current lane, but pairwise merge probes show it
  conflicts with local `RPP-0150` and `RPP-0344` in
  `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`,
  and `test/generated-push-harness.test.js`.

Correction: integrate only one generated-harness branch at a time, then restack
the rest. Do not rank `RPP-0149`, `RPP-0150`, and `RPP-0344` together as
independent clean work.

### High - release-gate branches are a hot doc cluster despite individual clean probes

Sessions: `rpp-25`, `rpp-28`, `rpp-35`

Evidence:

- `RPP-0064` and `RPP-0065` still conflict in
  `docs/evidence/ao-release-gates.md`.
- `RPP-0067` is clean individually against `a180f44e9`, changing
  `docs/evidence/ao-release-gates.md` and
  `test/release-gate-missing-production-secret-regression.test.js`.
- `RPP-0068` is also clean individually, changing
  `docs/evidence/ao-release-gates.md` and
  `test/release-gate-application-password-binding-regression.test.js`.
- Pairwise probes show `RPP-0067` and `RPP-0068` conflict with each other in
  `docs/evidence/ao-release-gates.md`.
- `RPP-0068` has two commits after the lane:
  `f0e4a77b9` (`test: add application password binding regression`) and
  `f174b485f` (`chore: merge latest evidence lane`).

Correction: integrate release-gate candidates one at a time and isolate the
candidate-local test/doc delta. Avoid pulling unrelated branch-history commits
from `RPP-0068`.

### Medium - plugin-driver candidates are clean individually but conflict in sequence

Sessions: `rpp-32`, `rpp-34`, `rpp-35`

Evidence:

- `RPP-0462`, `RPP-0463`, `RPP-0464`, `RPP-0459`, and `RPP-0461` are clean
  individually against current lane.
- Pairwise probes show `RPP-0462` with `RPP-0463`, `RPP-0463` with `RPP-0464`,
  and `RPP-0462` with `RPP-0464` all conflict in
  `docs/evidence/ao-plugin-driver.md`; the `RPP-0462`/`RPP-0464` sequence also
  conflicts in `test/push-planner.test.js`.

Correction: pick one plugin-driver candidate, land it, then restack the next.
Treat the plugin-driver evidence doc as a serialized integration surface.

### Medium - active/refilled panes contain branch-local or no-delta work

Sessions: `rpp-24`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`, `rpp-37`

Evidence:

- `rpp-24/RPP-0151` is behind current lane by two commits and has dirty
  `scripts/harness/generated-push-cases.js`; it has no committed candidate delta
  yet in this worktree snapshot.
- `rpp-29/RPP-0239` is at lane head with local modifications in
  `test/generated-push-harness.test.js` and `test/push-planner.test.js`.
- `rpp-33/RPP-0150` has local commit `9e776dfbd`, but no `origin/session`
  counterpart was present in the fetched refs; it must not be counted as a
  pushed clean candidate.
- `rpp-30/RPP-0345` and `rpp-32/RPP-0465` are at lane head with no committed
  delta at the snapshot.
- `rpp-34/RPP-0464` is one commit ahead at `9558836e6` and pushed to
  `origin/session/rpp-34-rpp-0464-wp-options-driver-semantics`.
- `rpp-37` has untracked roster-35 audit files; those are outside this critic
  branch and should not be mixed into queue 34 output.

Correction: count only lane-integrated evidence. Branch-local and dirty work is
not checklist movement and should stay out of progress totals.

### Medium - release remains NO-GO; local/generated proofs are not production proof

Sessions: all active developers

Evidence:

- `check-release-gates` on `a180f44e9` reports `releaseStatus: "NO-GO"`,
  `primaryFailureCode: "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"`,
  `mutationAttempted: false`, `gates: "3/20"`, and `finalGates: "3/20"`.
- `RPP-0067` and `RPP-0068` are release-gate regression candidates using
  generated fixtures and redacted credential-shaped output; they do not supply
  final production source evidence.

Correction: keep release wording at `NO-GO` until live source, credential,
route, recovery, and operator-proof evidence satisfy final release gates.

### Low - redaction sentinels are fixture strings that still need integration checks

Sessions: `rpp-25`, `rpp-29`, `rpp-30`, `rpp-32`, `rpp-33`, `rpp-34`

Evidence:

- Candidate diffs include intentional redaction probes: `RPP-0067` credential
  wording, `RPP-0238` private file/row/option values, `RPP-0344` private postmeta
  payload strings, `RPP-0149` private usermeta markers, and `RPP-0462`/`RPP-0463`
  private plugin-driver values.
- These are local fixture sentinels, not production secrets.

Correction: every integration of these branches must rerun the artifact
redaction scan and focused tests that assert raw fixture values are absent from
serialized evidence.

## Queue State

- Current lane: `a180f44e9`; checklist lint: `127 checked / 873 open`; release:
  `NO-GO`.
- Clean individually against current lane: `RPP-0067`, `RPP-0068`, `RPP-0149`,
  `RPP-0344`, `RPP-0457`, `RPP-0459`, `RPP-0461`, `RPP-0462`, `RPP-0463`,
  `RPP-0464`, and local-only `RPP-0150`.
- Conflicting against current lane: `RPP-0064`, `RPP-0065`, `RPP-0148`,
  `RPP-0238`, `RPP-0145`, `RPP-0147`, and `RPP-0458`.
- No committed candidate delta at snapshot: `RPP-0151`, `RPP-0239`, `RPP-0345`,
  and `RPP-0465`.

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
