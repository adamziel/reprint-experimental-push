# RPP-0847 block theme templates v3 evidence

Date: 2026-06-01
Lane: RPP-0847 block theme templates, variant 3
Checklist item: RPP-0847 - Implement block theme templates, variant 3.

## Scope

This slice adds deterministic local support evidence for a variant 3 block
theme template topology. It follows the RPP-0827 block theme template pattern
and the current variant 3 topology evidence posture: support proof is accepted
only when it records either a passing verifier on the topology or the exact
unavailable capability that prevents the topology from running.

This worker did not start services, open tunnels, contact external WordPress
hosts, collect live route receipts, mutate a site, publish progress, or move
release gates. Final release status and integration recommendation remain
**NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0847",
  "proofId": "rpp-0847-block-theme-templates-v3",
  "variant": 3,
  "title": "Block theme templates variant 3 topology support proof",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "coverageMode": "generated-local-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "adjacentEvidence": "RPP-0827 block theme templates variant 2",
    "externalTopologyValidator": "RPP-0803 external WordPress topology",
    "productionTopologyEvidence": [
      "RPP-0841 three-site local production topology v3",
      "RPP-0842 Docker WordPress topology v3",
      "RPP-0843 external WordPress topology v3"
    ]
  },
  "successContract": {
    "criterion": "verify-release-passes-without-packaged-fallback-on-block-theme-topology",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "exactUnavailableCapabilityRecorded": true,
    "finalReleaseMayMove": false
  },
  "blockThemeTemplatesScope": {
    "themeType": "block",
    "themeRoot": "wp-content/themes/rpp-0847-block-v3",
    "sourcePattern": "source-local-changed-block-theme-topology-v3",
    "requiredFiles": [
      "theme.json",
      "templates/index.html",
      "templates/home.html",
      "templates/archive.html",
      "parts/header.html",
      "parts/footer.html"
    ],
    "templateFileCount": 5,
    "templatePartFileCount": 4,
    "patternFileCount": 2,
    "styleVariationFileCount": 2,
    "themeJsonValidated": true,
    "themeJsonCustomTemplatesDeclared": true,
    "templateAndPartPathsNotNested": true,
    "templatePartAreasDeclared": true,
    "activeThemeOptionRowsCaptured": true,
    "localChangedFileCount": 8,
    "remoteChangedTemplateDriftFailsClosed": true,
    "plannerMutationsRequireLiveRemotePreconditions": true,
    "releaseGateMovement": "none"
  },
  "releaseVerifierTarget": {
    "requiredCommand": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "successTarget": "verify-release-passes-without-packaged-fallback-on-block-theme-topology",
    "observedPassingRun": false,
    "productionTopologyAvailable": false,
    "packagedFallbackAllowed": false,
    "packagedFallbackObserved": false,
    "finalReleaseStatus": "NO-GO"
  },
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
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "rawTemplateBodiesIncluded": false,
    "rawThemeJsonBodiesIncluded": false,
    "rawOptionRowPayloadsIncluded": false,
    "rawUrlValuesIncluded": false,
    "authMaterialIncluded": false,
    "networkTunnelOutputIncluded": false,
    "packagedFallbackSurfaceCount": 0
  },
  "invariants": {
    "blockThemeTemplateScopeRecorded": true,
    "requiredBlockThemeFilesPresent": true,
    "themeJsonValidInAllRoles": true,
    "themeJsonCustomTemplatesDeclared": true,
    "templateAndPartPathsNotNested": true,
    "templatePartAreasDeclared": true,
    "readyPlanCoversLocalBlockThemeTemplates": true,
    "everyTemplateMutationHasLiveRemotePrecondition": true,
    "remoteChangedTemplateDriftFailsClosed": true,
    "exactUnavailableCapabilityRecorded": true,
    "noPackagedFallback": true,
    "noProductionBackedProofClaim": true,
    "supportOnlyNoGo": true
  },
  "scopeEvidenceHash": "de012e5a9077c95ab01e69b2b5c2eca4886fd5cf4811338d6d58d778e24451f7"
}
```

## Proof Surface

`test/rpp-0847-block-theme-templates-v3.test.js` builds a local proof around
the existing external topology validator and planner. The topology layer
checks source, local edited, and remote changed identities; per-route source
identity; tunnel rejection; URL userinfo, query, and fragment rejection;
sandbox loopback limited to port `8080`; and packaged fallback disabled.

The block theme layer records a `wp-content/themes/rpp-0847-block-v3/` scope
with:

- `theme.json`
- `templates/index.html`
- `templates/home.html`
- `templates/archive.html`
- `templates/page.html`
- `parts/header.html`
- `parts/footer.html`
- `parts/sidebar.html`
- `parts/comments.html`
- `patterns/landing-section.php`
- `patterns/query-card.php`
- `styles/high-contrast.json`
- `styles/large-print.json`

It also records a local-only `templates/search.html` addition. The proof stores
paths, counts, hashes, planner precondition hashes, conflict hashes, and
booleans only. It does not store template bodies, pattern bodies, style file
bodies, theme JSON bodies, option row payloads, auth material, URL secret
parts, cookies, bearer values, or application password values.

## Variant 3 Checks

The focused test asserts:

- source, local edited, and remote changed identities are captured and distinct
  on the accepted path;
- known tunnel hosts, URL secret-shaped parts, and packaged fallback flags fail
  closed before the theme scope is accepted;
- `theme.json` is present and valid in all three roles;
- custom templates and template part areas are declared through theme metadata;
- block theme templates live directly under `templates/` and template parts
  live directly under `parts/`;
- active theme option row keys are captured without storing row payloads;
- local block theme template edits produce live-remote planner preconditions;
- remote drift on `templates/home.html` produces a fail-closed conflict before
  release movement; and
- the release target remains `npm run verify:release` with packaged fallback
  disabled, but no production-backed passing run is claimed here.

## Unavailable Capability

The required production-backed success target is a passing `npm run
verify:release` run on the block theme topology without packaged fallback. That
capability is not available in this sandbox.

Observed local capability check:

```text
docker --version -> exit 127
Docker blocker: DOCKER_CLI_MISSING
```

External live WordPress topology values and production auth material were not
provided to this worker. No network probe was performed. The evidence therefore
fails closed for release movement and remains support-only.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0847-block-theme-templates-v3.test.js
node --test --test-name-pattern RPP-0847 test/rpp-0847-block-theme-templates-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0847-block-theme-templates-v3.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local results are recorded after validation in the worker response.

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0847 block theme
template scope and topology identity contract. Production-backed WordPress
reachability, auth material, route receipts, durable journal behavior, live
mutation receipts, and a passing topology verifier without packaged fallback
remain required before this slice can support release movement.
