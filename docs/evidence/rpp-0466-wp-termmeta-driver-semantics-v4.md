# RPP-0466 wp_termmeta driver semantics v4 evidence

Date: 2026-05-30

## Scope

This is variant-4 focused regression evidence for the `wp_termmeta`
plugin-owned resource driver. It adds a local Node test without changing shared
or generated harness files.

## Proof surface

`test/rpp-0466-wp-termmeta-driver-semantics-v4.test.js` proves the exact driver
contract for `row:["wp_termmeta","meta_id:9466"]`:

- a production-backed remote policy for owner `forms`, driver `wp-termmeta`, and
  table `wp_termmeta` plans exactly one `put` mutation with one live-remote
  precondition;
- the driver evidence records the exact `meta_id` row id, `term_id`, `meta_key`,
  owner, policy source, and release evidence scope while omitting raw row payload
  fields;
- planner audit surfaces remain hash-only and the apply journal redacts row
  values while the checked remote object receives the expected termmeta row; and
- near misses for a payload `meta_id` mismatch, a non-`meta_id` row identifier,
  and an explicit wrong policy table all block before mutation with zero
  preconditions and an unchanged remote snapshot.

## Focused verification observed locally

```sh
node --check test/rpp-0466-wp-termmeta-driver-semantics-v4.test.js
node --test test/rpp-0466-wp-termmeta-driver-semantics-v4.test.js
node --test test/plugin-driver-termmeta-semantics.test.js test/rpp-0426-wp-termmeta-driver-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0466-wp-termmeta-driver-semantics-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: commands above exited 0. The focused RPP-0466 test reported two
subtests ok and zero failures; the existing `wp_termmeta` driver regression
slice reported ten subtests ok and zero failures; checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true`; both unstaged and staged diff checks returned no whitespace errors.

## Release posture

This is local focused plugin-driver regression evidence only. It does not update
`progress.html`, does not create a PR, and does not claim live external
production release readiness.
