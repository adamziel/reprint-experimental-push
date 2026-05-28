# AO critic post-RPP-0218/RPP-0219 queue audit — 2026-05-28

Snapshot time: 2026-05-28 06:26 CEST
Critic branch: `session/rpp-37`
Audited integration lane: `origin/lane/evidence-integration-20260527` at `c3b151b5d` (`docs: refresh progress for raw value redaction`)
Initial refill baseline: `6cdf3ab18` with 112 checked / 888 open; lane advanced to `c3b151b5d` during this audit.
Observed checklist state: 113 checked / 887 open
Release posture: **NO-GO**

## Scope

This pass reviewed the queue after `RPP-0218` and the subsequent `RPP-0219`
lane movement. It compared the pushed candidate families for merge invariants,
release gates, generated harness, graph identity, and plugin-driver work:
`RPP-0044` through `RPP-0047`, `RPP-0117` through `RPP-0120`, `RPP-0220`
through `RPP-0222`, `RPP-0323`, `RPP-0326`, `RPP-0327`, and `RPP-0425`
through `RPP-0431`. The critic lens was stale-base reversion risk, pairwise
conflicts, weak validation, redaction exposure, and local-vs-production wording.

## Command evidence

| Check | Result |
| --- | --- |
| `git fetch origin --prune`; `git rev-parse --short origin/lane/evidence-integration-20260527` | Lane was initially observed at `6cdf3ab18`; it advanced to `c3b151b5d` while auditing, so this report uses the newer lane head. |
| `git merge --no-edit origin/lane/evidence-integration-20260527` | Critic branch merged current lane state, including `RPP-0219` progress/checklist/evidence updates, before writing this audit. |
| `node scripts/release/checklist-completion-lint.mjs --root .` | Pre-write current-lane lint reported `ok: true`, 113 checked / 887 open, 0 risky claims. |
| Candidate probe: merge-base, candidate-only diff, `git merge-tree`, and lane-to-candidate diff for target refs | Most candidates are behind `c3b151b5d`; stale lane-to-candidate patch views would delete `RPP-0218`/`RPP-0219` evidence docs and roll current progress/apply/planner files backward. |
| Pairwise `git merge-tree` probes by family | Release-gate candidates conflict in `docs/evidence/ao-release-gates.md`; generated-harness candidates conflict in harness doc/cases/test; merge-invariant candidates conflict in `test/push-planner.test.js`; graph candidates conflict in graph docs/local-production proof/planner tests; plugin-driver candidates conflict in `test/push-planner.test.js` and sometimes `src/apply.js`. |
| Candidate artifact redaction scan on extracted Markdown docs | `ok: true`, 17 scanned files, 0 rejected files across queued release-gate, generated-harness, merge-invariant, graph, and plugin-driver docs. |
| Current-tree required checks after writing this audit | Checklist lint `ok: true`, artifact redaction `ok: true`, and `git diff --check` clean. |

## Candidate status table

| Item | Candidate ref observed | Base/status after `c3b151b5d` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0219` redacted raw value evidence | Integrated on lane via `c3b151b5d`; raw worker ref `origin/session/rpp-29-rpp-0219-redacted-raw-value-evidence` at `5edc2c34f` | Raw worker ref is behind by 10 and conflicts with current `src/apply.js` and `test/push-planner.test.js`. | Do not queue the raw worker ref. Use lane state as truth and keep the caveat that this is local planner/apply evidence, not final production proof. |
| `RPP-0220` atomic group blocker propagation | `origin/session/rpp-29-rpp-0220-atomic-group-blocker-propagation` `1552cc7e6` | Merge-base `3bd9dc676`, ahead 1 / behind 8; candidate-only `src/planner.js`, `test/push-planner.test.js`, and one evidence doc; conflicts in `test/push-planner.test.js`. | Restack first within the merge-invariant family if it is a foundational blocker rule, then rebase row/file edit candidates on top. |
| `RPP-0221` independent file plus remote row edit | `origin/session/rpp-29-rpp-0221-independent-file-remote-row-edit` `d8173cb7d` | Merge-base `3d4a985dd`, ahead 1 / behind 4; touches scenario matrix, generated harness, and planner test; conflicts with lane in `test/push-planner.test.js`. | Restack after `RPP-0219`; do not integrate in parallel with `RPP-0222` without manual case aggregation. |
| `RPP-0222` independent row plus remote file edit | `origin/session/rpp-29-rpp-0222-independent-row-remote-file-edit` `6749810f7` | Merge-base `6cdf3ab18`, ahead 1 / behind 2; conflicts with lane in `test/push-planner.test.js` and conflicts pairwise with `RPP-0221` in scenario matrix, harness files, and planner test. | Closest merge-invariant candidate after `RPP-0219`, but still needs restack and pairwise reconciliation. |
| `RPP-0044` packaged fallback rejection | `origin/session/rpp-25-rpp-0044-packaged-fallback-rejection` `872148a91` | Merge-base `3bd9dc676`, ahead 1 / behind 8; candidate-only `ao-release-gates.md` plus generated release-gate test; individual merge-tree clean. | Stale but isolated. Rebase candidate-only doc/test changes; resolve release-gate doc ordering with adjacent gate rows. |
| `RPP-0045` wrong remote alias rejection | `origin/session/rpp-25-rpp-0045-wrong-remote-alias-rejection` `8d077a1fd` | Merge-base `3bd9dc676`, ahead 1 / behind 8; same release-gates doc surface as `RPP-0044`. | Same as above; do not combine by raw patch because `ao-release-gates.md` conflicts pairwise. |
| `RPP-0046` auth source readback drift | `origin/session/rpp-25-rpp-0046-auth-source-readback-drift` `ab43d6585` | Merge-base `67d50f384`, ahead 1 / behind 6; release-gates doc/test; pairwise doc conflict with `RPP-0047`. | Rebase and append one ordered row; avoid losing current `RPP-0219` evidence docs. |
| `RPP-0047` missing production secret gate | `origin/session/rpp-25-rpp-0047-missing-production-secret-gate` `7cba3cb9d` | Merge-base `6cdf3ab18`, ahead 1 / behind 2; closest release-gate candidate; individual merge-tree clean but doc conflicts pairwise. | Best release-gate candidate to restack next, with strict **NO-GO** wording beside any synthetic gate evidence. |
| `RPP-0117` stale remote after dry-run | `origin/session/rpp-24-rpp-0117-stale-remote-after-dry-run` `d078ce2bc` | Merge-base `3bd9dc676`, ahead 1 / behind 8; generated harness doc/cases/test. | Generated-test support only; aggregate with neighboring harness rows rather than integrating raw. |
| `RPP-0118` same independent content | `origin/session/rpp-24-rpp-0118-same-independent-content` `85953cef4` | Merge-base `67d50f384`, ahead 1 / behind 6; same generated harness surfaces. | Same aggregation requirement; stale across `RPP-0218`/`RPP-0219`. |
| `RPP-0119` remote-only preservation | `origin/session/rpp-33-rpp-0119-remote-only-preservation` `fc7ad9b55` | Merge-base `3d4a985dd`, ahead 1 / behind 4; same generated harness surfaces. | Pairwise conflicts with `RPP-0118` and `RPP-0120`; combine at case level. |
| `RPP-0120` large ready plan tier | `origin/session/rpp-24-rpp-0120-large-ready-plan-tier` `cea7948cf` | Merge-base `6cdf3ab18`, ahead 1 / behind 2; closest generated-harness candidate; modifies the same three generated harness files. | Good next harness source only if rebuilt from current lane with adjacent cases preserved. |
| `RPP-0323` post author reference | `origin/session/rpp-30-rpp-0323-post-author-reference` `d59514ff6` | Merge-base `3bd9dc676`, ahead 1 / behind 8; graph doc, local-production complex-site proof, proof test, planner test. | Stale and conflicts with graph neighbors; keep wording as local complex-site support, not external production proof. |
| `RPP-0326` comment parent thread reference | `origin/session/rpp-30-rpp-0326-comment-parent-thread-reference` `b1d31c678` | Merge-base `67d50f384`, ahead 1 / behind 6; same graph surfaces as `RPP-0323`/`RPP-0327`. | Restack with graph owner; pairwise conflicts require a combined graph-proof update. |
| `RPP-0327` comment user reference | `origin/session/rpp-30-rpp-0327-comment-user-reference` `d7247e34d` | Merge-base `3d4a985dd`, ahead 1 / behind 4; same graph surfaces; conflicts pairwise with both graph neighbors. | Not safe raw. Needs graph-family aggregation and a clear local-production caveat. |
| `RPP-0425` wp_postmeta driver semantics | `origin/session/rpp-34-rpp-0425-wp-postmeta-driver-semantics` `1b010a83f` | Merge-base `3bd9dc676`, ahead 1 / behind 8; candidate-only `test/push-planner.test.js`; conflicts with lane and `RPP-0426`. | Test-only planner support; do not present as production-backed plugin-driver behavior. |
| `RPP-0426` wp_termmeta driver semantics | `origin/session/rpp-34-rpp-0426-wp-termmeta-driver-semantics` `034f7936d` | Merge-base `3bd9dc676`, ahead 1 / behind 8; candidate-only `test/push-planner.test.js`; conflicts with `RPP-0425` and `RPP-0427`. | Same as `RPP-0425`; combine or sequence intentionally. |
| `RPP-0427` wp_usermeta driver semantics | `origin/session/rpp-32-rpp-0427-wp-usermeta-driver-semantics` `1b9c0aac5` | Merge-base `3d4a985dd`, ahead 1 / behind 4; docs, generated harness files, `src/apply.js`, and planner test; conflicts with lane in `src/apply.js` and `test/push-planner.test.js`. | High-risk mixed-scope candidate; split generated harness from plugin-driver code before integration. |
| `RPP-0431` plugin uninstall/delete refusal | `origin/session/rpp-34-rpp-0431-plugin-uninstall-delete-refusal` `18e77c437` | Merge-base `3d4a985dd`, ahead 1 / behind 4; `src/apply.js`, `src/planner.js`, and planner test; conflicts with lane in `src/apply.js` and `test/push-planner.test.js`. | High-risk code candidate; restack after `RPP-0219` and after deciding order with `RPP-0427`. |

## Findings

### High — stale branch patch views would revert current `RPP-0218`/`RPP-0219` lane truth

For most queued refs, the candidate-only diff is small, but the diff from
current lane to candidate is dangerous. It shows deletion of
`docs/evidence/rpp-0218-forged-ready-plan-defense.md` and/or
`docs/evidence/rpp-0219-redacted-raw-value-evidence.md`, plus progress/checklist
rollback and `src/apply.js` / `test/push-planner.test.js` movement back before
raw-value redaction. This affects merge-invariant, release-gate,
generated-harness, graph, and plugin-driver queues.

Owner suggestion: integrators should cherry-pick or rebase candidate-only
changes from each merge-base. Do not apply `origin/lane..candidate` patch views
for any candidate in this audit.

### High — merge-invariant queue needs a single restack order after `RPP-0219`

`RPP-0220`, `RPP-0221`, and `RPP-0222` all conflict with current lane in
`test/push-planner.test.js`. `RPP-0221` and `RPP-0222` also conflict pairwise in
`docs/scenario-matrix.md`, `scripts/harness/generated-push-cases.js`,
`test/generated-push-harness.test.js`, and planner tests. Raw `RPP-0219` also
conflicts with current lane and is superseded by the lane-integrated state.

Owner suggestion: merge-invariant owner should restack `RPP-0220` first if its
blocker propagation is foundational, then rebase `RPP-0221`/`RPP-0222` onto that
result and reconcile shared generated cases manually.

### High — generated-harness queue is pairwise-conflicting across all reviewed rows

`RPP-0117`, `RPP-0118`, `RPP-0119`, and `RPP-0120` all mutate the same generated
harness doc, case generator, and test file. Pairwise merge-tree probes report
`changed in both` for the sampled pairs. Although individual merges against the
lane can appear clean, sequential integration without a case-level rebuild is
likely to drop cases or overwrite summary text.

Owner suggestion: assign one generated-harness integrator to rebuild the four
case groups from `c3b151b5d`, verify stable ordering/counts, and rerun the
focused generated-harness test before checklist movement.

### High — plugin-driver queue has code conflicts plus local-vs-production overclaim risk

`RPP-0425` and `RPP-0426` are planner-test-only candidates. `RPP-0427` mixes
user-meta driver semantics with generated-harness files and `src/apply.js`.
`RPP-0431` changes `src/apply.js`, `src/planner.js`, and planner tests. The code
candidates conflict with current lane after `RPP-0219` raw-value redaction, and
`RPP-0427` conflicts pairwise with `RPP-0431` in both `src/apply.js` and
`test/push-planner.test.js`.

Owner suggestion: plugin-driver owner should split `RPP-0427` harness changes
from code changes, decide whether `RPP-0431` or `RPP-0427` owns the next
`src/apply.js` restack, and keep all `RPP-0425`/`RPP-0426` wording as local
planner support unless production-shaped proof is added.

### Medium — release-gate candidates are individually isolated but pairwise-conflict in the shared doc

`RPP-0044`, `RPP-0045`, `RPP-0046`, and `RPP-0047` each add one generated gate
test plus edits to `docs/evidence/ao-release-gates.md`. Individual merge-tree
checks against the lane were clean, but pairwise checks conflict in the shared
doc. `RPP-0047` has the freshest base (`6cdf3ab18`) and is the least stale, but
it still needs rebasing over `RPP-0219`.

Owner suggestion: release-gate integrator should prefer `RPP-0047` first if the
queue wants the freshest candidate, then append `RPP-0044` through `RPP-0046` in
one ordered doc update while keeping **NO-GO** next to synthetic evidence.

### Medium — graph candidates share local-production proof surfaces and need graph-family aggregation

`RPP-0323`, `RPP-0326`, and `RPP-0327` all edit
`docs/evidence/ao-graph-identity.md`,
`scripts/playground/local-production-complex-site-proof.js`,
`test/local-production-complex-site-proof.test.js`, and
`test/push-planner.test.js`. Pairwise probes conflict across those surfaces. The
validation is valuable local complex-site support, but not Docker/external
production proof.

Owner suggestion: graph owner should aggregate these references in one restack,
rerun the local-production complex-site proof test plus planner test, and keep
external-production caveats in progress text.

### Low — no redaction issue found in candidate Markdown artifacts

The candidate artifact redaction scan covered 17 extracted Markdown artifacts,
including release-gate docs, generated harness docs, merge-invariant evidence,
graph identity docs, and the usermeta plugin-driver evidence doc. It returned
`ok: true` with 0 rejected files. Keep scanning before integration because
`RPP-0219` specifically touches raw-value evidence and several candidates update
published Markdown.

## Candidate order recommendation

1. Treat `RPP-0219` as already integrated via lane `c3b151b5d`; ignore the raw
   worker ref except as provenance.
2. Restack `RPP-0047` if the release-gate queue needs a quick isolated doc/test
   candidate; keep release **NO-GO** language explicit.
3. Restack `RPP-0220` before `RPP-0221`/`RPP-0222` if blocker propagation is a
   prerequisite for the row/file merge cases.
4. Assign a single generated-harness aggregation pass for `RPP-0117` through
   `RPP-0120`; do not interleave those raw refs with merge-invariant harness
   candidates.
5. Aggregate graph candidates together (`RPP-0323`, `RPP-0326`, `RPP-0327`) and
   plugin-driver candidates separately (`RPP-0425`, `RPP-0426`, `RPP-0427`,
   `RPP-0431`) after resolving `src/apply.js` ownership.

## Bottom line

Release remains **NO-GO**. The lane advanced during this audit from `6cdf3ab18`
to `c3b151b5d`, making `RPP-0219` integrated and making all queued branches that
predate it stale. The queue is not safe for raw sequential integration: every
family reviewed has either pairwise file conflicts, lane-to-candidate rollback
risk, weak local-only validation, or shared evidence docs that must be manually
reconciled.
