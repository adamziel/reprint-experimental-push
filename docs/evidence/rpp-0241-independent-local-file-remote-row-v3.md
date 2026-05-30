# RPP-0241 independent local file plus remote row edit variant 3 evidence

Date: 2026-05-30
Lane: RPP-0241 independent local file plus remote row edit, variant 3
Checklist item: RPP-0241 — Add generated coverage for independent local file plus remote row edit, variant 3.

## Invariant

A local file mutation may be applied while an independent remote `wp_posts` row edit is preserved. The planner must emit a file mutation with a live-remote precondition, record the remote row as hash-only `keep-remote` evidence, and apply only planned file mutations without overwriting the unplanned row.

## Evidence added

- Focused node proof: `RPP-0241 focused independent local file plus remote row edit stays hash-only and unplanned-safe, variant 3`.
- Generated node proof: `RPP-0241 generated independent local file plus remote row edit covers every tier, variant 3`.
- The generated proof filters the existing deterministic `independent-local-and-remote` generated fixtures, requires the `independent-file-remote-row` tag, verifies coverage of tiers 0 through 9, validates the generated apply contract, and replays the target invariant for each generated case.

## Redaction and no-unplanned-mutation proof

The focused fixture uses private local file and remote row values, then serializes only status, summary counts, resource keys, mutation hashes, precondition hashes, decision hashes, and durable journal metadata. Assertions prove the hash-only evidence, row decision, and durable journal events omit both raw values.

For focused and generated fixtures, the target remote row has no mutation, no live-remote precondition, and no planned/observed mutation journal event. Apply writes the local file value and preserves the remote row title and remote row hash. Generated validation also confirms stale replay fails with `PRECONDITION_FAILED` while the remote snapshot remains unchanged.

## Commands

```sh
node --check test/rpp-0241-independent-local-file-remote-row-v3.test.js
node --check scripts/harness/generated-push-cases.js
node --check src/planner.js
node --check src/apply.js
node --test test/rpp-0241-independent-local-file-remote-row-v3.test.js
node --test --test-name-pattern='RPP-0201|RPP-0221|combines non-overlapping local and remote changes' test/push-planner.test.js
node --test --test-name-pattern='RPP-0221 generated harness preserves independent local files and remote rows' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0241-independent-local-file-remote-row-v3.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Caveat: this is local planner/apply and generated-fixture evidence for the RPP-0241 slice. It does not change release verdict state; release remains governed by the integrated release gate evidence.
