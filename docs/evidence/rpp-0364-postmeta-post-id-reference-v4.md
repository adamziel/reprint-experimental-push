# RPP-0364 postmeta post_id reference variant 4 evidence

Date: 2026-05-30

## Scope

This is focused local regression evidence for the `wp_postmeta.post_id` graph
identity path, variant 4. It exercises the local planner/apply path only and
keeps the proof local/generated; it is not production-backed release evidence.

## Proof surface

`test/rpp-0364-postmeta-post-id-reference-v4.test.js` proves:

- an explicit WordPress graph identity map can carry a local source post to a
  proven remote target post;
- the dependent `wp_postmeta` row is rewritten from the source `post_id` row key
  to the target `post_id` row key, with `wordpressGraphIdentity.rewrites`
  recording `relationshipType: postmeta-post` and `relationshipKey:
  wp_postmeta.post_id`;
- local apply writes the rewritten postmeta row with the target post ID and does
  not create the source post or source postmeta row on the remote snapshot;
- the summarized planner/apply proof records only resource keys, target IDs,
  decisions, counts, and hashes, and omits raw row payloads; and
- a stale target post identity blocks before apply with hash-only blocker and
  reference evidence, leaving the remote snapshot unchanged.

## Focused verification observed locally

```sh
node --check test/rpp-0364-postmeta-post-id-reference-v4.test.js
node --test test/rpp-0364-postmeta-post-id-reference-v4.test.js
node --test --test-name-pattern='postmeta references|postmeta when its WordPress post identity|WordPress graph identity map references' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0364-postmeta-post-id-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0364 test reported 2
subtests ok and 0 failed; the adjacent postmeta graph slice reported 3 subtests
ok and 0 failed; checklist lint returned `"ok": true`; and the scoped artifact
redaction scan returned `"ok": true`.

## Release posture

This proof is local regression evidence for planner/apply behavior. It does not
claim a live production run or production-backed release movement.
