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
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0989-operator-runbook-release-verifier-v5.md',
);
const baselineEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0969-operator-runbook-v4.md');
const runbookPath = path.join(repoRoot, 'docs/operations/operator-runbook.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = '556975de69f5395da4e6e55f91eb714804ee5171';
const heldGateStatuses = Object.freeze([
  'support_only',
  'support_only',
  'support_only',
  'support_only',
]);
const validationCommands = Object.freeze([
  'node --check test/rpp-0989-operator-runbook-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0989 test/rpp-0989-operator-runbook-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0989-operator-runbook-release-verifier-v5.md',
  'git diff --check',
]);
const prohibitedTunnelToolNames = Object.freeze([
  'ngrok',
  'cloudflared',
  'localtunnel',
  'serveo',
  'localhost.run',
  'lhr.life',
  'tailscale funnel',
]);

test('RPP-0989 release verifier v5 evidence is anchored to the operator runbook lane head with verdict held', () => {
  const { text, report } = loadEvidenceReport(evidencePath);

  assert.match(text, /^# RPP-0989 Operator Runbook Release Verifier Evidence Variant 5$/m);
  assert.match(text, /^Issue: RPP-0989$/m);
  assert.match(text, /^Worker: `rpp-989`$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-989`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.match(text, /Pattern carried forward: RPP-0969 v4 operator runbook contract/);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0989');
  assert.equal(report.proofId, 'rpp-0989-operator-runbook-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-989');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(report.documents.operatorRunbook, 'docs/operations/operator-runbook.md');
  assert.equal(report.documents.contractSourceEvidence, 'docs/evidence/rpp-0969-operator-runbook-v4.md');
  assert.equal(report.releaseVerifierCarryThrough.variant, 'v5');
  assert.equal(report.releaseVerifierCarryThrough.target, 'operator-runbook-safe-recovery');
  assert.equal(report.releaseVerifierCarryThrough.releaseGateMovement, 'none');
  assert.equal(report.releaseVerifierCarryThrough.finalReleaseStatus, 'NO-GO');
  assert.equal(report.operatorRunbookContract.carriedForwardFrom, 'RPP-0969 operator runbook v4');
  assert.equal(report.operatorRunbookContract.noHiddenRecoveryAssumptions, true);
  assert.equal(report.operatorRunbookContract.releaseVerdictHeld, true);
  assert.equal(report.releaseHold.noReleaseGateMovement, true);
  assert.equal(report.releaseHold.releaseGateStatusMoved, false);
  assert.equal(report.releaseHold.finalReleaseRecommendation, 'NO-GO');
});

test('RPP-0989 carries forward the RPP-0969 v4 operator-runbook contract', () => {
  const { report } = loadEvidenceReport(evidencePath);
  const { report: baseline } = loadEvidenceReport(baselineEvidencePath);

  assert.deepEqual(report.productionPrerequisitesBeforeMutation, baseline.productionPrerequisitesBeforeMutation);
  assert.deepEqual(report.recoveryEvidenceRequired, baseline.recoveryEvidenceRequired);
  assert.deepEqual(report.stopConditions, baseline.stopConditions);
  assert.deepEqual(report.rollbackAndEscalationPaths, baseline.rollbackAndEscalationPaths);
  assert.deepEqual(report.hiddenAssumptionBlockers, baseline.hiddenAssumptionBlockers);
  assert.deepEqual(report.lifecycleGuards, baseline.lifecycleGuards);
  assert.deepEqual(report.recoveryPolicy, baseline.recoveryPolicy);
  assert.deepEqual(report.supportOnlyObservationLimits, baseline.supportOnlyObservationLimits);
  assert.deepEqual(report.releaseHold.statusMovementProof, baseline.releaseHold.statusMovementProof);
  assert.deepEqual(report.contractCarryForward, {
    sourceRppId: 'RPP-0969',
    sourceProofId: 'rpp-0969-operator-runbook-v4',
    sourceVariant: 4,
    samePrerequisites: true,
    sameRecoveryEvidence: true,
    sameStopConditions: true,
    sameRollbackAndEscalationPaths: true,
    sameHiddenAssumptionBlockers: true,
    sameRecoveryPolicy: true,
    sameReleaseHold: true,
    sameSupportOnlyLimits: true,
  });
});

test('RPP-0989 operator docs explain safe recovery prerequisites before mutation', () => {
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

  assert.equal(report.operatorDocsSafeRecoveryProof.prerequisitesBeforeMutationNamed, true);
});

test('RPP-0989 operator docs name explicit recovery evidence, stop conditions, and hidden-assumption blockers', () => {
  const runbook = readText(runbookPath);
  const { report } = loadEvidenceReport(evidencePath);

  assertIncludesNormalized(runbook, 'Capture enough evidence for another operator to reconstruct the decision');
  assertIncludesNormalized(runbook, 'Do not infer production safety from a green status code');
  assertIncludesNormalized(runbook, 'Stop immediately and preserve artifacts when any condition below is true');
  assertIncludesNormalized(runbook, 'Before retry, finalization, cleanup, or escalation');

  for (const evidence of report.recoveryEvidenceRequired) {
    assertIncludesNormalized(
      runbook,
      evidence,
      `operator runbook must name recovery evidence: ${evidence}`,
    );
  }

  for (const stopCondition of report.stopConditions) {
    assertIncludesNormalized(
      runbook,
      stopCondition,
      `operator runbook must name stop condition: ${stopCondition}`,
    );
  }

  for (const recoveryPath of report.rollbackAndEscalationPaths) {
    assertIncludesNormalized(
      runbook,
      recoveryPath,
      `operator runbook must name rollback/escalation path: ${recoveryPath}`,
    );
  }

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
  assert.deepEqual(report.operatorDocsSafeRecoveryProof, {
    prerequisitesBeforeMutationNamed: true,
    explicitRecoveryEvidenceNamed: true,
    stopConditionsNamed: true,
    rollbackAndEscalationPathsNamed: true,
    hiddenAssumptionBlockersNamed: true,
    unknownAnswersBlockRecovery: true,
    statusCodeOnlyRecoveryRejected: true,
    manualProductionRepairRejected: true,
    artifactsPreservedBeforeRetryFinalizationCleanupOrEscalation: true,
    releaseMovementBlockedWhenStopped: true,
  });
});

test('RPP-0989 keeps unresolved production-backed proof gaps open and fails closed', () => {
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
  assert.equal(report.releaseVerifierCarryThrough.productionProofStillRequired, true);
  assert.equal(report.releaseVerifierCarryThrough.failClosedWhenProofMissing, true);
  assert.deepEqual(report.unresolvedProductionBackedProofGaps, [
    'production-backed release gate approval for this exact run is not supplied by this support-only artifact',
    'production-owned source and target topology proof is not supplied by this support-only artifact',
    'production auth/session issuance and readback proof is not supplied by this support-only artifact',
    'production durable journal readback and rollback proof is not supplied by this support-only artifact',
    'customer-safe rollout and final release readiness proof is not supplied by this support-only artifact',
  ]);
  assert.deepEqual(report.failClosedPolicy, {
    missingProductionBackedProofAction: 'NO-GO',
    missingOperatorEvidenceAction: 'blocked-recovery',
    hiddenAssumptionUnknownAction: 'blocked-recovery',
    releaseMovementAllowed: false,
    productionMutationAuthorized: false,
    manualRepairAuthorized: false,
    artifactDeletionAllowed: false,
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
  assertIncludesNormalized(text, 'Unresolved production-backed proof gaps remain open and fail closed.');
  assertIncludesNormalized(text, 'Support-only observations cannot move final release readiness.');
  assertIncludesNormalized(text, 'No release-gate status file was edited by this audit.');
  assertIncludesNormalized(text, 'Final release remains `NO-GO`.');
  assert.doesNotMatch(text, /releaseStatus: GO/);
  assert.doesNotMatch(text, /releaseEligible: true/);
});

test('RPP-0989 evidence remains redacted and lists focused validation commands only', () => {
  const { text, report } = loadEvidenceReport(evidencePath);
  const runbook = readText(runbookPath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0989 operator runbook release verifier v5 evidence' }));
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

  for (const toolName of prohibitedTunnelToolNames) {
    assert.equal(text.toLowerCase().includes(toolName), false, `evidence mentions remote tunnel tool ${toolName}`);
  }

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
