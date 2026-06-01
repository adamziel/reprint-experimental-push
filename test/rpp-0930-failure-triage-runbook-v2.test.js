import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0930-failure-triage-runbook-v2.md');
const rpp0910EvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0910-failure-triage-runbook.md');
const rpp0920EvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0920-go-no-go-release-decision-record.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = '8ca2573ada0a344735cb0c78560d7dabd4c403a2';

const expectedFailureTriageRiskIds = Array.from(
  { length: 12 },
  (_, index) => `RPP-0910-RISK-${String(index + 1).padStart(2, '0')}`,
);

const expectedFinalReleaseRiskIds = [
  'source-url',
  'local-url',
  'remote-changed-url',
  'auth-source-readback',
  'production-secret',
  'application-password-binding',
  'manage-options-capability',
  'same-source-identity',
  'preflight-route-identity',
  'dry-run-route-eligibility',
  'apply-route-pre-mutation',
  'journal-route-read-only',
  'recovery-inspect-read-only',
  'tmux-status-marker',
  'progress-release-timestamp',
  'agents-release-gates-row',
  'verify-release-failure-reason',
];

const validationCommands = [
  'node --check test/rpp-0930-failure-triage-runbook-v2.test.js',
  'node --test --test-name-pattern RPP-0930 test/rpp-0930-failure-triage-runbook-v2.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0930-failure-triage-runbook-v2.md',
  'git diff --check',
];

test('RPP-0930 evidence updates the audited lane head and keeps final release NO-GO', () => {
  const { text, record } = loadEvidence(evidencePath);
  const releaseGates = readText(releaseGatesPath);

  assert.match(text, /^# RPP-0930 failure triage runbook v2 evidence$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-930`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.rppId, 'RPP-0930');
  assert.equal(record.sliceId, 'RPP-0930');
  assert.equal(record.proofId, 'rpp-0930-failure-triage-runbook-v2');
  assert.equal(record.variant, 2);
  assert.equal(record.auditedBranch, 'session/rpp-930');
  assert.equal(record.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(record.status, 'final-go-no-go-recorded');
  assert.equal(record.supportOnly, true);
  assert.equal(record.productionBacked, false);
  assert.equal(record.releaseEligible, false);
  assert.equal(record.finalReleaseStatus, 'NO-GO');
  assert.equal(record.integrationRecommendation, 'NO-GO');
  assert.equal(record.verdictHeld, true);
  assert.match(releaseGates, /`release_verdict`: `0\/4`/);
});

test('RPP-0930 names every remaining failure-triage risk and keeps it open', () => {
  const { record } = loadEvidence(evidencePath);
  const { record: rpp0910 } = loadEvidence(rpp0910EvidencePath);

  assert.equal(record.patternEvidence, 'docs/evidence/rpp-0910-failure-triage-runbook.md');
  assert.equal(record.goNoGoRecord.failureTriageRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.remainingFailureTriageRiskCount, 12);
  assert.deepEqual(record.failureTriageRiskRegister.map((risk) => risk.id), expectedFailureTriageRiskIds);
  assert.deepEqual(
    record.failureTriageRiskRegister.map(projectFailureTriageRisk),
    rpp0910.remainingRisks.map(projectFailureTriageRisk),
  );

  for (const risk of record.failureTriageRiskRegister) {
    assertOpenNamedRisk(risk);
    assert.equal(risk.productionBackedClosureObserved, false);
  }
});

test('RPP-0930 names every remaining final-release risk from the go/no-go record and keeps it open', () => {
  const { record } = loadEvidence(evidencePath);
  const { record: rpp0920 } = loadEvidence(rpp0920EvidencePath);

  assert.equal(record.sourceDecisionRecord, 'docs/evidence/rpp-0920-go-no-go-release-decision-record.md');
  assert.equal(record.goNoGoRecord.finalReleaseRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.remainingFinalReleaseRiskCount, 17);
  assert.deepEqual(record.finalReleaseRiskRegister.map((risk) => risk.id), expectedFinalReleaseRiskIds);
  assert.deepEqual(record.finalReleaseRiskRegister, rpp0920.remainingRisks);
  assert.deepEqual(
    record.finalReleaseRiskBuckets.map((bucket) => bucket.riskIds).flat(),
    expectedFinalReleaseRiskIds,
  );

  for (const risk of record.finalReleaseRiskRegister) {
    assertOpenNamedRisk(risk);
    assert.equal(risk.productionBackedClosureObserved, false);
  }
});

test('RPP-0930 go/no-go record closes no risk without production-backed closure proof', () => {
  const { record } = loadEvidence(evidencePath);
  const allRisks = [
    ...record.failureTriageRiskRegister,
    ...record.finalReleaseRiskRegister,
  ];
  const uniqueRiskIds = new Set(allRisks.map((risk) => risk.id));
  const openRisks = allRisks.filter((risk) => risk.disposition === 'open');
  const releaseBlockers = allRisks.filter((risk) => risk.releaseBlocker === true);

  assert.equal(record.goNoGoRecord.decision, 'NO-GO');
  assert.equal(record.goNoGoRecord.productionClosureProofObserved, false);
  assert.equal(record.goNoGoRecord.remainingRiskCount, 29);
  assert.equal(record.goNoGoRecord.closedRiskCount, 0);
  assert.equal(record.goNoGoRecord.namedOrClosedRiskCount, 29);
  assert.deepEqual(record.closedRisks, []);
  assert.equal(allRisks.length, 29);
  assert.equal(uniqueRiskIds.size, 29);
  assert.equal(openRisks.length, 29);
  assert.equal(releaseBlockers.length, 29);
  assert.match(record.goNoGoRecord.dispositionRule, /remains open unless production-backed closure proof closes it/);
});

test('RPP-0930 evidence is redacted and records no release-gate movement', async () => {
  const { text, record } = loadEvidence(evidencePath);
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0930-failure-triage-runbook-v2.md',
  ], { cwd: repoRoot });

  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.equal(record.evidenceLimits.mutationAttempted, false);
  assert.equal(record.evidenceLimits.rawUrlsIncluded, false);
  assert.equal(record.evidenceLimits.rawPayloadsStored, false);
  assert.equal(record.evidenceLimits.authMaterialCaptured, false);
  assert.equal(record.evidenceLimits.releaseGateChanged, false);
  assert.equal(record.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(record.evidenceLimits.progressRecordChanged, false);
  assert.equal(record.evidenceLimits.progressPageChanged, false);
  assert.equal(record.evidenceLimits.completionChecklistChanged, false);
  assert.equal(record.evidenceLimits.statusFilesChanged, false);
  assert.equal(record.evidenceLimits.dashboardsStarted, false);
  assert.equal(record.evidenceLimits.remoteTunnelsUsed, false);

  for (const command of validationCommands) {
    assert.ok(text.includes(`\`${command}\``), `missing validation command: ${command}`);
  }
});

test('RPP-0930 final-release evaluator remains held without production closure proof', () => {
  const { record } = loadEvidence(evidencePath);
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', record.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(record.generatedAt),
  });

  assert.equal(record.releaseGateSnapshot.expectedExit, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.primaryFailureBucket, 'topology');
  assert.equal(result.report.statusMarker, record.releaseGateSnapshot.statusMarker);
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '3/20');
  assert.equal(result.report.totals.blocking, 17);
});

function loadEvidence(filePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON record block`);
  return {
    text,
    record: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertOpenNamedRisk(risk) {
  assert.equal(risk.disposition, 'open');
  assert.equal(risk.releaseBlocker, true);
  assert.match(risk.title, /\S/);
  assert.match(risk.namedRisk, /\S/);
  assert.match(risk.closureRequired, /\S/);
}

function projectFailureTriageRisk(risk) {
  const {
    id,
    category,
    title,
    disposition,
    releaseBlocker,
    namedRisk,
    closureRequired,
  } = risk;

  return {
    id,
    category,
    title,
    disposition,
    releaseBlocker,
    namedRisk,
    closureRequired,
  };
}
