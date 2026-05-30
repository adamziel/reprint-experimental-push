# RPP-0442 driver owner identity binding v3 evidence

Date: 2026-05-30

## Scope

This is local generated-harness evidence for driver owner identity binding,
variant 3. It wires the existing generated owner-identity cases into
`test/generated-push-harness.test.js` and keeps the shared validator evidence
explicitly marked as local-generated and not production-backed.

## Proof surface

`test/generated-push-harness.test.js` imports
`generateDriverOwnerIdentityBindingCases()` and
`validateDriverOwnerIdentityBindingCase()` from
`scripts/harness/generated-push-cases.js`. The RPP-0442 generated-harness test
proves one supported exact-owner policy and four unsupported variants:

- wrong policy owner;
- missing owner policy;
- local planned-row owner drift caught by apply-time revalidation; and
- stale plugin metadata owner context.

The supported generated case must plan and apply a single `wp_options` mutation
bound to owner `forms`, driver `wp-option`, `local-snapshot` policy source,
required owner context, and hash-only driver audit evidence. Unsupported cases
remain fail-closed in planning or apply revalidation and preserve the remote
snapshot. The proof envelope records only outcomes and hashes and asserts that
generated private markers are absent.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0442|RPP-0417|RPP-0456' test/generated-push-harness.test.js
node --test --test-name-pattern 'generated push harness covers 300' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0211 generated cases keep mutation preconditions one-to-one' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0231 generated harness proves mutation preconditions one-to-one variant 2' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0230 generated planner summary counts match emitted evidence deterministically' test/generated-push-harness.test.js
node --test test/rpp-0462-driver-owner-identity-binding-v4.test.js test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs --root .
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0442-driver-owner-identity-binding-v3.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: the listed commands exited 0 in this lane. The focused
RPP-0442 generated-harness slice reported the supported and unsupported owner
identity variants. The generated-harness summary and invariant checks covered
the current 620 generated cases, including mutation/precondition one-to-one
mapping and deterministic planner summary counts. A separate read-only
instrumented validation iterated `generatePushHarnessCases()` and
`validateGeneratedCase()` across all 620 cases without failure. The unfiltered
`node --test test/generated-push-harness.test.js` runner was not counted as a
pass because it stalled at the TAP header twice in this sandbox. The adjacent
owner identity v4 and v5 carry-through tests passed. Checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains local generated-harness evidence only. It does not update
`progress.html`, does not use live production credentials, and does not claim
external production release readiness.
