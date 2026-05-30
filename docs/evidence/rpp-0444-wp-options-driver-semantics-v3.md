# RPP-0444 wp_options driver semantics variant 3 evidence

Date: 2026-05-30
Lane: RPP-0444 wp_options driver semantics, variant 3
Checklist item: RPP-0444 — Add generated coverage for wp_options driver semantics, variant 3.

## Scope

This is local generated-model coverage for the plugin-driver `wp-option`
semantics on plugin-owned `wp_options` rows. It adds an explicit
`wpOptionsDriverSemanticsVariant3` target over the existing generated
plugin-owned option surface and does not broaden the production driver boundary.

## Proof surface

`scripts/harness/generated-push-cases.js` now tags the deterministic
plugin-owned option cases with `wp-options-driver-semantics-v3` and records a
target summary. The default generated roster still contains 620 cases; the new
target contributes 20 cases across all 10 tiers:

- 10 ready `wp-option` driver-backed option updates;
- 10 non-ready remote-drift conflicts; and
- exactly two target cases in each tier.

`test/generated-push-harness.test.js` adds the RPP-0444 proof. It selects one
ready generated case and one non-ready generated case, records only resource
keys, owner/driver labels, status counts, and SHA-256 evidence hashes, and
asserts:

- ready mutations carry owner `forms`, driver `wp-option`, delete disabled,
  live-remote preconditions, and hash-only planner/driver evidence;
- a stale replay that drifts the same plugin-owned option row before apply
  raises `PRECONDITION_FAILED` before mutation;
- the drifted row hash and whole-remote hash are identical before and after the
  failed apply; and
- non-ready remote drift refuses apply without mutating the remote digest.

The proof asserts generated raw option payload fields are absent from the
evidence envelope and keeps final release posture at `NO-GO`.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0444 test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0114/RPP-0134|RPP-0154|RPP-0174|RPP-0444' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0444-wp-options-driver-semantics-v3.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0444
test reported 1 subtest ok, 0 failed. The adjacent generated
wp_options/plugin-driver slice reported 4 subtests ok, 0 failed. Checklist lint
returned `"ok": true`; the scoped artifact redaction scan returned `"ok": true`
for the touched docs.

## Release posture

This remains local generated-model plugin-driver evidence only. It is not live
external production evidence, does not update progress surfaces, and does not
broaden accepted production plugin-driver resources. Final release remains
NO-GO until separate production-backed release proof satisfies the broader
boundary.
