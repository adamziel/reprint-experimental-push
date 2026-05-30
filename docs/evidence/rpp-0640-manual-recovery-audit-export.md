# RPP-0640 manual recovery audit export evidence

Date: 2026-05-30
Issue: RPP-0640
Lane: recovery

## Proof added

- Added a hash-only manual recovery audit export builder for recovery repair
  inspections. The export records plan id, journal integrity, restart-readable
  state summaries, claim identity hashes, target counts, replay/repair decisions,
  and target before/after/observed hashes without embedding raw site values.
- The release verifier GATE-2 recovery summary now reports
  `manualRecoveryAuditExport` and includes `checks.manualRecoveryAuditExport` in
  the durable recovery gate decision.
- The release-verifier proof accepts an explicit manual audit export from the
  checked release path, or derives the same hash-only export from the recovery
  verifier summary when the live release boundary and restart-readable recovery
  inspection are already proven.

## Focused regression

`test/rpp-0640-manual-recovery-audit-export.test.js` proves the RPP-0640 path:

1. Opens a claim-fenced production recovery journal, then advances an expired
   claim without truncating the original target envelope.
2. Builds a manual recovery audit export from the same recovery repair
   inspection and asserts it is hash-only, target-complete, and does not contain
   the private base/local fixture strings.
3. Feeds that export into the release verifier recovery helper and asserts the
   same GATE-2 path reports `gateStatus: proven`, `sameReleaseBoundary: true`,
   `checks.manualRecoveryAuditExport: true`, and
   `manualRecoveryAuditExport.proved: true`.

## Validation run

```bash
node --test test/rpp-0640-manual-recovery-audit-export.test.js
node --test test/recovery-repair.test.js
node --test --test-name-pattern 'durable recovery journal release proof' test/production-shaped-proof.test.js
node --test test/recovery-journal.test.js
```

Observed result: the focused RPP-0640 test exited 0 with 1 subtest, the recovery
repair suite exited 0 with 5 subtests, the focused release-verifier recovery
proof exited 0 with 1 subtest, and the full recovery journal suite exited 0 with
43 subtests.

## Residual scope

This evidence is limited to the manual recovery audit export and its GATE-2
release-verifier reporting. Generated coverage, route-level HTTP recovery
surfaces, plugin-driver verifier files, executor-auth routes, storage performance,
and release-ops runbooks remain outside this slice.
