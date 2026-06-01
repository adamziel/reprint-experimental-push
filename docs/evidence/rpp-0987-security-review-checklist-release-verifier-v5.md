# RPP-0987 security review checklist release verifier v5 evidence

Date: 2026-06-01
Audited local branch: `session/rpp-987`
Audited lane head before this evidence file: `1f926d7eaf0b0174a6c5a858489cd1649c7a0005`
Checklist item: RPP-0987 - Farthest / release-ops carry through the release verifier for security review checklist, variant 5.
Scope: support-only release-verifier carry-through evidence for the security review checklist.

This evidence records the variant 5 release-verifier carry-through for the
security review checklist and carries forward the RPP-0967 v4 security review
checklist contract. It adds no production-backed proof, attempts no mutation,
changes no release gate status file, leaves every unresolved final-release
security proof gap open, and final release remains **NO-GO** with the verdict
held.

## Machine-readable audit record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0987",
  "sliceId": "RPP-0987",
  "proofId": "rpp-0987-security-review-checklist-release-verifier-v5",
  "variant": 5,
  "generatedAt": "2026-06-01T04:30:00.000Z",
  "auditedBranch": "session/rpp-987",
  "auditedLaneHeadBeforeEvidence": "1f926d7eaf0b0174a6c5a858489cd1649c7a0005",
  "status": "support-only-release-verifier-review-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "verdict": "held",
  "releaseGateState": "held",
  "successCriterion": "Release gate status moves only with production-backed evidence.",
  "carriedForwardFrom": {
    "rppId": "RPP-0967",
    "proofId": "rpp-0967-security-review-checklist-v4",
    "variant": 4,
    "unchangedReleaseMovementRule": true,
    "contract": [
      "support-only evidence can support candidate review but cannot move final release",
      "release gate movement requires production-backed final-release evidence",
      "final release remains NO-GO while production-backed proof is absent",
      "unresolved final-release risks remain open until fresh production-backed evidence closes them"
    ]
  },
  "releaseVerifierCarryThrough": {
    "mode": "support-only",
    "releaseVerifierEvidenceScope": "local-candidate-and-final-fail-closed",
    "supportOnlyVerifierEvidenceCanSupportCandidateReview": true,
    "supportOnlyVerifierEvidenceCanMoveFinalRelease": false,
    "finalReleaseVerifierFailClosedWithoutProductionBackedProof": true,
    "productionBackedSecurityProofRequired": true,
    "releaseGateStatusMovementRecorded": "none",
    "canonicalFailureReason": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "finalReleaseStatus": "NO-GO",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "requiredProductionBackedProofClasses": [
      "source-local-changed topology",
      "scoped auth and permission",
      "same-source identity",
      "route eligibility and pre-mutation refusal",
      "journal and recovery read-only safety",
      "operator-visible status proof"
    ],
    "supportAnchors": [
      "docs/evidence/rpp-0096-release-verifier-release-movement-carry-through.md",
      "docs/evidence/rpp-0099-release-verifier-agents-status-row-carry-through.md",
      "docs/evidence/rpp-0100-release-verifier-failure-reason-carry-through.md",
      "test/release-verifier-release-movement-summary-carry-through-focused-regression.test.js",
      "test/release-verifier-agents-status-row-carry-through-focused-regression.test.js",
      "test/release-verifier-failure-reason-carry-through-focused-regression.test.js"
    ]
  },
  "productionMovementRule": {
    "requiresProductionBackedEvidenceForAnyReleaseGateStatusMovement": true,
    "supportOnlyEvidenceCanMoveReleaseGateStatus": false,
    "currentReviewMovementAttempted": false,
    "statusMovementRecorded": "none",
    "requiredEvidencePosture": "fresh production-backed evidence tied to the checked final-release path",
    "allowedReleaseStatusWithoutProductionEvidence": "NO-GO",
    "blockedTargetStatusesWithoutProductionEvidence": [
      "partially_proven",
      "proven",
      "GO"
    ]
  },
  "reviewDiscipline": {
    "mode": "support-only-release-verifier",
    "releaseGateMovementAllowed": false,
    "productionBackedEvidenceObserved": false,
    "withoutProductionBackedEvidence": "blocked",
    "supportOnlyReviewEffect": "no-movement",
    "finalReleaseRequiredPosture": "NO-GO",
    "rule": "Support-only release-verifier evidence can name required production proof but cannot change release gate status."
  },
  "sourceLocalChangedCredentialPolicy": {
    "sourceLocalChangedAndCredentialProofRequired": true,
    "blocksReleaseMovementWhenAnyRequiredProofClassMissing": true,
    "statusWithoutCompleteProductionProof": "held",
    "finalReleaseStatusWithoutCompleteProductionProof": "NO-GO",
    "topologyProofGateIds": [
      "source-url",
      "local-url",
      "remote-changed-url"
    ],
    "credentialProofGateIds": [
      "auth-source-readback",
      "production-secret",
      "application-password-binding",
      "manage-options-capability"
    ],
    "allRequiredProofGateIds": [
      "source-url",
      "local-url",
      "remote-changed-url",
      "auth-source-readback",
      "production-secret",
      "application-password-binding",
      "manage-options-capability"
    ]
  },
  "checklistItems": [
    {
      "id": "SR-01",
      "control": "Live source identity",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Fresh operator evidence that binds the reviewed source site to the final release scope."
    },
    {
      "id": "SR-02",
      "control": "Scoped authentication and permission",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that the source path uses scoped push permissions and rejects insufficient permission."
    },
    {
      "id": "SR-03",
      "control": "Replay and request integrity",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that replay, duplicate, and changed-body attempts fail closed for the release path."
    },
    {
      "id": "SR-04",
      "control": "Current remote read before planning",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that dry-run reads the current live source state before planning."
    },
    {
      "id": "SR-05",
      "control": "Conflict and stale-state refusal",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that stale, conflicting, or drifted source state stops before mutation."
    },
    {
      "id": "SR-06",
      "control": "Immediate preconditions before writes",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that every mutation revalidates live preconditions immediately before writing."
    },
    {
      "id": "SR-07",
      "control": "Recovery and journal safety",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that journals classify only old remote, fully updated remote, or blocked recovery after failure."
    },
    {
      "id": "SR-08",
      "control": "Redacted evidence handling",
      "carriedForwardFrom": "RPP-0967",
      "movementPrerequisite": "production-backed evidence",
      "productionEvidenceRequired": true,
      "productionBacked": false,
      "supportReviewed": true,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false,
      "requiredProductionProof": "Production-backed proof that release artifacts exclude credentials, private payloads, cookies, and raw site values."
    }
  ],
  "supportOnlyEvaluator": {
    "evidenceScope": "local-candidate",
    "expectedGateState": "candidate-for-review",
    "expectedCandidateMovementAllowed": true,
    "expectedReleaseMovementAllowed": false,
    "expectedFinalGates": "0/20",
    "expectedCandidateGates": "20/20",
    "expectedStatusMarker": "[release-gates-ci:candidate-for-review final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]",
    "expectedFinalReleaseStatus": "NO-GO"
  },
  "blockedMovementScenarios": {
    "missingAllProductionProof": {
      "scope": "final-release",
      "expectedGateState": "held",
      "expectedReleaseMovementAllowed": false,
      "expectedFinalGates": "3/20",
      "expectedCandidateGates": "3/20",
      "requiredMissingGateIds": [
        "source-url",
        "local-url",
        "remote-changed-url",
        "auth-source-readback",
        "production-secret",
        "application-password-binding",
        "manage-options-capability"
      ]
    },
    "topologyWithoutCredentialProof": {
      "scope": "final-release",
      "expectedGateState": "held",
      "expectedReleaseMovementAllowed": false,
      "expectedFinalGates": "6/20",
      "expectedCandidateGates": "6/20",
      "requiredMissingGateIds": [
        "auth-source-readback",
        "production-secret",
        "application-password-binding",
        "manage-options-capability"
      ]
    },
    "credentialProofWithoutTopology": {
      "scope": "final-release",
      "expectedGateState": "held",
      "expectedReleaseMovementAllowed": false,
      "expectedFinalGates": "7/20",
      "expectedCandidateGates": "7/20",
      "requiredMissingGateIds": [
        "source-url",
        "local-url",
        "remote-changed-url"
      ]
    }
  },
  "finalReleaseEvaluator": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:30:00.000Z",
    "expectedExit": 1,
    "observedReleaseStatus": "NO-GO",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "primaryFailureBucket": "topology",
    "status": "held",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false,
    "finalGates": "3/20",
    "candidateGates": "3/20"
  },
  "statusRowReadback": {
    "path": ".agents/RELEASE_GATES.md",
    "releaseVerdict": "0/4",
    "releaseStatus": "NO-GO",
    "statusCounts": {
      "support_only": 4
    },
    "gateStatuses": [
      {
        "gate": "GATE-1",
        "title": "Production Executor/Auth Boundary",
        "status": "support_only"
      },
      {
        "gate": "GATE-2",
        "title": "Durable Recovery Journal Boundary",
        "status": "support_only"
      },
      {
        "gate": "GATE-3",
        "title": "Live Docker/Playground Production Topology",
        "status": "support_only"
      },
      {
        "gate": "GATE-4",
        "title": "Plugin-Driver Ownership Boundary",
        "status": "support_only"
      }
    ]
  },
  "unresolvedFinalReleaseRiskPolicy": {
    "finalReleaseRisksRemainOpen": true,
    "unresolvedRiskCount": 17,
    "closedByThisEvidence": 0,
    "releaseGateStatusMovement": "none",
    "requiredToClose": "fresh production-backed final-release evidence",
    "productionBackedSecurityProofGapsRemainOpen": true
  },
  "unresolvedFinalReleaseRisks": [
    {
      "id": "source-url",
      "rpp": "RPP-0001",
      "bucket": "topology",
      "code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "local-url",
      "rpp": "RPP-0002",
      "bucket": "topology",
      "code": "REPRINT_PUSH_LOCAL_URL_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "remote-changed-url",
      "rpp": "RPP-0003",
      "bucket": "topology",
      "code": "REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "auth-source-readback",
      "rpp": "RPP-0006",
      "bucket": "auth",
      "code": "PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "production-secret",
      "rpp": "RPP-0007",
      "bucket": "auth",
      "code": "REPRINT_PUSH_SECRET_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "application-password-binding",
      "rpp": "RPP-0008",
      "bucket": "auth",
      "code": "APPLICATION_PASSWORD_BINDING_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "manage-options-capability",
      "rpp": "RPP-0009",
      "bucket": "auth",
      "code": "MANAGE_OPTIONS_CAPABILITY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "same-source-identity",
      "rpp": "RPP-0010",
      "bucket": "identity",
      "code": "SAME_SOURCE_IDENTITY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "preflight-route-identity",
      "rpp": "RPP-0011",
      "bucket": "route",
      "code": "PREFLIGHT_ROUTE_IDENTITY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "dry-run-route-eligibility",
      "rpp": "RPP-0012",
      "bucket": "route",
      "code": "DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "apply-route-pre-mutation",
      "rpp": "RPP-0013",
      "bucket": "route",
      "code": "APPLY_ROUTE_PRE_MUTATION_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "journal-route-read-only",
      "rpp": "RPP-0014",
      "bucket": "recovery",
      "code": "JOURNAL_ROUTE_READ_ONLY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "recovery-inspect-read-only",
      "rpp": "RPP-0015",
      "bucket": "recovery",
      "code": "RECOVERY_INSPECT_READ_ONLY_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "tmux-status-marker",
      "rpp": "RPP-0017",
      "bucket": "operator-proof",
      "code": "TMUX_STATUS_MARKER_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "progress-release-timestamp",
      "rpp": "RPP-0018",
      "bucket": "operator-proof",
      "code": "PROGRESS_RELEASE_TIMESTAMP_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "agents-release-gates-row",
      "rpp": "RPP-0019",
      "bucket": "operator-proof",
      "code": "AGENTS_RELEASE_GATES_ROW_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    },
    {
      "id": "verify-release-failure-reason",
      "rpp": "RPP-0020",
      "bucket": "operator-proof",
      "code": "VERIFY_RELEASE_FAILURE_REASON_REQUIRED",
      "status": "open",
      "requiredProductionBackedEvidence": true,
      "productionBacked": false,
      "releaseGateSatisfied": false,
      "gateMovementAllowed": false
    }
  ],
  "evidenceLimits": {
    "mode": "support-only-security-review-release-verifier",
    "mutationAttempted": false,
    "rawPayloadsStored": false,
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "releaseGateStatusMutated": false,
    "releaseStatusChanged": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false,
    "unresolvedFinalReleaseRisksClosed": false,
    "finalReleaseRisksLeftOpen": true,
    "statusMovementCausedByThisArtifact": "none",
    "rpp0967ContractCarriedForward": true,
    "remoteTunnelUsed": false,
    "remoteTunnelInstructionsIncluded": false
  }
}
```

## Review finding

RPP-0987 is support-only release-verifier carry-through evidence for the
security review checklist. It carries forward the RPP-0967 v4 checklist
contract and confirms that release gate status movement remains gated on fresh
production-backed evidence. The release verifier can preserve local candidate
review evidence, but that evidence is not final-release proof. The final-scope
verifier remains fail-closed without production-backed source, local,
changed-remote, auth, permission, route, journal, recovery, and operator status
proof. Every unresolved production-backed security proof gap remains open, no
release gate status movement is recorded, and final release remains **NO-GO**
with the verdict held.

## Exact commands linked to this audit

| Purpose | Exact command | Expected result |
| --- | --- | --- |
| Audited commit | `git rev-parse HEAD` | `1f926d7eaf0b0174a6c5a858489cd1649c7a0005` before adding this evidence |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | `releaseVerdict` `0/4`, release status `NO-GO`, all four gates `support_only` |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:30:00.000Z` | exit `1`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `mutationAttempted: false`, final `3/20`, verdict `held` |
| Focused syntax check | `node --check test/rpp-0987-security-review-checklist-release-verifier-v5.test.js` | JavaScript syntax accepted |
| Focused RPP-0987 regression | `node --test --test-name-pattern RPP-0987 test/rpp-0987-security-review-checklist-release-verifier-v5.test.js` | focused audit passes while preserving final `NO-GO` and no release gate movement |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0987-security-review-checklist-release-verifier-v5.md` | audit artifact scans cleanly |
| Whitespace check | `git diff --check` | no whitespace errors |

## Caveats and integration recommendation

- This audit records the current lane state only. It does not move any release
  gate out of `support_only`.
- Support-only release-verifier evidence can support candidate review; it
  cannot move final release status.
- Failed or missing production-backed source, local, changed-remote, auth,
  permission, route, journal, recovery, and operator status proof remains a
  final-release blocker.
- No remote tunnel was used for this audit. Only local command execution inside
  the sandbox was used.
- Integrate this file as support-only release-ops evidence for RPP-0987. Final
  release should remain `NO-GO` until a fresh zero-exit final release verifier
  run proves the checked release path with production-backed evidence.
