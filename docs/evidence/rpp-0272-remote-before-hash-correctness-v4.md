# RPP-0272 remoteBeforeHash correctness, variant 4

Date: 2026-05-30
Lane: RPP-0272 remoteBeforeHash correctness, variant 4
Release status: NO-GO until integration accepts the local commit.

## Claim

Focused regression coverage now proves that `remoteBeforeHash` authorizes the
same live resource the executor will mutate. Forged aliases that point a
precondition at an unrelated resource are rejected before mutation, and stale
later mutations are rejected before earlier mutations are staged.

## Evidence added

- `test/rpp-0272-remote-before-hash-correctness-v4.test.js` builds a small ready
  plan with one file mutation and one `wp_posts` row mutation.
- The planner proof asserts each mutation `remoteBeforeHash` and matching
  precondition hash equal the observed live remote resource hash, not the local
  payload hash.
- The forged-alias regression rewrites a file mutation/precondition hash to an
  unrelated sentinel file hash while forging the precondition resource key back
  to the mutation target. The executor reports `PLAN_INVARIANT_VIOLATION` with
  `PRECONDITION_RESOURCE_OBJECT_MISMATCH`, preserves the remote, and writes no
  target-planned or mutation journal evidence.
- The stale-later-mutation regression drifts only the second row target and
  proves `PRECONDITION_FAILED` happens before the first file mutation is staged.
- The executor now recomputes live precondition hashes from `mutation.resource`
  and validates comparable resource object keys, closing the forged-alias gap
  exposed by this focused regression.
- Proof envelopes use resource keys, error codes, and SHA-256 hashes only; the
  test asserts private fixture values are absent from serialized evidence.

## Commands

```sh
node --check src/apply.js
node --check test/rpp-0272-remote-before-hash-correctness-v4.test.js
node --test test/rpp-0272-remote-before-hash-correctness-v4.test.js
node --test --test-name-pattern=RPP-0212 test/push-planner.test.js
node --test test/rpp-0232-remote-before-hash-correctness-v2.test.js
node --test --test-name-pattern=RPP-0237 test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0272-remote-before-hash-correctness-v4.md docs/reprint-push-completion-checklist.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
node --test test/artifact-redaction-scan.test.js
node --test test/checklist-completion-lint.test.js
node --test --test-name-pattern=RPP-0238 test/push-planner.test.js
node --check test/rpp-0232-remote-before-hash-correctness-v2.test.js
node --check test/generated-push-harness.test.js
node --check test/artifact-redaction-scan.test.js
node --check test/checklist-completion-lint.test.js
git diff --check
git diff --cached --check
```

Caveat: executable ready plans still contain mutation payloads. This evidence
serializes only hash-only proof envelopes and refusal details, and the focused
regression asserts private fixture payloads are absent from those envelopes.
