# RPP-0544 production apply route, variant 3

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same apply-route revalidation proof is checked against
production-owned URL and credential inputs.

## Claim

The production-shaped apply route must revalidate the live source after the
apply claim is opened and before any mutation executor work. The generated
receipt must be hash-only and must not expose live credentials, secrets, or
source URLs.

## Proof Surface

`test/rpp-0544-production-apply-route-v3.test.js` adds three generated checks:

- source-level route ordering pins signed authenticated apply, dry-run receipt
  validation, DB-journal `apply-started`, live-source revalidation, and mutation
  executor ordering;
- a mocked production-shaped `POST /wp-json/reprint/v1/push/apply` receipt is
  accepted as `generated-apply-route-revalidation-receipt` support evidence only
  when `phase: before-first-mutation` and `checkedAgainst: live-remote` occur
  before `mutation-applied`; and
- missing, post-mutation, or under-verified revalidation receipts remain blocked
  before release movement.

The test uses mocked fetch responses and the existing authenticated client route
profile behavior. No listener, tunnel, public ingress, live credential, or live
URL is used.

## Proven Behavior

- The production-shaped apply route is registered as a signed authenticated
  `POST` route.
- The real PHP apply path writes `apply-started` before calling live-source
  revalidation, and calls the mutation executor only after revalidation.
- The revalidation helper exports the current live source, checks source
  binding, verifies fixture dependencies and preconditions, and records
  `snapshotHash`, source hash evidence, and DB-journal cursor evidence.
- The generated receipt proves `live-source-revalidated` occurs after
  `apply-started` and before `mutation-applied`.
- Source, credential, user, session, idempotency, request, plan, receipt,
  precondition, mutation-set, source-binding, and journal-cursor values are
  represented by SHA-256 hashes or counts.
- Raw source URL, credential, session, idempotency, resource path, and resource
  key values are absent from the support summary.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0544-production-apply-route-v3.test.js
node --test --test-name-pattern RPP-0544 test/rpp-0544-production-apply-route-v3.test.js
node --test test/production-apply-route.test.js test/release-gate-apply-route-pre-mutation-generated.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0544-production-apply-route-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0544 test
reported 3 passes / 0 failures. The adjacent production apply route and
release-gate generated apply-route tests reported 7 passes / 0 failures. The
scoped artifact redaction scan returned `"ok": true`; both whitespace checks
returned no findings.

## Boundary

This proof does not claim production durability or release readiness. Promotion
requires the same apply-route revalidation evidence from a checked
production-owned endpoint with valid production credentials; until then the
release posture is **NO-GO**.
