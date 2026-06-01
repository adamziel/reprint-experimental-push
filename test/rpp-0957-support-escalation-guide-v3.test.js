import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0957-support-escalation-guide-v3.md');

const expectedOwnerIds = Object.freeze([
  'SUPPORT_TRIAGE_LEAD',
  'PRODUCTION_EVIDENCE_OWNER',
  'RELEASE_GATE_OWNER',
]);

const expectedPrerequisiteIds = Object.freeze([
  'PREREQ-01',
  'PREREQ-02',
  'PREREQ-03',
  'PREREQ-04',
  'PREREQ-05',
]);

const expectedStopConditionIds = Object.freeze(['STOP-01', 'STOP-02', 'STOP-03', 'STOP-04', 'STOP-05']);
const expectedTriggerIds = Object.freeze(['SE-01', 'SE-02', 'SE-03', 'SE-04', 'SE-05', 'SE-06']);

const expectedValidationCommands = Object.freeze([
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:25:00.000Z',
  'node --check test/rpp-0957-support-escalation-guide-v3.test.js',
  'node --test --test-name-pattern RPP-0957 test/rpp-0957-support-escalation-guide-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0957-support-escalation-guide-v3.md',
  'git diff --check',
]);

test('RPP-0957 evidence records support-only escalation guide v3 with held release posture', () => {
  const { text, report } = loadEvidenceReport();

  assert.match(text, /^# RPP-0957 support escalation guide v3 evidence$/m);
  assert.match(text, /Audited local branch: `session\/rpp-957`/);
  assert.match(text, /Status: support-only, release blocking/);
  assert.match(text, /Support-only observations can name escalation owners, triggers, prerequisites/);
  assert.match(text, /cannot\s+approve final release readiness/);
  assert.match(text, /keeps the final release at \*\*NO-GO\*\*/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0957');
  assert.equal(report.sliceId, 'RPP-0957');
  assert.equal(report.proofId, 'rpp-0957-support-escalation-guide-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.auditedBranch, 'session/rpp-957');
  assert.equal(report.auditedLaneHeadBeforeEvidence, '30579db75230cd3734020a5a298d7393046caf90');
  assert.equal(report.status, 'support-only-escalation-guide-v3-recorded');
  assert.equal(report.supportEscalationStatus, 'support-only-held');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.verdict, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.finalReleaseReadiness, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.documents, {
    evidence: 'docs/evidence/rpp-0957-support-escalation-guide-v3.md',
    patternEvidence: 'docs/evidence/rpp-0937-support-escalation-guide-v2.md',
  });

  assert.deepEqual(report.supportEscalationRule, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    releaseGateStatusMovement: 'none',
    currentEscalationMovementAttempted: false,
    productionBackedEvidenceObserved: false,
    everyReleaseGateMovementRequiresProductionBackedEvidence: true,
    supportOnlyObservationsCanMoveFinalRelease: false,
    supportOnlyEscalationObservationsCanMoveFinalReleaseReadiness: false,
    requiredEvidenceForMovement: 'production-backed',
    supportEscalationEffect: 'classify-preserve-and-escalate-without-release-credit',
    missingProductionBackedProofEffect: 'blocks-release-gate-movement',
    finalReleaseRequiredPosture: 'NO-GO',
    rule: 'Release gate status moves only with production-backed evidence; support-only observations can name owners, triggers, prerequisites, and stop conditions but cannot move final release readiness.',
  });
});

test('RPP-0957 owners, prerequisites, and stop conditions are named but cannot move release', () => {
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

  assert.deepEqual(report.escalationPrerequisites.map((prerequisite) => prerequisite.id), expectedPrerequisiteIds);
  for (const prerequisite of report.escalationPrerequisites) {
    assert.match(prerequisite.name, /\S/, `${prerequisite.id} must have a named prerequisite`);
    assert.match(prerequisite.requirement, /\S/, `${prerequisite.id} must describe its requirement`);
    assert.ok(expectedOwnerIds.includes(prerequisite.ownerId), `${prerequisite.id} must name an escalation owner`);
    assert.equal(
      prerequisite.productionBackedEvidenceObserved,
      false,
      `${prerequisite.id} must not claim production-backed evidence`,
    );
    assert.equal(
      prerequisite.movementRequiresProductionBackedEvidence,
      true,
      `${prerequisite.id} must require production-backed evidence before movement`,
    );
    assert.equal(prerequisite.releaseGateMovementAllowed, false, `${prerequisite.id} must block gate movement`);
    assert.equal(prerequisite.finalReleaseMovementAllowed, false, `${prerequisite.id} must block final release`);
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
    supportOnlyObservationsMayMoveFinalReleaseReadiness: false,
    requiresEscalationOwnerNamed: true,
    requiresEscalationTriggerNamed: true,
    requiresEscalationPrerequisiteNamed: true,
    requiresStopConditionNamed: true,
    requiresMissingProductionProofNamed: true,
    requiresAffectedGateNamed: true,
    requiresCurrentSupportOnlyStatusNamed: true,
    requiresProductionBackedReevaluation: true,
    absentProductionProofAction: 'keep-gate-unchanged-and-final-release-NO-GO',
  });
});

test('RPP-0957 escalation triggers require production proof and bind owner prerequisites stop conditions', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.escalationTriggers.map((trigger) => trigger.id), expectedTriggerIds);

  for (const trigger of report.escalationTriggers) {
    assert.ok(expectedOwnerIds.includes(trigger.ownerId), `${trigger.id} must name an escalation owner`);
    assert.ok(
      expectedPrerequisiteIds.includes(trigger.prerequisiteId),
      `${trigger.id} must name a prerequisite`,
    );
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

test('RPP-0957 final release gate remains NO-GO and no release-gate status movement occurs', () => {
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
    releaseGateStatusMovement: 'none',
  });

  assert.equal(
    report.releaseGateExpectation.command,
    'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:25:00.000Z',
  );
  assert.equal(result.exitCode, report.releaseGateExpectation.expectedExit);
  assert.equal(result.report.releaseStatus, report.releaseGateExpectation.expectedReleaseStatus);
  assert.equal(result.report.gateState, report.releaseGateExpectation.expectedGateState);
  assert.equal(result.report.primaryFailureCode, report.releaseGateExpectation.expectedPrimaryFailureCode);
  assert.equal(result.report.primaryFailureBucket, report.releaseGateExpectation.expectedPrimaryFailureBucket);
  assert.equal(result.report.mutationAttempted, report.releaseGateExpectation.expectedMutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.releaseGateExpectation.expectedReleaseMovementAllowed);
  assert.equal(report.releaseGateExpectation.expectedReleaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(
    report.supportEscalationRule.supportOnlyObservationsCanMoveFinalRelease,
    report.releaseGateExpectation.expectedSupportOnlyObservationsCanMoveFinalRelease,
  );
  assert.equal(
    report.supportEscalationRule.supportOnlyEscalationObservationsCanMoveFinalReleaseReadiness,
    report.releaseGateExpectation.expectedSupportOnlyObservationsCanMoveFinalReleaseReadiness,
  );
  assert.equal(result.report.statusMarker, report.releaseGateExpectation.expectedStatusMarker);
});

test('RPP-0957 artifact is redacted and records exact validation commands', async () => {
  const { text, report } = loadEvidenceReport();
  const scan = await scanArtifacts(['docs/evidence/rpp-0957-support-escalation-guide-v3.md'], {
    cwd: repoRoot,
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0957 support escalation guide v3 evidence' }));
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
  assert.equal(report.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
  assert.equal(report.evidenceLimits.finalReleaseReadinessChanged, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.statusFilesChanged, false);
  assert.equal(report.evidenceLimits.dashboardsStarted, false);
  assert.equal(report.evidenceLimits.remoteTunnelsUsed, false);
  assert.match(text, /Gate movement\s+remains blocked/);
  assert.match(text, /support-only escalation observations cannot move final release\s+readiness/);
  assert.match(text, /final release remains \*\*NO-GO\*\*/);
  assert.match(text, /release-gate status movement is\s+`none`/);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0957 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
