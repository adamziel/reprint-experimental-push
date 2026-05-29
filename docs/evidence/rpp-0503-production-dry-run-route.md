# RPP-0503 production dry-run route evidence

RPP-0503 has implementation evidence for the executor-auth dry-run route boundary.

## Scope

- Kept `POST /wp-json/reprint/v1/push/dry-run` behind the authenticated WordPress Application Password permission callback and signed request verification.
- Bound authenticated dry-run receipts to the current scope, identity, session, signed push session, and canonical plan hash.
- Added a hash-only receipt subject binding with `scopeHash`, `identityHash`, `authSessionHash`, `pushSessionHash`, `planHash`, and `bindingHash` so evidence can be compared without exposing private identity or scope values.
- Added apply-side receipt validation for the new subject and plan hash binding before the DB journal/idempotency mutation path can run.

## Boundary notes

- Unsigned dry-run requests return before JSON plan parsing.
- The dry-run route remains non-content-mutating: it produces an eligibility receipt and does not replace apply-time live hash revalidation.
- Receipt validation rejects stale, tampered, cross-session, cross-scope, or cross-plan receipts before apply opens an idempotency claim.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/production-dry-run-route.test.js test/production-snapshot-hashes-route.test.js` — exit 0, 8 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0503-production-dry-run-route.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` and `git diff --cached --check` — exit 0.

## Residual risks

- This slice adds source-level focused coverage; it does not run a live WordPress Playground smoke proof for the production-shaped route.
- Recovery mutate, generated harness, graph identity, plugin-driver, and broader release-verifier carry-through work remain outside this slice.
