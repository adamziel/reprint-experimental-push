# RPP-0254 already-in-sync decision variant 3 evidence

Date: 2026-05-30
Lane: RPP-0254 already-in-sync decision, variant 3
Checklist item: RPP-0254 — Add generated coverage for already-in-sync decision, variant 3.

## Invariant

Generated fixtures that mark local and remote resources as already synchronized must keep those resources decision-only. Each `already-in-sync` decision must have matching local and remote hashes, differ from the pull base, emit no mutation, emit no live-remote precondition, and stay preserved by apply for ready plans. Non-ready generated plans must still refuse before any remote mutation.

## Evidence added

- Focused generated proof: `test/rpp-0254-already-in-sync-decision-v3.test.js`.
- Test name: `RPP-0254 generated already-in-sync decisions are decision-only across variant 3 coverage`.
- The test cross-checks `summary.targetCoverage.sameIndependentContentVariant3` from the generated harness: 10 ready target cases, one case in each tier 0 through 9.
- It also replays every deterministic generated fixture tagged `already-in-sync`: 79 cases total, with status counts `{ blocked: 8, ready: 71 }` and 232 `already-in-sync` row decisions.
- For every selected decision, the proof asserts matching local/remote hashes, no mutation/precondition overlap, and unchanged resource hashes after ready apply. For blocked fixtures, apply is expected to refuse with `PLAN_NOT_READY` while the remote snapshot hash remains unchanged.

## Redaction proof

The aggregate proof stores only command text, behavior, counts, statuses, plan summaries, resource keys, hashes, refusal codes, and proof hashes. The test collects the generated synchronized row titles and asserts the serialized proof omits those raw values, including the generated shared-title and ready-same-content payload prefixes.

## Commands

```sh
node --check test/rpp-0254-already-in-sync-decision-v3.test.js
node --test --test-name-pattern=RPP-0254 test/rpp-0254-already-in-sync-decision-v3.test.js
node --test --test-name-pattern='already[- ]in[- ]sync|RPP-0214|RPP-0234|RPP-0254' test/push-planner.test.js test/rpp-0234-already-in-sync-decision-v2.test.js test/rpp-0254-already-in-sync-decision-v3.test.js
node --test --test-name-pattern='RPP-0118|RPP-0138|RPP-0158' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0254-already-in-sync-decision-v3.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Caveat: this is deterministic local Node generated-fixture evidence for the RPP-0254 slice. It does not change release verifier routes or production release verdicts; release remains gated by the broader integration evidence flow.
