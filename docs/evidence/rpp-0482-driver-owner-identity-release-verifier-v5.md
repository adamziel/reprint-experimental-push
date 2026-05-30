# RPP-0482 driver owner identity release verifier v5 evidence

Date: 2026-05-30

## Scope

Focused release-verifier carry-through evidence for driver owner identity
binding, variant 5.

The proof keeps the generated owner identity harness as the source of truth and
carries its supported and unsupported variants into a release-verifier-shaped
evidence envelope. It also fixes the generated harness expectation for the stale
owner-context case so the exported validator agrees with the planner's
`wp-option` blocker evidence.

## Proof surface

`test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js` imports
`generateDriverOwnerIdentityBindingCases()` and
`validateDriverOwnerIdentityBindingCase()`.

The focused test proves:

- one supported exact-owner policy carries owner `forms`, driver `wp-option`,
  `local-snapshot` policy source, required owner context, and a single applied
  mutation in local verifier evidence;
- four unsupported variants remain fail-closed:
  - wrong policy owner;
  - missing owner policy;
  - local planned-row owner drift caught by apply-time revalidation; and
  - stale plugin metadata owner context;
- every unsupported variant preserves the remote hash after refusal; and
- the aggregate verifier proof is hash-only, contains no generated private
  markers, and remains `NO-GO` because it is local-generated evidence rather
  than live production proof.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js
node --test test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js
node --test test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js test/rpp-0462-driver-owner-identity-binding-v4.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof enforces exact allowlist owner and driver|production plugin-driver boundary proof blocks a wrong-driver allowlist even when the planner supports the table' test/production-shaped-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0482-driver-owner-identity-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0482 test reported
three subtests ok and zero failures; the adjacent RPP-0462 owner identity slice
and targeted production-shaped release-verifier owner/driver checks passed;
checklist lint returned `"ok": true`; the scoped artifact redaction scan
returned `"ok": true`.

## Release posture

This is local-generated release-verifier carry-through evidence only. It does
not update `progress.html`, does not use live production credentials, and does
not prove final release readiness. Final release remains **NO-GO** without live
production proof.
