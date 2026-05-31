# RPP-0345 comment post reference generated evidence, variant 3

Date: 2026-05-31
Lane: RPP-0345 comment post reference generated coverage, variant 3
Checklist item: RPP-0345 - Add generated coverage for comment post reference, variant 3.

## Scope

This slice adds deterministic local generated-harness evidence for WordPress
comment post references stored in `wp_comments.comment_post_ID`. It does not
change production planner behavior, release verifier code, or release status.
Final release remains `NO-GO`.

## Evidence added

- `scripts/harness/generated-push-cases.js` adds the
  `commentPostReferenceVariant3` target without changing the 620-case roster or
  62 scenario-family distribution.
- The target tags 20 generated support-only cases across all 10 tiers: 10 ready
  post identity-map rewrite cases and 10 stale post drift cases.
- Ready cases map a local `wp_posts` source row to an equivalent remote
  `wp_posts` row through `meta.wordpressGraphIdentityMap`, preserve the remote
  post, and rewrite the dependent comment row's `comment_post_ID` to the proven
  remote ID.
- Stale cases keep the target post in base/local, drift it remotely, and require
  the dependent comment row to fail closed as `stale-wordpress-graph-identity`
  before apply.
- `test/generated-push-harness.test.js` recounts the target coverage, proves the
  ready identity-map decisions and rewrite metadata, verifies stale apply
  refusal leaves the remote digest unchanged, and asserts generated evidence
  stays hash-only without raw generated post titles, slugs, bodies, or comment
  payloads.

## Observed target shape

```json
{
  "target": "commentPostReferenceVariant3",
  "totalCases": 20,
  "statuses": {
    "blocked": 10,
    "ready": 10
  },
  "perTier": {
    "0": 2,
    "1": 2,
    "2": 2,
    "3": 2,
    "4": 2,
    "5": 2,
    "6": 2,
    "7": 2,
    "8": 2,
    "9": 2
  },
  "readyRelationship": "wp_comments.comment_post_ID",
  "readySourceDecision": "map-local-identity-to-remote",
  "readyTargetDecision": "keep-remote",
  "staleRefusal": "PLAN_NOT_READY"
}
```

The focused generated proof serializes resource keys, IDs, relationship names,
status counts, decision names, refusal codes, and SHA-256 hashes only. Raw
generated post and comment payloads are intentionally excluded from the evidence
envelope.

## Remaining unmapped WordPress surfaces

RPP-0345 keeps `wp_comments.comment_post_ID` covered in generated variant-3
support evidence while the following surfaces remain intentionally unmapped or
fail-closed until an explicit owner/driver, parser-aware rewrite, or equivalent
remote identity-map proof exists:

- `wp_posts.post_type = nav_menu_item`, `revision`, and `wp_navigation` rows.
- Menu item graph metadata such as `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent menu
  relationships.
- Custom/plugin taxonomy rows such as `product_cat` without an equivalent
  remote identity-map target.
- Serialized block references that require parser-aware updates rather than
  scalar row-field rewrites.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only change evidence. This lane does not broaden that support matrix.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0345 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0341|RPP-0343|RPP-0344|RPP-0345|RPP-0347' test/generated-push-harness.test.js
node --test --test-name-pattern='comment graph|comment_post_ID|RPP-0365|RPP-0385|complex-site release evidence extracts' test/push-planner.test.js test/local-production-complex-site-proof.test.js test/rpp-0365-comment-post-reference-v4.test.js test/rpp-0385-comment-post-reference-release-verifier-v5.test.js
npm run test:generated-push-harness
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0345-comment-post-reference-v3.md
git diff --check
git diff --cached --check
```

Observed local result during implementation: all commands above exited 0. The
focused RPP-0345 generated-harness command passed 1 subtest with 0 failures, the
adjacent generated graph command passed 5 subtests with 0 failures, the adjacent
comment-post lineage command passed 7 subtests with 0 failures, and the full
generated harness passed 98 subtests with 0 failures. The artifact redaction
scan returned `"ok": true` for the touched docs.

## Release posture

This is local generated support evidence only. Final release remains `NO-GO`;
integration should keep this as support evidence until a separate release lane
supplies production-backed proof.
