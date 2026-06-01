import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  parseAgentsReleaseGatesStatusRow,
  readAgentsReleaseGatesStatusRow,
} from '../scripts/release/agents-release-gates-status-row.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0969-operator-runbook-v4.md');
const contractEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0949-operator-runbook-v3.md');
const runbookPath = path.join(repoRoot, 'docs/operations/operator-runbook.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = '2904a4ed5ed3239fb32ca5cf704561f8360f0b0d';
const heldGateStatuses = Object.freeze([
  'support_only',
  'support_only',
  'support_only',
  'support_only',
]);
const validationCommands = Object.freeze([
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs',
  'node --check test/rpp-0969-operator-runbook-v4.test.js',
  'node --test --test-name-pattern RPP-0969 test/rpp-0969-operator-runbook-v4.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0969-operator-runbook-v4.md',
  'git diff --check',
]);

test('RPP-0969 evidence audits the operator runbook lane head with verdict held', () => {
  const { text, report } = loadEvidenceReport(evidencePath);

  assert.match(text, /^# RPP-0969 Operator Runbook Evidence Variant 4$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-969`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0969');
  assert.equal(report.proofId, 'rpp-0969-operator-runbook-v4');
  assert.equal(report.variant, 4);
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-969');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(report.documents.operatorRunbook, 'docs/operations/operator-runbook.md');
  assert.equal(report.documents.contractSourceEvidence, 'docs/evidence/rpp-0949-operator-runbook-v3.md');
  assert.equal(report.operatorRunbookContract.carriedForwardFrom, 'RPP-0949 operator runbook v3');
  assert.equal(report.operatorRunbookContract.releaseGateMovement, 'none');
  assert.equal(report.operatorRunbookContract.releaseVerdictHeld, true);
  assert.equal(report.releaseHold.noReleaseGateMovement, true);
  assert.equal(report.releaseHold.releaseGateStatusMoved, false);
  assert.equal(report.releaseHold.finalReleaseRecommendation, 'NO-GO');
});

test('RPP-0969 carries forward the RPP-0949 v3 operator-runbook contract', () => {
  const { report } = loadEvidenceReport(evidencePath);
  const { report: contract } = loadEvidenceReport(contractEvidencePath);

  assert.deepEqual(report.productionPrerequisitesBeforeMutation, contract.productionPrerequisitesBeforeMutation);
  assert.deepEqual(report.recoveryEvidenceRequired, contract.recoveryEvidenceRequired);
  assert.deepEqual(report.stopConditions, contract.stopConditions);
  assert.deepEqual(report.rollbackAndEscalationPaths, contract.rollbackAndEscalationPaths);
  assert.deepEqual(report.hiddenAssumptionBlockers, contract.hiddenAssumptionBlockers);
  assert.deepEqual(report.lifecycleGuards, contract.lifecycleGuards);
  assert.deepEqual(report.recoveryPolicy, contract.recoveryPolicy);
  assert.deepEqual(report.supportOnlyObservationLimits, contract.supportOnlyObservationLimits);
  assert.deepEqual(report.releaseHold.statusMovementProof, contract.releaseHold.statusMovementProof);
  assert.deepEqual(report.contractCarryForward, {
    sourceRppId: 'RPP-0949',
    sourceProofId: 'rpp-0949-operator-runbook-v3',
    sourceVariant: 3,
    samePrerequisites: true,
    sameRecoveryEvidence: true,
    sameStopConditions: true,
    sameRollbackAndEscalationPaths: true,
    sameHiddenAssumptionBlockers: true,
    sameRecoveryPolicy: true,
    sameReleaseHold: true,
  });
});

test('RPP-0969 operator runbook names safe recovery prerequisites before mutation', () => {
  const runbook = readText(runbookPath);
  const { report } = loadEvidenceReport(evidencePath);

  assert.match(runbook, /^# Reprint Push Operator Runbook$/m);
  assertIncludesNormalized(runbook, 'Record every prerequisite before starting production apply work');
  assertIncludesNormalized(runbook, 'If any item is missing or unknown, stop before mutation');

  for (const prerequisite of report.productionPrerequisitesBeforeMutation) {
    assertIncludesNormalized(
      runbook,
      prerequisite,
      `operator runbook must name prerequisite before mutation: ${prerequisite}`,
    );
  }
});

test('RPP-0969 operator runbook names explicit recovery evidence and rollback escalation paths', () => {
  const runbook = readText(runbookPath);
  const { report } = loadEvidenceReport(evidencePath);

  assertIncludesNormalized(runbook, 'Capture enough evidence for another operator to reconstruct the decision');
  assertIncludesNormalized(runbook, 'checked recovery path used for inspection and any retry or finalization');

  for (const evidence of report.recoveryEvidenceRequired) {
    assertIncludesNormalized(
      runbook,
      evidence,
      `operator runbook must name recovery evidence: ${evidence}`,
    );
  }

  for (const recoveryPath of report.rollbackAndEscalationPaths) {
    assertIncludesNormalized(
      runbook,
      recoveryPath,
      `operator runbook must name rollback/escalation path: ${recoveryPath}`,
    );
  }

  assert.deepEqual(report.recoveryPolicy.acceptableStates, [
    'old-remote',
    'fully-updated-remote',
    'blocked-recovery',
  ]);
  assert.equal(report.recoveryPolicy.unknownStateAction, 'blocked-recovery');
  assert.equal(report.recoveryPolicy.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.recoveryPolicy.sameRecoveryPathRequired, true);
  assert.equal(report.recoveryPolicy.samePlanEnvelopeRequired, true);
  assert.equal(report.recoveryPolicy.manualPatchingAllowed, false);
});

test('RPP-0969 operator runbook names stop conditions and hidden-assumption blockers', () => {
  const runbook = readText(runbookPath);
  const { report } = loadEvidenceReport(evidencePath);

  assertIncludesNormalized(runbook, 'Stop immediately and preserve artifacts when any condition below is true');

  for (const stopCondition of report.stopConditions) {
    assertIncludesNormalized(
      runbook,
      stopCondition,
      `operator runbook must name stop condition: ${stopCondition}`,
    );
  }

  assertIncludesNormalized(runbook, 'Before retry, finalization, cleanup, or escalation');

  for (const blocker of report.hiddenAssumptionBlockers) {
    assertIncludesNormalized(
      runbook,
      blocker,
      `operator runbook must name hidden-assumption blocker: ${blocker}`,
    );
  }

  assertIncludesNormalized(runbook, report.lifecycleGuards.beforeMutation);
  assertIncludesNormalized(runbook, report.lifecycleGuards.beforeRetryFinalizationCleanupOrEscalation);
  assertIncludesNormalized(runbook, report.lifecycleGuards.releaseMovementBlockedWhenStopped);
  assertIncludesNormalized(runbook, 'An unknown answer stops the run');
  assert.equal(report.lifecycleGuards.unknownAnswerAction, 'blocked-recovery');
});

test('RPP-0969 keeps final release NO-GO and causes no release-gate status movement', () => {
  const { report, text } = loadEvidenceReport(evidencePath);
  const sourceMarkdown = readText(releaseGatesPath);
  const row = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const parsed = parseAgentsReleaseGatesStatusRow(sourceMarkdown, {
    path: '.agents/RELEASE_GATES.md',
    scope: 'final-release',
  });

  assert.deepEqual(row, parsed);
  assert.equal(row.ok, true);
  assert.equal(row.evidence.releaseVerdict, '0/4');
  assert.equal(row.evidence.releaseStatus, 'NO-GO');
  assert.deepEqual(row.evidence.statusCounts, { support_only: 4 });
  assert.deepEqual(row.evidence.gateStatuses.map((gate) => gate.status), heldGateStatuses);
  assert.deepEqual(report.supportOnlyObservationLimits, {
    cannotMoveFinalReleaseReadiness: true,
    cannotSatisfyProductionGate: true,
    localObservationOnly: true,
    productionBackedEvidenceAdded: false,
    releaseMovementAllowed: false,
    finalReleaseReadinessBefore: 'NO-GO',
    finalReleaseReadinessAfter: 'NO-GO',
    integrationUse: 'support-only evidence without release-gate movement',
  });
  assert.equal(report.releaseHold.productionRepairAuthorized, false);
  assert.equal(report.releaseHold.finalReleaseRecommendation, 'NO-GO');
  assert.deepEqual(report.releaseHold.statusMovementProof, {
    releaseGateStatusFilesEdited: [],
    restrictedStatusFilesTouched: false,
    thisEvidenceMovesReleaseGateStatus: false,
    gateStatusesBefore: heldGateStatuses,
    gateStatusesAfter: heldGateStatuses,
    releaseVerdictBefore: '0/4',
    releaseVerdictAfter: '0/4',
    finalReleaseBefore: 'NO-GO',
    finalReleaseAfter: 'NO-GO',
  });
  assertIncludesNormalized(text, 'Support-only observations cannot move final release readiness.');
  assertIncludesNormalized(text, 'No release-gate status file was edited by this audit.');
  assertIncludesNormalized(text, 'Final release remains `NO-GO`.');
});

test('RPP-0969 evidence remains redacted and lists focused validation commands', () => {
  const { text, report } = loadEvidenceReport(evidencePath);
  const runbook = readText(runbookPath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0969 operator runbook v4 evidence' }));
  assert.equal(report.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(report.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(report.redactionPosture.cookiesIncluded, false);
  assert.equal(report.redactionPosture.privatePathsIncluded, false);
  assert.equal(report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(runbook.includes('http://'), false);
  assert.equal(runbook.includes('https://'), false);
  assert.deepEqual(report.validationCommands, validationCommands);

  for (const command of validationCommands) {
    assert.ok(text.includes(`\`${command}\``), `missing validation command: ${command}`);
  }
});

function loadEvidenceReport(filePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${filePath} must contain one JSON record block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
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
