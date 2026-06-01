import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = path.join(repoRoot, 'docs/operations/failure-triage-runbook.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0910-failure-triage-runbook.md');
const expectedRiskIds = Array.from(
  { length: 12 },
  (_, index) => `RPP-0910-RISK-${String(index + 1).padStart(2, '0')}`,
);
const expectedFailureBuckets = [
  'source-boundary',
  'auth-boundary',
  'planning',
  'conflict',
  'apply-guard',
  'journal',
  'recovery',
  'artifact-integrity',
  'performance',
  'release-process',
];

test('RPP-0910 evidence records final NO-GO and names every remaining triage risk', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0910');
  assert.equal(report.sliceId, 'RPP-0910');
  assert.equal(report.proofId, 'rpp-0910-failure-triage-runbook-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'final-go-no-go-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.runbookPath, 'docs/operations/failure-triage-runbook.md');

  assert.deepEqual(report.goNoGoRecord, {
    decision: 'NO-GO',
    reason: 'Production closure proof is absent for this support-only runbook slice.',
    productionClosureProofObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: 12,
    closedRiskCount: 0,
    namedOrClosedRiskCount: 12,
    dispositionRule: 'Each RPP-0910 triage risk remains open unless production closure proof closes it.',
  });
  assert.deepEqual(report.closedRisks, []);
  assert.equal(report.remainingRisks.length, 12);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.id), expectedRiskIds);

  for (const risk of report.remainingRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /\S/);
  }
});

test('RPP-0910 runbook carries the matching failure triage risk register', () => {
  const runbook = fs.readFileSync(runbookPath, 'utf8');
  const { report } = loadEvidenceReport();

  assert.match(runbook, /^Status: support-only, release blocking$/m);
  assert.match(runbook, /Final\s+release remains \*\*NO-GO\*\*/);
  assert.match(runbook, /Do not use remote tunnel services\./);
  assert.match(runbook, /Support-only documents never close a\s+production risk\./);
  assert.match(runbook, /When production closure proof is\s+absent,[\s\S]*final release remains \*\*NO-GO\*\*\./);

  for (const bucket of expectedFailureBuckets) {
    assert.ok(report.failureBuckets.includes(bucket), `missing failure bucket ${bucket}`);
  }
  assert.deepEqual(report.failureBuckets, expectedFailureBuckets);

  for (const risk of report.remainingRisks) {
    assert.ok(runbook.includes(`| ${risk.id} | Open | Yes | ${risk.namedRisk} |`), `${risk.id} must be listed in the runbook`);
  }
});

test('RPP-0910 risk disposition is complete without closing production risks', () => {
  const { report } = loadEvidenceReport();
  const riskIds = new Set(report.remainingRisks.map((risk) => risk.id));
  const categories = new Set(report.remainingRisks.map((risk) => risk.category));
  const blockers = report.remainingRisks.filter((risk) => risk.releaseBlocker === true);
  const openRisks = report.remainingRisks.filter((risk) => risk.disposition === 'open');

  assert.equal(riskIds.size, 12);
  assert.equal(categories.size, 12);
  assert.equal(blockers.length, 12);
  assert.equal(openRisks.length, 12);
  assert.equal(report.goNoGoRecord.namedOrClosedRiskCount, openRisks.length + report.closedRisks.length);
  assert.equal(report.goNoGoRecord.closedRiskCount, 0);
  assert.equal(report.goNoGoRecord.productionClosureProofObserved, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.statusFilesChanged, false);
});

test('RPP-0910 evidence remains redacted and final release stays NO-GO without production closure proof', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([
    'docs/operations/failure-triage-runbook.md',
    'docs/evidence/rpp-0910-failure-triage-runbook.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0910 failure triage runbook evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);

  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0910 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
