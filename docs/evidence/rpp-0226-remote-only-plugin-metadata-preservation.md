# RPP-0226 remote-only plugin metadata preservation evidence

Date: 2026-05-28
Lane: RPP-0226 remote-only plugin metadata preservation, variant 2
Checklist item: RPP-0226 — Prove remote-only plugin metadata preservation, variant 2.

## Invariant

A remote-only plugin metadata update must be preserved as a `keep-remote` decision. The planner must not emit a mutation or live remote precondition for the plugin metadata resource, while unrelated local mutations may proceed with their own live remote preconditions. Apply must leave the remote plugin metadata intact while applying only the intended local resources.

## Evidence added

- Focused planner/apply test: `RPP-0226 preserves remote-only plugin metadata with redacted evidence`.
- Generated harness family and test: `remote-only-plugin-metadata` / `RPP-0226 generated remote-only plugin metadata is preserved with hash-only evidence`.
- Generated target coverage records `remote-only-plugin-metadata` across all complexity tiers.

## Redaction proof

The focused fixture uses a private local file value and private remote plugin metadata fields. The generated fixture does the same across the harness family. Both tests serialize proof evidence using only status, summary counts, mutation identifiers, resource keys, hashes, preconditions, decisions, conflicts, blockers, and atomic-group metadata. Assertions prove this serialized evidence and plugin decision evidence omit the private raw values while stable hashes remain available for audit.

## Commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --check test/push-planner.test.js
node --test test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0226-remote-only-plugin-metadata-preservation.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0226 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
