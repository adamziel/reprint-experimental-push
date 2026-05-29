# AO remoteBeforeHash correctness evidence for RPP-0212

Date: 2026-05-29
Lane: RPP-0212 remoteBeforeHash correctness
Checklist item: RPP-0212 — remoteBeforeHash correctness, variant 1.

## What changed

- Added an executor-side fail-closed guard that rejects ready plans whose emitted mutation `remoteBeforeHash` evidence is missing, malformed, or different from the live remote resource hash.
- Added a focused mixed resource fixture covering a file, a core row, and an allowlisted plugin-owned row.
- Added forged-plan coverage for missing, malformed, wrong, and stale `remoteBeforeHash` attempts before mutation.
- Marked the RPP-0212 checklist row after the focused executor evidence was added.

## Evidence

Focused command:

```sh
node --test --test-name-pattern=RPP-0212 test/push-planner.test.js
```

Focused tests:

```text
RPP-0212 remoteBeforeHash matches live remote for mixed resource mutations
RPP-0212 executor rejects missing wrong or stale remoteBeforeHash before mutation
```

Additional local validation:

```sh
node --check src/apply.js && node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0238 test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/ao-remote-before-hash-correctness-rpp-0212.md docs/reprint-push-completion-checklist.md
git diff --check
```

Caveat: executor rejection details use mutation ids, resource keys, and SHA-256 hashes only. The focused fixture includes private-looking local and stale remote values and asserts those values do not appear in refusal evidence. Work remains local until the integration lane accepts the commit.
