import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolDocPath = path.join(repoRoot, 'docs/protocol/versioned-release-protocol.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0915-versioned-protocol-docs.md');
const expectedRiskIds = Array.from(
  { length: 12 },
  (_, index) => `RPP-0915-RISK-${String(index + 1).padStart(2, '0')}`,
);
const expectedCapabilityGroups = [
  'auth',
  'journal',
  'lease',
  'apply',
  'dry-run',
  'recovery',
  'topology',
];

test('RPP-0915 evidence records support-only versioned protocol docs and final NO-GO', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0915');
  assert.equal(report.sliceId, 'RPP-0915');
  assert.equal(report.proofId, 'rpp-0915-versioned-protocol-docs-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'final-go-no-go-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.protocolDocPath, 'docs/protocol/versioned-release-protocol.md');

  assert.deepEqual(report.versionedProtocolRecord, {
    family: 'reprint-push-release-protocol',
    schemaVersion: 1,
    minimumVersion: '1.0.0',
    currentVersion: '1.1.0',
    supportedVersions: ['1.0.0', '1.1.0'],
    capabilityGroups: expectedCapabilityGroups,
    negotiation: {
      versionOfferRequired: true,
      failClosedOnUnknownVersion: true,
      failClosedOnDowngrade: true,
      exactCapabilitySetRequired: true,
      fallbackPolicy: 'no-fallback-after-incompatible-offer',
      mutationAllowedWithoutNegotiation: false,
    },
    supportBoundary: 'documentation-only',
  });
  assert.deepEqual(report.goNoGoRecord, {
    decision: 'NO-GO',
    reason: 'Production closure proof is absent for this support-only versioned protocol documentation slice.',
    productionClosureProofObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: 12,
    closedRiskCount: 0,
    namedOrClosedRiskCount: 12,
    dispositionRule: 'Each RPP-0915 versioned protocol risk remains open unless production closure proof closes it.',
  });
  assert.deepEqual(report.closedRisks, []);
  assert.equal(report.remainingRisks.length, 12);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.id), expectedRiskIds);

  for (const risk of report.remainingRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /^Production|^Independent|^Release gate|^Passing/);
  }
});

test('RPP-0915 protocol doc carries the matching version contract and risk register', () => {
  const protocolDoc = fs.readFileSync(protocolDocPath, 'utf8');
  const { report } = loadEvidenceReport();

  assert.match(protocolDoc, /^Status: support-only, release blocking$/m);
  assert.match(protocolDoc, /^Final release: \*\*NO-GO\*\*$/m);
  assert.match(protocolDoc, /Support-only documentation does not close production risks\./);
  assert.match(protocolDoc, /No release gate, status file, checklist, progress log, or progress page movement is authorized\./);
  assert.match(protocolDoc, /do not use remote tunnel services\./);
  assert.match(protocolDoc, /Exact capability set required for the negotiated version\./);
  assert.match(protocolDoc, /`no-fallback-after-incompatible-offer`/);
  assert.match(protocolDoc, /Mutation without negotiation \| Not allowed\./);
  assert.match(protocolDoc, /Closed risks: none\./);
  assert.match(protocolDoc, /Integration recommendation: \*\*NO-GO\*\* for release movement\./);

  for (const version of report.versionedProtocolRecord.supportedVersions) {
    assert.ok(protocolDoc.includes(`| \`${version}\` |`), `missing documented version ${version}`);
  }
  for (const group of expectedCapabilityGroups) {
    assert.ok(protocolDoc.includes(`\`${group}\``), `missing capability group ${group}`);
  }
  for (const risk of report.remainingRisks) {
    assert.ok(
      protocolDoc.includes(`| ${risk.id} | Open | Yes | ${risk.namedRisk} |`),
      `${risk.id} must be listed in the protocol doc`,
    );
  }
});

test('RPP-0915 risk disposition is complete without closing production risks', () => {
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
  assert.equal(report.evidenceLimits.progressPageChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.statusFilesChanged, false);
  assert.equal(report.evidenceLimits.productionVersionNegotiationObserved, false);
  assert.equal(report.evidenceLimits.productionRouteEnforcementObserved, false);
});

test('RPP-0915 artifacts remain redacted and final release stays NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([
    'docs/protocol/versioned-release-protocol.md',
    'docs/evidence/rpp-0915-versioned-protocol-docs.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0915 versioned protocol docs evidence' }));
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

  assert.ok(match?.groups?.json, 'RPP-0915 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
