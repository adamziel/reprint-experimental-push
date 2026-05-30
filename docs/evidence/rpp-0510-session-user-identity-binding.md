# RPP-0510 session user identity binding evidence

RPP-0510 adds focused executor-auth coverage for binding the authenticated WordPress user identity to the short-lived push session, dry-run receipt, apply path, and release-verifier summary.

## Scope

- Short-lived push sessions now reject signed dry-run/apply reuse when the stored session identity hash differs from the currently authenticated Application Password user identity.
- Authenticated dry-run receipts now carry an explicit `authBinding.sessionUser` object with user id, user-login hash, identity hash, auth-session hash, push-session hash, manage-options evidence, and a binding hash.
- Authenticated apply recomputes the session user identity binding from the current request and rejects mismatched receipts before entering the DB-journal apply/mutation path.
- `runAuthenticatedHttpPush` emits `sessionUserIdentityBinding` in the release proof summary, and the release verifier also carries the same check through `authSessionBoundary.userIdentityBinding`.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/session-user-identity-binding.test.js` — exit 0, 3 subtests.
- `node --test test/session-user-identity-binding.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/authenticated-http-push-client.test.js` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0510-session-user-identity-binding.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- Coverage is focused route/source inspection plus client/release-summary regression coverage, not a new live WordPress endpoint smoke run.
- Existing mocked client tests still accept legacy minimal receipts; production-shaped route receipts include the new `sessionUser` binding and release evidence surfaces it when present.
