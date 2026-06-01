# RPP-0822 Docker WordPress topology v2 evidence

Date: 2026-06-01
Lane: RPP-0822 Docker WordPress topology, variant 2
Checklist item: RPP-0822 - Docker WordPress topology, variant 2.

## Scope

This slice records support-only evidence for the Docker WordPress topology
release-verifier contract. It does not edit progress surfaces, release gates,
Docker harness code, shared helpers, or production runtime code.

The success contract is strict: the Docker topology must either run
`npm run verify:release` without packaged fallback or record the exact
unavailable capability that prevented the topology from starting. In this
sandbox, Docker CLI is unavailable, so this evidence is accepted only as
fail-closed support evidence.

Final release status remains **NO-GO**. This file does not claim production
backing, site startup, route receipts, mutation behavior, or release movement.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0822",
  "proofId": "rpp-0822-docker-wordpress-topology-v2",
  "variant": 2,
  "title": "Docker WordPress topology verify:release contract",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "adjacentEvidence": "RPP-0802 docker-wordpress-topology-v1",
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
      "requiredFor": [
        "docker-wordpress-sites-start",
        "docker-network-service-dns-readback",
        "verify-release-docker-topology-run",
        "docker-wordpress-topology-v2-release-proof"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "dockerWordPressTopologyV2": {
    "proofScope": "docker-wordpress-topology-v2",
    "siteRoleCount": 4,
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
      "packagedFallbackObserved": false
    },
    "requirementCount": 6,
    "requirementSurfaces": [
      "docker-cli-compose-daemon-available",
      "four-wordpress-role-services-started",
      "private-docker-network-service-dns",
      "topology-runner-invokes-verify-release",
      "packaged-fallback-disabled-and-unobserved",
      "release-gate-accepted-only-after-passing-docker-artifact"
    ],
    "scopeHash": "sha256:2c8227bc7c8db074daa02586c421fce17600a2ab25c483f91410223be9f53663",
    "serviceSurfaceDigest": "sha256:62ac55140ec23fcb8e557c098fdf49179d972e55a924566a7039651fd185828b",
    "requirementDigest": "sha256:f2641969537e8476fb9b498528960197c61ce1cb4dab1403a9beb6b6a355d1b0"
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
    "evidenceSurfaceCount": 8,
    "surfaceNames": [
      "docker-wordpress-service-hosts",
      "docker-private-network",
      "sandbox-8080-only-ingress",
      "verify-release-command-contract",
      "packaged-fallback-disabled",
      "exact-unavailable-capability",
      "release-gate-fail-closed",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:f1261ac913bd210ca3fc2f30591b98cb2fd86a7050788ab9b516d1820e3c220b"
  },
  "invariants": {
    "verifyReleasePassedWithoutPackagedFallbackOrExactCapability": true,
    "failClosedWhenDockerUnavailable": true,
    "releaseMovementBlocked": true,
    "dockerDnsSurfaceRecordedWithoutRawUrls": true,
    "onlySandbox8080Ingress": true,
    "noTunnelOutput": true,
    "noPackagedFallback": true,
    "hashCountSurfaceOnly": true,
    "supportOnlyNoGo": true
  },
  "supportReportHash": "sha256:6d6b7979031f7993d444964cba991e4d20a7416b7ad130f3268be545b51c3025"
}
```

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- accepted for release gate: `false`
- release movement allowed: `false`
- exact unavailable capability: `DOCKER_CLI_MISSING`
- packaged fallback observed: `false`

No site startup, route receipt, mutation receipt, or production-backed release
proof was observed.

## Focused Test

`test/rpp-0822-docker-wordpress-topology-v2.test.js` validates:

- the JSON support report is deterministic and self-hashing;
- the topology command is `npm run verify:release:docker-local-production`;
- the runner command remains `npm run verify:release`;
- Docker service hosts are recorded as service names, not raw URLs;
- blocked Docker capability evidence fails closed and release movement remains
  blocked;
- packaged fallback flags and non-`verify:release` runners are rejected;
- raw URL surfaces are rejected from the support report; and
- final release status and integration recommendation remain `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0822-docker-wordpress-topology-v2.test.js
node --test --test-name-pattern RPP-0822 test/rpp-0822-docker-wordpress-topology-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0822-docker-wordpress-topology-v2.md
git diff --check
```

Observed local results after implementation:

- syntax check: exit `0`
- focused RPP-0822 test: exit `0`
- evidence redaction scan: exit `0`, `ok: true`, 0 rejected files
- diff whitespace check: clean

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant records the Docker topology command contract and exact unavailable
capability in this sandbox. A Docker-capable environment still needs to produce
a passing `verify:release` artifact through the Docker WordPress topology,
without packaged fallback, before this can become production-backed release
evidence.
