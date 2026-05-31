import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0805-woocommerce-product-catalog-v1.md',
);
const hexSha256Pattern = /^[a-f0-9]{64}$/;

test('RPP-0805 progress report records candidate versus release-ready catalog scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0805');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'catalog-candidate');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-playground-brewcommerce-derived-seed');
  assert.deepEqual(report.candidateScope.catalogShape.productRows, ['wp_posts:product']);
  assert.deepEqual(report.candidateScope.catalogShape.postmetaFamilies, [
    '_sku',
    '_regular_price',
    '_price',
    '_stock_status',
    '_manage_stock',
    '_stock',
  ]);
  assert.deepEqual(report.candidateScope.catalogShape.optionFamilies, [
    'reprint_push_brewcommerce_fixture',
  ]);
  assert.equal(report.candidateScope.catalogShape.catalogMutationsProven, false);

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-bound-wordpress-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'woocommerce-product-catalog-import-export-survives-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'hpos-and-order-surfaces-explicitly-refused-outside-catalog',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('no-accepted-production-bound-woocommerce-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'full-brewcommerce-woocommerce-import-attempt-failed-closed',
    ),
  );

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0805 stays support-only when production WooCommerce import/export proof is absent', () => {
  const { report } = loadProgressReport();

  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.acceptedReleaseEvidence, false);
  assert.equal(
    report.productionImportExportEvidence.observedAttempt,
    'full-brewcommerce-woocommerce-import-failed-closed',
  );
  assert.equal(
    report.productionImportExportEvidence.blockedReasonCode,
    'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
  );

  if (!report.productionImportExportEvidence.acceptedReleaseEvidence) {
    assert.equal(report.supportOnly, true);
    assert.equal(report.productionBacked, false);
    assert.equal(report.releaseEligible, false);
    assert.equal(report.integrationRecommendation, 'NO-GO');
    assert.equal(report.candidateScope.releaseGateMovement, 'none');
  }
});

test('RPP-0805 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawCatalogValuesIncluded, false);
  assert.equal(report.redaction.urlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.catalogShape.rawCatalogValuesIncluded, false);

  assert.doesNotMatch(
    text,
    /Reprint Proof Coffee|REPRINT-PROOF-COFFEE|21\.00|Stable production copy|Complex Brewcommerce product|https?:\/\//i,
  );
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0805 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
  };
}
