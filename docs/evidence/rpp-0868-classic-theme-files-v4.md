# RPP-0868 classic theme files v4 evidence

Date: 2026-06-01
Lane: RPP-0868 classic theme files, variant 4
Checklist item: RPP-0868 - Prove classic theme files, variant 4.

## Scope

This slice adds deterministic local support evidence for a classic WordPress
theme file scope. It follows the RPP-0848 focused regression pattern, the
RPP-0828 generated coverage pattern, and the RPP-0808 classic theme file
pattern for source, local edited, and remote changed URL identity handling,
then records the stylesheet, functions, template, and asset surfaces as
hash/count/surface evidence only.

The proof remains support-only. It does not contact WordPress hosts, open
sockets, run live import/export, collect route receipts, capture credentials,
or move release gates. Final release status and integration recommendation
remain **NO-GO**.

## Proof Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0868",
  "variant": 4,
  "title": "Classic theme files v4 support scope",
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
    },
    "focusedRegressionPattern": {
      "rppId": "RPP-0848",
      "variant": 3,
      "fileScopeContract": "classic-theme-style-functions-template-asset-scope",
      "hashCountSurfaceOnlyEvidence": true,
      "releaseStatus": "NO-GO"
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
      "source": "abde8a00a247e9288281f081470020b7c9e10232073eee79aa90a9ae9e31537e",
      "localEdited": "a69bd758a2d34ced0f5c8dc41011aecc6b60e1db38d62cd7cae2f866b39d9d34",
      "remoteChanged": "613925d628a9b6ecb1827f925ce8b227a73735a72ac5b294d092e10a88cb1312"
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
    "scopeRoot": "wp-content/themes/rpp-0868-classic-v4",
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
    "fileScopeHash": "sha256:2d0ecf3a22c0b77819c2713d36612249a869e92e0ee2b60a08346794a8553cee",
    "stylesheetHeaderFieldCount": 3,
    "stylesheetHeaderHashCount": 3,
    "activeThemeOptionRowCount": 2,
    "activeThemeOptionRowsHashCount": 3,
    "surfaceHashes": [
      {
        "surface": "stylesheet",
        "fileCount": 1,
        "requiredFileCount": 1,
        "sourceHash": "sha256:18bed634297dd44703526e5e01b11064fea6a2d8d949528db2bd396b8753fc73",
        "localHash": "sha256:76f4b0408391222e3b5e5bf0f7d0c28911f1cc797e75f33de64881313d04e79b",
        "remoteChangedHash": "sha256:bd3feafa9fe86a273d0f2e82eb05fe7b3e55dcff6d57732429ec546bdac51da1"
      },
      {
        "surface": "functions",
        "fileCount": 1,
        "requiredFileCount": 0,
        "sourceHash": "sha256:bdacf6fe804e9739398596782ae81e6730b58a8dbe65c3f871b1ddf2188fa4ae",
        "localHash": "sha256:273aec35735c42d6ee5293918539e987c07405273f3820dead06d0ee7267a800",
        "remoteChangedHash": "sha256:bdacf6fe804e9739398596782ae81e6730b58a8dbe65c3f871b1ddf2188fa4ae"
      },
      {
        "surface": "template",
        "fileCount": 5,
        "requiredFileCount": 1,
        "sourceHash": "sha256:548ef5fa5d20271c56025f1471d19d3efb0e8b281b5e0b744e975bd1e2177ee0",
        "localHash": "sha256:1280683ebf8752759c6f28875b1822bd2a5742af89e8dce90e97082b5e769ac3",
        "remoteChangedHash": "sha256:548ef5fa5d20271c56025f1471d19d3efb0e8b281b5e0b744e975bd1e2177ee0"
      },
      {
        "surface": "asset",
        "fileCount": 3,
        "requiredFileCount": 0,
        "sourceHash": "sha256:11e8989328530a26294b61da7784475262d41eefdda1f770562f96e395ddda77",
        "localHash": "sha256:a9ad0b16cbf3a634682bb589e4c254d99cfe29be615afee15f427ec14f7607e8",
        "remoteChangedHash": "sha256:11e8989328530a26294b61da7784475262d41eefdda1f770562f96e395ddda77"
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
    "readyPlanHash": "sha256:38c4b83a479a6d5ba2af3e756c4b229d5d720d20076aea5f920dc81ec78baa5f",
    "remoteChangedPlanStatus": "conflict",
    "remoteChangedThemeConflictCount": 1,
    "remoteChangedPlanHash": "sha256:4371f2b4d7bd57c6616640606ad00cfaae2798a0355393bd8b26e07ed41d6d12",
    "remoteChangedThemeDriftFailsClosed": true,
    "everyThemeMutationHasLiveRemotePrecondition": true
  },
  "negativeControls": {
    "tunnelUrlRejected": true,
    "secretShapedUrlRejected": true,
    "duplicateRoleUrlsRejected": true,
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
  "scopeEvidenceHash": "bb4c402a0da85f57f5255ae47ae112a6dd3d165a07c5dec6495e58c389191409"
}
```

## Variant 4 Checks

The focused test asserts:

- source, local edited, and remote changed role URL surfaces are captured;
- role URL identities are distinct and stored as identity hashes only;
- source aliases and per-route source identities match the source role;
- forbidden tunnel, secret-shaped, duplicate, and packaged fallback URL inputs
  fail closed before scope acceptance;
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
node --check test/rpp-0868-classic-theme-files-v4.test.js
node --test --test-name-pattern RPP-0868 test/rpp-0868-classic-theme-files-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0868-classic-theme-files-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0868-classic-theme-files-v4.test.js`: exit 0
- `node --test --test-name-pattern RPP-0868 test/rpp-0868-classic-theme-files-v4.test.js`: exit 0, 5 tests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0868-classic-theme-files-v4.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0868 URL identity and
classic theme file-scope contract only. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required before promotion.
