# RPP-0510 session user identity binding evidence

RPP-0510 adds focused executor-auth coverage for binding the authenticated WordPress user identity to the short-lived push session, dry-run receipt, apply path, and release-verifier summary.

## Scope

- Short-lived push sessions now store hash-only user identity binding material (`userIdentityHash`) plus the authenticated WordPress `userId`/`userLogin` needed for fail-closed comparisons.
- Signed dry-run/apply/recovery/journal requests must present a session whose stored user identity hash, user ID, and user login still match the authenticated request before canonical route verification proceeds.
- Authenticated dry-run receipts now carry an explicit `authBinding.sessionUser` object with user ID, user-login hash, identity hash, auth-session hash, push-session hash, manage-options evidence, and a binding hash.
- Authenticated apply recomputes the session user identity binding from the current request and rejects mismatched receipts before entering the DB-journal apply/mutation path.
- Preflight and signed-request evidence expose `userIdentityHash` with the existing session hash/source hash evidence; dry-run receipt issue bindings carry the same hash-only user identity evidence.
- `runAuthenticatedHttpPush` emits `sessionUserIdentityBinding` in the release proof summary, and `verify:release` carries both `authSessionBoundary.userIdentity` and compatibility `authSessionBoundary.userIdentityBinding` evidence.

## Boundary notes

- This slice intentionally avoids Application Password integration changes, receipt-expiry policy changes, and idempotency replay behavior.
- The added release-verifier summary avoids credential material and carries only hash-only session/user identity evidence plus boolean continuity fields.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --check scripts/playground/production-shaped-release-verify.mjs` — exit 0.
- `node --check scripts/playground/production-shaped-live-release-verify.mjs` — exit 0.
- `node --check test/rpp-0510-session-user-identity-binding.test.js` — exit 0.
- `node --test test/rpp-0510-session-user-identity-binding.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/production-preflight-route.test.js` — exit 0.
- `node --test --test-name-pattern='auth/session boundary proof reports same-source readback and capability continuity|auth/session boundary proof rejects readback source drift' test/production-shaped-proof.test.js` — exit 0.
- `node --test test/session-user-identity-binding.test.js` — exit 0, 3 subtests.
- `node --test test/session-user-identity-binding.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/authenticated-http-push-client.test.js` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0510-session-user-identity-binding.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- Coverage is source-level route/session validation plus client/release-summary regression coverage, not a new live WordPress endpoint smoke run.
- Existing mocked client tests still accept legacy minimal receipts; production-shaped route receipts include the new `sessionUser` binding and release evidence surfaces it when present.
- The production-shaped route still uses the mounted Playground implementation when lab routes are enabled; package-mode production hardening remains outside this slice.
