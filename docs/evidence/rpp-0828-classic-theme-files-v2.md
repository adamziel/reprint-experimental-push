# RPP-0828 classic theme files v2 evidence

Date: 2026-06-01
Lane: RPP-0828 classic theme files, variant 2
Checklist item: RPP-0828 - Prove classic theme files, variant 2.

## Scope

This slice adds deterministic local support evidence for a classic WordPress
theme file scope. It reuses the source, local edited, and remote changed URL
identity contract from RPP-0803 and the RPP-0808 classic theme file pattern,
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
  "rppId": "RPP-0828",
  "variant": 2,
  "title": "Classic theme files v2 support scope",
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
      "source": "53a8795bc12a58a25eff0d66d57edfcb0d6dcbf4e25b7ed14469301bd036fb82",
      "localEdited": "cbeee71041483e862f3371283eb891f5df932dfeb11ab0ff1dd8a0326792d77d",
      "remoteChanged": "af81655e848c49becfe7589113a7db4cfcdd7491a84146a800fd965f604ca012"
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
    "scopeRoot": "wp-content/themes/rpp-0828-classic-v2",
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
    "fileScopeHash": "sha256:d7ef16d0723f2b2c3215dff782dc0eeb406ce6095bb00470853ed117264d474d",
    "stylesheetHeaderFieldCount": 3,
    "stylesheetHeaderHashCount": 3,
    "activeThemeOptionRowCount": 2,
    "activeThemeOptionRowsHashCount": 3,
    "surfaceHashes": [
      {
        "surface": "stylesheet",
        "fileCount": 1,
        "requiredFileCount": 1,
        "sourceHash": "sha256:807f297a1614e9b1940b056c057fe81b1cf936ca77e740b301b626cac7d04ff8",
        "localHash": "sha256:1be5cd321880e65097b5d5883aa39bd933abcf7fd780acd5af5e0c49b95bbcbc",
        "remoteChangedHash": "sha256:f57c04d167d4c9b2cf415292461352663126c509079521d16a64a9afe86356c5"
      },
      {
        "surface": "functions",
        "fileCount": 1,
        "requiredFileCount": 0,
        "sourceHash": "sha256:3d5d3ffaa73e480b2ddff73e60a9f7b0a0599f33ab7d3f481dbb6cf171a90280",
        "localHash": "sha256:3aa50a53b151d379fcaa9ab34452b3998358cf0ade0e4513eaae7e3ba9f28c24",
        "remoteChangedHash": "sha256:3d5d3ffaa73e480b2ddff73e60a9f7b0a0599f33ab7d3f481dbb6cf171a90280"
      },
      {
        "surface": "template",
        "fileCount": 5,
        "requiredFileCount": 1,
        "sourceHash": "sha256:c244d18b0b8272ece5f015bfdcab113edfcaf9976c48e5c909deef48ab0c2648",
        "localHash": "sha256:d7a03e12bab6d74a719706860ec5c570c58261c9434671594f07e78f51cbb55a",
        "remoteChangedHash": "sha256:c244d18b0b8272ece5f015bfdcab113edfcaf9976c48e5c909deef48ab0c2648"
      },
      {
        "surface": "asset",
        "fileCount": 3,
        "requiredFileCount": 0,
        "sourceHash": "sha256:5dd7e928ad147fb6d5bd92b425b72c6c7127efcf5805d8f2d1f47b67692ec1ba",
        "localHash": "sha256:ff0711adbffd1a81c4d5c9c1ee5e31203b72f7a4472edb044bd3519b15f4e5f8",
        "remoteChangedHash": "sha256:5dd7e928ad147fb6d5bd92b425b72c6c7127efcf5805d8f2d1f47b67692ec1ba"
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
    "readyPlanHash": "sha256:3c781388fc56b2303f4449eac2a77c6a363281d9188f8df17e2f1f56696edf2b",
    "remoteChangedPlanStatus": "conflict",
    "remoteChangedThemeConflictCount": 1,
    "remoteChangedPlanHash": "sha256:b4c419e3f792a67c35030068ae4865d2426437d239cbb3942b9761d9affbe287",
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
  "scopeEvidenceHash": "35f66be3aad47c65d4f3ab7bdfa9eb6e28bdeeab57a15e0c83aeb125dff6e343"
}
```

## Variant 2 Checks

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
node --check test/rpp-0828-classic-theme-files-v2.test.js
node --test --test-name-pattern RPP-0828 test/rpp-0828-classic-theme-files-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0828-classic-theme-files-v2.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0828-classic-theme-files-v2.test.js`: exit 0
- `node --test --test-name-pattern RPP-0828 test/rpp-0828-classic-theme-files-v2.test.js`: exit 0, 4 tests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0828-classic-theme-files-v2.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0828 URL identity and
classic theme file-scope contract only. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required before promotion.
