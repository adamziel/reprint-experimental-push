# RPP-0203 local delete versus remote edit evidence

Date: 2026-05-29
Lane: RPP-0203 local delete versus remote edit, variant 1
Checklist item: RPP-0203 — Implement local delete versus remote edit, variant 1.

## Invariant

A local delete of a row that was edited on the remote after the pull base must fail closed as a conflict. The planner must not emit a mutation or live-remote precondition for that row, and apply must refuse the non-ready plan before any independent mutation, durable journal write, or remote overwrite can occur.

## Evidence added

- Focused planner/apply test: `RPP-0203 local delete versus remote edit refuses before remote overwrite with redacted evidence`.
- The fixture combines a local row delete, remote row edit, and independent local file edit so the conflict path proves the whole plan is refused before even unrelated mutations are applied.
- The conflicted row has no mutation and no precondition; the independent file mutation remains live-remote-preconditioned as hash-only audit evidence.

## Redaction and refusal proof

The test uses private base row values, a private independent local file payload, and private remote row edits. It serializes hash-only plan evidence, redacted full-plan evidence, and refusal evidence, then asserts none of those serialized envelopes include the private raw values.

Applying the conflict plan raises `PLAN_NOT_READY`, writes no durable journal events, keeps the remote row edit intact, and leaves the independent file target at its remote pre-apply value. No planner or apply source changes were required for this variant; existing conflict/refusal behavior already satisfies the invariant.

## Commands

```sh
node --check test/push-planner.test.js
node --test --test-name-pattern='RPP-0203|RPP-0223' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0203-local-delete-remote-edit.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0203 slice. It does not edit checklist or progress state and does not change the release verdict; release remains gated by the integration/release evidence flow.
