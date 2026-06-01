import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0991-rollback-repair-runbook-release-verifier-v5.md',
);
const patternEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0971-rollback-repair-runbook-v4.md');
const evidenceRelativePath = 'docs/evidence/rpp-0991-rollback-repair-runbook-release-verifier-v5.md';
const testRelativePath = 'test/rpp-0991-rollback-repair-runbook-release-verifier-v5.test.js';
const fixedNowIso = '2026-06-01T04:31:00.000Z';
const auditedLaneHead = '72d64178f823617ae8a393a53a147597aa90be5d';
const staleRpp0971LaneHead = 'fac63dd2cc01a010194b68421769ca43d9bd36c5';

const expectedStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='rollback\\|repair\\|recovery' -24",
  "git log --oneline --all --grep='RPP-0971\\|RPP-0981\\|RPP-0982\\|RPP-0983\\|RPP-0984\\|RPP-0985\\|RPP-0986' -20",
  "git show -s --format='%H%x09%s' 72d64178f c19a06c30 99fdf35b4 79a6f7741 97ced4aea 1c901e7c4 914fc17f1 29eaf2c0c bc2ccc316 b5dd7c9d7 63946dbed f5a566a50 ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3",
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0991-rollback-repair-runbook-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0991 test/rpp-0991-rollback-repair-runbook-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0991-rollback-repair-runbook-release-verifier-v5.md',
  'git diff --check',
]);

const expectedCommits = Object.freeze([
  ['72d64178f823617ae8a393a53a147597aa90be5d', '72d64178f', 'Merge published progress page state'],
  ['c19a06c3079dcd6c940625cbc23046e2f6ce7c65', 'c19a06c30', 'docs: publish progress page'],
  ['99fdf35b4403b9f04cced3fb28c961dbb2959f74', '99fdf35b4', 'docs: refresh progress for RPP-0986 integration'],
  [
    '79a6f7741eb5fd00a9cce4654f13e775277acd6d',
    '79a6f7741',
    "Merge branch 'session/rpp-986' into lane/evidence-integration-20260527",
  ],
  ['97ced4aeaf5b80afd40dbbdc3887a0eb3d5deedb', '97ced4aea', 'Add RPP-0986 critic audit verifier v5 evidence'],
  ['1c901e7c49d251122d799799518cacdee2fbe04e', '1c901e7c4', 'Add RPP-0985 objective audit verifier v5 evidence'],
  ['914fc17f1566fb5b49f4d61ce40777db86650d8b', '914fc17f1', 'Add RPP-0984 release gate 4 verifier v5 evidence'],
  ['29eaf2c0c0dcb8d8111af535ea4c9a2977c0ac3b', '29eaf2c0c', 'Add RPP-0983 release gate 3 verifier v5 evidence'],
  ['bc2ccc3168b1668dba22016a1c0b087f4bc5080e', 'bc2ccc316', 'Add RPP-0982 release gate 2 verifier v5 evidence'],
  ['b5dd7c9d7755b029b44e6f5e996be4a441ced133', 'b5dd7c9d7', 'Add RPP-0981 release gate 1 verifier v5 evidence'],
  ['63946dbed87dd9c05b508c86def46ef41120462e', '63946dbed', 'Add RPP-0971 rollback repair runbook v4 evidence'],
  ['f5a566a50d05aa077c328091f04da6aba911d67e', 'f5a566a50', 'Add RPP-0951 rollback repair runbook v3 evidence'],
  ['ccac5bbebe8b1ae3f5cf37ac1f078518f26ce450', 'ccac5bbeb', 'Add RPP-0931 rollback repair runbook v2 evidence'],
  ['29d058579b38e315bf76667deff3a7a550f5c1c2', '29d058579', 'Add RPP-0911 rollback repair runbook'],
  ['54f6b6b3c806c1756dd8c73f5fe7cc381b2ee0e2', '54f6b6b3c', 'Add RPP-0904 operator safe recovery docs'],
  ['e627a9717fa658b9eae5fabbdec34994fa9476cb', 'e627a9717', 'Add RPP-0700 manual recovery audit export release proof'],
  ['bced8d1ae925ff2d14f41ca25eaf30f1abd1f594', 'bced8d1ae', 'Add RPP-0691 new-remote recovery release proof'],
  ['3b0d2c8732a559406bf0e943bd93a126dfed9ce8', '3b0d2c873', 'Add RPP-0692 blocked recovery release proof'],
  ['d3c23e7e646f5dbbaa51e58d28b5b0b03ab1b518', 'd3c23e7e6', 'Add RPP-0693 unknown-drift recovery release proof'],
  ['12f684cd343a8082a24ca6207d1b2c5ff8729ba1', '12f684cd3', 'Add RPP-0690 old-remote recovery release proof'],
]);

const expectedPrerequisiteIds = Object.freeze([
  'failed-push-or-receipt-identifier',
  'journal-ownership-boundary',
  'restart-readable-monotonic-journal',
  'planned-target-counts',
  'before-after-hash-envelope',
  'terminal-or-missing-terminal-evidence',
  'same-request-replay-result',
  'artifact-redaction-scan-result',
  'production-backed-repair-proof',
]);

const expectedStopConditionIds = Object.freeze([
  'missing-required-evidence',
  'unknown-recovery-state',
  'drift-outside-before-after-envelope',
  'partial-or-unowned-remote',
  'non-monotonic-or-unreadable-journal',
  'planned-target-count-mismatch',
  'terminal-evidence-missing',
  'fresh-mutation-would-run',
  'manual-production-write-requested',
  'production-backed-proof-absent',
]);

test('RPP-0991 evidence records support-only rollback repair release verifier v5 on the updated lane head', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0991 rollback repair runbook release verifier v5 evidence$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 5$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-991`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0971LaneHead));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0991');
  assert.equal(report.proofId, 'rpp-0991-rollback-repair-runbook-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'rollback-repair-runbook-release-verifier-v5-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseVerifier, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0971-rollback-repair-runbook-v4.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-991',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '72d64178f',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: 'c19a06c3079dcd6c940625cbc23046e2f6ce7c65',
    originMainShortSha: 'c19a06c30',
    originMainSubject: 'docs: publish progress page',
  });

  assert.deepEqual(report.writeScope.allowedFiles, [evidenceRelativePath, testRelativePath]);
  assert.equal(report.writeScope.releaseGateStatusMovement, false);
});

test('RPP-0991 carries forward the RPP-0971 v4 rollback and repair contract', () => {
  const { report, text } = loadEvidenceReport();
  const { report: pattern } = loadEvidenceReport(patternEvidencePath);

  assert.deepEqual(report.carriedForwardRollbackRepairContract, {
    patternRppId: 'RPP-0971',
    patternProofId: 'rpp-0971-rollback-repair-runbook-v4',
    patternVariant: 4,
    patternRecordPath: 'docs/evidence/rpp-0971-rollback-repair-runbook-v4.md',
    requiresExactAuditCommandLinks: true,
    requiresExactValidationCommandLinks: true,
    requiresCommitAnchors: true,
    requiresRollbackPrerequisites: true,
    requiresRepairPrerequisites: true,
    requiresRepairStopRules: true,
    requiresProductionBackedRepairProofBeforeReleaseMovement: true,
    requiresFinalReleaseNoGo: true,
    requiresNoReleaseGateMovement: true,
    carriedForwardFields: [
      'runbookContract',
      'rollbackRepairPrerequisites',
      'rollbackPolicy',
      'repairPolicy',
      'repairStopConditions',
      'productionBackedRepairProofGate',
      'requiredEvidence',
    ],
    rule: 'Carry forward the RPP-0971 v4 rollback/repair contract unchanged unless production-backed rollback or repair proof exists; no such proof is present in this release-verifier support-only slice.',
  });

  assert.deepEqual(report.runbookContract, pattern.runbookContract);
  assert.deepEqual(report.rollbackRepairPrerequisites, pattern.rollbackRepairPrerequisites);
  assert.deepEqual(report.rollbackPolicy, pattern.rollbackPolicy);
  assert.deepEqual(report.repairPolicy, pattern.repairPolicy);
  assert.deepEqual(report.repairStopConditions, pattern.repairStopConditions);
  assert.deepEqual(report.productionBackedRepairProofGate, pattern.productionBackedRepairProofGate);
  assert.deepEqual(report.requiredEvidence, pattern.requiredEvidence);
  assert.match(text, /carries forward the RPP-0971 v4 rollback\/repair contract/);
  assert.match(text, /production-backed repair proof is required before release movement/);
});

test('RPP-0991 release verifier carry-through stays support-only and fail-closed', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.releaseVerifierCarryThrough, {
    variant: 5,
    scope: 'support-only-release-verifier-carry-through',
    contractSourceRppId: 'RPP-0971',
    contractSourceProofId: 'rpp-0971-rollback-repair-runbook-v4',
    contractSourceRecordPath: 'docs/evidence/rpp-0971-rollback-repair-runbook-v4.md',
    supportOnlyValidationRecorded: true,
    laneContextAnchorsRecorded: true,
    auditCommandsLinkedToCommits: true,
    validationCommandsLinkedToCommits: true,
    productionBackedRollbackProofAdded: false,
    productionBackedRepairProofAdded: false,
    productionDurabilityProofAdded: false,
    releaseGateMovementClaimed: false,
    finalReleaseStatus: 'NO-GO',
  });

  assert.deepEqual(report.releaseVerifierRequiredEvidence, [
    'support-only-validation-output',
    'lane-context-commit-anchors',
    'exact-audit-command-links',
    'exact-validation-command-links',
    'open-production-backed-proof-gaps',
    'final-no-go-release-posture',
  ]);
  assert.equal(report.unresolvedProductionBackedProofGaps.length, 10);
  for (const gap of report.unresolvedProductionBackedProofGaps) {
    assert.equal(gap.status, 'open');
    assert.equal(gap.releaseBlocking, true);
    assert.equal(gap.failClosedAction, 'hold-final-release-no-go');
  }
  assert.ok(
    report.unresolvedProductionBackedProofGaps.some((gap) => gap.id === 'production-repair-proof'),
    'production repair proof gap must remain open',
  );
  assert.match(text, /The release-verifier carry-through is support-only/);
  assert.match(text, /Unresolved production-backed proof gaps remain open and\s+fail closed/);
});

test('RPP-0991 rollback and repair controls name prerequisites and stop rules', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.runbookContract.acceptableStates, expectedStates);
  assert.equal(report.runbookContract.unknownStateAction, 'blocked-recovery');
  assert.equal(report.runbookContract.missingEvidenceAction, 'blocked-recovery');
  assert.equal(report.runbookContract.driftOutsideEnvelopeAction, 'blocked-recovery');
  assert.equal(report.runbookContract.partialRemoteAction, 'blocked-recovery');
  assert.equal(report.runbookContract.manualWriteRepairAuthorized, false);
  assert.equal(report.runbookContract.automaticRollbackAuthorized, false);
  assert.equal(report.runbookContract.releaseMovementAuthorized, false);
  assert.equal(report.runbookContract.productionBackedProofRequiredForRelease, true);

  assert.deepEqual(report.rollbackRepairPrerequisites.map((entry) => entry.id), expectedPrerequisiteIds);
  for (const prerequisite of report.rollbackRepairPrerequisites) {
    assert.equal(prerequisite.required, true);
    assert.match(prerequisite.purpose, /\S/);
    assert.ok(
      expectedStopConditionIds.includes(prerequisite.stopIfMissing),
      `${prerequisite.id} must route to a known stop condition`,
    );
  }

  assert.equal(report.rollbackPolicy.decision, 'not-authorized-by-current-artifacts');
  assert.equal(report.rollbackPolicy.rawBeforeValuesAvailable, false);
  assert.equal(report.rollbackPolicy.requiredStateBeforeRetry, 'old-remote');
  assert.equal(report.rollbackPolicy.stopOnAnyNewDriftedOrUnknownTarget, true);
  assert.equal(report.repairPolicy.decision, 'support-only-roll-forward-review');
  assert.equal(report.repairPolicy.manualPatchAction, 'forbidden');
  assert.equal(report.repairPolicy.releaseActionWithoutProductionProof, 'hold-final-release-no-go');

  assert.deepEqual(report.repairStopConditions.map((entry) => entry.id), expectedStopConditionIds);
  for (const stopCondition of report.repairStopConditions) {
    assert.match(stopCondition.condition, /\S/);
    assert.match(stopCondition.action, /^(stop|hold)-/);
  }

  assert.match(text, /Rollback and repair review requires a failed push or receipt identifier/);
  assert.match(text, /same-request replay evidence with zero fresh\s+mutations/);
  assert.match(text, /Repair must stop when any required evidence is missing/);
  assert.match(text, /manual production writes are requested/);
  assert.match(text, /production-backed\s+proof is absent for release/);
});

test('RPP-0991 audit file links exact audit and validation commands to commit anchors', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(text.includes(command), `missing exact command: ${command}`);
  }

  assert.equal(report.relevantCurrentCommits.length, expectedCommits.length);
  for (const [sha, shortSha, subject] of expectedCommits) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.shortSha, shortSha);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assert.ok(text.includes(`\`${shortSha}\``), `${shortSha} must be linked in the evidence text`);
    assert.ok(text.includes(subject), `${subject} must be linked in the evidence text`);
    assertGitSubject(sha, subject);
  }

  assert.deepEqual(
    report.commandCommitLinks.map((entry) => entry.command),
    expectedAuditCommands,
  );
  assert.deepEqual(
    report.validationCommandCommitLinks.map((entry) => entry.command),
    expectedValidationCommands,
  );

  const knownShortRefs = new Set(report.relevantCurrentCommits.map((commit) => commit.shortSha));
  for (const link of [...report.commandCommitLinks, ...report.validationCommandCommitLinks]) {
    assert.ok(link.commitRefs.length > 0, `${link.command} must name at least one commit`);
    assert.match(link.purpose, /\S/);
    for (const commitRef of link.commitRefs) {
      assert.ok(knownShortRefs.has(commitRef), `${link.command} must reference known commit ${commitRef}`);
    }
  }

  const validationTestLink = report.validationCommandCommitLinks.find(
    (entry) => entry.command === expectedValidationCommands[1],
  );
  assert.ok(validationTestLink.commitRefs.includes('97ced4aea'));
  assert.ok(validationTestLink.commitRefs.includes('63946dbed'));
  assert.ok(validationTestLink.purpose.includes('support-only carry-through'));
});

test('RPP-0991 evidence blocks release movement without production-backed repair proof', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.deepEqual(report.posture, {
    productionEndpointAdded: false,
    productionMutationAttempted: false,
    productionRollbackAttempted: false,
    productionRepairAttempted: false,
    productionLiveSourceProofAdded: false,
    productionDurabilityProofAdded: false,
    releaseGateStatusMoved: false,
    releaseGateFilesChanged: false,
    progressFilesChanged: false,
    completionChecklistChanged: false,
    finalReleaseNoGoRetained: true,
  });
  assert.deepEqual(report.productionBackedRepairProofGate, {
    requiredBeforeReleaseMovement: true,
    observedProductionRollbackProof: false,
    observedProductionRepairProof: false,
    observedProductionDurabilityProof: false,
    decisionWithoutProof: 'block-release-movement',
    releaseGateStateWithoutProof: 'held',
    allowedStatusMovementWithoutProof: false,
    finalReleaseStatusWithoutProof: 'NO-GO',
  });
  assert.equal(report.evidenceLimits.releaseGateFilesChanged, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMoved, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.productionBackedProofGapsOpen, true);
  assert.equal(report.evidenceLimits.remoteTunnelInstructionsStored, false);

  assert.doesNotThrow(() =>
  assertEvidenceHasNoRawValues(report, { label: 'RPP-0991 rollback repair release verifier v5 evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.primaryFailureBucket, 'topology');
  assert.equal(result.report.status, 'held');
  assert.equal(result.report.gateState, 'held');
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '3/20');
  assert.equal(result.report.releaseMovement.candidateGates, '3/20');
  assert.equal(result.report.statusMarker, report.releaseGateSnapshot.statusMarker);
  assert.deepEqual(result.report.totals, report.releaseGateSnapshot.totals);

  assert.equal(report.releaseGateSnapshot.exitCode, 1);
  assert.equal(report.releaseGateSnapshot.releaseStatus, 'NO-GO');
  assert.equal(report.releaseGateSnapshot.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.releaseGateSnapshot.mutationAttempted, false);
  assert.equal(report.releaseGateSnapshot.releaseMovementAllowed, false);
  assert.match(text, /release movement is\s+blocked and the final release verdict remains \*\*NO-GO\*\*/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);
});

function loadEvidenceReport(filePath = evidencePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'rollback repair release verifier evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertGitSubject(sha, expectedSubject) {
  const result = spawnSync('git', ['show', '-s', '--format=%s', sha], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expectedSubject);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
