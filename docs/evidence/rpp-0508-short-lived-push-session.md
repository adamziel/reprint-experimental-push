# RPP-0508 short-lived push session evidence

RPP-0508 adds focused executor-auth coverage for short-lived push session issue and dry-run receipt binding.

## Scope

- Preflight mints an opaque push session token backed by a `wp-options` row with `autoload = no`.
- The session record stores only hashed/bounded binding material: identity hash, credential hash, signing-key hash, scope, issue time, expiry time, and a 300-second TTL.
- Signed dry-run, apply, journal, snapshot-hashes, and recovery requests must present that unexpired session plus an idempotency key before canonical request verification proceeds.
- Authenticated dry-run receipts now carry a `pushSession.issue` binding with session hash, signing-key hash, identity hash, scope hash, issue/expiry timestamps, TTL, and an issue hash; apply recomputes this binding before the mutation path.

## Boundary notes

- Preflight rejects caller-supplied `X-Reprint-Push-Session`; the server issues the short-lived session after signed preflight verification.
- Expired session rows are deleted when loaded or during cleanup scans, and expired sessions return `SIGNED_SESSION_INVALID`/`SIGNED_SESSION_EXPIRED` before receipt validation or mutation setup.
- Receipt validation still requires the supplied plan hash to match the canonical apply plan and now also requires the short-lived session issue binding to match the current signed request.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/short-lived-push-session.test.js` — exit 0, 3 subtests.
- `node --test test/short-lived-push-session.test.js test/production-preflight-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js` — exit 0, 13 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0508-short-lived-push-session.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- Coverage is source-level focused route/session validation, not a new live WordPress endpoint smoke run.
- The production-shaped route still uses the current mounted Playground implementation when lab routes are enabled; package-mode production hardening remains outside this slice.
