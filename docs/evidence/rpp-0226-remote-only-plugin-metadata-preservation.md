# RPP-0226 remote-only plugin metadata preservation evidence

Date: 2026-05-29
Lane: RPP-0226 remote-only plugin metadata preservation, variant 2
Checklist item: RPP-0226 — Prove remote-only plugin metadata preservation, variant 2.

## Invariant

A remote-only plugin metadata update must be preserved as a `keep-remote` decision. The planner must not emit a mutation or live remote precondition for the plugin metadata resource, while unrelated local mutations may proceed with their own live remote preconditions. Apply must leave the remote plugin metadata intact while applying only the intended local resources.

## Evidence added

- Focused planner/apply test in `test/remote-only-plugin-metadata-preservation-v2.test.js`: `RPP-0226 preserves remote-only plugin metadata with redacted evidence`.
- Generated harness family and test in `test/remote-only-plugin-metadata-preservation-v2.test.js`: `remote-only-plugin-metadata` / `RPP-0226 generated remote-only plugin metadata is preserved with hash-only evidence`.
- Generated fixture assertions prove the family covers tiers 0 through 9, carries the `remote-preserve` and `plugin-metadata-preserve` tags, validates stale replay refusal, and replays apply while preserving the remote-only plugin metadata.

## Redaction proof

The focused fixture uses a private local file value and private remote plugin metadata fields. The generated fixture proof uses the deterministic remote-only metadata channel markers across the harness family. Both tests serialize proof evidence using only status, summary counts, mutation identifiers, resource keys, hashes, preconditions, decisions, conflicts, blockers, and atomic-group metadata. Assertions prove this serialized evidence and plugin decision evidence omit the private raw values while stable hashes remain available for audit.

## Commands

```sh
node --check test/remote-only-plugin-metadata-preservation-v2.test.js
node --test test/remote-only-plugin-metadata-preservation-v2.test.js
node --test --test-name-pattern='RPP-0206|RPP-0226' test/push-planner.test.js test/remote-only-plugin-metadata-preservation-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0226-remote-only-plugin-metadata-preservation.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0226 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
