# RPP-0596 same-key same-body replay release verifier, variant 5

Date: 2026-06-01

Status: focused live loopback release-verifier support coverage. Final release
posture remains **NO-GO**.

## Scope

This slice adds
`test/rpp-0596-same-key-same-body-replay-release-verifier-v5.test.js`.
The test starts a local HTTP listener on `http://127.0.0.1:8080` and sends
real authenticated client traffic through the production-shaped push routes.
It does not use a remote tunnel, external ingress, AO dashboard service, or a
production WordPress endpoint.

## Proof Surface

- Accepted replay: the client applies one mutation, repeats the same
  idempotency key with the identical apply body, and observes
  `SAME_KEY_SAME_BODY_REPLAY_PROVEN` with no fresh mutation work.
- Rejected replay: the signed apply client posts the same rejected apply body
  twice with the same key. The replay returns the same
  `PRECONDITION_FAILED` status, records `replayed: true`, and records zero
  mutation or commit rows.
- Release verifier carry-through: the live accepted and rejected replay facts
  are passed into the durable recovery release-verifier proof envelope, where
  `sameKeyBodyReplay`, `sameKeyRejectedReplay`, and
  `sameKeyReplayAfterRejection` all prove true on the checked support path.
- Public projection: the support envelope keeps source, route, request,
  verifier, recommendation, and movement evidence as hashes, counts, booleans,
  and statuses only. It records no raw keys, bodies, credentials, sessions, or
  payload values.

## Boundary

This is live-URL loopback support evidence, not production proof. The verifier
carry-through is useful regression coverage for the real HTTP client path, but
release movement remains blocked with `releaseStatus: NO-GO` and
`releaseMovement.allowed: false` until equivalent production-boundary evidence
exists.

## Validation

Commands for this slice:

```sh
node --check test/rpp-0596-same-key-same-body-replay-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0596 test/rpp-0596-same-key-same-body-replay-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0576 test/rpp-0576-same-key-same-body-replay-v4.test.js
node --test --test-name-pattern RPP-0556 test/rpp-0556-same-key-same-body-replay-v3.test.js
node --test --test-name-pattern RPP-0536 test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test --test-name-pattern RPP-0615 test/rpp-0615-same-key-replay-after-rejection.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0596-same-key-same-body-replay-release-verifier-v5.md
git diff --check
```

Observed result before commit: all listed commands exited 0. The focused
RPP-0596 live loopback release-verifier run reported 1 pass / 0 failures.
Adjacent RPP-0576, RPP-0556, RPP-0536, RPP-0615, and RPP-0654 runs each
reported 1 passing file-level subtest / 0 failures. The scoped artifact
redaction scan returned `"ok": true`.

## Recommendation

Carry RPP-0596 as release-verifier support evidence for same-key same-body
replay on the real loopback endpoint. Do not move release posture without
checked production-boundary evidence.
