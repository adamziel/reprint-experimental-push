# RPP-0876 Plugin Update Hooks Topology Variant 4

Date: 2026-06-01

## Scope

RPP-0876 records focused regression coverage for plugin update hook topology
variant 4. Success for this slice is bounded to the topology command contract:
the command must either start the Docker WordPress sites or record the exact
unavailable capability that prevented startup.

This sandbox did not start Docker WordPress sites because the Docker CLI is
unavailable. The evidence is accepted only as support-only fail-closed evidence:
it records the exact unavailable capability, keeps packaged fallback disabled,
and leaves release posture at NO-GO.

This variant keeps the evidence hash/count/surface-only. It records hook names,
counts, command names, capability codes, local ingress policy, and stable
hashes. It does not record raw hook payloads, site payloads, route bodies,
credential material, or remote tunnel output.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0876",
  "variant": 4,
  "title": "Plugin update hooks topology prerequisite",
  "coverageMode": "focused-regression-local-support-only",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "topologyCommand": {
      "command": "npm run verify:release:docker-local-production",
      "successCriterion": "sites-started-or-exact-unavailable-capability-recorded",
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
    "status": "plugin-update-hooks-topology-candidate-v4",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-support-topology-requirement-record",
    "variantLineage": {
      "precedentRppIds": [
        "RPP-0816",
        "RPP-0836",
        "RPP-0856"
      ],
      "previousVariants": [
        1,
        2,
        3
      ],
      "unavailableCapabilityPattern": true,
      "deterministicLocalSupportOnly": true,
      "focusedRegressionVariant": true
    },
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
      "hookSurfaceDetails": [
        {
          "surface": "updater-transient",
          "wordpressSurface": "pre_set_site_transient_update_plugins",
          "requiredProof": "update-offer-injected-before-upgrader-run",
          "releaseReadyStatus": "required-not-observed"
        },
        {
          "surface": "pre-install",
          "wordpressSurface": "upgrader_pre_install",
          "requiredProof": "pre-install-callback-observed-through-wordpress-upgrader",
          "releaseReadyStatus": "required-not-observed"
        },
        {
          "surface": "post-install",
          "wordpressSurface": "upgrader_post_install",
          "requiredProof": "post-install-callback-observed-through-wordpress-upgrader",
          "releaseReadyStatus": "required-not-observed"
        },
        {
          "surface": "process-complete",
          "wordpressSurface": "upgrader_process_complete",
          "requiredProof": "plugin-update-completion-callback-observed",
          "releaseReadyStatus": "required-not-observed"
        },
        {
          "surface": "version-readback",
          "wordpressSurface": "plugin-version-option-readback",
          "requiredProof": "pre-update-and-post-update-version-hashes-distinct",
          "releaseReadyStatus": "required-not-observed"
        },
        {
          "surface": "schema-marker-readback",
          "wordpressSurface": "plugin-owned-schema-marker-readback",
          "requiredProof": "post-update-plugin-owned-schema-marker-hash-readback",
          "releaseReadyStatus": "required-not-observed"
        }
      ],
      "candidateHookCount": 6,
      "rawHookPayloadsIncluded": false
    },
    "candidateClaims": [
      "plugin-update-hook-surface-inventory-recorded",
      "topology-command-startup-or-exact-capability-recorded",
      "docker-topology-policy-surface-recorded",
      "variant-4-startup-or-exact-capability-contract-recorded",
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
    "successCriterion": "sites-started-or-exact-unavailable-capability-recorded",
    "status": "blocked",
    "siteStartupStatus": "not-started",
    "sitesStarted": false,
    "failClosed": true,
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "exitCode": 2,
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "probeCommand": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "docker-wordpress-topology-sites-started",
        "wordpress-plugin-updater-runtime",
        "plugin-update-hook-surface-readback",
        "variant-4-focused-regression-proof"
      ]
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
      "sandboxIngressPort": 8080,
      "onlySandbox8080Ingress": true,
      "remoteTunnelsAllowed": false,
      "tunnelCommandCount": 0,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false,
      "releaseUrlsUseDockerDns": true,
      "releaseVerifierCommand": "npm run verify:release"
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]",
    "artifactHash": "sha256:4f60402585ef951e70a56272c09553ade0102e0d228a74af48d75d6ce8af2973"
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
      "no-packaged-fallback-observed-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "candidate-does-not-execute-live-plugin-update-hooks",
      "candidate-does-not-prove-post-update-plugin-owned-side-effects",
      "candidate-does-not-produce-release-verifier-accepted-site-startup-proof"
    ],
    "liveUpdateHookReleaseGate": {
      "status": "not-satisfied",
      "candidateOnlyReleaseMovement": "blocked",
      "packagedFallbackCanSatisfyLiveHookProof": false,
      "releaseMovementBlockedUntil": [
        "docker-wordpress-topology-sites-started",
        "live-plugin-update-hooks-executed-through-wordpress-upgrader",
        "post-update-hook-side-effects-hash-readback",
        "verify-release-docker-local-production-passes-without-packaged-fallback"
      ]
    },
    "readyWhen": "topology-command-starts-sites-and-plugin-update-hook-proof-is-production-backed"
  },
  "invariants": {
    "topologyCommandStartedSitesOrExactCapabilityRecorded": true,
    "sitesNotStartedHaveExactUnavailableCapability": true,
    "dockerCliMissingRecordedExactly": true,
    "updaterTransientSurfaceRecorded": true,
    "preInstallSurfaceRecorded": true,
    "postInstallSurfaceRecorded": true,
    "processCompleteSurfaceRecorded": true,
    "versionReadbackSurfaceRecorded": true,
    "schemaMarkerReadbackSurfaceRecorded": true,
    "packagedFallbackDisabled": true,
    "onlySandbox8080Ingress": true,
    "noTunnelUsage": true,
    "releaseRemainsNoGo": true
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
      "invariants",
      "finalReleaseStatus",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "df1e10c50ae9cc4b2360d42c07994d64cbb1e49fd9c5aaabb350044be85f5861",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0876-plugin-update-hooks-topology-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0876 test/rpp-0876-plugin-update-hooks-topology-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "npm run verify:release:docker-local-production",
        "result": "exit-2-with-exact-unavailable-capability"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0876-plugin-update-hooks-topology-v4.md",
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
      "acceptedForReleaseGate": false,
      "failClosed": true,
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
upgrader callbacks, update completion, version readback, and plugin-owned
schema marker readback. This file records those surfaces only as names, counts,
booleans, and hashes.

The topology command is also checked at the artifact level. In this sandbox it
did not start sites because the Docker CLI is unavailable. The result is
accepted only as fail-closed support evidence because the exact unavailable
capability is recorded and release movement remains blocked.

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
node --check test/rpp-0876-plugin-update-hooks-topology-v4.test.js
node --test --test-name-pattern RPP-0876 test/rpp-0876-plugin-update-hooks-topology-v4.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0876-plugin-update-hooks-topology-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0876-plugin-update-hooks-topology-v4.test.js`: exit 0
- `node --test --test-name-pattern RPP-0876 test/rpp-0876-plugin-update-hooks-topology-v4.test.js`: 6 subtests passed, 0 failed
- `npm run verify:release:docker-local-production`: exit 2 with `DOCKER_CLI_MISSING`, `acceptedForReleaseGate: false`, and `failClosed: true`
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
