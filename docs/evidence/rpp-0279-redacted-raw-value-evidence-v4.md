# RPP-0279 redacted raw value evidence, variant 4

Date: 2026-05-30
Lane: RPP-0279 redacted raw value evidence, variant 4
Checklist item: RPP-0279 — Add focused regression coverage for redacted raw value evidence, variant 4.

## Invariant

Focused partial-commit recovery evidence must be safe to serialize for audit:
planner mutation payloads and in-memory recovery journal `beforeValue` /
`afterValue` fields are redacted with SHA-256 digests, durable recovery journal
records stay hash-only, and a blocked-recovery `recovery.artifacts.remote` site
snapshot is summarized before it can expose file bytes or row payloads.

## Evidence added

- `test/rpp-0279-redacted-raw-value-evidence-v4.test.js` builds a mixed ready
  plan with a file mutation, a core `wp_posts` row mutation, and an allowlisted
  plugin-owned `wp_options` mutation.
- The proof injects a failure during the first commit with a fenced durable
  recovery journal, producing `blocked-recovery` evidence and durable records
  through `mutation-observed` / `recovery-state`.
- Durable records are checked with `assertJournalRecordHasNoRawValues()` and
  scanned for fixture-private needles.
- The raw audit envelope intentionally includes plan mutation payloads and the
  partial recovery remote snapshot; the redaction scanner flags the raw snapshot,
  then the redacted envelope carries only redaction summaries, resource keys,
  counts, refusal code, and hashes.

## Scenario matrix row

`docs/scenario-matrix.md` names the behavior as "Redacted raw value evidence,
variant 4" and records the focused command:

```sh
node --test --test-name-pattern=RPP-0279 test/rpp-0279-redacted-raw-value-evidence-v4.test.js
```

## Commands

```sh
node --check src/evidence-redaction.js
node --check test/rpp-0279-redacted-raw-value-evidence-v4.test.js
node --test --test-name-pattern=RPP-0279 test/rpp-0279-redacted-raw-value-evidence-v4.test.js
node --test --test-name-pattern='RPP-0219|RPP-0239|RPP-0279' test/push-planner.test.js test/rpp-0239-redacted-raw-value-evidence-v2.test.js test/rpp-0279-redacted-raw-value-evidence-v4.test.js
node --test test/evidence-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0279-redacted-raw-value-evidence-v4.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0239-redacted-raw-value-evidence-v2.md docs/evidence/rpp-0279-redacted-raw-value-evidence-v4.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0279 slice.
Release remains governed by the broader integration and release evidence flow.
