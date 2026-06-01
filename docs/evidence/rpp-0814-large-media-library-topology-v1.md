# RPP-0814 Large Media Library Topology Variant 1

Date: 2026-06-01

## Scope

RPP-0814 records the large media library topology requirements and the exact
topology-command capability unavailable in this sandbox. This is support-only
evidence. It does not run real WordPress import/export, does not start Docker
WordPress sites here, and does not move release readiness.

The success target for release-ready evidence is that plugin-driver evidence
and graph evidence survive a real WordPress import followed by export. This
variant records the contract and current gap while keeping release status
`NO-GO`.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0814",
  "variant": 1,
  "title": "Large media library topology candidate scope",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "builtOn": {
    "mediaBenchmark": {
      "rppId": "RPP-0715",
      "proofScope": "large-media-library-benchmark",
      "mediaDriver": "benchmark-media-library-file",
      "fastPathLane": "large-media-library-fast-path",
      "storageBoundary": "filesystem-fsync-evidence",
      "databaseSurfaces": [
        "wp_posts:attachment",
        "wp_postmeta:attachment-metadata"
      ],
      "productionBacked": false,
      "releaseEligible": false
    },
    "topologyCommand": {
      "command": "npm run verify:release:docker-local-production",
      "topologyVariant": "RPP-0802-variant-1",
      "publishedIngressPort": 8080,
      "publishedIngressHost": "loopback-only",
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false
    },
    "importExportContract": {
      "sourcePattern": "RPP-0804-real-wordpress-import-export-survival-contract",
      "requiresRealWordPressImportExport": true,
      "requiresPluginAndGraphSurvival": true
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
    "status": "large-media-library-topology-candidate",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-support-large-media-benchmark-plus-docker-topology-prerequisite",
    "mediaTopologyShape": {
      "mediaSurface": "large-media-library",
      "importExportRuntimeRequired": "real-wordpress-import-export",
      "mediaDriver": "benchmark-media-library-file",
      "fastPathLane": "large-media-library-fast-path",
      "storageBoundary": "filesystem-fsync-evidence",
      "attachmentRows": [
        "wp_posts:attachment"
      ],
      "attachmentMetadataRows": [
        "wp_postmeta:attachment-metadata"
      ],
      "requiredGraphSurfaces": [
        "featured-image-attachment",
        "attachment-postmeta-round-trip",
        "post-parent-page-closure",
        "comment-parent-commentmeta"
      ],
      "requiredPluginEvidence": {
        "driver": "reprint-push-release-state",
        "owner": "reprint-push",
        "resourceKind": "plugin-driver-row",
        "importSurvivalRequired": true,
        "exportSurvivalRequired": true,
        "livePreconditionHashRequired": true
      },
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
      },
      "realImportExportObserved": false,
      "pluginEvidenceSurvivedImportExport": false,
      "graphEvidenceSurvivedImportExport": false,
      "rawMediaValuesIncluded": false
    },
    "candidateClaims": [
      "large-media-topology-requirements-recorded",
      "rpp-0715-benchmark-support-linked",
      "real-import-export-survival-contract-defined",
      "topology-command-fail-closed-capability-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "real-wordpress-large-media-import-export-run",
      "docker-wordpress-sites-started",
      "plugin-driver-evidence-import-export-readback",
      "featured-image-attachment-graph-import-export-readback",
      "attachment-metadata-graph-import-export-readback",
      "source-local-remote-changed-route-receipts",
      "release-verifier-accepted-large-media-topology-proof"
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
      "missingExecutable": true,
      "requiredFor": [
        "docker-wordpress-large-media-topology-start",
        "real-wordpress-media-import-export",
        "plugin-evidence-import-export-readback",
        "graph-evidence-import-export-readback"
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
      "remoteTunnelsAllowed": false,
      "packagedFallbackAllowed": false,
      "releaseVerifierCommand": "npm run verify:release",
      "onlySandbox8080Ingress": true
    },
    "artifactHash": "sha256:2bb25f262de339e14766b2f84263fd8bbccf24f1cbb1f12989822fd342992dca"
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "runtime": null,
    "importObserved": false,
    "exportObserved": false,
    "pluginEvidenceSurvivalObserved": false,
    "graphEvidenceSurvivalObserved": false,
    "blockedReasonCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactUnavailableCapability": "DOCKER_CLI_MISSING"
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "real-wordpress-large-media-import-observed",
      "wordpress-export-after-large-media-import-observed",
      "plugin-driver-evidence-survives-import-and-export",
      "featured-image-attachment-graph-survives-import-and-export",
      "attachment-metadata-graph-survives-import-and-export",
      "large-media-storage-and-row-hashes-survive-import-export",
      "auth-session-and-durable-journal-accepted-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "no-real-wordpress-large-media-import-export-artifact",
      "candidate-does-not-prove-plugin-evidence-survival",
      "candidate-does-not-prove-graph-evidence-survival",
      "candidate-does-not-produce-release-verifier-accepted-site-startup-proof"
    ],
    "readyWhen": "topology-command-starts-sites-and-real-wordpress-large-media-import-export-proof-is-production-backed"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawMediaValuesIncluded": false,
    "rawGraphValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "topologyCommand",
      "productionImportExportEvidence",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "62b86fe44fd82dd58d0a0f3088da3a8b7c043f16bdd84d4cd5345188620d6683",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0814-large-media-library-topology-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0814 test/rpp-0814-large-media-library-topology-v1.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0814-large-media-library-topology-v1.md",
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

The candidate links the RPP-0715 large media benchmark surfaces to the
production topology requirement. It records attachment rows, attachment
metadata rows, the media fast-path lane, required plugin-driver survival, and
the required graph surfaces as names and counts only.

No real WordPress import/export was observed in this sandbox. The topology
command is represented only by an exact unavailable-capability record, so the
candidate remains support-only and fail-closed.

## Release-Ready Scope

Release-ready RPP-0814 evidence still requires the Docker WordPress topology or
an equivalent complete external WordPress topology to start, import the large
media library into real WordPress, export after import, and prove by hash-only
readbacks that plugin-driver evidence and graph evidence survived both
directions. The release verifier must accept the run without packaged fallback.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only topology prerequisite evidence. Do not mark the
large media library topology release-ready until the real WordPress
import/export proof exists and is production-backed.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0814-large-media-library-topology-v1.test.js
node --test --test-name-pattern RPP-0814 test/rpp-0814-large-media-library-topology-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0814-large-media-library-topology-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0814-large-media-library-topology-v1.test.js`: exit 0
- `node --test --test-name-pattern RPP-0814 test/rpp-0814-large-media-library-topology-v1.test.js`: exit 0
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean
