# RPP-0842 Docker WordPress topology v3 evidence

Date: 2026-06-01
Lane: RPP-0842 Docker WordPress topology, variant 3
Checklist item: RPP-0842 - Docker WordPress topology generated coverage, variant 3.

## Scope

This slice records support-only generated coverage for the Docker WordPress
topology release-verifier contract. It only adds the focused RPP-0842 test and
this evidence file. It does not edit progress surfaces, release gates, Docker
harness code, shared helpers, package metadata, or production runtime code.

The success contract stays strict: the Docker topology must either run
`npm run verify:release` without packaged fallback, or record the exact
unavailable capability that prevented the topology from starting. The Docker
CLI is unavailable in this sandbox, so this evidence is accepted only as
fail-closed support evidence.

Final release status remains **NO-GO**. This file does not claim production
backing, site startup, route receipts, mutation behavior, or release movement.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0842",
  "proofId": "rpp-0842-docker-wordpress-topology-v3",
  "variant": 3,
  "title": "Docker WordPress topology generated coverage",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "coverageMode": "generated-local-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "adjacentEvidence": "RPP-0822 docker-wordpress-topology-v2",
    "priorVariantEvidence": "RPP-0802 docker-wordpress-topology-v1",
    "productionTopologyEvidence": [
      "RPP-0841 three-site local production topology v3",
      "RPP-0861 three-site local production topology v4"
    ],
    "dockerTopologyVariant": "RPP-0802-variant-1",
    "runtime": "docker-local-wordpress",
    "gate": "GATE-3",
    "artifactHash": "11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2"
  },
  "successContract": {
    "criterion": "verify-release-passes-without-packaged-fallback-or-exact-unavailable-capability",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "exactUnavailableCapabilityRecorded": true,
    "finalReleaseMayMove": false
  },
  "generatedCoverage": {
    "coverageId": "docker-wordpress-topology-v3-generated-coverage",
    "sourcePattern": "RPP-0822 support report plus RPP-0841/RPP-0861 local production topology boundaries",
    "requiredOutcome": "verify-release-passes-without-packaged-fallback-or-exact-unavailable-capability",
    "blockedOutcome": "exact-unavailable-capability-recorded",
    "productionBackedArtifactPresent": false,
    "releaseGateMayConsumeAsProduction": false,
    "requiredAssertions": [
      "record-command-contract-for-docker-topology-runner",
      "record-exact-unavailable-capability-when-docker-cannot-start",
      "reject-packaged-fallback-or-non-verify-release-runner",
      "reject-release-movement-without-passed-docker-artifact",
      "preserve-service-dns-host-surface-without-raw-urls",
      "preserve-final-release-no-go"
    ],
    "assertionDigest": "sha256:b4e758f1e5ae00f9386f255da321856054acd618a14026e1731e6e202390ff1b"
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "status": "blocked",
    "exitCode": 2,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "command": "docker --version",
      "missingExecutable": true,
      "observedShellExitCode": 127,
      "requiredFor": [
        "docker-wordpress-sites-start",
        "docker-network-service-dns-readback",
        "verify-release-docker-topology-run",
        "docker-wordpress-topology-v3-generated-coverage",
        "verify-release-without-packaged-fallback"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "dockerWordPressTopologyV3": {
    "proofScope": "docker-wordpress-topology-v3",
    "siteRoleCount": 4,
    "primaryWordPressRoleCount": 3,
    "supportWordPressRoleCount": 1,
    "startedSiteCount": 0,
    "startupBlockedBy": "DOCKER_CLI_MISSING",
    "requiredServiceHosts": [
      "wp-source",
      "wp-remote-changed",
      "wp-local-edited",
      "wp-apply-revalidation-source"
    ],
    "dockerServiceSurfaces": [
      {
        "role": "source",
        "serviceHost": "wp-source",
        "cliService": "cli-source",
        "dbService": "db-source",
        "releaseEnvKey": "REPRINT_PUSH_SOURCE_URL"
      },
      {
        "role": "remote-changed",
        "serviceHost": "wp-remote-changed",
        "cliService": "cli-remote-changed",
        "dbService": "db-remote-changed",
        "releaseEnvKey": "REPRINT_PUSH_REMOTE_CHANGED_URL"
      },
      {
        "role": "local-edited",
        "serviceHost": "wp-local-edited",
        "cliService": "cli-local-edited",
        "dbService": "db-local-edited",
        "releaseEnvKey": "REPRINT_PUSH_LOCAL_URL"
      },
      {
        "role": "apply-revalidation-source",
        "serviceHost": "wp-apply-revalidation-source",
        "cliService": "cli-apply-revalidation-source",
        "dbService": "db-apply-revalidation-source",
        "releaseEnvKey": "REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL"
      }
    ],
    "network": {
      "name": "reprint_private",
      "internal": true,
      "publishedHttpIngressCount": 1,
      "publishedHttpIngressPort": 8080,
      "publishedHttpIngressHostSurface": "loopback-only"
    },
    "releaseVerifier": {
      "releaseUrlsUseDockerDns": true,
      "releaseCommandIsVerifyRelease": true,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "acceptedForReleaseGateAfterPassedArtifactOnly": true
    },
    "requirementCount": 7,
    "requirementSurfaces": [
      "docker-cli-compose-daemon-available",
      "four-wordpress-role-services-started",
      "private-docker-network-service-dns",
      "topology-runner-invokes-verify-release",
      "packaged-fallback-disabled-and-unobserved",
      "release-gate-accepted-only-after-passing-docker-artifact",
      "generated-coverage-variant-3-support-only-no-go"
    ],
    "scopeHash": "sha256:30cd3c15f44492a680809fe139298b7dbaaef86ac27f718f79dd198710b029db",
    "serviceSurfaceDigest": "sha256:62ac55140ec23fcb8e557c098fdf49179d972e55a924566a7039651fd185828b",
    "requirementDigest": "sha256:88e422c9ee45260d9ad7a06d8c12786a138d911adc92075feeb32f1b9ce43c4e"
  },
  "releaseGate": {
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "mutationAttempted": false,
    "finalReleaseStatus": "NO-GO"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "rawUrlCount": 0,
    "rawPayloadCount": 0,
    "credentialSurfaceCount": 0,
    "tunnelOutputCount": 0,
    "evidenceSurfaceCount": 9,
    "surfaceNames": [
      "docker-wordpress-service-hosts",
      "docker-private-network",
      "sandbox-8080-only-ingress",
      "verify-release-command-contract",
      "packaged-fallback-disabled",
      "exact-unavailable-capability",
      "generated-coverage-variant-3",
      "release-gate-fail-closed",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:d827d1932b683a0d3ad40b92bb64f9ed872cdd05c14ddb4ab6074f7442b5ed61"
  },
  "invariants": {
    "verifyReleasePassedWithoutPackagedFallbackOrExactCapability": true,
    "failClosedWhenDockerUnavailable": true,
    "releaseMovementBlocked": true,
    "dockerDnsSurfaceRecordedWithoutRawUrls": true,
    "onlySandbox8080Ingress": true,
    "noTunnelOutput": true,
    "noPackagedFallback": true,
    "generatedCoverageIsSupportOnly": true,
    "noProductionBackedProofClaim": true,
    "supportOnlyNoGo": true
  },
  "supportReportHash": "sha256:f4ea471c2e811f9fc809e460b33e7600cef0fcfc92c6f82aedca49cf6cfba2bb"
}
```

## Observed Capability

The worker did not start the topology or any server. It first checked the
required Docker executable:

```sh
docker --version
```

Observed result: exit `127`, command unavailable. The focused RPP-0842 test
maps that prerequisite failure to the existing harness blocker
`DOCKER_CLI_MISSING`, verifies the fail-closed artifact shape, and confirms
release movement remains blocked.

No site startup, route receipt, mutation receipt, or production-backed release
proof was observed.

## Focused Test

`test/rpp-0842-docker-wordpress-topology-v3.test.js` validates:

- the JSON support report is deterministic and self-hashing;
- the generated coverage mode is support-only and variant 3 scoped;
- the topology command is `npm run verify:release:docker-local-production`;
- the runner command remains `npm run verify:release`;
- Docker service hosts are recorded as service names, not raw URLs;
- blocked Docker capability evidence fails closed and release movement remains
  blocked;
- packaged fallback flags and non-`verify:release` runners are rejected;
- raw URL surfaces and production-backed claims are rejected; and
- final release status and integration recommendation remain `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0842-docker-wordpress-topology-v3.test.js
node --test --test-name-pattern RPP-0842 test/rpp-0842-docker-wordpress-topology-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0842-docker-wordpress-topology-v3.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local results after implementation:

- syntax check: exit `0`
- focused RPP-0842 test: exit `0`
- evidence redaction scan: exit `0`, `ok: true`, 0 rejected files
- diff whitespace check: clean

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant records generated coverage for the Docker topology command
contract and exact unavailable capability in this sandbox. A Docker-capable
environment still needs to produce a passing `verify:release` artifact through
the Docker WordPress topology, without packaged fallback, before this can
become production-backed release evidence.
