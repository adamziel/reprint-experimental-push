# RPP-0922 release gate 2 final audit v2

Date: 2026-06-01
Audited local branch: `session/rpp-922`
Audited lane head before this evidence file: `08e3fe63284c6b42615a79913de3c075d3228975`
Checklist item: RPP-0922 - Release gate 2 final audit, variant 2.
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

No release-gate status file was edited by this audit.

## Audit report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0922",
  "variant": 2,
  "title": "Release gate 2 final audit v2",
  "checkedAt": "2026-06-01T02:12:00.000Z",
  "auditedBranch": "session/rpp-922",
  "auditedLaneHeadBeforeEvidence": "08e3fe63284c6b42615a79913de3c075d3228975",
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
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:12:00.000Z",
    "expectedExit": 1,
    "observedReleaseStatus": "NO-GO",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "primaryFailureBucket": "topology",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false,
    "finalGates": "3/20",
    "candidateGates": "3/20",
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
  "evidenceLimits": {
    "mode": "command-summary-and-status-only",
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "payloadsStored": false,
    "releaseGateStatusMutated": false
  },
  "integrationRecommendation": "NO-GO until GATE-2 has production-backed durable recovery evidence on the checked release path"
}
```

## Exact commands run in this audit

| Purpose | Exact command | Expected result |
| --- | --- | --- |
| Audited commit | `git rev-parse HEAD` | `08e3fe63284c6b42615a79913de3c075d3228975` before adding this evidence |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | `GATE-2` status `support_only`, `releaseVerdict` `0/4`, release status `NO-GO` |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:12:00.000Z` | exit `1`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `mutationAttempted: false`, final `3/20` |
| Focused syntax check | `node --check test/rpp-0922-release-gate-2-final-audit-v2.test.js` | JavaScript syntax accepted |
| Focused RPP-0922 regression | `node --test --test-name-pattern RPP-0922 test/rpp-0922-release-gate-2-final-audit-v2.test.js` | focused audit passes while preserving `support_only` and `NO-GO` |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0922-release-gate-2-final-audit-v2.md` | audit artifact scans cleanly |
| Whitespace check | `git diff --check` | no whitespace errors |

## Caveats and next integration recommendation

- This audit records the current lane state only. It does not move GATE-2 out
  of `support_only`.
- Local candidate/support evidence is useful for review, but release movement
  still requires production-backed durable recovery evidence from the checked
  release path.
- The next GATE-2 movement should require a zero-exit canonical verifier run
  whose durable recovery proof reports `LIVE_RELEASE_BOUNDARY_OK`, `GATE-2`,
  `gateStatus: proven`, and fresh final-release provenance for journal route
  read-only and recovery inspect read-only evidence.
