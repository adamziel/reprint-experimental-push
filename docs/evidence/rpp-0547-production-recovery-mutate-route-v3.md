# RPP-0547 production recovery mutate route, variant 3

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same recovery mutate route proof is checked against production-owned
URL and credential inputs.

## Claim

The production recovery mutate route can be represented by a generated
real-endpoint-shaped local proof while remaining support-only. Malformed-body
negative auth cases must fail before route JSON parsing, recovery inspect work,
or any mutation side effect.

## Proof Surface

`test/rpp-0547-production-recovery-mutate-route-v3.test.js` adds three
generated checks:

- accepted signed `POST /wp-json/reprint/v1/push/recovery/mutate` evidence is
  wrapped as `real-endpoint-shaped-local-route` support evidence with `status:
  support_only`;
- malformed `text/plain` negative auth cases fail with auth/signature codes
  before route JSON parsing, recovery inspect, recovery mutate work, or mutation
  side effects; and
- missing, stale, or expired route evidence is blocked before release movement.

The test uses a deterministic local fetch handler and the existing authenticated
client route-profile behavior. No listener, tunnel, public ingress, live
production endpoint, or remote network-only evidence is used.

## Proven Behavior

- The accepted local proof reaches the production-shaped path
  `/wp-json/reprint/v1/push/recovery/mutate` with method `POST`, route profile
  `production-shaped`, namespace `reprint/v1`, and route prefix `/push`.
- The accepted route remains fail-closed with
  `RECOVERY_MUTATE_NOT_IMPLEMENTED`; it records inspect-first route plumbing and
  `mutationAttempted: false`.
- Negative auth cases cover missing Basic auth, wrong Basic auth, missing signed
  headers, missing push session, missing idempotency key, content-hash mismatch,
  auth-signature mismatch, invalid push session, and push-signature mismatch.
- Negative cases carry malformed JSON-shaped `text/plain` bodies that would
  fail if parsed by the route, but the local proof records zero JSON parse
  attempts, zero recovery inspect attempts, zero recovery mutation work
  attempts, and zero mutation side effects.
- Source, credential, user login, session id, session expiry, route proof,
  request body, and idempotency values are represented by SHA-256 hashes or
  lengths.
- Raw source, credential, idempotency, session, nonce, and malformed payload
  values are absent from support summaries.
- Missing route proof returns `RECOVERY_MUTATE_ROUTE_PROOF_REQUIRED`; stale
  route proof returns `RECOVERY_MUTATE_ROUTE_PROOF_STALE`; expired session
  evidence returns `RECOVERY_MUTATE_AUTH_SESSION_STALE`.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0547-production-recovery-mutate-route-v3.test.js
node --test --test-name-pattern RPP-0547 test/rpp-0547-production-recovery-mutate-route-v3.test.js
node --test test/production-recovery-mutate-route.test.js test/rpp-0542-production-snapshot-hashes-route-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0547-production-recovery-mutate-route-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0547 test reported
3 passes / 0 failures. The adjacent recovery mutate and snapshot-hashes route
bundle reported 8 passes / 0 failures. The scoped artifact redaction scan
returned `"ok": true`, and whitespace checks returned no findings.

## Boundary

This proof does not claim production durability or release readiness. Promotion
requires the same route evidence from a checked production-owned endpoint with
valid production credentials; until then the release posture is **NO-GO**.
