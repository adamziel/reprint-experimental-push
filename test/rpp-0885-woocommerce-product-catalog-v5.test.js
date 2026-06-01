import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0885-woocommerce-product-catalog-v5.md',
);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const rawCatalogNeedles = Object.freeze([
  'RPP-0885 Private Product',
  'RPP0885-PRIVATE-SKU',
  '71.00',
  'Variant 5 private catalog body',
  'variant-five-gallery.jpg',
  'private-product-title',
  'private-product-body',
  'private-stock-note',
  'private-catalog-option',
  'private-dimension-note',
]);

test('RPP-0885 progress report records candidate versus release-ready catalog scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0885');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.candidateScopePattern.rppId, 'RPP-0865');
  assert.equal(report.builtOn.candidateScopePattern.variant, 4);
  assert.equal(report.builtOn.candidateScopePattern.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.builtOn.orderSafetyBoundary.rppId, 'RPP-0866');
  assert.equal(report.builtOn.orderSafetyBoundary.variant, 4);
  assert.equal(report.builtOn.orderSafetyBoundary.hposOrderSurfacesRefusedOutsideCatalog, true);

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'catalog-candidate-v5');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'deterministic-local-woocommerce-catalog-surface-model-v5');
  assert.equal(report.candidateScope.catalogShape.catalogSurface, 'woocommerce-product-catalog');
  assert.equal(report.candidateScope.catalogShape.woocommerceRuntimeObserved, false);
  assert.equal(report.candidateScope.catalogShape.wordpressRoutesCalled, false);
  assert.equal(report.candidateScope.catalogShape.importExportPerformed, false);
  assert.deepEqual(report.candidateScope.catalogShape.productRows, ['wp_posts:product']);
  assert.deepEqual(report.candidateScope.catalogShape.variationRows, ['wp_posts:product_variation']);
  assert.deepEqual(report.candidateScope.catalogShape.mediaRows, ['wp_posts:attachment']);
  assert.deepEqual(report.candidateScope.catalogShape.lookupRows, [
    'wp_wc_product_meta_lookup',
    'wp_wc_product_attributes_lookup',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.stockSurfaces, [
    'wp_postmeta:stock-meta',
    'wp_wc_product_meta_lookup:stock-columns',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.dimensionSurfaces, [
    'wp_postmeta:dimension-meta',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.countSurfaces, [
    'catalog-surface-count-summary',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.mediaReferenceFamilies, [
    '_thumbnail_id',
    '_product_image_gallery',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.taxonomySurfaces, [
    'product_cat',
    'product_tag',
    'product_type',
    'product_visibility',
    'pa_color',
    'pa_roast',
    'pa_size',
    'pa_material',
    'product_shipping_class',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.optionFamilies, [
    'woocommerce_catalog_settings',
    'woocommerce_attribute_taxonomies',
    'woocommerce_product_visibility_options',
    'reprint_push_brewcommerce_fixture',
    'woocommerce_product_dimension_unit',
  ]);
  assert.equal(report.candidateScope.catalogShape.catalogMutationsProven, false);
  assert.equal(report.candidateScope.catalogShape.rawCatalogValuesIncluded, false);
  assert.equal(report.candidateScope.catalogShape.rawMediaUrlsIncluded, false);
  assert.deepEqual(report.candidateScope.countEvidence, expectedCountEvidence());
  assert.deepEqual(report.candidateScope.surfaceEvidence, expectedSurfaceEvidence());
  assert.match(report.candidateScope.surfaceEvidenceHash, hexSha256Pattern);
  assert.equal(report.candidateScope.surfaceEvidenceHash, digest(surfaceEvidenceInput(report)));

  assert.deepEqual(report.candidateScope.candidateClaims, [
    'candidate-shape-recorded',
    'product-variation-media-taxonomy-lookup-stock-dimension-catalog-option-count-surfaces-inventoried',
    'catalog-count-evidence-recorded',
    'hash-count-surface-only-evidence',
  ]);
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('production-bound-woocommerce-import-export'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('live-auth-session-lifecycle-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('durable-journal-release-replay-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('hpos-order-table-mutation-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('order-safety-release-proof'),
  );

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0885 records production-bound release gaps and no-go status', () => {
  const { report } = loadProgressReport();

  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.acceptedReleaseEvidence, false);
  assert.equal(report.productionImportExportEvidence.observedAttempt, 'not-performed-in-rpp-0885');
  assert.equal(
    report.productionImportExportEvidence.blockedReasonCode,
    'PRODUCTION_BOUND_IMPORT_EXPORT_AUTH_JOURNAL_REQUIRED',
  );
  assert.equal(report.productionTopologyEvidence.present, false);
  assert.equal(report.productionTopologyEvidence.acceptedReleaseEvidence, false);
  assert.equal(report.productionTopologyEvidence.sitesStarted, false);
  assert.equal(report.productionTopologyEvidence.releaseGateAccepted, false);
  assert.equal(report.productionTopologyEvidence.observedAttempt, 'not-performed-in-rpp-0885');
  assert.equal(
    report.productionTopologyEvidence.blockedReasonCode,
    'PRODUCTION_TOPOLOGY_RELEASE_VERIFIER_REQUIRED',
  );

  assert.deepEqual(report.operationGuards, {
    liveWooCommerceUsed: false,
    wordpressRoutesCalled: false,
    importExportPerformed: false,
    productionTopologyStarted: false,
    releaseVerifierAccepted: false,
    releaseGatesMoved: false,
    progressSurfacesModified: false,
  });

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.deepEqual(report.releaseReadyScope.gaps, {
    productionBoundWooCommerceImportExport: 'missing',
    productionTopologyReleaseVerifier: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    hposOrderSafety: 'support-only-refusal-not-catalog-release-proof',
    orderSafetyReleaseProof: 'missing',
    redactedReleaseArtifacts: 'missing',
  });
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-bound-wordpress-woocommerce-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-topology-release-verifier-accepted-with-sites-started',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'product-variation-media-taxonomy-lookup-stock-dimension-catalog-option-count-import-export-survives-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'auth-session-lifecycle-accepted-by-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'hpos-and-order-surfaces-explicitly-refused-outside-catalog',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'order-safety-release-proof-accepted-by-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('no-accepted-production-bound-woocommerce-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'production-topology-release-verifier-not-accepted',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'lookup-stock-dimension-catalog-option-count-surfaces-not-proven-by-production-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('auth-session-lifecycle-not-accepted-by-release-verifier'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('durable-journal-not-proven-for-catalog-release'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('hpos-order-safety-only-recorded-as-refusal-boundary'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('order-safety-release-proof-not-present'),
  );

  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
});

test('RPP-0885 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0885 WooCommerce catalog progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawCatalogValuesIncluded, false);
  assert.equal(report.redaction.rawMediaUrlsIncluded, false);
  assert.equal(report.redaction.urlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawReleaseArtifactsIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'finalReleaseStatus',
    'integrationRecommendation',
  ]);

  for (const needle of rawCatalogNeedles) {
    assert.equal(text.includes(needle), false, `RPP-0885 evidence leaked raw catalog fixture ${needle}`);
  }
  assert.doesNotMatch(text, /https?:\/\//i);
});

test('RPP-0885 evidence documents exact validation commands and results', () => {
  const { text } = loadProgressReport();

  assert.match(text, /node --check test\/rpp-0885-woocommerce-product-catalog-v5\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0885 test\/rpp-0885-woocommerce-product-catalog-v5\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0885-woocommerce-product-catalog-v5\.md/,
  );
  assert.match(text, /git diff --check/);
  assert.match(text, /exit 0/);
  assert.match(text, /Evidence redaction scan: `ok: true`, 0 rejected files/);
  assert.match(text, /Diff whitespace check: clean/);
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0885 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function expectedCountEvidence() {
  return {
    productRows: 5,
    variationRows: 10,
    attachmentRows: 8,
    productPostmetaRows: 95,
    variationPostmetaRows: 150,
    mediaReferenceRows: 16,
    taxonomyNames: 9,
    termRows: 28,
    termTaxonomyRows: 28,
    termRelationshipRows: 73,
    termmetaRows: 16,
    lookupTables: 2,
    productMetaLookupRows: 15,
    productAttributesLookupRows: 25,
    stockMetaRows: 30,
    stockLookupRows: 15,
    dimensionMetaRows: 60,
    optionRows: 5,
    countSurfaceRows: 1,
    orderRows: 0,
    hposRows: 0,
  };
}

function expectedSurfaceEvidence() {
  return surfaceEvidenceModel().map((entry) => ({
    ...entry,
    hash: digest(entry),
  }));
}

function surfaceEvidenceModel() {
  return [
    {
      surface: 'product',
      tables: ['wp_posts', 'wp_postmeta'],
      countKeys: ['productRows', 'productPostmetaRows'],
    },
    {
      surface: 'variation',
      tables: ['wp_posts', 'wp_postmeta'],
      countKeys: ['variationRows', 'variationPostmetaRows'],
    },
    {
      surface: 'media',
      tables: ['wp_posts', 'wp_postmeta'],
      countKeys: ['attachmentRows', 'mediaReferenceRows'],
    },
    {
      surface: 'taxonomy',
      tables: ['wp_terms', 'wp_term_taxonomy', 'wp_term_relationships', 'wp_termmeta'],
      countKeys: ['taxonomyNames', 'termRows', 'termTaxonomyRows', 'termRelationshipRows', 'termmetaRows'],
    },
    {
      surface: 'lookup',
      tables: ['wp_wc_product_meta_lookup', 'wp_wc_product_attributes_lookup'],
      countKeys: ['lookupTables', 'productMetaLookupRows', 'productAttributesLookupRows'],
    },
    {
      surface: 'stock',
      tables: ['wp_postmeta', 'wp_wc_product_meta_lookup'],
      countKeys: ['stockMetaRows', 'stockLookupRows'],
    },
    {
      surface: 'dimensions',
      tables: ['wp_postmeta'],
      countKeys: ['dimensionMetaRows'],
    },
    {
      surface: 'catalog-options',
      tables: ['wp_options'],
      countKeys: ['optionRows'],
    },
    {
      surface: 'count',
      tables: ['catalog-surface-count-summary'],
      countKeys: [
        'productRows',
        'variationRows',
        'attachmentRows',
        'taxonomyNames',
        'lookupTables',
        'stockMetaRows',
        'dimensionMetaRows',
        'optionRows',
        'countSurfaceRows',
        'orderRows',
        'hposRows',
      ],
    },
  ];
}

function surfaceEvidenceInput(report) {
  return {
    catalogShape: report.candidateScope.catalogShape,
    countEvidence: report.candidateScope.countEvidence,
    surfaceEvidence: report.candidateScope.surfaceEvidence.map(({ surface, tables, countKeys }) => ({
      surface,
      tables,
      countKeys,
    })),
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
  };
}
