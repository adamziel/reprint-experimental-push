# RPP-0502 production snapshot hashes route evidence

RPP-0502 has evidence toward the executor-auth route boundary; the checklist item remains unchecked for the integrator.

## Scope

- Added a production-shaped `POST /wp-json/reprint/v1/push/snapshot-hashes` route backed by the same authenticated permission callback as the other executor routes.
- Added a lab authenticated alias for parity: `POST /wp-json/reprint-push-lab/v1/authenticated/snapshot-hashes`.
- Kept the route planning-only: it exports live comparison hashes, pages results with a cursor, and does not append journals or invoke apply/write helpers.
- Bound snapshot hash evidence into both the snapshot-hashes route receipt and authenticated dry-run receipt metadata using hashes only.

## Auth and parsing boundary

- `permission_callback` remains `reprint_push_lab_rest_authenticated_permission`, so missing or unauthorized Application Password identity is rejected by REST permissions before the route callback can parse JSON.
- The callback checks `reprint_push_lab_rest_require_signed_request($request, 'snapshot-hashes')` and returns signature failures before `reprint_push_lab_rest_json_payload($request)`.
- The focused test asserts this ordering and scans the snapshot-hashes route helper bodies for known mutation calls.

## Credential handling

- Snapshot-hashes receipts include `identityHash`, `sessionHash`, `signingKeyHash`, request body/canonical/idempotency hashes, `snapshotHashSetHash`, `pageHash`, and coverage hashes.
- The receipt builders do not include Authorization headers, raw passwords, raw signing keys, or credential hashes.

## Validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/production-snapshot-hashes-route.test.js` — exit 0, 4 subtests.
- `node --test test/authenticated-http-push-client.test.js test/production-snapshot-hashes-route.test.js test/route-proof-matrix.test.js` — exit 0, 139 subtests.
- `umask 0022; node --test test/artifact-redaction-scan.test.js test/checklist-completion-lint.test.js` — exit 0, 23 subtests.
- `git diff --check` — exit 0.

## Residual risks

- The existing executor client still uses the legacy full snapshot route for planning; this slice only adds and fences the production snapshot-hashes route surface.
- The route is covered by source-level focused tests rather than a live WordPress REST smoke run in this worker.
