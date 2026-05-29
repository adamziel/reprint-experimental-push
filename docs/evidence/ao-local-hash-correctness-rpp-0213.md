# AO localHash correctness evidence for RPP-0213

Date: 2026-05-29
Lane: RPP-0213 localHash correctness
Checklist item: RPP-0213 — localHash correctness, variant 1.

## What changed

- Added focused planner/executor coverage for mixed file, core row, and allowlisted plugin-owned row mutations.
- Proved every emitted mutation `localHash` is a SHA-256 hex digest of both the local snapshot resource and the serialized planned resource value.
- Proved missing, malformed, wrong, stale-value, and stale-snapshot `localHash` attempts fail closed before remote mutation or durable journal writes.
- Serialized only hash/redacted plan evidence and asserted private fixture values never appear in ready-plan or refusal evidence.
- Marked the RPP-0213 checklist row after the focused localHash evidence passed.

## Evidence

Focused command:

```sh
node --test test/local-hash-correctness-rpp-0213.test.js
```

Focused tests:

```text
RPP-0213 localHash binds mixed resource mutations to planned local snapshots
RPP-0213 executor rejects forged or stale localHash before mutation
```

Additional local validation:

```sh
node --check test/local-hash-correctness-rpp-0213.test.js
node --test --test-name-pattern=RPP-0213 test/local-hash-correctness-rpp-0213.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/ao-local-hash-correctness-rpp-0213.md docs/reprint-push-completion-checklist.md
```

Caveat: executable ready plans still carry mutation payloads. The serialized proof evidence for this slice uses hash-only `localHash`/`remoteBeforeHash` fields and redacted planned resource/change evidence, and the tests assert the private fixture values are absent from both serialized evidence and executor refusal details.
