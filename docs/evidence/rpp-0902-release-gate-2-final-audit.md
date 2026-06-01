# RPP-0902 release gate 2 final audit

Date: 2026-06-01
Audited local branch: `session/rpp-902`
Audited lane head before this evidence file: `959e89d8354463cab70116195c92374e826bf839`
Checklist item: RPP-0902 - Implement release gate 2 final audit, variant 1.
Write scope: release-ops audit evidence for GATE-2 only.

## Gate under audit

GATE-2 is the Durable Recovery Journal Boundary from `.agents/RELEASE_GATES.md`.
The gate requires the same release path to prove durable restart-readable journal
ownership with lease fencing, old/new/blocked recovery classification after
restart, and preserved remote changes without overwrite.

## Audit verdict

Release movement stays held for GATE-2. The current lane has extensive
support-only durable recovery coverage and release-verifier carry-through
coverage, but this audit did not observe production-backed durable recovery
evidence on a live release boundary. GATE-2 remains `support_only`, and the
final release remains `NO-GO`.

## Audit report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0902",
  "variant": 1,
  "title": "Release gate 2 final audit",
  "checkedAt": "2026-06-01T01:26:00.000Z",
  "auditedBranch": "session/rpp-902",
  "auditedLaneHeadBeforeEvidence": "959e89d8354463cab70116195c92374e826bf839",
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
    "observedBoundaryVerdict": "missing-production-backed-live-boundary",
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
  "finalReleaseEvaluator": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:26:00.000Z",
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
  "verifyRelease": {
    "command": "timeout 300s npm run verify:release",
    "expectedExit": 1,
    "expectedFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "expectedStatusMarker": "[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false
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
| Audited commit | `git rev-parse HEAD` | `959e89d8354463cab70116195c92374e826bf839` before adding this evidence |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | `GATE-2` status `support_only`, `releaseVerdict` `0/4`, release status `NO-GO` |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:26:00.000Z` | exit `1`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `mutationAttempted: false`, final `3/20` |
| Focused RPP-0902 regression | `node --test --test-name-pattern RPP-0902 test/rpp-0902-release-gate-2-final-audit.test.js` | focused audit passes while preserving `support_only` and `NO-GO` |
| Canonical release verifier | `timeout 300s npm run verify:release` | exit `1`, held by missing live source before mutation |

## Caveats and next integration recommendation

- This audit records the current lane state only. It does not move GATE-2 out
  of `support_only`.
- The final release remains `NO-GO` because no production-owned live source
  boundary was supplied for durable recovery journal evidence.
- The next GATE-2 movement should require a zero-exit canonical verifier run
  whose durable recovery proof reports `LIVE_RELEASE_BOUNDARY_OK`, `GATE-2`,
  `gateStatus: proven`, and fresh final-release provenance for journal route
  read-only and recovery inspect read-only evidence.
