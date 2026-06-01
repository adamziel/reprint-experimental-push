# RPP-0824 BrewCommerce blueprint import variant 2 evidence

Date: 2026-06-01
Lane: RPP-0824 BrewCommerce blueprint import, variant 2
Checklist item: RPP-0824 - Implement BrewCommerce blueprint import, variant 2.
Success text: plugin and graph evidence survive real WordPress import/export.
Final release posture: `NO-GO`

## Scope

This slice adds support-only evidence for the BrewCommerce blueprint import
gate. It follows the RPP-0804 variant 1 contract, adds a variant 2 support
report, and does not modify shared topology code, release verifier code,
progress surfaces, or network exposure.

The proof boundary remains strict:

- release-ready evidence requires runtime `real-wordpress-import-export`;
- BrewCommerce blueprint import and a WordPress export after import must both
  be observed;
- imported and exported snapshots must be represented by SHA-256 hashes;
- the `reprint-push-release-state` plugin-driver row must survive both import
  and export with a live precondition hash;
- featured-image, taxonomy, post-parent, and comment graph evidence must
  survive both import and export with hash-only round-trip evidence;
- local Playground, placeholder assets, and partial survival artifacts remain
  rejected as release-ready substitutes.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0824",
  "variant": 2,
  "title": "BrewCommerce blueprint import support report",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export",
  "sourcePattern": {
    "rppId": "RPP-0804",
    "variant": 1,
    "evidenceFile": "docs/evidence/rpp-0804-brewcommerce-blueprint-import-v1.md",
    "testFile": "test/rpp-0804-brewcommerce-blueprint-import-v1.test.js",
    "contractInherited": true
  },
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md",
      "test/rpp-0824-brewcommerce-blueprint-import-v2.test.js"
    ],
    "progressSurfacesModified": false,
    "sharedTopologyModified": false,
    "releaseVerifierModified": false,
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
    "externalWordPressTopologyComplete": false,
    "realImportExportArtifactPresent": false,
    "primaryBlockerCode": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
    "exactMissingCapabilities": [
      "docker runtime or complete external WordPress topology",
      "non-placeholder BrewCommerce import assets",
      "real WordPress import/export survival artifact"
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
    ]
  },
  "failClosed": {
    "missingEvidenceReleasePosture": "NO-GO",
    "playgroundSubstituteAccepted": false,
    "partialPluginSurvivalAccepted": false,
    "partialGraphSurvivalAccepted": false,
    "placeholderBlueprintAssetsAccepted": false,
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
      "integrationRecommendation"
    ]
  },
  "scopeHash": "342dbbbd9fe5bf8695c34e703309636e7d5ffb9fdf95a98dc475fe5e59fe73a5",
  "validation": {
    "commands": [
      {
        "command": "node --check test/rpp-0824-brewcommerce-blueprint-import-v2.test.js",
        "result": "exit-0"
      },
      {
        "command": "node --test --test-name-pattern RPP-0824 test/rpp-0824-brewcommerce-blueprint-import-v2.test.js",
        "result": "exit-0"
      },
      {
        "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md",
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

Docker is not available in this sandbox, and no complete external WordPress
topology or real import/export survival artifact was provided. The exact
missing capabilities are:

```text
docker runtime or complete external WordPress topology
non-placeholder BrewCommerce import assets
real WordPress import/export survival artifact
```

The proof remains local-only and records the sandbox constraint that only the
provided `8080` ingress may be exposed. Remote tunnel tooling and tunnel output
are excluded.

## Focused Test Behavior

`test/rpp-0824-brewcommerce-blueprint-import-v2.test.js` covers four paths:

- the JSON support report preserves support-only `NO-GO` release posture and
  scoped-file expectations;
- the current missing-capability path fails closed with
  `REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING` as the primary blocker;
- the deterministic contract branch accepts only real WordPress import/export
  artifacts where plugin and graph evidence survive both import and export;
- redaction and scope checks reject raw URL, credential, tunnel, and large raw
  payload evidence.

The positive branch is a deterministic contract fixture, not a claim that this
sandbox produced real WordPress import/export evidence.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0824-brewcommerce-blueprint-import-v2.test.js
node --test --test-name-pattern RPP-0824 test/rpp-0824-brewcommerce-blueprint-import-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0824-brewcommerce-blueprint-import-v2.md
git diff --check
```

Observed local result after implementation: all commands exited 0. The focused
Node test passed, the evidence redaction scan reported `ok: true`, and the
whitespace check passed.

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

Integrate as support-only RPP-0824 evidence. Keep final release blocked until a
Docker or complete external WordPress run supplies production-backed
import/export survival evidence that satisfies the plugin and graph checks.
