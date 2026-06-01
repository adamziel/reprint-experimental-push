# RPP-0988 privacy/redaction review release verifier v5 evidence

Date: 2026-06-01
Worker: `rpp-988`
Branch: `session/rpp-988`
Audited lane head before this evidence file: `7e869edb4cb562796d915048ad6908fa9ea9bb70`
Variant: 5
Release recommendation: `NO-GO`
Evidence mode: hash/count/surface-only

## Evidence record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0988",
  "sliceId": "RPP-0988",
  "workerId": "rpp-988",
  "variant": 5,
  "title": "Privacy/redaction review release verifier v5",
  "generatedAt": "2026-06-01T04:45:00.000Z",
  "auditedBranch": "session/rpp-988",
  "auditedLaneHeadBeforeEvidence": "7e869edb4cb562796d915048ad6908fa9ea9bb70",
  "evidenceMode": "hash-count-surface-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "releaseReadiness": "held",
  "finalReleaseStatus": "NO-GO",
  "releaseGateStatusMovement": "none",
  "releaseGateStatusUpdateAttempted": false,
  "releaseGateStatusFilesChanged": [],
  "carriedForwardContract": {
    "sourceRppId": "RPP-0968",
    "sourceVariant": 4,
    "sourceEvidence": "docs/evidence/rpp-0968-privacy-redaction-review-v4.md",
    "redactionScannerFailureCaseCount": 6,
    "requiredProofFailureOutcome": "nonzero-release-check-report",
    "missingProofFailureOutcome": "nonzero-release-check-report",
    "finalReleaseStatus": "NO-GO",
    "releaseGateStatusMovement": "none"
  },
  "successCriterion": "CI blocks release when a required proof fails.",
  "requiredProof": {
    "checkId": "artifact-redaction-proof",
    "area": "artifact-redaction",
    "ownerScope": "artifact-integrity",
    "severity": "blocking",
    "productionRequired": true,
    "command": "node --test test/evidence-redaction.test.js",
    "requiredArtifactCount": 4,
    "requiredArtifacts": [
      "src/evidence-redaction.js",
      "test/evidence-redaction.test.js",
      "docs/evidence/ao-evidence-redaction.md",
      "docs/scenario-matrix.md"
    ],
    "freshnessWindowMs": 604800000
  },
  "failureProofCases": [
    {
      "case": "raw-url",
      "scannerCode": "RAW_HTTP_URL",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    },
    {
      "case": "credential",
      "scannerCode": "CREDENTIAL_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    },
    {
      "case": "token",
      "scannerCode": "TOKEN_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    },
    {
      "case": "cookie",
      "scannerCode": "COOKIE_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    },
    {
      "case": "serialized-private-option",
      "scannerCode": "SERIALIZED_PRIVATE_OPTION",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    },
    {
      "case": "explicit-secret-key",
      "scannerCode": "SECRET_LIKE_KEY",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false,
      "expectedFinalReleaseStatus": "NO-GO",
      "releaseGateStatusMovement": "none"
    }
  ],
  "ciBlockingEvidence": {
    "requiredChecksCommand": "node ./scripts/release/required-release-checks-report.mjs --fixture <surface-only-redaction-failure-fixture> --now 2026-05-28T08:30:00.000Z",
    "missingRequiredChecksCommand": "node ./scripts/release/required-release-checks-report.mjs --fixture <surface-only-redaction-missing-fixture> --now 2026-05-28T08:30:00.000Z",
    "expectedExit": 1,
    "expectedReportStatus": "held",
    "expectedReleaseReady": false,
    "expectedFinalReleaseStatus": "NO-GO",
    "failedCheckId": "artifact-redaction-proof",
    "failedObservationStatus": "failed",
    "missingCheckId": "artifact-redaction-proof",
    "missingRequiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING",
    "failureSurfaceCount": 1,
    "mutationAttempted": false,
    "releaseGateStatusMovement": "none"
  },
  "missingProofCase": {
    "checkId": "artifact-redaction-proof",
    "observationPresent": false,
    "expectedRequiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING",
    "expectedCiExit": 1,
    "expectedReportStatus": "held",
    "expectedReleaseReady": false,
    "expectedFinalReleaseStatus": "NO-GO",
    "releaseGateStatusMovement": "none"
  },
  "supportOnlyObservationCase": {
    "checkId": "artifact-redaction-proof",
    "observationStatus": "support_only",
    "exactCommandRecorded": true,
    "requiredArtifactsRecorded": true,
    "freshTimestampRecorded": true,
    "expectedRequiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_NOT_PASSED",
    "expectedCiExit": 1,
    "expectedReportStatus": "held",
    "expectedReleaseReady": false,
    "expectedFinalReleaseStatus": "NO-GO",
    "releaseGateStatusMovement": "none"
  },
  "unresolvedProductionBackedProofGaps": [
    "fresh passed production-backed artifact-redaction-proof observation",
    "all other required release proofs release-ready"
  ],
  "unresolvedProductionBackedProofGapStatus": "open-fail-closed",
  "hashCountSurfaceOnly": {
    "auditedSurfaceCount": 5,
    "requiredCheckCount": 10,
    "redactionRequiredCheckCount": 1,
    "failureModeCount": 6,
    "missingProofCaseCount": 1,
    "supportOnlyCaseCount": 1,
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "tokensIncluded": false,
    "cookiesIncluded": false,
    "serializedPrivateOptionsIncluded": false,
    "explicitSecretKeysIncluded": false,
    "privateValuesIncluded": false,
    "payloadsStored": false,
    "hashOnlyEvidenceAllowed": true,
    "countOnlyEvidenceAllowed": true
  },
  "surfaceHashes": {
    "artifactRedactionScanHash": "sha256:2489960afb710def170c7d8a296b1feb5e08bc4ad1030bcc3269c38ec1a76df0",
    "requiredReleaseChecksHash": "sha256:8da71bfb4b6fe04583bc53dc0ad9ef8294860eda2561b3016e388620d3e8f0ae",
    "requiredReleaseChecksReportHash": "sha256:c80d2eaa5c8e5965fdd0457ce41acb732db25bb31aae635ea6db85e5b2ffe2ad",
    "requiredChecksFixtureHash": "sha256:44544d57cc6ee49ab1e2128ba650db0c50fc8607b9ce9d2510044df7398e029c",
    "privacyRedactionReviewHash": "sha256:8b7a8ad1857674b040ff4b0adb0bc30f718c6b5f857e869dac137024e6370e1b"
  },
  "validationCommands": [
    "node --check test/rpp-0988-privacy-redaction-review-release-verifier-v5.test.js",
    "node --test --test-name-pattern RPP-0988 test/rpp-0988-privacy-redaction-review-release-verifier-v5.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0988-privacy-redaction-review-release-verifier-v5.md",
    "git diff --check"
  ],
  "integrationRecommendation": "Keep final release NO-GO until CI has a fresh passed production-backed artifact-redaction-proof observation and all other required release proofs are release-ready."
}
```

## Review summary

This support-only release-verifier carry-through evidence keeps the RPP-0968 v4
privacy/redaction review contract intact for the required
`artifact-redaction-proof` release check. Each scanner failure class remains
mapped to a failed required proof observation, and the focused RPP-0988 test
verifies that each mapped case makes the required-check report exit nonzero
with release status `held`.

RPP-0988 also records the missing-proof path explicitly: when the required
privacy/redaction observation is absent, the required-check report exits
nonzero, reports `REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING`, and keeps final
release readiness held. Support-only evidence does not satisfy final release
readiness, and unresolved production-backed proof gaps remain open and fail
closed.

The evidence intentionally stores only reason codes, counts, command strings,
and hashes. It stores no raw URL, credential, token, cookie, serialized private
option, explicit secret-key value, private value, payload, release-gate status
movement, or remote tunnel instruction. Final release remains `NO-GO`.
