# RPP-0680 manual recovery audit export, variant 4

Date: 2026-05-31
Issue: RPP-0680
Lane: recovery

## Scope

This is generated local support evidence for the manual recovery audit export
path. It uses the sandbox-local `127.0.0.1:8080` release shape only, does not
use live endpoints, and does not claim final release readiness.

## Proof added

- Added `test/rpp-0680-manual-recovery-audit-export-v4.test.js`.
- The accepted fixture builds a canonical hash-only manual recovery audit export
  from `releaseProof.recoveryInspect.recovery`.
- The export records the same checked recovery path used by the release-shaped
  replay-and-retry evidence, keeps the source read-only and non-mutating, and
  requires a fresh inspect before any manual recovery mutation.
- The accepted export is passed into
  `buildDurableRecoveryJournalReleaseProof()` on the same release verifier path.
  The verifier reports `GATE-2`, `gateStatus: proven`,
  `sameReleaseBoundary: true`, `checks.manualRecoveryAuditExport: true`, and
  `manualRecoveryAuditExport.proved: true`; the replay-and-retry proof reports
  `sameCheckedRecoveryPath: true`.
- Generated malformed fixtures cover missing, non-read-only source,
  state-mismatch, count-mismatch, non-hash-only target envelope, and
  target-count-mismatch cases. Invalid explicit audit exports keep the release
  proof at `ok: false` with `checks.manualRecoveryAuditExport: false`.

## Hash-only fixture notes

- Fixture site values are private sentinels, but the generated audit, direct
  audit proof, release summary, release proof, and malformed fixtures are
  scanned by the test to ensure none of those raw values appear.
- Target evidence uses before, after, and observed hashes only. Claim and
  request identities are deterministic 64-character SHA-256-shaped values.
- No credentials, bearer values, raw request bodies, live endpoint output, or
  remote tunnel services are used.

## Validation run

```bash
node --check test/rpp-0680-manual-recovery-audit-export-v4.test.js
node --test --test-name-pattern RPP-0680 test/rpp-0680-manual-recovery-audit-export-v4.test.js
node --test --test-name-pattern RPP-0660 test/rpp-0660-manual-recovery-audit-export-v3.test.js
node --test --test-name-pattern RPP-0640 test/rpp-0640-manual-recovery-audit-export.test.js
node --test --test-name-pattern RPP-0620 test/rpp-0620-manual-recovery-audit-export.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0680-manual-recovery-audit-export-v4.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all listed commands exited 0.

## Residual scope

This proof is support-only generated recovery evidence. It does not update
checklist state, progress artifacts, release status, plugin-driver behavior,
executor-auth routes, storage benchmarks, or production boundary claims.
