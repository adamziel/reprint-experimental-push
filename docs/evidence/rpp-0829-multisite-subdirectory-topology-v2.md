# RPP-0829 Multisite Subdirectory Topology Variant 2

Date: 2026-06-01

## Scope

RPP-0829 records the variant 2 support contract for multisite subdirectory
import/export survival. It extends the RPP-0809 candidate topology shape by
making the plugin and graph survival acceptance rules explicit for a real
WordPress import/export run.

This is support-only evidence. It does not update checklist or progress-page
surfaces. Because this sandbox has no Docker CLI, no complete external
WordPress topology inputs, and no production-backed multisite subdirectory
import/export survival artifact, the evidence remains fail-closed and does not
move final release readiness.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0829",
  "variant": 2,
  "title": "Multisite subdirectory import/export survival support scope",
  "status": "blocked-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "successContract": "plugin-and-graph-evidence-survive-real-wordpress-import-export-for-multisite-subdirectory",
  "builtOn": {
    "candidateTopology": {
      "rppId": "RPP-0809",
      "variant": 1,
      "installMode": "multisite",
      "addressingMode": "subdirectory",
      "supportOnly": true
    },
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
  "supportReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "variantFocus": "real-wordpress-import-export-survival-contract",
    "candidateLabel": "support-candidate",
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
          "authenticated-wordpress-import-export-cycle",
          "production-backed-survival-artifact"
        ]
      },
      {
        "code": "REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING",
        "capability": "multisite-subdirectory-import-export-survival-artifact",
        "artifactProvided": false,
        "requiredFor": [
          "plugin-evidence-survives-import-export",
          "graph-evidence-survives-import-export",
          "release-verifier-review"
        ]
      }
    ]
  },
  "candidateScope": {
    "status": "multisite-subdirectory-import-export-survival-support-candidate",
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
        "source": "0b6491e132472609774683d3f30da86c283662e15566ec97624d8083cafabb7c",
        "localEdited": "097f098b78b5adf89acb7f40868461b7bcf76507390294588b36622aaab59179",
        "remoteChanged": "fa1efd8b3c10720681af6a410e50211691fa49e8ce3bb7c8f303d2a84bcdcb88"
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
      "successContract": "plugin-and-graph-evidence-survive-real-wordpress-import-export-for-multisite-subdirectory",
      "runtimeRequired": "real-wordpress-import-export",
      "productionBackedRequired": true,
      "multisiteRequired": true,
      "addressingModeRequired": "subdirectory",
      "networkConstantsReadbackRequired": true,
      "importObservedRequired": true,
      "exportAfterImportObservedRequired": true,
      "artifactFormat": "hash-count-surface-only",
      "pluginDriver": "reprint-push-release-state",
      "pluginOwner": "reprint-push",
      "pluginResourceKeyHash": "a27fb812a6827abbb94cae92718f54f048a7a23fa6f6361254cb879c862ca6b9",
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
    "acceptanceRules": [
      "real-wordpress-import-export-runtime-only",
      "production-backed-artifact-required",
      "multisite-subdirectory-constants-read-back",
      "source-local-remote-changed-identities-hash-only",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "artifact-stays-hash-count-surface-only"
    ],
    "candidateClaims": [
      "variant-2-survival-contract-recorded",
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
      "network-admin-authorization-proof",
      "final-release-go-decision"
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
      "variant-2-survival-contract-accepted-by-release-verifier",
      "auth-lifecycle-and-durable-journal-accepted-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "docker-cli-missing",
      "external-wordpress-topology-not-configured",
      "no-real-multisite-subdirectory-import-export-survival-artifact",
      "candidate-does-not-read-back-wordpress-network-constants",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "candidate-does-not-support-final-release-go"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-release-verifier-acceptance"
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
      "integrationRecommendation",
      "successContract"
    ]
  },
  "scopeComparisonHash": "0c574b7999e1c2457bca8f272f81738dc7f9876d3b1168a4c30cce794768138e"
}
```

## Candidate Scope

The support candidate is limited to a static multisite subdirectory topology
inventory plus explicit import/export survival acceptance rules. It records
the path-based multisite shape, representative network and per-blog table
surfaces, hash-only source, local edited, and remote changed role identities,
and the required plugin and graph survival surfaces.

The artifact stores only table names, constant names, booleans, counts implied
by array membership, identity hashes, and comparison hashes. It does not store
raw hostnames, raw URLs, option row payloads, route receipts, plugin payloads,
graph payloads, or live WordPress service configuration.

## Release-Ready Scope

Release-ready multisite subdirectory evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove live subdirectory addressing mode, read back network
constants from the target WordPress runtime, verify source/local/remote changed
route identities, check root and child site surfaces by hash and count only,
prove per-site table routing, and show that plugin-driver and graph evidence
survived both import and export. Until that production-backed proof exists,
RPP-0829 remains NO-GO for final release integration.
