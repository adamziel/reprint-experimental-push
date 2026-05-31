# RPP-0552 request signature canonicalization, variant 3

Date: 2026-05-31

Status: generated local executor-auth support evidence only. Final release
remains **NO-GO** until the same canonical signature behavior is proven at the
checked production release boundary.

## Claim

Equivalent signed request shapes must canonicalize to the same push-signature
input, while malformed or tampered signed requests must fail before JSON
parsing, nonce claim, receipt minting, or mutation-capable work.

## Proof Surface

`test/rpp-0552-request-signature-canonicalization-v3.test.js` adds generated
local coverage for:

- equivalent query ordering, empty segment, plus-space, percent-encoding,
  empty-value, encoded-slash, and duplicate-value canonicalization;
- malformed and tampered signed apply requests carrying a body that would fail
  if parsed; and
- source-order checks that the authenticated dry-run and apply routes call
  signed request verification before JSON parsing, receipt binding, receipt
  validation, nonce claim, or journaled mutation work.

No listener, public ingress, tunnel, live production endpoint, or live
credential was used.

## Proven Behavior

- Equivalent generated request variants produce the same canonical request
  hash and push-signature hash.
- Canonical query generation decodes plus as space, decodes percent-encoded
  input, sorts by key/value/original index, and re-encodes with RFC3986-style
  query escaping.
- Negative cases cover missing or wrong Basic auth, missing signed headers,
  missing session, missing idempotency key, invalid or mismatched content hash,
  invalid timestamp, invalid nonce, tampered auth signature, invalid session,
  expired session, downgraded capability, session binding mismatch, tampered
  query, tampered idempotency header, tampered push signature, and malformed
  push signature.
- Every negative case records zero JSON parse attempts, zero nonce-claim
  attempts, zero receipt mint attempts, and zero mutation attempts.
- The support envelope stores case, request, canonical, query, and signature
  evidence as SHA-256 hashes only, with raw values excluded.
- Route-source assertions pin signature verification before dry-run JSON
  parsing and before apply JSON parsing, receipt validation, and DB-journal
  mutation entry.

## Boundary

This proof is deterministic local support evidence. It strengthens the
executor-auth contract but does not assert production readiness or alter the
release posture. Promotion remains **NO-GO** until a checked production-owned
release proof covers the same behavior.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0552-request-signature-canonicalization-v3.test.js
node --test --test-name-pattern RPP-0552 test/rpp-0552-request-signature-canonicalization-v3.test.js
node --test --test-name-pattern canonicalizes test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0552-request-signature-canonicalization-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0552 generated test
reported 3 passes / 0 failures, the adjacent authenticated-client
canonicalization subset reported 1 pass / 0 failures, the scoped artifact
redaction scan returned `"ok": true`, and both whitespace checks returned no
findings.
