# RPP-0496 driver delete support release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0496 driver delete support flag release verifier carry-through, variant 5
Checklist item: RPP-0496 - Carry through the release verifier for driver delete support flag, variant 5.

## Scope

This adds release-verifier carry-through for the existing plugin-driver delete
support flag behavior. The verifier now emits a support-only, hash-only
`pluginDriver.deleteSupport` proof beside the other plugin-driver verifier
summaries.

The proof does not broaden the live release boundary and is not production
evidence. Release posture remains NO-GO without separate checked production
proof.

## Proof surface

`test/rpp-0496-driver-delete-support-release-verifier-v5.test.js` verifies
that the release verifier:

- refuses a plugin-owned row delete when only a decoy driver entry has
  `supportsDelete: true`, proving delete support binds to the exact matched
  `wp-option` driver;
- emits one ready delete mutation only when the exact matched driver carries
  explicit boolean `supportsDelete: true`;
- applies the supported delete while preserving the active plugin context;
- rejects a forged ready delete when `supportsDelete` is removed at apply time,
  before mutating the remote snapshot; and
- keeps evidence hash-only, with no raw option values or `option_value` fields
  in the emitted proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0496-driver-delete-support-release-verifier-v5.test.js
node --test test/rpp-0496-driver-delete-support-release-verifier-v5.test.js
node --test test/plugin-driver-delete-support-flag.test.js test/rpp-0476-driver-delete-support-flag-v4.test.js test/rpp-0436-driver-delete-support-flag.test.js test/plugin-uninstall-delete-refusal.test.js
node --test --test-name-pattern 'production-shaped release verify owns the production plugin-driver boundary proof fields|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data|production plugin-driver boundary proof rejects serialized plugin-owned option mutations|RPP-0484|RPP-0485|RPP-0486' test/production-shaped-proof.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0496-driver-delete-support-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0496
test reported 2 subtests ok and 0 failed. The adjacent delete-support/refusal
slice reported 24 tests ok and 0 failed. The adjacent release-verifier slice
reported 13 tests ok and 0 failed. Checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true`; both unstaged and
staged diff checks returned no whitespace errors.

## Release posture

This is local release-verifier carry-through evidence only. The emitted
`pluginDriver.deleteSupport` proof is explicitly support-only and
productionBacked `false`; final release remains NO-GO until live production
proof satisfies the broader release boundary.
