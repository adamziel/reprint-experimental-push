# RPP-0317 serialized block reference detection evidence

Date: 2026-05-30
Lane: RPP-0317 serialized block reference detection, variant 1
Checklist item: RPP-0317 — Implement serialized block reference detection, variant 1.

## Scope

This slice stays inside the planner graph-identity path for serialized
Gutenberg block comments stored in `wp_posts.post_content` and
`wp_posts.post_excerpt`. It does not change generated harness fixtures,
plugin-driver behavior, release verifier routes, public progress surfaces,
recovery/storage code, or production topology drivers.

## Evidence added

- `src/planner.js` now treats selected serialized core block attributes as
  graph references rather than as an unconditional post-surface refusal. The
  first supported set covers attachment IDs in `core/image`, `core/gallery`,
  `core/media-text`, `core/cover`, `core/file`, `core/audio`, and `core/video`,
  post IDs in `core/navigation-link` and `core/post-featured-image`, and
  reusable-block IDs in `core/block`.
- Serialized block references participate in the same hash-only graph target
  evidence as scalar row references. Stable targets and same-plan unchanged-ID
  targets remain eligible, while changed or unsupported targets still block the
  source row before apply.
- Serialized block references deliberately opt out of scalar identity-map
  rewriting. The planner detects the target relationship, but it does not
  rewrite `post_content` or `post_excerpt` without a parser-aware block update
  path.
- `test/rpp-0317-serialized-block-reference-detection.test.js` covers three
  focused outcomes: a stable `core/image` attachment target plans and applies,
  a drifted attachment target blocks with target hashes only, and a non-
  attachment row used as a serialized image target blocks with target-support
  evidence.
- Unsupported evidence remains hash-only: source blockers and target-reference
  evidence include SHA-256 hashes, resource keys, relationship type, block name,
  and block attribute path while omitting raw private post content, captions,
  attachment/page titles, and attachment/page bodies.

## Observed target shapes

Stable serialized image target:

```json
{
  "source": "row:[\"wp_posts\",\"ID:317\"]",
  "serializedBlock": "core/image",
  "attributePath": "id",
  "target": "row:[\"wp_posts\",\"ID:7317\"]",
  "targetPostType": "attachment",
  "planStatus": "ready",
  "rewrites": 0,
  "precondition": "live-remote"
}
```

Drifted serialized image target:

```json
{
  "source": "row:[\"wp_posts\",\"ID:317\"]",
  "relationshipKey": "wp_posts.post_content",
  "relationshipType": "serialized-block-attachment",
  "serializedBlockName": "core/image",
  "serializedBlockAttributePath": "id",
  "target": "row:[\"wp_posts\",\"ID:7317\"]",
  "targetRemoteChange": "update",
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY"
}
```

Unsupported serialized image target type:

```json
{
  "source": "row:[\"wp_posts\",\"ID:318\"]",
  "relationshipType": "serialized-block-attachment",
  "target": "row:[\"wp_posts\",\"ID:8318\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "targetReason": "serialized block attachment target is not a supported attachment row",
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY"
}
```

## Validation commands

```sh
node --test test/rpp-0317-serialized-block-reference-detection.test.js
node --test --test-name-pattern='RPP-0317|serialized block' test/rpp-0317-serialized-block-reference-detection.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0317-serialized-block-reference-detection.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0317 command: 3 subtests, 0
failures. The broader `RPP-0317|serialized block` graph command, checklist
completion lint, touched-doc artifact redaction scan, and whitespace diff check
were run locally after this evidence file and checklist line were updated; all
returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused serialized block reference-detection slice.
