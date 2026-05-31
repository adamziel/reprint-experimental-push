# RPP-0564 production apply route, variant 4

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until equivalent before-mutation apply-route revalidation is checked against
production-owned URL and credential inputs.

## Claim

The production-shaped apply route revalidates the live source after the apply
claim is opened and before mutation setup. Drifted live-source binding evidence
and stale live-source precondition evidence are rejected before any
mutation-capable work starts.

## Proof Surface

`test/rpp-0564-production-apply-route-v4.test.js` adds three focused checks:

- source-level route ordering pins signed authenticated apply, dry-run receipt
  validation, DB-journal apply start, live-source revalidation, mutation setup,
  and mutation executor ordering;
- an accepted generated production-shaped apply path records
  `phase: before-first-mutation` and `checkedAgainst: live-remote` before
  mutation setup, then emits only hashed support evidence; and
- drifted source binding and stale live-source precondition cases fail closed
  with no mutation setup, no mutation executor entry, no mutation application,
  and no release movement.

The test uses mocked fetch responses and the existing authenticated client route
profile behavior. No listener, public ingress, tunnel, live endpoint,
production credential, raw request body, or network-dependent evidence is used.

## Proven Behavior

- The apply route is registered as a signed authenticated production-shaped
  `POST` route.
- The real PHP path writes apply-started evidence before live-source
  revalidation and calls mutation setup only after revalidation returns.
- The revalidation helper checks source binding before exporting the current
  snapshot, then verifies the live snapshot dependencies and preconditions.
- Source binding drift returns `AUTH_SOURCE_BINDING_MISMATCH` before mutation
  setup.
- Stale live-source precondition evidence returns `PRECONDITION_FAILED` before
  mutation setup.
- Accepted support evidence records source, credential, session, idempotency,
  request, route, plan, receipt, precondition, mutation-set, source-binding,
  resource-key, rejected-resource, and journal-cursor material as SHA-256 hashes
  or counts.
- Raw source URLs, credentials, usernames, sessions, signing keys, idempotency
  keys, nonces, request bodies, resource paths, row values, and journal payloads
  are absent from the support summary.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0564-production-apply-route-v4.test.js
node --test --test-name-pattern RPP-0564 test/rpp-0564-production-apply-route-v4.test.js
node --test --test-name-pattern RPP-0544 test/rpp-0544-production-apply-route-v3.test.js
node --test test/production-apply-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0564-production-apply-route-v4.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0564 test
reported 3 passes / 0 failures. The adjacent RPP-0544 regression reported 3
passes / 0 failures. The production apply route regression reported 5 passes /
0 failures. The scoped artifact redaction scan returned `"ok": true`; both
whitespace checks returned no findings.

## Boundary

This proof is support-only regression evidence. It should be integrated as
additional apply-route coverage, not as release-gating proof. Promotion still
requires equivalent checked evidence from production-owned endpoint and
credential inputs; until then the release posture is **NO-GO**.
