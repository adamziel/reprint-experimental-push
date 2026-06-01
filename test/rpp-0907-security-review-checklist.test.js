import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checklistPath = path.join(repoRoot, 'docs/security/release-security-review.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0907-security-review-checklist.md');

test('RPP-0907 security checklist states production-backed evidence is required for release movement', () => {
  const checklist = readText(checklistPath);

  assert.match(checklist, /^# Release Security Review Checklist$/m);
  assert.match(checklist, /Variant: RPP-0907 security review checklist variant 1/);
  assert.match(checklist, /Release gate status moves only after production-backed evidence is present/);
  assert.match(checklist, /Support-only review evidence is not production-backed evidence/);
  assert.match(checklist, /This checklist does not authorize release-gate status changes/);
  assert.match(checklist, /Missing production-backed evidence keeps the final release at \*\*NO-GO\*\*/);
  assert.match(checklist, /\[RPP-0907 support-only review checklist\]\(\.\.\/evidence\/rpp-0907-security-review-checklist\.md\)/);

  for (const itemId of ['SR-01', 'SR-02', 'SR-03', 'SR-04', 'SR-05', 'SR-06', 'SR-07', 'SR-08']) {
    assert.ok(checklist.includes(`| ${itemId} |`), `${itemId} must be present in the checklist`);
  }
});

test('RPP-0907 evidence records support-only review discipline without release eligibility', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0907');
  assert.equal(report.sliceId, 'RPP-0907');
  assert.equal(report.proofId, 'rpp-0907-security-review-checklist-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'support-only-review-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.reviewDiscipline, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    currentReviewMovementAttempted: false,
    productionBackedEvidenceObserved: false,
    withoutProductionBackedEvidence: 'blocked',
    supportOnlyReviewEffect: 'no-movement',
    finalReleaseRequiredPosture: 'NO-GO',
    rule: 'Support-only review evidence can name required production proof but cannot change release gate status.',
  });

  assert.equal(report.evidenceLimits.mutationAttempted, false);
  assert.equal(report.evidenceLimits.rawPayloadsStored, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
});

test('RPP-0907 checklist items require production proof and forbid support-only gate movement', () => {
  const { report } = loadEvidenceReport();
  const expectedIds = ['SR-01', 'SR-02', 'SR-03', 'SR-04', 'SR-05', 'SR-06', 'SR-07', 'SR-08'];

  assert.deepEqual(report.checklistItems.map((item) => item.id), expectedIds);

  for (const item of report.checklistItems) {
    assert.equal(item.productionEvidenceRequired, true, `${item.id} must require production-backed evidence`);
    assert.equal(item.productionBacked, false, `${item.id} must not claim production-backed proof`);
    assert.equal(item.supportReviewed, true, `${item.id} must be reviewed as support evidence`);
    assert.equal(item.releaseGateSatisfied, false, `${item.id} must not satisfy release gates`);
    assert.equal(item.gateMovementAllowed, false, `${item.id} must forbid gate movement`);
    assert.match(item.requiredProductionProof, /^Production-backed proof|^Fresh operator evidence/);
  }
});

test('RPP-0907 release gates remain blocked without production-backed evidence', () => {
  const { report } = loadEvidenceReport();
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
  });

  assert.equal(report.releaseGateExpectation.command, 'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:46:00.000Z');
  assert.equal(result.exitCode, report.releaseGateExpectation.expectedExit);
  assert.equal(result.report.releaseStatus, report.releaseGateExpectation.expectedReleaseStatus);
  assert.equal(result.report.primaryFailureCode, report.releaseGateExpectation.expectedPrimaryFailureCode);
  assert.equal(result.report.mutationAttempted, report.releaseGateExpectation.expectedMutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.releaseGateExpectation.expectedReleaseMovementAllowed);
  assert.match(result.report.statusMarker, /\[release-gates-ci:held /);
});

test('RPP-0907 evidence remains redacted and documents final NO-GO', () => {
  const checklist = readText(checklistPath);
  const { text, report } = loadEvidenceReport();

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0907 security review checklist' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(checklist.includes('http://'), false);
  assert.equal(checklist.includes('https://'), false);
  assert.match(text, /Gate movement therefore remains blocked/);
  assert.match(text, /final release remains \*\*NO-GO\*\*/);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0907 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
