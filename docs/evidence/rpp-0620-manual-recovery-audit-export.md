# RPP-0620 manual recovery audit export evidence

Date: 2026-05-30
Issue: RPP-0620
Lane: recovery

## Proof added

- Added `src/recovery-audit-export.js`, a hash-only manual recovery audit
  export builder and atomic JSON writer for recovery inspection and repair
  reports.
- The export records the recovery source path, plan id/hash, counts, target
  before/after/observed hashes, rollback boundary, journal summary, and a
  non-mutating operator decision template for drifted targets.
- The export fail-closes through the shared evidence redaction guard before it
  can be returned or written.
- The release verifier helper now derives or consumes the export from
  `releaseProof.recoveryInspect.recovery` and reports
  `checks.manualRecoveryAuditExport: true` when it is read-only, hash-only, count
  consistent, and bound to the same recovery gate path.

## Focused regression

`test/rpp-0620-manual-recovery-audit-export.test.js` covers two paths:

1. A drifted recovery repair report exports exactly 4 hash-only targets, names
   the single drifted target in the operator decision template, excludes raw
   file contents, and writes the same audited JSON artifact to disk.
2. The durable recovery journal release verifier derives the export from the
   recovery inspect result and reports `GATE-2`, `gateStatus: proven`, and
   `manualRecoveryAuditExport.proved: true` on that same path.

## Validation run

```bash
node --check src/recovery-audit-export.js
node --check scripts/playground/production-shaped-live-release-verify-lib.js
node --check test/rpp-0620-manual-recovery-audit-export.test.js
node --test test/rpp-0620-manual-recovery-audit-export.test.js
node --test --test-name-pattern 'durable recovery journal release proof binds|claim expiry' test/production-shaped-proof.test.js test/recovery-journal.test.js
node --test test/recovery-repair.test.js
node --test test/production-shaped-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0620-manual-recovery-audit-export.md
```

Observed result: syntax checks exited 0; the focused RPP-0620 test exited 0
with 2 passing subtests; the release verifier/recovery journal regression slice
exited 0 with 2 passing subtests; recovery repair exited 0 with 5 passing
subtests; the full production-shaped proof unit file exited 0 with 123 passing
and 11 skipped subtests; checklist lint and the evidence redaction scan exited
0.

## Residual scope

This slice proves the variant-1 manual audit export and release verifier
carry-through. Later variants can add additional generated coverage, live route
surfacing, and broader recovery-mutate operator workflows.
