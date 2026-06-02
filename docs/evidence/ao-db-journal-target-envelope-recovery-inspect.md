# DB target-envelope recovery inspect

Date: 2026-06-02

Status: local Playground REST/DB journal support evidence only. Final release
remains **NO-GO**.

## Claim

Recovery inspect must not classify a previously started apply from
caller-supplied plan material alone when the DB journal says a durable
`target-planned` envelope was required.

## Evidence

- `scripts/playground/push-remote-rest-plugin.php` now checks for an
  `apply-started` DB journal row on recovery inspect. When found, it validates
  persisted `target-planned` rows against the inspected plan/receipt target set
  before classifying live hashes.
- Missing or mismatched target rows produce read-only `blocked-recovery`
  evidence with `DB_JOURNAL_TARGET_ENVELOPE_MISSING` or
  `DB_JOURNAL_TARGET_ENVELOPE_MISMATCH`, `usedOptionJournal=false`, and a
  hash-only target-envelope summary.
- `scripts/playground/db-journal-missing-commit-finalization-smoke.mjs` now
  covers the missing-envelope negative: the first apply writes the target data
  and omits `target-planned` rows; `/recovery/inspect` remains non-mutating and
  reports blocked recovery instead of treating the caller plan as sufficient.

## Validation

Commands run:

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --check scripts/playground/db-journal-missing-commit-finalization-smoke.mjs
node --test test/production-recovery-mutate-route.test.js test/production-apply-route.test.js
timeout 900s node scripts/playground/db-journal-missing-commit-finalization-smoke.mjs
git diff --check
```

Observed results: PHP syntax passed; JS syntax passed; focused source tests
passed 12/12; the live missing-commit smoke exited 0 and reported
`inspectState: "blocked-recovery"`, `inspectCode:
"DB_JOURNAL_TARGET_ENVELOPE_MISSING"`, `inspectUsedOptionJournal: false`, zero
`target-planned` rows, zero `apply-committed` rows, and unchanged target
snapshot after inspect.

## Boundary

This is local lab evidence. It improves the recovery-inspect contract by
requiring durable DB target-envelope evidence when an apply-started row exists,
but it does not prove production durability, storage `fsync`, rollback,
exactly-once production writes, MySQL/InnoDB behavior, or kill-process coverage
for every WordPress durable boundary.
