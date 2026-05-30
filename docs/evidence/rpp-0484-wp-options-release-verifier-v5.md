# RPP-0484 wp_options release verifier carry-through variant 5 evidence

Date: 2026-05-30
Lane: RPP-0484 wp_options driver semantics release verifier carry-through, variant 5
Checklist item: RPP-0484 — Carry through the release verifier for wp_options driver semantics, variant 5.

## Scope

This adds release-verifier carry-through for the existing `wp-option`
plugin-owned `wp_options` semantics. The verifier now emits a support-only,
hash-only `wpOptionsDriverSemantics` proof beside the production-owned plugin
driver boundary proof.

The proof does not broaden the live release boundary and is not live external
production evidence. Release posture remains NO-GO without separate checked
production proof.

## Proof surface

`test/rpp-0484-wp-options-release-verifier-v5.test.js` verifies that the
release verifier:

- builds a ready one-row `wp_options` plugin-owned mutation with owner `forms`
  and driver `wp-option`;
- binds the mutation to a live-remote precondition for the exact option row;
- simulates remote drift before apply and observes `PRECONDITION_FAILED`
  before any mutation;
- proves the drifted option-row hash and whole-remote hash are unchanged after
  the failed apply; and
- keeps evidence hash-only, with no raw option values or `option_value` fields
  in the emitted proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0484-wp-options-release-verifier-v5.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js
node --test test/rpp-0464-wp-options-driver-semantics-v4.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof accepts|rejects serialized plugin-owned option mutations|RPP-0484' test/production-shaped-proof.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0484-wp-options-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0484
test reported 2 subtests ok, 0 failed. The adjacent wp_options slice reported
4 subtests ok, 0 failed. The adjacent release-verifier plugin-driver slice
reported 4 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This is local release-verifier carry-through evidence only. The emitted
`wpOptionsDriverSemantics` proof is explicitly support-only and
productionBacked `false`; final release remains NO-GO until live production
proof satisfies the broader release boundary.
