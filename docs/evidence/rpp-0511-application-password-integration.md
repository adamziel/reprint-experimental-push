# RPP-0511 Application Password integration evidence

RPP-0511 adds evidence toward the executor-auth Application Password integration boundary for production-shaped routes.

## Scope

- Production-shaped push requests now prefer WordPress core Application Password authentication for `/wp-json/reprint/v1/push/*` requests before falling back to the existing lab-only Playground verifier.
- The fixture provisioner marks Application Passwords as in use when it installs the scoped push credential, allowing WordPress core to validate the Basic credential during the live endpoint proof.
- The authenticated preflight response carries redacted binding evidence only: user identity, `manage_options`, credential scope/type, Application Password UUID/app ID, credential hash, session hash, signing key hash, and `wp-options` session-store metadata.

## Live endpoint proof

- Command: `node --test test/rpp-0511-application-password-integration.test.js`
- Observed result: exit 0; TAP reported 1 test and 1 pass in about 34 seconds.
- The focused test started a sandbox-local loopback WordPress Playground server, discovered `GET /wp-json/reprint/v1/push/preflight` in the REST index, verified a wrong Application Password returns `reprint_push_lab_auth_required`, and then exercised the same live endpoint with the scoped push Application Password.
- The successful response reported `auth.session.verifier: wordpress-core-application-password`, `auth.session.credentialScope: reprint-push-lab:authenticated-http-push`, `auth.session.credentialType: push-application-password`, a `production-auth-session`, hash-only session evidence, and `sessionStore.type: wp-options`.
- The live URL stayed on sandbox-local loopback with no remote tunnel. The exact ephemeral local port is intentionally not published in this evidence artifact.

## Focused validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --check test/rpp-0511-application-password-integration.test.js` — exit 0.
- `node --test test/rpp-0511-application-password-integration.test.js` — exit 0, 1 subtest.
- `node --test test/authenticated-http-push-client.test.js test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js` — exit 0, 147 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0511-application-password-integration.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- The live proof uses a disposable local WordPress Playground server rather than an externally reachable production host.
- Lab-authenticated routes intentionally keep the existing Playground fallback verifier to avoid changing older lab evidence; this slice upgrades the production-shaped route path.
