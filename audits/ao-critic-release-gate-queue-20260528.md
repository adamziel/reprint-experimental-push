# AO critic release-gate queue audit — 2026-05-28

Snapshot time: 2026-05-28 06:06 CEST
Critic branch: `session/rpp-37`
Audited integration lane: `origin/lane/evidence-integration-20260527` at `3bd9dc676` (`docs: refresh progress for verify release failure proof`)
Initial requested baseline: `3081bfab1`; `RPP-0040` finished integration during this refill.
Observed checklist state: 109 checked / 891 open
Release posture: **NO-GO**

## Scope

This pass reviewed release-gate queue integration risk around `RPP-0040` through
`RPP-0044`, with special attention to shared edits in
`docs/evidence/ao-release-gates.md`, stale branch bases, validation gaps, and
wording that could overstate final release readiness.

## Command evidence

| Check | Result |
| --- | --- |
| `git fetch origin --prune`; selected `git rev-parse` / `git log` | Lane advanced from `3081bfab1` to `3bd9dc676`; `RPP-0040` is now integrated. |
| `git merge-tree --write-tree --messages origin/lane/evidence-integration-20260527 <candidate>` | `RPP-0041`, `RPP-0042`, and `RPP-0043` conflict in `docs/evidence/ao-release-gates.md` after `RPP-0040`; `RPP-0044` local candidate is clean from the current lane. |
| `git diff origin/lane/evidence-integration-20260527..<candidate> | git apply --check --index` | Applies cleanly for stale `RPP-0041`/`RPP-0042`/`RPP-0043`, but the patch view would delete/revert `RPP-0040` files and progress/checklist movement; do not use this as an integration method. |
| Extracted candidate `docs/evidence/ao-release-gates.md` copies scanned with `artifact-redaction-scan` | `ok: true`, 0 rejected files across `RPP-0040` through pushed `RPP-0044` docs. |
| Current-tree required checks after writing this audit | Checklist lint `ok: true`, 109 checked / 891 open, 0 risky claims; artifact redaction `ok: true`, 0 rejected files; `git diff --check` clean. |

## Candidate status table

| Item | Candidate ref observed | Base / status after `3bd9dc676` | Critic disposition |
| --- | --- | --- | --- |
| `RPP-0040` verify release failure reason | Integrated via `origin/session/rpp-28-rpp-0040-integration-20260528` at `3bd9dc676`; raw worker ref `origin/session/rpp-25-rpp-0040-verify-release-failure-reason` remains at `337f6b34f` | Raw worker ref is now behind by 4 and should be treated as superseded. | Do not integrate raw `rpp-25` ref again. Keep release wording explicit: this is held-failure evidence, not a release pass. |
| `RPP-0041` generated source URL gate | `origin/session/rpp-25-rpp-0041-source-url-gate-coverage` `746390195` | Merge-base `a195ac53a`, ahead 1 / behind 4; 3-way conflict in `docs/evidence/ao-release-gates.md`. | Rebase/restack on `3bd9dc676`; preserve `RPP-0040` rows and counts. |
| `RPP-0042` generated local URL gate | `origin/session/rpp-25-rpp-0042-local-url-gate-coverage` `50a4f74b1` | Merge-base `a195ac53a`, ahead 1 / behind 4; same doc conflict. | Rebase/restack; rerun combined release-gate tests after resolving doc table. |
| `RPP-0043` generated remote-changed URL gate | `origin/session/rpp-25-rpp-0043-remote-changed-url-gate-coverage` `bd7eddedb` | Merge-base `3081bfab1`, ahead 1 / behind 2; same doc conflict after `RPP-0040`. | Rebase/restack; ensure no `RPP-0040` proof files disappear. |
| `RPP-0044` generated packaged fallback rejection | `origin/session/rpp-25-rpp-0044-packaged-fallback-rejection` `872148a91` | Base `3bd9dc676`, ahead 1 / behind 0; merge-tree clean; pushed session ref observed before commit. | Strongest next release-gate candidate if pushed cleanly; still needs normal integration validation and cautious NO-GO wording. |

## Findings

### High — `RPP-0041` through `RPP-0043` conflict in `ao-release-gates.md` after `RPP-0040`

A real 3-way merge against current lane reports content conflicts in
`docs/evidence/ao-release-gates.md` for `RPP-0041`, `RPP-0042`, and `RPP-0043`.
The conflict starts at the `Primary checklist range` line: current lane names
`RPP-0040`, while each queued branch names only its own new item. The merged
conflict output also shows separate rows for `RPP-0040` and the queued item,
which must be reconciled into one ordered, append-only release-gates evidence
section.

Owner suggestion: next integrator should rebase each queued release-gate branch
onto `3bd9dc676`, manually combine the primary checklist range and the RPP rows,
and rerun the full combined release-gate focused command after resolution.

### High — lane-to-candidate patch views are dangerous even when `git apply --check` passes

For stale `RPP-0041`/`RPP-0042`/`RPP-0043`, the diff from current lane to the
candidate applies cleanly, but it would revert current-lane truth: it shows
progress/checklist/report files moving backward, `test/verify-release-failure-reason.test.js`
being deleted, `src/release-gates.js` and
`scripts/playground/production-shaped-live-release-verify.mjs` losing `RPP-0040`
changes, and `test/push-planner.test.js` losing the integrated `RPP-0215` work.

Owner suggestion: integrator must use candidate-only changes from each branch's
merge-base or a true cherry-pick/rebase. Do not apply `origin/lane..candidate`
patches for this queue.

### Medium — `RPP-0040` gate evidence still has an enforcement gap

`RPP-0040` tests prove the missing-source `npm run verify:release` path exits
`1`, emits `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`, and feeds exact evidence into the release-gate CLI.
However, the evaluator now records `mutationAttempted` and `statusMarker` but
still passes the `verify-release-failure-reason` gate when final evidence has a
nonzero exit and reason, even if the status marker is missing or
`mutationAttempted` is true. The specific test covers the happy held path, not a
negative forged-evidence path.

Owner suggestion: release-gate owner should add a focused negative test proving
`verifyReleaseFailure` evidence fails when `mutationAttempted: true` or the
final bracketed marker is absent/malformed.

### Medium — `releaseMovement.allowed: true` and `release-ready` markers need strict NO-GO framing

Several candidate tests intentionally supply synthetic complete final evidence
and then rely on provenance gates to keep `releaseStatus: "NO-GO"`. This is true
for `RPP-0040` and the positive `RPP-0044` packaged-fallback scenario. The
reports can still contain `releaseMovement.allowed: true`, `finalGates: "20/20"`,
or `[release-gates-ci:release-ready ...]` while the process exits nonzero with
`PRODUCTION_EVIDENCE_REQUIRED`.

Owner suggestion: progress/report surfaces and `ao-release-gates.md` updates
must always put `releaseStatus: NO-GO` / `PRODUCTION_EVIDENCE_REQUIRED` next to
any synthetic `20/20` or `release-ready` marker. Do not summarize these as final
release readiness.

### Medium — `RPP-0041` and `RPP-0042` are stale across two integration waves

`RPP-0041` and `RPP-0042` were authored on `a195ac53a`, before both `RPP-0215`
and `RPP-0040` landed. Their code/test diffs are small, but their branch-local
docs and focused command counts do not include the integrated `RPP-0040` proof.

Owner suggestion: restack `RPP-0041` and `RPP-0042` from current lane and rerun
at least the new generated test plus `test/verify-release-failure-reason.test.js`,
`test/progress-html-release-timestamp.test.js`, `test/release-gates-status-row.test.js`,
`test/release-gates.test.js`, and `test/release-gate-cli.test.js` together.

### Low — no redaction issue found in release-gate queue docs

The extracted candidate copies of `docs/evidence/ao-release-gates.md` for
`RPP-0040` through pushed `RPP-0044` reported artifact redaction `ok: true`
with 0 rejected files. The generated tests contain placeholder URLs and a fake
credential string; keep those out of published artifacts and continue scanning
Markdown/HTML/JSON evidence before integration.

## Bottom line

Release remains **NO-GO**. `RPP-0040` is integrated on the lane, making
`3bd9dc676` the base for release-gate queue work. The safest next candidate is
current-base `RPP-0044` at pushed ref `872148a91`; `RPP-0041`
through `RPP-0043` need rebase/restack because their shared release-gates doc
conflicts with `RPP-0040` and lane-to-candidate patches can silently revert
current integrated proof.
