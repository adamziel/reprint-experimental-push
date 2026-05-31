# RPP-0816 Plugin Update Hooks Topology Variant 1

Date: 2026-06-01

## Scope

RPP-0816 records the plugin update hooks topology requirements and the exact
topology-command capability that is unavailable in this sandbox. This is
deterministic support evidence only. It does not run a live plugin update, does
not start Docker WordPress sites in this sandbox, and does not move release
readiness.

This variant keeps the evidence hash/count/surface-only: hook names, booleans,
counts, command names, capability codes, and hashes are recorded; raw hook
payloads, site values, route bodies, and private material are not recorded.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0816",
  "variant": 1,
  "title": "Plugin update hooks topology prerequisite",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "topologyCommand": {
      "command": "npm run verify:release:docker-local-production",
      "topologyVariant": "RPP-0802-variant-1",
      "publishedIngressPort": 8080,
      "publishedIngressHost": "loopback-only",
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    },
    "pluginUpdateDependencyValidator": {
      "rppId": "RPP-0450",
      "kind": "plugin-update",
      "dependencyEvidence": "hash-only"
    }
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "candidateScope": {
    "status": "plugin-update-hooks-topology-candidate",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-support-topology-requirement-record",
    "hookTopologyRequirements": {
      "pluginLifecycle": "update",
      "requiresWordPressUpdaterRuntime": true,
      "requiresFilesystemWriteAccess": true,
      "requiresActivePluginBeforeUpdate": true,
      "requiresVersionTransitionReadback": true,
      "requiresPostUpdateHookReadback": true,
      "requiresNoPackagedFallback": true,
      "requiresDockerServiceDnsReleaseUrls": true,
      "hookSurface": [
        "pre_set_site_transient_update_plugins",
        "upgrader_pre_install",
        "upgrader_post_install",
        "upgrader_process_complete",
        "plugin-version-option-readback",
        "plugin-owned-schema-marker-readback"
      ],
      "candidateHookCount": 6,
      "rawHookPayloadsIncluded": false
    },
    "candidateClaims": [
      "plugin-update-hook-surface-inventory-recorded",
      "topology-command-fail-closed-capability-recorded",
      "docker-topology-policy-surface-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "live-plugin-update-execution",
      "wordpress-upgrader-package-download",
      "post-update-migration-side-effect-proof",
      "source-local-remote-changed-route-receipts",
      "release-verifier-accepted-plugin-update-hook-proof"
    ]
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "status": "blocked",
    "siteStartupStatus": "not-started",
    "sitesStarted": false,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "probeCommand": "docker --version",
      "missingExecutable": true
    },
    "runtime": "docker-local-wordpress",
    "topologyVariant": "RPP-0802-variant-1",
    "siteRoleCount": 4,
    "publishedIngress": {
      "hostSurface": "loopback-only",
      "port": 8080,
      "publishedPortCount": 1
    },
    "policy": {
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false,
      "releaseVerifierCommand": "npm run verify:release"
    },
    "artifactHash": "sha256:9511aba7bf894cc097aeea76d1a85658431c8360636c474e678023696b4a682e"
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "wordpress-plugin-updater-runs-update-hooks-on-live-topology",
      "pre-update-and-post-update-plugin-version-hashes-distinct",
      "post-update-version-and-plugin-owned-schema-marker-hash-readback",
      "upgrader-process-complete-hook-evidence-hash-only",
      "source-local-remote-changed-route-receipts",
      "verify-release-docker-local-production-passes-without-packaged-fallback",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "candidate-does-not-execute-live-plugin-update-hooks",
      "candidate-does-not-prove-post-update-plugin-owned-side-effects",
      "candidate-does-not-produce-release-verifier-accepted-site-startup-proof"
    ],
    "readyWhen": "topology-command-starts-sites-and-plugin-update-hook-proof-is-production-backed"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawHookValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "topologyCommand",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "b8736fa0dfc7a4a33d812dbb7cb93c271483efe6fbbfa1b2d0bc71cd9de7a499",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0816-plugin-update-hooks-topology-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test test/rpp-0816-plugin-update-hooks-topology-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "npm run verify:release:docker-local-production",
        "result": "exit-2-with-exact-unavailable-capability"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0816-plugin-update-hooks-topology-v1.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check",
        "result": "exit-0"
      }
    ],
    "topologyCommandExpectedOutcome": "site-startup-proof-or-exact-unavailable-capability",
    "topologyCommandObservedOutcome": {
      "exitCode": 2,
      "capabilityCode": "DOCKER_CLI_MISSING",
      "finalMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
    },
    "evidenceRedactionScan": {
      "ok": true,
      "rejectedFiles": 0
    }
  }
}
```

## Candidate Scope

The candidate records the plugin update hook surfaces that a release-ready
topology must exercise: updater transient setup, pre-install and post-install
upgrader callbacks, update completion, version readback, and plugin-owned schema
marker readback. This file records those surfaces only as names and counts.

The topology command path is also checked at the artifact level. In this
sandbox it did not start sites because the Docker CLI is unavailable. The
result is accepted only as fail-closed support evidence because the exact
unavailable capability is recorded and release movement remains blocked.

## Release-Ready Scope

Release-ready plugin update hook evidence still requires the Docker WordPress
topology to start, the plugin update to execute through WordPress updater
machinery, hook execution to be proven by hash-only before/after readbacks, and
the release verifier to pass without packaged fallback.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only topology prerequisite evidence. Do not mark plugin
update hooks topology release-ready until the topology command starts the sites
and the live plugin update hook proof passes.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0816-plugin-update-hooks-topology-v1.test.js
node --test test/rpp-0816-plugin-update-hooks-topology-v1.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0816-plugin-update-hooks-topology-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0816-plugin-update-hooks-topology-v1.test.js`: exit 0
- `node --test test/rpp-0816-plugin-update-hooks-topology-v1.test.js`: 3 subtests passed, 0 failed
- `npm run verify:release:docker-local-production`: exit 2 with `DOCKER_CLI_MISSING` and final fail-closed marker
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
