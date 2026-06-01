# RPP-0972 CI required checks list v4 evidence

Date: 2026-06-01
Variant: 4
Audited local branch: `session/rpp-972`
Audited lane head before this evidence file: `7f88e42b2aedd39cf83908ae2a4acecb290ab472`
Scope: support-only CI required checks list v4
Carries forward: `docs/evidence/rpp-0952-ci-required-checks-list-v3.md`

This evidence records the CI required checks list v4 release-gate discipline.
It adds no production-backed proof, attempts no mutation, changes no release
gate status file, and keeps the release verdict held with final release at
**NO-GO**.

## Machine-readable audit record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0972",
  "sliceId": "RPP-0972",
  "proofId": "rpp-0972-ci-required-checks-list-v4",
  "variant": 4,
  "generatedAt": "2026-06-01T04:00:00.000Z",
  "auditedBranch": "session/rpp-972",
  "auditedLaneHeadBeforeEvidence": "7f88e42b2aedd39cf83908ae2a4acecb290ab472",
  "status": "support-only-ci-required-checks-list-v4-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "verdictHeld": true,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "Release gate status moves only with production-backed evidence.",
  "carriedForwardContract": {
    "sourceRppId": "RPP-0952",
    "sourceProofId": "rpp-0952-ci-required-checks-list-v3",
    "sourcePath": "docs/evidence/rpp-0952-ci-required-checks-list-v3.md",
    "requiredChecksUnchanged": true,
    "gateMovementRuleUnchanged": true,
    "supportOnlyReleaseEffectUnchanged": true,
    "finalReleasePostureUnchanged": "NO-GO"
  },
  "gateMovementRule": {
    "mode": "support-only",
    "releaseGateMovementAllowed": false,
    "currentEvidenceMovementAttempted": false,
    "productionBackedObservationsPresent": false,
    "requiredEvidenceForMovement": "fresh production-backed observations tied to the checked final-release path",
    "supportOnlyEvidenceEffect": "no-movement",
    "missingProductionBackedObservationEffect": "keeps-release-gate-held",
    "missingRequiredProofEffect": "fails-closed",
    "failedRequiredProofEffect": "fails-closed",
    "allowedStatusWithoutProductionEvidence": "support_only",
    "blockedStatusesWithoutProductionEvidence": [
      "partially_proven",
      "proven",
      "GO"
    ],
    "finalReleaseRequiredPosture": "NO-GO"
  },
  "requiredChecks": [
    {
      "id": "release-gates-evaluator",
      "area": "release-gates",
      "command": "node --test test/release-gates.test.js",
      "artifacts": [
        "src/release-gates.js",
        "test/release-gates.test.js",
        "docs/evidence/ao-release-gates.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "recovery-journal-proof",
      "area": "recovery-journal",
      "command": "node --test test/recovery-journal.test.js",
      "artifacts": [
        "src/recovery-journal.js",
        "test/recovery-journal.test.js",
        "docs/evidence/ao-journal-recovery.md",
        "fixtures/protocol/push-production-journal-lease-recovery-inspect-contract.json"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "auth-inspect-proof",
      "area": "authentication-boundary",
      "command": "node --test test/authenticated-http-push-client.test.js",
      "artifacts": [
        "src/authenticated-http-push-client.js",
        "test/authenticated-http-push-client.test.js",
        "docs/evidence/ao-executor-auth-leases.md",
        "fixtures/protocol/push-auth-session-fencing-contract.json"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "graph-identity-proof",
      "area": "graph-identity",
      "command": "node --test test/graph-mapping-inventory.test.js",
      "artifacts": [
        "scripts/bench/graph-mapping-inventory.js",
        "test/graph-mapping-inventory.test.js",
        "docs/evidence/ao-graph-identity.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "plugin-driver-proof",
      "area": "plugin-driver",
      "command": "node --test test/production-plugin-package-scenarios.test.js",
      "artifacts": [
        "scripts/playground/production-plugin-package-scenarios.js",
        "test/production-plugin-package-scenarios.test.js",
        "plugins/reprint-push/reprint-push.php",
        "docs/evidence/ao-plugin-driver.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "route-proof-contracts",
      "area": "route-contracts",
      "command": "node --test test/protocol-fixtures.test.js",
      "artifacts": [
        "fixtures/protocol/push-production-route-matrix-contract.json",
        "fixtures/protocol/push-production-ladder-contract.json",
        "docs/protocol.md",
        "docs/executor.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "evidence-coverage-proof",
      "area": "evidence-coverage",
      "command": "node --test test/generated-push-harness.test.js",
      "artifacts": [
        "test/generated-push-harness.test.js",
        "docs/generated-push-harness.md",
        "docs/scenario-matrix.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "operator-proof",
      "area": "operator-proof",
      "command": "node --test test/release-gates.test.js",
      "artifacts": [
        "docs/evidence/ao-release-gates.md",
        "docs/evidence/ao-progress-report.md",
        "progress.html"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "artifact-redaction-proof",
      "area": "artifact-integrity",
      "command": "node --test test/evidence-redaction.test.js",
      "artifacts": [
        "src/evidence-redaction.js",
        "test/evidence-redaction.test.js",
        "docs/evidence/ao-evidence-redaction.md",
        "docs/scenario-matrix.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
    },
    {
      "id": "provenance-proof",
      "area": "artifact-integrity",
      "command": "node --test test/protocol-compatibility.test.js",
      "artifacts": [
        "src/protocol-compatibility.js",
        "test/protocol-compatibility.test.js",
        "fixtures/protocol/push-production-pull-bridge-contract.json",
        "docs/protocol.md"
      ],
      "blocking": true,
      "productionObservationRequired": true,
      "productionBackedObservationPresent": false,
      "supportOnlyObservationPresent": true,
      "releaseGateMovementAllowed": false,
      "supportOnlyEvidenceEffect": "no-movement",
      "missingProductionBackedObservationEffect": "blocks-release-gate-movement",
      "missingRequiredProofEffect": "fails-closed",
      "failedRequiredProofEffect": "fails-closed",
      "releaseStatusWithoutProductionObservation": "NO-GO"
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
  "failedRequiredProofEvaluator": {
    "evidenceScope": "final-release",
    "failedGateId": "dry-run-route-eligibility",
    "failedGateCode": "DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED",
    "expectedGateState": "held",
    "expectedCandidateMovementAllowed": false,
    "expectedReleaseMovementAllowed": false,
    "expectedFinalGates": "19/20",
    "expectedCandidateGates": "19/20",
    "expectedStatusMarker": "[release-gates-ci:held final=19/20 candidate=19/20 reason=DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED]",
    "expectedFinalReleaseStatus": "NO-GO",
    "expectedTotals": {
      "gates": 20,
      "passed": 19,
      "candidate": 0,
      "missing": 0,
      "failed": 1,
      "blocking": 1
    },
    "releaseGateMovementAllowed": false,
    "releaseGateStatusMovementAllowed": false,
    "failureMode": "fails-closed"
  },
  "finalReleaseEvaluator": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:00:00.000Z",
    "expectedExit": 1,
    "observedReleaseStatus": "NO-GO",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "primaryFailureBucket": "topology",
    "status": "held",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false,
    "releaseGateStatusMovementAllowed": false,
    "failureMode": "fails-closed",
    "finalGates": "3/20",
    "candidateGates": "3/20",
    "missingRequiredProofCount": 17,
    "failedRequiredProofCount": 0
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
  "evidenceLimits": {
    "mode": "support-only-ci-required-checks-list-v4",
    "mutationAttempted": false,
    "rawPayloadsStored": false,
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "releaseGateStatusMutated": false,
    "releaseGateChanged": false,
    "releaseStatusChanged": false,
    "releaseGateStatusMovementAllowed": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false
  },
  "validationCommands": [
    {
      "command": "git rev-parse HEAD",
      "expectedExit": 0,
      "observed": "7f88e42b2aedd39cf83908ae2a4acecb290ab472 before adding this evidence"
    },
    {
      "command": "node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md",
      "expectedExit": 0,
      "observed": "releaseVerdict 0/4, releaseStatus NO-GO, all four gates support_only"
    },
    {
      "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:00:00.000Z",
      "expectedExit": 1,
      "observed": "held NO-GO with REPRINT_PUSH_LIVE_SOURCE_REQUIRED, final 3/20, candidate 3/20, mutationAttempted false"
    },
    {
      "command": "node --check test/rpp-0972-ci-required-checks-list-v4.test.js",
      "expectedExit": 0,
      "observed": "JavaScript syntax accepted"
    },
    {
      "command": "node --test --test-name-pattern RPP-0972 test/rpp-0972-ci-required-checks-list-v4.test.js",
      "expectedExit": 0,
      "observed": "Focused RPP-0972 tests pass"
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0972-ci-required-checks-list-v4.md",
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

## Required check list

| Check id | Area | Required command | Blocking | Production-backed observation | Missing or failed required proof | Movement without production observation |
| --- | --- | --- | --- | --- | --- | --- |
| `release-gates-evaluator` | release gates | `node --test test/release-gates.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `recovery-journal-proof` | recovery journal | `node --test test/recovery-journal.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `auth-inspect-proof` | authentication boundary | `node --test test/authenticated-http-push-client.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `graph-identity-proof` | graph identity | `node --test test/graph-mapping-inventory.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `plugin-driver-proof` | plugin driver | `node --test test/production-plugin-package-scenarios.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `route-proof-contracts` | route contracts | `node --test test/protocol-fixtures.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `evidence-coverage-proof` | evidence coverage | `node --test test/generated-push-harness.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `operator-proof` | operator proof | `node --test test/release-gates.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `artifact-redaction-proof` | artifact integrity | `node --test test/evidence-redaction.test.js` | Blocking | Required | Fail closed | Held, no movement |
| `provenance-proof` | artifact integrity | `node --test test/protocol-compatibility.test.js` | Blocking | Required | Fail closed | Held, no movement |

## Review finding

RPP-0972 is support-only CI required-check evidence. It carries forward the
RPP-0952 v3 CI-required-checks contract: every listed CI/release check remains
blocking, and every check requires fresh production-backed observations before
release-gate status movement. Missing production-backed proof and failed
required proof both fail closed. This artifact provides only support evidence,
so it cannot move a gate from `support_only` toward `partially_proven`,
`proven`, or `GO`.

Gate movement therefore remains held and final release remains **NO-GO**.

## Exact commands linked to this audit

| Purpose | Exact command | Expected result |
| --- | --- | --- |
| Audited commit | `git rev-parse HEAD` | `7f88e42b2aedd39cf83908ae2a4acecb290ab472` before adding this evidence |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | `releaseVerdict` `0/4`, release status `NO-GO`, all four gates `support_only` |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:00:00.000Z` | exit `1`, `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, final `3/20`, no mutation |
| Focused syntax check | `node --check test/rpp-0972-ci-required-checks-list-v4.test.js` | JavaScript syntax accepted |
| Focused RPP-0972 regression | `node --test --test-name-pattern RPP-0972 test/rpp-0972-ci-required-checks-list-v4.test.js` | support-only evidence cannot move final release and final release stays `NO-GO` |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0972-ci-required-checks-list-v4.md` | evidence artifact scans cleanly |
| Whitespace check | `git diff --check` | no whitespace errors |

Integration recommendation: **NO-GO** for release movement. Integrate only as
support evidence for the RPP-0972 CI required checks list v4 until fresh
production-backed observations prove the checked final-release path.
