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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0967-security-review-checklist-v4.md');
const fixedNowIso = '2026-06-01T03:00:00.000Z';
const auditedHead = 'b2c0bb0ffd01dde19d136cd78241621e4aefaa46';
const checklistIds = ['SR-01', 'SR-02', 'SR-03', 'SR-04', 'SR-05', 'SR-06', 'SR-07', 'SR-08'];
const topologyGateIds = ['source-url', 'local-url', 'remote-changed-url'];
const credentialGateIds = [
  'auth-source-readback',
  'production-secret',
  'application-password-binding',
  'manage-options-capability',
];
const criticalProductionGateIds = [...topologyGateIds, ...credentialGateIds];
const unresolvedFinalReleaseRiskIds = [
  'source-url',
  'local-url',
  'remote-changed-url',
  'auth-source-readback',
  'production-secret',
  'application-password-binding',
  'manage-options-capability',
  'same-source-identity',
  'preflight-route-identity',
  'dry-run-route-eligibility',
  'apply-route-pre-mutation',
  'journal-route-read-only',
  'recovery-inspect-read-only',
  'tmux-status-marker',
  'progress-release-timestamp',
  'agents-release-gates-row',
  'verify-release-failure-reason',
];

test('RPP-0967 evidence records security review checklist v4 without release movement', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0967');
  assert.equal(report.sliceId, 'RPP-0967');
  assert.equal(report.proofId, 'rpp-0967-security-review-checklist-v4');
  assert.equal(report.variant, 4);
  assert.equal(report.generatedAt, fixedNowIso);
  assert.equal(report.auditedBranch, 'session/rpp-967');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(report.status, 'support-only-review-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.verdict, 'held');
  assert.equal(report.releaseGateState, 'held');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.carriedForwardFrom, {
    rppId: 'RPP-0947',
    proofId: 'rpp-0947-security-review-checklist-v3',
    variant: 3,
    unchangedReleaseMovementRule: true,
    contract: [
      'support-only evidence can support candidate review but cannot move final release',
      'release gate movement requires production-backed final-release evidence',
      'final release remains NO-GO while production-backed proof is absent',
      'unresolved final-release risks remain open until fresh production-backed evidence closes them',
    ],
  });

  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.match(text, /carries forward the RPP-0947 v3 security review contract/);
  assert.match(text, /changes no release gate status\s+file/);
  assert.match(text, /leaves every unresolved final-release risk open/);
  assert.match(text, /final release remains \*\*NO-GO\*\* with the verdict held/);
});

test('RPP-0967 checklist items require production-backed evidence before any gate movement', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.checklistItems.map((item) => item.id), checklistIds);
  assert.deepEqual(report.productionMovementRule, {
    requiresProductionBackedEvidenceForAnyReleaseGateStatusMovement: true,
    supportOnlyEvidenceCanMoveReleaseGateStatus: false,
    currentReviewMovementAttempted: false,
    statusMovementRecorded: 'none',
    requiredEvidencePosture: 'fresh production-backed evidence tied to the checked final-release path',
    allowedReleaseStatusWithoutProductionEvidence: 'NO-GO',
    blockedTargetStatusesWithoutProductionEvidence: [
      'partially_proven',
      'proven',
      'GO',
    ],
  });
  assert.equal(report.reviewDiscipline.releaseGateMovementAllowed, false);
  assert.equal(report.reviewDiscipline.productionBackedEvidenceObserved, false);
  assert.equal(report.reviewDiscipline.supportOnlyReviewEffect, 'no-movement');

  for (const item of report.checklistItems) {
    assert.equal(item.carriedForwardFrom, 'RPP-0947', `${item.id} must carry forward the v3 contract`);
    assert.equal(item.movementPrerequisite, 'production-backed evidence', `${item.id} must require production proof`);
    assert.equal(item.productionEvidenceRequired, true, `${item.id} must require production evidence`);
    assert.equal(item.productionBacked, false, `${item.id} must not claim production backing`);
    assert.equal(item.supportReviewed, true, `${item.id} must be reviewed as support evidence`);
    assert.equal(item.releaseGateSatisfied, false, `${item.id} must not satisfy release gates`);
    assert.equal(item.gateMovementAllowed, false, `${item.id} must forbid release gate movement`);
    assert.match(item.requiredProductionProof, /^Production-backed proof|^Fresh operator evidence/);
  }
});

test('RPP-0967 blocks release movement without production-backed source, local, changed, and credential proof', () => {
  const { report } = loadEvidenceReport();
  const missingAll = evaluateReleaseGates({
    scope: 'final-release',
    now: fixedNowIso,
  });
  const topologyOnly = evaluateReleaseGates({
    evidence: topologyEvidence('final-release'),
    scope: 'final-release',
    now: fixedNowIso,
  });
  const credentialOnly = evaluateReleaseGates({
    evidence: credentialEvidence('final-release'),
    scope: 'final-release',
    now: fixedNowIso,
  });

  assert.deepEqual(report.sourceLocalChangedCredentialPolicy, {
    sourceLocalChangedAndCredentialProofRequired: true,
    blocksReleaseMovementWhenAnyRequiredProofClassMissing: true,
    statusWithoutCompleteProductionProof: 'held',
    finalReleaseStatusWithoutCompleteProductionProof: 'NO-GO',
    topologyProofGateIds: topologyGateIds,
    credentialProofGateIds: credentialGateIds,
    allRequiredProofGateIds: criticalProductionGateIds,
  });

  assertBlockedScenario(
    missingAll,
    report.blockedMovementScenarios.missingAllProductionProof,
    criticalProductionGateIds,
  );
  assertBlockedScenario(
    topologyOnly,
    report.blockedMovementScenarios.topologyWithoutCredentialProof,
    credentialGateIds,
  );
  assertBlockedScenario(
    credentialOnly,
    report.blockedMovementScenarios.credentialProofWithoutTopology,
    topologyGateIds,
  );

  assertMissingIdsDoNotInclude(topologyOnly, topologyGateIds);
  assertMissingIdsDoNotInclude(credentialOnly, credentialGateIds);
});

test('RPP-0967 support evidence can support candidate review but cannot move final release', () => {
  const { report } = loadEvidenceReport();
  const evaluation = evaluateReleaseGates({
    evidence: completeSupportEvidence('local-candidate'),
    scope: 'local-candidate',
    now: fixedNowIso,
  });
  const marker = formatReleaseGateStatusMarker(evaluation, { label: 'release-gates-ci' });

  assert.equal(evaluation.status, report.supportOnlyEvaluator.expectedGateState);
  assert.equal(evaluation.candidateMovement.allowed, report.supportOnlyEvaluator.expectedCandidateMovementAllowed);
  assert.equal(evaluation.releaseMovement.allowed, report.supportOnlyEvaluator.expectedReleaseMovementAllowed);
  assert.equal(evaluation.releaseMovement.finalGates, report.supportOnlyEvaluator.expectedFinalGates);
  assert.equal(evaluation.releaseMovement.candidateGates, report.supportOnlyEvaluator.expectedCandidateGates);
  assert.equal(marker, report.supportOnlyEvaluator.expectedStatusMarker);
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
    'support-only evidence must stay candidate evidence instead of final release evidence',
  );
});

test('RPP-0967 final release evaluator and status row stay held without production evidence', () => {
  const { report } = loadEvidenceReport();
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
  const row = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });

  assert.equal(report.finalReleaseEvaluator.command, 'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:00:00.000Z');
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

  assert.equal(row.evidence.releaseVerdict, report.statusRowReadback.releaseVerdict);
  assert.equal(row.evidence.releaseStatus, report.statusRowReadback.releaseStatus);
  assert.deepEqual(row.evidence.statusCounts, report.statusRowReadback.statusCounts);
  assert.deepEqual(row.evidence.gateStatuses, report.statusRowReadback.gateStatuses);
});

test('RPP-0967 leaves every unresolved final-release risk open', () => {
  const { report } = loadEvidenceReport();
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

  assert.deepEqual(report.unresolvedFinalReleaseRiskPolicy, {
    finalReleaseRisksRemainOpen: true,
    unresolvedRiskCount: unresolvedFinalReleaseRiskIds.length,
    closedByThisEvidence: 0,
    releaseGateStatusMovement: 'none',
    requiredToClose: 'fresh production-backed final-release evidence',
  });
  assert.deepEqual(
    report.unresolvedFinalReleaseRisks.map((risk) => risk.id),
    unresolvedFinalReleaseRiskIds,
  );
  assert.deepEqual(
    report.unresolvedFinalReleaseRisks.map((risk) => risk.id),
    result.report.releaseMovement.missingEvidence.map((gate) => gate.id),
  );

  for (const risk of report.unresolvedFinalReleaseRisks) {
    assert.equal(risk.status, 'open', `${risk.id} must remain open`);
    assert.equal(risk.requiredProductionBackedEvidence, true, `${risk.id} must require production backing`);
    assert.equal(risk.productionBacked, false, `${risk.id} must not claim production backing`);
    assert.equal(risk.releaseGateSatisfied, false, `${risk.id} must not satisfy a release gate`);
    assert.equal(risk.gateMovementAllowed, false, `${risk.id} must not allow gate movement`);
  }
});

test('RPP-0967 evidence remains redacted and documents final NO-GO', () => {
  const { text, report } = loadEvidenceReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(/https?:\/\//i.test(text), false, 'evidence must not store raw URLs');
  assert.equal(report.evidenceLimits.mutationAttempted, false);
  assert.equal(report.evidenceLimits.rawPayloadsStored, false);
  assert.equal(report.evidenceLimits.rawUrlsIncluded, false);
  assert.equal(report.evidenceLimits.credentialsIncluded, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMutated, false);
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
  assert.equal(report.evidenceLimits.unresolvedFinalReleaseRisksClosed, false);
  assert.equal(report.evidenceLimits.finalReleaseRisksLeftOpen, true);
  assert.equal(report.evidenceLimits.statusMovementCausedByThisArtifact, 'none');
  assert.equal(report.evidenceLimits.rpp0947ContractCarriedForward, true);
  assert.match(text, /support evidence for the RPP-0967 security review checklist v4/);
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0967 evidence must contain one JSON audit record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertBlockedScenario(evaluation, expected, requiredMissingGateIds) {
  const missingIds = evaluation.releaseMovement.missingEvidence.map((gate) => gate.id);

  assert.equal(evaluation.scope, expected.scope);
  assert.equal(evaluation.status, expected.expectedGateState);
  assert.equal(evaluation.releaseMovement.allowed, expected.expectedReleaseMovementAllowed);
  assert.equal(evaluation.releaseMovement.finalGates, expected.expectedFinalGates);
  assert.equal(evaluation.releaseMovement.candidateGates, expected.expectedCandidateGates);
  assert.deepEqual(expected.requiredMissingGateIds, requiredMissingGateIds);

  for (const gateId of requiredMissingGateIds) {
    assert.ok(missingIds.includes(gateId), `${gateId} must block release movement`);
  }
}

function assertMissingIdsDoNotInclude(evaluation, forbiddenGateIds) {
  const missingIds = evaluation.releaseMovement.missingEvidence.map((gate) => gate.id);

  for (const gateId of forbiddenGateIds) {
    assert.equal(missingIds.includes(gateId), false, `${gateId} should be satisfied in this scenario`);
  }
}

function completeSupportEvidence(scope) {
  return {
    ...topologyEvidence(scope),
    packagedFallback: { ok: true, observed: false, scope },
    ...credentialEvidence(scope),
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

function topologyEvidence(scope) {
  const sourceUrl = 'https://source.example.test/reprint-push';
  const localUrl = 'https://local-edited.example.test/reprint-push';
  const remoteChangedUrl = 'https://remote-changed.example.test/reprint-push';

  return {
    sourceUrl: { observed: sourceUrl, scope },
    localUrl: { observed: localUrl, scope },
    remoteChangedUrl: { observed: remoteChangedUrl, scope },
  };
}

function credentialEvidence(scope) {
  const sourceUrl = 'https://source.example.test/reprint-push';

  return {
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
  };
}
