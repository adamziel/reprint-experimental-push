# RPP-0239 redacted raw value evidence, variant 2

Date: 2026-05-30
Lane: RPP-0239 redacted raw value evidence, variant 2
Release status: NO-GO until integration accepts the local commit.

## Claim

Operator-facing proof can remain useful without carrying raw site values. A
mixed ready plan may include executable mutation payloads internally, but the
serialized audit envelope must redact those payloads and recovery-journal value
fields while preserving resource keys, refusal codes, summary counts, and stable
hashes.

## Evidence added

- `test/rpp-0239-redacted-raw-value-evidence-v2.test.js` builds a focused ready
  plan with a file mutation, a core `wp_posts` row mutation, and an allowlisted
  plugin-owned `wp_options` mutation.
- The proof creates an intentionally raw planner/apply envelope, verifies the
  shared redaction helper detects raw evidence issues, then verifies the
  redacted envelope has no remaining redaction issues.
- Redacted mutation `value` fields and recovery-journal `beforeValue` /
  `afterValue` fields keep the redaction marker, reason, value shape metadata,
  and SHA-256 digest while omitting the underlying site bytes.
- A stale remote replay rejects with `PRECONDITION_FAILED`, preserves the remote
  snapshot, and stops before target or mutation durable-journal evidence; the
  refusal details carry resource-key and hash evidence only.
- The proof serializes the redacted envelope with a proof hash and asserts all
  fixture-private needles are absent from planner, refusal, and journal evidence.

## Commands

```sh
node --check test/rpp-0239-redacted-raw-value-evidence-v2.test.js
node --test --test-name-pattern=RPP-0239 test/rpp-0239-redacted-raw-value-evidence-v2.test.js
node --test --test-name-pattern='RPP-0219|RPP-0239' test/push-planner.test.js test/rpp-0239-redacted-raw-value-evidence-v2.test.js
node --test test/evidence-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0239-redacted-raw-value-evidence-v2.md docs/scenario-matrix.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0239-redacted-raw-value-evidence-v2.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is deterministic local Node planner/apply evidence for the
RPP-0239 slice. Release remains gated separately by the broader release
checklist and integration evidence.
