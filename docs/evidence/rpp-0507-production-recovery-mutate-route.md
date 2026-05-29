# RPP-0507 production recovery mutate route evidence

RPP-0507 adds focused executor-auth evidence for the production recovery mutate route boundary.

## Scope

- Added `POST /wp-json/reprint/v1/push/recovery/mutate` behind the same authenticated Application Password permission callback as the other production-shaped executor routes.
- Added `POST /wp-json/reprint-push-lab/v1/authenticated/recovery/mutate` for lab-authenticated parity, plus `/recovery/repair` compatibility aliases that use the same guarded callback.
- The callback verifies `recovery-mutate` signed request headers before invoking the recovery mutate handler, so missing Application Password auth fails in `permission_callback` and bad signatures return before JSON payload parsing.
- The handler parses JSON only after the signature floor, runs recovery inspect first, and then returns fail-closed route-plumbing evidence without invoking apply or write helpers.

## Auth and mutation boundary

- `permission_callback` remains `reprint_push_lab_rest_authenticated_permission`, which requires a verified WordPress Application Password identity and `manage_options` before the route callback can run.
- `reprint_push_lab_rest_authenticated_recovery_mutate()` calls `reprint_push_lab_rest_require_signed_request($request, 'recovery-mutate')` and returns `$signature_error` before `reprint_push_lab_rest_recovery_mutate($request)` can parse JSON.
- Focused source tests scan the callback and mutate handler for known mutation calls (`reprint_push_protocol_run_payload`, DB journal apply helpers, WordPress write helpers, and direct `$wpdb` writes) and confirm the route records `mutationAttempted => false` until the inspect-first repair executor exists.

## Focused validation

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/production-recovery-mutate-route.test.js test/production-snapshot-hashes-route.test.js` — exit 0, 7 subtests.
- `node --test test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/production-recovery-mutate-route.test.js` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0507-production-recovery-mutate-route.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- This slice wires and fences the production route boundary; it does not implement the future mutating recovery repair executor.
- Coverage is source-level focused route/auth evidence rather than a new live WordPress endpoint smoke run.
