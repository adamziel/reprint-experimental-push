# RPP-0848 classic theme files v3 evidence

Date: 2026-06-01
Lane: RPP-0848 classic theme files, variant 3
Checklist item: RPP-0848 - Prove classic theme files, variant 3.

## Scope

This slice adds deterministic local support evidence for a classic WordPress
theme file scope. It follows the RPP-0828 generated coverage pattern for
source, local edited, and remote changed URL identity handling, then records
the stylesheet, functions, template, and asset surfaces as hash/count/surface
evidence only.

The proof remains support-only. It does not contact WordPress hosts, open
sockets, run live import/export, collect route receipts, capture credentials,
or move release gates. Final release status and integration recommendation
remain **NO-GO**.

## Proof Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0848",
  "variant": 3,
  "title": "Classic theme files v3 support scope",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "topologyContract": {
      "rppId": "RPP-0803",
      "variant": "RPP-0803-variant-1",
      "sourceLocalChangedUrlCapture": true,
      "staticIdentityChecks": true,
      "tunnelAndSecretUrlRejection": true
    },
    "urlIdentityPattern": {
      "rppId": "RPP-0808",
      "variant": 1,
      "roleIdentities": [
        "source",
        "local-edited",
        "remote-changed"
      ],
      "identityHashOnly": true,
      "sameSourceAcrossRoutesRequired": true
    },
    "classicThemePattern": {
      "rppId": "RPP-0808",
      "variant": 1,
      "fileScopeContract": "classic-theme-style-functions-template-asset-scope"
    },
    "generatedCoveragePattern": {
      "rppId": "RPP-0828",
      "variant": 2,
      "urlIdentityPattern": "classic-theme-source-local-changed-role-identities",
      "fileScopeContract": "classic-theme-style-functions-template-asset-scope",
      "hashCountSurfaceOnlyEvidence": true
    }
  },
  "urlIdentityScope": {
    "sourceLocalChangedRoleUrlsCaptured": true,
    "roleSurfaces": [
      "source",
      "local-edited",
      "remote-changed"
    ],
    "capturedRoleUrlCount": 3,
    "validRoleUrlCount": 3,
    "identityHashCount": 3,
    "roleIdentityHashes": {
      "source": "361c70f5c8ab70edf54e1b6bd89f8251e7a5d333efae207895671f1d8f4be6bf",
      "localEdited": "d91d8f29f46de007628c4512890d1b204caf8d3ee1a4d4a837d5443564090bcb",
      "remoteChanged": "ca9605cbc44032163083ebab37e0c2085433e44da05b2690a879cb9173905bb9"
    },
    "roleIdentitiesDistinct": true,
    "sourceAliasMatchesSource": true,
    "sameSourceAcrossRoutes": true,
    "identityChecked": true,
    "noTunnelPolicyEnforced": true,
    "noSecretShapedUrlParts": true,
    "packagedFallbackDisabled": true,
    "networkProbePerformed": false,
    "rawUrlValuesIncluded": false,
    "releaseMovement": "none"
  },
  "classicThemeScope": {
    "status": "support-only-classic-theme-file-scope",
    "themeType": "classic",
    "scopeRoot": "wp-content/themes/rpp-0848-classic-v3",
    "surfaceNames": [
      "stylesheet",
      "functions",
      "template",
      "asset"
    ],
    "totalScopedFileCount": 10,
    "requiredFileCount": 2,
    "roleScopedFileCounts": {
      "source": 9,
      "localEdited": 10,
      "remoteChanged": 9
    },
    "surfaceCounts": {
      "stylesheet": 1,
      "functions": 1,
      "template": 5,
      "asset": 3
    },
    "fileScopeHash": "sha256:affbd4e6bd2f5e3c7b8975c11138e0b3f45f4209a8650d1475c7b37ba37a013f",
    "stylesheetHeaderFieldCount": 3,
    "stylesheetHeaderHashCount": 3,
    "activeThemeOptionRowCount": 2,
    "activeThemeOptionRowsHashCount": 3,
    "surfaceHashes": [
      {
        "surface": "stylesheet",
        "fileCount": 1,
        "requiredFileCount": 1,
        "sourceHash": "sha256:bfa0719fef6ae4b7a8c04aa070af63ac7e505542ff8d533bd73eea6e489059a2",
        "localHash": "sha256:a8aa5620080b5b4f133178db70dedf96214dceb9f526c1072fb4319f8a1b58c5",
        "remoteChangedHash": "sha256:1be914c7af308487a9c12ba5aa4efb1f09978b2865a260637279383dbf91f3fe"
      },
      {
        "surface": "functions",
        "fileCount": 1,
        "requiredFileCount": 0,
        "sourceHash": "sha256:cf151941251865144ac93fecf3e399baa8e776169f1f236ac5e8d5bab49c66ce",
        "localHash": "sha256:f2225f77282afb24b4f358f6bad1f94a8fdd237bfd3bfdc1fe9f0dd995f8c301",
        "remoteChangedHash": "sha256:cf151941251865144ac93fecf3e399baa8e776169f1f236ac5e8d5bab49c66ce"
      },
      {
        "surface": "template",
        "fileCount": 5,
        "requiredFileCount": 1,
        "sourceHash": "sha256:e2d3675bfa50c3cdca05bdc122f5ee14a2be1ef7618157a0b93384c58225e922",
        "localHash": "sha256:b7cefb428334f7d5e9d5375b5377181f4d4824287f05a7b452abd954dc7e2183",
        "remoteChangedHash": "sha256:e2d3675bfa50c3cdca05bdc122f5ee14a2be1ef7618157a0b93384c58225e922"
      },
      {
        "surface": "asset",
        "fileCount": 3,
        "requiredFileCount": 0,
        "sourceHash": "sha256:619600dc93e1444d8994cd7ad6f379cf2b15881c804401a737d1bae061837163",
        "localHash": "sha256:43ed9f06dace6ea04102103f9a31dc6db33232b3291b4dbe1decc6e1db4f8c57",
        "remoteChangedHash": "sha256:619600dc93e1444d8994cd7ad6f379cf2b15881c804401a737d1bae061837163"
      }
    ],
    "localChangedFileCount": 5,
    "remoteChangedFileCount": 1,
    "requiredClassicThemeFilesPresent": true,
    "rawFileContentsIncluded": false
  },
  "plannerScope": {
    "readyPlanStatus": "ready",
    "readyThemeMutationCount": 5,
    "readyThemePreconditionCount": 5,
    "readyPlanHash": "sha256:2d38dcecdc8d18f59cd6351e17cfc8813dadbef7995194a5bf49f89e3ae62ce8",
    "remoteChangedPlanStatus": "conflict",
    "remoteChangedThemeConflictCount": 1,
    "remoteChangedPlanHash": "sha256:3ef03577b10305c52d9e4b53c2255e99a4f2152d01a0760159c93364c73f1e9c",
    "remoteChangedThemeDriftFailsClosed": true,
    "everyThemeMutationHasLiveRemotePrecondition": true
  },
  "negativeControls": {
    "tunnelUrlRejected": true,
    "secretShapedUrlRejected": true,
    "packagedFallbackRejected": true,
    "classicThemeScopeAcceptedAfterRejectedTopology": false,
    "rawRejectedInputsStored": false
  },
  "releaseScope": {
    "finalReleaseStatus": "NO-GO",
    "releaseGateMovement": "none",
    "readyForReleaseMovement": false,
    "blockers": [
      "support-only-local-url-identity-proof",
      "support-only-classic-theme-file-scope-proof",
      "no-production-backed-wordpress-reachability",
      "no-route-receipts-or-live-mutation-receipts"
    ]
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawUrlValuesIncluded": false,
    "rawHostValuesIncluded": false,
    "rawFileContentsIncluded": false,
    "credentialMaterialIncluded": false,
    "routeSourceRawValuesIncluded": false
  },
  "scopeEvidenceHash": "d9ad3c7dac99cc6c1bc372d08d0d03401aef443f04225bab1d3cdc63f327802d"
}
```

## Variant 3 Checks

The focused test asserts:

- source, local edited, and remote changed role URL surfaces are captured;
- role URL identities are distinct and stored as identity hashes only;
- source aliases and per-route source identities match the source role;
- forbidden tunnel and secret-shaped URL inputs fail closed before scope
  acceptance;
- the classic theme scope covers stylesheet, functions, template, and asset
  surfaces;
- `style.css` and `index.php` are required and present in all roles;
- active classic theme `template` and `stylesheet` option rows are represented
  by row hashes only;
- local theme file changes produce live-remote preconditions;
- remote changed stylesheet drift produces a fail-closed conflict; and
- final release posture remains **NO-GO**.

## Redaction Posture

The public artifact stores role names, file paths, counts, boolean gate state,
identity hashes, file scope hashes, surface hashes, planner hashes, and the
scope evidence hash. It does not store raw URLs, hostnames, credentials, route
source values, rejected input values, theme file contents, option row payloads,
cookies, application password values, or production service configuration.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0848-classic-theme-files-v3.test.js
node --test --test-name-pattern RPP-0848 test/rpp-0848-classic-theme-files-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0848-classic-theme-files-v3.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0848-classic-theme-files-v3.test.js`: exit 0
- `node --test --test-name-pattern RPP-0848 test/rpp-0848-classic-theme-files-v3.test.js`: exit 0, 4 tests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0848-classic-theme-files-v3.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0848 URL identity and
classic theme file-scope contract only. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required before promotion.
