# RPP-0700 manual recovery audit export release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0700
Lane: recovery release-verifier carry-through

## Scope

This is local support-only evidence for the manual recovery audit export path.
It uses deterministic sandbox fixtures and a release-verifier-shaped proof on
the sandbox-local 8080 ingress shape. It does not use live production-backed
durable storage, external endpoints, remote tunnels, credentials, or raw private
values, and it does not claim final release readiness.

## Proof added

- Added standalone coverage in
  `test/rpp-0700-manual-recovery-audit-export-v5.test.js`.
- The accepted fixture builds a four-target ready plan, derives a hash-only
  manual recovery audit export from `releaseProof.recoveryInspect.recovery`,
  and records the same checked recovery path used by the replay-and-retry
  evidence.
- The audit export source is release-path, read-only, non-mutating, and requires
  a fresh inspect before any manual recovery mutation.
- The accepted export is passed through
  `buildDurableRecoveryJournalReleaseProof()` with a local
  release-verifier-shaped durable journal summary. The proof reports
  `gate: "GATE-2"`, `durableRecoveryJournalBoundary: "release-verifier"`,
  `gateStatus: "proven"`, `sameReleaseBoundary: true`,
  `checks.manualRecoveryAuditExport: true`, and
  `manualRecoveryAuditExport.proved: true`.
- Same-path carry-through is asserted by the recovery inspect path, the audit
  artifact reference, the replay-and-retry required and observed paths, and the
  same-key replay-after-rejection checked-path proof.
- A support-only evidence envelope allows recovery-gate movement for the valid
  local fixture while keeping `releaseStatus: "NO-GO"` and
  `releaseMovement.allowed: false`.
- Generated malformed fixtures cover missing, non-read-only source,
  state-mismatch, count-mismatch, non-hash-only target envelope, and
  target-count-mismatch cases. Invalid explicit audit exports keep the release
  proof at `ok: false` with `checks.manualRecoveryAuditExport: false`, and the
  support envelope denies recovery-gate movement.

## Hash-only fixture notes

- Fixture site values are deterministic private sentinels, but the test scans
  the audit export, direct audit proof, release summary, release proof,
  malformed fixtures, and support evidence to ensure those raw values are not
  present.
- Target evidence uses before, after, and observed SHA-256-shaped hashes only.
  Claim, request, audit, path, boundary, and support identities are deterministic
  hashes or local `artifact://` references.
- The proof does not include bearer values, raw request bodies, response bodies,
  credentials, external URLs, production-owned values, or remote tunnel output.

## Validation run

```bash
node --check test/rpp-0700-manual-recovery-audit-export-v5.test.js
node --test --test-name-pattern RPP-0700 test/rpp-0700-manual-recovery-audit-export-v5.test.js
node --test --test-name-pattern RPP-0680 test/rpp-0680-manual-recovery-audit-export-v4.test.js
node --test --test-name-pattern RPP-0660 test/rpp-0660-manual-recovery-audit-export-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0700-manual-recovery-audit-export-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0700 release-verifier manual recovery audit proof passed 2
  subtests, 0 failures.
- RPP-0680 manual recovery audit predecessor passed locally.
- RPP-0660 manual recovery audit predecessor passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This proof is local support-only generated recovery evidence. It proves the
manual recovery audit export carries through the release verifier recovery gate
on the same checked path, but it does not update checklist state, progress
artifacts, release status, or production boundary claims. Final release remains
NO-GO until equivalent production-backed durable journal and live
release-boundary evidence exists.

Integration recommendation: carry this as local recovery-gate support evidence
only; require production-backed durable journal evidence before release
movement.
