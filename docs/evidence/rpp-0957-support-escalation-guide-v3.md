# RPP-0957 support escalation guide v3 evidence

Date: 2026-06-01
Variant: 3
Audited local branch: `session/rpp-957`
Audited lane head before this evidence file: `30579db75230cd3734020a5a298d7393046caf90`
Scope: support-only escalation guide v3
Status: support-only, release blocking

This evidence records the support escalation guide v3 posture for release-gate
discipline. It adds no production-backed proof, attempts no mutation, changes
no release gate status, and keeps the final release at **NO-GO**.

Support-only observations can name escalation owners, triggers, prerequisites,
stop conditions, affected gate areas, and missing production proof. They cannot
approve final release readiness, cannot move gate status, and cannot replace
production-backed evidence.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0957",
  "sliceId": "RPP-0957",
  "proofId": "rpp-0957-support-escalation-guide-v3",
  "variant": 3,
  "generatedAt": "2026-06-01T03:25:00.000Z",
  "auditedBranch": "session/rpp-957",
  "auditedLaneHeadBeforeEvidence": "30579db75230cd3734020a5a298d7393046caf90",
  "status": "support-only-escalation-guide-v3-recorded",
  "supportEscalationStatus": "support-only-held",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "verdict": "held",
  "finalReleaseStatus": "NO-GO",
  "finalReleaseReadiness": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "Release gate status moves only with production-backed evidence.",
  "documents": {
    "evidence": "docs/evidence/rpp-0957-support-escalation-guide-v3.md",
    "patternEvidence": "docs/evidence/rpp-0937-support-escalation-guide-v2.md"
  },
  "supportEscalationRule": {
    "mode": "support-only",
    "releaseGateMovementAllowed": false,
    "releaseGateStatusMovement": "none",
    "currentEscalationMovementAttempted": false,
    "productionBackedEvidenceObserved": false,
    "everyReleaseGateMovementRequiresProductionBackedEvidence": true,
    "supportOnlyObservationsCanMoveFinalRelease": false,
    "supportOnlyEscalationObservationsCanMoveFinalReleaseReadiness": false,
    "requiredEvidenceForMovement": "production-backed",
    "supportEscalationEffect": "classify-preserve-and-escalate-without-release-credit",
    "missingProductionBackedProofEffect": "blocks-release-gate-movement",
    "finalReleaseRequiredPosture": "NO-GO",
    "rule": "Release gate status moves only with production-backed evidence; support-only observations can name owners, triggers, prerequisites, and stop conditions but cannot move final release readiness."
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
  "escalationPrerequisites": [
    {
      "id": "PREREQ-01",
      "name": "Redacted support escalation packet",
      "requirement": "A support-only packet names the affected gate area, support observation, and missing production proof without raw private values.",
      "ownerId": "SUPPORT_TRIAGE_LEAD",
      "currentEvidenceSatisfiesSupportTriage": true,
      "productionBackedEvidenceObserved": false,
      "movementRequiresProductionBackedEvidence": true,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "PREREQ-02",
      "name": "Live production source identity proof",
      "requirement": "Fresh production-backed identity proof binds preflight, dry-run, apply, journal, and recovery to the same live source before any gate movement.",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "currentEvidenceSatisfiesSupportTriage": false,
      "productionBackedEvidenceObserved": false,
      "movementRequiresProductionBackedEvidence": true,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "PREREQ-03",
      "name": "Production authentication and capability proof",
      "requirement": "Production-backed proof shows the checked user, route permissions, and credential boundary match the release path.",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "currentEvidenceSatisfiesSupportTriage": false,
      "productionBackedEvidenceObserved": false,
      "movementRequiresProductionBackedEvidence": true,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "PREREQ-04",
      "name": "Production route, journal, and recovery proof",
      "requirement": "Production-backed preflight, dry-run, apply, journal, and recovery evidence proves the release path before status movement.",
      "ownerId": "PRODUCTION_EVIDENCE_OWNER",
      "currentEvidenceSatisfiesSupportTriage": false,
      "productionBackedEvidenceObserved": false,
      "movementRequiresProductionBackedEvidence": true,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
    },
    {
      "id": "PREREQ-05",
      "name": "Release gate owner production-backed reevaluation",
      "requirement": "The release gate owner reevaluates status only after the required production-backed evidence is present and redacted.",
      "ownerId": "RELEASE_GATE_OWNER",
      "currentEvidenceSatisfiesSupportTriage": false,
      "productionBackedEvidenceObserved": false,
      "movementRequiresProductionBackedEvidence": true,
      "releaseGateMovementAllowed": false,
      "finalReleaseMovementAllowed": false
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
      "prerequisiteId": "PREREQ-02",
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
      "prerequisiteId": "PREREQ-03",
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
      "prerequisiteId": "PREREQ-04",
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
      "prerequisiteId": "PREREQ-04",
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
      "prerequisiteId": "PREREQ-01",
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
      "prerequisiteId": "PREREQ-05",
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
    "supportOnlyObservationsMayMoveFinalReleaseReadiness": false,
    "requiresEscalationOwnerNamed": true,
    "requiresEscalationTriggerNamed": true,
    "requiresEscalationPrerequisiteNamed": true,
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
    },
    "releaseGateStatusMovement": "none"
  },
  "releaseGateExpectation": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:25:00.000Z",
    "expectedExit": 1,
    "expectedReleaseStatus": "NO-GO",
    "expectedGateState": "held",
    "expectedPrimaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "expectedPrimaryFailureBucket": "topology",
    "expectedMutationAttempted": false,
    "expectedReleaseMovementAllowed": false,
    "expectedReleaseGateStatusMovement": "none",
    "expectedSupportOnlyObservationsCanMoveFinalRelease": false,
    "expectedSupportOnlyObservationsCanMoveFinalReleaseReadiness": false,
    "expectedStatusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]"
  },
  "evidenceLimits": {
    "mode": "support-only-escalation-guide-v3",
    "mutationAttempted": false,
    "rawPayloadsStored": false,
    "releaseGateChanged": false,
    "releaseGateStatusMovement": "none",
    "releaseStatusChanged": false,
    "finalReleaseReadinessChanged": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false,
    "statusFilesChanged": false,
    "dashboardsStarted": false,
    "remoteTunnelsUsed": false
  },
  "validationCommands": [
    {
      "command": "git rev-parse HEAD",
      "expectedExit": 0,
      "observed": "30579db75230cd3734020a5a298d7393046caf90 before adding this evidence"
    },
    {
      "command": "node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md",
      "expectedExit": 0,
      "observed": "releaseVerdict 0/4, releaseStatus NO-GO, all gates support_only"
    },
    {
      "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:25:00.000Z",
      "expectedExit": 1,
      "observed": "NO-GO with held gate state, REPRINT_PUSH_LIVE_SOURCE_REQUIRED, release movement denied, no release-gate status movement, and mutationAttempted false"
    },
    {
      "command": "node --check test/rpp-0957-support-escalation-guide-v3.test.js",
      "expectedExit": 0,
      "observed": "JavaScript syntax accepted"
    },
    {
      "command": "node --test --test-name-pattern RPP-0957 test/rpp-0957-support-escalation-guide-v3.test.js",
      "expectedExit": 0,
      "observed": "Focused RPP-0957 tests pass"
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0957-support-escalation-guide-v3.md",
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

RPP-0957 is support-only escalation guide v3 evidence. The record names
escalation owners, triggers, prerequisites, and stop conditions, and it names
the production-backed proof required before release-gate status can move. This
artifact does not provide production-backed proof.

Support escalation status therefore remains `support-only-held`. Gate movement
remains blocked, support-only escalation observations cannot move final release
readiness, final release remains **NO-GO**, and release-gate status movement is
`none`. Integration recommendation: **NO-GO** for release movement. Integrate
only as support evidence for RPP-0957.
