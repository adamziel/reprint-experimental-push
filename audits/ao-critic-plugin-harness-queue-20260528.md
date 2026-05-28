# AO critic plugin-driver/generated-harness queue audit — 2026-05-28

Snapshot time: 2026-05-28 06:12 CEST
Critic branch: `session/rpp-37`
Audited integration lane: `origin/lane/evidence-integration-20260527` at `67d50f384` (`docs: refresh progress for driver registration proof`)
Initial requested baseline: `3bd9dc676`; the lane advanced through `RPP-0421` during this refill.
Observed checklist state: 110 checked / 890 open
Release posture: **NO-GO**

## Scope

This pass reviewed the plugin-driver and generated-harness queue after the lane
moved from `3bd9dc676` to `67d50f384`. It focused on the integrated
`RPP-0421` lane movement, queued/plugin-driver candidates for `RPP-0415`,
`RPP-0425`, `RPP-0426`, `RPP-0427`, and `RPP-0431`, plus generated-harness
candidates for `RPP-0115`, `RPP-0117`, `RPP-0118`, and adjacent queued
`RPP-0116` overlap. The critic lens was stale baselines, branch-local evidence
being counted as integrated, test-only evidence being described too strongly,
redaction exposure, and release wording that weakens the current **NO-GO**
posture.

## Command evidence

| Check | Result |
| --- | --- |
| `git status --short --branch`, `git rev-parse --short HEAD`, `git rev-parse --short origin/lane/evidence-integration-20260527` | Critic branch is `session/rpp-37`; lane is `67d50f384`; branch is ahead of `origin/session/rpp-37` only because it merged latest lane before this audit. |
| `node scripts/release/checklist-completion-lint.mjs --root .` | Pre-write lint reported `ok: true`, 110 checked / 890 open, 0 risky claims. |
| `git for-each-ref` filtered for relevant session refs | Remote refs exist for raw `RPP-0421`, both `RPP-0415` variants, `RPP-0425`, `RPP-0426`, `RPP-0115`, `RPP-0116`, and `RPP-0117`; no remote refs observed for `RPP-0427`, `RPP-0431`, or `RPP-0118` at snapshot time. |
| Candidate probe: merge-base, `git diff --name-status <merge-base>..<ref>`, `git merge-tree`, and `git diff origin/lane..<ref>` | Most remote candidates are behind current lane; `origin/session/rpp-32-rpp-0415-remote-plugin-removal-refusal` has a real `src/planner.js` merge conflict; stale lane-to-candidate patch views would remove current lane proof files. |
| Pairwise `git merge-tree` probes for generated-harness refs | `RPP-0115`, `RPP-0116`, `RPP-0117`, and local `RPP-0118` all conflict pairwise in `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`. |
| Pairwise `git merge-tree` probe for `RPP-0425` and `RPP-0426` | Both modify `test/push-planner.test.js`; pairwise merge reports `changed in both`. |
| Active worker worktree inspection for `rpp-24`, `rpp-32`, and `rpp-34` | `rpp-24` has local `RPP-0118` commit `85953cef4` not observed on origin; `rpp-32` has dirty `RPP-0427` work on `67d50f384`; `rpp-34` for `RPP-0431` is still at `3bd9dc676` and behind lane by 2. |
| Candidate artifact redaction scan on extracted candidate docs and active `RPP-0427` evidence doc | `ok: true`, 0 rejected files across six candidate doc artifacts. |
| Current-tree required checks after writing this audit | Checklist lint `ok: true`, artifact redaction `ok: true`, and `git diff --check` clean. |

## Candidate status table

| Item | Candidate ref observed | Base / status after `67d50f384` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0421` driver registration API proof | Integrated on lane via `78323671d`; raw worker ref `origin/session/rpp-34-rpp-0421-driver-registration-api-proof` at `e9c94906d` | Raw worker ref has merge-base `3081bfab1`, ahead 1 / behind 4; lane-to-candidate patch would delete `test/verify-release-failure-reason.test.js` and roll progress/release-gate files backward. | Treat the raw worker ref as superseded. The integrated evidence is focused test support in `test/playground-snapshot-lib.test.js`; do not restate it as broader production-backed plugin-driver semantics. |
| `RPP-0415` remote plugin removal refusal | `origin/session/rpp-32-rpp-0415-remote-plugin-removal-refusal` `92c3ea862` | Merge-base `d8e2a567c`, ahead 1 / behind 24; candidate-only files include `docs/evidence/ao-plugin-driver.md`, `src/planner.js`, and `test/plugin-remote-removal-refusal.test.js`; merge-tree reports `src/planner.js` changed in both. | Skip until restacked from lane. This is the true checklist row, but it is too stale and has a planner conflict. |
| `RPP-0415` plugin activation hook effects | `origin/session/rpp-32-rpp-0415-plugin-activation-hook-effects` `cbf5a1a85` | Merge-base `3081bfab1`, ahead 1 / behind 4; edits production-shaped plugin package tests/scripts, while checklist `RPP-0415` is remote plugin removal refusal. | Do not count this branch toward checklist `RPP-0415` without retitling/scope alignment. It overlaps earlier activation dependency work and is stale across current lane movements. |
| `RPP-0425` wp_postmeta semantics | `origin/session/rpp-34-rpp-0425-wp-postmeta-driver-semantics` `1b010a83f` | Merge-base `3bd9dc676`, ahead 1 / behind 2; candidate-only file is `test/push-planner.test.js`; pairwise conflict with `RPP-0426` in the same test file. | Support-only planner evidence. Restack after `RPP-0421`; combine carefully with `RPP-0426` and avoid production-backed wording. |
| `RPP-0426` wp_termmeta semantics | `origin/session/rpp-34-rpp-0426-wp-termmeta-driver-semantics` `034f7936d` | Merge-base `3bd9dc676`, ahead 1 / behind 2; candidate-only file is `test/push-planner.test.js`; pairwise conflict with `RPP-0425`. | Support-only planner evidence. Restack with the postmeta branch or split non-overlapping assertions before integration. |
| `RPP-0427` wp_usermeta semantics | Local active branch `session/rpp-32-rpp-0427-wp-usermeta-driver-semantics` at lane `67d50f384`, no origin ref observed | Dirty files: `scripts/harness/generated-push-cases.js`, `src/apply.js`, `test/generated-push-harness.test.js`, `test/push-planner.test.js`, plus untracked `docs/evidence/ao-wp-usermeta-driver-semantics.md`. | Branch-local and mixed-scope. Do not count until committed, pushed, scanned, and reviewed for generated-harness overlap. |
| `RPP-0431` plugin uninstall/delete refusal | Local active branch `session/rpp-34-rpp-0431-plugin-uninstall-delete-refusal` at `3bd9dc676`, no origin ref observed | Behind current lane by 2 at snapshot; no queued remote artifact available for audit. | Not queueable yet. Restack on `67d50f384`, then provide focused evidence and redaction scan. |
| `RPP-0115` plugin-owned custom-table changes | `origin/session/rpp-33-rpp-0115-plugin-owned-custom-table-changes` `8e26f0cd9` | Merge-base `3081bfab1`, ahead 1 / behind 4; candidate-only files are the generated harness doc, cases, and test. Pairwise conflicts with other generated-harness candidates. | Restack and aggregate manually; current branch is generated-test support only and would roll back lane proof if applied as a lane-to-candidate patch. |
| `RPP-0116` atomic plugin install stack | `origin/session/rpp-33-rpp-0116-atomic-plugin-install-stack` `7e7257d3f` | Merge-base `3bd9dc676`, ahead 1 / behind 2; touches the same generated harness doc/cases/test files as `RPP-0115`, `RPP-0117`, and `RPP-0118`. | Include in the same generated-harness restack plan even though it was not the primary requested row set. |
| `RPP-0117` stale remote after dry-run | `origin/session/rpp-24-rpp-0117-stale-remote-after-dry-run` `d078ce2bc` | Merge-base `3bd9dc676`, ahead 1 / behind 2; generated harness doc/cases/test; pairwise conflicts with `RPP-0115`, `RPP-0116`, and local `RPP-0118`. | Restack from lane and merge by case name, not by raw branch patch. |
| `RPP-0118` same independent content | Local branch `session/rpp-24-rpp-0118-same-independent-content` at `85953cef4`, no origin ref observed | One local commit from current lane modifies `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`; pairwise conflicts with `RPP-0116` and `RPP-0117`. | Branch-local until pushed. It should join the generated-harness aggregation queue instead of being integrated independently. |

## Findings

### High — true `RPP-0415` candidate conflicts in `src/planner.js` and is very stale

`origin/session/rpp-32-rpp-0415-remote-plugin-removal-refusal` is the branch
that matches checklist `RPP-0415`, but it was authored from merge-base
`d8e2a567c` and is behind current lane by 24 commits. `git merge-tree` against
`67d50f384` reports `src/planner.js` changed in both, while the diff from lane
to candidate would also delete several current progress and release-gate proof
surfaces. It should not be integrated raw.

Owner suggestion: `rpp-32`/plugin-driver owner should rebase only the
candidate-only `src/planner.js`, test, and plugin-driver evidence changes onto
`67d50f384`, then rerun the planner-focused test with current plugin-driver
guards before handoff.

### High — generated-harness branches conflict with each other despite clean lane merges

`RPP-0115`, `RPP-0116`, `RPP-0117`, and local `RPP-0118` each mutate the same
three generated-harness surfaces: `docs/generated-push-harness.md`,
`scripts/harness/generated-push-cases.js`, and
`test/generated-push-harness.test.js`. Pairwise merge-tree probes report
`changed in both` across these files for every checked pair. Integrating one at
a time without a case-level aggregation plan is likely to drop or duplicate
cases.

Owner suggestion: assign one generated-harness integrator to rebuild the cases
from current lane, sort/namespace the new fixtures by checklist item, and rerun
`node --test test/generated-push-harness.test.js` plus checklist lint after the
combined patch.

### High — stale lane-to-candidate patch views would remove current integrated proof

Several queued refs are clean when viewed as candidate-only diffs, but the
`origin/lane..candidate` patch view is dangerous. Raw `RPP-0421`, the activation
hook `RPP-0415` variant, true `RPP-0415`, `RPP-0115`, `RPP-0116`, `RPP-0117`,
`RPP-0425`, and `RPP-0426` all show progress/checklist/release surfaces moving
backward. Multiple patch views would remove `test/playground-snapshot-lib.test.js`
or `test/verify-release-failure-reason.test.js` from the current lane.

Owner suggestion: integrators should cherry-pick/rebase from each branch's
merge-base and never apply `origin/lane/evidence-integration-20260527..candidate`
patches for this queue.

### Medium — `RPP-0425` and `RPP-0426` are test-only planner support and conflict together

Both postmeta and termmeta semantics candidates add only to
`test/push-planner.test.js`, and a direct pairwise merge reports that file
changed in both. The branches can strengthen planner semantics, but they do not
prove production-backed driver behavior or external WordPress behavior on their
own.

Owner suggestion: `rpp-34` or the plugin-driver integrator should restack both
branches together, resolve the single test file intentionally, and label the
result as local planner support unless a separate production-shaped proof is
added.

### Medium — `RPP-0427` is branch-local and mixes plugin-driver with generated-harness edits

The active `rpp-32` worktree is on current lane but still dirty: `src/apply.js`,
`test/push-planner.test.js`, generated harness case/test files, and an untracked
evidence doc are all present. This mixes usermeta driver semantics with
harness-generation surfaces already contested by `RPP-0115` through `RPP-0118`.

Owner suggestion: `rpp-32` should split the plugin-driver apply/planner changes
from generated-harness additions, commit only after redaction scan, and make the
owner handoff explicit so the generated-harness integrator can reconcile cases.

### Medium — `RPP-0421` is integrated, but raw worker evidence is superseded and narrow

The lane correctly includes `RPP-0421` at `78323671d`, and progress/reporting
surfaces keep the final release at **NO-GO**. The raw worker branch at
`e9c94906d` is now stale and should not be queued again. The actual integrated
behavior is a focused driver registration API test in
`test/playground-snapshot-lib.test.js`; it should not be used to imply broad
postmeta/termmeta/usermeta or production plugin-driver coverage.

Owner suggestion: progress reporter should keep phrasing as "driver registration
API proof" and continue listing broader plugin-driver semantics as open work
until `RPP-0425` through `RPP-0431` are integrated from current lane.

### Medium — `RPP-0415` branch naming is ambiguous enough to cause checklist movement risk

Two pushed refs use `RPP-0415`: one matches the checklist row for remote plugin
removal refusal, while another covers plugin activation hook side effects. The
activation-side-effects branch may be useful evidence, but it does not match the
current checklist title and overlaps earlier activation dependency validator
coverage.

Owner suggestion: supervisor or plugin-driver owner should rename/scope the
activation-side-effects work before it is considered for checklist movement, and
reserve `RPP-0415` for remote plugin removal refusal.

### Low — no candidate artifact redaction issue found in scanned docs

The extracted candidate docs for true `RPP-0415`, `RPP-0115`, `RPP-0116`,
`RPP-0117`, local `RPP-0118`, and the active `RPP-0427` evidence doc all
reported artifact redaction `ok: true` with 0 rejected files. Continue scanning
before integration because several active workers are still producing Markdown
artifacts.

## Bottom line

Release remains **NO-GO**. The only plugin-driver item newly present on the lane
is narrow `RPP-0421` driver registration API support at `78323671d`. The next
plugin-driver queue is not safe for raw integration: true `RPP-0415` conflicts
in `src/planner.js`, `RPP-0425` and `RPP-0426` conflict in the same planner test,
`RPP-0427` and `RPP-0431` were not pushed to origin at snapshot time, and the
`RPP-0115`/`RPP-0116`/`RPP-0117`/`RPP-0118` generated-harness work needs a single
case-level aggregation pass from current lane.
