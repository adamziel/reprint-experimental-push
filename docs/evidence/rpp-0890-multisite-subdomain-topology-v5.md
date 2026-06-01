# RPP-0890 Multisite Subdomain Topology Variant 5

Date: 2026-06-01

## Scope

RPP-0890 records focused regression coverage for the multisite subdomain
topology candidate shape against the release-ready scope. This is deterministic
support evidence only. It follows the RPP-0870 variant-4 candidate-scope
pattern and carries the release-verifier boundary forward without claiming
production topology acceptance. The candidate versus release-ready boundary
stays explicit for production topology readback, production import/export,
auth/session lifecycle, durable journal replay, release artifact, and release
verifier requirements.

This variant does not call WordPress routes, does not use live WordPress, does
not perform import/export, does not update checklist or progress-page surfaces,
and does not move release gates. It gives the integrator a hash/count/surface-
only progress-report artifact that separates the current candidate from the
evidence still required before any release-ready multisite subdomain topology
claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0890",
  "variant": 5,
  "title": "Multisite subdomain topology candidate scope v5",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "builtOn": {
    "candidateScopePattern": {
      "rppId": "RPP-0870",
      "variant": 4,
      "recordsCandidateVersusReleaseReadyScope": true,
      "hostRoleSurfaceCounts": true,
      "pluginThemeSurfaceInventory": true,
      "productionGapBookkeeping": true,
      "releaseVerifierCarryThroughBoundary": true,
      "releaseGateMovement": "none"
    },
    "previousCandidateScopePattern": {
      "rppId": "RPP-0850",
      "variant": 3,
      "recordsCandidateVersusReleaseReadyScope": true,
      "hostRoleSurfaceCounts": true,
      "pluginThemeSurfaceInventory": true
    },
    "earlierCandidateScopePattern": {
      "rppId": "RPP-0830",
      "variant": 2,
      "recordsCandidateVersusReleaseReadyScope": true,
      "hostRoleSurfaceCounts": true,
      "pluginThemeSurfaceInventory": true
    },
    "firstCandidateScopePattern": {
      "rppId": "RPP-0810",
      "variant": 1,
      "recordsCandidateVersusReleaseReadyScope": true
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
    }
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
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
    "releaseGatesMoved": false,
    "progressSurfacesModified": false
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "observedAttempt": "not-performed-in-rpp-0890",
    "blockedReasonCode": "PRODUCTION_BOUND_MULTISITE_IMPORT_EXPORT_AUTH_SESSION_JOURNAL_REQUIRED"
  },
  "productionTopologyEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "liveSubdomainResolutionReadback": false,
    "liveNetworkConstantReadback": false,
    "liveNetworkSiteCountReadback": false,
    "livePluginThemeReadback": false,
    "releaseVerifierAccepted": false,
    "observedAttempt": "not-performed-in-rpp-0890",
    "blockedReasonCode": "LIVE_MULTISITE_SUBDOMAIN_TOPOLOGY_RELEASE_VERIFIER_REQUIRED"
  },
  "releaseVerifierCarryThrough": {
    "present": true,
    "coverageMode": "candidate-boundary-carry-through",
    "topologySurface": "multisite-subdomain-production-topology",
    "commandSurface": "verify-release-command-surface",
    "candidateVersusReleaseReadyBoundary": "recorded",
    "acceptedReleaseEvidence": false,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseVerifierAccepted": false,
    "releaseGateMovement": "none",
    "blockedReasonCode": "LIVE_MULTISITE_SUBDOMAIN_TOPOLOGY_RELEASE_VERIFIER_REQUIRED",
    "releaseReadyRequiresProductionBackedVerifier": true,
    "rawVerifierArtifactsIncluded": false
  },
  "candidateScope": {
    "status": "multisite-subdomain-topology-candidate-v5",
    "coverageMode": "focused-regression-candidate-vs-release-ready",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-static-external-wordpress-topology-derived-v5",
    "topologyShape": {
      "installMode": "multisite",
      "addressingMode": "subdomain",
      "subdirectoryModeExcluded": true,
      "sourceLocalChangedRoleIdentitiesCaptured": true,
      "hostIdentityHashesOnly": true,
      "liveTopologyReadbackPerformed": false,
      "productionTopologyReadbackAccepted": false,
      "releaseVerifierAccepted": false,
      "networkProbePerformed": false,
      "sandboxIngressPort": 8080,
      "remoteTunnelsAllowed": false
    },
    "hostRoleSurfaces": [
      {
        "role": "source",
        "hostRole": "source-subdomain-network",
        "hostIdentityHash": "f5fb5e997b4e4d4330385852948d0143bd9e689690cea04c2050ae397a1687a2",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdomain"
        ]
      },
      {
        "role": "local-edited",
        "hostRole": "local-edited-subdomain-network",
        "hostIdentityHash": "583fd040dba6517399bc15a647fa1b7f633f9aae29557624375df206ceeeef11",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdomain"
        ]
      },
      {
        "role": "remote-changed",
        "hostRole": "remote-changed-subdomain-network",
        "hostIdentityHash": "8ca33db2a036eb317caaf88e41953687f8bf061724b590526dfb42445b50b40f",
        "rawHostIncluded": false,
        "rawUrlIncluded": false,
        "networkCount": 1,
        "siteCount": 2,
        "siteAddressingSurfaces": [
          "network-root",
          "child-subdomain"
        ]
      }
    ],
    "countEvidence": {
      "hostRoleCount": 3,
      "networkCountPerHostRole": 1,
      "siteCountPerHostRole": 2,
      "totalNetworkCount": 3,
      "totalSiteCount": 6,
      "networkTableSurfaceCount": 6,
      "siteScopedTableSurfaceCount": 8,
      "configurationSurfaceCount": 6,
      "pluginSurfaceCount": 4,
      "themeSurfaceCount": 4,
      "focusedRegressionSurfaceCount": 8,
      "importExportBlockerCount": 10,
      "releaseReadyGapCount": 13,
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
      "SUBDOMAIN_INSTALL",
      "DOMAIN_CURRENT_SITE",
      "PATH_CURRENT_SITE",
      "SITE_ID_CURRENT_SITE",
      "BLOG_ID_CURRENT_SITE",
      "sunrise-domain-mapping-policy"
    ],
    "pluginThemeSurfaces": {
      "pluginSurfaces": [
        "network-active-plugins-sitemeta-surface",
        "site-active-plugins-option-surface",
        "must-use-plugin-directory-surface",
        "plugin-file-hash-inventory-surface"
      ],
      "themeSurfaces": [
        "network-allowed-themes-sitemeta-surface",
        "site-allowed-themes-option-surface",
        "stylesheet-template-option-surface",
        "theme-file-hash-inventory-surface"
      ],
      "rawPluginPayloadsIncluded": false,
      "rawThemePayloadsIncluded": false
    },
    "runtimeGapCategories": {
      "productionImportExport": "missing",
      "productionTopologyReadback": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "releaseArtifactBundle": "missing",
      "releaseVerifierAcceptance": "missing"
    },
    "focusedRegressionSurfaces": [
      "host-role-identity-hash-surfaces",
      "network-table-count-surfaces",
      "site-scoped-table-count-surfaces",
      "configuration-constant-name-surfaces",
      "plugin-theme-inventory-surfaces",
      "production-topology-readback-gap-surfaces",
      "release-verifier-carry-through-boundary-surfaces",
      "release-gate-no-go-surfaces"
    ],
    "surfaceEvidence": [
      {
        "surface": "host-role-identity",
        "surfaceType": "hash-count",
        "countKeys": [
          "hostRoleCount",
          "totalNetworkCount",
          "totalSiteCount"
        ],
        "fields": [
          "role",
          "hostRole",
          "hostIdentityHash",
          "networkCount",
          "siteCount"
        ],
        "hash": "51d08f64a339890f2f9694e6ca50d77d2d82019eb75338574940aa03438b3db7"
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
          "SUBDOMAIN_INSTALL",
          "DOMAIN_CURRENT_SITE",
          "PATH_CURRENT_SITE",
          "SITE_ID_CURRENT_SITE",
          "BLOG_ID_CURRENT_SITE",
          "sunrise-domain-mapping-policy"
        ],
        "countKeys": [
          "configurationSurfaceCount"
        ],
        "hash": "b3d6f81460680d01e21720d4c0b225e21b14978775b73f8a387b7eed33529109"
      },
      {
        "surface": "plugin-theme-inventory",
        "surfaceType": "surface-count",
        "fields": [
          "network-active-plugins-sitemeta-surface",
          "site-active-plugins-option-surface",
          "must-use-plugin-directory-surface",
          "plugin-file-hash-inventory-surface",
          "network-allowed-themes-sitemeta-surface",
          "site-allowed-themes-option-surface",
          "stylesheet-template-option-surface",
          "theme-file-hash-inventory-surface"
        ],
        "countKeys": [
          "pluginSurfaceCount",
          "themeSurfaceCount"
        ],
        "hash": "7ec4a20b2da1d8e4c6cd60fe238ad0831dd0508f41ede4b529fee8dee3bb46e1"
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
        "hash": "0be27548b5f410feac8a260d5802e30219e40bdbc6dcf525ce5862478ffba2e4"
      }
    ],
    "surfaceEvidenceHash": "04924ad436d375af32b7f82f5d85c283040ff8712dae41103d92145c624157ba",
    "candidateClaims": [
      "candidate-shape-recorded",
      "source-local-changed-host-role-surfaces-recorded",
      "network-site-plugin-theme-count-surfaces-recorded",
      "focused-regression-gap-boundary-recorded",
      "release-verifier-boundary-carried-through",
      "candidate-versus-release-ready-scope-recorded",
      "hash-count-surface-only-evidence"
    ],
    "importExportBlockers": [
      "no-production-bound-multisite-export",
      "no-production-bound-multisite-import",
      "no-authenticated-production-export-session",
      "no-authenticated-production-import-session",
      "no-live-subdomain-resolution-readback",
      "no-live-network-constant-readback",
      "no-network-site-count-runtime-readback",
      "no-plugin-theme-runtime-readback",
      "no-cross-blog-mutation-precondition-run",
      "no-release-verifier-accepted-production-topology"
    ],
    "releaseReadyGaps": [
      "production-bound-multisite-export",
      "production-bound-multisite-import",
      "auth-session-lifecycle-release-verifier-acceptance",
      "durable-journal-restart-replay-proof",
      "live-source-local-changed-host-role-readback",
      "live-subdomain-resolution-proof",
      "live-network-constant-readback",
      "network-and-site-count-runtime-readback",
      "plugin-theme-runtime-surface-readback",
      "cross-blog-table-mutation-precondition-proof",
      "production-topology-release-verifier-acceptance",
      "redacted-release-artifact-bundle",
      "release-verifier-accepted-import-export-run"
    ],
    "excludedFromCandidate": [
      "production-bound-multisite-import-export",
      "production-auth-session-lifecycle-proof",
      "durable-journal-restart-replay-proof",
      "live-subdomain-dns-or-host-reachability",
      "wp-config-network-constant-readback",
      "plugin-theme-runtime-activation-readback",
      "per-site-route-receipts",
      "cross-blog-table-mutation-proof",
      "network-admin-capability-proof",
      "production-topology-release-verifier-proof",
      "release-verifier-artifact-bundle"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-multisite-subdomain-import-export",
      "source-local-remote-changed-host-roles-read-back-from-live-wordpress",
      "subdomain-install-constants-read-back-from-live-wordpress",
      "network-and-site-counts-read-back-from-live-wordpress",
      "network-root-and-child-subdomain-siteurl-home-hash-count-checked",
      "plugin-theme-network-and-site-surfaces-hash-count-checked",
      "per-site-prefix-table-routing-and-cross-blog-mutation-preconditions-proven",
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
      "candidate-does-not-run-production-import-export",
      "candidate-does-not-carry-accepted-auth-session-lifecycle-proof",
      "candidate-does-not-prove-durable-journal-restart-replay",
      "candidate-does-not-prove-live-subdomain-resolution",
      "candidate-does-not-read-back-wordpress-network-constants",
      "candidate-does-not-read-live-network-site-counts",
      "candidate-does-not-read-live-plugin-theme-surfaces",
      "candidate-does-not-prove-per-site-route-receipts",
      "candidate-does-not-prove-cross-blog-mutation-safety",
      "candidate-does-not-have-production-topology-release-verifier-acceptance",
      "release-artifact-bundle-not-present"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawHostValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "rawReleaseArtifactsIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "productionImportExportEvidence",
      "productionTopologyEvidence",
      "releaseVerifierCarryThrough",
      "operationGuards",
      "finalReleaseStatus",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "5530b5ee7dc0156874b90c675aea53451f0301a997379a50d57c84ec302ee04c"
}
```

## Candidate Scope

The candidate is limited to a deterministic multisite subdomain topology
inventory. It records source, local edited, and remote changed host roles as
hashes only, with one expected network and two expected sites per role. It also
records network table surfaces, representative site-scoped table surfaces,
configuration constant names, plugin and theme inventory surfaces, focused
regression gap surfaces, the release-verifier carry-through boundary, and no-go
release-gate surfaces.

The artifact stores only table names, surface names, constant names, booleans,
counts, identity hashes, gap labels, surface hashes, and comparison hashes. It
does not store raw hostnames, raw URLs, option row payloads, plugin payloads,
theme payloads, credentials, route receipts, or live WordPress service
configuration.

The candidate does not prove production import/export, live subdomain
resolution, live network constant readback, live network and site count
readback, live plugin/theme readback, auth/session lifecycle, durable journal
restart replay, release artifacts, or release verifier acceptance. It records
only that the multisite subdomain release-verifier boundary remains candidate
scope until production-backed verifier evidence is present.

## Release-Ready Scope

Release-ready multisite subdomain evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove the live source, local edited, and remote changed
host roles; read back live network constants; verify network and site counts;
check root and child site URL, plugin, and theme surfaces by hash and count
only; pass auth/session lifecycle gates; prove durable journal restart replay
and recovery inspection; prove per-site table routing and cross-blog mutation
preconditions; provide redacted release artifacts; and pass artifact scanning.

## Integration Recommendation

Final release status: **NO-GO**.

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark multisite subdomain topology release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0890-multisite-subdomain-topology-v5.test.js
node --test --test-name-pattern RPP-0890 test/rpp-0890-multisite-subdomain-topology-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0890-multisite-subdomain-topology-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0890-multisite-subdomain-topology-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0890 test/rpp-0890-multisite-subdomain-topology-v5.test.js`: exit 0
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
