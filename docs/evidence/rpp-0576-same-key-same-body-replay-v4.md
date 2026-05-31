# RPP-0576 same-key same-body replay, variant 4

Date: 2026-06-01

Status: focused live loopback endpoint support coverage. Final release posture
remains **NO-GO**.

## Scope

This slice adds `test/rpp-0576-same-key-same-body-replay-v4.test.js`.
The test starts a local HTTP listener on `http://127.0.0.1:8080` and sends
real `fetch()` traffic through the production-shaped authenticated client. It
does not use a remote tunnel, external ingress, AO dashboard service, or
production WordPress endpoint.

## Coverage

- Accepted path: `runAuthenticatedHttpPush()` applies one mutation, repeats the
  same idempotency key and identical apply body against the live URL, and
  observes `SAME_KEY_SAME_BODY_REPLAY_PROVEN`.
- Accepted replay records `idempotency.replayed: true`,
  `freshMutationWork: false`, matching signed content hashes, matching push
  signatures, fresh auth nonce/signature material, and one `apply-replayed`
  journal row.
- Rejected path: the exported signed client posts the same rejected apply body
  twice to the same live URL with the same key. The replay returns the same
  `412 PRECONDITION_FAILED` outcome, `replayed: true`,
  `freshMutationWork: false`, zero mutation rows, and no commit row.
- The support projection is hash/count/status only and explicitly keeps
  `releaseStatus: NO-GO` and `releaseMovement.allowed: false`.

## Boundary

This is a regression test for the live-URL client path, not production proof.
It exercises loopback HTTP behavior on the sandbox-provided port and should be
carried forward as support evidence until the checked production release
boundary accepts equivalent replay behavior.

## Validation

Commands for this slice:

```sh
node --check test/rpp-0576-same-key-same-body-replay-v4.test.js
node --test --test-name-pattern RPP-0576 test/rpp-0576-same-key-same-body-replay-v4.test.js
node --test --test-name-pattern RPP-0556 test/rpp-0556-same-key-same-body-replay-v3.test.js
node --test --test-name-pattern RPP-0536 test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test --test-name-pattern RPP-0615 test/rpp-0615-same-key-replay-after-rejection.test.js
node --test --test-name-pattern RPP-0675 test/rpp-0675-same-key-replay-after-rejection-v4.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0576-same-key-same-body-replay-v4.md
git diff --check
```

Observed result before commit: all listed commands exited 0. The focused
RPP-0576 live loopback test reported 1 pass / 0 failures. Adjacent RPP-0556,
RPP-0536, RPP-0615, RPP-0675, and RPP-0654 runs each reported 1 passing
file-level subtest / 0 failures. The scoped artifact redaction scan returned
`"ok": true`.

## Recommendation

Keep RPP-0576 as focused support coverage. Integrate it with the replay
regression set, but do not treat it as release-gate movement without checked
production-boundary evidence.
