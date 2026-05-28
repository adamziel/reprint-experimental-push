# AO localHash correctness evidence for RPP-0213

Date: 2026-05-28
Lane: RPP-0213 localHash correctness
Checklist item: RPP-0213 — localHash correctness, variant 1.

## What changed

- Added an executor-side fail-closed guard that rejects ready plans whose emitted mutation `localHash` evidence is missing, malformed, or different from the serialized planned local resource value.
- Strengthened generated harness contract checks so generated mutations prove `localHash === sha256(planned mutation value)`.
- Added a focused mixed resource fixture covering a file, a core row, and an allowlisted plugin-owned row.
- Added forged-plan coverage for missing, malformed, wrong, stale-value, and stale-local-hash evidence before mutation.

## Evidence

Focused commands:

```sh
node --test test/push-planner.test.js
node --test test/generated-push-harness.test.js
```

Focused tests:

```text
RPP-0213 localHash binds mixed resource mutations to planned local snapshots
RPP-0213 executor rejects forged or stale localHash before mutation
```

Caveat: executor rejection details use mutation ids, resource keys, and SHA-256 hashes only. The focused fixture includes private-looking local values and asserts those values do not appear in error evidence. This branch does not mark checklist state as integrated; release remains NO-GO until the integration lane accepts it.
