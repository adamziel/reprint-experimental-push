# RPP-0253 localHash correctness variant 3 evidence

Date: 2026-05-30
Lane: RPP-0253 localHash correctness, variant 3
Checklist item: RPP-0253 — Add generated coverage for localHash correctness, variant 3.

## Invariant

Generated ready-plan mutations must carry `localHash` evidence that binds to the serialized planned resource value and, for non-rewritten resources, to the generated local snapshot. Serialized proof evidence for the plan must remain hash-only: it may contain resource keys, counts, issue codes, and hashes, but not raw generated mutation payloads or raw forged private strings. A ready plan with a raw invalid `localHash` must fail closed before any remote mutation or durable journal write.

## Evidence added

- Focused generated proof: `test/rpp-0253-local-hash-correctness-v3.test.js`.
- Test name: `RPP-0253 generated localHash correctness variant 3 serializes hash-only evidence`.
- The proof reuses `generatePushHarnessCases`, `createPushPlan`, and `applyPlan`; no generated harness source or production route code changed.
- The proof iterates the default generated harness set of 620 cases. In this run it covered 8,515 emitted mutations overall, including 6,233 mutations across 344 ready generated plans with mutations, 35 ready families, and tiers 0 through 9.

## Redaction and fail-closed proof

For every generated mutation, the test asserts that `localHash` is a SHA-256 hex value matching the hash of `deserializeResourceValue(mutation.value)`. For non-rewritten generated resources, it also asserts the same value matches `resourceHash(testCase.local, mutation.resource)`. For every generated ready plan with at least one mutation, the test forges the first mutation's `localHash` to a raw private string and verifies `applyPlan` raises `PLAN_INVARIANT_VIOLATION` with `LOCAL_HASH_INVALID`, leaves the remote snapshot byte-for-byte unchanged, and writes no durable journal events.

The serialized proof envelope stores only hash evidence, counts, resource keys, issue codes, and a proof hash. It is checked with `findEvidenceRedactionIssues`, and the test asserts that neither serialized plan evidence nor refusal details contain the raw generated mutation payloads or forged raw private strings.

## Commands

```sh
node --check test/rpp-0253-local-hash-correctness-v3.test.js
node --test test/rpp-0253-local-hash-correctness-v3.test.js
node --test test/local-hash-correctness-rpp-0213.test.js
node --test --test-name-pattern=RPP-0233 test/push-planner.test.js
node --test --test-name-pattern=RPP-0233 test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0253-local-hash-correctness-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0253 generated coverage slice. It does not carry the invariant through the release verifier; later release-verifier checklist items remain separate gates.
