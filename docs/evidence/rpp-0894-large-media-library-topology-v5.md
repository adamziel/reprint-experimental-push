# RPP-0894 Large Media Library Topology Variant 5

Date: 2026-06-01
Lane: RPP-0894 large media library topology release-verifier carry-through, variant 5
Checklist item: RPP-0894 - Carry through the release verifier for large media
library topology, variant 5.
Success text: plugin and graph evidence survive real WordPress import/export.
Final release posture: `NO-GO`

## Scope

This slice adds support-only release-verifier carry-through evidence for the
large media library topology gate. It builds on the RPP-0874 large-media
variant 4 contract and applies the variant 5 production-topology posture from
the adjacent topology evidence: exact unavailable capabilities, same-artifact
component bindings, packaged-only rejection, release-verifier carry-through,
hash/count/surface-only reporting, and no release movement.

This is not production-backed release evidence. The worker did not start
Docker, contact live WordPress sites, start servers, use tunnel tooling,
publish progress, edit release gates, or modify shared runtime code. The final
release posture and integration recommendation remain `NO-GO`.

The positive branch in the focused test is a deterministic contract fixture.
A release-ready artifact must still prove that large media rows and files, the
plugin-driver evidence, the required graph evidence, production-topology route
evidence, and release-verifier evidence all survived the same real WordPress
import/export run.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0894",
  "proofId": "rpp-0894-large-media-library-topology-v5",
  "variant": 5,
  "title": "Large media library topology variant 5 release verifier support report",
  "coverageMode": "release-verifier-carry-through-local-support-only",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "sourcePattern": {
    "largeMediaTopologyPrecedent": {
      "rppId": "RPP-0874",
      "variant": 4,
      "evidenceFile": "docs/evidence/rpp-0874-large-media-library-topology-v4.md",
      "testFile": "test/rpp-0874-large-media-library-topology-v4.test.js",
      "supportOnly": true
    },
    "variant5ProductionTopologyPatterns": [
      "RPP-0881-three-site-local-production-topology-v5",
      "RPP-0882-docker-wordpress-topology-v5",
      "RPP-0883-external-wordpress-topology-v5",
      "RPP-0896-plugin-update-hooks-topology-v5"
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
    "regressionId": "RPP-0894-same-artifact-large-media-plugin-graph-release-verifier-survival",
    "variant": 5,
    "topologyClass": "far-production-topology",
    "supportOnlyUntilRealImportExportArtifact": true,
    "releaseVerifierCarryThroughRequired": true,
    "sameArtifactBindingHashRequired": true,
    "componentBindingHashesRequired": true,
    "rejectsSplitSurvivalEvidence": true,
    "deterministicAssertions": [
      "real-wordpress-import-export-runtime-only",
      "large-media-import-and-export-observed",
      "attachment-and-metadata-counts-preserved",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "production-topology-route-hashes-present",
      "release-verifier-carries-same-artifact-hash",
      "packaged-only-evidence-rejected",
      "same-artifact-component-bindings-match",
      "hash-count-surface-only-evidence"
    ]
  },
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0894-large-media-library-topology-v5.md",
      "test/rpp-0894-large-media-library-topology-v5.test.js"
    ],
    "progressSurfacesModified": false,
    "sharedTopologyModified": false,
    "releaseVerifierModified": false,
    "packageMetadataModified": false,
    "sharedScriptsModified": false,
    "unrelatedTestsModified": false,
    "networkListenersStarted": false,
    "remoteTunnelsAllowed": false,
    "sandboxIngressPort": 8080
  },
  "artifactIdentity": {
    "fixtureId": "rpp-0894-v5-deterministic-same-artifact-contract",
    "fixtureRuntime": "real-wordpress-import-export",
    "fixtureArtifactHash": "adca136b5bee678a6425138a473c1ed86c2552ae4ccff03131c02efd85bc6878",
    "fixtureArtifactBindingHash": "fbb7c9bd67b798d8b532469403c4414088379ba3933c1b168414a8842cc5da4e",
    "realArtifactProvidedInSandbox": false,
    "rawArtifactValuesStored": false,
    "bindingCovers": [
      "large-media-import-export",
      "attachment-and-metadata-counts",
      "plugin-driver-row",
      "required-graph-edges",
      "production-topology-route-hashes",
      "release-verifier-carry-through"
    ]
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
        "release-verifier-large-media-topology-v5-carry-through",
        "large-media-library-topology-v5-production-backed-proof"
      ]
    },
    "externalWordPressTopologyComplete": false,
    "externalTopologyUnavailableCapability": {
      "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
      "capability": "complete-external-wordpress-topology-v5-with-auth",
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
        "release-verifier-large-media-topology-v5-carry-through",
        "large-media-library-topology-v5-production-backed-proof"
      ]
    },
    "realImportExportArtifactPresent": false,
    "realImportExportUnavailableCapability": {
      "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
      "capability": "large-media-library-real-wordpress-import-export-survival-artifact-v5",
      "artifactProvided": false,
      "requiredFor": [
        "large-media-attachment-and-metadata-survival",
        "plugin-evidence-import-export-survival",
        "graph-evidence-import-export-survival",
        "release-verifier-same-artifact-review"
      ]
    },
    "primaryBlockerCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactMissingCapabilities": [
      "docker runtime or complete external WordPress topology v5",
      "real WordPress large media import/export survival artifact",
      "same-artifact media plugin graph topology and release-verifier binding"
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
          "release-verifier-large-media-topology-v5-carry-through",
          "large-media-library-topology-v5-production-backed-proof"
        ]
      },
      {
        "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
        "capability": "complete-external-wordpress-topology-v5-with-auth",
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
          "release-verifier-large-media-topology-v5-carry-through",
          "large-media-library-topology-v5-production-backed-proof"
        ]
      },
      {
        "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
        "capability": "large-media-library-real-wordpress-import-export-survival-artifact-v5",
        "artifactProvided": false,
        "requiredFor": [
          "large-media-attachment-and-metadata-survival",
          "plugin-evidence-import-export-survival",
          "graph-evidence-import-export-survival",
          "release-verifier-same-artifact-review"
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
      "large-media-fast-path-lane",
      "wordpress-export-attachment-manifest"
    ],
    "snapshotHashesRequired": [
      "importedSnapshotHash",
      "exportedSnapshotHash",
      "uploadsManifestHash",
      "mediaLibrarySurfaceHash"
    ],
    "requiredPluginEvidence": {
      "driver": "reprint-push-release-state",
      "owner": "reprint-push",
      "resourceKind": "plugin-driver-row",
      "resourceKeyHash": "cbffd8b18c1d2fb93fd358c9909d31067d1e7ce94bf639f7d0ca0bb337b63535",
      "importSurvivalRequired": true,
      "exportSurvivalRequired": true,
      "livePreconditionHashRequired": true,
      "artifactBindingRequired": true
    },
    "requiredGraphEvidence": [
      "featured-image-attachment",
      "attachment-postmeta-round-trip",
      "post-parent-page-closure",
      "comment-parent-commentmeta"
    ],
    "requiredProductionTopologyEvidence": {
      "topologyClass": "far-production-topology",
      "topologyVariant": "external-wordpress-topology-v5",
      "realImportExportTopologyRequired": true,
      "importRouteHashRequired": true,
      "exportRouteHashRequired": true,
      "liveRouteReceiptHashRequired": true,
      "sameArtifactBindingHashRequired": true,
      "releaseVerifierArtifactHashRequired": true,
      "noPackagedFallbackRequired": true
    },
    "requiredReleaseVerifierEvidence": {
      "command": "npm run verify:release",
      "topologyCommand": "npm run verify:release:docker-local-production",
      "carriedThroughByTopologyCommand": true,
      "releaseCommandIsVerifyRelease": true,
      "topologyValidationOk": true,
      "acceptedSameArtifact": true,
      "noPackagedFallback": true,
      "artifactBindingRequired": true
    },
    "artifactBindingHashRequired": true,
    "componentBindingHashesRequired": true,
    "actualProductionBackedArtifactRequiredForGo": true
  },
  "releaseVerifierCarryThrough": {
    "command": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "status": "support-only-contract-fixture",
    "packagedFallbackAllowed": false,
    "packagedFallbackObserved": false,
    "releaseMovementAllowed": false,
    "requiredGuarantees": [
      "same-artifact-binding-hash-present-on-release-verifier-evidence",
      "release-verifier-report-hash-present",
      "topology-validation-ok",
      "no-packaged-fallback-observed",
      "release-status-remains-no-go-until-production-artifact-exists"
    ]
  },
  "candidateScope": {
    "status": "large-media-library-topology-candidate-v5",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "rpp-0874-large-media-plus-variant-5-release-verifier-patterns",
    "mediaRequirements": {
      "surfaceCount": 5,
      "requiredMediaSurfaces": [
        "wp_posts:attachment",
        "wp_postmeta:attachment-metadata",
        "uploads-file-hash-manifest",
        "large-media-fast-path-lane",
        "wordpress-export-attachment-manifest"
      ],
      "surfaceDigest": "sha256:17ed9a4d31f85717fcc70f860b02ab603a43b6f4d2a8b95d92eb0944e687570a",
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
      "external-wordpress-topology-v5-live-route-readback-required",
      "large-media-attachment-and-metadata-hash-count-readback",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "release-verifier-carry-through-required",
      "same-artifact-component-bindings-required",
      "packaged-only-evidence-rejected",
      "artifact-stays-hash-count-surface-only"
    ],
    "candidateClaims": [
      "rpp-0874-large-media-contract-carried-forward",
      "variant-5-production-topology-pattern-linked",
      "variant-5-release-verifier-carry-through-recorded",
      "same-artifact-component-binding-regression-recorded",
      "exact-unavailable-capabilities-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-large-media-import-export",
      "plugin-evidence-import-survival-proof",
      "plugin-evidence-export-survival-proof",
      "graph-evidence-import-survival-proof",
      "graph-evidence-export-survival-proof",
      "external-wordpress-topology-v5-live-route-receipts",
      "same-artifact-release-verifier-accepted-production-proof",
      "final-release-go-decision"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-large-media-import-export",
      "external-wordpress-topology-v5-live-source-local-remote-changed-readback",
      "external-wordpress-topology-v5-live-route-receipts",
      "large-media-attachment-and-metadata-hash-count-readback",
      "uploads-manifest-hash-readback-after-export",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "all-required-graph-evidence-survives-real-wordpress-import-export",
      "same-artifact-large-media-plugin-graph-topology-release-verifier-binding",
      "release-verifier-accepted-large-media-topology-v5-proof",
      "verify-release-passes-without-packaged-fallback-on-production-topology",
      "artifact-redaction-scan-passes-for-release-report"
    ],
    "blockers": [
      "docker-cli-unavailable-in-this-sandbox",
      "external-wordpress-topology-v5-not-configured",
      "no-real-large-media-import-export-survival-artifact",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "candidate-does-not-prove-same-artifact-release-verifier-binding",
      "candidate-does-not-support-final-release-go"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-release-verifier-acceptance"
  },
  "failClosed": {
    "missingEvidenceReleasePosture": "NO-GO",
    "missingDockerOrLiveTopologyReleasePosture": "NO-GO",
    "playgroundSubstituteAccepted": false,
    "packagedOnlyEvidenceAccepted": false,
    "partialMediaSurvivalAccepted": false,
    "partialPluginSurvivalAccepted": false,
    "partialGraphSurvivalAccepted": false,
    "splitSurvivalArtifactAccepted": false,
    "productionTopologyWithoutRouteHashesAccepted": false,
    "releaseVerifierWithoutArtifactBindingAccepted": false,
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
    "rawArtifactValuesIncluded": false,
    "tunnelOutputIncluded": false,
    "scopeHashCovers": [
      "sourcePattern",
      "focusedRegression",
      "artifactIdentity",
      "currentSandboxObservation",
      "contractRequirements",
      "releaseVerifierCarryThrough",
      "candidateScope",
      "releaseReadyScope",
      "failClosed",
      "finalReleaseStatus",
      "integrationRecommendation",
      "successTarget"
    ]
  },
  "scopeHash": "e4da8b71b45a5c89ad08ed1b0862e51a6073760bb55337fdeea35b5904920a6c",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0894-large-media-library-topology-v5.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0894 test/rpp-0894-large-media-library-topology-v5.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0894-large-media-library-topology-v5.md",
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

## Fixture And Verifier Contract

The local deterministic fixture is
`rpp-0894-v5-deterministic-same-artifact-contract`. Its artifact hash and
binding hash are stored in the JSON report. The fixture is not a claim that
this sandbox produced a live import/export artifact; it is the evaluator's
positive contract branch.

Expected verifier guarantees:

- runtime must be `real-wordpress-import-export`;
- import and export-after-import must both be observed;
- large media rows, metadata rows, uploads manifest, and media-library surface
  evidence must be hash/count/surface-only;
- plugin-driver evidence must survive both import and export;
- all required graph edges must survive both import and export;
- topology route hashes and release-verifier evidence must carry the same
  artifact binding; and
- packaged-only evidence, split bindings, missing media/plugin/graph proof, and
  non-surviving import/export evidence must fail closed.

## Redaction Posture

Evidence is hash/count/surface-only. The report stores no raw URLs, hostnames,
credential material, raw media values, plugin values, graph values, tunnel
output, route bodies, or payload dumps.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0894-large-media-library-topology-v5.test.js
node --test --test-name-pattern RPP-0894 test/rpp-0894-large-media-library-topology-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0894-large-media-library-topology-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0894-large-media-library-topology-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0894 test/rpp-0894-large-media-library-topology-v5.test.js`: exit 0
- evidence redaction scan: `ok: true`, 0 rejected files
- diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record this as support-only release-verifier carry-through evidence. Do not
mark the large media library topology release-ready until a production-backed
real WordPress import/export artifact proves same-artifact media, plugin,
graph, topology, and release-verifier survival and the release verifier accepts
it without packaged fallback.
