# RPP-0261 independent local file plus remote row edit variant 4 evidence

Date: 2026-05-30
Lane: RPP-0261 independent local file plus remote row edit, variant 4
Checklist item: RPP-0261 — Add focused regression coverage for independent local file plus remote row edit, variant 4.

## Invariant

A local file mutation may be applied while an independent remote `wp_posts` row edit is preserved. The planner must emit a file mutation with a live-remote precondition, keep the remote row as hash-only `keep-remote` decision evidence, and apply only planned file mutations without overwriting the unplanned row.

## Evidence added

- Focused node proof: `RPP-0261 focused independent local file plus remote row edit preserves row with hash-only evidence, variant 4`.
- Generated node proof: `RPP-0261 generated independent local file plus remote row edit covers every tier, variant 4`.
- The generated proof filters the deterministic `independent-local-and-remote` generated fixtures, requires the `independent-file-remote-row` tag, verifies tiers 0 through 9, validates the generated apply contract, and replays the target invariant for each generated fixture.

## Redaction and no-unplanned-mutation proof

The focused fixture creates a local-only file while the remote edits a post title. The test serializes only status, summary counts, resource keys, hashes, precondition hashes, decision hashes, and durable journal metadata. Assertions prove that hash-only evidence, the row decision, and durable journal events omit the raw local file payload and raw remote row title.

For focused and generated fixtures, the target remote row has no mutation, no live-remote precondition, and no planned or observed mutation journal event. Apply writes the local file value, preserves the remote row title, and leaves the remote row hash unchanged. Focused stale replay also fails with `PRECONDITION_FAILED` without mutating the drifted remote; generated validation asserts the same stale-replay behavior for all tiers.

## Commands

```sh
node --check test/rpp-0261-independent-local-file-remote-row-v4.test.js
node --test test/rpp-0261-independent-local-file-remote-row-v4.test.js
node --check test/rpp-0241-independent-local-file-remote-row-v3.test.js
node --test test/rpp-0241-independent-local-file-remote-row-v3.test.js
node --test --test-name-pattern='RPP-0201|RPP-0221|combines non-overlapping local and remote changes' test/push-planner.test.js
node --test --test-name-pattern='RPP-0221 generated harness preserves independent local files and remote rows' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0261-independent-local-file-remote-row-v4.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Caveat: this is local planner/apply and generated-fixture evidence for the RPP-0261 slice. It does not change release verdict state; release remains governed by the integrated release gate evidence.
