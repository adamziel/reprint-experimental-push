import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0937-support-escalation-guide-v2.md');

const expectedOwnerIds = Object.freeze([
  'SUPPORT_TRIAGE_LEAD',
  'PRODUCTION_EVIDENCE_OWNER',
  'RELEASE_GATE_OWNER',
]);

const expectedStopConditionIds = Object.freeze(['STOP-01', 'STOP-02', 'STOP-03', 'STOP-04', 'STOP-05']);
const expectedTriggerIds = Object.freeze(['SE-01', 'SE-02', 'SE-03', 'SE-04', 'SE-05', 'SE-06']);

const expectedValidationCommands = Object.freeze([
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:40:00.000Z',
  'node --check test/rpp-0937-support-escalation-guide-v2.test.js',
  'node --test --test-name-pattern RPP-0937 test/rpp-0937-support-escalation-guide-v2.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0937-support-escalation-guide-v2.md',
  'git diff --check',
]);

test('RPP-0937 evidence records support-only escalation guide v2 with held release posture', () => {
  const { text, report } = loadEvidenceReport();

  assert.match(text, /^# RPP-0937 support escalation guide v2 evidence$/m);
  assert.match(text, /Audited local branch: `session\/rpp-937`/);
  assert.match(text, /Status: support-only, release blocking/);
  assert.match(text, /Support-only observations can name escalation owners/);
  assert.match(text, /cannot approve final release/);
  assert.match(text, /keeps the final release at \*\*NO-GO\*\*/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0937');
  assert.equal(report.sliceId, 'RPP-0937');
  assert.equal(report.proofId, 'rpp-0937-support-escalation-guide-v2');
  assert.equal(report.variant, 2);
  assert.equal(report.auditedBranch, 'session/rpp-937');
  assert.equal(report.auditedLaneHeadBeforeEvidence, 'f910defefe3f5e5cde760c720408fac2b56e94e9');
  assert.equal(report.status, 'support-only-escalation-guide-v2-recorded');
  assert.equal(report.supportEscalationStatus, 'support-only-held');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.verdict, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.documents, {
    evidence: 'docs/evidence/rpp-0937-support-escalation-guide-v2.md',
    patternEvidence: 'docs/evidence/rpp-0917-support-escalation-guide.md',
  });

  assert.deepEqual(report.supportEscalationRule, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    currentEscalationMovementAttempted: false,
    productionBackedEvidenceObserved: false,
    supportOnlyObservationsCanMoveFinalRelease: false,
    requiredEvidenceForMovement: 'production-backed',
    supportEscalationEffect: 'classify-preserve-and-escalate-without-release-credit',
    missingProductionBackedProofEffect: 'blocks-release-gate-movement',
    finalReleaseRequiredPosture: 'NO-GO',
    rule: 'Release gate status moves only with production-backed evidence; support-only observations can name owners and stop conditions but cannot move final release.',
  });
});

test('RPP-0937 owners and stop conditions are named but cannot move release from support-only evidence', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.escalationOwners.map((owner) => owner.id), expectedOwnerIds);
  for (const owner of report.escalationOwners) {
    assert.match(owner.name, /\S/, `${owner.id} must have a name`);
    assert.match(owner.responsibility, /\S/, `${owner.id} must describe responsibility`);
    assert.match(owner.releaseGateAuthority, /\S/, `${owner.id} must name release authority`);
    assert.equal(
      owner.supportOnlyReleaseGateMovementAllowed,
      false,
      `${owner.id} must not move gate status from support-only evidence`,
    );
    assert.equal(
      owner.movementRequiresProductionBackedEvidence,
      true,
      `${owner.id} must require production-backed evidence for movement`,
    );
  }

  assert.deepEqual(report.stopConditions.map((condition) => condition.id), expectedStopConditionIds);
  for (const condition of report.stopConditions) {
    assert.match(condition.name, /\S/, `${condition.id} must have a named stop condition`);
    assert.match(condition.condition, /\S/, `${condition.id} must describe the stopping condition`);
    assert.ok(expectedOwnerIds.includes(condition.ownerId), `${condition.id} must name an escalation owner`);
    assert.match(condition.releaseAction, /NO-GO|held|reject|hold/, `${condition.id} must name a blocking action`);
    assert.equal(condition.releaseGateMovementAllowed, false, `${condition.id} must block gate movement`);
    assert.equal(condition.finalReleaseMovementAllowed, false, `${condition.id} must block final release movement`);
  }

  assert.deepEqual(report.handoffContract, {
    supportMayEscalate: true,
    supportMayApproveReleaseMovement: false,
    supportMayChangeGateStatus: false,
    supportOnlyObservationsMayMoveFinalRelease: false,
    requiresEscalationOwnerNamed: true,
    requiresStopConditionNamed: true,
    requiresMissingProductionProofNamed: true,
    requiresAffectedGateNamed: true,
    requiresCurrentSupportOnlyStatusNamed: true,
    requiresProductionBackedReevaluation: true,
    absentProductionProofAction: 'keep-gate-unchanged-and-final-release-NO-GO',
  });
});

test('RPP-0937 escalation triggers require production proof and bind owner stop conditions', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.escalationTriggers.map((trigger) => trigger.id), expectedTriggerIds);

  for (const trigger of report.escalationTriggers) {
    assert.ok(expectedOwnerIds.includes(trigger.ownerId), `${trigger.id} must name an escalation owner`);
    assert.ok(
      expectedStopConditionIds.includes(trigger.stopConditionId),
      `${trigger.id} must name a stop condition`,
    );
    assert.equal(trigger.productionEvidenceRequired, true, `${trigger.id} must require production proof`);
    assert.equal(trigger.productionBacked, false, `${trigger.id} must not claim production-backed proof`);
    assert.equal(trigger.releaseGateMovementAllowed, false, `${trigger.id} must forbid gate movement`);
    assert.equal(trigger.finalReleaseMovementAllowed, false, `${trigger.id} must forbid final release movement`);
    assert.equal(trigger.releaseEffect, 'blocked', `${trigger.id} must keep release blocked`);
    assert.match(trigger.gateArea, /\S/, `${trigger.id} must name a gate area`);
    assert.match(trigger.supportAction, /\S/, `${trigger.id} must name support action`);
    assert.match(
      trigger.requiredProductionProof,
      /^Fresh operator proof|^Production-backed proof|^Production-backed journal|^Production-backed redacted|^Production-backed release gate/,
    );
  }
});

test('RPP-0937 final release gate remains NO-GO without production-backed evidence', () => {
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
    'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:40:00.000Z',
  );
  assert.equal(result.exitCode, report.releaseGateExpectation.expectedExit);
  assert.equal(result.report.releaseStatus, report.releaseGateExpectation.expectedReleaseStatus);
  assert.equal(result.report.gateState, report.releaseGateExpectation.expectedGateState);
  assert.equal(result.report.primaryFailureCode, report.releaseGateExpectation.expectedPrimaryFailureCode);
  assert.equal(result.report.primaryFailureBucket, report.releaseGateExpectation.expectedPrimaryFailureBucket);
  assert.equal(result.report.mutationAttempted, report.releaseGateExpectation.expectedMutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.releaseGateExpectation.expectedReleaseMovementAllowed);
  assert.equal(
    report.supportEscalationRule.supportOnlyObservationsCanMoveFinalRelease,
    report.releaseGateExpectation.expectedSupportOnlyObservationsCanMoveFinalRelease,
  );
  assert.equal(result.report.statusMarker, report.releaseGateExpectation.expectedStatusMarker);
});

test('RPP-0937 artifact is redacted and records exact validation commands', async () => {
  const { text, report } = loadEvidenceReport();
  const scan = await scanArtifacts(['docs/evidence/rpp-0937-support-escalation-guide-v2.md'], {
    cwd: repoRoot,
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0937 support escalation guide v2 evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
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
  assert.equal(report.evidenceLimits.supportGuideFilesChanged, false);
  assert.match(text, /Gate movement\s+remains blocked/);
  assert.match(text, /support-only observations cannot move final release/);
  assert.match(text, /final\s+release remains \*\*NO-GO\*\*/);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0937 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
