# RPP-0095 release verifier recovery inspect carry-through

Status: focused variant-5 regression added. Release remains NO-GO.

## Scope

This slice carries the recovery inspect read-only proof through the release-verifier-shaped evidence surface into `check-release-gates` without editing shared release-verifier implementation files. That keeps the RPP-0093 through RPP-0097 parallel slices from overlapping in the verifier implementation while still pinning the RPP-0095 contract.

## Prior coverage inspected

- RPP-0075 already proves the recovery inspect gate at the release-gate boundary with negative write-observed evidence and positive read-only evidence.
- RPP-0081 through RPP-0092 establish the variant-5 carry-through pattern: verifier-shaped evidence preserves the named failure code, final bracketed marker, no mutation attempt, redaction, and exact release-gate evidence.

## Focused proof added

`test/release-verifier-recovery-inspect-carry-through-focused-regression.test.js` adds two RPP-0095 paths:

1. A recovery inspect write-observed verifier report emits the tmux-visible marker `RECOVERY_INSPECT_READ_ONLY_REQUIRED`, records `mutationAttempted: false` at the verifier boundary, and carries exact `recoveryInspectReadOnly` evidence into `check-release-gates`.
2. The positive recovery inspect read-only path keeps the gate passed with final-release evidence while the overall release remains held by production provenance.

The focused test also asserts the release-gate checker remains read-only, the release-gate status marker is held at 19/20 for the negative path, and the sentinel credential string is absent from verifier and release-gate output.

## Validation commands

```sh
node --test test/release-verifier-recovery-inspect-carry-through-focused-regression.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0095-release-verifier-recovery-inspect-carry-through.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence

git diff --check
```

Observed focused result before this note was finalized: 2 subtests passed, 0 failed.
