# RPP-0397 serialized block reference release verifier variant 5 evidence

Date: 2026-05-30
Lane: RPP-0397 serialized block reference detection release-verifier carry-through, variant 5
Checklist item: RPP-0397 — Carry through the release verifier for serialized block reference detection, variant 5.

## Scope

This slice carries the existing RPP-0317 serialized Gutenberg block reference
fail-closed planner invariant into the production-shaped release verifier proof
surface. It focuses on the unsupported-target outcome for `core/image` block
`id` attributes in `wp_posts.post_content`: a source post that references a
stable but non-attachment `wp_posts` page target must remain blocked before any
mutation, and the release-verifier proof must expose only resource keys, state
transitions, support classification, and hashes.

This does not add parser-aware block rewriting, generated harness fixtures,
plugin-driver behavior, local-production topology changes, progress pages, or
unrelated graph-identity surfaces.

## Evidence added

- `scripts/playground/production-shaped-release-verify.mjs` exports
  `summarizeSerializedBlockReferenceReleaseVerifierProof()` and carries the
  proof under `graphIdentity.serializedBlockReference` in the production-shaped
  verifier output beside the existing support-proof bundles.
- The helper builds base/local/remote snapshots where local creates
  `row:["wp_posts","ID:397"]` with a serialized `core/image` block pointing at
  `row:["wp_posts","ID:8397"]`; the target row is a `page`, not an
  `attachment`.
- The proof asserts the plan is `blocked`, no source or target mutation or
  precondition is emitted, the blocker is `stale-wordpress-graph-identity`, and
  the reference carries `serialized-block-attachment` support evidence with the
  unsupported attachment-target reason.
- `applyPlan()` is invoked against the blocked plan and refuses with
  `PLAN_NOT_READY` before durable journal events or remote changes. Remote,
  source, and target hashes are unchanged.
- `test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js` checks
  the proof shape, verifier carry-through source hook, hash-only plan evidence,
  and raw fixture redaction.
- Checklist line `RPP-0397` is marked checked for this focused release-verifier
  carry-through slice.

## Observed target shape

```json
{
  "relationshipKey": "wp_posts.post_content",
  "relationshipType": "serialized-block-attachment",
  "serializedBlockName": "core/image",
  "serializedBlockAttributePath": "id",
  "sourceResourceKey": "row:[\"wp_posts\",\"ID:397\"]",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:8397\"]",
  "targetPostType": "page",
  "targetSupport": {
    "supported": false,
    "className": "stale-wordpress-graph-identity",
    "reason": "serialized block attachment target is not a supported attachment row"
  },
  "mutationPresent": false,
  "preconditionPresent": false,
  "applyRefusal": "PLAN_NOT_READY",
  "targetEvidence": "hash-only"
}
```

## Validation commands

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js
node --test test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js
node --test test/rpp-0317-serialized-block-reference-detection.test.js test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0317|RPP-0397|serialized block|graph mapping inventory' test/rpp-0317-serialized-block-reference-detection.test.js test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js test/graph-mapping-inventory.test.js
node --test test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js test/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.test.js test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0397-serialized-block-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result: the focused RPP-0397 test reported 2 subtests and 0
failures. The adjacent serialized-block graph checks, release-verifier support
checks, checklist lint, touched-doc artifact redaction scan, and whitespace
checks were run locally after this evidence file and checklist line were
updated; all returned exit code 0.

Release remains held for broader production-owned live-source release gates
outside this focused serialized block reference release-verifier carry-through
slice.
