# RPP-0882 Docker WordPress topology v5 evidence

Date: 2026-06-01
Lane: RPP-0882 Docker WordPress topology release-verifier carry-through,
variant 5
Checklist item: RPP-0882 - Carry through the release verifier for Docker
WordPress topology, variant 5. Success: verify:release passes without packaged
fallback on the topology.

## Scope

This slice records deterministic local support evidence for the Docker
WordPress topology release-verifier carry-through contract. It follows the
RPP-0862 variant 4 Docker topology pattern, then adds variant 5 checks that the
topology command carries through `npm run verify:release`, records the
verifier failure reason when Docker is unavailable, and rejects packaged
fallback as a satisfaction path.

The Docker runtime is unavailable in this sandbox, so this file is support-only
and fail-closed. It does not claim site startup, route receipts, production
backing, mutation behavior, release movement, or a production-ready Docker
artifact. Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0882",
  "proofId": "rpp-0882-docker-wordpress-topology-v5",
  "variant": 5,
  "title": "Docker WordPress topology release verifier carry-through",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "coverageMode": "release-verifier-carry-through-local-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "closestTemplate": "RPP-0862 docker-wordpress-topology-v4",
    "priorDockerTopologyEvidence": [
      "RPP-0802 docker-wordpress-topology-v1",
      "RPP-0822 docker-wordpress-topology-v2",
      "RPP-0842 docker-wordpress-topology-v3",
      "RPP-0862 docker-wordpress-topology-v4"
    ],
    "productionTopologyEvidence": [
      "RPP-0841 three-site local production topology v3",
      "RPP-0861 three-site local production topology v4"
    ],
    "dockerTopologyVariant": "RPP-0802-variant-1",
    "runtime": "docker-local-wordpress",
    "gate": "GATE-3",
    "releaseVerifierCommand": "npm run verify:release",
    "blockedArtifactHash": "70296b050252af0fe0c2d09d907ca3a61ce3e88d3f4b52c7b0f7052d6bd7fc63"
  },
  "successContract": {
    "criterion": "verify-release-passes-without-packaged-fallback-on-docker-wordpress-topology-or-exact-unavailable-capability",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "exactUnavailableCapabilityRecorded": true,
    "releaseVerifierCarriedThrough": true,
    "passedArtifactWouldBeAccepted": false,
    "packagedFallbackMaySatisfySuccess": false,
    "finalReleaseMayMove": false
  },
  "generatedCoverage": {
    "coverageId": "docker-wordpress-topology-v5-release-verifier-carry-through",
    "sourcePattern": "RPP-0862 support report plus variant-5 release-verifier carry-through matrix",
    "requiredOutcome": "verify-release-passes-without-packaged-fallback-on-topology-or-exact-unavailable-capability",
    "blockedOutcome": "exact-unavailable-capability-recorded-with-verify-release-failure-carried-through",
    "productionBackedArtifactPresent": false,
    "releaseGateMayConsumeAsProduction": false,
    "requiredAssertions": [
      "carry-topology-command-through-to-npm-run-verify-release",
      "record-verify-release-failure-reason-when-docker-unavailable",
      "require-private-docker-dns-release-env-hosts",
      "reject-packaged-fallback-env-and-runner-flags",
      "keep-passed-docker-artifact-as-local-candidate-evidence",
      "preserve-loopback-8080-only-inspection-ingress",
      "record-fail-closed-capability-matrix-when-docker-unavailable",
      "preserve-support-only-no-go"
    ],
    "assertionDigest": "sha256:ad67f3838773aa1c094f311936e1e5d5b3824cd301bcc0766c8f27e039a44e02"
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
        "docker-wordpress-topology-v5-release-verifier-carry-through",
        "verify-release-passes-without-packaged-fallback-on-topology"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "dockerWordPressTopologyV5": {
    "proofScope": "docker-wordpress-topology-v5",
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
      "carriedThroughByTopologyCommand": true,
      "status": "blocked",
      "failClosed": true,
      "verifyReleaseFailureReason": "DOCKER_CLI_MISSING",
      "verifyReleaseFailureExitCode": 2,
      "releaseUrlsUseDockerDns": true,
      "releaseCommandIsVerifyRelease": true,
      "noPackagedFallback": true,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "acceptedForReleaseGateAfterPassedArtifactOnly": false,
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
    "releaseVerifierCarryThrough": {
      "command": "npm run verify:release",
      "topologyCommand": "npm run verify:release:docker-local-production",
      "carriedThroughByTopologyCommand": true,
      "status": "blocked",
      "failClosed": true,
      "verifyReleaseFailure": {
        "exitCode": 2,
        "reason": "DOCKER_CLI_MISSING"
      },
      "noPackagedFallback": true,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "releaseUrlsUseDockerDns": true,
      "releaseCommandIsVerifyRelease": true,
      "acceptedForReleaseGate": false,
      "releaseMovementAllowed": false,
      "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
      "releaseGateTotals": {
        "gates": 21,
        "passed": 0,
        "candidate": 5,
        "missing": 16,
        "failed": 0,
        "blocking": 21
      },
      "requiredCarryThrough": [
        "topology-command-invokes-npm-run-verify-release",
        "verify-release-failure-reason-carried-when-topology-blocked",
        "verify-release-success-remains-local-candidate-without-production-provenance",
        "no-packaged-fallback-env-or-runner-flags",
        "docker-service-dns-release-urls-required"
      ]
    },
    "releaseAcceptance": {
      "blockedArtifactAccepted": false,
      "passedArtifactAccepted": false,
      "passedArtifactStatus": "passed",
      "passedArtifactReleaseCommand": "npm run verify:release",
      "passedArtifactPackagedFallbackObserved": false,
      "passedArtifactUsesDockerDns": true,
      "finalReleaseMovementAllowedFromSupportEvidence": false,
      "finalReleaseFailureCode": "LOCAL_CANDIDATE_EVIDENCE_ONLY"
    },
    "requirementCount": 10,
    "requirementSurfaces": [
      "docker-cli-compose-daemon-prerequisites",
      "four-wordpress-role-services-started",
      "private-docker-network-service-dns",
      "loopback-8080-only-inspection-ingress",
      "topology-runner-invokes-npm-run-verify-release",
      "release-verifier-failure-carry-through",
      "release-env-binds-to-docker-service-hosts",
      "production-provenance-required-for-release-gate-acceptance",
      "packaged-fallback-disabled-and-unobserved",
      "variant-5-support-only-no-go"
    ],
    "releaseEnvBindingDigest": "sha256:d0ec3f39463b65413c6249468d4b698a5adef55035a118120cfcc5fa44fa72b6",
    "blockerMatrixDigest": "sha256:938247c4442236af4ad40024cf5bbef03d35f5bb9245f7311bb1847bbc1e3eca",
    "releaseVerifierCarryThroughDigest": "sha256:01dbd8f9717b5a4298e944bc5b6ea0336d3bafe0d7fba68c8656fea3e905dfbf",
    "serviceSurfaceDigest": "sha256:62ac55140ec23fcb8e557c098fdf49179d972e55a924566a7039651fd185828b",
    "requirementDigest": "sha256:46f369393efdaa5c9c98ced13c46087fe6a1b2613afa04f5062537bb63f0147f",
    "scopeHash": "sha256:b26eaffaaec63f6484beb19c3f520520ee4abe586f9d216686d34c84cd24cc26"
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
    "evidenceSurfaceCount": 11,
    "surfaceNames": [
      "docker-wordpress-service-hosts",
      "docker-release-env-host-bindings",
      "docker-private-network",
      "sandbox-8080-only-ingress",
      "verify-release-command-contract",
      "release-verifier-failure-carry-through",
      "passed-artifact-acceptance-matrix",
      "packaged-fallback-disabled",
      "docker-prerequisite-blocker-matrix",
      "release-gate-fail-closed",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:849409fa95d8067795728150686f436b7ecc01ff35920b5d074234f9e219c37b"
  },
  "invariants": {
    "verifyReleasePassedWithoutPackagedFallbackOnTopologyOrExactCapability": true,
    "releaseVerifierCarriedThrough": true,
    "releaseVerifierFailureReasonMatchesUnavailableCapability": true,
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
  "supportReportHash": "sha256:0b04e856cfaf99ca5b59ded86ae9a4c9fd046481f92a9e258019281805af14c2"
}
```

## Focused Test

`test/rpp-0882-docker-wordpress-topology-v5.test.js` validates:

- the support report identity, scope, and self-hashes;
- release env host bindings for source, source alias, changed remote, local
  edited, and apply-revalidation source;
- the topology command carries through `npm run verify:release`;
- blocked topology artifacts carry the verifier failure reason and remain
  unaccepted for the release gate;
- a passed local Docker artifact remains local-candidate evidence unless
  separate production provenance is present;
- Docker CLI, Compose, and daemon blockers all map to fail-closed exact
  unavailable capability records;
- fallback flags, non-DNS release URLs, widened ingress, and tunnel-shaped
  runner references are rejected; and
- emitted evidence remains hash/count/surface-only with no raw URL payloads.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0882-docker-wordpress-topology-v5.test.js
node --test --test-name-pattern RPP-0882 test/rpp-0882-docker-wordpress-topology-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0882-docker-wordpress-topology-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0882-docker-wordpress-topology-v5.test.js`: exit 0
- RPP-0882 focused proof test: exit 0
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

Integrate as support-only regression coverage for the Docker WordPress topology
variant-5 release-verifier carry-through contract. Keep final release movement
blocked until a Docker-capable environment produces a passed topology artifact
from `npm run verify:release:docker-local-production` where the runner
executes `npm run verify:release` without packaged fallback.
