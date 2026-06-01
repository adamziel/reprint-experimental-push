# RPP-0864 BrewCommerce blueprint import variant 4 evidence

Date: 2026-06-01
Lane: RPP-0864 BrewCommerce blueprint import, variant 4
Checklist item: RPP-0864 - Implement BrewCommerce blueprint import, variant 4.
Success text: plugin and graph evidence survive real WordPress import/export.
Final release posture: `NO-GO`

## Scope

This slice adds support-only evidence for the BrewCommerce blueprint import
gate. It carries forward the RPP-0804 and RPP-0824 import/export contract,
uses RPP-0844 variant 3 as the closest template, and adds a focused variant 4
regression lock for far production-topology evidence. The slice records exact
unavailable capabilities for the missing Docker or live WordPress topology and
does not modify shared topology code, release verifier code, progress
surfaces, package metadata, shared scripts, or network exposure.

The proof boundary remains strict:

- release-ready evidence requires runtime `real-wordpress-import-export`;
- BrewCommerce blueprint import and a WordPress export after import must both
  be observed;
- imported and exported snapshots must be represented by SHA-256 hashes;
- the `reprint-push-release-state` plugin-driver row must survive both import
  and export with a live precondition hash;
- featured-image, taxonomy, post-parent, and comment graph evidence must
  survive both import and export with hash-only round-trip evidence;
- far production-topology evidence must include import and export route hashes;
- the import/export, plugin, graph, and production-topology evidence must be
  bound by one same-artifact hash;
- Docker or a complete external WordPress topology must be available before
  production-backed import/export proof can be claimed; and
- local Playground, placeholder assets, partial survival artifacts, and
  split survival artifacts remain rejected as release-ready substitutes.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0864",
  "variant": 4,
  "title": "BrewCommerce blueprint import support report",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "sourcePattern": {
    "importExportContracts": [
      {
        "rppId": "RPP-0804",
        "variant": 1,
        "evidenceFile": "docs/evidence/rpp-0804-brewcommerce-blueprint-import-v1.md",
        "testFile": "test/rpp-0804-brewcommerce-blueprint-import-v1.test.js"
      },
      {
        "rppId": "RPP-0824",
        "variant": 2,
        "evidenceFile": "docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md",
        "testFile": "test/rpp-0824-brewcommerce-blueprint-import-v2.test.js"
      },
      {
        "rppId": "RPP-0844",
        "variant": 3,
        "evidenceFile": "docs/evidence/rpp-0844-brewcommerce-blueprint-import-v3.md",
        "testFile": "test/rpp-0844-brewcommerce-blueprint-import-v3.test.js"
      }
    ],
    "productionTopologyPattern": {
      "evidenceFiles": [
        "docs/evidence/rpp-0861-three-site-local-production-topology-v4.md",
        "docs/evidence/rpp-0863-external-wordpress-topology-v4.md",
        "docs/evidence/rpp-0881-three-site-local-production-topology-v5.md"
      ],
      "exactUnavailableCapabilityRequired": true,
      "routeHashEvidenceRequired": true
    },
    "closestTemplate": {
      "rppId": "RPP-0844",
      "variant": 3,
      "evidenceFile": "docs/evidence/rpp-0844-brewcommerce-blueprint-import-v3.md",
      "testFile": "test/rpp-0844-brewcommerce-blueprint-import-v3.test.js"
    },
    "contractInherited": true
  },
  "focusedRegression": {
    "regressionId": "RPP-0864-same-artifact-plugin-graph-survival",
    "variant": 4,
    "topologyClass": "far-production-topology",
    "supportOnlyUntilRealImportExportArtifact": true,
    "sameArtifactBindingHashRequired": true,
    "rejectsSplitSurvivalEvidence": true,
    "deterministicAssertions": [
      "real-runtime-only",
      "blueprint-import-and-export-observed",
      "plugin-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "production-topology-route-hashes-present",
      "same-artifact-binding-hash-matches",
      "placeholder-assets-fail-closed"
    ]
  },
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0864-brewcommerce-blueprint-import-v4.md",
      "test/rpp-0864-brewcommerce-blueprint-import-v4.test.js"
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
    "brewcommerceFixtureDir": "/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce",
    "blueprintAssets": {
      "blueprint.json": {
        "present": true,
        "size": 319,
        "nonEmpty": true
      },
      "content.xml": {
        "present": true,
        "size": 0,
        "nonEmpty": false
      },
      "database.sql": {
        "present": true,
        "size": 0,
        "nonEmpty": false
      },
      "ensure-media.php": {
        "present": true,
        "size": 6,
        "nonEmpty": true
      },
      "theme.zip": {
        "present": true,
        "size": 151,
        "nonEmpty": true
      },
      "uploads.zip": {
        "present": true,
        "size": 151,
        "nonEmpty": true
      }
    },
    "missingOrPlaceholderAssets": [
      "content.xml:size=0",
      "database.sql:size=0"
    ],
    "dockerCliUsable": false,
    "dockerUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "command": "docker --version",
      "missingExecutable": true,
      "requiredFor": [
        "brewcommerce-real-wordpress-import",
        "wordpress-export-after-import",
        "plugin-and-graph-survival-readback",
        "brewcommerce-blueprint-import-v4-production-backed-proof"
      ]
    },
    "externalWordPressTopologyComplete": false,
    "externalTopologyUnavailableCapability": {
      "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
      "capability": "complete-external-wordpress-topology",
      "configurationPresent": false,
      "requiredFor": [
        "brewcommerce-real-wordpress-import",
        "wordpress-export-after-import",
        "plugin-and-graph-survival-readback",
        "brewcommerce-blueprint-import-v4-production-backed-proof"
      ]
    },
    "realImportExportArtifactPresent": false,
    "primaryBlockerCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactMissingCapabilities": [
      "docker runtime or complete external WordPress topology",
      "non-placeholder BrewCommerce import assets",
      "real WordPress import/export survival artifact"
    ],
    "exactUnavailableCapabilities": [
      {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "missingExecutable": true,
        "requiredFor": [
          "brewcommerce-real-wordpress-import",
          "wordpress-export-after-import",
          "plugin-and-graph-survival-readback",
          "brewcommerce-blueprint-import-v4-production-backed-proof"
        ]
      },
      {
        "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
        "capability": "complete-external-wordpress-topology",
        "configurationPresent": false,
        "requiredFor": [
          "brewcommerce-real-wordpress-import",
          "wordpress-export-after-import",
          "plugin-and-graph-survival-readback",
          "brewcommerce-blueprint-import-v4-production-backed-proof"
        ]
      }
    ]
  },
  "contractRequirements": {
    "runtime": "real-wordpress-import-export",
    "realWordPressRequired": true,
    "brewcommerceImportObservedRequired": true,
    "wordpressExportAfterImportRequired": true,
    "snapshotHashesRequired": [
      "importedSnapshotHash",
      "exportedSnapshotHash"
    ],
    "requiredPluginEvidence": {
      "driver": "reprint-push-release-state",
      "owner": "reprint-push",
      "resourceKind": "plugin-driver-row",
      "resourceKey": "row:[\"wp_reprint_push_release_state\",\"state_id:1\"]",
      "importSurvivalRequired": true,
      "exportSurvivalRequired": true,
      "livePreconditionHashRequired": true
    },
    "requiredGraphEvidence": [
      "featured-image-attachment",
      "category-term-relationship-termmeta",
      "post-parent-page-closure",
      "comment-parent-commentmeta"
    ],
    "artifactBindingHashRequired": true,
    "requiredProductionTopologyEvidence": {
      "topologyClass": "far-production-topology",
      "realImportExportTopologyRequired": true,
      "importRouteHashRequired": true,
      "exportRouteHashRequired": true,
      "sameArtifactBindingHashRequired": true
    },
    "actualProductionBackedArtifactRequiredForGo": true
  },
  "failClosed": {
    "missingEvidenceReleasePosture": "NO-GO",
    "missingDockerOrLiveTopologyReleasePosture": "NO-GO",
    "playgroundSubstituteAccepted": false,
    "partialPluginSurvivalAccepted": false,
    "partialGraphSurvivalAccepted": false,
    "placeholderBlueprintAssetsAccepted": false,
    "splitSurvivalArtifactAccepted": false,
    "productionTopologyWithoutRouteHashesAccepted": false,
    "topologyClaimWithoutBindingAccepted": false,
    "productionBackedClaimWithoutArtifactAccepted": false,
    "releaseMovementAllowed": false
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawPayloadValuesIncluded": false,
    "rawGraphValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "tunnelOutputIncluded": false,
    "largeRawPayloadsIncluded": false,
    "scopeHashCovers": [
      "sourcePattern",
      "writeScope",
      "currentSandboxObservation",
      "contractRequirements",
      "failClosed",
      "focusedRegression",
      "integrationRecommendation"
    ]
  },
  "scopeHash": "994a56174a4b7160c7052465fe7bc098e278781e1d380af84dc399f34eb1e3f3",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0864-brewcommerce-blueprint-import-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0864 test/rpp-0864-brewcommerce-blueprint-import-v4.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0864-brewcommerce-blueprint-import-v4.md",
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
    }
  }
}
```

## Current Sandbox Observation

The BrewCommerce fixture directory exists at
`/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce`. The current asset
surface is insufficient for a real import/export survival claim because
`content.xml` and `database.sql` are zero-byte placeholders.

Docker is unavailable in this sandbox. The exact unavailable capability is:

```json
{
  "code": "DOCKER_CLI_MISSING",
  "capability": "docker-cli",
  "command": "docker --version",
  "missingExecutable": true,
  "requiredFor": [
    "brewcommerce-real-wordpress-import",
    "wordpress-export-after-import",
    "plugin-and-graph-survival-readback",
    "brewcommerce-blueprint-import-v4-production-backed-proof"
  ]
}
```

No complete external WordPress topology or real import/export survival artifact
was provided. The exact missing capabilities are:

```text
docker runtime or complete external WordPress topology
non-placeholder BrewCommerce import assets
real WordPress import/export survival artifact
```

The proof remains local-only and records the sandbox constraint that only the
provided `8080` ingress may be exposed. Remote tunnel tooling and tunnel output
are excluded. This is not a production-backed proof.

## Focused Test Behavior

`test/rpp-0864-brewcommerce-blueprint-import-v4.test.js` covers five paths:

- the JSON support report preserves support-only `NO-GO` release posture,
  scoped-file expectations, exact unavailable-capability details, and the
  RPP-0844 template lineage;
- the current missing-capability path fails closed with
  `REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING` as the primary blocker;
- the deterministic contract branch accepts only real WordPress import/export
  artifacts where plugin and graph evidence survive both import and export,
  far production-topology route hashes are present, and the same-artifact
  binding hash matches;
- a split-survival artifact with valid-looking booleans but mismatched binding
  hashes remains rejected; and
- redaction and scope checks reject raw URL, credential, tunnel, large raw
  payload, and production-backed-without-artifact evidence.

The positive branch is a deterministic contract fixture, not a claim that this
sandbox produced real WordPress import/export evidence.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0864-brewcommerce-blueprint-import-v4.test.js
node --test --test-name-pattern RPP-0864 test/rpp-0864-brewcommerce-blueprint-import-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0864-brewcommerce-blueprint-import-v4.md
git diff --check
```

Observed local result after implementation: all commands exited 0. The focused
Node test passed, the evidence redaction scan reported `ok: true`, and the
diff whitespace check passed.

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

Integrate as support-only RPP-0864 evidence. Keep final release blocked until a
Docker or complete external WordPress run supplies production-backed
import/export survival evidence that satisfies the plugin, graph,
production-topology route-hash, and same-artifact binding checks.
