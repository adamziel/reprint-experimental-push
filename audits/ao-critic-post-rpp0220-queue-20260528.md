# AO critic post-RPP-0220 queue audit — 2026-05-28

Snapshot time: 2026-05-28 06:40 CEST
Critic branch: `session/rpp-37`
Audited integration lane: `origin/lane/evidence-integration-20260527` at `f9df9d1b6` (`docs: refresh progress for atomic blocker propagation`)
Observed checklist state: 114 checked / 886 open
Release posture: **NO-GO**

## Scope

This pass reviewed the queue after `RPP-0220` landed and while `RPP-0431`
integration was active in `rpp-28`. Target candidates were `RPP-0047`,
`RPP-0048`, `RPP-0049`, `RPP-0120`, `RPP-0121`, `RPP-0122`, `RPP-0123`,
`RPP-0221`, `RPP-0222`, `RPP-0328`, `RPP-0431`, `RPP-0433`, `RPP-0434`,
`RPP-0435`, and `RPP-0436`. The critic lens was stale-base reversions,
touched-file overlaps, redaction/overclaim risk, and local-vs-production
caveats.

## Command evidence

| Check | Result |
| --- | --- |
| `git fetch origin --prune`; `git rev-parse --short origin/lane/evidence-integration-20260527` | Latest lane is `f9df9d1b6`; checklist lint reports 114 checked / 886 open. |
| Active `rpp-28` inspection | `session/rpp-28-rpp-0431-integration-20260528` advanced locally to `85682de19`, one commit ahead of lane, touching `src/apply.js`, `src/planner.js`, and `test/push-planner.test.js`; no lane movement observed. |
| Candidate probe: merge-base, candidate-only diff, `git merge-tree`, and lane-to-candidate diff for target refs | Release-gate and generated-harness candidates are individually clean but stale; merge-invariant, graph, and plugin-driver candidates conflict with current lane in planner/code tests. |
| Pairwise `git merge-tree` probes by family | Release-gate candidates conflict in `ao-release-gates.md`; generated-harness candidates conflict in harness doc/cases/test; `RPP-0221`/`RPP-0222` conflict in scenario/harness/planner surfaces; plugin-driver candidates conflict around `src/apply.js`, `src/planner.js`, plugin docs/tests, and planner tests. |
| Candidate Markdown redaction scan | `ok: true`, 16 scanned files, 0 rejected files across target candidate docs. |
| Current-tree required checks after writing this audit | Checklist lint `ok: true`, artifact redaction `ok: true`, and `git diff --check` clean. |

## Candidate status table

| Item | Candidate ref observed | Base/status after `f9df9d1b6` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0431` plugin uninstall/delete refusal | Active local integration `session/rpp-28-rpp-0431-integration-20260528` `85682de19`; raw worker `origin/session/rpp-34-rpp-0431-plugin-uninstall-delete-refusal` `18e77c437` | Active integration is ahead 1 / behind 0 and merge-tree clean; raw worker is behind 6 and conflicts in `src/apply.js`, `src/planner.js`, and `test/push-planner.test.js`. | Do not count until lane or a pushed integration ref moves. Follow-on plugin-driver refs should restack on the active integration if it lands. |
| `RPP-0047` missing production secret gate | `origin/session/rpp-25-rpp-0047-missing-production-secret-gate` `7cba3cb9d` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; release-gates doc plus generated gate test; individual merge-tree clean. | Rebase from current lane; combine with adjacent gate doc rows. Synthetic gate evidence only; release remains **NO-GO**. |
| `RPP-0048` Application Password credential binding | `origin/session/rpp-25-rpp-0048-application-password-credential-binding` `f36a3de64` | Merge-base `c3b151b5d`, ahead 1 / behind 2; release-gates doc plus generated gate test; individual merge-tree clean. | Fresher than `RPP-0047`; still conflicts pairwise in `ao-release-gates.md`. |
| `RPP-0049` manage_options capability proof | `origin/session/rpp-25-rpp-0049-manage-options-capability-proof` `5d8674b36` | Merge-base `c3b151b5d`, ahead 1 / behind 2; release-gates doc plus generated gate test; individual merge-tree clean. | Same shared-doc collision as `RPP-0047`/`RPP-0048`; keep final release **NO-GO** wording. |
| `RPP-0120` large ready plan tier | `origin/session/rpp-24-rpp-0120-large-ready-plan-tier` `cea7948cf` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; generated harness doc/cases/test; individual merge-tree clean. | Aggregate with `RPP-0121` through `RPP-0123`, not a raw sequential merge. |
| `RPP-0121` file CUD mix | `origin/session/rpp-24-rpp-0121-file-cud-mix-v2` `dc2796a7f` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; same generated harness surfaces. | Pairwise conflicts with neighboring generated-harness candidates. |
| `RPP-0122` directory descendant conflict | `origin/session/rpp-33-rpp-0122-directory-descendant-conflict` `10ad90c6d` | Merge-base `c3b151b5d`, ahead 1 / behind 2; same generated harness surfaces. | Fresher but still conflicts pairwise with `RPP-0121`/`RPP-0123`. |
| `RPP-0123` file type-swap conflict | `origin/session/rpp-24-rpp-0123-file-type-swap-conflict-v2` `07d1c559c` | Merge-base `c3b151b5d`, ahead 1 / behind 2; same generated harness surfaces. | Needs the same case-level aggregation pass. |
| `RPP-0221` independent local file plus remote row edit | `origin/session/rpp-29-rpp-0221-independent-file-remote-row-edit` `d8173cb7d` | Merge-base `3d4a985dd`, ahead 1 / behind 6; scenario matrix, generated harness files, planner test, and evidence doc; conflicts with lane in `test/push-planner.test.js`. | Restack after `RPP-0220`; reconcile with `RPP-0222` manually. |
| `RPP-0222` independent local row plus remote file edit | `origin/session/rpp-29-rpp-0222-independent-row-remote-file-edit` `6749810f7` | Merge-base `6cdf3ab18`, ahead 1 / behind 4; same family of files as `RPP-0221`; conflicts with lane in planner test. | Slightly fresher but pairwise-conflicting with `RPP-0221`. |
| `RPP-0328` commentmeta comment reference | `origin/session/rpp-30-rpp-0328-commentmeta-comment-reference` `4244058f4` | Merge-base `c3b151b5d`, ahead 1 / behind 2; graph doc, local-production proof script/test, planner test; conflicts with lane in planner test. | Local complex-site support only; also conflicts with active `RPP-0329` graph work on the same proof surfaces. |
| `RPP-0433` stale plugin file refusal | `origin/session/rpp-32-rpp-0433-stale-plugin-file-refusal` `feb3a80d3` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc, `src/planner.js`, plugin-owner test; conflicts with lane in `src/planner.js`. | Restack after the active `RPP-0431` decision; conflicts with `RPP-0434`/`RPP-0435`. |
| `RPP-0434` stale metadata refusal | `origin/session/rpp-34-rpp-0434-stale-metadata-refusal` `ad37f13f3` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc plus plugin-owner test; individual merge-tree clean. | Lowest current code-conflict risk, but pairwise conflicts in docs/tests with other plugin-driver refs. |
| `RPP-0435` remote plugin removal refusal | `origin/session/rpp-32-rpp-0435-remote-plugin-removal-refusal` `33f84cc86` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc, `src/planner.js`, plugin-owner test, planner test; conflicts with lane in `src/planner.js` and planner test. | Not safe raw; overlaps active `RPP-0431` in planner surfaces. |
| `RPP-0436` driver delete support flag | `origin/session/rpp-34-rpp-0436-driver-delete-support-flag` `656389b11` | Merge-base `c3b151b5d`, ahead 1 / behind 2; plugin-driver doc, `src/apply.js`, `src/planner.js`, planner test; conflicts with lane in `src/planner.js` and planner test. | High overlap with active `RPP-0431`; defer or restack after it lands. |

## Findings

### High — active `RPP-0431` is branch-local and changes the follow-on plugin-driver base

The active `rpp-28` integration branch has a clean current-lane `RPP-0431`
patch at `85682de19`, but `origin/lane/evidence-integration-20260527` still
points at `f9df9d1b6` at this snapshot. Follow-on plugin-driver candidates are
not safe to integrate against the old base: active `RPP-0431` conflicts with
`RPP-0433` in `src/planner.js`, with `RPP-0435` in `src/planner.js` and
`test/push-planner.test.js`, and with `RPP-0436` in `src/apply.js`,
`src/planner.js`, and planner tests.

Owner suggestion: plugin-driver owner should wait for the `RPP-0431` lane
outcome, then restack `RPP-0433`/`RPP-0435`/`RPP-0436` from that exact lane. Do
not count active integration evidence before the lane moves.

### High — stale candidate patch views would delete current `RPP-0220` evidence

Every target candidate based before `f9df9d1b6` shows the new
`docs/evidence/rpp-0220-atomic-group-blocker-propagation.md` being deleted in a
lane-to-candidate diff. Older refs also drop `RPP-0219` and sometimes
`RPP-0218` evidence, while moving planner/apply/progress files backward. This is
especially dangerous for `RPP-0221`, `RPP-0222`, generated-harness refs, graph
refs, and stale plugin-driver refs.

Owner suggestion: integrators must use candidate-only diffs from each
merge-base or true rebases/cherry-picks. Do not apply
`origin/lane/evidence-integration-20260527..candidate` patches.

### High — generated-harness rows `RPP-0120` through `RPP-0123` conflict as a group

`RPP-0120`, `RPP-0121`, `RPP-0122`, and `RPP-0123` all edit the same three
surfaces: `docs/generated-push-harness.md`,
`scripts/harness/generated-push-cases.js`, and
`test/generated-push-harness.test.js`. Pairwise probes reported `changed in
both` across sampled adjacent and cross pairs. Individual lane merges being
clean does not mean sequential integration will preserve all case counts.

Owner suggestion: generated-harness owner should rebuild all four case groups
from current lane, sort/namespace by target, and rerun the focused generated
harness test plus checklist lint.

### High — merge-invariant follow-ons still conflict after `RPP-0220`

`RPP-0221` and `RPP-0222` both conflict with the current lane in
`test/push-planner.test.js`, and pairwise conflict in scenario matrix,
generated-harness cases/tests, and planner assertions. They also predate the
new blocker-propagation evidence in `RPP-0220`.

Owner suggestion: merge-invariant owner should restack both together after
`f9df9d1b6`, preserving the `RPP-0220` blocker propagation rules while merging
the independent row/file cases.

### Medium — release-gate candidates share one evidence document and are synthetic support only

`RPP-0047`, `RPP-0048`, and `RPP-0049` each add one generated gate test and edit
`docs/evidence/ao-release-gates.md`. All pairwise combinations conflict in that
shared doc. These are generated gate scenarios, not final production evidence,
and final release stays **NO-GO**.

Owner suggestion: release-gate owner should combine the three rows in one
ordered `ao-release-gates.md` update and place **NO-GO** beside any synthetic
positive fixture language.

### Medium — graph `RPP-0328` is local complex-site support and overlaps active graph work

`RPP-0328` edits graph identity docs, the local-production complex-site proof
script, its test, and planner tests. It conflicts with the current lane in
planner tests and also conflicts with active `RPP-0329` local work across the
same graph/proof surfaces. The evidence is useful local complex-site support,
not Docker/external production WordPress proof.

Owner suggestion: graph owner should integrate graph rows in one current-lane
aggregation and keep external-production caveats in progress/reporting surfaces.

### Low — no redaction issue found in target Markdown artifacts

The candidate Markdown redaction scan covered 16 extracted artifacts and
reported `ok: true` with 0 rejected files. Continue scanning because this queue
includes auth/secret release gates and plugin-owned data evidence.

## Candidate order recommendation

1. Let `RPP-0431` finish or be skipped first; its active integration changes the
   plugin-driver code baseline.
2. If release-gate work is chosen next, aggregate `RPP-0047`/`RPP-0048`/`RPP-0049`
   in one ordered doc/test patch from current lane.
3. Aggregate `RPP-0120` through `RPP-0123` together rather than raw sequential
   merges.
4. Restack `RPP-0221`/`RPP-0222` together after `RPP-0220` planner changes.
5. Defer `RPP-0433`/`RPP-0435`/`RPP-0436` until the `RPP-0431` lane outcome is
   known; `RPP-0434` is individually cleaner but still shares docs/tests with
   the same plugin-driver family.

## Bottom line

Release remains **NO-GO**. The current safe base is `f9df9d1b6`, but active
`RPP-0431` work is branch-local and must not be counted as integrated yet. The
next queue has multiple tempting individually clean branches, yet every family
has shared-file collisions or stale-base rollback risk that requires deliberate
restacking and wording discipline.
