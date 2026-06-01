# RPP-0937 support escalation guide v2 evidence

Date: 2026-06-01
Variant: 2
Audited local branch: `session/rpp-937`
Audited lane head before this evidence file: `f910defefe3f5e5cde760c720408fac2b56e94e9`
Scope: support-only escalation guide v2
Status: support-only, release blocking

This evidence records the support escalation guide v2 posture for release-gate
discipline. It adds no production-backed proof, attempts no mutation, changes
no release gate status, and keeps the final release at **NO-GO**.

Support-only observations can name escalation owners, stop conditions, affected
gate areas, and missing production proof. They cannot approve final release,
cannot move gate status, and cannot replace production-backed evidence.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0937",
  "sliceId": "RPP-0937",
  "proofId": "rpp-0937-support-escalation-guide-v2",
  "variant": 2,
  "generatedAt": "2026-06-01T02:40:00.000Z",
  "auditedBranch": "session/rpp-937",
  "auditedLaneHeadBeforeEvidence": "f910defefe3f5e5cde760c720408fac2b56e94e9",
  "status": "support-only-escalation-guide-v2-recorded",
  "supportEscalationStatus": "support-only-held",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "verdict": "held",
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "Release gate status moves only with production-backed evidence.",
  "documents": {
    "evidence": "docs/evidence/rpp-0937-support-escalation-guide-v2.md",
    "patternEvidence": "docs/evidence/rpp-0917-support-escalation-guide.md"
  },
  "supportEscalationRule": {
    "mode": "support-only",
    "releaseGateMovementAllowed": false,
    "currentEscalationMovementAttempted": false,
    "productionBackedEvidenceObserved": false,
    "supportOnlyObservationsCanMoveFinalRelease": false,
    "requiredEvidenceForMovement": "production-backed",
    "supportEscalationEffect": "classify-preserve-and-escalate-without-release-credit",
    "missingProductionBackedProofEffect": "blocks-release-gate-movement",
    "finalReleaseRequiredPosture": "NO-GO",
    "rule": "Release gate status moves only with production-backed evidence; support-only observations can name owners and stop conditions but cannot move final release."
  },
  "escalationOwners": [
    {
      "id": "SUPPORT_TRIAGE_LEAD",
      "name": "Support triage lead",
      "responsibility": "Classify the escalation, preserve redacted support notes, and assign the affected gate area.",
      "releaseGateAuthority": "none",
      "supportOnlyReleaseGateMovementAllowed": false,
      "movementRequiresProductionBackedEvidence": true
    },
    {
      "id": "PRODUCTION_EVIDENCE_OWNER",
      "name": "Production evidence owner",
      "responsibility": "Collect production-backed preflight, dry-run, apply, journal, and recovery proof without storing raw private values.",
      "releaseGateAuthority": "provide-production-proof-only",
      "supportOnlyReleaseGateMovementAllowed": false,
      "movementRequiresProductionBackedEvidence": true
    },
    {
      "id": "RELEASE_GATE_OWNER",
      "name": "Release gate owner",
      "responsibility": "Reevaluate gate status only after production-backed evidence is present and redacted.",
      "releaseGateAuthority": "production-backed-reevaluation-only",
      "supportOnlyReleaseGateMovementAllowed": false,
      "movementRequiresProductionBackedEvidence": true
    }
  ],
  "stopConditions": [
    {
      "id": "STOP-01",
      "name": "Missing live source identity proof",
      "condition": "The live source identity is absent, stale, disputed, or not tied to preflight, dry-run, apply, journal, and recovery.",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "releaseAction": "keep-gate-unchanged-and-final-release-NO-GO",
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "STOP-02",
      "name": "Support-only observation offered as final release proof",
      "condition": "The available artifact is a support note, guide, transcript, or observation without production-backed proof.",
      "ownerId": "SUPPORT_TRIAGE_LEAD",
      "releaseAction": "classify-support-only-and-keep-final-release-NO-GO",
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "STOP-03",
      "name": "Gate movement requested without production-backed evidence",
      "condition": "Any request asks support to move gate status before production-backed evidence exists.",
      "ownerId": "RELEASE_GATE_OWNER",
      "releaseAction": "refuse-release-gate-movement-and-keep-status-held",
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "STOP-04",
      "name": "Artifact provenance or redaction incomplete",
      "condition": "Evidence provenance, timestamp, redaction, or release scope is incomplete.",
      "ownerId": "SUPPORT_TRIAGE_LEAD",
      "releaseAction": "reject-for-release-credit-and-request-redacted-production-evidence",
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "STOP-05",
      "name": "Recovery outcome uncertain",
      "condition": "Apply, journal, recovery, or rollback outcome is unresolved or only described by support notes.",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "releaseAction": "hold-support-escalation-until-production-journal-or-recovery-proof-exists",
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    }
  ],
  "escalationTriggers": [
    {
      "id": "SE-01",
      "trigger": "Live source identity is unclear.",
      "gateArea": "source-identity",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "stopConditionId": "STOP-01",
      "supportAction": "Record the missing identity proof, assign production evidence ownership, and stop release escalation at support-only.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Fresh operator proof binding preflight, dry-run, apply, journal, and recovery to the same live source."
    },
    {
      "id": "SE-02",
      "trigger": "Authentication or permission boundary is disputed.",
      "gateArea": "auth-boundary",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "stopConditionId": "STOP-02",
      "supportAction": "Preserve the failing command class and route area without storing private values.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed proof that the checked user and route permissions match the release path."
    },
    {
      "id": "SE-03",
      "trigger": "Stale remote, conflict, or drift is suspected.",
      "gateArea": "conflict-boundary",
      "ownerId": "RELEASE_GATE_OWNER",
      "stopConditionId": "STOP-03",
      "supportAction": "Keep the incident in triage and require a before/after envelope review before any release gate reevaluation.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed proof that the current live remote was read and stale or conflicting state refused before mutation."
    },
    {
      "id": "SE-04",
      "trigger": "Apply, journal, or recovery outcome is uncertain.",
      "gateArea": "recovery-boundary",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "stopConditionId": "STOP-05",
      "supportAction": "Classify the state as unresolved and do not authorize repair or rollback from support notes.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed journal or recovery evidence showing old remote, fully updated remote, or blocked recovery."
    },
    {
      "id": "SE-05",
      "trigger": "Evidence provenance or redaction is incomplete.",
      "gateArea": "artifact-integrity",
      "ownerId": "SUPPORT_TRIAGE_LEAD",
      "stopConditionId": "STOP-04",
      "supportAction": "Reject the artifact for release-gate credit and request redacted replacement evidence.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed redacted artifact with source provenance, timestamp, and release scope."
    },
    {
      "id": "SE-06",
      "trigger": "Operator pressure asks for release movement without proof.",
      "gateArea": "release-process",
      "ownerId": "RELEASE_GATE_OWNER",
      "stopConditionId": "STOP-03",
      "supportAction": "Record the request as support-only, refuse gate movement, and keep release status unchanged.",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false,
      "releaseEffect": "blocked",
      "requiredProductionProof": "Production-backed release gate evaluation that satisfies the required final-release checks."
    }
  ],
  "handoffContract": {
    "supportMayEscalate": true,
    "supportMayApproveReleaseMovement": false,
    "supportMayChangeGateStatus": false,
    "supportOnlyObservationsMayMoveFinalRelease": false,
    "requiresEscalationOwnerNamed": true,
    "requiresStopConditionNamed": true,
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
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:40:00.000Z",
    "expectedExit": 1,
    "expectedReleaseStatus": "NO-GO",
    "expectedGateState": "held",
    "expectedPrimaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "expectedPrimaryFailureBucket": "topology",
    "expectedMutationAttempted": false,
    "expectedReleaseMovementAllowed": false,
    "expectedSupportOnlyObservationsCanMoveFinalRelease": false,
    "expectedStatusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]"
  },
  "evidenceLimits": {
    "mode": "support-only-escalation-guide-v2",
    "mutationAttempted": false,
    "rawPayloadsStored": false,
    "releaseGateChanged": false,
    "releaseStatusChanged": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false,
    "statusFilesChanged": false,
    "supportGuideFilesChanged": false
  },
  "validationCommands": [
    {
      "command": "git rev-parse HEAD",
      "expectedExit": 0,
      "observed": "f910defefe3f5e5cde760c720408fac2b56e94e9 before adding this evidence"
    },
    {
      "command": "node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md",
      "expectedExit": 0,
      "observed": "releaseVerdict 0/4, releaseStatus NO-GO, all gates support_only"
    },
    {
      "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:40:00.000Z",
      "expectedExit": 1,
      "observed": "NO-GO with held gate state, REPRINT_PUSH_LIVE_SOURCE_REQUIRED, release movement denied, and mutationAttempted false"
    },
    {
      "command": "node --check test/rpp-0937-support-escalation-guide-v2.test.js",
      "expectedExit": 0,
      "observed": "JavaScript syntax accepted"
    },
    {
      "command": "node --test --test-name-pattern RPP-0937 test/rpp-0937-support-escalation-guide-v2.test.js",
      "expectedExit": 0,
      "observed": "Focused RPP-0937 tests pass"
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0937-support-escalation-guide-v2.md",
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

RPP-0937 is support-only escalation guide v2 evidence. The record names
escalation owners and stop conditions, and it names the production-backed proof
required before release-gate status can move. This artifact does not provide
production-backed proof.

Support escalation status therefore remains `support-only-held`. Gate movement
remains blocked, support-only observations cannot move final release, and final
release remains **NO-GO**. Integration recommendation: **NO-GO** for release
movement. Integrate only as support evidence for RPP-0937.
