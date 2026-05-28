# AO critic post-RPP-0219 queue audit — 2026-05-28

Snapshot time: 2026-05-28 06:48 CEST
Critic branch: `session/rpp-37`
Audited integration lane: `origin/lane/evidence-integration-20260527` at `f9df9d1b6` (`docs: refresh progress for atomic blocker propagation`)
Initial refill baseline: `c3b151b5d` with 113 checked / 887 open; lane advanced during this work when `RPP-0220` landed.
Observed checklist state: 114 checked / 886 open
Release posture: **NO-GO**

## Scope

This pass reviewed the next likely queue after `RPP-0219` and the `RPP-0220`
lane move: `RPP-0221`, `RPP-0222`, `RPP-0120`, `RPP-0121`, `RPP-0047`,
`RPP-0048`, `RPP-0327`, `RPP-0328`, `RPP-0427`, `RPP-0431`, `RPP-0433`, and
`RPP-0434`. It focused on stale-base reversions, touched-file overlaps,
redaction/overclaim risk, and production-vs-local caveats.

## Command evidence

| Check | Result |
| --- | --- |
| `git fetch origin --prune`; `git rev-parse --short origin/lane/evidence-integration-20260527` | Lane advanced from `c3b151b5d` to `f9df9d1b6`; `RPP-0220` is now represented on the lane. |
| `git merge --no-edit origin/lane/evidence-integration-20260527` | Critic branch merged current lane before writing, so checklist/progress context includes `RPP-0220`. |
| `node scripts/release/checklist-completion-lint.mjs --root .` | Pre-write lint reported `ok: true`, 114 checked / 886 open, 0 risky claims. |
| Candidate probe: merge-base, candidate-only diff, `git merge-tree`, and lane-to-candidate diff for target refs | Several candidates are individually clean, but many are stale after `RPP-0220`; lane-to-candidate patch views would remove `RPP-0219`/`RPP-0220` evidence docs and roll planner/apply/progress files backward. |
| Pairwise `git merge-tree` probes by family | `RPP-0221`/`RPP-0222`, `RPP-0120`/`RPP-0121`, `RPP-0047`/`RPP-0048`, `RPP-0327`/`RPP-0328`, and several plugin-driver pairs all report `changed in both` on shared files. |
| Candidate Markdown redaction scan | `ok: true`, 13 scanned files, 0 rejected files across target candidate docs. |
| Current-tree required checks after writing this audit | Checklist lint `ok: true`, artifact redaction `ok: true`, and `git diff --check` clean. |

## Candidate status table

| Item | Candidate ref observed | Base/status after `f9df9d1b6` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0221` independent local file plus remote row edit | `origin/session/rpp-29-rpp-0221-independent-file-remote-row-edit` `d8173cb7d` | Merge-base `3d4a985dd`, ahead 1 / behind 6; edits scenario matrix, generated harness files, planner test, and one evidence doc; conflicts with lane in `test/push-planner.test.js`. | Restack after `RPP-0220`; do not integrate beside `RPP-0222` without manual harness/scenario reconciliation. |
| `RPP-0222` independent local row plus remote file edit | `origin/session/rpp-29-rpp-0222-independent-row-remote-file-edit` `6749810f7` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; same family of files as `RPP-0221`; conflicts with lane in planner test and conflicts pairwise with `RPP-0221`. | Slightly fresher than `RPP-0221`, but still needs restack on `f9df9d1b6`. |
| `RPP-0120` large ready plan tier | `origin/session/rpp-24-rpp-0120-large-ready-plan-tier` `cea7948cf` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; modifies `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`; individual merge-tree clean. | Generated-harness support only; pairwise conflict with `RPP-0121` means aggregate by case group. |
| `RPP-0121` file create/update/delete mix | `origin/session/rpp-24-rpp-0121-file-cud-mix-v2` `dc2796a7f` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; same generated harness files as `RPP-0120`; individual merge-tree clean. | Same aggregation requirement as `RPP-0120`; do not raw-apply one over the other. |
| `RPP-0047` missing production secret gate | `origin/session/rpp-25-rpp-0047-missing-production-secret-gate` `7cba3cb9d` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; release-gates doc plus one generated gate test; individual merge-tree clean. | Rebase over `RPP-0220` and keep synthetic gate evidence framed as **NO-GO**. |
| `RPP-0048` Application Password credential binding | `origin/session/rpp-25-rpp-0048-application-password-credential-binding` `f36a3de64` | Merge-base `c3b151b5d`, ahead 1 / behind 2; release-gates doc plus one generated gate test; individual merge-tree clean. | Fresher than `RPP-0047`, but pairwise conflicts in `ao-release-gates.md`; combine ordered doc rows. |
| `RPP-0327` comment user reference | `origin/session/rpp-30-rpp-0327-comment-user-reference` `d7247e34d` | Merge-base `3d4a985dd`, ahead 1 / behind 6; graph doc, local-production proof script/test, and planner test; conflicts with lane in planner test. | Stale graph candidate; local complex-site evidence only, not external production proof. |
| `RPP-0328` commentmeta comment reference | `origin/session/rpp-30-rpp-0328-commentmeta-comment-reference` `4244058f4` | Merge-base `c3b151b5d`, ahead 1 / behind 2; same graph surfaces as `RPP-0327`; conflicts with lane in planner test. | Fresher graph source, but conflicts pairwise with `RPP-0327`; aggregate graph update if both are desired. |
| `RPP-0427` wp_usermeta driver semantics | `origin/session/rpp-32-rpp-0427-wp-usermeta-driver-semantics` `1b9c0aac5` | Merge-base `3d4a985dd`, ahead 1 / behind 6; docs, generated harness files, `src/apply.js`, and planner test; conflicts with lane in `src/apply.js` and planner test. | High-risk mixed-scope candidate. Split generated harness from plugin-driver code before integration. |
| `RPP-0431` plugin uninstall/delete refusal | `origin/session/rpp-34-rpp-0431-plugin-uninstall-delete-refusal` `18e77c437` | Merge-base `3d4a985dd`, ahead 1 / behind 6; `src/apply.js`, `src/planner.js`, and planner test; conflicts with lane in all three. | High-risk code candidate; not safe until restacked after `RPP-0220` planner changes. |
| `RPP-0433` stale plugin file refusal | `origin/session/rpp-32-rpp-0433-stale-plugin-file-refusal` `feb3a80d3` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc, `src/planner.js`, plugin-owner regression test; conflicts with lane in `src/planner.js`. | Fresher than `RPP-0427`/`RPP-0431`, but still planner-conflicting after `RPP-0220`. |
| `RPP-0434` stale metadata refusal | `origin/session/rpp-34-rpp-0434-stale-metadata-refusal` `ad37f13f3` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc plus plugin-owner regression test; individual merge-tree clean. | Lowest code-conflict risk in plugin-driver set, but conflicts pairwise with `RPP-0433` docs/tests. |

## Findings

### High — lane-to-candidate patch views can drop `RPP-0220` evidence and planner changes

After `f9df9d1b6`, nearly every candidate whose merge-base predates `RPP-0220`
shows `docs/evidence/rpp-0220-atomic-group-blocker-propagation.md` deleted in a
lane-to-candidate diff. Older refs also drop `RPP-0219` and sometimes
`RPP-0218` evidence docs, while rolling `src/planner.js`, `src/apply.js`,
`test/push-planner.test.js`, progress, and checklist files backward.

Owner suggestion: integrators should use candidate-only diffs from each
merge-base or an explicit rebase/cherry-pick. Do not apply
`origin/lane/evidence-integration-20260527..candidate` patches for this queue.

### High — merge-invariant and generated-harness queues collide on shared harness surfaces

`RPP-0221` and `RPP-0222` conflict pairwise in `docs/scenario-matrix.md`,
`scripts/harness/generated-push-cases.js`, `test/generated-push-harness.test.js`,
and `test/push-planner.test.js`. Separately, `RPP-0120` and `RPP-0121` conflict
in the generated harness doc/cases/test trio. These are not independent raw
branch integrations even when each candidate looks isolated against the lane.

Owner suggestion: merge-invariant owner should restack `RPP-0222`/`RPP-0221`
after `RPP-0220`; generated-harness owner should aggregate `RPP-0120`/`RPP-0121`
by case IDs and rerun the focused generated harness test.

### High — plugin-driver code candidates overlap with `RPP-0220` planner changes

`RPP-0427`, `RPP-0431`, and `RPP-0433` all conflict with current lane in either
`src/apply.js`, `src/planner.js`, or `test/push-planner.test.js`. Pairwise,
`RPP-0427` conflicts with `RPP-0431`, `RPP-0431` conflicts with `RPP-0433`, and
`RPP-0433` conflicts with `RPP-0434` in plugin-driver docs/tests. The queue also
mixes local planner support, generated harness support, and plugin-owner guard
proofs.

Owner suggestion: plugin-driver owner should pick one code owner for
`src/apply.js`/`src/planner.js`, restack after `f9df9d1b6`, and keep
production-backed wording out unless a separate production-shaped proof is
added.

### Medium — release-gate candidates need an ordered shared doc update

`RPP-0047` and `RPP-0048` each add one generated gate test and update
`docs/evidence/ao-release-gates.md`. They are individually clean against the
lane, but pairwise conflict in the shared release-gates evidence doc. Both are
synthetic gate coverage; neither changes final release status.

Owner suggestion: release-gate integrator should combine `RPP-0047` and
`RPP-0048` rows in one ordered `ao-release-gates.md` update and keep **NO-GO**
visible next to any synthetic positive gate fixture.

### Medium — graph candidates remain local complex-site support

`RPP-0327` and `RPP-0328` overlap in graph identity docs, local-production proof
script/test, and planner tests. The proof family is useful local complex-site
coverage, but not Docker/external production WordPress evidence.

Owner suggestion: graph owner should aggregate both graph candidates on current
lane and rerun the local-production complex-site proof plus planner test, with
external-production caveats in progress text.

### Low — no candidate Markdown redaction issue found

The candidate Markdown scan covered 13 extracted artifacts from this queue and
reported `ok: true` with 0 rejected files. Continue scanning because several
candidates update public evidence docs that discuss secrets, auth binding, and
plugin-owned data.

## Candidate order recommendation

1. Treat `RPP-0220` as integrated at `f9df9d1b6`; do not reuse stale raw queue
   assumptions from `c3b151b5d`.
2. For a low code-conflict release-gate lane, combine `RPP-0048` then `RPP-0047`
   in one ordered release-gates doc/test update.
3. For merge invariants, restack `RPP-0222` and `RPP-0221` after `RPP-0220`,
   resolving shared generated-harness and scenario-matrix surfaces together.
4. For generated harness, aggregate `RPP-0120` and `RPP-0121` in one case-level
   patch from current lane.
5. Defer plugin-driver code candidates until a single owner reconciles
   `RPP-0427`, `RPP-0431`, `RPP-0433`, and `RPP-0434` after the new planner
   baseline.

## Bottom line

Release remains **NO-GO**. `RPP-0220` landing moved the safe base to
`f9df9d1b6`, so every target candidate needs at least a freshness check before
integration. The cleanest next work is an ordered release-gate doc/test update
or a single generated-harness aggregation; the merge-invariant, graph, and
plugin-driver families need manual conflict resolution before their branch-local
evidence can be counted as integrated.
