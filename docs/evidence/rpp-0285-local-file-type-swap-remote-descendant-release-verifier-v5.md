# RPP-0285 local file type swap versus remote descendant release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0285 local file type swap versus remote descendant release-verifier carry-through, variant 5
Checklist item: RPP-0285 — Carry through the release verifier for local file type
swap versus remote descendant, variant 5.

## Scope

This adds focused local release-verifier evidence for the merge invariant where
a local push replaces a pull-base directory with a regular file while the live
remote created a descendant below that directory.

The proof is support-only. It is not production-backed and does not change the
release posture: the release gate remains NO-GO without separate live
production-backed evidence.

## Proof surface

`test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js`
verifies that the release-verifier proof:

- builds a `conflict` plan for the unsafe local directory-to-file swap;
- classifies the unsafe swap as `file-topology-conflict`;
- emits no mutation or live remote precondition for the unsafe swap;
- records the live remote descendant as `keep-remote`, with no mutation or
  precondition;
- keeps an unrelated local file mutation live-preconditioned for audit
  evidence;
- refuses apply with `PLAN_NOT_READY` before durable journal writes or mutation
  hooks; and
- keeps all serialized proof evidence hash-only, with raw file payloads absent.

Focused command:

```sh
node --test test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js
```

Caveat: focused local release-verifier evidence only; release remains gated
separately.

## Focused verification observed locally

```sh
node --check test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js
node --test test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0205|RPP-0225|RPP-0265|RPP-0285|file type swap' test/push-planner.test.js test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0285
test reported 2 subtests ok, 0 failed. The adjacent file-type-swap family slice
covered the prior RPP-0205, RPP-0225, and RPP-0265 variants plus the RPP-0285
release-verifier proof with zero failures. The scoped artifact redaction scan
returned `"ok": true`.

## Release posture

This is local focused release-verifier evidence only. The emitted proof is
support-only and productionBacked `false`; release remains NO-GO until separate
live production-backed evidence satisfies the broader release boundary.
