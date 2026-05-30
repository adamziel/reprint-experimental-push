# RPP-0337 serialized block reference detection v2 evidence

Date: 2026-05-30
Lane: RPP-0337 serialized block reference detection, variant 2
Checklist item: RPP-0337 - Prove serialized block reference detection, variant 2.
Success text: unsupported target fails closed with hash-only evidence.

## Scope

This slice adds a local planner/apply regression for serialized Gutenberg block
references discovered in `wp_posts.post_excerpt`. It does not change planner
source, generated harness fixtures, release-verifier routes, production
progress surfaces, plugin-driver code, checklist state, or adjacent
RPP-0317/RPP-0377/RPP-0397 artifacts.

## Evidence added

- `test/rpp-0337-serialized-block-reference-detection-v2.test.js` creates a
  local post with a serialized `core/media-text` block in `post_excerpt`.
- The block's `mediaId` points at an existing `wp_posts` row whose `post_type`
  is `page`, not the supported attachment target type.
- The planner blocks the source post as `stale-wordpress-graph-identity`, emits
  no source mutation or source precondition, and records the target reference as
  `serialized-block-attachment` with `serializedBlockAttributePath` set to
  `mediaId`.
- `applyPlan()` refuses the blocked plan with `PLAN_NOT_READY` before the remote
  snapshot hash changes.
- Source blocker evidence and nested target-reference evidence remain hash-only:
  SHA-256 hashes, resource keys, state labels, relationship metadata, block
  name, and block attribute path are retained while raw post titles, captions,
  media URLs, and target row bodies are omitted.

## Observed unsupported target shape

```json
{
  "source": "row:[\"wp_posts\",\"ID:337\"]",
  "relationshipKey": "wp_posts.post_excerpt",
  "relationshipType": "serialized-block-attachment",
  "serializedBlockName": "core/media-text",
  "serializedBlockAttributePath": "mediaId",
  "target": "row:[\"wp_posts\",\"ID:8337\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "targetChange": {
    "localChange": "unchanged",
    "remoteChange": "unchanged"
  },
  "plannedMutation": false,
  "sourcePrecondition": false,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutation": false,
  "evidenceMode": "hash-only"
}
```

## Validation commands

```sh
node --check test/rpp-0337-serialized-block-reference-detection-v2.test.js
node --test test/rpp-0337-serialized-block-reference-detection-v2.test.js
node --test test/rpp-0317-serialized-block-reference-detection.test.js test/rpp-0377-serialized-block-reference-detection-v4.test.js test/rpp-0397-serialized-block-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0337-serialized-block-reference-detection-v2.md
git diff --check
```

Observed local result: the focused RPP-0337 regression reported 1 subtest with
0 failures. The adjacent serialized-block tests, touched-doc artifact redaction
scan, and whitespace diff check returned exit code 0.

## Integration recommendation

Integrate this as local support-only graph-identity evidence after the existing
RPP-0317 serialized block implementation. It proves the unsupported target
continues to fail closed for excerpt-embedded serialized block references, but
it does not add parser-aware block rewriting or live production proof.
