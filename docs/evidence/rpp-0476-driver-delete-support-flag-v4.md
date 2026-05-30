# RPP-0476 driver delete support flag v4 evidence

Date: 2026-05-30

## Scope

This is variant-4 focused regression coverage for plugin-owned driver delete
support. It validates existing planner/apply behavior only; no production code
or generated harness files were changed.

## Proof surface

`test/rpp-0476-driver-delete-support-flag-v4.test.js` proves the exact delete
support contract for `row:["wp_options","option_name:rpp_0476_forms_settings"]`:

- a decoy `wp-postmeta` policy entry with `supportsDelete: true` does not
  authorize deletion of the `wp_options` row; the planner binds the refusal to
  the exact matched `wp-option` driver entry and emits no mutation;
- an exact `wp-option` policy entry with explicit boolean `supportsDelete:
  true` emits one delete mutation with hash-only planner/driver audit evidence
  and apply removes the row while preserving the active plugin; and
- a forged ready plan that keeps `supportsDelete: true` but changes the driver
  to a mismatched `wp-postmeta` driver is refused by apply before mutation, with
  the remote snapshot unchanged.

The focused test asserts the blocker, mutation, journal, and apply refusal
details do not include raw option payload fields or raw row markers.

## Focused verification observed locally

```sh
node --check test/rpp-0476-driver-delete-support-flag-v4.test.js
node --test test/rpp-0476-driver-delete-support-flag-v4.test.js
node --test test/plugin-driver-delete-support-flag.test.js test/rpp-0436-driver-delete-support-flag.test.js test/plugin-driver-registration-api.test.js test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0476-driver-delete-support-flag-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0476 test
reported 3 subtests ok and 0 failed. The adjacent delete-support/plugin-driver
regression slice reported 21 subtests ok and 0 failed. Checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true`; both
unstaged and staged diff checks returned no whitespace errors.

## Release posture

This remains local focused plugin-driver regression evidence only. It is not
live external production evidence; the broader release gate remains NO-GO until
the separate production-backed release proof is satisfied.
