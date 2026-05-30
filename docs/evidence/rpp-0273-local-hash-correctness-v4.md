# RPP-0273 localHash correctness variant 4 evidence

Date: 2026-05-30
Lane: RPP-0273 localHash correctness, variant 4
Checklist item: RPP-0273 — Add focused regression coverage for localHash correctness, variant 4.

## Invariant

Focused delete mutations must carry a `localHash` for the absent local snapshot, not a stale hash from the previous private payload. Serialized plan and refusal evidence for this slice must contain only hashes, resource keys, counts, redacted payload summaries, and change metadata; it must not include raw private file, row, or plugin-option values.

## Evidence added

- Focused regression proof: `test/rpp-0273-local-hash-correctness-v4.test.js`.
- Test names:
  - `RPP-0273 localHash binds delete mutations to absent local snapshots`
  - `RPP-0273 executor rejects stale localHash delete evidence before mutation`
- The fixture deletes a file, a core post row, and an allowlisted plugin-owned option row with delete support enabled.
- Each emitted delete mutation is checked against both `resourceHash(local, mutation.resource)` and the digest of the serialized absent planned value.

## Redaction and refusal proof

The focused proof serializes hash/redacted plan evidence and runs `findEvidenceRedactionIssues` before scanning for the fixture's private values. It also verifies forged delete plans fail before mutation when `localHash` is a raw invalid value, a stale hash from the pre-delete payload, or a resurrected payload paired with the absent `localHash`. For each refusal, replay remote state and durable journal events remain unchanged, and redacted refusal details are scanned for the same private values.

## Commands

```sh
node --check test/rpp-0273-local-hash-correctness-v4.test.js
node --test test/rpp-0273-local-hash-correctness-v4.test.js
node --test --test-name-pattern=RPP-0213 test/local-hash-correctness-rpp-0213.test.js
node --test --test-name-pattern=RPP-0233 test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0273-local-hash-correctness-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is focused local Node planner/apply regression coverage. It does not replace broader generated-harness or release-verifier gates.
