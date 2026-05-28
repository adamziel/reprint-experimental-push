# AO critic continuation 3 audit — 2026-05-28

Lane: `critic-continuation-3` (`session/rpp-31`)
Role: critic / evidence only
Audit time: 2026-05-28 03:36 CEST
Current default lane audited: `origin/lane/evidence-integration-20260527` at `a19deaf9e` (`feat: add operator proof status marker`)

## Verdict

Final release remains **held**.

The `rpp-28` direct lane push has landed: both `origin/lane/evidence-integration-20260527` and `origin/session/rpp-28` point to `a19deaf9e`. That push cherry-picked the already-pushed `rpp-19`, `rpp-20`, and `rpp-21` work after the earlier `a7062da32` checklist-tracking lane update.

The new lane state is still support/local-candidate evidence, not release movement. `node ./scripts/release/check-release-gates.mjs` exits `1` with `status: held`, `releaseMovement.allowed: false`, `finalGates: 3/20`, `missing: 17`, and primary failure `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`. A full `npm test` on the current lane is still red: `509` tests run, `475` pass, `23` fail, `11` skip.

## Command evidence gathered

| Area | Command / inspection | Result |
| --- | --- | --- |
| Remote lane head | `git fetch --all --prune`; `git log -1 origin/lane/evidence-integration-20260527`; selected `origin/session/rpp-*` heads | `origin/lane/evidence-integration-20260527` and `origin/session/rpp-28` are both `a19deaf9e`. `origin/session/rpp-20`, `rpp-21`, `rpp-23`, `rpp-24`, `rpp-25`, and `rpp-27` are present; `rpp-29` and `rpp-30` are not pushed yet. |
| rpp-28 integration | `tmux capture-pane rpp-28`; `git log --reverse a7062da32..origin/lane/evidence-integration-20260527` | Directly pushed 7 commits: recovery repair, release-gate CLI, protocol compatibility, evidence redaction, protocol fixture alignment, route proof matrix, and operator proof status. Focused validation reported 125 passing tests; no full-suite pass was reported. |
| Release gate state | `node ./scripts/release/check-release-gates.mjs` | Exit `1`; `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `releaseMovement.allowed: false`; `finalGates: 3/20`; `missingCount: 17`. |
| Full node suite | `timeout 180s npm test` | Exit `1`; `509` tests, `475` pass, `23` fail, `11` skip. Failures cluster around authenticated push lifecycle/precedence, preserved-remote retry, recovery-claim identity, snapshot apply gate, production-shaped proof expectations, and plugin/package smoke expectations. |
| Handoff/runtime scratch check | `git diff --name-status 25c667cd4..origin/lane -- .ao .lane-output docs/evidence/ao-supervision-handoff.md`; same from `a7062da32` | No `.ao/`, `.lane-output/`, or protected `docs/evidence/ao-supervision-handoff.md` changes were introduced by the direct lane updates. |
| Progress docs staleness | `grep` for `a19deaf`, `rpp-28`, `rpp-19`, `rpp-20`, `rpp-21` in progress docs and `progress.html` | Current lane progress docs still say the integrated evidence is through `bb6864a07`/03:27 and list `rpp-19` as needing integration and `rpp-20`/`rpp-21` as branch-local. `rpp-26` is visibly preparing an unpushed correction. |
| Checklist state | `grep`/count on `docs/reprint-push-completion-checklist.md` | `81` checked and `919` unchecked. `RPP-0026` through `RPP-0040` remain unchecked despite `rpp-28` stdout saying those items were advanced. |
| Standalone wiring grep | `git grep` for `route-proof-matrix`, `operator-proof-status`, `negotiatePushProtocolCompatibility`, `check-release-gates`, `redactEvidence`, `recovery-repair` | Redaction is wired into `release-gates` and `recovery-journal`. `check:release-gates` is only a package script. Route matrix, operator status, protocol compatibility, and recovery repair remain standalone unless invoked by tests/docs. |
| Checklist linter smoke | `node /.../rpp-25/scripts/release/checklist-completion-lint.mjs --root .` | Exit `0`; `ok: true`; `0` risky claims across `28` scanned files; `81` checked / `919` unchecked. This proves current docs do not trip that linter, not that the linter is release-path enforced. |

## Critical findings

### 1. Release remains held, with exact current reason

The current lane has a release-gate CLI now, and it is correctly fail-closed in this sandbox:

- `ok: false`
- `status: held`
- `scope: final-release`
- `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- `primaryFailureBucket: topology`
- `releaseMovement.allowed: false`
- `finalGates: 3/20`
- `totals: { gates: 20, passed: 3, missing: 17, failed: 0, blocking: 17 }`

The blocking reason is still: `REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.` Missing live source/local/remote-changed URLs and missing production auth/route/recovery/operator evidence are still release blockers.

### 2. rpp-28 direct lane integration landed, but its evidence is focused-only

`rpp-28` pushed `a7062da32..a19deaf9e` directly to the lane and also created `origin/session/rpp-28`. It reported:

- syntax checks on 19 changed JS/MJS files;
- focused `node --test` over 11 selected files with 125 passes;
- `git diff --check` pass;
- no protected handoff diff and no runtime scratch files.

That is useful focused evidence. It is **not** a full-suite green signal. The full `npm test` run in this audit exits `1` with 23 failures. The release status must continue to describe the branch as focused-tested/support-only.

### 3. No stale protected handoff diff, but progress docs are stale after the direct push

The direct lane update did not modify `.ao/`, `.lane-output/`, or `docs/evidence/ao-supervision-handoff.md`. That answers the high-risk handoff question positively: the protected handoff was not overwritten by stale candidate branch content.

However, the public progress surface is stale on the current lane:

- `docs/evidence/ao-progress-report.md` says it summarizes evidence through `bb6864a07`, not `a19deaf9e`.
- It lists `rpp-19` as pushed but not integrated.
- It lists `rpp-20` and `rpp-21` as branch-local until pushed/integrated.
- `progress.html` likewise says integrated evidence is through `bb6864a07` and names rollback/protocol/redaction as still required, even though their support modules have now landed.

This is a reporting consistency issue, not a release-go issue. `rpp-26` is actively editing the progress files on top of `a19deaf9e`; do not treat the stale 03:27 progress pages as current lane truth until that correction lands.

### 4. rpp-20 and rpp-21 are integrated by patch, not by ancestry

`origin/session/rpp-20` and `origin/session/rpp-21` are still separate branch tips, but `git cherry -v origin/lane ...` marks their commits with `-`, meaning equivalent patches are present on the lane as `303866a5d` and `a19deaf9e`. This is expected for cherry-pick integration.

For `rpp-19`, four commits are patch-equivalent and the release-gate CLI commit differs by patch-id because `rpp-28` resolved the `package.json` conflict by keeping the Docker scripts and adding `check:release-gates`. That resolution looks narrow and safe.

### 5. Standalone contracts still do not move release by themselves

Current lane modules that are useful but not release-moving:

- `src/route-proof-matrix.js` is not imported by release gates, the push client, or verifier code.
- `scripts/release/operator-proof-status.mjs` has no package script and is not invoked by `verify:release` or `check:release-gates`.
- `src/protocol-compatibility.js` exports `negotiatePushProtocolCompatibility()`, but no real preflight/dry-run/apply/recovery path calls it.
- `src/recovery-repair.js` is not imported by runtime release paths; only route matrix text names `recovery-repair`.
- `scripts/release/check-release-gates.mjs` is exposed as `npm run check:release-gates`, but `verify:release` does not invoke it and there is still no repo-local CI workflow enforcing it.
- `origin/session/rpp-24` adds release evidence provenance, but it is not integrated and is based before the 12 newest lane commits; merge it only by cherry-pick/patch, never wholesale.
- `origin/session/rpp-25` adds checklist completion lint and is based on the current lane, but it is still a standalone script/test/doc.
- `rpp-29` artifact redaction scanner and `rpp-30` required release checks are active, unpushed, and branch-local.

The one exception is evidence redaction: `src/release-gates.js` now redacts gate evidence and `src/recovery-journal.js` asserts no raw evidence values. That is real wiring, but it still needs compatibility hardening because the full suite is red.

### 6. Redaction/provenance/checklist linter false-positive and process risks

- **Checklist completion linter (`rpp-25`)**: current docs pass with 0 risky claims, but the pattern set treats `passed`, `complete`, `done`, and `release-ready` near unchecked RPP IDs as risky. That can false-positive on legitimate support-evidence wording such as “RPP-00xx focused tests passed” unless authors use one of the cautious phrases. It scans only top-level `docs/evidence/*.md` and `audits/*.md` plus a few progress files, so it is neither universal nor release-enforced.
- **Release evidence provenance (`rpp-24`)**: useful contract, but stale relative to `a19deaf9e`. A two-dot diff from current lane to `rpp-24` shows many apparent deletes because the branch predates the direct integrations; it must not be merged wholesale. Its default 24-hour freshness window may also falsely reject historical evidence if used as a docs linter rather than a release-artifact validator.
- **Integrated evidence redaction (`a29e448f7`)**: improves release-gate/journal safety, but heuristic redaction can over-block benign `value`/`data`/`payload` metadata and under-block secrets hidden under currently safe-looking keys or PII under innocuous names. The full-suite failures mean redaction must not be declared universally safe yet.
- **Artifact redaction scanner (`rpp-29`)**: actively in progress and focused tests were passing in the pane, but it is uncommitted/unpushed on an old base and not available on the lane.

### 7. Full-suite failures are release-relevant

The current full `npm test` failures are not limited to the newly added route/operator tests. The red areas include:

- authenticated push client lifecycle observation recording;
- preserved-remote retry precedence versus durable-journal/auth-session blockers;
- consumed recovery-claim identity preservation;
- durable journal auth-envelope precedence;
- snapshot apply gate expecting unsupported-table behavior but seeing `apply_filters()` missing;
- production-shaped release verifier/auth-session source command expectations;
- production plugin package smoke guard-only expectation;
- production auth/session lifecycle helper expectations;
- retained-source proof summary formatting.

This confirms the rpp-28 evidence is focused-only. Any release report should state that the full node suite remains red until these are fixed or explicitly quarantined with a release rationale.

## Active worker/pane observations

| Lane | State observed | Critic note |
| --- | --- | --- |
| `rpp-24` | Pushed `origin/session/rpp-24` at `0134fc053`; pane idle at prompt. | Provenance validator is useful but stale behind current lane. Cherry-pick only. |
| `rpp-25` | Pushed `origin/session/rpp-25` at `4549c1119`; based on current lane. | Checklist linter passes current docs but remains standalone and may over-flag benign “passed” language. |
| `rpp-26` | Active progress reporter; working tree has modified progress files on top of `a19deaf9e`. | Expected to correct the stale progress/reporting surface. Not pushed at audit time. |
| `rpp-28` | Finished and clean; pushed direct lane and session branch at `a19deaf9e`. | Direct push landed; focused validation only; no handoff/runtime scratch diff. |
| `rpp-29` | Active with uncommitted `artifact-redaction-scan` files; local branch still behind current lane. | Focused scanner tests passed in pane, but work is unpushed and not integrated. |
| `rpp-30` | Active with uncommitted required-release-checks contract files; local branch still behind current lane. | Focused tests/diff check were in progress/passing, but work is unpushed and not integrated. |

## Recommendations

1. Keep final release **NO-GO** until `check:release-gates` can pass with generated final-release artifacts and full/auth-critical tests are green or explicitly quarantined.
2. Land the `rpp-26` progress correction before using progress pages as current operator evidence.
3. Wire standalone contracts into real release movement before marking related RPP variants complete: route matrix into gate evidence, protocol compatibility into real routes, operator proof into release verification, and required checks into `verify:release`/CI-equivalent enforcement.
4. Integrate stale branches (`rpp-24` especially) only by cherry-picking their additive commits from their merge base; never merge old session heads wholesale.
5. Treat redaction/provenance/checklist lint as defense-in-depth until tests cover benign metadata, secret edge cases, historical evidence, and generated release artifacts.
