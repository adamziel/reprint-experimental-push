# RPP-0874 Large Media Library Topology Variant 4

Date: 2026-06-01
Lane: RPP-0874 large media library topology, variant 4
Checklist item: RPP-0874 - Add focused regression coverage for large media
library topology, variant 4.
Success text: plugin and graph evidence survive real WordPress import/export.
Final release posture: `NO-GO`

## Scope

This slice adds support-only focused regression evidence for the large media
library topology gate. It carries forward the RPP-0854 large media survival
contract and applies the variant-4 production-topology pattern used by the
adjacent topology evidence: exact unavailable capabilities, same-artifact
binding, hash/count/surface-only reporting, and no release movement.

This is not production-backed release evidence. The worker did not start
Docker, did not contact live WordPress sites, did not start servers, did not
use tunnel tooling, did not publish progress, and did not edit release gates.
The final release posture and integration recommendation remain `NO-GO`.

The positive branch in the focused test is a deterministic contract fixture. A
real release-ready artifact must still prove that large media rows and files,
the plugin-driver evidence, the required graph evidence, and the production
topology route evidence all survived the same real WordPress import/export run.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0874",
  "variant": 4,
  "title": "Large media library topology variant 4 focused regression support report",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "sourcePattern": {
    "largeMediaTopologyPrecedent": {
      "rppId": "RPP-0854",
      "variant": 3,
      "evidenceFile": "docs/evidence/rpp-0854-large-media-library-topology-v3.md",
      "testFile": "test/rpp-0854-large-media-library-topology-v3.test.js",
      "supportOnly": true
    },
    "variant4ProductionTopologyPatterns": [
      "RPP-0861-three-site-local-production-topology-v4",
      "RPP-0863-external-wordpress-topology-v4",
      "RPP-0864-brewcommerce-blueprint-import-v4",
      "RPP-0876-plugin-update-hooks-topology-v4"
    ],
    "mediaBenchmark": {
      "rppId": "RPP-0715",
      "profile": "large-site",
      "mediaDriver": "benchmark-media-library-file",
      "fastPathLane": "large-media-library-fast-path",
      "storageBoundary": "filesystem-fsync-evidence"
    },
    "contractInherited": true
  },
  "focusedRegression": {
    "regressionId": "RPP-0874-same-artifact-large-media-plugin-graph-survival",
    "variant": 4,
    "topologyClass": "far-production-topology",
    "supportOnlyUntilRealImportExportArtifact": true,
    "sameArtifactBindingHashRequired": true,
    "rejectsSplitSurvivalEvidence": true,
    "deterministicAssertions": [
      "real-wordpress-import-export-runtime-only",
      "large-media-import-and-export-observed",
      "attachment-and-metadata-counts-preserved",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "production-topology-route-hashes-present",
      "same-artifact-binding-hash-matches",
      "hash-count-surface-only-evidence"
    ]
  },
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0874-large-media-library-topology-v4.md",
      "test/rpp-0874-large-media-library-topology-v4.test.js"
    ],
    "progressSurfacesModified": false,
    "sharedTopologyModified": false,
    "releaseVerifierModified": false,
    "packageMetadataModified": false,
    "sharedScriptsModified": false,
    "networkListenersStarted": false,
    "remoteTunnelsAllowed": false,
    "sandboxIngressPort": 8080
  },
  "currentSandboxObservation": {
    "observedAt": "2026-06-01T00:00:00.000Z",
    "dockerCliUsable": false,
    "dockerUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "command": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "large-media-real-wordpress-import",
        "wordpress-export-after-large-media-import",
        "plugin-and-graph-survival-readback",
        "large-media-library-topology-v4-production-backed-proof"
      ]
    },
    "externalWordPressTopologyComplete": false,
    "externalTopologyUnavailableCapability": {
      "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
      "capability": "complete-external-wordpress-topology-v4-with-auth",
      "configurationPresent": false,
      "missingInputs": [
        "REPRINT_PUSH_SOURCE_URL",
        "REPRINT_PUSH_LOCAL_URL",
        "REPRINT_PUSH_REMOTE_CHANGED_URL",
        "REPRINT_PUSH_USERNAME",
        "REPRINT_PUSH_APPLICATION_PASSWORD"
      ],
      "valuesIncluded": false,
      "requiredFor": [
        "large-media-real-wordpress-import",
        "wordpress-export-after-large-media-import",
        "plugin-and-graph-survival-readback",
        "large-media-library-topology-v4-production-backed-proof"
      ]
    },
    "realImportExportArtifactPresent": false,
    "realImportExportUnavailableCapability": {
      "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
      "capability": "large-media-library-real-wordpress-import-export-survival-artifact",
      "artifactProvided": false,
      "requiredFor": [
        "large-media-attachment-and-metadata-survival",
        "plugin-evidence-import-export-survival",
        "graph-evidence-import-export-survival",
        "same-artifact-release-verifier-review"
      ]
    },
    "primaryBlockerCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactMissingCapabilities": [
      "docker runtime or complete external WordPress topology v4",
      "real WordPress large media import/export survival artifact",
      "same-artifact plugin graph and topology survival binding"
    ],
    "exactUnavailableCapabilities": [
      {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "missingExecutable": true,
        "requiredFor": [
          "large-media-real-wordpress-import",
          "wordpress-export-after-large-media-import",
          "plugin-and-graph-survival-readback",
          "large-media-library-topology-v4-production-backed-proof"
        ]
      },
      {
        "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
        "capability": "complete-external-wordpress-topology-v4-with-auth",
        "configurationPresent": false,
        "missingInputs": [
          "REPRINT_PUSH_SOURCE_URL",
          "REPRINT_PUSH_LOCAL_URL",
          "REPRINT_PUSH_REMOTE_CHANGED_URL",
          "REPRINT_PUSH_USERNAME",
          "REPRINT_PUSH_APPLICATION_PASSWORD"
        ],
        "valuesIncluded": false,
        "requiredFor": [
          "large-media-real-wordpress-import",
          "wordpress-export-after-large-media-import",
          "plugin-and-graph-survival-readback",
          "large-media-library-topology-v4-production-backed-proof"
        ]
      },
      {
        "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
        "capability": "large-media-library-real-wordpress-import-export-survival-artifact",
        "artifactProvided": false,
        "requiredFor": [
          "large-media-attachment-and-metadata-survival",
          "plugin-evidence-import-export-survival",
          "graph-evidence-import-export-survival",
          "same-artifact-release-verifier-review"
        ]
      }
    ]
  },
  "contractRequirements": {
    "runtime": "real-wordpress-import-export",
    "realWordPressRequired": true,
    "productionBackedRequired": true,
    "importObservedRequired": true,
    "exportObservedRequired": true,
    "minimumAttachmentRowsObserved": 144,
    "minimumAttachmentMetadataRowsObserved": 576,
    "requiredMediaSurfaces": [
      "wp_posts:attachment",
      "wp_postmeta:attachment-metadata",
      "uploads-file-hash-manifest",
      "large-media-fast-path-lane"
    ],
    "snapshotHashesRequired": [
      "importedSnapshotHash",
      "exportedSnapshotHash",
      "uploadsManifestHash"
    ],
    "requiredPluginEvidence": {
      "driver": "reprint-push-release-state",
      "owner": "reprint-push",
      "resourceKind": "plugin-driver-row",
      "resourceKeyHash": "4774a6fe96a0a8357d1e880ada666decc1457ec0385dc32a0244cfa7390158cf",
      "importSurvivalRequired": true,
      "exportSurvivalRequired": true,
      "livePreconditionHashRequired": true
    },
    "requiredGraphEvidence": [
      "featured-image-attachment",
      "attachment-postmeta-round-trip",
      "post-parent-page-closure",
      "comment-parent-commentmeta"
    ],
    "requiredProductionTopologyEvidence": {
      "topologyClass": "far-production-topology",
      "topologyVariant": "external-wordpress-topology-v4",
      "realImportExportTopologyRequired": true,
      "importRouteHashRequired": true,
      "exportRouteHashRequired": true,
      "liveRouteReceiptHashRequired": true,
      "sameArtifactBindingHashRequired": true
    },
    "artifactBindingHashRequired": true,
    "actualProductionBackedArtifactRequiredForGo": true
  },
  "candidateScope": {
    "status": "large-media-library-topology-candidate-v4",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0854-large-media-plus-variant-4-production-topology-patterns",
    "mediaRequirements": {
      "surfaceCount": 4,
      "requiredMediaSurfaces": [
        "wp_posts:attachment",
        "wp_postmeta:attachment-metadata",
        "uploads-file-hash-manifest",
        "large-media-fast-path-lane"
      ],
      "surfaceDigest": "sha256:e0aa301a4853fccf5b48f05f8d7bca9a4736405b6148f319ae34734073bd2fcf",
      "minimumAttachmentRowsObserved": 144,
      "minimumAttachmentMetadataRowsObserved": 576
    },
    "graphRequirements": {
      "graphTypeCount": 4,
      "requiredGraphTypes": [
        "featured-image-attachment",
        "attachment-postmeta-round-trip",
        "post-parent-page-closure",
        "comment-parent-commentmeta"
      ],
      "graphDigest": "sha256:3d0a3961e51ca3c12511bd2df090d83e42710e8f05f6b8d7cc964c18df896890"
    },
    "acceptanceRules": [
      "real-wordpress-import-export-runtime-only",
      "production-backed-artifact-required",
      "external-wordpress-topology-v4-live-route-readback-required",
      "large-media-attachment-and-metadata-hash-count-readback",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "same-artifact-binding-required",
      "artifact-stays-hash-count-surface-only"
    ],
    "candidateClaims": [
      "rpp-0854-large-media-contract-carried-forward",
      "variant-4-production-topology-pattern-linked",
      "variant-4-same-artifact-regression-recorded",
      "exact-unavailable-capabilities-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-large-media-import-export",
      "plugin-evidence-import-survival-proof",
      "plugin-evidence-export-survival-proof",
      "graph-evidence-import-survival-proof",
      "graph-evidence-export-survival-proof",
      "external-wordpress-topology-v4-live-route-receipts",
      "same-artifact-release-verifier-accepted-proof",
      "final-release-go-decision"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-large-media-import-export",
      "external-wordpress-topology-v4-live-source-local-remote-changed-readback",
      "external-wordpress-topology-v4-live-route-receipts",
      "large-media-attachment-and-metadata-hash-count-readback",
      "uploads-manifest-hash-readback-after-export",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "all-required-graph-evidence-survives-real-wordpress-import-export",
      "same-artifact-large-media-plugin-graph-topology-binding",
      "release-verifier-accepted-large-media-topology-v4-proof",
      "artifact-redaction-scan-passes-for-release-report"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "external-wordpress-topology-v4-not-configured",
      "no-real-large-media-import-export-survival-artifact",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "candidate-does-not-prove-same-artifact-binding",
      "candidate-does-not-support-final-release-go"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-release-verifier-acceptance"
  },
  "failClosed": {
    "missingEvidenceReleasePosture": "NO-GO",
    "missingDockerOrLiveTopologyReleasePosture": "NO-GO",
    "playgroundSubstituteAccepted": false,
    "partialPluginSurvivalAccepted": false,
    "partialGraphSurvivalAccepted": false,
    "splitSurvivalArtifactAccepted": false,
    "productionTopologyWithoutRouteHashesAccepted": false,
    "topologyClaimWithoutBindingAccepted": false,
    "releaseMovementAllowed": false
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
    "scopeHashCovers": [
      "sourcePattern",
      "focusedRegression",
      "currentSandboxObservation",
      "contractRequirements",
      "candidateScope",
      "releaseReadyScope",
      "finalReleaseStatus",
      "integrationRecommendation",
      "successTarget"
    ]
  },
  "scopeHash": "4fa57bd9627f1b7fec87b612c26e025f0debe9e5a37326d1d94abf8e0f6fe65c",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0874-large-media-library-topology-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0874 test/rpp-0874-large-media-library-topology-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0874-large-media-library-topology-v4.md",
        "result": "exit-0"
      },
      {
        "command": "git diff --check",
        "result": "exit-0"
      }
    ],
    "evidenceRedactionScan": {
      "ok": true,
      "rejectedFiles": 0
    },
    "releasePostureAfterValidation": "NO-GO"
  }
}
```

## Candidate Scope

The candidate covers deterministic support evidence only. It records the large
media surfaces, plugin-driver survival requirement, graph survival requirement,
variant-4 production-topology route requirement, and same-artifact binding
requirement. The evidence stores only names, counts, booleans, failure codes,
and hashes.

The candidate does not prove a production WordPress import/export run, does
not prove the plugin-driver row survived live import/export, does not prove the
required graph edges survived live import/export, and does not bind live route
readbacks to the same survival artifact.

## Release-Ready Scope

Release-ready movement still requires a production-backed WordPress large media
import/export artifact accepted by the release verifier. The artifact must
prove, by hash/count/surface-only readbacks, that media rows and files, plugin
evidence, graph evidence, and production-topology route evidence survived the
same import/export run.

Until that artifact exists, this slice stays `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0874-large-media-library-topology-v4.test.js
node --test --test-name-pattern RPP-0874 test/rpp-0874-large-media-library-topology-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0874-large-media-library-topology-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0874-large-media-library-topology-v4.test.js`: exit 0
- `node --test --test-name-pattern RPP-0874 test/rpp-0874-large-media-library-topology-v4.test.js`: exit 0; file-level TAP pass for the focused RPP-0874 test file
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only focused regression evidence. Do not mark the large
media library topology release-ready until a production-backed real WordPress
import/export artifact proves same-artifact media, plugin, graph, and topology
survival and the release verifier accepts it.
