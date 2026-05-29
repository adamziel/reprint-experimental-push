# RPP-0504 production apply route evidence

RPP-0504 adds focused evidence for the executor-auth production apply route.

## Scope

- Confirmed `POST /wp-json/reprint/v1/push/apply` is a signed, authenticated production-shaped route using the same Application Password permission boundary as the other executor routes.
- Kept unsigned apply requests fail-closed before JSON plan parsing or mutation setup.
- Added an explicit apply-time live-source revalidation step after the DB apply-started claim is written and before the mutation executor is called.
- The revalidation step exports the current live source snapshot, verifies fixture atomic dependencies and every mutation precondition hash, and records only hash/cursor/resource-key evidence.

## Validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php`
- `node --test test/production-apply-route.test.js`
- `node --test test/production-apply-route.test.js test/production-dry-run-route.test.js test/production-snapshot-hashes-route.test.js`
- `umask 0022; node --test test/checklist-completion-lint.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0504-production-apply-route.md docs/reprint-push-completion-checklist.md`
- `git diff --check`

## Residual risks

- This slice is source-level focused coverage for the production route boundary; it does not add a new live WordPress smoke run.
- The route still uses the current lab-backed Playground implementation when lab routes are enabled; package-mode hardening remains outside this slice.
