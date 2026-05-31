# RPP-0557 same-key different-body conflict, variant 3

Date: 2026-05-31

Status: local support-only proof. Final release remains **NO-GO** until this
behavior is covered by the checked production release boundary.

## Claim

Reusing one idempotency key with a different authenticated apply body must fail
as `IDEMPOTENCY_KEY_CONFLICT` before any fresh mutation setup or mutation work
for the rejected body. Negative auth and signed-request ordering failures must
fail before JSON parsing and before mutation setup.

## Proof Surface

`test/rpp-0557-same-key-different-body-conflict-v3.test.js` adds generated
support coverage for:

- route-order checks proving signed apply auth returns before route JSON
  payload parsing, and idempotency conflicts return before opening fresh
  idempotency or journaled mutation work;
- a deterministic production-shaped local `runAuthenticatedHttpPush()` proof
  that drives apply, same-body replay, and same-key different-body conflict; and
- malformed-payload negative auth cases that prove auth/order failures do not
  parse JSON and do not start mutation setup.

## Proven Behavior

- The initial apply and same-body replay use the same idempotency key and the
  same canonical apply body hash.
- The conflict probe keeps the same key and receipt but changes the canonical
  apply body hash.
- The conflict response is `409 IDEMPOTENCY_KEY_CONFLICT`, reports
  `idempotency.conflict: true`, `idempotency.freshMutationWork: false`, and
  `status: "conflict"`.
- Conflict evidence is hash-only and includes key/request hash fields,
  zero mutation event counts, and no raw key, body, session, credential, nonce,
  signature, header, or URL material.
- The target snapshot remains unchanged after the conflict and still matches
  the already-applied local state.
- The checked journal summary has exactly one opened idempotency claim, one
  mutation-applied event, one replay event, and one conflict event.
- Negative auth cases cover missing or wrong credential material, missing
  signed metadata, missing session binding, missing idempotency binding, content
  hash mismatch, auth signature mismatch, push signature mismatch, and invalid
  session binding.
- Every negative case uses a malformed JSON payload that would fail if parsed,
  but the local proof records zero JSON parse attempts, zero mutation setup
  attempts, and zero mutation work attempts.

## Boundary

This evidence is intentionally local and generated. It does not use live
endpoints, production credentials, public ingress, remote tunnels, or
network-dependent evidence. It supports executor-auth integration by pinning the
expected order and hash-only evidence shape, but it does not move release gates.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0557-same-key-different-body-conflict-v3.test.js
node --test --test-name-pattern RPP-0557 test/rpp-0557-same-key-different-body-conflict-v3.test.js
node --test --test-name-pattern RPP-0537 test/rpp-0537-same-key-different-body-conflict-v2.test.js
node --test --test-name-pattern 'same-key|different-body|conflict|idempotency|RPP-0517|RPP-0537' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0557-same-key-different-body-conflict-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0557 run
reported 3 passes / 0 failures. The adjacent RPP-0537 proof reported
2 passes / 0 failures. The scoped authenticated-client subset reported
8 passes / 0 failures. The artifact redaction scan returned `"ok": true`.
