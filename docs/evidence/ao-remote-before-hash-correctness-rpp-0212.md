# AO remoteBeforeHash correctness evidence for RPP-0212

Date: 2026-05-28
Lane: RPP-0212 remoteBeforeHash correctness
Checklist item: RPP-0212 — remoteBeforeHash correctness, variant 1.

## What changed

- Added an executor-side fail-closed guard that rejects ready plans whose emitted mutation `remoteBeforeHash` evidence is missing, malformed, or different from the live remote resource hash.
- Added a focused mixed resource fixture covering a file, a core row, and an allowlisted plugin-owned row.
- Added forged-plan coverage for missing, malformed, wrong, and stale `remoteBeforeHash` attempts before mutation.

## Evidence

Focused command:

```sh
node --test test/push-planner.test.js
```

Focused tests:

```text
RPP-0212 remoteBeforeHash matches live remote for mixed resource mutations
RPP-0212 executor rejects missing wrong or stale remoteBeforeHash before mutation
```

Caveat: executor rejection details use mutation ids, resource keys, and SHA-256 hashes only. The focused fixture includes private-looking local values and asserts those values do not appear in error evidence. This branch does not mark checklist state as integrated; release remains NO-GO until the integration lane accepts it.
