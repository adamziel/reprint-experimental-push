# RPP-0488 serialized option validator release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0488 serialized option validator release verifier carry-through, variant 5
Checklist item: RPP-0488 — Carry through the release verifier for serialized option validator, variant 5.

## Scope

This is focused release-verifier carry-through evidence for the plugin-driver
serialized option validator. The verifier now emits
`pluginDriver.serializedOptionValidator` as a support-only, hash-only proof for
one `wp-option` mutation of
`row:["wp_options","option_name:forms_serialized_settings"]`.

The proof does not broaden the production-owned release boundary and does not
claim live production evidence. Release posture remains NO-GO without separate
checked production proof.

## Proof surface

`test/push-planner.test.js` now includes focused RPP-0488 assertions proving:

- the release verifier builds a ready one-row serialized `wp_options` mutation
  for owner `forms`, driver `wp-option`, `serialization: php-serialize`, and
  `supportsDelete: false`;
- the mutation has a live-remote precondition that matches the mutation's
  `remoteBeforeHash`;
- local production-shaped apply carries exactly one mutation through apply,
  reaches the apply validation hook once, records accepted serialized option
  validator evidence, and ends with the applied row hash matching the local row
  hash;
- an invalid local serialized option fails in planning with
  `invalid-plugin-driver-payload` / `SERIALIZED_OPTION_STRING_LENGTH_MISMATCH`
  and preserves the remote row and remote snapshot hash; and
- a forged ready plan with an invalid serialized option fails apply with
  `INVALID_PLUGIN_DRIVER_PAYLOAD` before the mutation hook and preserves the
  remote row and remote snapshot hash.

The focused assertions also verify that the emitted proof is hash-only, omits
raw `option_value` fields, and does not expose the valid or invalid serialized
fixture payloads.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/push-planner.test.js
node --test --test-name-pattern 'RPP-0488' test/push-planner.test.js
node --test --test-name-pattern 'RPP-0448|RPP-0468|RPP-0488' test/push-planner.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node --test --test-name-pattern 'production-shaped release verify owns the production plugin-driver boundary proof fields|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data|production plugin-driver boundary proof rejects serialized plugin-owned option mutations|RPP-0484|RPP-0485|RPP-0486' test/production-shaped-proof.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0488-serialized-option-validator-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0488
test reported 1 subtest ok and 0 failed. The adjacent serialized option
validator slice reported 3 subtests ok and 0 failed. The adjacent
release-verifier plugin-driver slice reported 17 subtests ok and 0 failed, and
the targeted production-shaped verifier slice reported 13 subtests ok and 0
failed. Checklist lint returned `"ok": true`; the scoped artifact redaction
scan returned `"ok": true` for the touched docs.

## Release posture

This lane is local focused release-verifier evidence. The serialized option
validator proof remains support-only and productionBacked `false`; final
release remains NO-GO until live production-backed release evidence satisfies
the broader release boundary.
