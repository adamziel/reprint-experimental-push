# RPP-0834 Large Media Library Topology Variant 2

Date: 2026-06-01

## Scope

RPP-0834 records support-only variant 2 evidence for the large media library
topology. It carries forward the RPP-0814 large-media candidate contract and
links it to the RPP-0823 external WordPress topology variant 2 identity
surface.

This worker did not start Docker, did not contact a live WordPress topology,
did not start servers, did not use remote tunnel tooling, and did not modify
release gates or progress surfaces. The proof remains fail-closed. Final
release status and integration recommendation remain `NO-GO`.

The success target remains: plugin and graph evidence survive real WordPress
import/export.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0834",
  "variant": 2,
  "title": "Large media library topology variant 2 support scope",
  "status": "blocked-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "builtOn": {
    "largeMediaTopologyVariant1": {
      "rppId": "RPP-0814",
      "variant": 1,
      "supportOnly": true,
      "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export"
    },
    "mediaBenchmark": {
      "rppId": "RPP-0715",
      "proofScope": "large-media-library-benchmark",
      "mediaDriver": "benchmark-media-library-file",
      "fastPathLane": "large-media-library-fast-path",
      "storageBoundary": "filesystem-fsync-evidence",
      "productionBacked": false
    },
    "externalTopologyVariant2": {
      "rppId": "RPP-0823",
      "variant": 2,
      "sourceLocalChangedUrlCapture": true,
      "roleIdentityHashOnly": true,
      "routeSourceIdentityChecks": [
        "preflight",
        "dryRun",
        "apply",
        "journal",
        "recovery"
      ],
      "networkProbePerformed": false
    },
    "dockerTopology": {
      "rppId": "RPP-0802",
      "variant": 1,
      "dockerTopologyVariant": "RPP-0802-variant-1",
      "command": "npm run verify:release:docker-local-production",
      "publishedIngressPort": 8080,
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    },
    "importExportSurvivalContract": {
      "rppId": "RPP-0804",
      "variant": 1,
      "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export"
    }
  },
  "supportReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "variantFocus": "large-media-real-wordpress-import-export-survival-contract",
    "candidateLabel": "support-candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "currentObservation": {
    "observedAt": "2026-06-01T00:00:00.000Z",
    "dockerCliUsable": false,
    "externalWordPressStaticIdentityProofAvailable": true,
    "externalWordPressLiveTopologyComplete": false,
    "realImportExportArtifactPresent": false,
    "primaryBlockerCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactUnavailableCapabilities": [
      {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "missingExecutable": true,
        "requiredFor": [
          "docker-wordpress-large-media-topology-start",
          "real-wordpress-large-media-import-export",
          "plugin-evidence-import-export-readback",
          "graph-evidence-import-export-readback"
        ]
      },
      {
        "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
        "capability": "complete-external-wordpress-topology-with-auth",
        "missingInputs": [
          "REPRINT_PUSH_SOURCE_URL",
          "REPRINT_PUSH_LOCAL_URL",
          "REPRINT_PUSH_REMOTE_CHANGED_URL",
          "REPRINT_PUSH_USERNAME",
          "REPRINT_PUSH_APPLICATION_PASSWORD"
        ],
        "valuesIncluded": false,
        "requiredFor": [
          "authenticated-source-local-remote-changed-route-checks",
          "real-wordpress-large-media-import-export",
          "production-backed-survival-artifact"
        ]
      },
      {
        "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
        "capability": "large-media-library-import-export-survival-artifact",
        "artifactProvided": false,
        "requiredFor": [
          "plugin-evidence-survives-import-export",
          "graph-evidence-survives-import-export",
          "release-verifier-review"
        ]
      }
    ],
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
        "capability": "docker-cli",
        "command": "docker --version",
        "missingExecutable": true,
        "requiredFor": [
          "docker-wordpress-large-media-topology-start",
          "real-wordpress-large-media-import-export",
          "plugin-evidence-import-export-readback",
          "graph-evidence-import-export-readback"
        ]
      },
      "runtime": "docker-local-wordpress",
      "topologyVariant": "RPP-0802-variant-1",
      "publishedIngress": {
        "hostSurface": "loopback-only",
        "port": 8080,
        "publishedPortCount": 1
      },
      "policy": {
        "remoteTunnelsAllowed": false,
        "packagedFallbackAllowed": false,
        "onlySandbox8080Ingress": true
      },
      "artifactHash": "sha256:8df82f1bd5a2315a07522bca994e14233d746e6abecb48a1e4ea8eb2c620133b"
    }
  },
  "candidateScope": {
    "status": "large-media-library-topology-v2-support-candidate",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0814-large-media-plus-rpp-0823-external-topology-v2-static-identity",
    "mediaTopologyShape": {
      "mediaSurface": "large-media-library",
      "topologyVariant": "external-wordpress-topology-v2",
      "sourceLocalChangedRoleIdentitiesCaptured": true,
      "roleIdentityHashesOnly": true,
      "roleIdentityHashes": {
        "source": "1218f86f7110f3b2f564f3d12b6e779cd88b60b9ba5d43044fef1deb2bbbe8ee",
        "localEdited": "7a063d7c8b98df778074a3a929e4198be07d5917b682a54470f2814d0e52ca2b",
        "remoteChanged": "c47bad6200f6e389e298e73ce6d6849702d86ca5b9fc9baa3272951437037bda"
      },
      "roleIdentitiesDistinct": true,
      "sourceAliasAndRouteSourceIdentitiesMatch": true,
      "routeSourceIdentityCheckCount": 5,
      "identitySurfaceCount": 9,
      "identitySurfaceNames": [
        "required-role-urls-present",
        "required-role-urls-valid",
        "source-local-changed-url-identities-distinct",
        "remote-source-alias-matches-source",
        "route-source-identities-match-source",
        "no-forbidden-tunnel-hosts",
        "no-url-userinfo-query-or-fragment",
        "loopback-limited-to-sandbox-8080",
        "packaged-fallback-disabled"
      ],
      "externalTopologyV2ScopeHash": "sha256:d656edf7a88a2d25092a17dae126c0f1df6af9270fbc2120057f089944ce7301",
      "networkProbePerformed": false,
      "sandboxIngressPort": 8080,
      "remoteTunnelsAllowed": false,
      "importExportObserved": false,
      "mediaDriver": "benchmark-media-library-file",
      "fastPathLane": "large-media-library-fast-path",
      "storageBoundary": "filesystem-fsync-evidence",
      "attachmentRows": [
        "wp_posts:attachment"
      ],
      "attachmentMetadataRows": [
        "wp_postmeta:attachment-metadata"
      ],
      "requiredMediaSurfaces": [
        "wp_posts:attachment",
        "wp_postmeta:attachment-metadata",
        "uploads-file-hash-manifest",
        "large-media-fast-path-lane"
      ],
      "benchmarkSupport": {
        "sourceRppId": "RPP-0715",
        "profile": "large-site",
        "mediaWritesAttempted": 144,
        "appliedMediaWrites": 132,
        "fastPathLaneUpdates": 128,
        "attachmentRowsPreconditioned": 144,
        "metadataRowsPreconditioned": 576,
        "rowPreconditionsRetained": 720,
        "databaseBatches": 3,
        "maxRowsInAnyBatch": 500
      }
    },
    "importExportSurvivalSurface": {
      "runtimeRequired": "real-wordpress-import-export",
      "productionBackedRequired": true,
      "largeMediaRequired": true,
      "importObservedRequired": true,
      "exportAfterImportObservedRequired": true,
      "artifactFormat": "hash-count-surface-only",
      "pluginDriver": "reprint-push-release-state",
      "pluginOwner": "reprint-push",
      "pluginResourceKeyHash": "f744024d42ee9792eb7f843ed934a5a98a3f6577e3301d710b2e5884ec7450c0",
      "requiredPluginSurvival": [
        "survived-import",
        "survived-export",
        "live-precondition-hash"
      ],
      "requiredGraphTypes": [
        "featured-image-attachment",
        "attachment-postmeta-round-trip",
        "post-parent-page-closure",
        "comment-parent-commentmeta"
      ],
      "requiredGraphSurvival": [
        "survived-import",
        "survived-export",
        "round-trip-hash"
      ]
    },
    "acceptanceRules": [
      "real-wordpress-import-export-runtime-only",
      "production-backed-artifact-required",
      "external-topology-v2-role-identities-hash-only",
      "large-media-attachment-and-metadata-surfaces-hash-count-checked",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "artifact-stays-hash-count-surface-only"
    ],
    "candidateClaims": [
      "variant-2-large-media-survival-contract-recorded",
      "rpp-0814-candidate-scope-carried-forward",
      "rpp-0823-external-topology-v2-identity-surface-linked",
      "rpp-0715-large-media-benchmark-support-linked",
      "exact-unavailable-capability-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-large-media-import-export",
      "plugin-evidence-import-survival-proof",
      "plugin-evidence-export-survival-proof",
      "graph-evidence-import-survival-proof",
      "graph-evidence-export-survival-proof",
      "live-wordpress-route-receipts",
      "source-local-remote-changed-authenticated-readback",
      "final-release-go-decision"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-large-media-import-export",
      "external-wordpress-topology-v2-live-source-local-remote-changed-readback",
      "large-media-attachment-and-metadata-hash-count-readback",
      "wordpress-export-after-large-media-import-observed",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "featured-image-attachment-attachment-metadata-post-parent-comment-graph-evidence-survives-real-wordpress-import-export",
      "variant-2-survival-contract-accepted-by-release-verifier",
      "auth-lifecycle-and-durable-journal-accepted-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-missing",
      "external-wordpress-live-topology-not-configured",
      "no-real-large-media-import-export-survival-artifact",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "candidate-does-not-support-final-release-go"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-release-verifier-acceptance"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawHostValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "rawMediaValuesIncluded": false,
    "pluginRawValuesIncluded": false,
    "graphRawValuesIncluded": false,
    "tunnelOutputIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "currentObservation",
      "releaseReadyScope",
      "integrationRecommendation",
      "successTarget"
    ]
  },
  "scopeComparisonHash": "0ccf7c90dc5a9ecba80d86814d93cd951c834eb3e5f51a3a1097d0b7a84d485a",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0834-large-media-library-topology-v2.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0834 test/rpp-0834-large-media-library-topology-v2.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0834-large-media-library-topology-v2.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check origin/lane/evidence-integration-20260527...HEAD",
        "result": "exit-0"
      }
    ],
    "evidenceRedactionScan": {
      "ok": true,
      "rejectedFiles": 0
    }
  }
}
```

## Candidate Scope

The candidate records a large-media support contract only. It names the
attachment, attachment metadata, file-hash manifest, fast-path lane, plugin
driver, and graph surfaces that must survive real WordPress import/export. It
also records the variant 2 source, local edited, and remote changed topology
identity surface as hashes only.

No production-backed import/export artifact exists in this worktree for this
slice. Docker is unavailable, and the external topology is not configured with
live authenticated WordPress endpoints. Those missing capabilities are exact
blockers, so the support proof fails closed.

## Release-Ready Scope

Release-ready RPP-0834 evidence still requires a production-bound WordPress
large media import/export run accepted by the release verifier. The artifact
must prove by hash/count/surface-only readbacks that the variant 2 topology,
large media rows and files, plugin-driver evidence, and required graph
evidence survived both import and export.

Until that artifact exists, this slice must stay `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0834-large-media-library-topology-v2.test.js
node --test --test-name-pattern RPP-0834 test/rpp-0834-large-media-library-topology-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0834-large-media-library-topology-v2.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local result after implementation: all required commands exited 0.
