# RPP-0885 WooCommerce Product Catalog Variant 5

Date: 2026-06-01

## Scope

RPP-0885 records a fifth WooCommerce product catalog candidate shape against
the release-ready scope. This is deterministic local support evidence only. It
follows the RPP-0865 candidate-scope pattern, uses the RPP-0866 order-safety
refusal boundary, and expands the local catalog inventory to product,
variation, media, taxonomy, lookup, stock, dimension, catalog-option, and count
surfaces without storing raw product, SKU, price, body, media URL, option
payload, stock value, dimension value, or credential material.

This variant does not call WordPress routes, does not use live WooCommerce, does
not perform import/export, does not start production topology sites, does not
update progress surfaces, and does not move release gates. It gives the
integrator a hash/count/surface-only progress-report artifact that separates the
current candidate from the evidence still required before any release-ready
WooCommerce catalog claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0885",
  "variant": 5,
  "title": "WooCommerce product catalog candidate scope v5",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "candidateScopePattern": {
      "rppId": "RPP-0865",
      "variant": 4,
      "recordsCandidateVersusReleaseReadyScope": true,
      "releaseGateMovement": "none"
    },
    "previousCandidateScopePattern": {
      "rppId": "RPP-0845",
      "variant": 3,
      "recordsCandidateVersusReleaseReadyScope": true,
      "releaseGateMovement": "none"
    },
    "orderSafetyBoundary": {
      "rppId": "RPP-0866",
      "variant": 4,
      "hposOrderSurfacesRefusedOutsideCatalog": true,
      "orderMutationDriverPresent": false
    }
  },
  "productionImportExportEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "observedAttempt": "not-performed-in-rpp-0885",
    "blockedReasonCode": "PRODUCTION_BOUND_IMPORT_EXPORT_AUTH_JOURNAL_REQUIRED"
  },
  "productionTopologyEvidence": {
    "present": false,
    "acceptedReleaseEvidence": false,
    "sitesStarted": false,
    "releaseGateAccepted": false,
    "observedAttempt": "not-performed-in-rpp-0885",
    "blockedReasonCode": "PRODUCTION_TOPOLOGY_RELEASE_VERIFIER_REQUIRED"
  },
  "operationGuards": {
    "liveWooCommerceUsed": false,
    "wordpressRoutesCalled": false,
    "importExportPerformed": false,
    "productionTopologyStarted": false,
    "releaseVerifierAccepted": false,
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
    "status": "catalog-candidate-v5",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "deterministic-local-woocommerce-catalog-surface-model-v5",
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
      "dimensionSurfaces": [
        "wp_postmeta:dimension-meta"
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
        "_weight",
        "_length",
        "_width",
        "_height",
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
        "_weight",
        "_length",
        "_width",
        "_height",
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
        "pa_material",
        "product_shipping_class"
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
      "dimensionMetaFamilies": [
        "_weight",
        "_length",
        "_width",
        "_height"
      ],
      "optionFamilies": [
        "woocommerce_catalog_settings",
        "woocommerce_attribute_taxonomies",
        "woocommerce_product_visibility_options",
        "reprint_push_brewcommerce_fixture",
        "woocommerce_product_dimension_unit"
      ],
      "catalogMutationsProven": false,
      "rawCatalogValuesIncluded": false,
      "rawMediaUrlsIncluded": false
    },
    "countEvidence": {
      "productRows": 5,
      "variationRows": 10,
      "attachmentRows": 8,
      "productPostmetaRows": 95,
      "variationPostmetaRows": 150,
      "mediaReferenceRows": 16,
      "taxonomyNames": 9,
      "termRows": 28,
      "termTaxonomyRows": 28,
      "termRelationshipRows": 73,
      "termmetaRows": 16,
      "lookupTables": 2,
      "productMetaLookupRows": 15,
      "productAttributesLookupRows": 25,
      "stockMetaRows": 30,
      "stockLookupRows": 15,
      "dimensionMetaRows": 60,
      "optionRows": 5,
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
        "surface": "dimensions",
        "tables": [
          "wp_postmeta"
        ],
        "countKeys": [
          "dimensionMetaRows"
        ],
        "hash": "d9c6748e5606a5a7de7241c9db26f46ea795cd4a4d50c6c911ab0113ff81bf86"
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
          "dimensionMetaRows",
          "optionRows",
          "countSurfaceRows",
          "orderRows",
          "hposRows"
        ],
        "hash": "b7f8c01121455e3be0b28db462caa133e66d17e8315cb744bc4854ee7186f455"
      }
    ],
    "surfaceEvidenceHash": "2a37602e640112ddd40fdcd78edfd2586086e94e4e821c62556d3f311e429ac8",
    "candidateClaims": [
      "candidate-shape-recorded",
      "product-variation-media-taxonomy-lookup-stock-dimension-catalog-option-count-surfaces-inventoried",
      "catalog-count-evidence-recorded",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "production-bound-woocommerce-import-export",
      "production-topology-release-verifier",
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
      "production-topology-release-verifier-accepted-with-sites-started",
      "woocommerce-plugin-installed-active-version-and-schema-readback",
      "product-variation-media-taxonomy-lookup-stock-dimension-catalog-option-count-import-export-survives-release-verifier",
      "auth-session-lifecycle-accepted-by-release-verifier",
      "durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier",
      "hpos-and-order-surfaces-explicitly-refused-outside-catalog",
      "order-safety-release-proof-accepted-by-release-verifier",
      "redacted-release-artifact-bundle-passes-artifact-redaction-scan"
    ],
    "gaps": {
      "productionBoundWooCommerceImportExport": "missing",
      "productionTopologyReleaseVerifier": "missing",
      "authSessionLifecycle": "missing",
      "durableJournal": "missing",
      "hposOrderSafety": "support-only-refusal-not-catalog-release-proof",
      "orderSafetyReleaseProof": "missing",
      "redactedReleaseArtifacts": "missing"
    },
    "blockers": [
      "no-accepted-production-bound-woocommerce-import-export",
      "production-topology-release-verifier-not-accepted",
      "catalog-candidate-does-not-prove-woocommerce-plugin-runtime-semantics",
      "lookup-stock-dimension-catalog-option-count-surfaces-not-proven-by-production-release-verifier",
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
  "scopeComparisonHash": "afda7be51c115e8d2e6a0b4ab42b6a93184d8c39188b10ea85f673e4f199b1d3"
}
```

## Candidate Scope

The candidate is limited to a deterministic local catalog surface inventory. It
records product rows, variation rows, attachment rows, product and variation
metadata families, media reference metadata families, WooCommerce taxonomy
surfaces, lookup table families, stock metadata and lookup surfaces, dimension
metadata surfaces, catalog option families, count summary surfaces, and count
evidence.

The artifact stores only table names, post type names, metadata family names,
taxonomy names, option family names, count surface names, counts, surface
hashes, and comparison hashes. It does not store raw product titles, SKU
strings, prices, stock values, body text, media URLs, option payloads, auth
material, dimension values, or release artifacts.

The candidate does not prove WooCommerce runtime import/export semantics. It
does not prove that products, variations, media references, taxonomy
relationships, lookup rows, stock rows, dimension rows, catalog options, or
count summaries survive a production-bound release verifier run. It also does
not start or satisfy the production-topology release verifier. The HPOS and
order counts are intentionally zero because order surfaces remain outside this
product-catalog slice.

## Release-Ready Scope

Release-ready WooCommerce catalog evidence still requires a production-bound
WordPress import/export run with WooCommerce installed and active, accepted by
the release verifier, plus a production-topology release verifier run with
sites started and accepted by the release gate. The release report must prove
product, variation, media, taxonomy, lookup, stock, dimension, catalog option,
and count surfaces by hash and count only; pass the auth/session lifecycle and
durable journal gates; explicitly refuse HPOS/order surfaces outside the
catalog slice; include accepted order-safety release proof; and provide
redacted release artifacts that pass artifact scanning.

## Integration Recommendation

Final release status: **NO-GO**.

Integration recommendation: **NO-GO**.

Record as candidate-only progress evidence. Do not move final release readiness
or mark the WooCommerce product catalog release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0885-woocommerce-product-catalog-v5.test.js
node --test --test-name-pattern RPP-0885 test/rpp-0885-woocommerce-product-catalog-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0885-woocommerce-product-catalog-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0885-woocommerce-product-catalog-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0885 test/rpp-0885-woocommerce-product-catalog-v5.test.js`: exit 0
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
