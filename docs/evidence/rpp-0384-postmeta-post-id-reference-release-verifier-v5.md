# RPP-0384 postmeta post_id release verifier v5 evidence

Date: 2026-05-30

## Scope

This is focused local-production release-verifier carry-through evidence for the
`wp_postmeta.post_id` graph-identity reference, variant 5. It does not claim a
full external production release run; it proves the local verifier evidence path
that must keep the post target and dependent postmeta row together through
apply.

## Proof surface

`test/rpp-0384-postmeta-post-id-reference-release-verifier-v5.test.js` proves:

- the local-production complex-site planner fixture with `postmetaPostGraph`
  enabled records the same-plan post target and dependent
  `row:["wp_postmeta","post_id:71701:meta_key:reprint_push_postmeta_post_fixture"]`
  row, with live-remote preconditions and no stale graph blocker;
- the release evidence parser requires both the `wp_posts` target mutation and
  the dependent `wp_postmeta` mutation to remain in the verifier plan;
- the dependent postmeta value must still carry `post_id: 71701` and the scoped
  meta key when summarized by the verifier;
- apply-time revalidation must include the post and postmeta resource keys
  before the first mutation, and the post-apply snapshot must match local; and
- the summarized evidence omits raw post title and postmeta payload strings.

The negative subtest removes the postmeta resource from apply revalidation and
verifies the release evidence fails closed instead of treating the target as
carried through apply.

## Focused verification observed locally

```sh
node --check test/rpp-0384-postmeta-post-id-reference-release-verifier-v5.test.js
node --test test/rpp-0384-postmeta-post-id-reference-release-verifier-v5.test.js
node --test --test-name-pattern 'postmeta|same-plan post and attachment graph closure' test/push-planner.test.js
node --test test/local-production-complex-site-proof.test.js test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0384-postmeta-post-id-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this worktree. The focused RPP-0384
regression reported 3 subtests ok and 0 failed. The adjacent postmeta graph
planner slice reported 4 subtests ok and 0 failed. The adjacent local-production
and wp_postmeta release-verifier slice reported 27 subtests ok and 0 failed.
Checklist lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This lane adds local focused verifier evidence only. It narrows the RPP-0384
checklist item by requiring the local-production release evidence parser to keep
the `wp_postmeta.post_id` target under live precondition, apply revalidation, and
post-apply match checks. It does not change the broader release posture without
the remaining live production gates.
