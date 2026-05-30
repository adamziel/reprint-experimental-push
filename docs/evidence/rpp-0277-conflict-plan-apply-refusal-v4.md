# RPP-0277 conflict plan apply refusal, variant 4

Date: 2026-05-30
Checklist item: RPP-0277 — Add focused regression coverage for conflict plan apply refusal, variant 4.

## Scope

This slice adds focused local Node coverage for conflict-plan apply refusal. It
also closes a narrow executor gap found by the regression: a forged ready plan
could strip conflict records and replay the conflict's hash-only `change`
evidence as a mutation.

## Invariant

A conflict plan must never apply or stage mutations. Even if the plan includes a
valid independent local mutation, the executor must reject:

- the original `conflict` plan with `PLAN_NOT_READY`;
- a forged ready plan that turns the conflicted row into a mutation while
  retaining `remoteChange: "update"` evidence; and
- a stale replay of the independent mutation after the live remote changed.

The new ready-plan invariant rejects mutation entries whose `change.remoteChange`
is present and not `unchanged`, returning `PLAN_INVARIANT_VIOLATION` with
`MUTATION_REMOTE_CHANGE_NOT_UNCHANGED` before mutation.

## Evidence added

- Focused regression: `test/rpp-0277-conflict-plan-apply-refusal-v4.test.js`.
- The fixture creates one independent local file mutation and one divergent
  local/remote `wp_posts` row conflict.
- The proof asserts the conflicting resource emits no mutation and no
  precondition, while the independent mutation has exactly one live-remote
  precondition.
- The forged path injects a row mutation from the conflict evidence. The
  executor rejects before mutation, preserves the remote row, and writes no
  durable journal events.
- The stale path converts only the independent mutation to a ready plan, drifts
  that live remote file, and receives `PRECONDITION_FAILED` before mutation.
- Serialized evidence stores only resource keys, summary counts, hashes,
  refusal codes, issue codes, and unchanged remote hashes; private fixture
  strings are asserted absent.

## Validation commands

```sh
node --check src/apply.js
node --check test/rpp-0277-conflict-plan-apply-refusal-v4.test.js
node --test test/rpp-0277-conflict-plan-apply-refusal-v4.test.js
node --test --test-name-pattern='RPP-0217|RPP-0237|RPP-0257' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0277-conflict-plan-apply-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is focused local planner/apply coverage. Full release readiness
remains governed by the broader release and integration evidence.
