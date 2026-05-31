# RPP-0577 same-key different-body conflict, variant 4

Date: 2026-05-31

Status: local support-only proof. Final release remains **NO-GO** until this
behavior is covered by the checked production release boundary.

## Claim

Reusing one idempotency key with a different authenticated apply body must fail
as `IDEMPOTENCY_KEY_CONFLICT` before any fresh mutation-capable work for the
rejected body. Negative auth and signed-request failures must return before
malformed payloads are parsed as JSON and before mutation-capable work can
start.

## Proof Surface

The focused v4 regression adds local support coverage for:

- route-order checks proving signed apply auth returns before route JSON
  payload parsing, and idempotency conflicts return before fresh idempotency
  claim opening or journaled mutation work;
- a deterministic production-shaped support proof that drives apply, same-body
  replay, and a same-key different-body conflict; and
- malformed-payload negative auth cases that prove auth/order failures do not
  parse JSON and do not start mutation-capable work.

## Proven Behavior

- The accepted replay path uses the same idempotency key and an identical
  canonical apply body hash, then reports replay without fresh mutation work.
- The conflict probe keeps the same key and receipt while changing the
  canonical apply body hash.
- The conflict response is `409 IDEMPOTENCY_KEY_CONFLICT`, reports
  `idempotency.conflict: true`, `idempotency.freshMutationWork: false`, and
  zero mutation event counts for the rejected body.
- Conflict evidence is hash-only for key and request identity. It does not
  carry raw key, body, credential, session, nonce, signature, header, URL, or
  probe material in the summarized support evidence.
- Malformed negative auth cases cover missing or wrong credential material,
  missing signed metadata, missing session binding, missing idempotency binding,
  content hash mismatch, auth signature mismatch, push signature mismatch, and
  invalid session binding.
- Every malformed negative auth case records zero JSON parse attempts, zero
  mutation-capable work attempts, and zero mutation work attempts.

## Boundary

This evidence is intentionally local and generated. It does not use live
endpoints, production credentials, public ingress, remote tunnels, or
network-dependent evidence. It supports executor-auth integration by pinning the
expected ordering and hash-only evidence shape, but it does not move release
gates.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0577-same-key-different-body-conflict-v4.test.js
node --test --test-name-pattern RPP-0577 test/rpp-0577-same-key-different-body-conflict-v4.test.js
node --test --test-name-pattern RPP-0557 test/rpp-0557-same-key-different-body-conflict-v3.test.js
node --test --test-name-pattern RPP-0537 test/rpp-0537-same-key-different-body-conflict-v2.test.js
node --test --test-name-pattern RPP-0517 test/rpp-0517-same-key-different-body-conflict.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0577-same-key-different-body-conflict-v4.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0577 run
reported 3 passes / 0 failures. The adjacent RPP-0557 proof reported
3 passes / 0 failures. The adjacent RPP-0537 proof reported
2 passes / 0 failures. The adjacent RPP-0517 proof reported
2 passes / 0 failures. The artifact redaction scan returned `"ok": true`.
