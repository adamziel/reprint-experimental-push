# RPP-0519 credential rotation behavior evidence

RPP-0519 adds evidence toward the executor-auth credential rotation boundary for production-shaped apply.

## Scope

- The local Playground auth fixture now provisions a second scoped Application Password for the default push admin user so the same user can authenticate with a rotated credential while an older short-lived push session is still present.
- Short-lived push sessions bind the credential hash, signing-key hash, authenticated user identity, auth scope, and live source hashes before canonical signed mutation admission.
- Apply receipt validation also compares the dry-run credential/session binding with the current request before the journal-backed apply path.
- The focused local proof verifies that an invalid credential returns auth failure without mutation, a rotated same-user credential returns `SIGNED_SESSION_BINDING_MISMATCH` without mutation, and the credential that minted the session remains able to apply with before-first-mutation revalidation.

## Local endpoint proof

- Command: `node --test test/rpp-0519-credential-rotation.test.js`
- Observed result: exit 0; TAP reported 2 subtests.
- The live subtest started one sandbox-local loopback WordPress Playground server, used the production-shaped `/wp-json/reprint/v1/push/*` routes for preflight, dry-run, and apply, and used the lab snapshot route only for no-mutation readback.
- The failed invalid-credential apply returned `reprint_push_lab_auth_required` and left the target snapshot unchanged.
- The failed rotated-credential apply used the same user and scope but a different credential binding, returned `SIGNED_SESSION_BINDING_MISMATCH`, and left the target snapshot unchanged.
- The final current-credential apply reused the original session and receipt, reported `applyRevalidation.phase: before-first-mutation`, and was the first request to change the planned resources.
- The live URL stayed on sandbox-local loopback with no remote tunnel. The exact ephemeral local port is intentionally not published in this evidence artifact.

## Focused validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --check test/rpp-0519-credential-rotation.test.js` — exit 0.
- `node --test test/rpp-0519-credential-rotation.test.js` — exit 0, 2 subtests.
- `node --test --test-concurrency=1 test/authenticated-http-push-client.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/rpp-0510-session-user-identity-binding.test.js test/rpp-0511-application-password-integration.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-manage-options-generated.test.js test/production-preflight-route.test.js test/production-apply-route.test.js test/production-snapshot-hashes-route.test.js` — exit 0, 158 subtests.
- `npm run test:playground:production-shaped-push` — first attempt exited 1 during initial local Playground snapshot export with `fetch failed`; immediate rerun exited 0 and exercised dry-run, apply, replay, idempotency conflict, journal, and recovery readback.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0519-credential-rotation-behavior.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- This is a production-shaped local Playground proof, not an externally hosted production endpoint proof.
- The fixture provisions the rotated credential for local proof coverage; production credential rotation still depends on the real Application Password lifecycle on the deployed source.
- One production-shaped smoke attempt hit a local Playground snapshot export `fetch failed` before route assertions; the immediate rerun exercised the route path successfully.
