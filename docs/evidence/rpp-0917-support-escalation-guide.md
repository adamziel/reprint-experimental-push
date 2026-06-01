# RPP-0917 support escalation guide evidence

Date: 2026-06-01
Variant: 1
Audited local branch: `session/rpp-917`
Audited lane head before this evidence file: `521f2234688fc66919b421bb5c42d36aa2e437fd`
Scope: support-only escalation guide

This evidence records the support escalation guide for release-gate discipline.
It adds no production-backed proof, attempts no mutation, changes no release
gate status, and keeps the final release at **NO-GO**.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0917",
  "sliceId": "RPP-0917",
  "proofId": "rpp-0917-support-escalation-guide-v1",
  "variant": 1,
  "generatedAt": "2026-06-01T02:06:00.000Z",
  "auditedBranch": "session/rpp-917",
  "auditedLaneHeadBeforeEvidence": "521f2234688fc66919b421bb5c42d36aa2e437fd",
  "status": "support-only-escalation-guide-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "Release gate status moves only with production-backed evidence.",
  "documents": {
    "guide": "docs/support/escalation-guide.md",
    "evidence": "docs/evidence/rpp-0917-support-escalation-guide.md"
  },
  "supportEscalationRule": {
    "mode": "support-only",
    "releaseGateMovementAllowed": false,
    "currentEscalationMovementAttempted": false,
    "productionBackedEvidenceObserved": false,
    "requiredEvidenceForMovement": "production-backed",
    "supportEscalationEffect": "no-movement",
    "missingProductionBackedProofEffect": "blocks-release-gate-movement",
    "finalReleaseRequiredPosture": "NO-GO",
    "rule": "Support escalation can classify and preserve evidence, but release gate status cannot move without production-backed evidence."
  },
  "escalationTriggers": [
    {
      "id": "SE-01",
      "trigger": "Live source identity is unclear.",
      "gateArea": "source-identity",
      "supportAction": "Record the missing identity proof and stop release escalation at support-only.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Fresh operator proof binding preflight, dry-run, apply, journal, and recovery to the same live source."
    },
    {
      "id": "SE-02",
      "trigger": "Authentication or permission boundary is disputed.",
      "gateArea": "auth-boundary",
      "supportAction": "Preserve the failing command class and route area without storing private values.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed proof that the checked user and route permissions match the release path."
    },
    {
      "id": "SE-03",
      "trigger": "Stale remote, conflict, or drift is suspected.",
      "gateArea": "conflict-boundary",
      "supportAction": "Keep the incident in triage and require a before/after envelope review.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed proof that the current live remote was read and stale or conflicting state refused before mutation."
    },
    {
      "id": "SE-04",
      "trigger": "Apply, journal, or recovery outcome is uncertain.",
      "gateArea": "recovery-boundary",
      "supportAction": "Classify the state as unresolved and do not authorize repair or rollback from support notes.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed journal or recovery evidence showing old remote, fully updated remote, or blocked recovery."
    },
    {
      "id": "SE-05",
      "trigger": "Evidence provenance or redaction is incomplete.",
      "gateArea": "artifact-integrity",
      "supportAction": "Reject the artifact for release-gate credit and request redacted replacement evidence.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed redacted artifact with source provenance, timestamp, and release scope."
    },
    {
      "id": "SE-06",
      "trigger": "Operator pressure asks for release movement without proof.",
      "gateArea": "release-process",
      "supportAction": "Record the request as support-only and keep release status unchanged.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed release gate evaluation that satisfies the required final-release checks."
    }
  ],
  "handoffContract": {
    "supportMayEscalate": true,
    "supportMayApproveReleaseMovement": false,
    "supportMayChangeGateStatus": false,
    "requiresMissingProductionProofNamed": true,
    "requiresAffectedGateNamed": true,
    "requiresCurrentSupportOnlyStatusNamed": true,
    "requiresProductionBackedReevaluation": true,
    "absentProductionProofAction": "keep-gate-unchanged-and-final-release-NO-GO"
  },
  "statusRowReadback": {
    "path": ".agents/RELEASE_GATES.md",
    "releaseVerdict": "0/4",
    "releaseStatus": "NO-GO",
    "gateStatuses": {
      "GATE-1": "support_only",
      "GATE-2": "support_only",
      "GATE-3": "support_only",
      "GATE-4": "support_only"
    },
    "statusCounts": {
      "support_only": 4
    }
  },
  "releaseGateExpectation": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:06:00.000Z",
    "expectedExit": 1,
    "expectedReleaseStatus": "NO-GO",
    "expectedPrimaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "expectedPrimaryFailureBucket": "topology",
    "expectedMutationAttempted": false,
    "expectedReleaseMovementAllowed": false,
    "expectedStatusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]"
  },
  "evidenceLimits": {
    "mode": "support-only-escalation-guide",
    "mutationAttempted": false,
    "rawPayloadsStored": false,
    "releaseGateChanged": false,
    "releaseStatusChanged": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false,
    "statusFilesChanged": false
  },
  "validationCommands": [
    {
      "command": "git rev-parse HEAD",
      "expectedExit": 0,
      "observed": "521f2234688fc66919b421bb5c42d36aa2e437fd before adding this evidence"
    },
    {
      "command": "node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md",
      "expectedExit": 0,
      "observed": "releaseVerdict 0/4, releaseStatus NO-GO, all gates support_only"
    },
    {
      "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:06:00.000Z",
      "expectedExit": 1,
      "observed": "NO-GO with REPRINT_PUSH_LIVE_SOURCE_REQUIRED and mutationAttempted false"
    },
    {
      "command": "node --check test/rpp-0917-support-escalation-guide.test.js",
      "expectedExit": 0,
      "observed": "JavaScript syntax accepted"
    },
    {
      "command": "node --test --test-name-pattern RPP-0917 test/rpp-0917-support-escalation-guide.test.js",
      "expectedExit": 0,
      "observed": "Focused RPP-0917 tests pass"
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/support/escalation-guide.md docs/evidence/rpp-0917-support-escalation-guide.md",
      "expectedExit": 0,
      "observed": "ok true, rejectedFiles empty"
    },
    {
      "command": "git diff --check",
      "expectedExit": 0,
      "observed": "No whitespace errors"
    }
  ]
}
```

## Review finding

RPP-0917 is support-only escalation guide evidence. The guide names support
escalation triggers and the production-backed proof required before release-gate
status can move, but this artifact does not provide production-backed proof.

Gate movement therefore remains blocked and final release remains **NO-GO**.
Integration recommendation: **NO-GO** for release movement. Integrate only as
support evidence for the RPP-0917 support escalation guide.
