# RPP-0825 WooCommerce Product Catalog Variant 2

Date: 2026-06-01

## Scope

RPP-0825 records a second WooCommerce product catalog candidate shape against
the release-ready scope. This is deterministic support evidence only. It follows
the RPP-0805 candidate-scope pattern and expands the local catalog inventory to
product, variation, media, taxonomy, option, and count surfaces without storing
raw product, SKU, price, body, media URL, option payload, or credential
material.

This variant does not update checklist or progress-page surfaces. It gives the
integrator a hash/count/surface-only progress-report artifact that separates the
current candidate from the evidence still required before any release-ready
WooCommerce catalog claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0825",
  "variant": 2,
  "title": "WooCommerce product catalog candidate scope v2",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "candidateScopePattern": {
      "rppId": "RPP-0805",
      "variant": 1,
      "recordsCandidateVersusReleaseReadyScope": true,
      "releaseGateMovement": "none"
    },
    "orderSafetyBoundary": {
      "rppId": "RPP-0806",
      "variant": 1,
      "hposOrderSurfacesRefusedOutsideCatalog": true,
      "orderMutationDriverPresent": false
    }
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "observedAttempt": "full-brewcommerce-woocommerce-import-failed-closed",
    "blockedReasonCode": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "candidateScope": {
    "status": "catalog-candidate-v2",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "deterministic-local-woocommerce-catalog-surface-model",
    "catalogShape": {
      "catalogSurface": "woocommerce-product-catalog",
      "woocommerceRuntimeObserved": false,
      "productRows": [
        "wp_posts:product"
      ],
      "variationRows": [
        "wp_posts:product_variation"
      ],
      "mediaRows": [
        "wp_posts:attachment"
      ],
      "postmetaFamilies": [
        "_sku",
        "_regular_price",
        "_sale_price",
        "_price",
        "_stock_status",
        "_manage_stock",
        "_stock",
        "_visibility",
        "_thumbnail_id",
        "_product_image_gallery"
      ],
      "variationMetaFamilies": [
        "_sku",
        "_regular_price",
        "_sale_price",
        "_price",
        "_stock_status",
        "_manage_stock",
        "_stock",
        "attribute_pa_roast",
        "attribute_pa_size"
      ],
      "mediaReferenceFamilies": [
        "_thumbnail_id",
        "_product_image_gallery"
      ],
      "taxonomySurfaces": [
        "product_cat",
        "product_tag",
        "product_type",
        "product_visibility",
        "pa_roast",
        "pa_size"
      ],
      "taxonomyTables": [
        "wp_terms",
        "wp_term_taxonomy",
        "wp_term_relationships",
        "wp_termmeta"
      ],
      "optionFamilies": [
        "woocommerce_catalog_settings",
        "reprint_push_brewcommerce_fixture"
      ],
      "catalogMutationsProven": false,
      "rawCatalogValuesIncluded": false,
      "rawMediaUrlsIncluded": false
    },
    "countEvidence": {
      "productRows": 2,
      "variationRows": 3,
      "attachmentRows": 2,
      "productPostmetaRows": 18,
      "variationPostmetaRows": 15,
      "mediaReferenceRows": 4,
      "taxonomyNames": 6,
      "termRows": 12,
      "termTaxonomyRows": 12,
      "termRelationshipRows": 17,
      "termmetaRows": 4,
      "optionRows": 2,
      "orderRows": 0,
      "hposRows": 0
    },
    "surfaceEvidence": [
      {
        "surface": "product",
        "tables": [
          "wp_posts",
          "wp_postmeta"
        ],
        "countKeys": [
          "productRows",
          "productPostmetaRows"
        ],
        "hash": "a00b0dee7dacda8bf5b80e1e82038c93fdd7fbc84b85aaf738f2c4490a20c31b"
      },
      {
        "surface": "variation",
        "tables": [
          "wp_posts",
          "wp_postmeta"
        ],
        "countKeys": [
          "variationRows",
          "variationPostmetaRows"
        ],
        "hash": "e0822cc46ef46b7acc3cda716674d073bbe38bbcaa921e83ef42a3d715dc26f5"
      },
      {
        "surface": "media",
        "tables": [
          "wp_posts",
          "wp_postmeta"
        ],
        "countKeys": [
          "attachmentRows",
          "mediaReferenceRows"
        ],
        "hash": "19c89118fbc2668c742f678f08918411c3c5ae9b4bf812a2e3e9c0abde41aa1d"
      },
      {
        "surface": "taxonomy",
        "tables": [
          "wp_terms",
          "wp_term_taxonomy",
          "wp_term_relationships",
          "wp_termmeta"
        ],
        "countKeys": [
          "taxonomyNames",
          "termRows",
          "termTaxonomyRows",
          "termRelationshipRows",
          "termmetaRows"
        ],
        "hash": "813602f4569a1662231515a8c616accd82390aa0701af558a516371abaff65a5"
      },
      {
        "surface": "catalog-options",
        "tables": [
          "wp_options"
        ],
        "countKeys": [
          "optionRows"
        ],
        "hash": "24f6a6d1d57a24e482f6501d5bb73826208d88965e36be4f42aed8fe970a7a8d"
      }
    ],
    "surfaceEvidenceHash": "2d60e04c18fbc9425b72ce9ba8717be428fa3eab1f02bda7b973eafb5b7ba060",
    "candidateClaims": [
      "candidate-shape-recorded",
      "product-variation-media-taxonomy-surfaces-inventoried",
      "catalog-count-evidence-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-woocommerce-import-export",
      "woocommerce-plugin-runtime-import-export-semantics",
      "live-auth-session-lifecycle-proof",
      "durable-journal-release-replay-proof",
      "hpos-order-table-mutation-proof",
      "redacted-release-artifact-bundle"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-woocommerce-import-export",
      "woocommerce-plugin-installed-active-version-and-schema-readback",
      "product-variation-media-taxonomy-catalog-import-export-survives-release-verifier",
      "auth-session-lifecycle-accepted-by-release-verifier",
      "durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier",
      "hpos-and-order-surfaces-explicitly-refused-outside-catalog",
      "redacted-release-artifact-bundle-passes-artifact-redaction-scan"
    ],
    "gaps": {
      "productionBoundWooCommerceImportExport": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "hposOrderSafety": "support-only-refusal-not-catalog-release-proof",
      "redactedReleaseArtifacts": "missing"
    },
    "blockers": [
      "no-accepted-production-bound-woocommerce-import-export",
      "full-brewcommerce-woocommerce-import-attempt-failed-closed",
      "catalog-candidate-does-not-prove-woocommerce-plugin-runtime-semantics",
      "auth-session-lifecycle-not-accepted-by-release-verifier",
      "durable-journal-not-proven-for-catalog-release",
      "hpos-order-safety-only-recorded-as-refusal-boundary",
      "redacted-release-artifact-bundle-not-present"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawCatalogValuesIncluded": false,
    "rawMediaUrlsIncluded": false,
    "urlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "rawReleaseArtifactsIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "30358aad7d20ae4b835367b33ff7412e982491a01b351d9c86cc9324e97a0bcb"
}
```

## Candidate Scope

The candidate is limited to a deterministic local catalog surface inventory. It
records product rows, variation rows, attachment rows, product and variation
metadata families, media reference metadata families, WooCommerce taxonomy
surfaces, taxonomy table surfaces, catalog option families, and count evidence.

The artifact stores only table names, post type names, metadata family names,
taxonomy names, option family names, counts, surface hashes, and comparison
hashes. It does not store raw product titles, SKU strings, prices, stock values,
body text, media URLs, option payloads, auth material, or release artifacts.

The candidate does not prove WooCommerce runtime import/export semantics. It
does not prove that products, variations, media references, taxonomy
relationships, or catalog options survive a production-bound release verifier
run. The HPOS and order counts are intentionally zero because order surfaces
remain outside this product-catalog slice.

## Release-Ready Scope

Release-ready WooCommerce catalog evidence still requires a production-bound
WordPress import/export run with WooCommerce installed and active, accepted by
the release verifier. The release report must prove product, variation, media,
taxonomy, and catalog option surfaces by hash and count only; pass the
auth/session lifecycle and durable journal gates; explicitly refuse HPOS/order
surfaces outside the catalog slice; and provide redacted release artifacts that
pass artifact scanning.

## Integration Recommendation

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark the WooCommerce product catalog release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0825-woocommerce-product-catalog-v2.test.js
node --test test/rpp-0825-woocommerce-product-catalog-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0825-woocommerce-product-catalog-v2.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0825-woocommerce-product-catalog-v2.test.js`: exit 0
- `node --test test/rpp-0825-woocommerce-product-catalog-v2.test.js`: exit 0
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
