# RPP-0904 operator safe recovery audit variant 1

Date: 2026-06-01
Issue: RPP-0904
Lane: Reprint Push evidence

## Scope

This slice adds support-only operator documentation for safe recovery. The
runbook is `docs/recovery/operator-safe-recovery.md`, and it depends on the
existing recovery contract in `docs/recovery/apply-journal.md` and
`docs/recovery/acceptable-states.md`.

The artifact explains how an operator classifies a failed apply, what evidence
must exist before retry or finalization, and when recovery must stay blocked.
It keeps final release `NO-GO`, makes no production durability claim, and does
not alter release gates.

## Audit Record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0904",
  "variant": 1,
  "title": "Operator safe recovery documentation",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "documents": {
    "operatorRunbook": "docs/recovery/operator-safe-recovery.md",
    "stateContract": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md"
  },
  "safeRecoveryContract": {
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ],
    "unknownStateAction": "blocked-recovery",
    "missingEvidenceAction": "blocked-recovery",
    "partialRemoteWithoutArtifact": "release-blocker",
    "manualRepairAuthorized": false,
    "automatedRetryForBlockedRecovery": false
  },
  "operatorEvidenceRequired": [
    "checked-recovery-path",
    "journal-ownership",
    "restart-readable-journal",
    "monotonic-journal-order",
    "planned-target-counts",
    "before-after-target-hashes",
    "current-observed-target-hashes",
    "terminal-or-missing-terminal-evidence",
    "same-request-idempotency-replay-result",
    "hash-count-redaction-result"
  ],
  "hiddenAssumptionControls": {
    "samePathForInspectAndAction": true,
    "noStatusCodeOnlyClassification": true,
    "allTargetsAccountedFor": true,
    "currentHashesExplainState": true,
    "samePlanEnvelopeRequired": true,
    "sameRequestReplayMustBeNonMutatingOrBlocked": true,
    "unknownAnswersBlock": true
  },
  "allowedActions": {
    "old-remote": "validated-retry-only-after-revalidation",
    "fully-updated-remote": "finalize-or-replay-with-zero-fresh-mutations",
    "blocked-recovery": "stop-preserve-artifacts-review"
  },
  "forbiddenActions": [
    "manual-remote-patching",
    "retrying-blocked-recovery",
    "deleting-recovery-artifacts",
    "reusing-journal-for-different-plan",
    "release-gate-movement"
  ],
  "redactionPosture": {
    "mode": "hash-count-metadata-only",
    "rawPayloadsIncluded": false,
    "credentialsIncluded": false,
    "cookiesIncluded": false,
    "privatePathsIncluded": false,
    "liveServiceConfigurationIncluded": false
  }
}
```

## Validation

Focused validation for this slice:

```bash
node --check test/rpp-0904-operator-safe-recovery.test.js
node --test --test-name-pattern RPP-0904 test/rpp-0904-operator-safe-recovery.test.js
node scripts/release/artifact-redaction-scan.mjs docs/recovery/operator-safe-recovery.md docs/evidence/rpp-0904-operator-safe-recovery-audit.md
git diff --check
```

Observed local result after validation:

- syntax check: passed
- RPP-0904 focused test: passed
- artifact redaction scan: passed
- diff whitespace check: clean

## Release Posture

This is support-only documentation evidence. It does not prove production
storage durability, production rollback, production repair, live topology,
credentials, or release approval. Final release remains `NO-GO`.
