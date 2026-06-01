# RPP-0908 privacy/redaction review evidence

Date: 2026-06-01
Worker: `rpp-908`
Branch: `session/rpp-908`
Variant: 1
Release recommendation: `NO-GO`
Evidence mode: hash/count/surface-only

## Evidence record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0908",
  "workerId": "rpp-908",
  "variant": 1,
  "title": "Privacy/redaction review",
  "generatedAt": "2026-06-01T01:46:21.000Z",
  "auditedBranch": "session/rpp-908",
  "evidenceMode": "hash-count-surface-only",
  "supportOnly": true,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "releaseGateStatusMovement": "none",
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
  "blockedFailureModes": [
    {
      "case": "missing-observation",
      "code": "REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING",
      "expectedReleaseStatus": "NO-GO"
    },
    {
      "case": "failed-observation",
      "code": "REQUIRED_RELEASE_CHECK_FAILED",
      "expectedReleaseStatus": "NO-GO"
    },
    {
      "case": "command-mismatch",
      "code": "REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH",
      "expectedReleaseStatus": "NO-GO"
    },
    {
      "case": "missing-artifact-observation",
      "code": "REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING",
      "expectedReleaseStatus": "NO-GO"
    },
    {
      "case": "stale-observation",
      "code": "REQUIRED_RELEASE_CHECK_STALE",
      "expectedReleaseStatus": "NO-GO"
    }
  ],
  "ciBlockingEvidence": {
    "requiredChecksCommand": "node ./scripts/release/required-release-checks-report.mjs --fixture <surface-only-redaction-failure-fixture> --now 2026-05-28T08:30:00.000Z",
    "expectedExit": 1,
    "expectedReportStatus": "held",
    "expectedReleaseReady": false,
    "expectedFinalReleaseStatus": "NO-GO",
    "mutationAttempted": false
  },
  "hashCountSurfaceOnly": {
    "artifactSurfaceCount": 6,
    "requiredCheckCount": 10,
    "redactionRequiredCheckCount": 1,
    "failureModeCount": 5,
    "rawUrlsIncluded": false,
    "credentialsIncluded": false,
    "cookiesIncluded": false,
    "tokensIncluded": false,
    "payloadsStored": false
  },
  "surfaceHashes": {
    "requiredReleaseChecksHash": "sha256:8da71bfb4b6fe04583bc53dc0ad9ef8294860eda2561b3016e388620d3e8f0ae",
    "requiredReleaseChecksReportHash": "sha256:c80d2eaa5c8e5965fdd0457ce41acb732db25bb31aae635ea6db85e5b2ffe2ad",
    "artifactRedactionScanHash": "sha256:2489960afb710def170c7d8a296b1feb5e08bc4ad1030bcc3269c38ec1a76df0",
    "evidenceRedactionTestHash": "sha256:fe0b2fc5fefb42e20ecf917f8b8f74fad8d67808c09f9465cb3ca727c5e0d78b",
    "evidenceRedactionDocHash": "sha256:09d0de0845bab3cdb3db51dee786f0726e5808891bb4553cdd9abe83fb17edc2",
    "requiredChecksFixtureHash": "sha256:44544d57cc6ee49ab1e2128ba650db0c50fc8607b9ce9d2510044df7398e029c"
  },
  "validationCommands": [
    "node --check test/rpp-0908-privacy-redaction-review.test.js",
    "node --test --test-name-pattern RPP-0908 test/rpp-0908-privacy-redaction-review.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/security/privacy-redaction-review.md docs/evidence/rpp-0908-privacy-redaction-review.md",
    "git diff --check"
  ],
  "integrationRecommendation": "Keep final release NO-GO until CI has a fresh passed artifact-redaction-proof observation and all other required release proofs are release-ready."
}
```

## Review summary

This evidence proves the release-check layer blocks release readiness when the
required redaction proof fails. It does not assert production readiness, does
not store raw private material, and does not move release-gate status.

The focused test `test/rpp-0908-privacy-redaction-review.test.js` exercises the
blocking cases against the required release-check evaluator and its local CLI.
The review evidence should be integrated as release-ops support evidence for
RPP-0908 only.
