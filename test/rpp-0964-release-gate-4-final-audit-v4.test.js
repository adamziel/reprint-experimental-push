import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(repoRoot, 'docs/evidence/rpp-0964-release-gate-4-final-audit-v4.md');
const previousAuditPath = path.join(repoRoot, 'docs/evidence/rpp-0944-release-gate-4-final-audit-v3.md');
const operatorDocPath = path.join(repoRoot, 'docs/recovery/operator-safe-recovery.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = 'c104582df4ff541092e64308d160857d393c2347';

const validationCommands = [
  'git rev-parse HEAD',
  'node --check test/rpp-0964-release-gate-4-final-audit-v4.test.js',
  'node --test --test-name-pattern RPP-0964 test/rpp-0964-release-gate-4-final-audit-v4.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0964-release-gate-4-final-audit-v4.md',
  'git diff --check',
];

test('RPP-0964 evidence audits the current GATE-4 lane head without release movement', () => {
  const { text, audit } = loadAudit();

  assert.match(text, /^# RPP-0964 release gate 4 final audit v4$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-964`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.equal(audit.rppId, 'RPP-0964');
  assert.equal(audit.variant, 4);
  assert.equal(audit.auditedBranch, 'session/rpp-964');
  assert.equal(audit.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(audit.gate.id, 'GATE-4');
  assert.equal(audit.gate.title, 'Plugin-Driver Ownership Boundary');
  assert.equal(audit.gate.statusBefore, 'support_only');
  assert.equal(audit.gate.statusAfter, 'support_only');
  assert.equal(audit.gate.movement, 'none');
  assert.equal(audit.gate.releaseVerdict, '0/4');
  assert.equal(audit.gate.finalReleaseStatus, 'NO-GO');
  assert.equal(audit.releaseHold.noReleaseGateMovement, true);
  assert.equal(audit.releaseHold.causesReleaseGateStatusMovement, false);
  assert.equal(audit.releaseHold.noFinalReadinessMovementFromSupportObservations, true);
  assert.equal(audit.releaseHold.finalReleaseRecommendation, 'NO-GO');
  assert.match(text, /Release movement stays held for GATE-4/);
  assertIncludesNormalized(text, 'Support-only observations cannot move final release readiness');
  assertIncludesNormalized(text, 'final release remains `NO-GO`');
});

test('RPP-0964 evidence carries forward the RPP-0944 v3 audit contract', () => {
  const { audit } = loadAudit();
  const { audit: previousAudit } = loadAudit(previousAuditPath);

  assert.equal(audit.carryForward.sourceRppId, previousAudit.rppId);
  assert.equal(audit.carryForward.sourceVariant, previousAudit.variant);
  assert.equal(audit.carryForward.sourceEvidence, 'docs/evidence/rpp-0944-release-gate-4-final-audit-v3.md');
  assert.equal(audit.supportEvidence.patternEvidence, audit.carryForward.sourceEvidence);
  assert.equal(audit.supportEvidence.previousPatternEvidence, previousAudit.supportEvidence.patternEvidence);
  assert.equal(audit.carryForward.carriedForwardWithoutStatusMovement, true);
  assert.ok(audit.carryForward.carriedForwardContract.length >= 7);

  assert.deepEqual(audit.safeRecoveryDocumentation.prerequisites, previousAudit.safeRecoveryDocumentation.prerequisites);
  assert.deepEqual(audit.safeRecoveryDocumentation.recoveryEvidence, previousAudit.safeRecoveryDocumentation.recoveryEvidence);
  assert.deepEqual(audit.safeRecoveryDocumentation.stopConditions, previousAudit.safeRecoveryDocumentation.stopConditions);
  assert.deepEqual(
    audit.safeRecoveryDocumentation.rollbackEscalationBlockers,
    previousAudit.safeRecoveryDocumentation.rollbackEscalationBlockers,
  );
  assert.deepEqual(
    audit.safeRecoveryDocumentation.hiddenAssumptionGuards,
    previousAudit.safeRecoveryDocumentation.hiddenAssumptionGuards,
  );
  assert.equal(audit.safeRecoveryDocumentation.unknownAnswerAction, previousAudit.safeRecoveryDocumentation.unknownAnswerAction);
});

test('RPP-0964 evidence proves operator recovery prerequisites and explicit evidence are named', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  assert.match(operatorDoc, /Variant: RPP-0904 operator docs variant 1/);
  assert.equal(audit.supportEvidence.safeRecoveryDocument, 'docs/recovery/operator-safe-recovery.md');
  assert.equal(audit.supportEvidence.supportOnly, true);
  assert.equal(audit.supportEvidence.productionBacked, false);
  assert.equal(audit.supportEvidence.releaseEligible, false);
  assert.equal(audit.supportEvidence.finalReleaseReadinessImpact, 'none');
  assert.equal(audit.supportEvidence.supportOnlyObservationsCannotMoveFinalReleaseReadiness, true);

  for (const prerequisite of audit.safeRecoveryDocumentation.prerequisites) {
    assertIncludesNormalized(operatorDoc, prerequisite, `operator doc must name prerequisite: ${prerequisite}`);
  }

  for (const operatorEvidence of audit.safeRecoveryDocumentation.operatorEvidence) {
    assertIncludesNormalized(operatorDoc, operatorEvidence, `operator doc must name explicit operator evidence: ${operatorEvidence}`);
  }

  for (const recoveryEvidence of audit.safeRecoveryDocumentation.recoveryEvidence) {
    assertIncludesNormalized(operatorDoc, recoveryEvidence, `operator doc must name recovery evidence: ${recoveryEvidence}`);
  }
});

test('RPP-0964 evidence proves stop conditions block unsafe recovery assumptions', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  for (const stopCondition of audit.safeRecoveryDocumentation.stopConditions) {
    assertIncludesNormalized(operatorDoc, stopCondition, `operator doc must name stop condition: ${stopCondition}`);
  }

  assert.equal(audit.safeRecoveryDocumentation.unknownAnswerAction, 'blocked-recovery');
  assertIncludesNormalized(operatorDoc, 'Missing evidence is not evidence that the remote is old or fully updated');
  assertIncludesNormalized(operatorDoc, 'release movement');
  assertIncludesNormalized(operatorDoc, 'Final release remains `NO-GO`');
});

test('RPP-0964 evidence proves rollback and escalation blockers are named before release movement', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  for (const blocker of audit.safeRecoveryDocumentation.rollbackEscalationBlockers) {
    assertIncludesNormalized(operatorDoc, blocker, `operator doc must name rollback/escalation blocker: ${blocker}`);
  }

  assertIncludesNormalized(operatorDoc, 'open a recovery review');
  assertIncludesNormalized(operatorDoc, 'storage rollback');
  assertIncludesNormalized(operatorDoc, 'release-gate movement');
});

test('RPP-0964 evidence proves hidden-assumption guards are named before retry or finalization', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  for (const guard of audit.safeRecoveryDocumentation.hiddenAssumptionGuards) {
    assertIncludesNormalized(operatorDoc, guard, `operator doc must name hidden-assumption guard: ${guard}`);
  }

  assertIncludesNormalized(operatorDoc, 'Before any retry or finalization, answer each check explicitly in the audit record');
  assertIncludesNormalized(operatorDoc, 'If any answer is no or unknown, the operator must use `blocked-recovery`');
});

test('RPP-0964 evidence keeps release-gate status and redaction posture held', () => {
  const { text, audit } = loadAudit();
  const releaseGates = readText(releaseGatesPath);
  const gate4 = sectionFor(releaseGates, '## GATE-4: Plugin-Driver Ownership Boundary');

  assert.match(releaseGates, /`release_verdict`: `0\/4`/);
  assert.doesNotMatch(releaseGates, /RPP-0964/);
  assert.match(gate4, /Status: `support_only`/);
  assert.equal(audit.releaseHold.noStatusFileMutation, true);
  assert.equal(audit.releaseHold.noProductionRepairAuthorized, true);
  assert.match(audit.releaseHold.integrationRecommendation, /^NO-GO until GATE-4/);
  assert.equal(audit.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(audit.redactionPosture.credentialsIncluded, false);
  assert.equal(audit.redactionPosture.cookiesIncluded, false);
  assert.equal(audit.redactionPosture.privatePathsIncluded, false);
  assert.equal(audit.redactionPosture.liveServiceConfigurationIncluded, false);

  for (const command of validationCommands) {
    assert.ok(text.includes(`\`${command}\``), `missing validation command: ${command}`);
  }
});

function loadAudit(filePath = auditPath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.basename(filePath)} must contain one JSON block`);
  return {
    text,
    audit: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertIncludesNormalized(text, expected, message = `expected text to include ${expected}`) {
  assert.ok(normalize(text).includes(normalize(expected)), message);
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function sectionFor(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing section ${heading}`);

  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? text.length : next);
}
