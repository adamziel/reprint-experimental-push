# RPP-0865 WooCommerce Product Catalog Variant 4

Date: 2026-06-01

## Scope

RPP-0865 records a fourth WooCommerce product catalog candidate shape against
the release-ready scope. This is deterministic local support evidence only. It
follows the RPP-0845 candidate-scope pattern, uses the RPP-0846 order-safety
refusal boundary, and expands the local catalog inventory to product,
variation, media, taxonomy, lookup, stock, catalog-option, and count surfaces
without storing raw product, SKU, price, body, media URL, option payload, stock
value, or credential material.

This variant does not call WordPress routes, does not use live WooCommerce, does
not perform import/export, does not update progress surfaces, and does not move
release gates. It gives the integrator a hash/count/surface-only progress-report
artifact that separates the current candidate from the evidence still required
before any release-ready WooCommerce catalog claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0865",
  "variant": 4,
  "title": "WooCommerce product catalog candidate scope v4",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "candidateScopePattern": {
      "rppId": "RPP-0845",
      "variant": 3,
      "recordsCandidateVersusReleaseReadyScope": true,
      "releaseGateMovement": "none"
    },
    "previousCandidateScopePattern": {
      "rppId": "RPP-0825",
      "variant": 2,
      "recordsCandidateVersusReleaseReadyScope": true,
      "releaseGateMovement": "none"
    },
    "orderSafetyBoundary": {
      "rppId": "RPP-0846",
      "variant": 3,
      "hposOrderSurfacesRefusedOutsideCatalog": true,
      "orderMutationDriverPresent": false
    }
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "observedAttempt": "not-performed-in-rpp-0865",
    "blockedReasonCode": "PRODUCTION_BOUND_IMPORT_EXPORT_AUTH_JOURNAL_REQUIRED"
  },
  "operationGuards": {
    "liveWooCommerceUsed": false,
    "wordpressRoutesCalled": false,
    "importExportPerformed": false,
    "releaseGatesMoved": false,
    "progressSurfacesModified": false
  },
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "candidateScope": {
    "status": "catalog-candidate-v4",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "deterministic-local-woocommerce-catalog-surface-model-v4",
    "catalogShape": {
      "catalogSurface": "woocommerce-product-catalog",
      "woocommerceRuntimeObserved": false,
      "wordpressRoutesCalled": false,
      "importExportPerformed": false,
      "productRows": [
        "wp_posts:product"
      ],
      "variationRows": [
        "wp_posts:product_variation"
      ],
      "mediaRows": [
        "wp_posts:attachment"
      ],
      "lookupRows": [
        "wp_wc_product_meta_lookup",
        "wp_wc_product_attributes_lookup"
      ],
      "stockSurfaces": [
        "wp_postmeta:stock-meta",
        "wp_wc_product_meta_lookup:stock-columns"
      ],
      "countSurfaces": [
        "catalog-surface-count-summary"
      ],
      "postmetaFamilies": [
        "_sku",
        "_regular_price",
        "_sale_price",
        "_price",
        "_stock_status",
        "_manage_stock",
        "_stock",
        "_backorders",
        "_low_stock_amount",
        "_visibility",
        "_virtual",
        "_downloadable",
        "_tax_status",
        "_tax_class",
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
        "_backorders",
        "_low_stock_amount",
        "attribute_pa_color",
        "attribute_pa_roast",
        "attribute_pa_size",
        "attribute_pa_material"
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
        "pa_color",
        "pa_roast",
        "pa_size",
        "pa_material"
      ],
      "taxonomyTables": [
        "wp_terms",
        "wp_term_taxonomy",
        "wp_term_relationships",
        "wp_termmeta"
      ],
      "lookupTables": [
        "wp_wc_product_meta_lookup",
        "wp_wc_product_attributes_lookup"
      ],
      "lookupColumnFamilies": [
        "product_identity",
        "price_bounds",
        "visibility_flags",
        "stock_columns",
        "attribute_taxonomy_rows",
        "rating_columns"
      ],
      "stockMetaFamilies": [
        "_stock_status",
        "_manage_stock",
        "_stock",
        "_backorders",
        "_low_stock_amount"
      ],
      "optionFamilies": [
        "woocommerce_catalog_settings",
        "woocommerce_attribute_taxonomies",
        "woocommerce_product_visibility_options",
        "reprint_push_brewcommerce_fixture"
      ],
      "catalogMutationsProven": false,
      "rawCatalogValuesIncluded": false,
      "rawMediaUrlsIncluded": false
    },
    "countEvidence": {
      "productRows": 4,
      "variationRows": 8,
      "attachmentRows": 6,
      "productPostmetaRows": 64,
      "variationPostmetaRows": 104,
      "mediaReferenceRows": 12,
      "taxonomyNames": 8,
      "termRows": 22,
      "termTaxonomyRows": 22,
      "termRelationshipRows": 52,
      "termmetaRows": 12,
      "lookupTables": 2,
      "productMetaLookupRows": 12,
      "productAttributesLookupRows": 18,
      "stockMetaRows": 24,
      "stockLookupRows": 12,
      "optionRows": 4,
      "countSurfaceRows": 1,
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
        "surface": "lookup",
        "tables": [
          "wp_wc_product_meta_lookup",
          "wp_wc_product_attributes_lookup"
        ],
        "countKeys": [
          "lookupTables",
          "productMetaLookupRows",
          "productAttributesLookupRows"
        ],
        "hash": "98ce7949c124297308d80ec6d4a2512eeec494052dd96aaf4709824c024f85a0"
      },
      {
        "surface": "stock",
        "tables": [
          "wp_postmeta",
          "wp_wc_product_meta_lookup"
        ],
        "countKeys": [
          "stockMetaRows",
          "stockLookupRows"
        ],
        "hash": "500fb46f1be42db1ccead8f98186eaf8b520034fcba52328ac6d6c16c2ec3d1a"
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
      },
      {
        "surface": "count",
        "tables": [
          "catalog-surface-count-summary"
        ],
        "countKeys": [
          "productRows",
          "variationRows",
          "attachmentRows",
          "taxonomyNames",
          "lookupTables",
          "stockMetaRows",
          "optionRows",
          "countSurfaceRows",
          "orderRows",
          "hposRows"
        ],
        "hash": "6c46db2bf21c5766107648a52a4e4315dbe68bd16ba33bdf58db1ebbc9dbeb21"
      }
    ],
    "surfaceEvidenceHash": "6051e302efbedf78ec3a877aa20ce2eaa83d609c5adf805608ddd8343db7c403",
    "candidateClaims": [
      "candidate-shape-recorded",
      "product-variation-media-taxonomy-lookup-stock-catalog-option-count-surfaces-inventoried",
      "catalog-count-evidence-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-woocommerce-import-export",
      "woocommerce-plugin-runtime-import-export-semantics",
      "live-auth-session-lifecycle-proof",
      "durable-journal-release-replay-proof",
      "hpos-order-table-mutation-proof",
      "order-safety-release-proof",
      "redacted-release-artifact-bundle"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-woocommerce-import-export",
      "woocommerce-plugin-installed-active-version-and-schema-readback",
      "product-variation-media-taxonomy-lookup-stock-catalog-option-count-import-export-survives-release-verifier",
      "auth-session-lifecycle-accepted-by-release-verifier",
      "durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier",
      "hpos-and-order-surfaces-explicitly-refused-outside-catalog",
      "order-safety-release-proof-accepted-by-release-verifier",
      "redacted-release-artifact-bundle-passes-artifact-redaction-scan"
    ],
    "gaps": {
      "productionBoundWooCommerceImportExport": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "hposOrderSafety": "support-only-refusal-not-catalog-release-proof",
      "orderSafetyReleaseProof": "missing",
      "redactedReleaseArtifacts": "missing"
    },
    "blockers": [
      "no-accepted-production-bound-woocommerce-import-export",
      "catalog-candidate-does-not-prove-woocommerce-plugin-runtime-semantics",
      "lookup-stock-catalog-option-count-surfaces-not-proven-by-production-release-verifier",
      "auth-session-lifecycle-not-accepted-by-release-verifier",
      "durable-journal-not-proven-for-catalog-release",
      "hpos-order-safety-only-recorded-as-refusal-boundary",
      "order-safety-release-proof-not-present",
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
      "finalReleaseStatus",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "b184f167e8a250328b4b9b1dda3056931ce67430c5b6c5186975d4887daf5d14"
}
```

## Candidate Scope

The candidate is limited to a deterministic local catalog surface inventory. It
records product rows, variation rows, attachment rows, product and variation
metadata families, media reference metadata families, WooCommerce taxonomy
surfaces, lookup table families, stock metadata and lookup surfaces, catalog
option families, count summary surfaces, and count evidence.

The artifact stores only table names, post type names, metadata family names,
taxonomy names, option family names, count surface names, counts, surface
hashes, and comparison hashes. It does not store raw product titles, SKU
strings, prices, stock values, body text, media URLs, option payloads, auth
material, or release artifacts.

The candidate does not prove WooCommerce runtime import/export semantics. It
does not prove that products, variations, media references, taxonomy
relationships, lookup rows, stock rows, catalog options, or count summaries
survive a production-bound release verifier run. The HPOS and order counts are
intentionally zero because order surfaces remain outside this product-catalog
slice.

## Release-Ready Scope

Release-ready WooCommerce catalog evidence still requires a production-bound
WordPress import/export run with WooCommerce installed and active, accepted by
the release verifier. The release report must prove product, variation, media,
taxonomy, lookup, stock, catalog option, and count surfaces by hash and count
only; pass the auth/session lifecycle and durable journal gates; explicitly
refuse HPOS/order surfaces outside the catalog slice; include accepted
order-safety release proof; and provide redacted release artifacts that pass
artifact scanning.

## Integration Recommendation

Final release status: **NO-GO**.

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark the WooCommerce product catalog release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0865-woocommerce-product-catalog-v4.test.js
node --test test/rpp-0865-woocommerce-product-catalog-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0865-woocommerce-product-catalog-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0865-woocommerce-product-catalog-v4.test.js`: exit 0
- `node --test test/rpp-0865-woocommerce-product-catalog-v4.test.js`: exit 0
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
