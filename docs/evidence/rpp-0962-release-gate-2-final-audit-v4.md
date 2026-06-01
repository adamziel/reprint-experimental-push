# RPP-0962 release gate 2 final audit v4

Date: 2026-06-01
Audited local branch: `session/rpp-962`
Audited lane head before this evidence file: `eaf28de1181b9d95cc81957177eff5901cdc5ed2`
Checklist item: RPP-0962 - Release gate 2 final audit, variant 4.
Write scope: support-only release-ops audit evidence for GATE-2 only.

## Gate under audit

GATE-2 is the Durable Recovery Journal Boundary from `.agents/RELEASE_GATES.md`.
The gate requires the checked release path to prove durable restart-readable
journal ownership with lease fencing, old/new/blocked recovery classification
after restart, and preserved remote changes without overwrite.

## Audit verdict

Release movement stays held for GATE-2. This audit records support evidence
only: local candidate coverage can support review, but it cannot move a final
release gate. GATE-2 remains `support_only`, `.agents/RELEASE_GATES.md`
remains `release_verdict: 0/4`, and the final release remains `NO-GO`.

Support-only observations cannot move final release status. Failed or missing
production-backed source, local, or remote-changed proof keeps final release
`NO-GO`; the same fail-closed production-evidence rule from the RPP-0942 v3
audit remains in force for this variant.

No release-gate status file was edited by this audit.

## Audit report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0962",
  "variant": 4,
  "title": "Release gate 2 final audit v4",
  "checkedAt": "2026-06-01T03:37:49.000Z",
  "auditedBranch": "session/rpp-962",
  "auditedLaneHeadBeforeEvidence": "eaf28de1181b9d95cc81957177eff5901cdc5ed2",
  "gate": {
    "id": "GATE-2",
    "title": "Durable Recovery Journal Boundary",
    "statusBefore": "support_only",
    "statusAfter": "support_only",
    "movement": "none",
    "releaseVerdict": "0/4",
    "finalReleaseStatus": "NO-GO"
  },
  "supportEvidence": {
    "durableRecoveryJournalBoundary": "release-verifier",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "observedBoundaryVerdict": "support-boundary-not-live-release-boundary",
    "localEvidenceCanOnlySupportCandidateReview": true,
    "contractCarriedForwardFrom": "RPP-0942 v3",
    "coveredSupportSurfaces": [
      "journal-route-read-only",
      "recovery-inspect-read-only",
      "restart-readable-journal-ownership",
      "lease-owner-identity",
      "stale-owner-fencing",
      "claim-expiry-policy",
      "old-new-blocked-recovery-classification",
      "preserved-remote-retry",
      "manual-recovery-audit-export"
    ]
  },
  "productionMovementRule": {
    "requiresProductionBackedDurableRecoveryEvidence": true,
    "requiredBoundaryVerdict": "LIVE_RELEASE_BOUNDARY_OK",
    "requiredStatusBeforeMovement": "proven",
    "allowedStatusWithoutProductionEvidence": "support_only",
    "blockedStatusesWithoutProductionEvidence": [
      "partially_proven",
      "proven"
    ]
  },
  "productionBackedTopologyRule": {
    "requiresProductionBackedSourceLocalChangedProof": true,
    "requiredTopologyEvidence": [
      "REPRINT_PUSH_SOURCE_URL",
      "REPRINT_PUSH_LOCAL_URL",
      "REPRINT_PUSH_REMOTE_CHANGED_URL"
    ],
    "failedOrMissingProductionBackedProofKeepsFinalReleaseStatus": "NO-GO",
    "releaseMovementAllowedWithoutTheseProofs": false,
    "supportOnlyObservationsCanMoveGate": false,
    "missingCodes": [
      "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
      "REPRINT_PUSH_LOCAL_URL_REQUIRED",
      "REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED"
    ],
    "failedCodes": [
      "REPRINT_PUSH_SOURCE_URL_INVALID",
      "REPRINT_PUSH_LOCAL_URL_INVALID",
      "REPRINT_PUSH_REMOTE_CHANGED_URL_INVALID"
    ]
  },
  "supportOnlyEvaluator": {
    "evidenceScope": "local-candidate",
    "expectedGateState": "candidate-for-review",
    "expectedReleaseMovementAllowed": false,
    "expectedCandidateMovementAllowed": true,
    "expectedFinalGates": "0/20",
    "expectedCandidateGates": "20/20",
    "expectedStatusMarkerReason": "LOCAL_CANDIDATE_EVIDENCE_ONLY",
    "expectedFinalReleaseStatus": "NO-GO"
  },
  "finalReleaseEvaluator": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:37:49.000Z",
    "expectedExit": 1,
    "observedReleaseStatus": "NO-GO",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "primaryFailureBucket": "topology",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false,
    "finalGates": "3/20",
    "candidateGates": "3/20",
    "criticalMissingLiveEvidenceBuckets": [
      "topology",
      "auth",
      "recovery"
    ],
    "missingProductionBackedTopologyCodes": [
      "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
      "REPRINT_PUSH_LOCAL_URL_REQUIRED",
      "REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED"
    ],
    "missingLiveEvidenceCodes": [
      "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
      "REPRINT_PUSH_LOCAL_URL_REQUIRED",
      "REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED",
      "PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED",
      "REPRINT_PUSH_SECRET_REQUIRED",
      "APPLICATION_PASSWORD_BINDING_REQUIRED",
      "JOURNAL_ROUTE_READ_ONLY_REQUIRED",
      "RECOVERY_INSPECT_READ_ONLY_REQUIRED"
    ],
    "missingRecoveryEvidenceCodes": [
      "JOURNAL_ROUTE_READ_ONLY_REQUIRED",
      "RECOVERY_INSPECT_READ_ONLY_REQUIRED"
    ]
  },
  "statusRowReadback": {
    "path": ".agents/RELEASE_GATES.md",
    "releaseVerdict": "0/4",
    "releaseStatus": "NO-GO",
    "gate2Status": "support_only",
    "statusCounts": {
      "support_only": 4
    }
  },
  "statusMovementProof": {
    "releaseGateStatusFilesEdited": [],
    "restrictedStatusFilesTouched": false,
    "thisEvidenceMovesReleaseGateStatus": false,
    "gate2Before": "support_only",
    "gate2After": "support_only",
    "finalReleaseBefore": "NO-GO",
    "finalReleaseAfter": "NO-GO"
  },
  "rpp0942ContractCarryForward": {
    "sourceAudit": "RPP-0942 v3",
    "carriedFields": [
      "GATE-2 support_only",
      "productionMovementRule",
      "supportOnlyEvaluator",
      "statusMovementProof",
      "evidenceLimits"
    ],
    "extension": "failed or missing production-backed source/local/remote-changed proof also keeps final release NO-GO"
  },
  "evidenceLimits": {
    "mode": "command-summary-and-status-only",
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "payloadsStored": false,
    "releaseGateStatusMutated": false
  },
  "integrationRecommendation": "NO-GO until GATE-2 has production-backed durable recovery evidence and production-backed source/local/remote-changed proof on the checked release path"
}
```

## Exact commands run in this audit

| Purpose | Exact command | Expected result |
| --- | --- | --- |
| Audited commit | `git rev-parse HEAD` | `eaf28de1181b9d95cc81957177eff5901cdc5ed2` before adding this evidence |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | `GATE-2` status `support_only`, `releaseVerdict` `0/4`, release status `NO-GO` |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:37:49.000Z` | exit `1`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `mutationAttempted: false`, final `3/20`; missing topology, auth, and recovery proof keeps release held |
| Focused syntax check | `node --check test/rpp-0962-release-gate-2-final-audit-v4.test.js` | JavaScript syntax accepted |
| Focused RPP-0962 regression | `node --test --test-name-pattern RPP-0962 test/rpp-0962-release-gate-2-final-audit-v4.test.js` | focused audit passes while preserving `support_only` and `NO-GO` |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0962-release-gate-2-final-audit-v4.md` | audit artifact scans cleanly |
| Whitespace check | `git diff --check` | no whitespace errors |

## Caveats and next integration recommendation

- This audit records the current lane state only. It does not move GATE-2 out
  of `support_only`.
- Local candidate/support evidence is useful for review, but release movement
  still requires production-backed durable recovery evidence from the checked
  release path.
- Failed or missing production-backed source, local, or remote-changed proof is
  a final-release blocker even when support-only observations exist.
- The next GATE-2 movement should require a zero-exit canonical verifier run
  whose durable recovery proof reports `LIVE_RELEASE_BOUNDARY_OK`, `GATE-2`,
  `gateStatus: proven`, fresh final-release provenance for journal route
  read-only and recovery inspect read-only evidence, and production-backed
  source/local/remote-changed proof for the checked release path.
