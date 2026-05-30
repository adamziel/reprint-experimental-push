# RPP-0522 production snapshot hashes route v2 evidence

## Evidence classification

- Classification: local/lab-backed proof only.
- No real production URL was supplied for this worker run.
- The live smoke uses a disposable WordPress Playground server on sandbox-local loopback host `127.0.0.1` with an ephemeral port, with no tunnel.
- The smoke summary labels the run as `classification: local-lab-backed`, `productionUrlSupplied: false`, `exposure: sandbox-local-loopback-only`, and `tunnel: none`.
- The route response also labels the surface as `local Playground fixture only` and notes that production-shaped aliases still use fixture auth.

## Route/auth change

- Added a `rest_pre_dispatch` guard for `POST /wp-json/reprint/v1/push/snapshot-hashes` and the lab authenticated alias.
- The guard runs before WordPress REST JSON parameter validation can reject malformed JSON.
- It checks `reprint_push_lab_rest_authenticated_permission()` first, then calls `reprint_push_lab_rest_verify_signed_request(..., ['claimNonce' => false])` for auth/signature failures without claiming a nonce.
- Valid signed requests fall through to the normal route callback, which still performs the full signed request verification and claims the nonce exactly once before parsing JSON.
- The route callback still orders `reprint_push_lab_rest_require_signed_request($request, 'snapshot-hashes')` before `reprint_push_lab_rest_json_payload($request)` and before snapshot hash response construction.

## Negative malformed-body proof

`scripts/playground/production-snapshot-hashes-route-live-smoke.mjs` sent malformed JSON to the production-shaped snapshot-hashes route for these local/lab-backed negative cases:

| Case | HTTP | Code | JSON parsed? | Route payload built? |
| --- | ---: | --- | --- | --- |
| Missing Basic auth | 401 | `reprint_push_lab_auth_required` | no | no |
| Wrong Basic auth | 401 | `reprint_push_lab_auth_required` | no | no |
| Valid auth, missing signature headers | 401 | `SIGNED_HEADER_REQUIRED` | no | no |
| Valid auth, missing push session | 401 | `SIGNED_SESSION_REQUIRED` | no | no |
| Valid auth, content hash mismatch | 401 | `SIGNED_CONTENT_HASH_MISMATCH` | no | no |
| Valid auth, auth signature mismatch | 401 | `SIGNED_AUTH_SIGNATURE_MISMATCH` | no | no |

The smoke asserts none of these malformed requests return `INVALID_ARGUMENT`, `rest_invalid_json`, or JSON-object parse messages, and none include snapshot-hash payload fields such as `snapshotHash`, `snapshotHashSetHash`, `resources`, `coverage`, `pageHash`, or `receipt`.

## Mutation guard

- The source test scans the snapshot-hashes route helper bodies for known mutating calls, including protocol apply/journal writes, `wp_insert_post`, `wp_update_post`, option updates, and direct `$wpdb` writes.
- The live smoke compares the public protocol journal fingerprint before/after the negative cases and after a valid signed snapshot-hashes request.
- Observed journal next sequence stayed `1 -> 1 -> 1`; `negativeCasesJournalUnchanged` and `snapshotHashesJournalUnchanged` were both `true`.
- The positive signed snapshot-hashes response remained planning-only (`planningOnly.mutates: false`, receipt `planningOnlyMutates: false`) and returned only hash evidence.

## Validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/production-snapshot-hashes-route.test.js` — exit 0, 5 subtests.
- `node scripts/playground/production-snapshot-hashes-route-live-smoke.mjs` — exit 0; local/lab-backed smoke classified as non-production.
- `node --test test/authenticated-http-push-client.test.js test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/production-recovery-mutate-route.test.js test/route-proof-matrix.test.js` — exit 0, 153 subtests.
- `node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js` — exit 0, 23 subtests.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0522-production-snapshot-hashes-route-v2.md` — exit 0.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `git diff --check` — exit 0.
