# RPP-0362 featured image attachment reference variant 4 evidence

Date: 2026-05-30

## Scope

This is focused local regression coverage for featured image `_thumbnail_id`
attachment references. It validates existing planner/apply behavior only; no
production source, generated harness, release-verifier, auth, recovery, or
storage files were changed.

## Proof surface

`test/rpp-0362-featured-image-attachment-reference-v4.test.js` proves:

- stale remote attachment targets block the `_thumbnail_id` postmeta row before
  mutation, with zero mutations and zero preconditions;
- unsupported non-attachment `_thumbnail_id` targets block before mutation with
  `targetSupport.supported: false` and a graph-identity refusal reason;
- blocker and reference evidence carry resource keys, target states, and
  SHA-256 hashes only, including source postmeta change hashes and target
  base/local/remote hashes; and
- raw attachment/page fixture fields and raw local postmeta payload markers are
  absent from the blocked plan, blocker, reference, apply refusal details, and
  local proof envelope.

The proof envelope records `proofScope: local-focused-regression`,
`productionBacked: false`, and `releaseGate: NO-GO`; it is not production-backed
release evidence.

## Focused verification observed locally

```sh
node --check test/rpp-0362-featured-image-attachment-reference-v4.test.js
node --test test/rpp-0362-featured-image-attachment-reference-v4.test.js
nix-shell -p ripgrep --run 'rg "featured image|_thumbnail_id|RPP-0302|RPP-0342" test'
node --test --test-name-pattern "featured image|_thumbnail_id|RPP-0302|RPP-0342" test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0362-featured-image-attachment-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0362 test
reported 2 subtests ok and 0 failures. The adjacent featured-image graph slice
reported 5 subtests ok and 0 failures. Checklist lint returned `"ok": true`,
the scoped artifact redaction scan returned `"ok": true`, and both unstaged and
staged diff checks reported no whitespace issues.

## Release posture

This remains local focused graph-identity regression evidence only. It does not
claim a live production run or release-verifier carry-through. Keep broader
release movement held until the separate production-backed release gate captures
fresh live evidence.
