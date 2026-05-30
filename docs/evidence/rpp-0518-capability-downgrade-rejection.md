# RPP-0518 capability downgrade rejection evidence

RPP-0518 adds executor-auth coverage that rejects a lower capability or downgraded session before mutation authority can be used.

## Scope

- Authenticated route permission now uses the shared `REPRINT_PUSH_LAB_REQUIRED_CAPABILITY` value and rejects callers without `manage_options` before route callbacks parse JSON bodies.
- Short-lived push sessions store capability binding evidence at issuance: required capability, granted state, and a hash over scope, required capability, and granted/denied state.
- Signed dry-run, apply, recovery, snapshot-hashes, and journal requests reject sessions with missing or downgraded capability evidence using `SIGNED_SESSION_CAPABILITY_DOWNGRADED` before canonical verification, nonce claiming, JSON parsing, or mutation setup.
- Dry-run receipt issue bindings carry the session capability hash so apply receipt validation keeps session, identity, capability, scope, and plan hash bound together.
- The authenticated HTTP client records preflight `manage_options` capability and fails closed with `AUTH_SESSION_CAPABILITY_DOWNGRADED` when a later auth/session read reports `manage_options: false`; the focused test proves no apply request is sent.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` - exit 0.
- `node --check src/authenticated-http-push-client.js` - exit 0.
- `node --check test/authenticated-http-push-client.test.js` - exit 0.
- `node --check test/rpp-0518-capability-downgrade-rejection.test.js` - exit 0.
- `node --test test/rpp-0518-capability-downgrade-rejection.test.js` - exit 0, 3 subtests.
- `node --test --test-name-pattern='RPP-0518|capability downgrade' test/authenticated-http-push-client.test.js` - exit 0, 1 subtest.
- `node --test test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/rpp-0510-session-user-identity-binding.test.js` - exit 0, 8 subtests.
- `node --test test/authenticated-http-push-client.test.js` - exit 0, 132 subtests.
- `node --test test/production-preflight-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/production-snapshot-hashes-route.test.js test/production-recovery-mutate-route.test.js` - exit 0, 19 subtests.
- `node scripts/release/checklist-completion-lint.mjs` - exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0518-capability-downgrade-rejection.md docs/reprint-push-completion-checklist.md` - exit 0.
- `git diff --check` - exit 0.
- `git diff --cached --check` - exit 0 before staging.

## Residual risks

- This slice did not touch production-shaped local Playground smoke scripts, so no new live smoke was required for touched files.
- Coverage remains source-level and authenticated-client focused; a later integration pass should run the packaged production-shaped live route suite once adjacent executor-auth RPP-0516/RPP-0517 idempotency items are also merged.
