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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0951-rollback-repair-runbook-v3.md');
const evidenceRelativePath = 'docs/evidence/rpp-0951-rollback-repair-runbook-v3.md';
const fixedNowIso = '2026-06-01T03:10:00.000Z';
const auditedLaneHead = '675b362f58cb1fd589c78e93e7002e02d7a66da4';
const staleRpp0931LaneHead = 'b92b0ee5c';

const expectedStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
  "git log --oneline --all --grep='RPP-0947\\|RPP-0948\\|RPP-0949\\|RPP-0950' -12",
  "git show -s --format='%H%x09%s' 675b362f5 9f278e4d9 1faf54e5e ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 2f53dde24 97cc7daab a0576fdd6",
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0951-rollback-repair-runbook-v3.test.js',
  'node --test --test-name-pattern RPP-0951 test/rpp-0951-rollback-repair-runbook-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0951-rollback-repair-runbook-v3.md',
  'git diff --check',
]);

const expectedCommits = Object.freeze([
  ['675b362f58cb1fd589c78e93e7002e02d7a66da4', '675b362f5', 'Merge published progress page state'],
  ['9f278e4d975b5073dec0e4c21ce75ec1a637e5be', '9f278e4d9', 'docs: publish progress page'],
  ['1faf54e5e48d1b85e52ade7b68016057daf288db', '1faf54e5e', 'docs: refresh progress for RPP-0946 integration'],
  ['ccac5bbebe8b1ae3f5cf37ac1f078518f26ce450', 'ccac5bbeb', 'Add RPP-0931 rollback repair runbook v2 evidence'],
  ['29d058579b38e315bf76667deff3a7a550f5c1c2', '29d058579', 'Add RPP-0911 rollback repair runbook'],
  ['54f6b6b3c806c1756dd8c73f5fe7cc381b2ee0e2', '54f6b6b3c', 'Add RPP-0904 operator safe recovery docs'],
  ['e627a9717fa658b9eae5fabbdec34994fa9476cb', 'e627a9717', 'Add RPP-0700 manual recovery audit export release proof'],
  ['bced8d1ae925ff2d14f41ca25eaf30f1abd1f594', 'bced8d1ae', 'Add RPP-0691 new-remote recovery release proof'],
  ['3b0d2c8732a559406bf0e943bd93a126dfed9ce8', '3b0d2c873', 'Add RPP-0692 blocked recovery release proof'],
  ['d3c23e7e646f5dbbaa51e58d28b5b0b03ab1b518', 'd3c23e7e6', 'Add RPP-0693 unknown-drift recovery release proof'],
  ['12f684cd343a8082a24ca6207d1b2c5ff8729ba1', '12f684cd3', 'Add RPP-0690 old-remote recovery release proof'],
  ['2f53dde24af98a4b47efd0073d76f2ae1def4186', '2f53dde24', 'docs: add RPP-0949 operator runbook v3 evidence'],
  ['97cc7daabcaeb1cccf8e10d3ff5eaca0df283b56', '97cc7daab', 'Add RPP-0948 privacy redaction review v3'],
  ['a0576fdd6bf9fb43b9d827af6d907af692f5ac16', 'a0576fdd6', 'Add RPP-0947 security review checklist evidence'],
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

test('RPP-0951 evidence records support-only rollback repair v3 on the updated lane head', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0951 rollback repair runbook v3 evidence$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 3$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-951`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0931LaneHead));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0951');
  assert.equal(report.proofId, 'rpp-0951-rollback-repair-runbook-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'rollback-repair-runbook-v3-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0931-rollback-repair-runbook-v2.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-951',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '675b362f5',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '9f278e4d975b5073dec0e4c21ce75ec1a637e5be',
    originMainShortSha: '9f278e4d9',
    originMainSubject: 'docs: publish progress page',
  });
});

test('RPP-0951 rollback and repair controls name prerequisites and stop rules', () => {
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

test('RPP-0951 audit file links exact audit and validation commands to commit anchors', () => {
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
});

test('RPP-0951 evidence blocks release movement without production-backed repair proof', async () => {
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
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0951 rollback repair runbook v3 evidence' }));
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

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0951 evidence must contain one JSON record block');
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
