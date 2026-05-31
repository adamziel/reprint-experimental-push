# RPP-0357 serialized block reference detection v3 evidence

Date: 2026-05-31
Lane: RPP-0357 serialized block reference detection, variant 3
Checklist item: RPP-0357 - Add generated coverage for serialized block reference detection, variant 3.
Success text: unsupported target fails closed with hash-only evidence.
Release posture: NO-GO.

## Scope

This slice adds local planner/apply regression coverage for Gutenberg serialized
block reference detection in `wp_posts.post_content`. It does not change
planner source, generated harness fixtures, release-verifier routes, production
progress surfaces, plugin-driver code, checklist state, or adjacent
RPP-0337/RPP-0377 artifacts.

## Evidence added

- `test/rpp-0357-serialized-block-reference-detection-v3.test.js` creates a
  local post containing a serialized `core/cover` block whose `id` points at an
  existing `wp_posts` row.
- The referenced target row is intentionally unsupported for an attachment
  relationship because its `post_type` is `page`, not `attachment`.
- The planner blocks the source post as `stale-wordpress-graph-identity`, emits
  no source mutation or source precondition, and records nested target evidence
  as `serialized-block-attachment` with `serializedBlockAttributePath` set to
  `id`.
- `applyPlan()` refuses the blocked plan with `PLAN_NOT_READY` before the remote
  snapshot hash changes.
- Source blocker evidence and nested target-reference evidence remain hash-only:
  SHA-256 hashes, resource keys, state labels, relationship metadata, block
  name, and block attribute path are retained while raw post titles, captions,
  and target row bodies are omitted.

## Observed unsupported target shape

```json
{
  "source": "row:[\"wp_posts\",\"ID:357\"]",
  "relationshipKey": "wp_posts.post_content",
  "relationshipType": "serialized-block-attachment",
  "serializedBlockName": "core/cover",
  "serializedBlockAttributePath": "id",
  "target": "row:[\"wp_posts\",\"ID:8357\"]",
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
node --check test/rpp-0357-serialized-block-reference-detection-v3.test.js
node --test --test-name-pattern RPP-0357 test/rpp-0357-serialized-block-reference-detection-v3.test.js
node --test --test-name-pattern RPP-0377 test/rpp-0377-serialized-block-reference-detection-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0357-serialized-block-reference-detection-v3.md
git diff --check
git diff --cached --check
```

Observed local result: the focused RPP-0357 regression reported 1 subtest with
0 failures. The adjacent RPP-0377 regression, touched-doc artifact redaction
scan, unstaged whitespace diff check, and staged whitespace diff check returned
exit code 0.

## Integration recommendation

Integrate this as support-only graph-identity evidence after the existing
serialized block reference detection implementation. It proves the unsupported
`core/cover` attachment target continues to fail closed with hash-only evidence,
but it does not add parser-aware block rewriting or live production proof.
