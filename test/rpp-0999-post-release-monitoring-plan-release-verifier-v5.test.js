import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRelativePath =
  'docs/evidence/rpp-0999-post-release-monitoring-plan-release-verifier-v5.md';
const evidencePath = path.join(repoRoot, evidenceRelativePath);
const baselineEvidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0979-post-release-monitoring-plan-v4.md',
);
const planPath = path.join(repoRoot, 'docs/operations/post-release-monitoring-plan.md');

const auditedLaneHead = '6b83d694a0d8e3c1e5416a9b672dde52ea10e721';
const auditedOriginMain = '028864e635bf677fae73f23a885aba2dbf20788a';

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const requiredDocuments = Object.freeze([
  'docs/operations/post-release-monitoring-plan.md',
  'docs/evidence/rpp-0979-post-release-monitoring-plan-v4.md',
  'docs/evidence/rpp-0959-post-release-monitoring-plan-v3.md',
  'docs/evidence/rpp-0999-post-release-monitoring-plan-release-verifier-v5.md',
  'docs/operations/operator-runbook.md',
  'docs/operations/failure-triage-runbook.md',
  'docs/operations/rollback-repair-runbook.md',
  'docs/recovery/operator-safe-recovery.md',
  'docs/recovery/apply-journal.md',
  'docs/recovery/acceptable-states.md',
  'docs/release/go-no-go-release-decision-record.md',
]);

const unchangedReleaseSurfaces = Object.freeze([
  'docs/reprint-push-completion-checklist.md',
  'docs/progress-log.md',
  'progress.html',
  'src/release-gates.js',
]);

const validationCommands = Object.freeze([
  'node --check test/rpp-0999-post-release-monitoring-plan-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0999 test/rpp-0999-post-release-monitoring-plan-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0999-post-release-monitoring-plan-release-verifier-v5.md',
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

test('RPP-0999 release verifier v5 evidence is held support-only with final NO-GO', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0999 Post-Release Monitoring Plan Release Verifier v5 Evidence$/m);
  assert.match(text, /^Issue: RPP-0999$/m);
  assert.match(text, /^Worker: `rpp-999`$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-999`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.match(text, /Pattern carried forward: RPP-0979 v4 post-release monitoring plan contract/);
  assert.match(text, /Final release remains `NO-GO`/);
  assert.match(text, /no release-gate status movement is allowed/);
  assert.match(text, /unresolved production-backed proof\s+gaps stay open and fail closed/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0999');
  assert.equal(report.proofId, 'rpp-0999-post-release-monitoring-plan-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.workerId, 'rpp-999');
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.productionBackedMonitoringProofObserved, false);
  assert.equal(report.releaseVerifier, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.releaseReadiness, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.evidenceMode, 'support-only-release-verifier-carry-through');
  assert.equal(report.auditedBranch, 'session/rpp-999');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-999',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '6b83d694a',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: auditedOriginMain,
    originMainShortSha: '028864e63',
    originMainSubject: 'docs: publish progress page',
  });
});

test('RPP-0999 carries forward the RPP-0979 monitoring plan contract', () => {
  const { report } = loadMarkdownJson(evidencePath);
  const { report: baseline } = loadMarkdownJson(baselineEvidencePath);

  assert.equal(
    report.documents.contractSourceEvidence,
    'docs/evidence/rpp-0979-post-release-monitoring-plan-v4.md',
  );
  assert.equal(report.contractLineage.carriedForwardFrom, report.documents.contractSourceEvidence);
  assert.equal(report.contractLineage.carriedForwardProofId, baseline.proofId);
  assert.equal(report.contractLineage.carriedForwardVariant, baseline.variant);
  assert.equal(report.contractLineage.finalReleaseStatusCarriedForward, baseline.finalReleaseStatus);
  assert.equal(
    report.contractLineage.releaseGateMovementCarriedForward,
    baseline.monitoringContract.releaseGateMovement,
  );

  assert.deepEqual(Object.values(report.documents), requiredDocuments);
  for (const relativePath of Object.values(report.documents)) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} must exist`);
  }

  assert.deepEqual(report.monitoringContract, baseline.monitoringContract);
  assert.deepEqual(report.requiredMonitoringInputs, baseline.requiredMonitoringInputs);
  assert.deepEqual(report.operatorRecoveryPrerequisites, baseline.operatorRecoveryPrerequisites);
  assert.deepEqual(report.safeRecoveryEvidence, baseline.safeRecoveryEvidence);
  assert.deepEqual(report.rollbackEscalationBlockers, baseline.rollbackEscalationBlockers);
  assert.deepEqual(report.hiddenAssumptionGuards, baseline.hiddenAssumptionGuards);
  assert.deepEqual(report.lifecycleGuards, baseline.lifecycleGuards);
  assert.deepEqual(report.stopConditions, baseline.stopConditions);
  assert.deepEqual(report.proofGaps, baseline.proofGaps);
  assert.deepEqual(report.releaseHold, baseline.releaseHold);
  assert.deepEqual(report.redactionPosture, baseline.redactionPosture);
});

test('RPP-0999 proves operator docs name monitoring inputs and safe recovery evidence', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.match(plan, /^## Required Monitoring Inputs$/m);
  assert.match(plan, /^## Safe Recovery Paths$/m);
  assert.ok(normalizedPlan.includes('Record every input below before a release can be monitored or recommended for GO.'));
  assert.ok(normalizedPlan.includes('Named operator, reviewer, recovery owner, backup owner, and incident owner.'));
  assert.ok(normalizedPlan.includes('Restart-readable journal owner, sequence range, and completed or blocked terminal evidence.'));
  assert.ok(normalizedPlan.includes('Before hash, planned after hash, and current observed hash for every planned target.'));

  assert.equal(report.monitoringContract.noHiddenAssumptions, true);
  assert.equal(report.monitoringContract.productionBackedMonitoringProofRequiredForActivation, true);
  assert.equal(report.monitoringContract.monitoringActivationAllowedByThisSlice, false);
  assert.equal(report.monitoringContract.monitoringFinalizationAllowedByThisSlice, false);
  assert.equal(report.monitoringContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.monitoringContract.sameRunEnvelopeRequired, true);
  assert.equal(report.monitoringContract.sameRecoveryPathRequired, true);
  assert.deepEqual(report.monitoringContract.acceptableStates, acceptableStates);

  assert.ok(report.requiredMonitoringInputs.includes('production-backed-release-gate-decision'));
  assert.ok(report.requiredMonitoringInputs.includes('per-target-before-after-observed-hashes'));
  assert.ok(report.requiredMonitoringInputs.includes('artifact-redaction-scan-pass'));
  assert.ok(report.operatorRecoveryPrerequisites.includes('local-only-network-posture-with-no-remote-tunnel'));
  assert.ok(report.operatorRecoveryPrerequisites.includes('no-release-gate-status-progress-or-checklist-movement'));

  assert.ok(report.safeRecoveryEvidence.length >= 8);
  for (const evidence of report.safeRecoveryEvidence) {
    assert.match(evidence.name, /\S/);
    assert.match(evidence.requires, /\S/);
    assert.equal(evidence.stopIfMissing, true, `${evidence.name} must stop if missing`);
    assert.equal(evidence.beforeFinalization, true);
  }

  assert.match(text, /^## Required Monitoring Inputs$/m);
  assert.match(text, /^## Safe Recovery Evidence$/m);
});

test('RPP-0999 blocks rollback escalation finalization and release movement without proof', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.equal(report.releaseVerifierCarryThrough.supportOnly, true);
  assert.equal(report.releaseVerifierCarryThrough.productionBacked, false);
  assert.equal(report.releaseVerifierCarryThrough.productionBackedMonitoringProofObserved, false);
  assert.equal(report.releaseVerifierCarryThrough.productionBackedMonitoringProofRequiredBeforeActivation, true);
  assert.equal(report.releaseVerifierCarryThrough.productionBackedMonitoringProofRequiredBeforeFinalization, true);
  assert.equal(report.releaseVerifierCarryThrough.productionBackedFinalReleaseProofRequiredBeforeReleaseMovement, true);
  assert.equal(report.releaseVerifierCarryThrough.monitoringActivationAllowed, false);
  assert.equal(report.releaseVerifierCarryThrough.monitoringFinalizationAllowed, false);
  assert.equal(report.releaseVerifierCarryThrough.rollbackAuthorized, false);
  assert.equal(report.releaseVerifierCarryThrough.manualProductionRepairAuthorized, false);
  assert.equal(report.releaseVerifierCarryThrough.releaseMovementAllowed, false);
  assert.equal(report.releaseVerifierCarryThrough.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseVerifierCarryThrough.failClosedWhenProofMissing, true);

  assert.equal(report.rollbackEscalationBlockers.length, 3);
  for (const blocker of report.rollbackEscalationBlockers) {
    assert.match(blocker.name, /\S/);
    assert.ok(blocker.blocks.length >= 2, `${blocker.name} must block concrete actions`);
    assert.ok(blocker.requiredEvidence.length >= 3, `${blocker.name} must name required evidence`);
    assert.match(blocker.unknownAnswerAction, /blocked|stop|hold/);
    assert.equal(blocker.stopIfUnknown, true, `${blocker.name} must stop on unknown answers`);
  }

  const blockedActions = new Set(report.rollbackEscalationBlockers.flatMap((blocker) => blocker.blocks));
  assert.equal(blockedActions.has('rollback'), true);
  assert.equal(blockedActions.has('manual production repair'), true);
  assert.equal(blockedActions.has('direct database change'), true);
  assert.equal(blockedActions.has('escalation handoff'), true);
  assert.equal(blockedActions.has('monitoring finalization'), true);
  assert.equal(blockedActions.has('release movement'), true);
  assert.equal(blockedActions.has('release-gate status movement'), true);

  assert.ok(normalizedPlan.includes('does not authorize rollback or manual repair'));
  assert.ok(normalizedPlan.includes('manual production edits, direct database changes, or cleanup that deletes recovery artifacts'));
  assert.match(text, /^## Rollback And Escalation Blockers$/m);
  assert.match(text, /The monitoring plan does not authorize rollback, manual production repair/);
});

test('RPP-0999 fail-closed guards cover activation finalization and release movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.deepEqual(
    report.hiddenAssumptionGuards.map((guard) => guard.phase),
    ['before-monitoring-activation', 'before-finalization', 'before-release-movement'],
  );
  assert.deepEqual(
    report.lifecycleGuards.map((guard) => guard.phase),
    ['before-monitoring-activation', 'before-finalization', 'before-release-movement'],
  );

  for (const guard of report.hiddenAssumptionGuards) {
    assert.ok(guard.mustAnswer.length >= 5, `${guard.phase} must ask concrete guard questions`);
    assert.match(guard.unknownAnswerAction, /blocked|stop|hold/);
  }

  for (const guard of report.lifecycleGuards) {
    assert.ok(guard.requiredEvidence.length >= 4, `${guard.phase} must require explicit evidence`);
    assert.match(guard.hiddenAssumptionAction, /blocked|stop|hold/);
    assert.equal(guard.releaseMovementAllowed, false, `${guard.phase} must not allow release movement`);
  }

  assert.equal(report.operatorDocsSafeRecoveryProof.requiredMonitoringInputsExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.operatorRecoveryPrerequisitesExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.safeRecoveryEvidenceExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.stopConditionsExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.rollbackEscalationBlockersExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.hiddenAssumptionGuardsExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.productionBackedProofRequiredBeforeMonitoringActivation, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.productionBackedProofRequiredBeforeFinalization, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.productionBackedProofRequiredBeforeReleaseMovement, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.noHiddenAssumptions, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.unknownAnswersFailClosed, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.statusCodeOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.screenshotOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.dashboardColorOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.operatorMemoryRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.manualProductionRepairAuthorized, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.rollbackAuthorized, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.monitoringActivationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.monitoringFinalizationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.releaseMovementAllowed, false);
  assert.deepEqual(report.operatorDocsSafeRecoveryProof.acceptableStates, acceptableStates);
  assert.equal(report.operatorDocsSafeRecoveryProof.productionBackedClosureObserved, false);

  assert.ok(normalizedPlan.includes('Operators must write these assumptions into the production monitoring packet before relying on the plan.'));
  assert.ok(normalizedPlan.includes('Final release stays `NO-GO` until a separate production-backed monitoring packet proves'));
  assert.match(text, /Before monitoring activation/);
  assert.match(text, /Before finalization/);
  assert.match(text, /Before release movement/);
  assert.match(text, /This slice provides neither, so release movement is blocked/);
});

test('RPP-0999 keeps production-backed proof gaps open and causes no status movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.unresolvedProductionBackedProofGapStatus, 'open-fail-closed');
  assert.deepEqual(report.proofGaps, [
    'no-production-monitoring-packet-observed',
    'no-production-health-signal-readback-observed',
    'no-production-target-hash-readback-observed',
    'no-production-incident-window-observed',
    'no-production-rollback-repair-authorization-observed',
    'no-production-finalization-evidence-observed',
    'no-production-redaction-scan-over-monitoring-packet-observed',
  ]);

  assert.equal(report.releaseHold.noReleaseGateMovement, true);
  assert.equal(report.releaseHold.releaseGateStatusMoved, false);
  assert.equal(report.releaseHold.statusFilesChanged, false);
  assert.equal(report.releaseHold.progressFilesChanged, false);
  assert.equal(report.releaseHold.completionChecklistChanged, false);
  assert.equal(report.releaseHold.dashboardsStarted, false);
  assert.equal(report.releaseHold.remoteTunnelsUsed, false);
  assert.equal(report.releaseHold.productionRepairAuthorized, false);
  assert.equal(report.releaseHold.rollbackAuthorized, false);
  assert.equal(report.releaseHold.monitoringActivated, false);
  assert.equal(report.releaseHold.monitoringFinalized, false);
  assert.equal(report.releaseHold.releaseFinalized, false);
  assert.equal(report.releaseHold.finalReleaseRecommendation, 'NO-GO');
  assert.deepEqual(report.releaseHold.unchangedReleaseSurfaces, unchangedReleaseSurfaces);

  assert.deepEqual(report.writeScope.allowedFiles, [
    evidenceRelativePath,
    'test/rpp-0999-post-release-monitoring-plan-release-verifier-v5.test.js',
  ]);
  assert.equal(report.writeScope.releaseGateStatusMovement, false);

  assert.match(text, /unresolved production-backed proof gaps remain open and fail closed/i);
  assert.match(text, /checklist, progress, release-gate, and status surfaces\s+remain unchanged/);
  assert.ok(normalize(text).includes('Final release stays `NO-GO`'));
});

test('RPP-0999 evidence remains redacted and lists focused validation only', async () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, {
      label: 'RPP-0999 post-release monitoring release verifier v5 evidence',
    }));
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(scan.scannedFiles, [evidenceRelativePath]);

  assert.equal(report.redactionPosture.mode, 'hash-count-timestamp-route-name-metadata-only');
  assert.equal(report.redactionPosture.rawValuesIncluded, false);
  assert.equal(report.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(report.redactionPosture.cookiesIncluded, false);
  assert.equal(report.redactionPosture.privatePathsIncluded, false);
  assert.equal(report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(report.redactionPosture.productionSecretMaterialIncluded, false);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);

  for (const toolName of prohibitedTunnelToolNames) {
    assert.equal(text.toLowerCase().includes(toolName), false, `evidence mentions remote tunnel tool ${toolName}`);
  }

  assert.deepEqual(report.validationCommands, validationCommands);
  assert.deepEqual(report.validation, validationCommands);
  for (const command of validationCommands) {
    assert.ok(text.includes(command), `missing validation command: ${command}`);
  }
});

function loadMarkdownJson(filePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
