# RPP-0246 remote-only plugin metadata preservation v3 evidence

Date: 2026-05-30
Lane: RPP-0246 remote-only plugin metadata preservation, variant 3
Checklist item: RPP-0246 — Add generated coverage for remote-only plugin metadata preservation, variant 3.

## Invariant

Remote-only plugin metadata must remain a hash-only `keep-remote` decision. The planner must not emit a plugin metadata mutation or live-remote precondition, independent local mutations keep their own live-remote preconditions, apply preserves the remote metadata object, and stale replay of a planned mutation refuses before any remote mutation.

## Evidence added

- Focused planner/apply proof in `test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js`: `RPP-0246 focused remote-only plugin metadata is preserved with hash-only evidence`.
- Generated fixture proof in the same file: `RPP-0246 generated remote-only plugin metadata coverage preserves metadata and refuses stale replay`.
- The generated proof reuses the existing `remote-only-plugin-metadata` generated family, verifies one case in each tier 0 through 9, requires `remote-preserve` and `plugin-metadata-preserve` tags, validates stale replay refusal, and replays apply while checking the remote plugin metadata hash is the applied hash.

## Redaction proof

The focused fixture carries private local file/post values and private remote plugin metadata fields. The generated fixture proof checks the deterministic remote metadata channel marker. The test serializes only statuses, counts, resource keys, hashes, preconditions, decisions, validation booleans, and durable mutation-event metadata. Assertions prove hash-only plan evidence, plugin decision evidence, stale replay evidence, and durable journal events omit raw local values, remote metadata values, and injected stale replay payloads.

## Commands

```sh
node --check test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js
node --test test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js
node --test --test-name-pattern='RPP-0206|RPP-0226|RPP-0246' test/push-planner.test.js test/remote-only-plugin-metadata-preservation-v2.test.js test/rpp-0246-remote-only-plugin-metadata-preservation-v3.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0246-remote-only-plugin-metadata-preservation-v3.md
```

Caveat: this is local Node planner/apply evidence for the RPP-0246 slice. It does not change release verifier routes or production release verdicts; release remains gated by the integration/release evidence flow.
