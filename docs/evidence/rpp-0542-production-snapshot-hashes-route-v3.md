# RPP-0542 production snapshot hashes route, variant 3

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same snapshot-hashes route proof is checked against production-owned
URL and credential inputs.

## Claim

The production snapshot-hashes route can be represented by a real-endpoint
shaped local proof while remaining support-only. The proof must fail negative
auth cases before JSON parsing and before mutation-capable work, and all route
evidence summaries must be hash-only or redacted.

## Proof Surface

`test/rpp-0542-production-snapshot-hashes-route-v3.test.js` adds three generated
checks:

- accepted signed `POST /wp-json/reprint/v1/push/snapshot-hashes` evidence is
  wrapped as `real-endpoint-shaped-local-route` support evidence with `status:
  support_only`;
- malformed-body negative auth cases fail with auth/signature codes before JSON
  parsing, snapshot-hash work, or mutation-capable work; and
- missing, stale, or expired route evidence is blocked before release movement.

The test uses mocked fetch responses and the existing authenticated client
route-profile behavior. No listener, tunnel, public ingress, or remote network
exposure is started.

## Proven Behavior

- The accepted local proof reaches the production-shaped path
  `/wp-json/reprint/v1/push/snapshot-hashes` with method `POST`, route profile
  `production-shaped`, namespace `reprint/v1`, and route prefix `/push`.
- The accepted route response is planning-only: `readOnly` is true and
  `mutates` is false.
- Negative auth cases cover missing Basic auth, wrong Basic auth, missing signed
  headers, missing push session, content-hash mismatch, auth-signature mismatch,
  and invalid push session.
- Negative cases carry malformed JSON that would fail if parsed, but the local
  route proof records zero JSON parse attempts, zero snapshot-hash work
  attempts, and zero mutation-capable work attempts.
- Source, credential, user login, session id, session expiry, route proof,
  snapshot hash proof, request body, and idempotency values are represented by
  SHA-256 hashes or lengths.
- Raw source, credential, idempotency, session, nonce, and malformed payload
  values are absent from support summaries.
- Missing route proof returns `SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED`; stale route
  proof returns `SNAPSHOT_HASH_ROUTE_PROOF_STALE`; expired session evidence
  returns `SNAPSHOT_HASH_AUTH_SESSION_STALE`.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0542-production-snapshot-hashes-route-v3.test.js
node --test --test-name-pattern RPP-0542 test/rpp-0542-production-snapshot-hashes-route-v3.test.js
node --test test/production-snapshot-hashes-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0542-production-snapshot-hashes-route-v3.md
git diff --check
```

Observed result: syntax checking exited 0. The focused RPP-0542 test reported
3 passes / 0 failures. The adjacent production snapshot-hashes route test
reported 7 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`, and whitespace checks returned no findings.

## Boundary

This proof does not claim production durability or release readiness. Promotion
requires the same route evidence from a checked production-owned endpoint with
valid production credentials; until then the release posture is **NO-GO**.
