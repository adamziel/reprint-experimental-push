# RPP-0584 production apply route, variant 5

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until equivalent apply-route revalidation is checked against production-owned
source and credential inputs.

## Claim

The release verifier carries production apply route evidence through one
summary, and that summary proves apply revalidates the live source after the
apply claim opens and before mutation-capable work. Missing, malformed, stale,
or drifted live-source revalidation evidence remains blocked.

## Proof Surface

`test/rpp-0584-production-apply-route-v5.test.js` adds three focused checks:

- source-level route ordering pins signed authenticated apply, dry-run receipt
  validation, DB-journal apply start, live-source revalidation, mutation setup,
  and mutation executor ordering;
- an accepted generated production-shaped apply path records
  before-mutation live-source revalidation and carries it through exactly one
  hash-only release-verifier summary; and
- missing, malformed, stale, and drifted live-source revalidation evidence stays
  blocked with `releaseMovement.allowed: false`.

The test uses mocked fetch responses and the existing authenticated client route
profile behavior. No listener, public ingress, tunnel, live endpoint, production
credential, raw request body, or network-dependent evidence is used.

## Proven Behavior

- The production-shaped apply route is registered as a signed authenticated
  `POST` route.
- The real PHP path writes apply-started evidence before live-source
  revalidation and calls mutation setup only after revalidation returns.
- The revalidation helper checks source binding before exporting the current
  snapshot, then verifies live snapshot dependencies and preconditions.
- The release-verifier proof carries one `productionApplyRoute` summary with
  hashed accepted-case and negative-case proof identifiers.
- Missing revalidation evidence returns
  `APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED`.
- Malformed revalidation evidence returns
  `APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED`.
- Stale live-source precondition evidence returns `PRECONDITION_FAILED` before
  mutation setup, executor entry, mutation application, or commit.
- Drifted live-source binding evidence returns `AUTH_SOURCE_BINDING_MISMATCH`
  before mutation setup, executor entry, mutation application, or commit.
- Support evidence records route, request, receipt, plan, precondition,
  mutation-set, source-binding, journal-cursor, and case material as hashes or
  counts.
- Raw source URLs, usernames, credentials, sessions, idempotency keys, nonces,
  request bodies, resource paths, resource keys, row values, and journal
  payloads are absent from the verifier summary.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0584-production-apply-route-v5.test.js
node --test --test-name-pattern RPP-0584 test/rpp-0584-production-apply-route-v5.test.js
node --test --test-name-pattern RPP-0564 test/rpp-0564-production-apply-route-v4.test.js
node --test --test-name-pattern RPP-0544 test/rpp-0544-production-apply-route-v3.test.js
node --test test/production-apply-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0584-production-apply-route-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0584 test
reported 3 passes / 0 failures. The adjacent RPP-0564 regression reported 3
passes / 0 failures. The adjacent RPP-0544 regression reported 3 passes / 0
failures. The production apply route regression reported 5 passes / 0 failures.
The scoped artifact redaction scan returned `"ok": true`; both whitespace
checks returned no findings.

## Boundary

This proof is support-only regression evidence. It should be integrated as
additional apply-route verifier coverage, not as release-gating proof. Promotion
still requires equivalent checked evidence from production-owned endpoint and
credential inputs; until then the release posture is **NO-GO**.
