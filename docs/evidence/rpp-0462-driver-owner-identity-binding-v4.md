# RPP-0462 driver owner identity binding v4 evidence

Date: 2026-05-30

## Scope

This is focused local-generated regression evidence for driver owner identity
binding, variant 4. It exercises the generated owner-identity cases without
editing the shared generated-harness sources.

## Proof surface

`test/rpp-0462-driver-owner-identity-binding-v4.test.js` imports
`generateDriverOwnerIdentityBindingCases()` and proves the generated case set
contains one supported exact-owner policy and four unsupported paths:

- wrong policy owner;
- missing owner policy;
- local planned-row owner drift caught by apply-time revalidation; and
- stale plugin metadata owner context.

The supported case must produce a ready `wp_options` mutation bound to owner
`forms`, driver `wp-option`, a local-snapshot policy source, required owner
context, and hash-only plugin-driver audit evidence. The unsupported cases must
fail closed either in planning or apply revalidation while leaving the remote
snapshot unchanged. The focused evidence envelope records only hashes and driver
metadata; generated private markers are asserted absent.

## Focused verification observed locally

```sh
node --check test/rpp-0462-driver-owner-identity-binding-v4.test.js
node --test test/rpp-0462-driver-owner-identity-binding-v4.test.js
node --test test/plugin-driver-registration-api.test.js test/plugin-driver-dry-run-validation-hook.test.js test/plugin-driver-delete-support-flag.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0462-driver-owner-identity-binding-v4.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0462 test reported one
subtest ok and zero failures; the adjacent driver registration/delete/dry-run
slice reported its subtests ok; checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains local-generated regression evidence only. It does not update
`progress.html` and does not claim live production release readiness.
