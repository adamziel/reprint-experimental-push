# RPP-0225 local file type swap versus remote descendant evidence

Date: 2026-05-28; focused refresh: 2026-05-29
Lane: RPP-0225 local file type swap versus remote descendant, variant 2
Checklist item: RPP-0225 — Prove local file type swap versus remote descendant, variant 2.

## Current focused evidence

The current validated RPP-0225 evidence is recorded in
[`rpp-0225-local-file-type-swap-remote-descendant-v2.md`](rpp-0225-local-file-type-swap-remote-descendant-v2.md)
and the focused planner/apply test:

```sh
node --test --test-name-pattern=RPP-0225 test/push-planner.test.js
```

Focused test: `RPP-0225 local file type swap versus remote descendant refuses
before mutation with hash-only evidence`.

## Invariant

A local directory-to-file type swap that would hide or remove a live
remote-created descendant must fail closed as a file topology conflict. The
planner must not emit a mutation or precondition for the unsafe type swap. The
remote descendant remains a `keep-remote` decision, independent local mutation
evidence remains live-remote-preconditioned, and `applyPlan()` refuses the
non-ready plan before durable journal or target mutation.

## Caveat

This retained evidence pointer intentionally claims only the focused local
Node planner/executor proof. Generated harness target additions are out of scope
for the current RPP-0225 refresh. The proof does not edit `progress.html`, does
not publish progress, and does not change the release verdict.
