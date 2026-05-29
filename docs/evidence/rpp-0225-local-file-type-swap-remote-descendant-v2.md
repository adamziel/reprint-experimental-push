# RPP-0225 local file type swap versus remote descendant, variant 2

Date: 2026-05-29
Lane: RPP-0225 local file type swap versus remote descendant, variant 2
Checklist item: RPP-0225 — Prove local file type swap versus remote descendant, variant 2.

## Invariant

A local directory-to-file type swap that would hide or remove a live
remote-created descendant must fail closed as a file topology conflict. The
planner must not emit a mutation or precondition for the unsafe type swap. The
remote descendant must remain a `keep-remote` decision, while any unrelated
local mutation can remain in the evidence only when it has a live-remote
precondition. The executor must reject the non-ready plan before a durable
journal write or target mutation.

## Scenario matrix row

The scenario matrix now names both the behavior and the focused command:

```sh
node --test --test-name-pattern=RPP-0225 test/push-planner.test.js
```

Focused test: `RPP-0225 local file type swap versus remote descendant refuses
before mutation with hash-only evidence`.

## Focused proof

The focused fixture starts from a base directory plus an independent file. The
local snapshot replaces the directory with a file and edits the independent
file. The remote snapshot keeps the directory and creates a private descendant
below it.

Assertions prove:

- plan status is `conflict` with one independent mutation, one `keep-remote`
  descendant decision, and one `file-topology-conflict`;
- no mutation or precondition is emitted for the unsafe directory-to-file type
  swap;
- no mutation or precondition is emitted for the remote descendant;
- the independent file mutation remains paired with a live-remote precondition;
- `applyPlan()` raises `PLAN_NOT_READY`, records no durable journal events, and
  leaves the base directory, remote descendant, and independent file unchanged;
  and
- serialized plan, conflict, decision, refusal, and journal evidence omit the
  private local replacement file value, private independent file value, and
  private remote descendant value.

## Validation commands

```sh
node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0225 test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0225-local-file-type-swap-remote-descendant-v2.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md docs/progress-log.md
git diff --check
```

Caveat: this is local Node planner/executor evidence for the RPP-0225 slice. It
does not edit `progress.html`, does not publish progress, and does not change
the release verdict.
