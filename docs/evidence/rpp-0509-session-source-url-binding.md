# RPP-0509 session source URL binding evidence

RPP-0509 adds focused executor-auth coverage for session source URL binding before apply mutation.

## Scope

- Short-lived push sessions now store hash-only source binding material (`sourceHash` and `sourceUrlHash`) when preflight issues the session.
- Signed dry-run/apply/recovery/journal requests must present a session whose stored source hashes still match the current live source identity before canonical request verification proceeds.
- Authenticated dry-run receipts now include the source URL and source URL hash in the receipt source binding and carry the source hashes through the short-lived push-session issue binding.
- Apply revalidates the receipt source binding again after `apply-started` is durably written and before the mutation executor is called. A drifted source URL binding fails closed with `AUTH_SOURCE_BINDING_MISMATCH` before mutation work.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/session-source-url-binding.test.js test/short-lived-push-session.test.js test/production-apply-route.test.js` — exit 0, 8 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0509-session-source-url-binding.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- Coverage is source-level focused route/session validation, not a new live WordPress endpoint smoke run.
- The production-shaped route still uses the current mounted Playground implementation when lab routes are enabled; package-mode production hardening remains outside this slice.
