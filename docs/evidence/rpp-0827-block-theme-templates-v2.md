# RPP-0827 block theme templates v2 evidence

Date: 2026-06-01
Lane: RPP-0827 block theme templates, variant 2
Checklist item: RPP-0827 - Implement block theme templates, variant 2.

## Scope

This slice adds deterministic local support evidence for a variant 2 block
theme template topology. It follows the adjacent RPP-0807 block theme evidence
pattern while widening the block theme scope to include `theme.json`, three
source templates, one local-only template, three template parts, a filesystem
pattern, a style variation, and the active theme option row keys.

The proof remains support-only. It does not contact external WordPress hosts,
start Docker, run live import/export, establish production auth material,
collect route receipts, mutate a site, publish progress, or move release gates.
Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0827",
  "variant": 2,
  "title": "Block theme templates variant 2 topology support proof",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "blockThemeTemplatesScope": {
    "themeType": "block",
    "themeRoot": "wp-content/themes/rpp-0827-block-v2",
    "sourcePattern": "source-local-changed-block-theme-topology",
    "requiredFiles": [
      "theme.json",
      "templates/index.html",
      "templates/home.html",
      "parts/header.html",
      "parts/footer.html"
    ],
    "templateFileCount": 4,
    "templatePartFileCount": 3,
    "patternFileCount": 1,
    "styleVariationFileCount": 1,
    "themeJsonValidated": true,
    "templateAndPartPathsNotNested": true,
    "templatePartAreasDeclared": true,
    "activeThemeOptionRowsCaptured": true,
    "localChangedFileCount": 6,
    "remoteChangedTemplateDriftFailsClosed": true,
    "plannerMutationsRequireLiveRemotePreconditions": true,
    "releaseGateMovement": "none"
  },
  "releaseVerifierTarget": {
    "requiredCommand": "npm run verify:release",
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
    "externalLiveTopologyProvided": false,
    "authMaterialProvided": false
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawTemplateBodiesIncluded": false,
    "rawThemeJsonBodiesIncluded": false,
    "rawOptionRowPayloadsIncluded": false,
    "rawUrlValuesIncluded": false,
    "authMaterialIncluded": false,
    "scopeEvidenceHashCovers": [
      "blockThemeTemplatesScope",
      "releaseVerifierTarget",
      "unavailableCapability",
      "integrationRecommendation"
    ]
  },
  "scopeEvidenceHash": "01ca2b972f27682d9667784e49d56af2253e3ad8ab5e29368ac62249eabba6fe"
}
```

## Proof Surface

`test/rpp-0827-block-theme-templates-v2.test.js` builds a local proof around
the existing RPP-0803 topology validator. The topology layer checks source,
local edited, and remote changed URL identities; optional source aliases;
per-route source identities; tunnel rejection; URL userinfo, query, and
fragment rejection; sandbox loopback limited to port `8080`; and packaged
fallback flags disabled.

The block theme layer records a `wp-content/themes/rpp-0827-block-v2/` scope
with:

- `theme.json`
- `templates/index.html`
- `templates/home.html`
- `templates/page.html`
- `parts/header.html`
- `parts/footer.html`
- `parts/sidebar.html`
- `patterns/landing-section.php`
- `styles/high-contrast.json`

It also records a local-only `templates/search.html` addition as part of the
scoped mutation set. The proof stores paths, counts, hashes, planner
precondition hashes, conflict hashes, and booleans only. It does not store
template bodies, pattern bodies, style file bodies, theme JSON bodies, option
row payloads, auth material, URL secret parts, cookies, bearer values, or
application password values.

## Variant 2 Checks

The focused test asserts:

- source, local edited, and remote changed URL identities are captured and
  distinct on the accepted path;
- known tunnel hosts, URL secret-shaped parts, and packaged fallback flags fail
  closed before the theme scope is accepted;
- `theme.json` is present and valid in all three roles;
- block theme templates live directly under `templates/` and template parts
  live directly under `parts/`;
- header, footer, and sidebar template part areas are declared through theme
  metadata;
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
node --check test/rpp-0827-block-theme-templates-v2.test.js
node --test --test-name-pattern RPP-0827 test/rpp-0827-block-theme-templates-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0827-block-theme-templates-v2.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0827-block-theme-templates-v2.test.js`: exit 0
- RPP-0827 focused proof test: passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0827 block theme
template scope and topology identity contract. Production-backed WordPress
reachability, auth material, route receipts, durable journal behavior, and live
mutation receipts remain required before this slice can support release
movement.
