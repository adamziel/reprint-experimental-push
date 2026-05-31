# RPP-0830 Multisite Subdomain Topology Variant 2

Date: 2026-06-01

## Scope

RPP-0830 records the multisite subdomain topology candidate shape against the
release-ready scope. This is deterministic support evidence only. It follows
the RPP-0810 candidate-scope pattern and adds variant-2 host-role, count,
plugin surface, theme surface, import/export blocker, and release-ready gap
records.

This variant does not update checklist or progress-page surfaces. It gives the
integrator a progress-report artifact that separates the current candidate from
the evidence still required before any release-ready claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0830",
  "variant": 2,
  "title": "Multisite subdomain topology candidate scope",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "builtOn": {
    "candidateScopePattern": {
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
  "candidateScope": {
    "status": "multisite-subdomain-topology-candidate-v2",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-static-external-wordpress-topology-derived",
    "topologyShape": {
      "installMode": "multisite",
      "addressingMode": "subdomain",
      "subdirectoryModeExcluded": true,
      "sourceLocalChangedRoleIdentitiesCaptured": true,
      "hostIdentityHashesOnly": true,
      "networkProbePerformed": false,
      "sandboxIngressPort": 8080,
      "remoteTunnelsAllowed": false
    },
    "hostRoleSurfaces": [
      {
        "role": "source",
        "hostRole": "source-subdomain-network",
        "hostIdentityHash": "e82a9d99bc806f7cafc227bab251081f2dba07ee278e0efc7adabcc661718885",
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
        "hostIdentityHash": "c9b2be04910a87256e0fd40b34fdee05fa9b49877688128925974e552fabf44f",
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
        "hostIdentityHash": "489da91aa23098c5259d7d792a9578d869cd9f4548a905479aac8f368b834250",
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
    "counts": {
      "hostRoleCount": 3,
      "networkCountPerHostRole": 1,
      "siteCountPerHostRole": 2,
      "totalNetworkCount": 3,
      "totalSiteCount": 6,
      "networkTableSurfaceCount": 6,
      "siteScopedTableSurfaceCount": 8,
      "pluginSurfaceCount": 4,
      "themeSurfaceCount": 4,
      "importExportBlockerCount": 6,
      "releaseReadyGapCount": 7,
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
    "candidateClaims": [
      "subdomain-network-shape-recorded",
      "source-local-changed-host-role-surfaces-recorded",
      "network-and-site-counts-recorded",
      "plugin-theme-surface-inventory-recorded",
      "hash-count-surface-only-evidence"
    ],
    "importExportBlockers": [
      "no-production-bound-multisite-export",
      "no-production-bound-multisite-import",
      "no-live-subdomain-resolution-readback",
      "no-network-site-count-runtime-readback",
      "no-plugin-theme-runtime-readback",
      "no-cross-blog-mutation-precondition-run"
    ],
    "releaseReadyGaps": [
      "live-source-local-changed-host-role-readback",
      "live-subdomain-resolution-proof",
      "live-network-constant-readback",
      "network-and-site-count-runtime-readback",
      "plugin-theme-runtime-surface-readback",
      "cross-blog-table-mutation-precondition-proof",
      "release-verifier-accepted-import-export-run"
    ],
    "excludedFromCandidate": [
      "production-bound-multisite-import-export",
      "live-subdomain-dns-or-host-reachability",
      "wp-config-network-constant-readback",
      "plugin-theme-runtime-activation-readback",
      "per-site-route-receipts",
      "cross-blog-table-mutation-proof",
      "network-admin-capability-proof"
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
      "auth-lifecycle-and-durable-journal-accepted-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "candidate-does-not-run-production-import-export",
      "candidate-does-not-prove-live-subdomain-resolution",
      "candidate-does-not-read-back-wordpress-network-constants",
      "candidate-does-not-read-live-network-site-counts",
      "candidate-does-not-read-live-plugin-theme-surfaces",
      "candidate-does-not-prove-per-site-route-receipts",
      "candidate-does-not-prove-cross-blog-mutation-safety"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawHostValuesIncluded": false,
    "rawUrlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "5fc4ee9ef35f3d5d4402996957e7ced66cd2085e6a8d5cf11b43c098283437d1"
}
```

## Candidate Scope

The candidate is limited to a static multisite subdomain topology inventory. It
records the source, local edited, and remote changed host roles as hashes only,
with one expected network and two expected sites per role. It records the
network table surface, representative site-scoped table surface, plugin
surface, theme surface, and the import/export blockers that keep this support
artifact out of release-ready scope.

The artifact stores only table names, surface names, constant names, booleans,
counts, identity hashes, and the comparison hash. It does not store raw
hostnames, raw URLs, option row payloads, plugin payloads, theme payloads,
credentials, route receipts, or live WordPress service configuration.

## Release-Ready Scope

Release-ready multisite subdomain evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove the live source, local edited, and remote changed
host roles; read back the live network constants; verify network and site
counts; check root and child site URL, plugin, and theme surfaces by hash and
count only; prove per-site table routing and cross-blog mutation preconditions;
and pass artifact redaction scanning.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark multisite subdomain topology release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0830-multisite-subdomain-topology-v2.test.js
node --test --test-name-pattern RPP-0830 test/rpp-0830-multisite-subdomain-topology-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0830-multisite-subdomain-topology-v2.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0830-multisite-subdomain-topology-v2.test.js`: exit 0
- RPP-0830 focused proof test: passed, 3 tests
- Evidence redaction scan: `ok: true`, 0 rejected files, 4 allowed hash evidence entries
- Diff whitespace check: clean
