import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planPath = path.join(repoRoot, 'docs/operations/post-release-monitoring-plan.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0919-post-release-monitoring-plan.md');

const expectedStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const expectedAssumptions = Object.freeze([
  'release-gate-approval-production-backed-and-bound-to-run',
  'source-target-identity-pair-is-intended-production-pair',
  'apply-receipt-plan-target-count-mutation-count-and-journal-owner-share-run-envelope',
  'checked-recovery-path-is-used-for-any-retry-replay-finalization-or-review',
  'monitoring-window-starts-after-commit-finalization-and-restart-readable-terminal-journal',
  'current-observed-hash-for-every-target-is-explained-by-before-or-after-hash',
  'monitoring-signals-are-current-production-backed-and-not-local-fixture-data',
  'evidence-packet-is-hash-count-timestamp-route-name-and-metadata-only',
  'no-remote-tunnel-unapproved-ingress-manual-edit-direct-database-patch-or-release-gate-movement',
  'missing-metric-receipt-terminal-journal-entry-or-stale-observation-is-a-stop-condition',
]);

const expectedInputs = Object.freeze([
  'production-backed-release-gate-decision',
  'apply-receipt-identifier',
  'plan-hash',
  'target-count',
  'mutation-count',
  'idempotency-key-hash',
  'source-identity-hash',
  'target-identity-hash',
  'restart-readable-journal-terminal-state',
  'journal-owner-and-sequence-range',
  'per-target-before-after-observed-hashes',
  'route-level-success-error-and-latency-counts',
  'incident-count-and-stop-authority-decision',
  'named-operator-reviewer-recovery-owner-backup-owner-and-incident-owner',
  'artifact-redaction-scan-pass',
]);

const expectedStopConditions = Object.freeze([
  'production-backed-monitoring-proof-absent',
  'release-gate-approval-missing-expired-support-only-or-different-run',
  'source-target-identity-ambiguous',
  'run-envelope-mismatch',
  'terminal-journal-missing-stale-unowned-nonmonotonic-or-not-restart-readable',
  'current-observed-hashes-missing-or-unexplained',
  'monitoring-signals-from-local-fixtures-support-artifacts-or-earlier-run',
  'required-window-health-latency-incident-or-customer-impact-counts-missing',
  'same-request-replay-would-create-fresh-mutations',
  'recovery-path-for-action-differs-from-inspection-path',
  'manual-production-edit-direct-database-change-or-artifact-deletion-required',
  'raw-or-sensitive-evidence-captured',
  'remote-tunnel-or-unapproved-ingress-required',
  'release-gate-status-progress-or-checklist-movement-from-support-only-plan',
  'explicit-assumption-answer-missing',
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0919-post-release-monitoring-plan.test.js',
  'node --test --test-name-pattern RPP-0919 test/rpp-0919-post-release-monitoring-plan.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/operations/post-release-monitoring-plan.md docs/evidence/rpp-0919-post-release-monitoring-plan.md',
  'git diff --check',
]);

test('RPP-0919 monitoring plan defines a support-only NO-GO boundary', () => {
  const { report } = loadEvidenceReport();
  const plan = readText(planPath);

  assert.match(plan, /^# Post-Release Monitoring Plan$/m);
  assert.match(plan, /Variant: RPP-0919 post-release monitoring plan variant 1/);
  assert.match(plan, /Final release: `NO-GO`/);
  assert.match(plan, /does not start\s+dashboards/);
  assert.match(plan, /does not move release gates/);
  assert.match(plan, /Final release stays\s+`NO-GO` until a separate production-backed monitoring packet proves/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0919');
  assert.equal(report.proofId, 'rpp-0919-post-release-monitoring-plan-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.productionBackedMonitoringProofObserved, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'operator docs explain safe recovery without hidden assumptions');
  assert.equal(report.documents.monitoringPlan, 'docs/operations/post-release-monitoring-plan.md');
});

test('RPP-0919 evidence names assumptions and production-backed inputs explicitly', () => {
  const { report } = loadEvidenceReport();
  const plan = readText(planPath);

  assert.deepEqual(report.explicitAssumptions, expectedAssumptions);
  assert.deepEqual(report.requiredMonitoringInputs, expectedInputs);

  for (const assumption of [
    'release gate approval is production-backed',
    'observed source identity and target identity',
    'same run envelope',
    'checked recovery path',
    'current observed hash for every planned target',
    'monitoring signals are production-backed',
    'missing metric, missing receipt, missing terminal journal entry, or stale',
  ]) {
    assert.ok(plan.includes(assumption), `plan must explicitly name assumption: ${assumption}`);
  }

  assert.match(plan, /^## Required Monitoring Inputs$/m);
  assert.match(plan, /\| Release gate decision \| Production-backed gate record for this run envelope\. \| Yes \|/);
  assert.match(plan, /\| Target hash readback \| Before hash, planned after hash, and current observed hash for every planned target\. \| Yes \|/);
  assert.match(plan, /\| Redaction result \| Passing artifact redaction scan for the exact monitoring packet\. \| Yes \|/);
});

test('RPP-0919 safe recovery paths fail closed without hidden assumptions', () => {
  const { report } = loadEvidenceReport();
  const plan = readText(planPath);

  assert.deepEqual(report.monitoringContract.acceptableStates, expectedStates);
  assert.equal(report.monitoringContract.productionBackedMonitoringProofRequiredForGo, true);
  assert.equal(report.monitoringContract.productionBackedMonitoringProofObserved, false);
  assert.equal(report.monitoringContract.sameRunEnvelopeRequired, true);
  assert.equal(report.monitoringContract.sameRecoveryPathRequired, true);
  assert.equal(report.monitoringContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.monitoringContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.monitoringContract.unknownStateAction, 'blocked-recovery');
  assert.equal(report.monitoringContract.manualProductionRepairAuthorized, false);
  assert.equal(report.monitoringContract.releaseMovementAuthorized, false);
  assert.deepEqual(report.stopConditions, expectedStopConditions);

  for (const state of expectedStates) {
    assert.ok(plan.includes(`\`${state}\``), `plan must name recovery state ${state}`);
  }

  assert.match(plan, /Any status outside this table is `blocked-recovery`/);
  assert.match(plan, /Do not use a green status\s+code, healthy dashboard color, browser view, or operator memory as a substitute/);
  assert.match(plan, /A missing metric, missing receipt, missing terminal journal entry, or stale\s+observation is a stop condition/);
  assert.match(plan, /current observed hashes are missing or not explained by before or after\s+hashes/);
});

test('RPP-0919 evidence records monitoring proof gaps and no release movement', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.proofGaps, [
    'no-production-monitoring-packet-observed',
    'no-production-health-signal-readback-observed',
    'no-production-target-hash-readback-observed',
    'no-production-incident-window-observed',
    'no-production-redaction-scan-over-monitoring-packet-observed',
  ]);
  assert.equal(report.posture.dashboardsStarted, false);
  assert.equal(report.posture.remoteTunnelsUsed, false);
  assert.equal(report.posture.productionEndpointAdded, false);
  assert.equal(report.posture.productionMutationAttempted, false);
  assert.equal(report.posture.releaseGateStatusMoved, false);
  assert.equal(report.posture.progressFilesChanged, false);
  assert.equal(report.posture.completionChecklistChanged, false);
  assert.equal(report.posture.statusFilesChanged, false);
  assert.equal(report.posture.finalReleaseNoGoRetained, true);
  assert.equal(report.releasePosture.releaseMovementAllowed, false);
  assert.equal(report.releasePosture.productionBackedEvidenceAdded, false);
  assert.equal(report.releasePosture.productionBackedMonitoringProofRequiredForGo, true);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);
  assert.ok(text.includes('Final release remains `NO-GO`'));
  assert.ok(text.includes('Integration recommendation: `NO-GO` for release movement'));
});

test('RPP-0919 monitoring docs remain redacted and final release stays NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const plan = readText(planPath);
  const scan = await scanArtifacts([
    'docs/operations/post-release-monitoring-plan.md',
    'docs/evidence/rpp-0919-post-release-monitoring-plan.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0919 post-release monitoring evidence' }));
  assert.equal(report.redactionPosture.mode, 'hash-count-timestamp-route-name-metadata-only');
  assert.equal(report.redactionPosture.rawValuesIncluded, false);
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

  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.checkedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.checkedAt),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0919 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
