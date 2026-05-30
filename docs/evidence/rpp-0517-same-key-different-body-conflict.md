# RPP-0517 same-key different-body conflict evidence

RPP-0517 adds focused executor-auth coverage for same idempotency key with a different canonical apply body on the production-shaped route.

## Scope

- The conflict response now reports hash-only idempotency evidence with `status: conflict`, the current request hash, the conflicting request hash, and zero mutation event counts for the rejected body.
- The focused test checks that authenticated apply rejects bad auth/signature paths before route JSON payload parsing or mutation setup, following the existing route-order guard pattern.
- The live endpoint proof applies one upload-file mutation, then resends the same idempotency key with a different signed apply body. The second request returns `IDEMPOTENCY_KEY_CONFLICT`, writes `idempotency-key-conflict`, opens no second claim, commits no second apply, and adds no mutation work.

## Live endpoint proof

- Command: `node --test test/rpp-0517-same-key-different-body-conflict.test.js`
- Observed result: exit 0; TAP reported 2 subtests and 0 failures in about 67 seconds.
- The live URL stayed on sandbox-local loopback with no remote tunnel. The exact ephemeral local port is intentionally not published in this evidence artifact.

## Focused validation commands

- `node --check test/rpp-0517-same-key-different-body-conflict.test.js` — exit 0.
- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/rpp-0517-same-key-different-body-conflict.test.js` — exit 0, 2 subtests.

## Adjacent validation commands

- `node --test test/production-apply-route.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js` — exit 0, 10 subtests.
- `node --test --test-name-pattern='idempotency|replay' test/authenticated-http-push-client.test.js` — exit 0, 26 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0, `ok: true`.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0517-same-key-different-body-conflict.md docs/reprint-push-completion-checklist.md` — exit 0, `ok: true`.

## Residual risks

- The live proof uses a disposable local WordPress Playground server rather than an externally reachable production host.
- The conflict proof covers an immediate post-commit conflict and does not cover conflicts after signed session expiry.
