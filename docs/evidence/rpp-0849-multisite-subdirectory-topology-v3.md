# RPP-0849 Multisite Subdirectory Topology Variant 3

Date: 2026-06-01

## Scope

RPP-0849 records variant 3 support evidence for multisite subdirectory
import/export survival. It carries forward the RPP-0829 variant 2 plugin and
graph survival contract and adds the current production-topology boundary:
production import/export, live topology readback, release-verifier acceptance,
auth/session lifecycle, durable journal replay, and redacted release artifacts
remain required before any release-ready claim.

This is support-only evidence. It does not call WordPress routes, does not run
import/export, does not start servers, does not use a live topology, does not
update checklist or progress-page surfaces, and does not move release gates.
Because this sandbox has no Docker CLI, no complete external WordPress topology
inputs, no real multisite subdirectory import/export survival artifact, and no
accepted production-topology release-verifier artifact, the evidence is
fail-closed and final release remains NO-GO.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0849",
  "variant": 3,
  "title": "Multisite subdirectory import/export survival support scope v3",
  "status": "blocked-support-only",
  "failClosed": true,
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successContract": "plugin-and-graph-evidence-survive-real-wordpress-import-export-for-multisite-subdirectory",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "builtOn": {
    "previousSupportScope": {
      "rppId": "RPP-0829",
      "variant": 2,
      "pluginGraphSurvivalContract": true,
      "productionBacked": false,
      "releaseGateMovement": "none"
    },
    "candidateTopology": {
      "rppId": "RPP-0809",
      "variant": 1,
      "installMode": "multisite",
      "addressingMode": "subdirectory",
      "supportOnly": true
    },
    "currentProductionTopologyPattern": {
      "rppId": "RPP-0890",
      "variant": 5,
      "productionGapBookkeeping": true,
      "releaseVerifierCarryThroughBoundary": true,
      "finalReleaseStatus": "NO-GO"
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
    "variantFocus": "real-wordpress-import-export-survival-contract-v3",
    "candidateLabel": "support-candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "operationGuards": {
    "liveWordPressUsed": false,
    "wordpressRoutesCalled": false,
    "networkProbePerformed": false,
    "importExportPerformed": false,
    "productionTopologyReadbackAccepted": false,
    "releaseVerifierProductionRunPerformed": false,
    "authSessionLifecycleObserved": false,
    "durableJournalObserved": false,
    "localServerStarted": false,
    "remoteTunnelUsed": false,
    "releaseGatesMoved": false,
    "progressSurfacesModified": false
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
      },
      {
        "code": "PRODUCTION_TOPOLOGY_RELEASE_VERIFIER_ARTIFACT_MISSING",
        "capability": "production-topology-release-verifier-accepted-artifact",
        "artifactProvided": false,
        "requiredFor": [
          "production-topology-release-verifier-acceptance",
          "release-ready-multisite-subdirectory-claim",
          "final-release-go-decision"
        ]
      }
    ]
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "observedAttempt": "not-performed-in-rpp-0849",
    "blockedReasonCode": "REAL_WORDPRESS_MULTISITE_SUBDIRECTORY_IMPORT_EXPORT_REQUIRED"
  },
  "productionTopologyEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "liveSubdirectoryRouteReadback": false,
    "liveNetworkConstantReadback": false,
    "liveNetworkSiteCountReadback": false,
    "livePluginGraphReadback": false,
    "releaseVerifierAccepted": false,
    "observedAttempt": "not-performed-in-rpp-0849",
    "blockedReasonCode": "LIVE_MULTISITE_SUBDIRECTORY_TOPOLOGY_RELEASE_VERIFIER_REQUIRED"
  },
  "releaseVerifierCarryThrough": {
    "present": true,
    "coverageMode": "candidate-boundary-carry-through",
    "topologySurface": "multisite-subdirectory-production-topology",
    "commandSurface": "verify-release-command-surface",
    "candidateVersusReleaseReadyBoundary": "recorded",
    "acceptedReleaseEvidence": false,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseVerifierAccepted": false,
    "releaseGateMovement": "none",
    "blockedReasonCode": "LIVE_MULTISITE_SUBDIRECTORY_TOPOLOGY_RELEASE_VERIFIER_REQUIRED",
    "releaseReadyRequiresProductionBackedVerifier": true,
    "rawVerifierArtifactsIncluded": false
  },
  "candidateScope": {
    "status": "multisite-subdirectory-import-export-survival-support-candidate-v3",
    "coverageMode": "support-contract-candidate-vs-release-ready",
    "supportOnly": true,
    "failClosed": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-static-external-wordpress-topology-derived-v3",
    "topologyShape": {
      "installMode": "multisite",
      "addressingMode": "subdirectory",
      "pathBasedSites": true,
      "subdomainModeExcluded": true,
      "sourceLocalChangedRoleIdentitiesCaptured": true,
      "roleIdentityHashesOnly": true,
      "liveTopologyReadbackPerformed": false,
      "productionTopologyReadbackAccepted": false,
      "releaseVerifierAccepted": false,
      "networkProbePerformed": false,
      "importExportObserved": false,
      "sandboxIngressPort": 8080,
      "remoteTunnelsAllowed": false
    },
    "routeRoleSurfaces": [
      {
        "role": "source",
        "routeRole": "source-subdirectory-network",
        "roleIdentityHash": "9310a651e936737ba98bb601028f716c9f8b02592cf6100c0dc872df218d352a",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdirectory"
        ]
      },
      {
        "role": "local-edited",
        "routeRole": "local-edited-subdirectory-network",
        "roleIdentityHash": "6a4913daa23e8883d02024b4e2839960ad44539b00a3d96968da2a87ff09c878",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdirectory"
        ]
      },
      {
        "role": "remote-changed",
        "routeRole": "remote-changed-subdirectory-network",
        "roleIdentityHash": "cf35bd7e0e40019589c2ac4997cba1dce4a0831bc22cd48226bc4500313e3d4a",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdirectory"
        ]
      }
    ],
    "countEvidence": {
      "routeRoleCount": 3,
      "networkCountPerRouteRole": 1,
      "siteCountPerRouteRole": 2,
      "totalNetworkCount": 3,
      "totalSiteCount": 6,
      "networkTableSurfaceCount": 6,
      "siteScopedTableSurfaceCount": 8,
      "configurationSurfaceCount": 6,
      "requiredPluginSurvivalCount": 3,
      "requiredGraphTypeCount": 6,
      "requiredGraphSurvivalCount": 3,
      "focusedSupportSurfaceCount": 9,
      "unavailableCapabilityCount": 4,
      "importExportBlockerCount": 12,
      "releaseReadyGapCount": 14,
      "runtimeGapCategoryCount": 6,
      "releaseVerifierCarryThroughSurfaceCount": 1,
      "productionTopologyEvidenceCount": 0,
      "rawPayloadCount": 0
    },
    "networkTables": [
      "wp_site",
      "wp_blogs",
      "wp_sitemeta",
      "wp_blogmeta",
      "wp_blog_versions",
      "wp_registration_log"
    ],
    "siteScopedTables": [
      "wp_options",
      "wp_posts",
      "wp_postmeta",
      "wp_term_relationships",
      "wp_2_options",
      "wp_2_posts",
      "wp_2_postmeta",
      "wp_2_term_relationships"
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
      "pluginResourceKeyHash": "f9a50b959777f668b253932f7ed06245300d8b5c993e856d380c92bc90b7b91c",
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
      ],
      "releaseVerifierAcceptanceRequiredForRelease": true,
      "productionTopologyReadbackRequiredForRelease": true,
      "finalReleaseDecisionWithoutArtifact": "NO-GO"
    },
    "runtimeGapCategories": {
      "productionImportExport": "missing",
      "productionTopologyReadback": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "releaseArtifactBundle": "missing",
      "releaseVerifierAcceptance": "missing"
    },
    "focusedSupportSurfaces": [
      "route-role-identity-hash-surfaces",
      "network-table-count-surfaces",
      "site-scoped-table-count-surfaces",
      "configuration-constant-name-surfaces",
      "plugin-survival-contract-surface",
      "graph-survival-contract-surface",
      "production-topology-readback-gap-surfaces",
      "release-verifier-carry-through-boundary-surfaces",
      "release-gate-no-go-surfaces"
    ],
    "surfaceEvidence": [
      {
        "surface": "route-role-identity",
        "surfaceType": "hash-count",
        "countKeys": [
          "routeRoleCount",
          "totalNetworkCount",
          "totalSiteCount"
        ],
        "fields": [
          "role",
          "routeRole",
          "roleIdentityHash",
          "networkCount",
          "siteCount"
        ],
        "hash": "f84396a172a77393dbb1df3a825bfec2692346a7e85a95678746dc7436ef3461"
      },
      {
        "surface": "network-tables",
        "surfaceType": "table-count",
        "tables": [
          "wp_site",
          "wp_blogs",
          "wp_sitemeta",
          "wp_blogmeta",
          "wp_blog_versions",
          "wp_registration_log"
        ],
        "countKeys": [
          "networkTableSurfaceCount"
        ],
        "hash": "ade81ffe8cb10a3bb361d704ba219400025a36c1b45371d2ddcf2441045f97ca"
      },
      {
        "surface": "site-scoped-tables",
        "surfaceType": "table-count",
        "tables": [
          "wp_options",
          "wp_posts",
          "wp_postmeta",
          "wp_term_relationships",
          "wp_2_options",
          "wp_2_posts",
          "wp_2_postmeta",
          "wp_2_term_relationships"
        ],
        "countKeys": [
          "siteScopedTableSurfaceCount"
        ],
        "hash": "8167cd53c3a823ea26e4f85c19dc3cb73fe7396971160a5b6de89faa36f791db"
      },
      {
        "surface": "configuration-constants",
        "surfaceType": "name-count",
        "fields": [
          "MULTISITE",
          "SUBDOMAIN_INSTALL=false",
          "DOMAIN_CURRENT_SITE",
          "PATH_CURRENT_SITE",
          "SITE_ID_CURRENT_SITE",
          "BLOG_ID_CURRENT_SITE"
        ],
        "countKeys": [
          "configurationSurfaceCount"
        ],
        "hash": "59462d55b001c9bf1241898c2bfafb6df007470f20be36be8e04001fae1d141b"
      },
      {
        "surface": "plugin-survival-contract",
        "surfaceType": "survival-count",
        "fields": [
          "pluginDriver",
          "pluginOwner",
          "pluginResourceKeyHash",
          "requiredPluginSurvival"
        ],
        "countKeys": [
          "requiredPluginSurvivalCount"
        ],
        "hash": "782bf97c04e5a92b733e4326e7748c8544e503b685efa5ec1a754a1b6ed7f767"
      },
      {
        "surface": "graph-survival-contract",
        "surfaceType": "survival-count",
        "fields": [
          "featured-image-attachment",
          "category-term-relationship-termmeta",
          "post-parent-page-closure",
          "comment-parent-commentmeta",
          "multisite-blog-option-routing",
          "multisite-cross-blog-reference-boundary"
        ],
        "countKeys": [
          "requiredGraphTypeCount",
          "requiredGraphSurvivalCount"
        ],
        "hash": "2d47339f91b09c14c246b110c3616913efbb3738cc877a4505dd3a9455a62900"
      },
      {
        "surface": "production-topology-readback-gaps",
        "surfaceType": "gap-count",
        "fields": [
          "productionImportExport",
          "productionTopologyReadback",
          "authSessionLifecycle",
          "durableJournal",
          "releaseArtifactBundle",
          "releaseVerifierAcceptance"
        ],
        "countKeys": [
          "runtimeGapCategoryCount",
          "productionTopologyEvidenceCount"
        ],
        "hash": "f72fe23b4d788459824f0ba6be7613ab644282bcc9669a48a8ac38456f55f333"
      },
      {
        "surface": "release-verifier-carry-through-boundary",
        "surfaceType": "verifier-boundary-count",
        "fields": [
          "topologySurface",
          "commandSurface",
          "candidateVersusReleaseReadyBoundary",
          "acceptedReleaseEvidence",
          "productionBacked",
          "releaseEligible",
          "releaseVerifierAccepted",
          "releaseGateMovement"
        ],
        "countKeys": [
          "releaseVerifierCarryThroughSurfaceCount",
          "productionTopologyEvidenceCount"
        ],
        "hash": "b1cfb2238d02c87a9251fb0aad1de24c36ae6e8361d17c7900213c281e18d2ad"
      },
      {
        "surface": "release-gate-boundary",
        "surfaceType": "no-go-count",
        "fields": [
          "supportOnly",
          "failClosed",
          "productionBacked",
          "releaseEligible",
          "finalReleaseStatus",
          "integrationRecommendation"
        ],
        "countKeys": [
          "importExportBlockerCount",
          "releaseReadyGapCount",
          "rawPayloadCount"
        ],
        "hash": "24f6b28a6a61e076ed3772f10f651694b5561412fa9e32ea9baa383d09f4c577"
      }
    ],
    "surfaceEvidenceHash": "236a0d2998929bcfa1aa74bd7c8141253f32e20d362cd3a6c9a792367774dd55",
    "acceptanceRules": [
      "real-wordpress-import-export-runtime-only",
      "production-backed-artifact-required",
      "multisite-subdirectory-constants-read-back",
      "source-local-remote-changed-identities-hash-only",
      "plugin-driver-evidence-survives-import-and-export",
      "all-required-graph-types-survive-import-and-export",
      "release-verifier-acceptance-required-before-release-eligibility",
      "artifact-stays-hash-count-surface-only"
    ],
    "candidateClaims": [
      "variant-3-survival-contract-carried-forward",
      "subdirectory-network-shape-recorded",
      "source-local-changed-url-identity-contract-reused",
      "production-topology-boundary-recorded",
      "release-verifier-boundary-carried-through",
      "real-import-export-success-contract-defined",
      "hash-count-surface-only-evidence"
    ],
    "importExportBlockers": [
      "no-production-bound-multisite-export",
      "no-production-bound-multisite-import",
      "no-authenticated-production-export-session",
      "no-authenticated-production-import-session",
      "no-live-subdirectory-route-readback",
      "no-live-network-constant-readback",
      "no-network-site-count-runtime-readback",
      "no-plugin-driver-runtime-readback",
      "no-required-graph-runtime-readback",
      "no-cross-blog-mutation-precondition-run",
      "no-release-verifier-accepted-production-topology",
      "no-real-multisite-subdirectory-import-export-survival-artifact"
    ],
    "releaseReadyGaps": [
      "production-bound-multisite-export",
      "production-bound-multisite-import",
      "auth-session-lifecycle-release-verifier-acceptance",
      "durable-journal-restart-replay-proof",
      "live-source-local-changed-route-role-readback",
      "live-subdirectory-route-proof",
      "live-network-constant-readback",
      "network-and-site-count-runtime-readback",
      "plugin-driver-runtime-surface-readback",
      "required-graph-runtime-surface-readback",
      "cross-blog-table-mutation-precondition-proof",
      "production-topology-release-verifier-acceptance",
      "redacted-release-artifact-bundle",
      "release-verifier-accepted-import-export-run"
    ],
    "excludedFromCandidate": [
      "production-bound-multisite-subdirectory-import-export",
      "production-auth-session-lifecycle-proof",
      "durable-journal-restart-replay-proof",
      "plugin-evidence-import-survival-proof",
      "plugin-evidence-export-survival-proof",
      "graph-evidence-import-survival-proof",
      "graph-evidence-export-survival-proof",
      "live-subdirectory-route-readback",
      "wp-config-network-constant-readback",
      "per-site-route-receipts",
      "cross-blog-table-mutation-proof",
      "network-admin-authorization-proof",
      "production-topology-release-verifier-proof",
      "release-verifier-artifact-bundle",
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
      "network-and-site-counts-read-back-from-live-wordpress",
      "wp_site-wp_blogs-wp_sitemeta-wp_blogmeta-wp_blog_versions-registration_log-surfaces-hash-count-checked",
      "per-site-prefix-table-routing-and-cross-blog-mutation-preconditions-proven",
      "plugin-driver-evidence-survives-real-wordpress-import-export",
      "featured-image-taxonomy-post-parent-comment-graph-evidence-survives-real-wordpress-import-export",
      "auth-session-lifecycle-accepted-by-release-verifier",
      "durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier",
      "production-topology-release-verifier-accepted",
      "redacted-release-artifact-bundle-passes-artifact-redaction-scan",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "gaps": {
      "productionBoundMultisiteImportExport": "missing",
      "productionTopologyReadback": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "liveTopologyReadback": "missing",
      "productionReleaseArtifacts": "missing"
    },
    "blockers": [
      "docker-cli-missing",
      "external-wordpress-topology-not-configured",
      "no-real-multisite-subdirectory-import-export-survival-artifact",
      "candidate-does-not-run-production-import-export",
      "candidate-does-not-carry-accepted-auth-session-lifecycle-proof",
      "candidate-does-not-prove-durable-journal-restart-replay",
      "candidate-does-not-prove-live-subdirectory-route-readback",
      "candidate-does-not-read-back-wordpress-network-constants",
      "candidate-does-not-read-live-network-site-counts",
      "candidate-does-not-prove-plugin-survival",
      "candidate-does-not-prove-graph-survival",
      "candidate-does-not-prove-per-site-route-receipts",
      "candidate-does-not-prove-cross-blog-mutation-safety",
      "candidate-does-not-have-production-topology-release-verifier-acceptance",
      "release-artifact-bundle-not-present",
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
    "rawReleaseArtifactsIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "productionImportExportEvidence",
      "productionTopologyEvidence",
      "releaseVerifierCarryThrough",
      "operationGuards",
      "finalReleaseStatus",
      "integrationRecommendation",
      "successContract"
    ]
  },
  "scopeComparisonHash": "8bd0dbe20121e24b4fb1f8cda986bc93c6349944b1d7a094937b81b5078a1704"
}
```

## Candidate Scope

The support candidate is limited to deterministic, hash/count/surface-only
evidence for the multisite subdirectory survival contract. It records route
role hashes for source, local edited, and remote changed roles; representative
network and site-scoped table surfaces; subdirectory network constants; and
the plugin and graph survival surfaces that must survive a real WordPress
import/export run.

The artifact stores only table names, constant names, surface names, booleans,
counts, identity hashes, gap labels, surface hashes, and comparison hashes. It
does not store raw hostnames, raw URLs, option row payloads, route receipts,
plugin payloads, graph payloads, live WordPress service configuration, release
verifier artifacts, or credential material.

## Release-Ready Scope

Release-ready multisite subdirectory evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove live subdirectory addressing mode, read back network
constants from the target WordPress runtime, verify source/local/remote changed
route identities, check root and child site surfaces by hash and count only,
prove per-site table routing, and show that plugin-driver and required graph
evidence survived both import and export.

Until production-backed proof and accepted production-topology release-verifier
evidence exist, RPP-0849 remains NO-GO for final release integration.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0849-multisite-subdirectory-topology-v3.test.js
node --test --test-name-pattern RPP-0849 test/rpp-0849-multisite-subdirectory-topology-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0849-multisite-subdirectory-topology-v3.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```
