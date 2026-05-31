# RPP-0805 WooCommerce Product Catalog Variant 1

Date: 2026-06-01

## Scope

RPP-0805 records the WooCommerce product catalog candidate shape against the
release-ready scope. This is support evidence only. The repository contains an
attempted full Brewcommerce/WooCommerce import, but that run failed closed with
`PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` and is not accepted release
evidence.

This variant does not update checklist or progress-page surfaces. It gives the
integrator a deterministic progress-report artifact that says what the current
candidate covers and what remains required before any release-ready claim.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0805",
  "variant": 1,
  "title": "WooCommerce product catalog candidate scope",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
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
    "status": "catalog-candidate",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-playground-brewcommerce-derived-seed",
    "catalogShape": {
      "catalogSurface": "woocommerce-product-catalog",
      "productRows": [
        "wp_posts:product"
      ],
      "postmetaFamilies": [
        "_sku",
        "_regular_price",
        "_price",
        "_stock_status",
        "_manage_stock",
        "_stock"
      ],
      "optionFamilies": [
        "reprint_push_brewcommerce_fixture"
      ],
      "catalogMutationsProven": false,
      "rawCatalogValuesIncluded": false
    },
    "candidateClaims": [
      "candidate-shape-recorded",
      "source-pattern-linked-to-existing-local-proof",
      "hash-count-surface-only-evidence"
    ],
    "excludedFromCandidate": [
      "product-variation-import-export-proof",
      "product-attribute-taxonomy-import-export-proof",
      "product-image-gallery-import-export-proof",
      "woocommerce-plugin-lifecycle-proof",
      "hpos-order-table-mutation-proof"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-import-export",
      "woocommerce-plugin-installed-active-and-version-recorded",
      "woocommerce-product-catalog-import-export-survives-release-verifier",
      "sku-price-stock-status-visibility-taxonomy-attribute-variation-image-surfaces-hash-count-checked",
      "auth-session-and-durable-journal-accepted-release-verifier",
      "hpos-and-order-surfaces-explicitly-refused-outside-catalog",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "no-accepted-production-bound-woocommerce-import-export",
      "full-brewcommerce-woocommerce-import-attempt-failed-closed",
      "catalog-candidate-does-not-prove-woocommerce-plugin-semantics",
      "catalog-candidate-does-not-prove-hpos-or-order-safety"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawCatalogValuesIncluded": false,
    "urlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "fd86a4f41ba09fa3c7900cbc541238431c7437344aeff696152685fb7dfaf3aa"
}
```

## Candidate Scope

The candidate shape is limited to the product-catalog surfaces already implied
by the local Brewcommerce-derived seed path: a `product` post row, SKU/pricing
and stock-oriented product metadata families, and a catalog fixture option
family. The artifact records only names, booleans, counts, and the comparison
hash. It does not include raw SKU, price, stock, product title, product body, or
operator credential material.

The candidate does not prove that catalog mutations survive WooCommerce import
and export, nor does it prove WooCommerce plugin lifecycle, variation,
attribute, gallery, visibility, HPOS, Action Scheduler, or order safety
semantics.

## Release-Ready Scope

Release-ready catalog evidence still requires a production-bound WordPress
import/export run with WooCommerce installed and active, accepted by the release
verifier through the same auth/session and durable-journal gates used by the
production topology. The release report must prove catalog surfaces by hash and
count only, explicitly refuse HPOS/order surfaces outside the catalog slice, and
pass artifact redaction scanning.

## Integration Recommendation

Record as candidate-only progress evidence. Do not move final release readiness
or mark the WooCommerce product catalog release-ready from this variant.
