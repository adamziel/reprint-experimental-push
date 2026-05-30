# RPP-0445 wp_postmeta driver semantics v3 evidence

Date: 2026-05-30

## Scope

This is local generated plugin-driver evidence for `wp_postmeta` driver
semantics, variant 3. It adds generated cases for exact `post_id`/`meta_key`
rows, exact `meta_id` rows, and a mismatched `wp_postmeta` row that fails closed
before mutation.

## Proof surface

`test/generated-push-harness.test.js` now imports generated RPP-0445 cases from
`scripts/harness/generated-push-cases.js` and proves:

- local `post_id:<id>:meta_key:<key>` evidence applies through the
  `wp-post-meta` alias and records `releaseGateEvidenceScope: local-candidate`;
- remote-policy `meta_id:<id>` evidence applies through `wp-postmeta` and
  records `releaseGateEvidenceScope: production-backed` without accepting this
  local generated proof as production-backed release evidence;
- mismatched postmeta row identity stays blocked with no mutation or
  precondition and leaves the remote digest unchanged; and
- the generated release-gate notes distinguish local/support-only evidence from
  production-backed scope claims while final release remains `NO-GO`.

The emitted RPP-0445 proof keeps raw postmeta values out of the evidence. It
records only labels, row identity kind, scope labels, release-gate notes, and
hashes for driver evidence, audit evidence, blockers, and final proof results.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js && node --check test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0445' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0148|RPP-0168|RPP-0445' test/generated-push-harness.test.js
node --test test/plugin-driver-postmeta-semantics.test.js test/rpp-0425-wp-postmeta-driver-semantics.test.js test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0445-wp-postmeta-driver-semantics-v3.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this worktree. The focused RPP-0445
test reported 1 subtest ok and 0 failed. The adjacent generated wp_postmeta
slice reported 3 subtests ok and 0 failed, and the adjacent focused
plugin-driver wp_postmeta slice reported 13 subtests ok and 0 failed. Checklist
lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This lane is local generated evidence only. The proof notes whether each
`wp_postmeta` driver-evidence scope is local/support-only or production-backed,
but it does not provide checked production release evidence. Final release
remains `NO-GO`.
