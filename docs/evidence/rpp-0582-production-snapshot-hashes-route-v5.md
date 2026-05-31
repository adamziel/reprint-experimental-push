# RPP-0582 production snapshot hashes route, variant 5

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same route proof is checked against production-owned URL
and credential inputs.

## Claim

The release verifier carries exactly one production snapshot-hashes route
summary for this slice. Negative auth, signature, and session cases fail before
JSON parsing, snapshot-hash work, or mutation-capable work. Accepted support
evidence remains planning-only, read-only, support-only, and hash-only.

## Proof Surface

The focused regression adds four local checks:

- source-order assertions keep authenticated permission and signed-request
  verification before payload parsing on the production-shaped route;
- malformed-body negative cases cover missing auth, wrong auth, missing signed
  headers, missing session, content-hash mismatch, auth-signature mismatch,
  push-signature mismatch, and invalid session;
- a positive signed support path wraps the accepted route receipt and the
  negative-auth aggregate into one verify-release-shaped summary; and
- missing or malformed route evidence blocks release movement before any
  release-eligible state is claimed.

No listener, tunnel, public ingress, live endpoint, production credential, or
network-dependent evidence was used.

## Proven Behavior

- The release-verifier-shaped summary contains one
  `productionSnapshotHashesRoute` block and one route-evidence block for the
  snapshot-hashes proof.
- Negative cases return auth, signature, or session failure codes before JSON
  parsing. The malformed payload would fail if parsed, but the proof records
  zero JSON parse attempts.
- Negative cases record zero snapshot-hash work attempts and zero
  mutation-capable work attempts.
- Negative responses emit no snapshot hash, snapshot hash set, coverage,
  resources, page hash, or snapshot-hashes receipt evidence.
- Accepted support evidence is tagged support-only and `NO-GO`;
  `releaseMovement.allowed` remains false.
- Accepted support evidence proves planning-only read behavior and records zero
  mutation-capable work attempts.
- Missing route evidence returns `SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED`.
- Malformed route evidence returns `SNAPSHOT_HASH_ROUTE_PROOF_MALFORMED`.
- Source, credential, identity, session, signing key, idempotency, route,
  execution phase, snapshot, coverage, page, receipt, and negative-auth
  aggregates are represented by hashes, booleans, counts, or lengths only.
- Raw credential material, user names, source locations, session values,
  signing material, idempotency values, nonces, request bodies, row values,
  journal payloads, and secrets are absent from support summaries.

## Validation

Observed local validation results:

- focused syntax check: exit 0;
- focused RPP-0582 regression: 4 passes / 0 failures;
- adjacent RPP-0562 regression: 3 passes / 0 failures;
- adjacent RPP-0542 regression: 3 passes / 0 failures;
- shared production snapshot-hashes route regression: 7 passes / 0 failures;
- scoped artifact redaction scan: `"ok": true`;
- unstaged whitespace check: no findings;
- staged whitespace check: no findings.

## Boundary

This is support-only regression evidence. It does not claim production
durability, production endpoint reachability, production credential validity, or
release readiness. Promotion requires fresh production-owned endpoint and
credential proof; until then the release posture is **NO-GO**.
