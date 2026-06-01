import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(repoRoot, 'audits/objective-audit.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0905-objective-audit-update.md');
const expectedRequirements = Array.from({ length: 16 }, (_, index) => `R${index + 1}`);
const expectedRiskIds = Array.from(
  { length: 16 },
  (_, index) => `RPP-0905-RISK-${String(index + 1).padStart(2, '0')}`,
);

test('RPP-0905 evidence records final NO-GO and names every remaining objective risk', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0905');
  assert.equal(report.proofId, 'rpp-0905-objective-audit-update-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'final-go-no-go-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.goNoGoRecord, {
    decision: 'NO-GO',
    reason: 'No production-backed evidence was added in this audit update.',
    productionBackedEvidenceObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: 16,
    closedRiskCount: 0,
    namedOrClosedRiskCount: 16,
    dispositionRule: 'Each R1-R16 objective requirement is represented as an open risk unless production-backed evidence closes it.',
  });
  assert.deepEqual(report.closedRisks, []);
  assert.equal(report.remainingRisks.length, 16);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.requirement), expectedRequirements);

  for (const risk of report.remainingRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /\S/);
  }
});

test('RPP-0905 audit update carries the matching final go/no-go risk register', () => {
  const audit = fs.readFileSync(auditPath, 'utf8');
  const { report } = loadEvidenceReport();
  const section = auditSection(audit, '## RPP-0905 Final Go/No-Go Record');

  assert.match(section, /Final release verdict: \*\*NO-GO\*\*/);
  assert.match(section, /No production-backed evidence was added/);
  assert.match(section, /closes no risks/);
  assert.match(section, /RPP-0905 integration recommendation: \*\*NO-GO\*\*/);

  for (const risk of report.remainingRisks) {
    assert.ok(section.includes(`| ${risk.id} | ${risk.requirement} | Open |`), `${risk.id} must be listed in the audit record`);
  }
});

test('RPP-0905 risk disposition is complete without pretending to close production risks', () => {
  const { report } = loadEvidenceReport();
  const riskIds = new Set(report.remainingRisks.map((risk) => risk.id));
  const requirements = new Set(report.remainingRisks.map((risk) => risk.requirement));
  const blockers = report.remainingRisks.filter((risk) => risk.releaseBlocker === true);
  const openRisks = report.remainingRisks.filter((risk) => risk.disposition === 'open');

  assert.equal(riskIds.size, 16);
  assert.equal(requirements.size, 16);
  assert.deepEqual([...requirements], expectedRequirements);
  assert.equal(blockers.length, 16);
  assert.equal(openRisks.length, 16);
  assert.equal(report.goNoGoRecord.namedOrClosedRiskCount, openRisks.length + report.closedRisks.length);
  assert.equal(report.goNoGoRecord.closedRiskCount, 0);
  assert.equal(report.releaseGateExpectation.expectedReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateExpectation.expectedMutationAttempted, false);
});

test('RPP-0905 evidence remains redacted and final release gates fail closed without production evidence', () => {
  const { report, text } = loadEvidenceReport();

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0905 objective audit update' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);

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

  assert.ok(match?.groups?.json, 'RPP-0905 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function auditSection(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `${heading} must exist`);

  const nextHeading = source.indexOf('\n## ', start + heading.length);
  return nextHeading === -1 ? source.slice(start) : source.slice(start, nextHeading);
}
