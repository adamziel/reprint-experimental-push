import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const decisionPath = path.join(repoRoot, 'docs/release/go-no-go-release-decision-record.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0920-go-no-go-release-decision-record.md');
const fixedNowIso = '2026-06-01T02:09:00.000Z';

const expectedRiskIds = [
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

const expectedRiskCodes = [
  'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
  'REPRINT_PUSH_LOCAL_URL_REQUIRED',
  'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
  'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
  'REPRINT_PUSH_SECRET_REQUIRED',
  'APPLICATION_PASSWORD_BINDING_REQUIRED',
  'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
  'SAME_SOURCE_IDENTITY_REQUIRED',
  'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
  'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
  'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
  'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
  'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
  'TMUX_STATUS_MARKER_REQUIRED',
  'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
  'AGENTS_RELEASE_GATES_ROW_REQUIRED',
  'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
];

const expectedBuckets = [
  {
    bucket: 'topology',
    gateCount: 3,
    gateIds: ['source-url', 'local-url', 'remote-changed-url'],
  },
  {
    bucket: 'auth',
    gateCount: 4,
    gateIds: [
      'auth-source-readback',
      'production-secret',
      'application-password-binding',
      'manage-options-capability',
    ],
  },
  {
    bucket: 'identity',
    gateCount: 1,
    gateIds: ['same-source-identity'],
  },
  {
    bucket: 'route',
    gateCount: 3,
    gateIds: [
      'preflight-route-identity',
      'dry-run-route-eligibility',
      'apply-route-pre-mutation',
    ],
  },
  {
    bucket: 'recovery',
    gateCount: 2,
    gateIds: ['journal-route-read-only', 'recovery-inspect-read-only'],
  },
  {
    bucket: 'operator-proof',
    gateCount: 4,
    gateIds: [
      'tmux-status-marker',
      'progress-release-timestamp',
      'agents-release-gates-row',
      'verify-release-failure-reason',
    ],
  },
];

test('RPP-0920 decision record is support-only NO-GO and names every remaining risk', () => {
  const { report, text } = loadMarkdownJson(decisionPath);

  assert.match(text, /^# Reprint Push Go\/No-Go Release Decision Record$/m);
  assert.match(text, /^Final release: \*\*NO-GO\*\*$/m);
  assert.match(text, /All remaining risks below are open/);
  assert.match(text, /Closed risks: none/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0920');
  assert.equal(report.recordId, 'rpp-0920-go-no-go-release-decision-record-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'final-go-no-go-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.decision, {
    outcome: 'NO-GO',
    reason: 'Production-backed closure proof is absent for every remaining blocking final-release risk.',
    productionClosureProofObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: 17,
    closedRiskCount: 0,
    namedOrClosedRiskCount: 17,
    dispositionRule: 'Each remaining release risk remains open unless production-backed closure proof closes it.',
  });
  assert.equal(report.remainingRisks.length, expectedRiskIds.length);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.code), expectedRiskCodes);
  assert.deepEqual(report.closedRisks, []);
  assert.equal(report.decision.namedOrClosedRiskCount, report.remainingRisks.length + report.closedRisks.length);

  for (const risk of report.remainingRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.rpp, /^RPP-\d{4}$/);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /^Production-backed/);
  }
});

test('RPP-0920 evidence aligns with the decision record and keeps risk closure at zero', () => {
  const decision = loadMarkdownJson(decisionPath).report;
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0920 go\/no-go release decision record evidence$/m);
  assert.match(text, /No production-backed\s+closure proof was observed/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0920');
  assert.equal(report.proofId, 'rpp-0920-go-no-go-release-decision-record-v1');
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.decisionRecordPath, 'docs/release/go-no-go-release-decision-record.md');
  assert.equal(report.evidencePath, 'docs/evidence/rpp-0920-go-no-go-release-decision-record.md');
  assert.deepEqual(report.goNoGoRecord, {
    decision: 'NO-GO',
    reason: decision.decision.reason,
    productionClosureProofObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: 17,
    closedRiskCount: 0,
    namedOrClosedRiskCount: 17,
    dispositionRule: decision.decision.dispositionRule,
  });
  assert.deepEqual(report.remainingRisks, decision.remainingRisks);
  assert.deepEqual(report.closedRisks, []);
  assert.deepEqual(report.missingProductionEvidenceBuckets, expectedBuckets);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.progressPageChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.statusFilesChanged, false);
  assert.equal(report.evidenceLimits.dashboardsStarted, false);
  assert.equal(report.evidenceLimits.remoteTunnelsUsed, false);
});

test('RPP-0920 risk register matches the current final release gate evaluator', () => {
  const decision = loadMarkdownJson(decisionPath).report;
  const evidence = loadMarkdownJson(evidencePath).report;
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const report = result.report;
  const missing = report.releaseMovement.missingEvidence;

  assert.equal(result.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.statusMarker, '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]');
  assert.equal(report.mutationAttempted, false);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '3/20');
  assert.equal(report.releaseMovement.candidateGates, '3/20');
  assert.deepEqual(report.totals, {
    gates: 20,
    passed: 3,
    candidate: 0,
    missing: 17,
    failed: 0,
    blocking: 17,
  });
  assert.deepEqual(
    report.missingProductionEvidenceBuckets.map((bucket) => ({
      bucket: bucket.bucket,
      gateCount: bucket.gateCount,
      gateIds: bucket.gates.map((gate) => gate.id),
    })),
    expectedBuckets,
  );
  assert.deepEqual(missing.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(missing.map((risk) => risk.code), expectedRiskCodes);
  assert.deepEqual(decision.releaseGateSnapshot.totals, report.totals);
  assert.deepEqual(evidence.releaseGateSnapshot.totals, report.totals);

  for (const [index, risk] of decision.remainingRisks.entries()) {
    const gate = missing[index];
    assert.equal(risk.id, gate.id);
    assert.equal(risk.rpp, gate.rpp);
    assert.equal(risk.code, gate.code);
    assert.equal(risk.namedRisk, gate.reason);
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.productionBackedClosureObserved, false);
  }
});

test('RPP-0920 artifacts remain redacted and do not authorize release movement', async () => {
  const decision = loadMarkdownJson(decisionPath);
  const evidence = loadMarkdownJson(evidencePath);
  const scan = await scanArtifacts([
    'docs/release/go-no-go-release-decision-record.md',
    'docs/evidence/rpp-0920-go-no-go-release-decision-record.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(decision.report, { label: 'RPP-0920 go/no-go decision record' }));
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence.report, { label: 'RPP-0920 go/no-go evidence' }));
  assert.equal(decision.text.includes('http://'), false);
  assert.equal(decision.text.includes('https://'), false);
  assert.equal(evidence.text.includes('http://'), false);
  assert.equal(evidence.text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);

  assert.equal(decision.report.releaseGateSnapshot.releaseMovementAllowed, false);
  assert.equal(evidence.report.releaseGateSnapshot.releaseMovementAllowed, false);
  assert.equal(decision.report.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(evidence.report.evidenceLimits.releaseGateStatusMovement, 'none');
});

function loadMarkdownJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON record block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
