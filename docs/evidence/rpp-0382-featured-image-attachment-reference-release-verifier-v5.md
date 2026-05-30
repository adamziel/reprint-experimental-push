# RPP-0382 featured image attachment release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused local release-verifier carry-through evidence for the featured
image attachment graph reference, variant 5. It proves the production-shaped
release verifier stops before dry-run/apply when a `_thumbnail_id` postmeta row
points at an unsupported WordPress graph target surface. It does not claim a
live production release run.

## Proof surface

`test/rpp-0382-featured-image-attachment-reference-release-verifier-v5.test.js`
starts a loopback-only production-shaped verifier probe server that serves
preflight and snapshot reads, then calls `runAuthenticatedHttpPush()` with a
local fixture where the `_thumbnail_id` reference targets an unsupported
`nav_menu_item` post row.

The focused assertion proves:

- the verifier returns `PLAN_NOT_READY_LOCALLY` and leaves `dryRun`, `apply`,
  and durable-journal evidence unset;
- the loopback probe observes no `/dry-run` or `/apply` request;
- the carried `planObject` is `blocked`, has zero mutations and zero
  preconditions, and contains `stale-wordpress-graph-identity` blockers for
  both the `_thumbnail_id` row and unsupported target row;
- the featured-image reference evidence records `featured-image-attachment`,
  the target resource key, and target hashes while omitting raw row fields; and
- `applyPlan()` rejects the blocked plan with `PLAN_NOT_READY` before mutation.

The test builds a hash-only verifier evidence envelope with resource keys,
reason hashes, state hashes, target hashes, counts, and booleans only, then
checks it with `assertEvidenceHasNoRawValues()` and explicit fixture-value leak
assertions.

## Focused verification observed locally

```sh
node --check test/rpp-0382-featured-image-attachment-reference-release-verifier-v5.test.js
node --test test/rpp-0382-featured-image-attachment-reference-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0302|featured image' test/push-planner.test.js
node --test --test-name-pattern 'featured image' test/local-production-complex-site-proof.test.js
node --test test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0382-featured-image-attachment-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused test reported 1 subtest ok
and 0 failed; adjacent featured-image graph checks reported 7 subtests ok and
0 failed; adjacent release-verifier redaction/core-postmeta checks reported 6
subtests ok and 0 failed. Checklist lint and the scoped artifact redaction scan
returned `ok: true`.

## Release posture

This lane is local fail-closed release-verifier evidence. The unsupported
featured-image attachment target remains release-gate `NO-GO` without live
production proof.
