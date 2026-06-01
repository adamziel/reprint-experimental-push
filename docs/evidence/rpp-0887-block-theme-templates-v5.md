# RPP-0887 block theme templates v5 evidence

Date: 2026-06-01
Lane: RPP-0887 block theme templates, variant 5
Checklist item: RPP-0887 - Carry through the release verifier for block theme
templates, variant 5. Success: verify:release passes without packaged fallback
on the topology.

## Scope

This slice adds deterministic local support evidence for the variant 5 block
theme template topology. It follows the RPP-0867 block theme template variant 4
pattern and the RPP-0847 variant 3 pattern while carrying the release-verifier
requirements forward explicitly.

This is not live topology or auth release movement. The proof does not start
services, open tunnels, contact WordPress hosts, collect live route receipts,
mutate a site, publish progress, or move release gates. It records that release
eligibility still requires production-backed `npm run verify:release` evidence
on the block theme topology with packaged fallback disabled and absent.

Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0887",
  "variant": 5,
  "title": "Block theme templates v5 release-verifier support evidence",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "blockThemeVariant4Pattern": {
      "rppId": "RPP-0867",
      "variant": 4,
      "supportOnlyNoGo": true,
      "releaseVerifierPattern": true
    },
    "blockThemeVariant3Pattern": {
      "rppId": "RPP-0847",
      "variant": 3,
      "supportOnlyNoGo": true,
      "templateScopePattern": true
    },
    "topologyContract": {
      "rppId": "RPP-0803",
      "variant": "RPP-0803-variant-1",
      "sourceLocalChangedUrlCapture": true,
      "staticIdentityChecks": true,
      "tunnelAndSecretUrlRejection": true
    },
    "productionTopologyEvidence": [
      "RPP-0881 three-site local production topology v5",
      "RPP-0883 external WordPress topology v5",
      "RPP-0867 block theme templates release-verifier pattern v4"
    ],
    "contract": "release verifier carry-through for block theme templates without packaged fallback"
  },
  "topologyScope": {
    "sourceLocalChangedRoleUrlsCaptured": true,
    "capturedRoleUrlCount": 3,
    "validRoleUrlCount": 3,
    "identityHashCount": 3,
    "sourceLocalChangedUrlIdentitiesIdentityChecked": true,
    "sourceLocalChangedUrlsDistinct": true,
    "sameSourceAcrossRoutes": true,
    "remoteAliasMatchesSource": true,
    "noTunnelPolicyEnforced": true,
    "noUrlSecrets": true,
    "localLoopbackIngressOnly8080": true,
    "packagedFallbackDisabled": true,
    "networkProbePerformed": false,
    "rawUrlValuesStored": false,
    "hostnameValuesStored": false,
    "roleIdentityHashes": {
      "source": "7534a12e700400e9e89f41b5b035718fbc6987851d609aad3c7257340864fc6a",
      "localEdited": "b06860c1c8398af52f0f221d36dc414acaf1a73940be6f1d650f32af7dbd9318",
      "remoteChanged": "e85e8008b4639d3ca3d0497e65393a71fe11a4a6f17ca02c684276a2ebd4f66f"
    }
  },
  "blockThemeTemplatesScope": {
    "status": "support-only-block-theme-template-scope",
    "themeType": "block",
    "themeRoot": "wp-content/themes/rpp-0887-block-v5",
    "requiredFiles": [
      "wp-content/themes/rpp-0887-block-v5/theme.json",
      "wp-content/themes/rpp-0887-block-v5/templates/index.html",
      "wp-content/themes/rpp-0887-block-v5/templates/front-page.html",
      "wp-content/themes/rpp-0887-block-v5/templates/single.html",
      "wp-content/themes/rpp-0887-block-v5/parts/header.html",
      "wp-content/themes/rpp-0887-block-v5/parts/footer.html"
    ],
    "templateFileCount": 6,
    "templatePartFileCount": 4,
    "patternFileCount": 2,
    "styleVariationFileCount": 2,
    "themeJsonValidated": true,
    "themeJsonCustomTemplatesDeclared": true,
    "templateAndPartPathsNotNested": true,
    "templatePartAreasDeclared": true,
    "customTemplatePostTypeCount": 3,
    "templateReferenceSurfaceCount": 4,
    "roleScopedFileCounts": {
      "source": 14,
      "localEdited": 15,
      "remoteChanged": 14
    },
    "allReferencedPartsDeclared": true,
    "activeThemeOptionRowsCaptured": true,
    "localChangedFileCount": 8,
    "remoteChangedTemplatePartDriftFailsClosed": true,
    "plannerMutationsRequireLiveRemotePreconditions": true,
    "rawTemplateBodiesIncluded": false,
    "rawThemeJsonBodiesIncluded": false,
    "scopeHash": "sha256:19d078a43d2e2cfc103ca9a6da46b1c6573f5c8bca4f719b4d601a610201cf7e",
    "releaseGateMovement": "none"
  },
  "plannerScope": {
    "readyPlanStatus": "ready",
    "readyTemplateMutationCount": 8,
    "readyTemplatePreconditionCount": 8,
    "readyPlanHash": "sha256:bff0223f1350790e782f91f662950155edc55c77fa0e6aadbeeeb9bfa219ae4d",
    "remoteChangedPlanStatus": "conflict",
    "remoteChangedTemplateConflictCount": 1,
    "remoteChangedPlanHash": "sha256:694d7cddc285acf34b931b1c369b54a308af592ec7679da3238c87f93460a5ce",
    "remoteChangedTemplatePartDriftFailsClosed": true,
    "everyTemplateMutationHasLiveRemotePrecondition": true
  },
  "releaseVerifier": {
    "requiredCommand": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "successTarget": "verify-release-passes-without-packaged-fallback-on-block-theme-topology",
    "carriedThroughBySupportProof": true,
    "productionBackedVerifyReleaseEvidence": {
      "present": false,
      "observedPassingRun": false,
      "topology": "block-theme-production-topology",
      "requiredBeforeReleaseEligibility": true,
      "unavailableCapability": {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "observedExitCode": 127,
        "missingExecutable": true,
        "externalLiveTopologyProvided": false,
        "authMaterialProvided": false,
        "requiredFor": [
          "block-theme-topology-start",
          "verify-release-without-packaged-fallback",
          "production-backed-block-theme-template-receipts"
        ]
      }
    },
    "packagedFallbackAllowed": false,
    "packagedFallbackObserved": false,
    "noPackagedFallback": true,
    "noTunnelEvidence": true,
    "tunnelObserved": false,
    "productionReadyClaimAccepted": false,
    "productionReadyAmbiguityRejected": true,
    "releaseMovementAllowed": false,
    "finalReleaseStatus": "NO-GO"
  },
  "negativeControls": {
    "tunnelUrlRejected": true,
    "secretShapedUrlRejected": true,
    "non8080LoopbackRejected": true,
    "packagedFallbackRejected": true,
    "blockThemeScopeAcceptedAfterRejectedTopology": false,
    "rawRejectedInputsStored": false
  },
  "releaseEligibility": {
    "status": "not-release-eligible",
    "finalReleaseStatus": "NO-GO",
    "releaseGateMovement": "none",
    "requiredProductionBackedVerifyReleaseBeforeEligibility": true,
    "productionReadyClaimAccepted": false,
    "productionReadyAmbiguityRejected": true,
    "requiredEvidence": [
      "production-backed-verify-release-pass-on-block-theme-topology",
      "packaged-fallback-disabled-and-absent",
      "no-tunnel-service-or-tunnel-url-use",
      "source-local-changed-url-identities-captured-and-checked",
      "route-receipts-durable-journal-and-live-mutation-receipts"
    ],
    "blockers": [
      "support-only-block-theme-template-proof",
      "no-production-backed-verify-release-pass",
      "no-production-backed-wordpress-reachability",
      "no-route-receipts-or-live-mutation-receipts"
    ]
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "rawTemplateBodiesIncluded": false,
    "rawThemeJsonBodiesIncluded": false,
    "rawOptionRowPayloadsIncluded": false,
    "rawUrlValuesIncluded": false,
    "hostnameValuesIncluded": false,
    "authMaterialIncluded": false,
    "networkTunnelOutputIncluded": false,
    "packagedFallbackSurfaceCount": 0
  },
  "scopeEvidenceHash": "4524cc986d01bced973feb1e26554bb2df59380e6b6dd7dddcefd59b0495b474"
}
```

## Proof Surface

`test/rpp-0887-block-theme-templates-v5.test.js` builds a local proof around
the existing external topology validator and planner. The topology layer
checks source, local edited, and remote changed identities; per-route source
identity; tunnel rejection; URL userinfo, query, and fragment rejection;
sandbox loopback limited to port `8080`; and packaged fallback disabled.

The block theme layer records a `wp-content/themes/rpp-0887-block-v5/` scope
with:

- `theme.json`
- `templates/index.html`
- `templates/front-page.html`
- `templates/single.html`
- `templates/page.html`
- `templates/404.html`
- `parts/header.html`
- `parts/footer.html`
- `parts/query-loop.html`
- `parts/post-meta.html`
- `patterns/featured-query.php`
- `patterns/cta-band.php`
- `styles/editorial.json`
- `styles/contrast.json`

It also records a local-only `templates/search.html` addition. The proof stores
paths, counts, hashes, planner precondition hashes, conflict hashes, booleans,
and release-verifier requirement state only. It does not store template bodies,
pattern bodies, style file bodies, theme JSON bodies, option row payloads, auth
material, URL values, hostnames, cookies, bearer values, application password
values, rejected raw inputs, tunnel output, or packaged fallback artifacts.

## Variant 5 Checks

The focused test asserts:

- source, local edited, and remote changed identities are captured and distinct
  on the accepted path;
- known tunnel hosts, URL secret-shaped parts, non-`8080` loopback, and
  packaged fallback flags fail closed before the theme scope is accepted;
- `theme.json` is present and valid in all three roles;
- custom templates, their post-type lists, and template part areas are
  declared through theme metadata;
- block theme templates live directly under `templates/` and template parts
  live directly under `parts/`;
- every parsed template-part reference resolves to a declared part and area;
- active theme option row keys are captured without storing row payloads;
- local block theme template edits produce live-remote planner preconditions;
- remote drift on `parts/header.html` produces a fail-closed conflict before
  release movement;
- the release target remains `npm run verify:release` with packaged fallback
  disabled and absent; and
- support evidence rejects production-ready ambiguity and requires
  production-backed verifier evidence before release eligibility.

## Release-Verifier Boundary

The required production-backed success target is a passing `npm run
verify:release` run on the block theme topology without packaged fallback. That
capability is not claimed by this support evidence.

Observed local capability blocker carried through by the support report:

```text
docker --version -> exit 127
Docker blocker: DOCKER_CLI_MISSING
```

External live WordPress topology values and production auth material were not
provided to this worker. No network probe was performed. A production-ready
label, packaged fallback result, tunnel-backed topology, or ambiguous local
claim is rejected and cannot move release eligibility.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0887-block-theme-templates-v5.test.js
node --test --test-name-pattern RPP-0887 test/rpp-0887-block-theme-templates-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0887-block-theme-templates-v5.md
git diff --check
```

Observed local results are recorded after validation in the worker response.

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0887 block theme
template scope and release-verifier requirement contract. Production-backed
WordPress reachability, auth material, route receipts, durable journal
behavior, live mutation receipts, and a passing topology verifier without
packaged fallback remain required before this slice can support release
movement.
