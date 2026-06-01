import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { readAgentsReleaseGatesStatusRow } from '../scripts/release/agents-release-gates-status-row.mjs';
import {
  evaluateReleaseGates,
  formatReleaseGateStatusMarker,
} from '../src/release-gates.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0972-ci-required-checks-list-v4.md');
const previousEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0952-ci-required-checks-list-v3.md');
const fixedNowIso = '2026-06-01T04:00:00.000Z';
const auditedHead = '7f88e42b2aedd39cf83908ae2a4acecb290ab472';

const expectedCheckIds = [
  'release-gates-evaluator',
  'recovery-journal-proof',
  'auth-inspect-proof',
  'graph-identity-proof',
  'plugin-driver-proof',
  'route-proof-contracts',
  'evidence-coverage-proof',
  'operator-proof',
  'artifact-redaction-proof',
  'provenance-proof',
];

const expectedCommands = [
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:00:00.000Z',
  'node --check test/rpp-0972-ci-required-checks-list-v4.test.js',
  'node --test --test-name-pattern RPP-0972 test/rpp-0972-ci-required-checks-list-v4.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0972-ci-required-checks-list-v4.md',
  'git diff --check',
];

test('RPP-0972 CI required checks list v4 records support-only held verdict', () => {
  const { report, text } = loadEvidenceReport(evidencePath, 'RPP-0972');

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0972');
  assert.equal(report.sliceId, 'RPP-0972');
  assert.equal(report.proofId, 'rpp-0972-ci-required-checks-list-v4');
  assert.equal(report.variant, 4);
  assert.equal(report.generatedAt, fixedNowIso);
  assert.equal(report.auditedBranch, 'session/rpp-972');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(report.status, 'support-only-ci-required-checks-list-v4-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.verdictHeld, true);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.match(text, /changes no release\s+gate status file/);
  assert.match(text, /release verdict held with final release at\s+\*\*NO-GO\*\*/);
  assert.match(text, /Missing production-backed\s+proof and failed\s+required proof both fail closed/);
  assert.match(text, /Gate movement therefore remains held and final release remains \*\*NO-GO\*\*/);
});

test('RPP-0972 carries forward the RPP-0952 v3 CI-required-checks contract', () => {
  const { report } = loadEvidenceReport(evidencePath, 'RPP-0972');
  const { report: previous } = loadEvidenceReport(previousEvidencePath, 'RPP-0952');

  assert.deepEqual(report.carriedForwardContract, {
    sourceRppId: 'RPP-0952',
    sourceProofId: 'rpp-0952-ci-required-checks-list-v3',
    sourcePath: 'docs/evidence/rpp-0952-ci-required-checks-list-v3.md',
    requiredChecksUnchanged: true,
    gateMovementRuleUnchanged: true,
    supportOnlyReleaseEffectUnchanged: true,
    finalReleasePostureUnchanged: 'NO-GO',
  });
  assert.deepEqual(report.gateMovementRule, previous.gateMovementRule);
  assert.deepEqual(report.requiredChecks, previous.requiredChecks);
  assert.equal(report.supportOnly, previous.supportOnly);
  assert.equal(report.productionBacked, previous.productionBacked);
  assert.equal(report.releaseEligible, previous.releaseEligible);
  assert.equal(report.finalReleaseStatus, previous.finalReleaseStatus);
});

test('RPP-0972 every required CI check remains blocking and production-observation gated', () => {
  const { report, text } = loadEvidenceReport(evidencePath, 'RPP-0972');

  assert.deepEqual(report.requiredChecks.map((check) => check.id), expectedCheckIds);
  assert.deepEqual(report.gateMovementRule, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    currentEvidenceMovementAttempted: false,
    productionBackedObservationsPresent: false,
    requiredEvidenceForMovement: 'fresh production-backed observations tied to the checked final-release path',
    supportOnlyEvidenceEffect: 'no-movement',
    missingProductionBackedObservationEffect: 'keeps-release-gate-held',
    missingRequiredProofEffect: 'fails-closed',
    failedRequiredProofEffect: 'fails-closed',
    allowedStatusWithoutProductionEvidence: 'support_only',
    blockedStatusesWithoutProductionEvidence: [
      'partially_proven',
      'proven',
      'GO',
    ],
    finalReleaseRequiredPosture: 'NO-GO',
  });

  for (const check of report.requiredChecks) {
    assert.equal(typeof check.command, 'string', `${check.id} command must be present`);
    assert.ok(check.command.startsWith('node --test '), `${check.id} command must be a node test`);
    assert.ok(Array.isArray(check.artifacts), `${check.id} artifacts must be present`);
    assert.ok(check.artifacts.length > 0, `${check.id} artifacts must not be empty`);
    assert.equal(check.blocking, true, `${check.id} must stay blocking`);
    assert.equal(check.productionObservationRequired, true, `${check.id} must require production observations`);
    assert.equal(check.productionBackedObservationPresent, false, `${check.id} must not claim production evidence`);
    assert.equal(check.supportOnlyObservationPresent, true, `${check.id} must be support-only evidence`);
    assert.equal(check.releaseGateMovementAllowed, false, `${check.id} must not allow gate movement`);
    assert.equal(check.supportOnlyEvidenceEffect, 'no-movement', `${check.id} support-only effect`);
    assert.equal(
      check.missingProductionBackedObservationEffect,
      'blocks-release-gate-movement',
      `${check.id} missing production observation effect`,
    );
    assert.equal(check.missingRequiredProofEffect, 'fails-closed', `${check.id} missing required proof effect`);
    assert.equal(check.failedRequiredProofEffect, 'fails-closed', `${check.id} failed required proof effect`);
    assert.equal(check.releaseStatusWithoutProductionObservation, 'NO-GO', `${check.id} final release posture`);
    assert.match(rowFor(text, check.id), /\| Blocking \| Required \| Fail closed \| Held, no movement \|/);
  }
});

test('RPP-0972 support-only observations cannot move final release', () => {
  const { report } = loadEvidenceReport(evidencePath, 'RPP-0972');
  const evaluation = evaluateReleaseGates({
    evidence: completeEvidence('local-candidate'),
    scope: 'local-candidate',
    now: fixedNowIso,
  });
  const marker = formatReleaseGateStatusMarker(evaluation, { label: 'release-gates-ci' });
  const finalReleaseStatus = evaluation.releaseMovement.allowed ? 'GO' : 'NO-GO';

  assert.equal(evaluation.status, report.supportOnlyEvaluator.expectedGateState);
  assert.equal(evaluation.candidateMovement.allowed, report.supportOnlyEvaluator.expectedCandidateMovementAllowed);
  assert.equal(evaluation.releaseMovement.allowed, report.supportOnlyEvaluator.expectedReleaseMovementAllowed);
  assert.equal(evaluation.releaseMovement.finalGates, report.supportOnlyEvaluator.expectedFinalGates);
  assert.equal(evaluation.releaseMovement.candidateGates, report.supportOnlyEvaluator.expectedCandidateGates);
  assert.equal(marker, report.supportOnlyEvaluator.expectedStatusMarker);
  assert.equal(finalReleaseStatus, report.supportOnlyEvaluator.expectedFinalReleaseStatus);
  assert.deepEqual(evaluation.totals, {
    gates: 20,
    passed: 0,
    candidate: 20,
    missing: 0,
    failed: 0,
    blocking: 20,
  });
  assert.ok(
    evaluation.releaseMovement.missingEvidence.every((gate) => gate.status === 'candidate'),
    'support-only evidence must remain candidate evidence instead of final-release proof',
  );
});

test('RPP-0972 failed required proof fails closed with no release-gate movement', () => {
  const { report } = loadEvidenceReport(evidencePath, 'RPP-0972');
  const evidence = completeEvidence('final-release');
  evidence.dryRunRouteEligibility = {
    ok: false,
    eligible: false,
    observed: 'failed-dry-run-route',
    scope: 'final-release',
  };
  const evaluation = evaluateReleaseGates({
    evidence,
    scope: 'final-release',
    now: fixedNowIso,
  });
  const marker = formatReleaseGateStatusMarker(evaluation, { label: 'release-gates-ci' });
  const failedGate = evaluation.gates.find((gate) => gate.id === report.failedRequiredProofEvaluator.failedGateId);

  assert.equal(evaluation.status, report.failedRequiredProofEvaluator.expectedGateState);
  assert.equal(evaluation.candidateMovement.allowed, report.failedRequiredProofEvaluator.expectedCandidateMovementAllowed);
  assert.equal(evaluation.releaseMovement.allowed, report.failedRequiredProofEvaluator.expectedReleaseMovementAllowed);
  assert.equal(evaluation.releaseMovement.finalGates, report.failedRequiredProofEvaluator.expectedFinalGates);
  assert.equal(evaluation.releaseMovement.candidateGates, report.failedRequiredProofEvaluator.expectedCandidateGates);
  assert.equal(marker, report.failedRequiredProofEvaluator.expectedStatusMarker);
  assert.equal(evaluation.releaseMovement.allowed ? 'GO' : 'NO-GO', report.failedRequiredProofEvaluator.expectedFinalReleaseStatus);
  assert.deepEqual(evaluation.totals, report.failedRequiredProofEvaluator.expectedTotals);
  assert.equal(failedGate.status, 'failed');
  assert.equal(failedGate.code, report.failedRequiredProofEvaluator.failedGateCode);
  assert.equal(report.failedRequiredProofEvaluator.releaseGateMovementAllowed, false);
  assert.equal(report.failedRequiredProofEvaluator.releaseGateStatusMovementAllowed, false);
  assert.equal(report.failedRequiredProofEvaluator.failureMode, 'fails-closed');
});

test('RPP-0972 missing production proof keeps final release evaluator and status row held', () => {
  const { report } = loadEvidenceReport(evidencePath, 'RPP-0972');
  const beforeRow = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const result = runReleaseGateCli([
    '--scope',
    'final-release',
    '--now',
    fixedNowIso,
  ], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const afterRow = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });

  assert.equal(result.exitCode, report.finalReleaseEvaluator.expectedExit);
  assert.equal(result.report.releaseStatus, report.finalReleaseEvaluator.observedReleaseStatus);
  assert.equal(result.report.primaryFailureCode, report.finalReleaseEvaluator.primaryFailureCode);
  assert.equal(result.report.primaryFailureBucket, report.finalReleaseEvaluator.primaryFailureBucket);
  assert.equal(result.report.status, report.finalReleaseEvaluator.status);
  assert.equal(result.report.statusMarker, report.finalReleaseEvaluator.statusMarker);
  assert.equal(result.report.mutationAttempted, report.finalReleaseEvaluator.mutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.finalReleaseEvaluator.releaseMovementAllowed);
  assert.equal(result.report.releaseMovement.finalGates, report.finalReleaseEvaluator.finalGates);
  assert.equal(result.report.releaseMovement.candidateGates, report.finalReleaseEvaluator.candidateGates);
  assert.equal(result.report.totals.missing, report.finalReleaseEvaluator.missingRequiredProofCount);
  assert.equal(result.report.totals.failed, report.finalReleaseEvaluator.failedRequiredProofCount);
  assert.equal(report.finalReleaseEvaluator.releaseGateStatusMovementAllowed, false);
  assert.equal(report.finalReleaseEvaluator.failureMode, 'fails-closed');

  assert.deepEqual(afterRow, beforeRow, 'final release evaluator must cause no release-gate status movement');
  assert.equal(afterRow.evidence.releaseVerdict, report.statusRowReadback.releaseVerdict);
  assert.equal(afterRow.evidence.releaseStatus, report.statusRowReadback.releaseStatus);
  assert.deepEqual(afterRow.evidence.statusCounts, report.statusRowReadback.statusCounts);
  assert.deepEqual(afterRow.evidence.gateStatuses, report.statusRowReadback.gateStatuses);
});

test('RPP-0972 evidence is redacted and records exact validation commands', () => {
  const { text, report } = loadEvidenceReport(evidencePath, 'RPP-0972');

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(/https?:\/\//i.test(text), false, 'evidence must not store raw URLs');
  assert.equal(report.evidenceLimits.mutationAttempted, false);
  assert.equal(report.evidenceLimits.rawPayloadsStored, false);
  assert.equal(report.evidenceLimits.rawUrlsIncluded, false);
  assert.equal(report.evidenceLimits.credentialsIncluded, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMutated, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMovementAllowed, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);

  assert.deepEqual(report.validationCommands.map((entry) => entry.command), expectedCommands);
  for (const entry of report.validationCommands) {
    assert.equal(Number.isInteger(entry.expectedExit), true, `${entry.command} expected exit`);
    assert.equal(typeof entry.observed, 'string', `${entry.command} observed result`);
    assert.ok(entry.observed.length > 0, `${entry.command} observed result`);
  }
});

function loadEvidenceReport(targetPath, label) {
  const text = fs.readFileSync(targetPath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${label} evidence must contain one JSON audit record block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function rowFor(text, checkId) {
  const row = text.split('\n').find((line) => line.startsWith(`| \`${checkId}\` |`));

  assert.ok(row, `${checkId} row must exist`);
  return row;
}

function completeEvidence(scope) {
  const sourceUrl = 'https://source.example.test/reprint-push';
  const localUrl = 'https://local-edited.example.test/reprint-push';
  const remoteChangedUrl = 'https://remote-changed.example.test/reprint-push';

  return {
    sourceUrl: { observed: sourceUrl, scope },
    localUrl: { observed: localUrl, scope },
    remoteChangedUrl: { observed: remoteChangedUrl, scope },
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: {
      ok: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
      command: 'node ./scripts/playground/auth-session-source-command.js',
      scope,
    },
    productionSecret: { ok: true, present: true, observed: 'auth-session-source-command', scope },
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'bound-to-source-url',
      scope,
    },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: 'preflight-route', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: 'dry-run-route', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'recovery-inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates-ci:held final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNowIso, scope },
    agentsReleaseGateStatusRow: {
      ok: true,
      present: true,
      observed: 'release-gates-status-row-no-go',
      releaseVerdict: '0/4',
      releaseStatus: 'NO-GO',
      scope,
    },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      mutationAttempted: false,
      scope,
    },
  };
}
