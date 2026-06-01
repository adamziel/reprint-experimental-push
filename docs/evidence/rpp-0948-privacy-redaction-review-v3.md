# RPP-0948 privacy/redaction review v3 evidence

Date: 2026-06-01
Worker: `rpp-948`
Branch: `session/rpp-948`
Audited lane head before this evidence file: `d42afbd346db9f8cc0d344faae0f5729ff55539a`
Variant: 3
Release recommendation: `NO-GO`
Evidence mode: hash/count/surface-only

## Evidence record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0948",
  "sliceId": "RPP-0948",
  "workerId": "rpp-948",
  "variant": 3,
  "title": "Privacy/redaction review v3",
  "generatedAt": "2026-06-01T03:03:00.000Z",
  "auditedBranch": "session/rpp-948",
  "auditedLaneHeadBeforeEvidence": "d42afbd346db9f8cc0d344faae0f5729ff55539a",
  "evidenceMode": "hash-count-surface-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "releaseReadiness": "held",
  "finalReleaseStatus": "NO-GO",
  "releaseGateStatusMovement": "none",
  "releaseGateStatusUpdateAttempted": false,
  "releaseGateStatusFilesChanged": [],
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
      "expectedReleaseReady": false
    },
    {
      "case": "credential",
      "scannerCode": "CREDENTIAL_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false
    },
    {
      "case": "token",
      "scannerCode": "TOKEN_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false
    },
    {
      "case": "cookie",
      "scannerCode": "COOKIE_VALUE",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false
    },
    {
      "case": "serialized-private-option",
      "scannerCode": "SERIALIZED_PRIVATE_OPTION",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false
    },
    {
      "case": "explicit-secret-key",
      "scannerCode": "SECRET_LIKE_KEY",
      "requiredProofObservationStatus": "failed",
      "requiredReleaseCheckCode": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedCiExit": 1,
      "expectedReportStatus": "held",
      "expectedReleaseReady": false
    }
  ],
  "ciBlockingEvidence": {
    "requiredChecksCommand": "node ./scripts/release/required-release-checks-report.mjs --fixture <surface-only-redaction-failure-fixture> --now 2026-05-28T08:30:00.000Z",
    "expectedExit": 1,
    "expectedReportStatus": "held",
    "expectedReleaseReady": false,
    "expectedFinalReleaseStatus": "NO-GO",
    "failedCheckId": "artifact-redaction-proof",
    "failedObservationStatus": "failed",
    "failureSurfaceCount": 1,
    "mutationAttempted": false
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
  "hashCountSurfaceOnly": {
    "auditedSurfaceCount": 5,
    "requiredCheckCount": 10,
    "redactionRequiredCheckCount": 1,
    "failureModeCount": 6,
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
    "node --check test/rpp-0948-privacy-redaction-review-v3.test.js",
    "node --test --test-name-pattern RPP-0948 test/rpp-0948-privacy-redaction-review-v3.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0948-privacy-redaction-review-v3.md",
    "git diff --check"
  ],
  "integrationRecommendation": "Keep final release NO-GO until CI has a fresh passed production-backed artifact-redaction-proof observation and all other required release proofs are release-ready."
}
```

## Review summary

This support-only evidence proves the required release-check layer keeps release
readiness held when the required artifact redaction proof reports a failure.
The focused RPP-0948 test maps each scanner rejection class to a failed
`artifact-redaction-proof` observation and verifies that the required-check
report exits nonzero with release status `held`.

The evidence intentionally stores only reason codes, counts, command strings,
and hashes. It stores no raw URL, credential, token, cookie, serialized private
option, explicit secret-key value, private value, payload, or release-gate
status movement. A fresh support-only observation is not accepted as final
release readiness. Final release remains `NO-GO`.
