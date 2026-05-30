# RPP-0161 file create/update/delete mix variant 4

Status: focused generated-harness regression proof added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 adds an explicit `fileCreateUpdateDeleteMixVariant4` target coverage
surface for the deterministic generated file create/update/delete mix. The
variant-4 tag is emitted on both the ready family and the conflicting family so
the summary proves the generator still emits at least one ready case and one
non-ready case for this target.

## Evidence surface

- `scripts/harness/generated-push-cases.js` tags file mix cases with
  `file-create-update-delete-mix-v4` plus ready/non-ready variant-4 tags and
  exposes `summary.targetCoverage.fileCreateUpdateDeleteMixVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0161 file create/update/delete
  mix variant 4 retains focused ready and non-ready regression coverage`.
- The focused test recounts all variant-4 target cases, cross-checks the summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  non-ready conflict case for invariant checks.
- The ready selected case proves the generated create/update/delete file
  mutations apply local hashes, preserve the remote-only file, and reject stale
  replay before mutation.
- The non-ready selected case proves the remote drift on the updated file
  remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote
  digest unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits generated file
  payloads and conflicting remote file payloads.

Deterministic target shape observed locally:

```json
{
  "fileCreateUpdateDeleteMixVariant4": {
    "family": "file-create-update-delete-mix-variant4",
    "total": 20,
    "perTier": {
      "0": 2,
      "1": 2,
      "2": 2,
      "3": 2,
      "4": 2,
      "5": 2,
      "6": 2,
      "7": 2,
      "8": 2,
      "9": 2
    },
    "statuses": {
      "conflict": 10,
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready file mix case and one non-ready conflict file mix case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0161 test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0141 test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0161-file-create-update-delete-mix-v4.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed focused result: RPP-0161 reported 1 subtest, 0 failures.

Observed broader results:

- Adjacent RPP-0141 generated-harness slice reported 1 subtest, 0 failures.
- `npm run test:generated-push-harness` reported 67 subtests, 0 failures.
- Checklist completion lint returned `"ok": true` with 0 risky claims.
- Scoped artifact redaction scan returned `"ok": true` with 0 rejected files.
- `git diff --check` reported no whitespace errors.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
