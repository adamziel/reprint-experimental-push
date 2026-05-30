# RPP-0385 comment post reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0385 comment post reference release-verifier carry-through, variant 5
Checklist item: RPP-0385 — Carry through the release verifier for comment post reference, variant 5.

## Scope

This is a focused local release-verifier evidence slice for
`wp_comments.comment_post_ID` references. It exercises the same proof shape that
the release verifier emits: a `planObject`, live-remote preconditions,
`apply.applyRevalidation` before the first mutation, post-apply evidence, and a
stale replay check. It does not claim live production release evidence.

## Proof surface

`test/rpp-0385-comment-post-reference-release-verifier-v5.test.js` builds a
small WordPress graph plan with a local `wp_posts` target update and a new
`wp_comments` row whose `comment_post_ID` points at that target post. The test
proves that:

- the plan is ready with the post target update and comment create only;
- both the target post and the comment row have live-remote preconditions;
- the release-shaped apply revalidation covers both resource keys before the
  first mutation;
- apply carries the comment through with `comment_post_ID: 385` and no graph
  rewrite; and
- a stale replay where the target post drifts fails with `PRECONDITION_FAILED`
  before creating the comment.

The emitted summary is hash-only. It records resource keys, row IDs,
relationship metadata, precondition hashes, mutation hashes, and release-gate
posture, while omitting raw `post_title`, `post_content`, and
`comment_content` payloads.

## Remaining unmapped WordPress surfaces

RPP-0385 keeps the remaining unmapped WordPress graph surfaces documented while
showing that the core `wp_comments.comment_post_ID` path is carried through the
local release-verifier shape. The following surfaces remain intentionally
unmapped or fail-closed until an explicit owner/driver, parser-aware rewrite, or
equivalent remote identity-map proof exists:

- `wp_posts.post_type = nav_menu_item`, `revision`, and `wp_navigation` rows.
- Menu item graph metadata such as `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent menu
  relationships.
- Custom/plugin taxonomy rows such as `product_cat` without an equivalent
  remote identity-map target.
- serialized block references that require parser-aware updates rather than
  scalar row-field rewrites.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only change evidence. This lane does not broaden that support matrix.

## Focused verification observed locally

```sh
node --check test/rpp-0385-comment-post-reference-release-verifier-v5.test.js
node --test test/rpp-0385-comment-post-reference-release-verifier-v5.test.js
node --test --test-name-pattern='comment graph|comment_post_ID|RPP-0385|complex-site release evidence extracts' test/push-planner.test.js test/local-production-complex-site-proof.test.js test/rpp-0385-comment-post-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0315|RPP-0316|RPP-0317|nav menu item|wp_navigation|serialized block|comment parent and commentmeta graph closure' test/rpp-0315-nav-menu-item-fail-closed-reference.test.js test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0317-serialized-block-reference-detection.test.js test/local-production-complex-site-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0385-comment-post-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local result after focused validation: all commands above exited 0.
The focused RPP-0385 test reported 2 subtests ok and 0 failed. The adjacent
comment-post/release-evidence slice reported 5 subtests ok and 0 failed; the
unmapped-surface graph slice reported 7 subtests ok and 0 failed. Checklist
lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This is local support-only release-verifier carry-through evidence. The release
gate remains `NO-GO` until a separate live production proof satisfies the
broader release boundary.
