# RPP-0381 post_parent page hierarchy release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0381 post_parent page hierarchy release verifier, variant 5
Checklist item: RPP-0381 — Carry through the release verifier for post_parent page hierarchy, variant 5.

## Scope

This slice stays inside the focused RPP-0381 regression test, this evidence note,
and the single RPP-0381 checklist line. It does not edit generated harness files,
public progress surfaces, shared release docs, or adjacent RPP-0380/RPP-0382
files.

## Evidence added

- `test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js` builds a
  local WordPress `wp_posts` page hierarchy where the child page carries
  `post_parent` pointing at the same-plan parent page.
- The focused proof creates a production-shaped release verifier proof object
  with `releaseProof.planObject`, dry-run receipt hash, apply-time fresh live
  hash revalidation, exact mutation resource-key coverage, and final readback
  matching the local hierarchy.
- The hash-only evidence summary fails unless the parent and child page mutations
  are both planned, both have live-remote preconditions, apply revalidation covers
  both resource keys before the first mutation, and the applied child row retains
  the expected parent ID.
- A stale-target case proves fail-closed behavior when the remote parent page
  drifts after the base: the child page mutation is not produced, the blocker is
  `stale-wordpress-graph-identity`, the target reference is
  `wp_posts.post_parent`, and apply refuses before mutation.
- A source-contract assertion pins the production-shaped release verifier's
  generic carry-through contract: every planned mutation resource key must be
  freshly revalidated before apply and final readback must match local.

## Observed target shape

Hash-only target summary asserted by the focused test:

```json
{
  "relationshipKey": "wp_posts.post_parent",
  "relationshipType": "post-parent",
  "parentResourceKey": "row:[\"wp_posts\",\"ID:38101\"]",
  "childResourceKey": "row:[\"wp_posts\",\"ID:38102\"]",
  "parentId": 38101,
  "childId": 38102,
  "verifiedBeforeFirstMutation": true,
  "finalMatchesLocal": true
}
```

The evidence object stores only resource keys, IDs, booleans, counts, and hashes;
the focused test asserts that private page titles and bodies are not serialized in
that evidence surface.

## Validation commands

```sh
node --check test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node --test test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node --test --test-name-pattern 'post parent|post_parent|post-parent|RPP-0381' test/push-planner.test.js test/local-production-complex-site-proof.test.js test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node --test --test-name-pattern 'complex-site release evidence|RPP-0381' test/local-production-complex-site-proof.test.js test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node --test test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result: the focused RPP-0381 test covers 3 subtests with 0
failures. Release remains held for broader graph-identity and production gates
outside this local post_parent hierarchy carry-through slice.
