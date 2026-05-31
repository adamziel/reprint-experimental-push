# RPP-0543 production dry-run route, variant 3

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same dry-run route receipt binding proof is checked against
production-owned URL and credential inputs.

## Claim

The production dry-run route can be represented by a real-endpoint shaped local
proof while remaining support-only. Accepted dry-run receipts must bind the
authenticated session, identity, scope, and canonical plan hash, and stale or
tampered binding evidence must fail closed before release movement.

## Proof Surface

`test/rpp-0543-production-dry-run-route-v3.test.js` adds three generated
checks:

- accepted signed `POST /wp-json/reprint/v1/push/dry-run` evidence is wrapped
  as `real-endpoint-shaped-local-route` support evidence with `status:
  support_only`;
- malformed-body negative auth cases fail with auth/signature codes before JSON
  parsing, dry-run work, receipt minting, or mutation-capable work; and
- missing, stale, expired-session, and tampered receipt-binding evidence is
  blocked before release movement.

The test uses mocked fetch responses and the existing authenticated client
route-profile behavior. No listener, tunnel, public ingress, or remote network
exposure is started.

## Proven Behavior

- The accepted local proof reaches the production-shaped path
  `/wp-json/reprint/v1/push/dry-run` with method `POST`, route profile
  `production-shaped`, namespace `reprint/v1`, and route prefix `/push`.
- The dry-run response is non-mutating: read-only proof is true, mutates is
  false, and mutation-capable work attempts remain zero.
- The receipt plan hash equals the canonical dry-run plan hash.
- The receipt `authBinding` records the expected auth scope, authenticated
  identity, production auth session, request route binding, plan binding, and
  push-session binding.
- The subject binding verifies scope hash, identity hash, auth-session hash,
  push-session hash, plan hash, and binding hash.
- Negative auth cases cover missing Basic auth, wrong Basic auth, missing
  signed headers, missing push session, missing idempotency key, content-hash
  mismatch, auth-signature mismatch, push-signature mismatch, and invalid push
  session.
- Negative cases carry malformed JSON that would fail if parsed, but the local
  route proof records zero JSON parse attempts, zero dry-run work attempts, zero
  receipt mint attempts, and zero mutation-capable work attempts.
- Source, credential, user login, session id, session expiry, route proof, and
  receipt proof values are represented by SHA-256 hashes or lengths.
- Raw source, credential, idempotency, session, nonce, and malformed payload
  values are absent from support summaries.
- Missing route proof returns `DRY_RUN_ROUTE_PROOF_REQUIRED`; stale route proof
  returns `DRY_RUN_ROUTE_PROOF_STALE`; expired session evidence returns
  `DRY_RUN_AUTH_SESSION_STALE`; tampered binding evidence returns
  `DRY_RUN_RECEIPT_BINDING_MISMATCH`.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0543-production-dry-run-route-v3.test.js
node --test --test-name-pattern RPP-0543 test/rpp-0543-production-dry-run-route-v3.test.js
node --test test/production-dry-run-route.test.js test/release-gate-dry-run-route-eligibility-generated.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0543-production-dry-run-route-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0543 test reported
3 passes / 0 failures. The adjacent production dry-run and generated
eligibility tests reported 8 passes / 0 failures. The scoped artifact
redaction scan returned `"ok": true`, and whitespace checks returned no
findings.

## Boundary

This proof does not claim production durability or release readiness. Promotion
requires the same route receipt evidence from a checked production-owned
endpoint with valid production credentials; until then the release posture is
**NO-GO**.
