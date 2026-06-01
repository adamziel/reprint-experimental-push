import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guidePath = path.join(repoRoot, 'docs/support/escalation-guide.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0917-support-escalation-guide.md');

const expectedTriggerIds = Object.freeze(['SE-01', 'SE-02', 'SE-03', 'SE-04', 'SE-05', 'SE-06']);

const expectedValidationCommands = Object.freeze([
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:06:00.000Z',
  'node --check test/rpp-0917-support-escalation-guide.test.js',
  'node --test --test-name-pattern RPP-0917 test/rpp-0917-support-escalation-guide.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/support/escalation-guide.md docs/evidence/rpp-0917-support-escalation-guide.md',
  'git diff --check',
]);

test('RPP-0917 guide defines support-only escalation with production evidence required', () => {
  const guide = readText(guidePath);

  assert.match(guide, /^# Support Escalation Guide$/m);
  assert.match(guide, /Variant: RPP-0917 support escalation guide variant 1/);
  assert.match(guide, /^Status: support-only, release blocking$/m);
  assert.match(guide, /Release gate status moves only after production-backed evidence is present/);
  assert.match(guide, /Support escalation evidence is support-only evidence/);
  assert.match(guide, /Support escalation alone never changes release gate status/);
  assert.match(guide, /Missing production-backed evidence keeps the final release at \*\*NO-GO\*\*/);
  assert.match(guide, /must not start remote tunnel services/);
  assert.match(
    guide,
    /\[RPP-0917 support escalation guide evidence\]\(\.\.\/evidence\/rpp-0917-support-escalation-guide\.md\)/,
  );

  for (const triggerId of expectedTriggerIds) {
    assert.ok(guide.includes(`| ${triggerId} |`), `${triggerId} must be listed in the guide`);
    assert.match(rowFor(guide, triggerId), /\| Blocked \|$/);
  }

  assert.match(guide, /Final release remains \*\*NO-GO\*\*/);
});

test('RPP-0917 evidence records no release eligibility from support escalation alone', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0917');
  assert.equal(report.sliceId, 'RPP-0917');
  assert.equal(report.proofId, 'rpp-0917-support-escalation-guide-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.auditedBranch, 'session/rpp-917');
  assert.equal(report.auditedLaneHeadBeforeEvidence, '521f2234688fc66919b421bb5c42d36aa2e437fd');
  assert.equal(report.status, 'support-only-escalation-guide-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.documents, {
    guide: 'docs/support/escalation-guide.md',
    evidence: 'docs/evidence/rpp-0917-support-escalation-guide.md',
  });

  assert.deepEqual(report.supportEscalationRule, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    currentEscalationMovementAttempted: false,
    productionBackedEvidenceObserved: false,
    requiredEvidenceForMovement: 'production-backed',
    supportEscalationEffect: 'no-movement',
    missingProductionBackedProofEffect: 'blocks-release-gate-movement',
    finalReleaseRequiredPosture: 'NO-GO',
    rule: 'Support escalation can classify and preserve evidence, but release gate status cannot move without production-backed evidence.',
  });

  assert.deepEqual(report.handoffContract, {
    supportMayEscalate: true,
    supportMayApproveReleaseMovement: false,
    supportMayChangeGateStatus: false,
    requiresMissingProductionProofNamed: true,
    requiresAffectedGateNamed: true,
    requiresCurrentSupportOnlyStatusNamed: true,
    requiresProductionBackedReevaluation: true,
    absentProductionProofAction: 'keep-gate-unchanged-and-final-release-NO-GO',
  });
});

test('RPP-0917 escalation triggers require production proof and forbid gate movement', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.escalationTriggers.map((trigger) => trigger.id), expectedTriggerIds);

  for (const trigger of report.escalationTriggers) {
    assert.equal(trigger.productionEvidenceRequired, true, `${trigger.id} must require production proof`);
    assert.equal(trigger.productionBacked, false, `${trigger.id} must not claim production-backed proof`);
    assert.equal(trigger.releaseGateMovementAllowed, false, `${trigger.id} must forbid gate movement`);
    assert.equal(trigger.releaseEffect, 'blocked', `${trigger.id} must keep release blocked`);
    assert.match(trigger.gateArea, /\S/, `${trigger.id} must name a gate area`);
    assert.match(trigger.supportAction, /\S/, `${trigger.id} must name support action`);
    assert.match(trigger.requiredProductionProof, /^Fresh operator proof|^Production-backed proof|^Production-backed journal|^Production-backed redacted|^Production-backed release gate/);
  }
});

test('RPP-0917 final release gate remains NO-GO without production-backed evidence', () => {
  const { report } = loadEvidenceReport();
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
  });

  assert.deepEqual(report.statusRowReadback, {
    path: '.agents/RELEASE_GATES.md',
    releaseVerdict: '0/4',
    releaseStatus: 'NO-GO',
    gateStatuses: {
      'GATE-1': 'support_only',
      'GATE-2': 'support_only',
      'GATE-3': 'support_only',
      'GATE-4': 'support_only',
    },
    statusCounts: {
      support_only: 4,
    },
  });

  assert.equal(
    report.releaseGateExpectation.command,
    'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:06:00.000Z',
  );
  assert.equal(result.exitCode, report.releaseGateExpectation.expectedExit);
  assert.equal(result.report.releaseStatus, report.releaseGateExpectation.expectedReleaseStatus);
  assert.equal(result.report.primaryFailureCode, report.releaseGateExpectation.expectedPrimaryFailureCode);
  assert.equal(result.report.primaryFailureBucket, report.releaseGateExpectation.expectedPrimaryFailureBucket);
  assert.equal(result.report.mutationAttempted, report.releaseGateExpectation.expectedMutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.releaseGateExpectation.expectedReleaseMovementAllowed);
  assert.equal(result.report.statusMarker, report.releaseGateExpectation.expectedStatusMarker);
});

test('RPP-0917 artifacts are redacted and record exact validation commands', async () => {
  const guide = readText(guidePath);
  const { text, report } = loadEvidenceReport();
  const scan = await scanArtifacts([
    'docs/support/escalation-guide.md',
    'docs/evidence/rpp-0917-support-escalation-guide.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0917 support escalation guide evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(guide.includes('http://'), false);
  assert.equal(guide.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);

  assert.deepEqual(report.validationCommands.map((entry) => entry.command), expectedValidationCommands);
  for (const entry of report.validationCommands) {
    assert.equal(Number.isInteger(entry.expectedExit), true, `${entry.command} expected exit`);
    assert.equal(typeof entry.observed, 'string', `${entry.command} observed result`);
    assert.ok(entry.observed.length > 0, `${entry.command} observed result`);
  }

  assert.equal(report.evidenceLimits.mutationAttempted, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.statusFilesChanged, false);
  assert.match(text, /Gate movement therefore remains blocked/);
  assert.match(text, /final release remains \*\*NO-GO\*\*/);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0917 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function rowFor(text, triggerId) {
  const row = text.split('\n').find((line) => line.startsWith(`| ${triggerId} |`));

  assert.ok(row, `${triggerId} row must exist`);
  return row;
}
