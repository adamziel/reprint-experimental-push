import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0985-objective-audit-update-release-verifier-v5.md');
const contractEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0965-objective-audit-update-v4.md');
const fixedNowIso = '2026-06-01T04:25:00.000Z';
const auditedLaneHead = 'fc41d231251d3b390996d036b72fbfa5c4fab426';

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

const expectedObjectiveRequirements = Array.from({ length: 16 }, (_, index) => `R${index + 1}`);

test('RPP-0985 evidence is support-only and keeps the final release verdict held', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0985 objective audit update release verifier v5$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.match(text, /Final release remains \*\*NO-GO\*\*/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0985');
  assert.equal(report.proofId, 'rpp-0985-objective-audit-update-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'final-go-no-go-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-985');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.deepEqual(report.carriedForwardRiskContract, {
    sourceRppId: 'RPP-0965',
    sourceProofId: 'rpp-0965-objective-audit-update-v4',
    sourceVariant: 4,
    finalReleaseRiskCount: expectedRiskIds.length,
    objectiveRequirementRiskCount: expectedObjectiveRequirements.length,
    closedRiskCount: 0,
    productionBackedClosureProofAdded: false,
    rule: 'Carry forward every RPP-0965 v4 final-release and R1-R16 objective risk as open unless production-backed closure proof exists.',
  });
});

test('RPP-0985 final go/no-go record names every current final-release risk and closes none', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.goNoGoRecord, {
    decision: 'NO-GO',
    reason: 'Production-backed closure proof is absent for every remaining blocking final-release risk.',
    productionBackedEvidenceObserved: false,
    riskRegisterComplete: true,
    remainingRiskCount: expectedRiskIds.length,
    remainingFinalReleaseRiskCount: expectedRiskIds.length,
    remainingObjectiveRequirementRiskCount: expectedObjectiveRequirements.length,
    closedRiskCount: 0,
    namedOrClosedRiskCount: expectedRiskIds.length,
    dispositionRule: 'Each current final-release risk is represented as an open risk unless production-backed closure proof closes it; R1-R16 objective requirements remain open because this support-only update adds no production-backed closure proof.',
  });
  assert.deepEqual(report.closedRisks, []);
  assert.equal(report.remainingRisks.length, expectedRiskIds.length);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(report.remainingRisks.map((risk) => risk.code), expectedRiskCodes);
  assert.equal(report.goNoGoRecord.namedOrClosedRiskCount, report.remainingRisks.length + report.closedRisks.length);
  assert.equal(
    report.goNoGoRecord.namedOrClosedRiskCount,
    report.goNoGoRecord.remainingFinalReleaseRiskCount + report.goNoGoRecord.closedRiskCount,
  );

  for (const risk of report.remainingRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.releaseBlocker, true);
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.rpp, /^RPP-\d{4}$/);
    assert.match(risk.category, /\S/);
    assert.match(risk.title, /\S/);
    assert.match(risk.namedRisk, /\S/);
    assert.match(risk.closureRequired, /^Production-backed/);
  }
});

test('RPP-0985 carries forward the RPP-0965 v4 objective-audit risk contract', () => {
  const { report } = loadEvidenceReport();
  const { report: contract } = loadEvidenceReport(contractEvidencePath);
  const riskContractFields = (risk) => ({
    id: risk.id,
    rpp: risk.rpp,
    category: risk.category,
    title: risk.title,
    code: risk.code,
    disposition: risk.disposition,
    releaseBlocker: risk.releaseBlocker,
    productionBackedClosureObserved: risk.productionBackedClosureObserved,
    namedRisk: risk.namedRisk,
    closureRequired: risk.closureRequired,
  });
  const objectiveRiskFields = (risk) => ({
    requirement: risk.requirement,
    title: risk.title,
    disposition: risk.disposition,
    productionBackedClosureObserved: risk.productionBackedClosureObserved,
  });

  assert.equal(contract.rppId, 'RPP-0965');
  assert.equal(contract.proofId, 'rpp-0965-objective-audit-update-v4');
  assert.equal(contract.variant, 4);
  assert.deepEqual(report.remainingRisks.map(riskContractFields), contract.remainingRisks.map(riskContractFields));
  assert.deepEqual(
    report.remainingObjectiveRequirementRisks.map(objectiveRiskFields),
    contract.remainingObjectiveRequirementRisks.map(objectiveRiskFields),
  );
  assert.deepEqual(report.closedRisks, contract.closedRisks);
  assert.equal(report.goNoGoRecord.dispositionRule, contract.goNoGoRecord.dispositionRule);
});

test('RPP-0985 carries forward R1-R16 objective risks without production-backed closure proof', () => {
  const { report } = loadEvidenceReport();
  const objectiveRisks = report.remainingObjectiveRequirementRisks;

  assert.equal(objectiveRisks.length, expectedObjectiveRequirements.length);
  assert.deepEqual(objectiveRisks.map((risk) => risk.requirement), expectedObjectiveRequirements);
  assert.equal(report.goNoGoRecord.remainingObjectiveRequirementRiskCount, objectiveRisks.length);

  for (const risk of objectiveRisks) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.title, /\S/);
  }
});

test('RPP-0985 keeps fail-closed risk disposition unless production-backed proof closes a risk', () => {
  const { report } = loadEvidenceReport();
  const allRiskDispositions = [
    ...report.remainingRisks.map((risk) => ({ ...risk, scope: 'final-release' })),
    ...report.remainingObjectiveRequirementRisks.map((risk) => ({ ...risk, scope: 'objective' })),
  ];

  assert.equal(report.goNoGoRecord.productionBackedEvidenceObserved, false);
  assert.equal(report.carriedForwardRiskContract.productionBackedClosureProofAdded, false);
  assert.equal(allRiskDispositions.length, expectedRiskIds.length + expectedObjectiveRequirements.length);

  for (const risk of allRiskDispositions) {
    assert.equal(risk.disposition, 'open');
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.scope, /^(final-release|objective)$/);
  }

  for (const risk of report.closedRisks) {
    assert.equal(risk.disposition, 'closed');
    assert.equal(risk.productionBackedClosureObserved, true);
  }
});

test('RPP-0985 release-gate snapshot matches the current held final-release evaluator', () => {
  const { report } = loadEvidenceReport();
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const gateReport = result.report;

  assert.equal(result.exitCode, 1);
  assert.equal(gateReport.releaseStatus, 'NO-GO');
  assert.equal(gateReport.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(gateReport.primaryFailureBucket, 'topology');
  assert.equal(gateReport.status, 'held');
  assert.equal(gateReport.gateState, 'held');
  assert.equal(gateReport.statusMarker, '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]');
  assert.equal(gateReport.mutationAttempted, false);
  assert.equal(gateReport.releaseMovement.allowed, false);
  assert.equal(gateReport.releaseMovement.finalGates, '3/20');
  assert.equal(gateReport.releaseMovement.candidateGates, '3/20');
  assert.deepEqual(gateReport.totals, {
    gates: 20,
    passed: 3,
    candidate: 0,
    missing: 17,
    failed: 0,
    blocking: 17,
  });

  assert.deepEqual(report.releaseGateSnapshot, {
    command: `node scripts/release/check-release-gates.mjs --scope final-release --now ${fixedNowIso}`,
    exitCode: result.exitCode,
    releaseStatus: gateReport.releaseStatus,
    primaryFailureCode: gateReport.primaryFailureCode,
    primaryFailureBucket: gateReport.primaryFailureBucket,
    status: gateReport.status,
    gateState: gateReport.gateState,
    mutationAttempted: gateReport.mutationAttempted,
    releaseMovementAllowed: gateReport.releaseMovement.allowed,
    finalGates: gateReport.releaseMovement.finalGates,
    candidateGates: gateReport.releaseMovement.candidateGates,
    statusMarker: gateReport.statusMarker,
    totals: gateReport.totals,
  });
  assert.deepEqual(
    gateReport.missingProductionEvidenceBuckets.map((bucket) => ({
      bucket: bucket.bucket,
      gateCount: bucket.gateCount,
      gateIds: bucket.gates.map((gate) => gate.id),
    })),
    expectedBuckets,
  );
  assert.deepEqual(report.missingProductionEvidenceBuckets, expectedBuckets);
  assert.deepEqual(gateReport.releaseMovement.missingEvidence.map((risk) => risk.id), expectedRiskIds);
  assert.deepEqual(gateReport.releaseMovement.missingEvidence.map((risk) => risk.code), expectedRiskCodes);
});

test('RPP-0985 evidence remains redacted and records no release-gate movement', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0985-objective-audit-update-release-verifier-v5.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0985 objective audit update release verifier v5' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(report.evidenceLimits, {
    mode: 'objective-audit-support-only',
    productionMutationAttempted: false,
    rawPayloadsStored: false,
    releaseGateChanged: false,
    releaseGateStatusMovement: 'none',
    progressRecordChanged: false,
    progressPageChanged: false,
    completionChecklistChanged: false,
    statusFilesChanged: false,
    dashboardsStarted: false,
    remoteTunnelsUsed: false,
  });
});

function loadEvidenceReport(pathname = evidencePath) {
  const text = fs.readFileSync(pathname, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${pathname} must contain one JSON record block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
