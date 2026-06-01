# RPP-0862 Docker WordPress topology v4 evidence

Date: 2026-06-01
Lane: RPP-0862 Docker WordPress topology, variant 4
Checklist item: RPP-0862 - Add focused regression coverage for Docker
WordPress topology, variant 4. Success: verify:release passes without packaged
fallback on the topology.

## Scope

This slice records deterministic local support evidence for the Docker
WordPress topology release-verifier contract. It follows the RPP-0842 variant
3 pattern, but narrows variant 4 around the release acceptance rule: the
topology can only satisfy the slice when it runs `npm run verify:release` on
Docker service DNS with packaged fallback disabled and unobserved.

The Docker runtime is unavailable in this sandbox, so this file is support-only
and fail-closed. It does not claim site startup, route receipts, production
backing, mutation behavior, release movement, or a production-ready Docker
artifact. Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0862",
  "proofId": "rpp-0862-docker-wordpress-topology-v4",
  "variant": 4,
  "title": "Docker WordPress topology release verifier regression coverage",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "coverageMode": "generated-local-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "closestTemplate": "RPP-0842 docker-wordpress-topology-v3",
    "priorDockerTopologyEvidence": [
      "RPP-0802 docker-wordpress-topology-v1",
      "RPP-0822 docker-wordpress-topology-v2",
      "RPP-0842 docker-wordpress-topology-v3"
    ],
    "productionTopologyEvidence": [
      "RPP-0841 three-site local production topology v3",
      "RPP-0861 three-site local production topology v4"
    ],
    "dockerTopologyVariant": "RPP-0802-variant-1",
    "runtime": "docker-local-wordpress",
    "gate": "GATE-3",
    "blockedArtifactHash": "11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2"
  },
  "successContract": {
    "criterion": "verify-release-passes-without-packaged-fallback-on-docker-wordpress-topology-or-exact-unavailable-capability",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "exactUnavailableCapabilityRecorded": true,
    "passedArtifactWouldBeAccepted": true,
    "packagedFallbackMaySatisfySuccess": false,
    "finalReleaseMayMove": false
  },
  "generatedCoverage": {
    "coverageId": "docker-wordpress-topology-v4-release-contract-regression",
    "sourcePattern": "RPP-0842 support report plus variant-4 release acceptance matrix",
    "requiredOutcome": "verify-release-passes-without-packaged-fallback-on-topology-or-exact-unavailable-capability",
    "blockedOutcome": "exact-unavailable-capability-recorded",
    "productionBackedArtifactPresent": false,
    "releaseGateMayConsumeAsProduction": false,
    "requiredAssertions": [
      "probe-cli-compose-daemon-before-topology-start",
      "bind-release-env-to-private-docker-dns-hosts",
      "publish-only-loopback-8080-inspection-ingress",
      "invoke-npm-run-verify-release-inside-runner",
      "accept-release-gate-artifact-only-after-passed-docker-run",
      "reject-packaged-fallback-env-and-runner-flags",
      "record-fail-closed-capability-matrix-when-docker-unavailable",
      "preserve-support-only-no-go"
    ],
    "assertionDigest": "sha256:661f4dea16fc002f0c9249d0b638470fbbde626457d50d23a1875bdcd6a6dafd"
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
        "docker-wordpress-topology-v4-release-contract-regression",
        "verify-release-without-packaged-fallback-on-topology"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "dockerWordPressTopologyV4": {
    "proofScope": "docker-wordpress-topology-v4",
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
    "releaseEnvHostBindings": [
      {
        "envKey": "REPRINT_PUSH_SOURCE_URL",
        "role": "source",
        "serviceHost": "wp-source"
      },
      {
        "envKey": "REPRINT_PUSH_REMOTE_URL",
        "role": "source-alias",
        "serviceHost": "wp-source"
      },
      {
        "envKey": "REPRINT_PUSH_REMOTE_CHANGED_URL",
        "role": "remote-changed",
        "serviceHost": "wp-remote-changed"
      },
      {
        "envKey": "REPRINT_PUSH_LOCAL_URL",
        "role": "local-edited",
        "serviceHost": "wp-local-edited"
      },
      {
        "envKey": "REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL",
        "role": "apply-revalidation-source",
        "serviceHost": "wp-apply-revalidation-source"
      }
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
      "command": "npm run verify:release",
      "commandArgsDigest": "sha256:f5fdfc8cf7bc24cddcc1bf978eeb5e28c4b15750d6195f3c831d9ed5a43ec6b4",
      "releaseUrlsUseDockerDns": true,
      "releaseCommandIsVerifyRelease": true,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "acceptedForReleaseGateAfterPassedArtifactOnly": true,
      "blockedArtifactAcceptedForReleaseGate": false,
      "passArtifactRequiresVerifierEvidence": true
    },
    "prerequisiteBlockerMatrix": [
      {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "failClosed": true,
        "startsTopology": false
      },
      {
        "code": "DOCKER_COMPOSE_UNAVAILABLE",
        "capability": "docker-compose-v2",
        "command": "docker compose version --short",
        "failClosed": true,
        "startsTopology": false
      },
      {
        "code": "DOCKER_DAEMON_UNAVAILABLE",
        "capability": "docker-daemon",
        "command": "docker info --format {{json .ServerVersion}}",
        "failClosed": true,
        "startsTopology": false
      }
    ],
    "releaseAcceptance": {
      "blockedArtifactAccepted": false,
      "passedArtifactAccepted": true,
      "passedArtifactStatus": "passed",
      "passedArtifactReleaseCommand": "npm run verify:release",
      "passedArtifactPackagedFallbackObserved": false,
      "passedArtifactUsesDockerDns": true,
      "finalReleaseMovementAllowedFromSupportEvidence": false,
      "finalReleaseFailureCode": "LOCAL_CANDIDATE_EVIDENCE_ONLY"
    },
    "requirementCount": 9,
    "requirementSurfaces": [
      "docker-cli-compose-daemon-prerequisites",
      "four-wordpress-role-services-started",
      "private-docker-network-service-dns",
      "loopback-8080-only-inspection-ingress",
      "runner-invokes-npm-run-verify-release",
      "release-env-binds-to-docker-service-hosts",
      "passed-artifact-required-before-release-gate-acceptance",
      "packaged-fallback-disabled-and-unobserved",
      "variant-4-support-only-no-go"
    ],
    "releaseEnvBindingDigest": "sha256:d0ec3f39463b65413c6249468d4b698a5adef55035a118120cfcc5fa44fa72b6",
    "blockerMatrixDigest": "sha256:938247c4442236af4ad40024cf5bbef03d35f5bb9245f7311bb1847bbc1e3eca",
    "serviceSurfaceDigest": "sha256:62ac55140ec23fcb8e557c098fdf49179d972e55a924566a7039651fd185828b",
    "requirementDigest": "sha256:eb1c700c60ad35128c8aa0ed07e80bc1cc96eddc0a30b91ce324d390e58a69ea",
    "scopeHash": "sha256:9302d654437e8948a45f2b628795f1b1585e13281151b915f778bb0e3d016a4c"
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
    "evidenceSurfaceCount": 10,
    "surfaceNames": [
      "docker-wordpress-service-hosts",
      "docker-release-env-host-bindings",
      "docker-private-network",
      "sandbox-8080-only-ingress",
      "verify-release-command-contract",
      "passed-artifact-acceptance-matrix",
      "packaged-fallback-disabled",
      "docker-prerequisite-blocker-matrix",
      "release-gate-fail-closed",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:609e42314fb682d1a72168e3e46f4dd8023f55cd95b444f63de3b26a23d1b692"
  },
  "invariants": {
    "verifyReleasePassedWithoutPackagedFallbackOnTopologyOrExactCapability": true,
    "failClosedWhenDockerUnavailable": true,
    "releaseMovementBlocked": true,
    "dockerDnsReleaseEnvRecordedWithoutRawUrls": true,
    "onlySandbox8080Ingress": true,
    "noTunnelOutput": true,
    "noPackagedFallback": true,
    "passedArtifactRequiredForAcceptance": true,
    "generatedCoverageIsSupportOnly": true,
    "noProductionBackedProofClaim": true,
    "supportOnlyNoGo": true
  },
  "supportReportHash": "sha256:6e27264b7dddfdc5ebecae049ae0e0e3071ec952c3aa7cac8205a609e548a463"
}
```

## Focused Test

`test/rpp-0862-docker-wordpress-topology-v4.test.js` validates:

- the support report identity, scope, and self-hashes;
- release env host bindings for source, source alias, changed remote, local
  edited, and apply-revalidation source;
- the release verifier command is `npm run verify:release`;
- the passed-artifact acceptance path requires Docker DNS and no packaged
  fallback;
- blocked artifacts stay unaccepted and preserve final release **NO-GO**;
- Docker CLI, Compose, and daemon blockers all map to fail-closed exact
  unavailable capability records;
- widened ingress, fallback flags, non-DNS release URLs, and tunnel-shaped
  runner references are rejected; and
- emitted evidence remains hash/count/surface-only with no raw URL payloads.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0862-docker-wordpress-topology-v4.test.js
node --test --test-name-pattern RPP-0862 test/rpp-0862-docker-wordpress-topology-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0862-docker-wordpress-topology-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0862-docker-wordpress-topology-v4.test.js`: exit 0
- RPP-0862 focused proof test: exit 0, 1 reported test file passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

Integrate as support-only regression coverage for the Docker WordPress topology
variant-4 release contract. Keep final release movement blocked until a
Docker-capable environment produces a passed topology artifact from
`npm run verify:release:docker-local-production` where the runner executes
`npm run verify:release` without packaged fallback.
