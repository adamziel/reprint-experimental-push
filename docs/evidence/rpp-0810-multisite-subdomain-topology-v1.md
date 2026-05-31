# RPP-0810 Multisite Subdomain Topology Variant 1

Date: 2026-06-01

## Scope

RPP-0810 records the multisite subdomain topology candidate shape against the
release-ready scope. This is deterministic support evidence only. It reuses the
RPP-0803 source, local edited, and remote changed URL identity contract and the
RPP-0808 hash-only role identity pattern, but it does not contact external
WordPress hosts, resolve live subdomains, read production network constants, or
move release gates.

This variant does not update checklist or progress-page surfaces. It gives the
integrator a progress-report artifact that separates the current candidate from
the evidence still required before any release-ready claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0810",
  "variant": 1,
  "title": "Multisite subdomain topology candidate scope",
  "status": "passed-support-only",
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
    "status": "multisite-subdomain-topology-candidate",
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
      "roleIdentityHashesOnly": true,
      "roleIdentityHashes": {
        "source": "a03b39ce13cc00be53f59a846d177b3be50cf10dd56024c5b6defedac9b95ed6",
        "localEdited": "98b9eb592f6af11693d75d202b1dd08a4f4e1fc5dd6dc5257c8dc62e1447c5da",
        "remoteChanged": "b618714e08f14b3a42ef69ae4c10350c700cd84b01999bdaba1f7ed7dc70fc00"
      },
      "roleIdentitiesDistinct": true,
      "sourceAliasAndRouteSourceIdentitiesMatch": true,
      "networkProbePerformed": false,
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
      "wp_2_options",
      "wp_2_posts"
    ],
    "configurationSurface": [
      "SUBDOMAIN_INSTALL",
      "DOMAIN_CURRENT_SITE",
      "PATH_CURRENT_SITE",
      "SITE_ID_CURRENT_SITE",
      "BLOG_ID_CURRENT_SITE",
      "sunrise-domain-mapping-policy"
    ],
    "candidateClaims": [
      "subdomain-network-shape-recorded",
      "source-local-changed-url-identity-contract-reused",
      "network-table-surface-inventory-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-multisite-import-export",
      "live-subdomain-dns-or-host-reachability",
      "wp-config-network-constant-readback",
      "sunrise-domain-mapping-runtime-proof",
      "per-site-route-receipts",
      "cross-blog-table-mutation-proof",
      "network-admin-authorization-proof"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-multisite-import-export",
      "subdomain-install-constants-read-back-from-live-wordpress",
      "source-local-remote-changed-identities-distinct-and-same-source-route-checked",
      "network-root-and-child-subdomain-siteurl-home-hash-count-checked",
      "wp_site-wp_blogs-wp_sitemeta-wp_blogmeta-wp_blog_versions-registration_log-surfaces-hash-count-checked",
      "per-site-prefix-table-routing-and-cross-blog-mutation-preconditions-proven",
      "dns-host-mapping-and-sunrise-policy-recorded-without-raw-host-values",
      "auth-lifecycle-and-durable-journal-accepted-by-release-verifier",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "no-accepted-production-bound-multisite-import-export",
      "candidate-does-not-prove-live-subdomain-resolution",
      "candidate-does-not-read-back-wordpress-network-constants",
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
  "scopeComparisonHash": "526bf593f009c46324a168b2f436db71cee62f74c694c87c74f2c3837110af82"
}
```

## Candidate Scope

The candidate is limited to a static multisite subdomain topology inventory. It
records that the source, local edited, and remote changed role identities follow
the existing external WordPress identity contract, and that the topology surface
is a subdomain multisite shape with network tables, representative per-blog
tables, and network constants named.

The artifact stores only table names, constant names, booleans, counts implied
by array membership, identity hashes, and the comparison hash. It does not store
raw hostnames, raw URLs, option row payloads, credentials, route receipts, or
live WordPress service configuration.

## Release-Ready Scope

Release-ready multisite subdomain evidence still requires a production-bound
WordPress multisite import/export run accepted by the release verifier. The
release report must prove the live subdomain addressing mode, read back the
network constants from the target WordPress runtime, verify source/local/remote
changed route identities, check root and child site URL surfaces by hash and
count only, prove per-site table routing and cross-blog mutation preconditions,
and pass artifact redaction scanning.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark multisite subdomain topology release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0810-multisite-subdomain-topology-v1.test.js
node --test --test-name-pattern RPP-0810 test/rpp-0810-multisite-subdomain-topology-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0810-multisite-subdomain-topology-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0810-multisite-subdomain-topology-v1.test.js`: exit 0
- RPP-0810 focused proof test: passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
