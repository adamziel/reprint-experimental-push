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
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-1000-go-no-go-release-decision-record-release-verifier-v5.md',
);
const fixedNowIso = '2026-06-01T05:00:00.000Z';
const auditedHeadBeforeEvidence = '43fd88ecece4c6d1cc81d87018b4a3ebbf4584f8';

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

test('RPP-1000 v5 release-verifier evidence preserves support-only NO-GO risk contract', () => {
  const { report: decision, text: decisionText } = loadMarkdownJson(decisionPath);
  const { report: evidence, text: evidenceText } = loadMarkdownJson(evidencePath);

  assert.match(decisionText, /^# Reprint Push Go\/No-Go Release Decision Record$/m);
  assert.match(decisionText, /^Final release: \*\*NO-GO\*\*$/m);
  assert.match(decisionText, /All remaining risks below are open/);
  assert.match(decisionText, /Closed risks: none/);
  assert.match(decisionText, /Integration recommendation: \*\*NO-GO\*\*/);
  assert.match(
    evidenceText,
    /^# RPP-1000 go\/no-go release decision record release verifier v5 evidence$/m,
  );
  assert.match(evidenceText, /RPP-0980 v4 go\/no-go decision-record contract/);
  assert.match(evidenceText, /No\s+production-backed closure proof was observed/);
  assert.match(evidenceText, /Integration recommendation: \*\*NO-GO\*\*/);

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.rppId, 'RPP-1000');
  assert.equal(evidence.proofId, 'rpp-1000-go-no-go-release-decision-record-release-verifier-v5');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.baselineContractCarriedFrom, 'rpp-0980-go-no-go-release-decision-record-v4');
  assert.equal(evidence.status, 'passed-support-only-release-verifier-carry-through');
  assert.equal(evidence.supportOnly, true);
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.finalReleaseStatus, 'NO-GO');
  assert.equal(evidence.integrationRecommendation, 'NO-GO');
  assert.equal(evidence.evidenceMode, 'support-only-release-verifier-carry-through');
  assert.equal(evidence.generatedAt, fixedNowIso);
  assert.equal(evidence.auditedBranch, 'session/rpp-1000');
  assert.equal(evidence.auditedHeadBeforeEvidence, auditedHeadBeforeEvidence);
  assert.equal(evidence.decisionRecordPath, 'docs/release/go-no-go-release-decision-record.md');
  assert.equal(
    evidence.evidencePath,
    'docs/evidence/rpp-1000-go-no-go-release-decision-record-release-verifier-v5.md',
  );

  assert.equal(decision.supportOnly, true);
  assert.equal(decision.productionBacked, false);
  assert.equal(decision.releaseEligible, false);
  assert.equal(decision.finalReleaseStatus, 'NO-GO');
  assert.equal(decision.integrationRecommendation, 'NO-GO');
  assert.equal(decision.decision.outcome, 'NO-GO');
  assert.equal(decision.decision.productionClosureProofObserved, false);
  assert.equal(decision.decision.riskRegisterComplete, true);
  assert.equal(decision.decision.remainingRiskCount, expectedRiskIds.length);
  assert.equal(decision.decision.closedRiskCount, 0);
  assert.equal(decision.decision.namedOrClosedRiskCount, expectedRiskIds.length);
  assert.equal(decision.decision.namedOrClosedRiskCount, decision.remainingRisks.length + decision.closedRisks.length);
  assert.equal(decision.closedRisks.length, 0);

  assert.deepEqual(evidence.goNoGoRecord, {
    decision: 'NO-GO',
    reason: decision.decision.reason,
    productionClosureProofObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: expectedRiskIds.length,
    closedRiskCount: 0,
    namedOrClosedRiskCount: expectedRiskIds.length,
    dispositionRule: decision.decision.dispositionRule,
  });
  assert.deepEqual(evidence.riskDispositionAudit, {
    finalGoNoGoRecordNamesEveryRemainingRisk: true,
    allEvaluatorMissingRisksNamedOrClosed: true,
    closedRiskCount: 0,
    closedWithoutProductionBackedProof: [],
    unresolvedProductionBackedProofGapsFailClosed: true,
    releaseGateMovementClaimed: false,
  });
  assert.deepEqual(decision.remainingRisks.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(decision.remainingRisks.map((risk) => risk.code), expectedRiskCodes);
  assert.deepEqual(evidence.remainingRisks, decision.remainingRisks);
  assert.deepEqual(evidence.closedRisks, []);
  assert.deepEqual(evidence.missingProductionEvidenceBuckets, expectedBuckets);

  for (const risk of [...decision.remainingRisks, ...evidence.remainingRisks]) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.rpp, /^RPP-\d{4}$/);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /^Production-backed/);
  }
});

test('RPP-1000 v5 final go/no-go record names every current evaluator risk or closes it', () => {
  const decision = loadMarkdownJson(decisionPath).report;
  const evidence = loadMarkdownJson(evidencePath).report;
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const report = result.report;
  const missing = report.releaseMovement.missingEvidence;
  const namedOpenRisksById = new Map(decision.remainingRisks.map((risk) => [risk.id, risk]));
  const closedRisksById = new Map(decision.closedRisks.map((risk) => [risk.id, risk]));
  const namedOrClosedRiskIds = new Set([
    ...namedOpenRisksById.keys(),
    ...closedRisksById.keys(),
  ]);

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
  assert.equal(evidence.releaseGateSnapshot.exitCode, result.exitCode);
  assert.equal(evidence.releaseGateSnapshot.releaseStatus, 'NO-GO');
  assert.equal(evidence.releaseGateSnapshot.releaseMovementAllowed, false);

  assert.equal(namedOrClosedRiskIds.size, missing.length);
  for (const gate of missing) {
    assert.equal(namedOrClosedRiskIds.has(gate.id), true, `${gate.id} must be named or closed`);

    if (closedRisksById.has(gate.id)) {
      const closedRisk = closedRisksById.get(gate.id);

      assert.equal(closedRisk.productionBackedClosureObserved, true);
      assert.match(closedRisk.closureProof, /\S/);
      continue;
    }

    const risk = namedOpenRisksById.get(gate.id);

    assert.ok(risk, `${gate.id} must remain named as an open risk when proof is missing`);
    assert.equal(risk.rpp, gate.rpp);
    assert.equal(risk.code, gate.code);
    assert.equal(risk.namedRisk, gate.reason);
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.equal(risk.productionBackedClosureObserved, false);
  }
});

test('RPP-1000 v5 release-verifier evidence closes no proof gaps and moves no release gate status', () => {
  const decision = loadMarkdownJson(decisionPath).report;
  const evidence = loadMarkdownJson(evidencePath).report;

  assert.deepEqual(decision.closedRisks, []);
  assert.deepEqual(evidence.closedRisks, []);
  assert.equal(decision.decision.closedRiskCount, 0);
  assert.equal(evidence.goNoGoRecord.closedRiskCount, 0);
  assert.equal(decision.decision.productionClosureProofObserved, false);
  assert.equal(evidence.goNoGoRecord.productionClosureProofObserved, false);
  assert.equal(evidence.riskDispositionAudit.unresolvedProductionBackedProofGapsFailClosed, true);

  for (const risk of [...decision.closedRisks, ...evidence.closedRisks]) {
    assert.equal(risk.productionBackedClosureObserved, true);
    assert.match(risk.closureProof, /\S/);
  }

  assert.equal(evidence.evidenceLimits.releaseGateChanged, false);
  assert.equal(evidence.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(evidence.evidenceLimits.progressRecordChanged, false);
  assert.equal(evidence.evidenceLimits.progressPageChanged, false);
  assert.equal(evidence.evidenceLimits.completionChecklistChanged, false);
  assert.equal(evidence.evidenceLimits.statusFilesChanged, false);
  assert.equal(evidence.evidenceLimits.dashboardsStarted, false);
  assert.equal(evidence.evidenceLimits.remoteTunnelsUsed, false);
  assert.equal(decision.evidenceLimits.releaseGateStatusMovement, 'none');
});

test('RPP-1000 v5 artifacts remain redacted and do not authorize release movement', async () => {
  const decision = loadMarkdownJson(decisionPath);
  const evidence = loadMarkdownJson(evidencePath);
  const scan = await scanArtifacts([
    'docs/release/go-no-go-release-decision-record.md',
    'docs/evidence/rpp-1000-go-no-go-release-decision-record-release-verifier-v5.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(decision.report, { label: 'RPP-1000 go/no-go decision record' }));
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence.report, { label: 'RPP-1000 go/no-go release-verifier evidence' }));
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
