import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0939-post-release-monitoring-plan-v2.md');
const patternEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0919-post-release-monitoring-plan.md');
const planPath = path.join(repoRoot, 'docs/operations/post-release-monitoring-plan.md');

const auditedLaneHead = '53853dcb4e8df883c25c5ef9ffbe25dd4c2a3a42';

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const requiredDocuments = Object.freeze([
  'docs/operations/post-release-monitoring-plan.md',
  'docs/evidence/rpp-0919-post-release-monitoring-plan.md',
  'docs/evidence/rpp-0939-post-release-monitoring-plan-v2.md',
  'docs/operations/operator-runbook.md',
  'docs/operations/failure-triage-runbook.md',
  'docs/operations/rollback-repair-runbook.md',
  'docs/recovery/operator-safe-recovery.md',
  'docs/recovery/apply-journal.md',
  'docs/recovery/acceptable-states.md',
]);

const requiredPrerequisites = Object.freeze([
  'production-backed-release-gate-decision-bound-to-run',
  'apply-receipt-identifier',
  'plan-hash-target-count-and-mutation-count',
  'idempotency-key-hash-bound-to-same-request-body',
  'source-and-target-identity-hashes-from-approved-inventory',
  'restart-readable-journal-terminal-state',
  'journal-owner-and-sequence-range',
  'per-target-before-after-and-current-observed-hashes',
  'route-level-success-error-and-latency-counts',
  'incident-count-and-stop-authority-decision',
  'named-operator-reviewer-recovery-owner-backup-owner-and-incident-owner',
  'artifact-redaction-scan-pass-for-monitoring-packet',
  'local-only-network-posture-with-no-remote-tunnel',
  'no-release-gate-status-progress-or-checklist-movement',
]);

const requiredStopConditions = Object.freeze([
  'production-backed-monitoring-proof-absent',
  'monitoring-activation-requested-without-required-prerequisites',
  'release-gate-approval-missing-expired-support-only-or-different-run',
  'source-target-identity-ambiguous',
  'run-envelope-mismatch',
  'terminal-journal-missing-stale-unowned-nonmonotonic-or-not-restart-readable',
  'current-observed-hashes-missing-or-unexplained',
  'monitoring-signals-from-local-fixtures-support-artifacts-or-earlier-run',
  'required-window-health-latency-incident-or-customer-impact-counts-missing',
  'same-request-replay-would-create-fresh-mutations',
  'recovery-path-for-action-differs-from-inspection-path',
  'rollback-or-repair-requested-without-approved-recovery-review',
  'manual-production-edit-direct-database-change-or-artifact-deletion-required',
  'raw-or-sensitive-evidence-captured',
  'remote-tunnel-or-unapproved-ingress-required',
  'release-gate-status-progress-or-checklist-movement-from-support-only-plan',
  'finalization-requested-without-terminal-recovery-evidence',
  'release-movement-requested-without-production-backed-monitoring-packet',
  'hidden-assumption-answer-missing',
]);

const guardPhases = Object.freeze([
  'before-monitoring-activation',
  'before-finalization',
  'before-release-movement',
]);

const expectedValidation = Object.freeze([
  'node --check test/rpp-0939-post-release-monitoring-plan-v2.test.js',
  'node --test --test-name-pattern RPP-0939 test/rpp-0939-post-release-monitoring-plan-v2.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0939-post-release-monitoring-plan-v2.md',
  'git diff --check',
]);

test('RPP-0939 evidence records a held support-only monitoring v2 contract', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0939 Post-Release Monitoring Plan Evidence Variant 2$/m);
  assert.match(text, /Audited lane head before this evidence file: `53853dcb4e8df883c25c5ef9ffbe25dd4c2a3a42`/);
  assert.match(text, /verdict stays held/);
  assert.match(text, /final\s+release remains `NO-GO`/);
  assert.match(text, /no release-gate status\s+movement is allowed/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0939');
  assert.equal(report.proofId, 'rpp-0939-post-release-monitoring-plan-v2');
  assert.equal(report.variant, 2);
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.productionBackedMonitoringProofObserved, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-939');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.equal(report.auditedLaneHeadSubject, 'Merge published progress page state');
  assert.equal(report.successCriterion, 'operator docs explain safe recovery without hidden assumptions');
  assert.equal(report.monitoringContract.verdictHeld, true);
  assert.equal(report.monitoringContract.releaseGateMovement, 'none');
  assert.equal(report.monitoringContract.releaseMovementAllowed, false);
  assert.equal(report.monitoringContract.monitoringActivationAllowedByThisSlice, false);
  assert.equal(report.monitoringContract.monitoringFinalizationAllowedByThisSlice, false);
});

test('RPP-0939 monitoring plan names operator recovery prerequisites and safe evidence', () => {
  const pattern = loadMarkdownJson(patternEvidencePath).report;
  const { report } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.equal(report.documents.patternEvidence, 'docs/evidence/rpp-0919-post-release-monitoring-plan.md');
  assert.deepEqual(Object.values(report.documents), requiredDocuments);
  for (const relativePath of Object.values(report.documents)) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} must exist`);
  }

  assert.deepEqual(report.requiredMonitoringInputs, pattern.requiredMonitoringInputs);
  assert.deepEqual(report.operatorRecoveryPrerequisites, requiredPrerequisites);
  assert.deepEqual(report.monitoringContract.acceptableStates, acceptableStates);
  assert.equal(report.monitoringContract.productionBackedMonitoringProofRequiredForActivation, true);
  assert.equal(report.monitoringContract.sameRunEnvelopeRequired, true);
  assert.equal(report.monitoringContract.sameRecoveryPathRequired, true);
  assert.equal(report.monitoringContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.monitoringContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.monitoringContract.unknownStateAction, 'blocked-recovery');

  assert.match(plan, /^## Required Monitoring Inputs$/m);
  assert.match(plan, /^## Safe Recovery Paths$/m);
  assert.ok(normalizedPlan.includes('Named operator, reviewer, recovery owner, backup owner, and incident owner.'));
  assert.ok(normalizedPlan.includes('Restart-readable journal owner, sequence range, and completed or blocked terminal evidence.'));
  assert.ok(normalizedPlan.includes('Before hash, planned after hash, and current observed hash for every planned target.'));
  assert.ok(normalizedPlan.includes('recovery readiness, including the named operator, reviewer, recovery owner, backup owner, and stop authority.'));

  assert.equal(report.safeRecoveryEvidence.length, 8);
  for (const evidence of report.safeRecoveryEvidence) {
    assert.match(evidence.name, /\S/);
    assert.match(evidence.requires, /\S/);
    assert.equal(evidence.stopIfMissing, true, `${evidence.name} must stop if missing`);
  }
});

test('RPP-0939 evidence names stop conditions and rollback escalation blockers', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.deepEqual(report.stopConditions, requiredStopConditions);
  assert.equal(report.monitoringContract.rollbackAuthorized, false);
  assert.equal(report.monitoringContract.manualProductionRepairAuthorized, false);

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
  assert.equal(blockedActions.has('escalation handoff'), true);
  assert.equal(blockedActions.has('release movement'), true);
  assert.equal(blockedActions.has('release-gate status movement'), true);

  assert.ok(normalizedPlan.includes('does not authorize rollback or manual repair'));
  assert.ok(normalizedPlan.includes('Stop retries, preserve artifacts, keep release `NO-GO`, and escalate to recovery review.'));
  assert.ok(normalizedPlan.includes('manual production edits, direct database changes, or cleanup that deletes recovery artifacts'));
  assert.match(plan, /^## Stop Conditions$/m);
  assert.match(text, /^## Rollback And Escalation Blockers$/m);
});

test('RPP-0939 blocks hidden assumptions before activation finalization or release movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const normalizedPlan = normalize(plan);

  assert.deepEqual(report.hiddenAssumptionGuards.map((guard) => guard.phase), guardPhases);
  assert.deepEqual(report.lifecycleGuards.map((guard) => guard.phase), guardPhases);

  for (const guard of report.hiddenAssumptionGuards) {
    assert.ok(guard.mustAnswer.length >= 5, `${guard.phase} must ask concrete guard questions`);
    assert.match(guard.unknownAnswerAction, /blocked|stop|hold/);
  }

  for (const guard of report.lifecycleGuards) {
    assert.ok(guard.requiredEvidence.length >= 4, `${guard.phase} must require explicit evidence`);
    assert.match(guard.hiddenAssumptionAction, /blocked|stop|hold/);
    assert.equal(guard.releaseMovementAllowed, false, `${guard.phase} must not allow release movement`);
  }

  assert.ok(normalizedPlan.includes('Operators must write these assumptions into the production monitoring packet before relying on the plan.'));
  assert.ok(normalizedPlan.includes('Record every input below before a release can be monitored or recommended for GO.'));
  assert.ok(normalizedPlan.includes('retry, replay, finalization, or recovery review.'));
  assert.ok(normalizedPlan.includes('Final release stays `NO-GO` until a separate production-backed monitoring packet proves'));

  assert.match(text, /Before monitoring activation/);
  assert.match(text, /Before finalization/);
  assert.match(text, /Before release movement/);
  assert.match(text, /This slice provides neither, so release movement is blocked/);
});

test('RPP-0939 evidence remains redacted and makes no release movement', async () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const plan = readText(planPath);
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0939-post-release-monitoring-plan-v2.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0939 post-release monitoring v2 evidence' }));

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
  assert.deepEqual(report.validation, expectedValidation);
  assert.deepEqual(report.proofGaps, [
    'no-production-monitoring-packet-observed',
    'no-production-health-signal-readback-observed',
    'no-production-target-hash-readback-observed',
    'no-production-incident-window-observed',
    'no-production-rollback-repair-authorization-observed',
    'no-production-finalization-evidence-observed',
    'no-production-redaction-scan-over-monitoring-packet-observed',
  ]);
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
  assert.equal(plan.includes('http://'), false);
  assert.equal(plan.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
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
