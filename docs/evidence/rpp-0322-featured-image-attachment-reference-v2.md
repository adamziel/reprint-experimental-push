# RPP-0322 featured image attachment reference, variant 2

Date: 2026-05-30
Lane: graph-identity

## Evidence summary

RPP-0322 is covered by a focused planner proof for `_thumbnail_id` graph identity handling:

- mapped local parent and attachment rows are not mutated directly when an explicit WordPress graph identity map proves equivalent remote rows;
- the dependent `wp_postmeta` row is rewritten from local parent/attachment IDs to the proven remote parent/attachment IDs;
- the rewritten mutation carries both `postmeta-post` and `featured-image-attachment` rewrite evidence and a live-remote precondition;
- a `_thumbnail_id` reference to a non-attachment `wp_posts` target fails closed as `stale-wordpress-graph-identity`;
- unsupported target evidence is hash-only: resource keys, state, reasons, and hashes are retained, while raw target titles, target bodies, and postmeta payloads are not serialized.

## Verification

Focused command:

```sh
node --test test/rpp-0322-featured-image-attachment-reference-v2.test.js
```

Expected result: both focused RPP-0322 subtests pass, and blocked unsupported-target plans cannot be applied.

## Residual scope

This proof is intentionally limited to featured image `_thumbnail_id` attachment references and explicit WordPress graph identity maps. Other graph surfaces remain governed by their own checklist items and fail-closed policies.
