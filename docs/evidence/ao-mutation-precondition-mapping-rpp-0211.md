# AO mutation/precondition mapping evidence for RPP-0211

Date: 2026-05-28
Lane: RPP-0211 mutation/precondition one-to-one mapping
Checklist item: RPP-0211 — Mutation/precondition one-to-one mapping, variant 1.

## What changed

- Added an executor-side fail-closed guard for ready plans whose mutation list and live-remote preconditions are not exactly one-to-one.
- Strengthened planner/generated harness assertions so every emitted mutation has exactly one live-remote precondition and every precondition maps back to an emitted mutation.
- Added a focused mixed resource fixture covering a file, a core row, and an allowlisted plugin-owned row.
- Added forged-plan coverage for missing, duplicate, orphaned, resource-mismatched, and hash-mismatched preconditions.

## Evidence

Focused commands:

```sh
node --test test/push-planner.test.js
node --test test/generated-push-harness.test.js
```

Focused tests:

```text
RPP-0211 maps mixed resource mutations and preconditions one-to-one
RPP-0211 executor rejects forged mutation/precondition mappings before mutation
RPP-0211 generated cases keep mutation preconditions one-to-one
```

Caveat: forged-plan rejection evidence records mutation ids, resource keys, and hashes only. The focused fixture uses private-looking local values and asserts those values do not appear in executor error details. This branch does not mark checklist state as integrated; release remains NO-GO until the integration lane accepts it.
