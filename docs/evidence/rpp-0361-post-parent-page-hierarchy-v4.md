# RPP-0361 post_parent page hierarchy evidence, variant 4

Date: 2026-05-30
Lane: RPP-0361 post_parent page hierarchy, variant 4
Checklist item: RPP-0361 — Add focused regression coverage for post_parent page hierarchy, variant 4.

## Scope

This slice adds local, focused planner regression coverage for WordPress page
hierarchy references stored in `wp_posts.post_parent`. It does not change
production code, generated harness fixtures, public progress surfaces,
release-publish artifacts, auth, recovery, storage, or release-verifier files.
The evidence is local test evidence only and is not production-backed proof.

## Evidence added

- `test/rpp-0361-post-parent-page-hierarchy-v4.test.js` covers an explicit
  WordPress graph identity map from a local parent page row to an equivalent
  remote parent page row. The planner records the local parent as
  `map-local-identity-to-remote`, preserves the remote parent as `keep-remote`,
  rewrites the child page `post_parent` from the local parent ID to the proven
  remote parent ID, and applies only the child page mutation with a live-remote
  precondition.
- The rewrite evidence for the page hierarchy target remains hash-only. The
  test asserts that `wordpressGraphIdentity.rewrites` carries resource keys,
  relationship metadata, and SHA-256 hashes for the mapped parent target while
  omitting raw page titles, slugs, and body content.
- The same file covers the stale target refusal path: when a base/local parent
  page is unchanged locally but diverges remotely, a child page whose
  `post_parent` points at that parent is blocked before apply as
  `stale-wordpress-graph-identity`.
- The stale-target blocker and reference evidence remain hash-only: source and
  target changes carry hashes and relationship metadata, omit raw local child and
  remote parent values, and `applyPlan` refuses the plan before mutating the
  remote snapshot.

## Observed target shapes

Explicit identity-map rewrite for a child page hierarchy row:

```json
{
  "sourceParent": "row:[\"wp_posts\",\"ID:36101\"]",
  "targetParent": "row:[\"wp_posts\",\"ID:46101\"]",
  "childPage": "row:[\"wp_posts\",\"ID:36102\"]",
  "relationshipKey": "wp_posts.post_parent",
  "relationshipType": "post-parent",
  "plannedPostParent": 46101,
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "precondition": "live-remote"
}
```

Stale parent target refusal for the same relationship surface:

```json
{
  "childPage": "row:[\"wp_posts\",\"ID:36112\"]",
  "targetParent": "row:[\"wp_posts\",\"ID:36111\"]",
  "relationshipKey": "wp_posts.post_parent",
  "relationshipType": "post-parent",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "update",
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY"
}
```

These two focused cases prove the `post_parent` mapper rewrite path for a page
hierarchy target and keep stale page hierarchy targets fail-closed with
hash-only evidence.

## Validation commands

```sh
node --check test/rpp-0361-post-parent-page-hierarchy-v4.test.js
node --test test/rpp-0361-post-parent-page-hierarchy-v4.test.js
nix-shell -p ripgrep --run 'rg "post_parent|RPP-0301|RPP-0321|RPP-0341" test | head -n 80'
node --test --test-name-pattern 'post parent|post_parent|post-parent|explicit WordPress graph identity map references' test/push-planner.test.js test/local-production-complex-site-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0361-post-parent-page-hierarchy-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result for the focused RPP-0361 test command: 2 subtests, 0
failures. The adjacent post-parent graph slice command ran 3 subtests with 0
failures. Checklist completion lint, touched-doc artifact redaction scan, and
whitespace diff checks were run locally after this evidence file and the
checklist line were updated; all returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused local regression slice.
