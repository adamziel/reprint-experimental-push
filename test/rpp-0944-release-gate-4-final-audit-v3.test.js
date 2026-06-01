import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(repoRoot, 'docs/evidence/rpp-0944-release-gate-4-final-audit-v3.md');
const operatorDocPath = path.join(repoRoot, 'docs/recovery/operator-safe-recovery.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = '229018343b63597f12393fb3d710ab7ff6876cff';

const validationCommands = [
  'git rev-parse HEAD',
  'node --check test/rpp-0944-release-gate-4-final-audit-v3.test.js',
  'node --test --test-name-pattern RPP-0944 test/rpp-0944-release-gate-4-final-audit-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0944-release-gate-4-final-audit-v3.md',
  'git diff --check',
];

test('RPP-0944 evidence audits the current GATE-4 lane head without release movement', () => {
  const { text, audit } = loadAudit();

  assert.match(text, /^# RPP-0944 release gate 4 final audit v3$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-944`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.equal(audit.rppId, 'RPP-0944');
  assert.equal(audit.variant, 3);
  assert.equal(audit.auditedBranch, 'session/rpp-944');
  assert.equal(audit.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(audit.gate.id, 'GATE-4');
  assert.equal(audit.gate.title, 'Plugin-Driver Ownership Boundary');
  assert.equal(audit.gate.statusBefore, 'support_only');
  assert.equal(audit.gate.statusAfter, 'support_only');
  assert.equal(audit.gate.movement, 'none');
  assert.equal(audit.gate.releaseVerdict, '0/4');
  assert.equal(audit.gate.finalReleaseStatus, 'NO-GO');
  assert.equal(audit.releaseHold.noReleaseGateMovement, true);
  assert.equal(audit.releaseHold.noFinalReadinessMovementFromSupportObservations, true);
  assert.equal(audit.releaseHold.finalReleaseRecommendation, 'NO-GO');
  assert.match(text, /Release movement stays held for GATE-4/);
  assert.match(text, /Support-only observations cannot move final release readiness/);
  assertIncludesNormalized(text, 'final release remains `NO-GO`');
});

test('RPP-0944 evidence proves operator recovery prerequisites and evidence are explicit', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  assert.match(operatorDoc, /Variant: RPP-0904 operator docs variant 1/);
  assert.equal(audit.supportEvidence.safeRecoveryDocument, 'docs/recovery/operator-safe-recovery.md');
  assert.equal(audit.supportEvidence.patternEvidence, 'docs/evidence/rpp-0924-release-gate-4-final-audit-v2.md');
  assert.equal(audit.supportEvidence.supportOnly, true);
  assert.equal(audit.supportEvidence.productionBacked, false);
  assert.equal(audit.supportEvidence.releaseEligible, false);
  assert.equal(audit.supportEvidence.finalReleaseReadinessImpact, 'none');
  assert.equal(audit.supportEvidence.supportOnlyObservationsCannotMoveFinalReleaseReadiness, true);

  for (const prerequisite of audit.safeRecoveryDocumentation.prerequisites) {
    assertIncludesNormalized(operatorDoc, prerequisite, `operator doc must name prerequisite: ${prerequisite}`);
  }

  for (const recoveryEvidence of audit.safeRecoveryDocumentation.recoveryEvidence) {
    assertIncludesNormalized(operatorDoc, recoveryEvidence, `operator doc must name recovery evidence: ${recoveryEvidence}`);
  }
});

test('RPP-0944 evidence proves stop conditions block unsafe recovery assumptions', () => {
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

test('RPP-0944 evidence proves rollback and escalation blockers are named before release movement', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  for (const blocker of audit.safeRecoveryDocumentation.rollbackEscalationBlockers) {
    assertIncludesNormalized(operatorDoc, blocker, `operator doc must name rollback/escalation blocker: ${blocker}`);
  }

  assertIncludesNormalized(operatorDoc, 'open a recovery review');
  assertIncludesNormalized(operatorDoc, 'storage rollback');
  assertIncludesNormalized(operatorDoc, 'release-gate movement');
});

test('RPP-0944 evidence proves hidden-assumption guards are named before retry or finalization', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  for (const guard of audit.safeRecoveryDocumentation.hiddenAssumptionGuards) {
    assertIncludesNormalized(operatorDoc, guard, `operator doc must name hidden-assumption guard: ${guard}`);
  }

  assertIncludesNormalized(operatorDoc, 'Before any retry or finalization, answer each check explicitly in the audit record');
  assertIncludesNormalized(operatorDoc, 'If any answer is no or unknown, the operator must use `blocked-recovery`');
});

test('RPP-0944 evidence keeps release-gate status and redaction posture held', () => {
  const { text, audit } = loadAudit();
  const releaseGates = readText(releaseGatesPath);
  const gate4 = sectionFor(releaseGates, '## GATE-4: Plugin-Driver Ownership Boundary');

  assert.match(releaseGates, /`release_verdict`: `0\/4`/);
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

function loadAudit() {
  const text = readText(auditPath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0944 audit must contain one JSON block');
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
