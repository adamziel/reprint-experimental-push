# RPP-0909 Operator Runbook Evidence Variant 1

Date: 2026-06-01
Issue: RPP-0909
Lane: Reprint Push evidence

## Scope

This slice adds a support-only production operation runbook at
`docs/operations/operator-runbook.md`. The runbook documents prerequisites,
evidence capture, stop conditions, recovery classification, and hidden
assumption checks for safe operator behavior.

The artifact does not update checklist, progress-page, release-gate, or status
surfaces. It does not start dashboards, invoke remote tunnels, approve
production repair, or convert lab recovery evidence into production-backed
release evidence. Final release remains `NO-GO`.

## Evidence Record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0909",
  "proofId": "rpp-0909-operator-runbook-v1",
  "variant": 1,
  "title": "Operator runbook for safe production operation and recovery assumptions",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "documents": {
    "operatorRunbook": "docs/operations/operator-runbook.md",
    "recoveryStates": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md",
    "safeRecovery": "docs/recovery/operator-safe-recovery.md"
  },
  "operatorRunbookContract": {
    "safeProductionOperation": true,
    "noHiddenRecoveryAssumptions": true,
    "productionApplyRequiresSeparateGate": true,
    "normalValidatedApplyOnly": true,
    "manualProductionRepairAuthorized": false,
    "releaseGateMovement": "none",
    "dashboardsStarted": false,
    "remoteTunnelsUsed": false
  },
  "prerequisites": [
    "separate-release-gate-approval",
    "source-target-identity-verification",
    "immutable-plan-and-receipt-identifiers",
    "clean-dry-run-result",
    "current-precondition-hashes",
    "single-writer-lease",
    "durable-restart-readable-journal",
    "idempotency-key-hash",
    "backup-or-snapshot-reference",
    "named-operator-reviewer-recovery-owner",
    "approved-authentication-material-not-copied",
    "local-only-network-posture"
  ],
  "evidenceRequired": [
    "run-identifier",
    "release-gate-decision",
    "source-target-identity-hashes",
    "plan-hash",
    "receipt-identifier",
    "mutation-and-target-counts",
    "dry-run-status",
    "precondition-hashes",
    "lease-owner-hash",
    "journal-location-hash",
    "journal-boundary-records",
    "per-target-before-after-observed-hashes",
    "terminal-or-missing-terminal-evidence",
    "same-request-idempotency-replay-result",
    "artifact-redaction-result"
  ],
  "stopConditions": [
    "missing-or-wrong-release-gate-approval",
    "ambiguous-source-or-target-identity",
    "missing-stale-unowned-or-contested-lease",
    "missing-uninspectable-unowned-nonmonotonic-journal",
    "unresolved-dry-run-conflicts",
    "precondition-drift",
    "plan-or-target-count-mismatch",
    "unexplained-current-hash",
    "missing-terminal-evidence-after-mutation-boundary",
    "completed-replay-would-create-fresh-mutations",
    "manual-production-edit-required",
    "raw-or-sensitive-evidence-captured",
    "remote-tunnel-or-unapproved-ingress-required",
    "blocked-recovery",
    "unknown-hidden-assumption-answer"
  ],
  "recoveryPolicy": {
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ],
    "unknownStateAction": "blocked-recovery",
    "missingEvidenceAction": "stop-preserve-artifacts-review",
    "statusCodeOnlyClassificationAllowed": false,
    "sameRecoveryPathRequired": true,
    "samePlanEnvelopeRequired": true,
    "sameRequestReplayMustBeNonMutatingOrBlocked": true,
    "manualPatchingAllowed": false
  },
  "hiddenAssumptionControls": {
    "releaseGateBoundToRun": true,
    "sourceTargetPairExplicit": true,
    "samePathForInspectionAndAction": true,
    "restartReadableJournalRequired": true,
    "allTargetsAccountedFor": true,
    "currentHashesExplainedByBeforeOrAfterHash": true,
    "terminalEvidenceMatchesState": true,
    "unknownAnswerStopsRun": true,
    "artifactDeletionBeforeReviewAllowed": false
  },
  "redactionPosture": {
    "mode": "hash-count-metadata-only",
    "rawValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "cookiesIncluded": false,
    "privatePathsIncluded": false,
    "liveServiceConfigurationIncluded": false
  },
  "releasePosture": {
    "finalReleaseStatus": "NO-GO",
    "integrationRecommendation": "NO-GO",
    "releaseMovementAllowed": false,
    "productionBackedEvidenceAdded": false
  }
}
```

## Validation

Focused validation for this slice:

```bash
node --check test/rpp-0909-operator-runbook.test.js
node --test --test-name-pattern RPP-0909 test/rpp-0909-operator-runbook.test.js
node scripts/release/artifact-redaction-scan.mjs docs/operations/operator-runbook.md docs/evidence/rpp-0909-operator-runbook.md
git diff --check
```

## Release Posture

This is support-only operator documentation evidence. It does not prove
production durability, production rollback, production repair, live topology,
customer-safe rollout, or release approval. Final release remains `NO-GO`.
