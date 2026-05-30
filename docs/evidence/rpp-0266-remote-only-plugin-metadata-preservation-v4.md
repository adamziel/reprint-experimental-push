# RPP-0266 remote-only plugin metadata preservation v4 evidence

Date: 2026-05-30
Lane: RPP-0266 remote-only plugin metadata preservation, variant 4
Checklist item: RPP-0266 — Add focused regression coverage for remote-only plugin metadata preservation, variant 4.

## Invariant

Remote-only plugin metadata must stay a `keep-remote` decision while independent local mutations proceed. The planner must not emit a plugin metadata mutation or live-remote precondition, every planned local mutation keeps its own live-remote precondition, and apply must preserve the live remote plugin metadata object.

## Evidence added

- Focused planner/apply regression in `test/rpp-0266-remote-only-plugin-metadata-preservation-v4.test.js`: `RPP-0266 focused remote-only plugin metadata survives independent local mutations`.
- Generated fixture proof in the same file: `RPP-0266 generated remote-only plugin metadata fixtures preserve the live remote object`.
- The generated proof reuses the existing `remote-only-plugin-metadata` generated family, verifies one case in each tier 0 through 9, requires the `remote-preserve` and `plugin-metadata-preserve` tags, validates stale replay refusal, and reapplies the plan while checking the plugin metadata hash remains the live remote hash.

## Redaction proof

The focused fixture carries private local file/post values and nested private remote plugin metadata fields. Generated fixture proof checks the deterministic remote metadata channel marker. The test serializes only status, summary counts, resource keys, hashes, preconditions, decisions, validation booleans, and durable mutation-event metadata. Assertions prove hash-only plan evidence, plugin decision evidence, and durable journal events omit raw local values and remote metadata values.

## Commands

```sh
node --check test/rpp-0266-remote-only-plugin-metadata-preservation-v4.test.js
node --test test/rpp-0266-remote-only-plugin-metadata-preservation-v4.test.js
node --test --test-name-pattern='RPP-0206|RPP-0226|RPP-0246|RPP-0266' test/push-planner.test.js test/remote-only-plugin-metadata-preservation-v2.test.js test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js test/rpp-0266-remote-only-plugin-metadata-preservation-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0266-remote-only-plugin-metadata-preservation-v4.md docs/reprint-push-completion-checklist.md
```

Caveat: this is local Node planner/apply evidence for the RPP-0266 slice. It does not change release verifier routes or production release verdicts; release remains gated by the integration/release evidence flow.
