# RPP-0888 classic theme files v5 evidence

Date: 2026-06-01
Lane: RPP-0888 classic theme files, variant 5
Checklist item: RPP-0888 - Carry through the release verifier for classic theme files, variant 5.

## Scope

This slice carries deterministic local support evidence for a classic WordPress
theme file scope through the production-topology release verifier. It follows
the RPP-0868 release-verifier pattern, the RPP-0848 focused regression pattern,
the RPP-0828 generated coverage pattern, and the RPP-0808 classic theme file
pattern for source, local edited, and remote changed URL identity handling,
then records the stylesheet, functions, template, and asset surfaces as
hash/count/surface-only evidence.

The proof remains support-only. It does not contact WordPress hosts, open
sockets, run live import/export, collect route receipts, capture credentials,
or move release gates. Final release status and integration recommendation
remain **NO-GO**.

## Proof Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0888",
  "variant": 5,
  "title": "Classic theme files v5 support scope",
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
    },
    "releaseVerifierPattern": {
      "rppId": "RPP-0868",
      "variant": 4,
      "fileScopeContract": "classic-theme-style-functions-template-asset-scope",
      "hashCountSurfaceOnlyEvidence": true,
      "sourceLocalChangedUrlCapture": true,
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
      "source": "9871b40670f6785e49e063487df33f7cc6a3f08954f8bd588c17312feb0456d4",
      "localEdited": "0e3d2f289b2c9dd2c8dd4229a057c3fd15a01ada7cc733ae8dd65c269c2488a4",
      "remoteChanged": "ed0562423b5074a8cfdff5b9992992a61865ea2b99f8fab50beabc31aefbf14a"
    },
    "roleIdentitiesDistinct": true,
    "sourceAliasMatchesSource": true,
    "sameSourceAcrossRoutes": true,
    "identityChecked": true,
    "noTunnelPolicyEnforced": true,
    "noSecretShapedUrlParts": true,
    "localLoopbackIngressOnly8080": true,
    "packagedFallbackDisabled": true,
    "networkProbePerformed": false,
    "rawUrlValuesIncluded": false,
    "releaseMovement": "none"
  },
  "classicThemeScope": {
    "status": "support-only-classic-theme-file-scope",
    "themeType": "classic",
    "scopeRoot": "wp-content/themes/rpp-0888-classic-v5",
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
    "fileScopeHash": "sha256:5c0e7c30b494407e955a74d34976b111ea84e06ca0958f9f996755b2eb8d5002",
    "stylesheetHeaderFieldCount": 3,
    "stylesheetHeaderHashCount": 3,
    "activeThemeOptionRowCount": 2,
    "activeThemeOptionRowsHashCount": 3,
    "surfaceHashes": [
      {
        "surface": "stylesheet",
        "fileCount": 1,
        "requiredFileCount": 1,
        "sourceHash": "sha256:a777f7c8a761dc0c3f8588c9a0aa92c6ad2df664f2449dc3f210a0032dcfd91d",
        "localHash": "sha256:79de1613695525e476181a8b73a168bdfae1f5459a83c9a7cfe0f61bc1c27bcf",
        "remoteChangedHash": "sha256:79defe368065f02bf3a07d78cc39ecf8ca5faf4236445598c161d86ddd917130"
      },
      {
        "surface": "functions",
        "fileCount": 1,
        "requiredFileCount": 0,
        "sourceHash": "sha256:6eb23a4da2582d0af0fb826f90c0a0ec7c1bfd1358f5333fcaf5ea41664187dc",
        "localHash": "sha256:67e3d7af9ca724309a439cc3583a4fbc36311e0ae9e692dcee8fab9eb8aec762",
        "remoteChangedHash": "sha256:6eb23a4da2582d0af0fb826f90c0a0ec7c1bfd1358f5333fcaf5ea41664187dc"
      },
      {
        "surface": "template",
        "fileCount": 5,
        "requiredFileCount": 1,
        "sourceHash": "sha256:91fd9e65a27aafd4093083ac9e9ce4352165fc62ba8b759dd0530fdca0aa114a",
        "localHash": "sha256:e3ede9ee5ad4fea8e8672336f61616b1ac11826fa9b4b00157a84ed123cdfaa8",
        "remoteChangedHash": "sha256:91fd9e65a27aafd4093083ac9e9ce4352165fc62ba8b759dd0530fdca0aa114a"
      },
      {
        "surface": "asset",
        "fileCount": 3,
        "requiredFileCount": 0,
        "sourceHash": "sha256:55bfdbe272a52c074e635cb196a74ad0055cdf99e6d957361874f5a15d52dccf",
        "localHash": "sha256:2a768b564f1b81c7d5291e575b34cc7f15ed1721cfac151d4559384c940f5775",
        "remoteChangedHash": "sha256:55bfdbe272a52c074e635cb196a74ad0055cdf99e6d957361874f5a15d52dccf"
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
    "readyPlanHash": "sha256:f96befa717d01602a6e9910d3b26eca3cc73d6d14e413ef56eea6afd3f278a2f",
    "remoteChangedPlanStatus": "conflict",
    "remoteChangedThemeConflictCount": 1,
    "remoteChangedPlanHash": "sha256:1e9956b7eef0477ef8098c804bdf4ff30041186cc1a112e8c53687a2212fde15",
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
  "scopeEvidenceHash": "4f9e47d009741cad569023b594504cd5efd8b56a6b18c0826d8fe5ff1d41b7b2"
}
```

## Variant 5 Checks

The focused test asserts:

- source, local edited, and remote changed role URL surfaces are captured;
- role URL identities are distinct and stored as identity hashes only;
- the RPP-0868 variant 4 release-verifier pattern is carried forward;
- source aliases and per-route source identities match the source role;
- loopback URL handling remains constrained to the sandbox-provided 8080 ingress;
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
node --check test/rpp-0888-classic-theme-files-v5.test.js
node --test --test-name-pattern RPP-0888 test/rpp-0888-classic-theme-files-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0888-classic-theme-files-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0888-classic-theme-files-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0888 test/rpp-0888-classic-theme-files-v5.test.js`: exit 0, 5 tests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0888-classic-theme-files-v5.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0888 URL identity and
classic theme file-scope contract only. Production-backed WordPress
reachability, credentials, route receipts, durable journal behavior, and live
mutation receipts remain required before promotion.
