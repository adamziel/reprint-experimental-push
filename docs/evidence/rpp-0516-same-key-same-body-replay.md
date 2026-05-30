# RPP-0516 same-key same-body replay evidence

RPP-0516 adds focused executor-auth coverage for same-key/same-body apply replay on the production-shaped route.

## Scope

- Committed and rejected DB-journal replay envelopes now explicitly report `idempotency.status: replayed` and `idempotency.conflict: false` alongside the existing replay and fresh-mutation-work booleans.
- The focused live endpoint test exercises `/wp-json/reprint/v1/push/preflight`, `/dry-run`, `/apply`, and `/db-journal` through the production-shaped client against a sandbox-local WordPress Playground URL.
- The test applies one upload-file mutation, then resends the exact same apply body with the same idempotency key and a new signed nonce. The replay returns `BATCH_ALREADY_COMMITTED`, preserves the canonical request hash evidence, reports zero fresh mutation work, writes `apply-replayed`, and does not add another claim, commit, or mutation event.

## Live endpoint proof

- Command: `node --test test/rpp-0516-same-key-same-body-replay.test.js`
- Observed result: exit 0; TAP reported 1 test and 1 pass in about 52 seconds.
- The live URL stayed on sandbox-local loopback with no remote tunnel. The exact ephemeral local port is intentionally not published in this evidence artifact.

## Focused validation commands

- `node --check test/rpp-0516-same-key-same-body-replay.test.js` — exit 0.
- `php -l scripts/playground/push-db-journal-lib.php` — exit 0.
- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/rpp-0516-same-key-same-body-replay.test.js` — exit 0, 1 subtest.
- `node --test test/production-apply-route.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js` — exit 0, 10 subtests.
- `node --test --test-name-pattern='idempotency|replay' test/authenticated-http-push-client.test.js` — exit 0, 26 subtests.

## Adjacent validation note

- `npm run test:playground:db-journal-idempotency` was attempted twice. It failed before its replay assertions on the public lab route with `lost-response apply final visible surface mismatch`; the observed target remained at the base fixture instead of the local-edited fixture. The RPP-0516 production-shaped live endpoint proof above does not use that public lab route path.

## Residual risks

- The live proof uses a disposable local WordPress Playground server rather than an externally reachable production host.
- The replay proof is immediate and does not cover replay after dry-run receipt expiry or signed session expiry.
