# RPP-0809 Multisite Subdirectory Topology Variant 1

Date: 2026-06-01

## Scope

RPP-0809 records the multisite subdirectory topology candidate shape against
the release-ready scope. This is deterministic support evidence only. It reuses
the RPP-0803 source, local edited, and remote changed identity contract, the
RPP-0808 hash-only role identity pattern, and the RPP-0804 import/export
survival target for plugin and graph evidence.

This variant does not update checklist or progress-page surfaces. Because this
sandbox has no Docker CLI, no complete external WordPress topology inputs, and
no real multisite subdirectory import/export artifact, the evidence remains
fail-closed and does not move release readiness.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0809",
  "variant": 1,
  "title": "Multisite subdirectory topology candidate scope",
  "status": "blocked-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "topologyContract": {
      "rppId": "RPP-0803",
      "variant": 1,
      "sourceLocalChangedUrlCapture": true,
      "identityHashOnly": true
    },
    "urlIdentityPattern": {
      "rppId": "RPP-0808",
      "variant": 1,
      "roleIdentities": [
        "source",
        "local-edited",
        "remote-changed"
      ],
      "sameSourceAcrossRoutesRequired": true
    },
    "importExportSurvivalContract": {
      "rppId": "RPP-0804",
      "variant": 1,
      "successTarget": "plugin-and-graph-evidence-survive-real-wordpress-import-export"
    }
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "currentObservation": {
    "observedAt": "2026-06-01T00:00:00.000Z",
    "exactUnavailableCapabilities": [
      {
        "code": "DOCKER_CLI_MISSING",
        "capability": "docker-cli",
        "command": "docker --version",
        "missingExecutable": true,
        "requiredFor": [
          "real-wordpress-multisite-subdirectory-runtime",
          "wordpress-import-export-cycle",
          "plugin-and-graph-survival-readback"
        ]
      },
      {
        "code": "EXTERNAL_WORDPRESS_TOPOLOGY_NOT_CONFIGURED",
        "capability": "complete-external-wordpress-topology",
        "missingInputs": [
          "REPRINT_PUSH_SOURCE_URL",
          "REPRINT_PUSH_LOCAL_URL",
          "REPRINT_PUSH_REMOTE_CHANGED_URL",
          "REPRINT_PUSH_USERNAME",
          "REPRINT_PUSH_APPLICATION_PASSWORD"
        ],
        "valuesIncluded": false,
        "requiredFor": [
          "source-local-remote-changed-route-checks",
          "authenticated-wordpress-import-export-cycle"
        ]
      },
      {
        "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
        "capability": "multisite-subdirectory-import-export-survival-artifact",
        "artifactProvided": false,
        "requiredFor": [
          "plugin-evidence-survives-import-export",
          "graph-evidence-survives-import-export"
        ]
      }
    ]
  },
  "candidateScope": {
    "status": "multisite-subdirectory-topology-candidate",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-static-external-wordpress-topology-derived",
    "topologyShape": {
      "installMode": "multisite",
      "addressingMode": "subdirectory",
      "pathBasedSites": true,
      "subdomainModeExcluded": true,
      "sourceLocalChangedRoleIdentitiesCaptured": true,
      "roleIdentityHashesOnly": true,
      "roleIdentityHashes": {
        "source": "5e4b25f84367a06df05329ed6c88b97e0f68ee48181248b4bb39663f9209f1cb",
        "localEdited": "317ab406fb38f03b0f93525223017fd97a04d78a4b5b7c1d16cf70b4a0768668",
        "remoteChanged": "57d07f544f3c2d0d87f9162d3d43bbee0fb5a888aeda9acf0beaa5e24eb3bb75"
      },
      "roleIdentitiesDistinct": true,
      "sourceAliasAndRouteSourceIdentitiesMatch": true,
      "networkProbePerformed": false,
      "importExportObserved": false,
      "sandboxIngressPort": 8080,
      "remoteTunnelsAllowed": false
    },
    "networkTables": [
      "wp_site",
      "wp_blogs",
      "wp_sitemeta",
      "wp_blogmeta",
      "wp_blog_versions",
      "wp_registration_log"
    ],
    "blogScopedTables": [
      "wp_options",
      "wp_posts",
      "wp_postmeta",
      "wp_2_options",
      "wp_2_posts",
      "wp_2_postmeta"
    ],
    "configurationSurface": [
      "MULTISITE",
      "SUBDOMAIN_INSTALL=false",
      "DOMAIN_CURRENT_SITE",
      "PATH_CURRENT_SITE",
      "SITE_ID_CURRENT_SITE",
      "BLOG_ID_CURRENT_SITE"
    ],
    "importExportSurvivalSurface": {
      "runtimeRequired": "real-wordpress-import-export",
      "multisiteRequired": true,
      "addressingModeRequired": "subdirectory",
      "pluginDriver": "reprint-push-release-state",
      "pluginOwner": "reprint-push",
      "pluginResourceKeyHash": "2aaf7108bc82a353fb2a6d1e71a38c6ca0f8125093739b899259176301b7a8b6",
      "requiredPluginSurvival": [
        "survived-import",
        "survived-export",
        "live-precondition-hash"
      ],
      "requiredGraphTypes": [
        "featured-image-attachment",
        "category-term-relationship-termmeta",
        "post-parent-page-closure",
        "comment-parent-commentmeta",
        "multisite-blog-option-routing",
        "multisite-cross-blog-reference-boundary"
      ],
      "requiredGraphSurvival": [
        "survived-import",
        "survived-export",
        "round-trip-hash"
      ]
    },
    "candidateClaims": [
      "subdirectory-network-shape-recorded",
      "source-local-changed-url-identity-contract-reused",
      "network-table-surface-inventory-recorded",
      "real-import-export-success-contract-defined",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-multisite-subdirectory-import-export",
      "plugin-evidence-import-survival-proof",
      "plugin-evidence-export-survival-proof",
      "graph-evidence-import-survival-proof",
      "graph-evidence-export-survival-proof",
      "wp-config-network-constant-readback",
      "per-site-route-receipts",
      "cross-blog-table-mutation-proof",
      "network-admin-authorization-proof"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-multisite-subdirectory-import-export",
      "subdirectory-install-constants-read-back-from-live-wordpress",
      "source-local-remote-changed-identities-distinct-and-same-source-route-checked",
      "network-root-and-child-subdirectory-siteurl-home-hash-count-checked",
      "wp_site-wp_blogs-wp_sitemeta-wp_blogmeta-wp_blog_versions-registration_log-surfaces-hash-count-checked",
      "per-site-prefix-table-routing-and-cross-blog-mutation-preconditions-proven",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "featured-image-taxonomy-post-parent-comment-graph-evidence-survives-real-wordpress-import-export",
      "auth-lifecycle-and-durable-journal-accepted-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-missing",
      "external-wordpress-topology-not-configured",
      "no-real-multisite-subdirectory-import-export-survival-artifact",
      "candidate-does-not-read-back-wordpress-network-constants",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawHostValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "pluginRawValuesIncluded": false,
    "graphRawValuesIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "959019fe4bc66f29f2856712df2f9d92e53980282df7b0c3673b09124c902e75"
}
```

## Candidate Scope

The candidate is limited to a static multisite subdirectory topology inventory.
It records the path-based multisite shape, the representative network and
per-blog table surfaces, and the hash-only source, local edited, and remote
changed role identities.

The artifact stores only table names, constant names, booleans, counts implied
by array membership, identity hashes, and comparison hashes. It does not store
raw hostnames, raw URLs, option row payloads, route receipts, or live WordPress
service configuration.

## Release-Ready Scope

Release-ready multisite subdirectory evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove live subdirectory addressing mode, read back network
constants from the target WordPress runtime, verify source/local/remote changed
route identities, check root and child site surfaces by hash and count only,
prove per-site table routing, and show that plugin-driver and graph evidence
survived both import and export.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record as support-only, fail-closed progress evidence. Do not move final
release readiness or mark multisite subdirectory topology release-ready from
this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0809-multisite-subdirectory-topology-v1.test.js
node --test --test-name-pattern RPP-0809 test/rpp-0809-multisite-subdirectory-topology-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0809-multisite-subdirectory-topology-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0809-multisite-subdirectory-topology-v1.test.js`: exit 0
- RPP-0809 focused proof test: passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
