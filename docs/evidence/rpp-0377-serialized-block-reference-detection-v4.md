# RPP-0377 serialized block reference detection v4 evidence

Date: 2026-05-30
Lane: RPP-0377 serialized block reference detection, variant 4
Checklist item: RPP-0377 — Add focused regression coverage for serialized block reference detection, variant 4.
Success text: unsupported target fails closed with hash-only evidence.

## Scope

This slice adds a local regression for Gutenberg serialized block reference
detection in `wp_posts.post_content`. It does not change generated harness
files, release-verifier routes, production progress surfaces, plugin-driver
code, or neighboring RPP-0376/RPP-0378 work.

## Evidence added

- `test/rpp-0377-serialized-block-reference-detection-v4.test.js` creates a
  local post containing a serialized `core/gallery` block with `ids[0]`
  pointing at an existing `wp_posts` row whose `post_type` is `page`, not the
  supported attachment target type.
- The planner blocks the source row as `stale-wordpress-graph-identity`, emits
  no source-row mutation, and `applyPlan` refuses with `PLAN_NOT_READY` before
  the remote fixture hash changes.
- The blocker and nested target-reference evidence keep only hashes and graph
  metadata: `relationshipType` is `serialized-block-attachment`,
  `serializedBlockName` is `core/gallery`, and
  `serializedBlockAttributePath` is `ids.0`.
- The regression asserts hash-shaped source and target evidence and verifies
  that private local post content and target row values are not serialized into
  the blocker evidence.

## Observed unsupported target shape

```json
{
  "source": "row:[\"wp_posts\",\"ID:377\"]",
  "relationshipKey": "wp_posts.post_content",
  "relationshipType": "serialized-block-attachment",
  "serializedBlockName": "core/gallery",
  "serializedBlockAttributePath": "ids.0",
  "target": "row:[\"wp_posts\",\"ID:8377\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutation": false,
  "evidenceMode": "hash-only"
}
```

## Validation commands

```sh
node --check test/rpp-0377-serialized-block-reference-detection-v4.test.js
node --test test/rpp-0377-serialized-block-reference-detection-v4.test.js
node --test test/rpp-0317-serialized-block-reference-detection.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0377-serialized-block-reference-detection-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local result: the new RPP-0377 regression reported 1 subtest
with 0 failures, and the adjacent RPP-0317 serialized block coverage reported
3 subtests with 0 failures. The checklist lint, touched-doc artifact redaction
scan, and whitespace checks returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused RPP-0377 regression slice.
