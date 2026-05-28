# AO critic post-RPP-0051 queue audit — 2026-05-28

Snapshot: final fetch observed `origin/lane/evidence-integration-20260527` at
`f01b317d2` (`docs: refresh progress for driver apply validation hook`). The
refill named `5e5ffa2b5`; fetching during this pass proved a newer lane after
`RPP-0438` landed.

Observed checklist state: 118 checked / 882 open
Release posture: **NO-GO**
Critic branch: `session/rpp-37`

## Scope

This pass reviewed the queue after `RPP-0051` landed, then refreshed the audit
when the lane advanced from `5e5ffa2b5` to `f01b317d2`. Target families were
`RPP-0438`, release-gate reconciliation for `RPP-0052`/`RPP-0053`,
generated-harness candidates `RPP-0126`/`RPP-0128`/`RPP-0129`/`RPP-0130`,
merge-invariant candidates `RPP-0227`/`RPP-0228`, graph candidates
`RPP-0331`/`RPP-0335`/`RPP-0336`, and plugin-driver candidates
`RPP-0439`/`RPP-0440`/`RPP-0441`/`RPP-0442`/`RPP-0443`.

The critic lens was stale-base reversion, touched-file collisions, docs
reconciliation, branch-local counts, redaction, and local-vs-production caveats.
No code, checklist, or progress surface was edited by this critic pass.

## Command evidence

| Check | Result |
| --- | --- |
| `git fetch origin --prune`; `git rev-parse --short origin/lane/evidence-integration-20260527` | Initial fetch matched `5e5ffa2b5`; final fetch proved newer lane `f01b317d2`. |
| `git merge --no-edit origin/lane/evidence-integration-20260527` | Synced this critic branch to `f01b317d2` before writing final findings. |
| `node scripts/release/checklist-completion-lint.mjs --root .` | Lint `ok: true`, 118 checked / 882 open, 0 risky claims after syncing the newer lane. |
| Candidate `git merge-base`, `git rev-list --left-right --count`, and `git merge-tree origin/lane/evidence-integration-20260527 <ref>` | `RPP-0052`/`RPP-0053` conflict with current lane in `ao-release-gates.md`; `RPP-0439`/`RPP-0440`/`RPP-0441` now conflict with current lane in `ao-plugin-driver.md` after `RPP-0438`; committed harness, merge-invariant, and graph refs are individually clean unless noted below. |
| Pairwise `git merge-tree` probes | Release-gate pair conflicts in `ao-release-gates.md`; generated-harness pairs conflict in harness docs/cases/tests; graph pairs conflict in graph docs/proof/tests; plugin-driver pairs conflict in `ao-plugin-driver.md`. |
| Live worktree status for active refills | `rpp-32/RPP-0442` has an unresolved `UU docs/evidence/ao-plugin-driver.md` conflict plus generated-harness edits; `rpp-34/RPP-0443` has branch-local plugin-driver docs/planner-test edits; `rpp-25/RPP-0054` is already dirty in release-gates docs but is outside this queue pass. |
| Extracted candidate Markdown redaction scan | `ok: true`, 16 scanned files, 0 rejected files across focused candidate docs and live doc snapshots. |
| Required current-tree checks after writing this audit | Checklist lint, artifact redaction scan, and `git diff --check` were rerun before commit. |

## Candidate status table

| Item | Ref/worktree observed | Base/status against `f01b317d2` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0438` driver apply validation hook | Integrated on lane `f01b317d2`; previous active branch `session/rpp-28-rpp-0438-integration-20260528` now points at lane head. | Checked count is now 118 / 882. Older raw worker ref `origin/session/rpp-32-rpp-0438-driver-apply-validation-hook` is stale from `7ac6d62bd`. | Treat `f01b317d2` as the plugin-driver floor; do not use the old raw worker branch as a patch source. |
| `RPP-0052` dry-run route eligibility | `origin/session/rpp-25-rpp-0052-dry-run-route-eligibility-generated` at `7078280c4`. | Base `7ac6d62bd`; 6 lane-only / 1 candidate-only; conflicts with current lane in `docs/evidence/ao-release-gates.md`. | Must be restacked after `RPP-0050`/`RPP-0051` and current progress; generated gate support only. |
| `RPP-0053` apply route pre-mutation | `origin/session/rpp-25-rpp-0053-apply-route-premutation-proof` at `0ba4f8f87`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; conflicts with current lane in `docs/evidence/ao-release-gates.md`. | Same release-gates doc reconciliation as `RPP-0052`; combine rows, do not raw merge. |
| `RPP-0126` serialized `wp_options` harness | `origin/session/rpp-24-rpp-0126-wp-options-serialized-changes-v2` at `2be014ac8`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; individually merge-tree clean. | Aggregate with adjacent generated-harness work; pairwise conflict with `RPP-0128`, `RPP-0129`, and `RPP-0130`. |
| `RPP-0128` `wp_postmeta` CUD harness | `origin/session/rpp-33-rpp-0128-wp-postmeta-cud-changes-v2` at `45d4ae940`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; individually merge-tree clean. | Same harness trio as `RPP-0126`; raw sequential merge risks dropped rows. |
| `RPP-0129` users/usermeta graph harness | `origin/session/rpp-24-rpp-0129-wp-users-usermeta-graph-v2` at `94162f3bb`. | Base `5e5ffa2b5`; 2 lane-only / 1 candidate-only; individually merge-tree clean. | Fresher than `RPP-0126`/`RPP-0128`, but conflicts pairwise with them and with `RPP-0130`. |
| `RPP-0130` comments/commentmeta graph harness | `origin/session/rpp-33-rpp-0130-wp-comments-commentmeta-graph-v2` at `cc40a3acb`. | Base `f01b317d2`; current-lane candidate; individually merge-tree clean. | Best harness base, but still collides pairwise with older harness refs. |
| `RPP-0227` local plugin data stale owner context | `origin/session/rpp-29-rpp-0227-local-plugin-data-stale-owner-context` at `258b0c9dd`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; individually merge-tree clean. | Candidate-only diff is required; pairwise probe with `RPP-0228` was clean, but planner assertions should still be ordered together. |
| `RPP-0228` unknown plugin-owned resource refusal | `origin/session/rpp-29-rpp-0228-unknown-plugin-owned-resource-refusal` at `c9cdf7e7d`. | Base `5e5ffa2b5`; 2 lane-only / 1 candidate-only; individually merge-tree clean; pairwise clean with `RPP-0227`. | Safer than older refs, but still planner-only support until integrated and counted. |
| `RPP-0331` custom taxonomy reference | `origin/session/rpp-30-rpp-0331-custom-taxonomy-fail-closed-reference` at `e7bf46fa3`. | Base `7ac6d62bd`; 6 lane-only / 1 candidate-only; individually merge-tree clean. | Local complex-site support only; conflicts pairwise with graph follow-ons. |
| `RPP-0335` nav menu item reference | `origin/session/rpp-30-rpp-0335-nav-menu-item-fail-closed-reference` at `e63f47347`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; individually merge-tree clean. | Pairwise conflict with `RPP-0331` and `RPP-0336` in graph doc/proof/test surfaces. |
| `RPP-0336` `wp_navigation` reference | `origin/session/rpp-30-rpp-0336-wp-navigation-fail-closed-reference` at `ce7b9937d`. | Base `5e5ffa2b5`; 2 lane-only / 1 candidate-only; individually merge-tree clean. | Fresher graph candidate, but pairwise conflicts with `RPP-0335`; keep local-support caveats. |
| `RPP-0439` driver audit evidence redaction | `origin/session/rpp-34-rpp-0439-driver-audit-evidence-redaction` at `0bcb8cc10`. | Base `7ac6d62bd`; 6 lane-only / 1 candidate-only; conflicts with current lane in `docs/evidence/ao-plugin-driver.md`. | Restack after `RPP-0438`; local redaction support, not release-wide proof. |
| `RPP-0440` arbitrary plugin fixture package | `origin/session/rpp-34-rpp-0440-arbitrary-plugin-fixture-package-v2` at `4d68fc6f8`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; conflicts with current lane in `docs/evidence/ao-plugin-driver.md`. | Production-shaped scripts require strict caveat wording and current-lane doc reconciliation. |
| `RPP-0441` driver registration API generated | `origin/session/rpp-32-rpp-0441-driver-registration-api-generated` at `d2e536b45`. | Base `c3355a77a`; 4 lane-only / 1 candidate-only; conflicts with current lane in `docs/evidence/ao-plugin-driver.md`. | Generated API support only; doc row must be rebuilt after `RPP-0438`. |
| `RPP-0442` driver owner identity binding | Active `rpp-32` worktree `session/rpp-32-rpp-0442-driver-owner-identity-binding-generated`. | Current worktree shows unresolved `UU docs/evidence/ao-plugin-driver.md` plus generated harness edits. | Skip until conflict is resolved and tests/lint are rerun; do not count any local evidence from this worktree. |
| `RPP-0443` custom table allowlist exact match | Active `rpp-34` worktree `session/rpp-34-rpp-0443-custom-table-allowlist-exact-match`. | Current-lane worktree with staged/dirty `docs/evidence/ao-plugin-driver.md` and `test/push-planner.test.js`; no remote ref at snapshot. | Branch-local only; likely collides with the same plugin-driver doc bottleneck. |

## Findings

### Critical — lane advanced during the audit; `RPP-0438` is now the floor

The refill named `5e5ffa2b5` and described `RPP-0438` as active, but a later
fetch observed `f01b317d2` with `RPP-0438` integrated and the checklist at
118/882. Any report still treating `RPP-0438` as branch-local, or using
pre-`RPP-0438` plugin-driver docs as current truth, is stale.

Owner suggestion: integrators and progress owners should use `f01b317d2` as the
floor. Plugin-driver follow-ons must be rebased onto the lane after `RPP-0438`.

### High — release-gates `RPP-0052`/`RPP-0053` still conflict after `RPP-0051`

Both release-gate follow-ons edit `docs/evidence/ao-release-gates.md` from stale
bases. `RPP-0052` predates `RPP-0050`, `RPP-0051`, and `RPP-0438`; `RPP-0053`
predates `RPP-0051` and `RPP-0438`. Each conflicts with the current lane in the
same doc, and the pair also conflicts with each other. Their generated tests are
useful support but do not change final release posture.

Owner suggestion: release-gate owner should rebuild a single doc/test patch from
`f01b317d2`, preserving existing rows and keeping release **NO-GO** wording
beside synthetic gate coverage.

### High — generated-harness candidates need one aggregation pass

`RPP-0126`, `RPP-0128`, `RPP-0129`, and `RPP-0130` are individually clean
against the lane, but pairwise probes conflict in generated harness docs, cases,
or tests. `RPP-0130` has the freshest base, while older refs carry two to four
lane-only commits.

Owner suggestion: generated-harness owner should rebuild the full set from
`f01b317d2`, sort/namespace the cases, rerun the focused generated harness
suite, and update the generated harness doc once.

### High — plugin-driver docs are now current-lane conflicts, not just pairwise conflicts

After `RPP-0438` landed, `RPP-0439`, `RPP-0440`, and `RPP-0441` each conflict
with the current lane in `docs/evidence/ao-plugin-driver.md`. Active `RPP-0442`
has an unresolved conflict in that same file, and active `RPP-0443` is editing
that doc plus planner tests without a pushed candidate ref.

Owner suggestion: plugin-driver owner should stop raw merges from old refs,
resolve `RPP-0442` before it is considered, and rebuild one ordered
`ao-plugin-driver.md` update for `RPP-0439` through `RPP-0443` from `f01b317d2`.
Keep packaged, generated, and redaction evidence scoped as local or
production-shaped unless a production verifier is included.

### High — stale-base candidates would hide lane-only evidence if raw patch views are used

Any `origin/lane..candidate` diff for refs based on `7ac6d62bd` or `c3355a77a`
contains lane-only history for recent release gates and plugin-driver work. The
highest-risk examples are `RPP-0052`, `RPP-0331`, `RPP-0439`, `RPP-0440`, and
`RPP-0441`. The individual merge-tree result being clean is not enough to make a
raw reverse patch safe.

Owner suggestion: integrators should use candidate-only diffs from each
merge-base or true rebases/cherry-picks. Do not apply current-lane-to-candidate
patches.

### Medium — merge-invariant follow-ons look pairwise clean but are still planner-adjacent

`RPP-0227` and `RPP-0228` are both individually clean, and their pairwise
merge-tree probe was clean. They still touch planner assertion surfaces for
plugin-owned data refusal behavior, so order and naming can easily drift if they
are integrated by unrelated patches.

Owner suggestion: merge-invariant owner should integrate or review the two
planner assertion blocks together, with redacted plugin-owned data evidence if
docs are added.

### Medium — graph candidates are local complex-site support and conflict as a family

`RPP-0331`, `RPP-0335`, and `RPP-0336` are individually clean, but graph pairs
conflict in `docs/evidence/ao-graph-identity.md`, the local-production
complex-site proof script, and associated tests. These are local complex-site
graph/reference checks, not external production WordPress proof.

Owner suggestion: graph owner should aggregate graph rows and proof-script cases
from `f01b317d2`, then keep progress/report wording explicit that this is local
support evidence.

### Low — focused Markdown redaction scan was clean

The extracted candidate artifact scan covered 16 Markdown snapshots and reported
0 rejected files. Continue scanning because release-gate and plugin-driver work
frequently touches authentication, plugin-owned, and serialized/private evidence
surfaces; the scan does not replace review of JavaScript scenario files.

## Candidate order recommendation

1. Use `f01b317d2` as the floor; discard any queue notes that still treat
   `RPP-0438` as branch-local.
2. Restack and combine `RPP-0052`/`RPP-0053` release-gate docs from `f01b317d2`.
3. Aggregate generated-harness work (`RPP-0126`, `RPP-0128`, `RPP-0129`,
   `RPP-0130`) in one current-lane branch.
4. Integrate/review `RPP-0227`/`RPP-0228` planner assertions together.
5. Aggregate graph proof rows/cases (`RPP-0331`, `RPP-0335`, `RPP-0336`) with
   local-support caveats.
6. Skip unresolved `RPP-0442`; rebuild plugin-driver docs for
   `RPP-0439`/`RPP-0440`/`RPP-0441`/`RPP-0443` after the `RPP-0438` lane row.

## Bottom line

Release remains **NO-GO**. The safe floor is now `f01b317d2`, not the originally
provided `5e5ffa2b5`. The main queue risks are stale release-gates docs,
generated-harness aggregation collisions, graph proof-script collisions, and
plugin-driver docs that now conflict directly with the lane after `RPP-0438`.
