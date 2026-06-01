import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0946-critic-audit-update-v3.md');
const evidenceRelativePath = 'docs/evidence/rpp-0946-critic-audit-update-v3.md';
const fixedNowIso = '2026-06-01T02:56:00.000Z';
const auditedHead = 'acf32f006acc19e28c08459a7ad908987373934e';
const staleRpp0926Head = '6cf89e18661ca4241dea2dc07472110e36161c7b';

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0946-critic-audit-update-v3.test.js',
  'node --test --test-name-pattern RPP-0946 test/rpp-0946-critic-audit-update-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0946-critic-audit-update-v3.md',
  'git diff --check',
]);

const expectedExactCommands = Object.freeze([
  'git rev-parse HEAD',
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='RPP-0941' -8",
  "git log --oneline --all --grep='RPP-0940' -8",
  "git log --oneline --all --grep='audit' -16",
  "git log --oneline --all --grep='critic audit' -12",
  "git show -s --format='%H %s' acf32f006 9548397c4 244117a4b bd7ab6e19 bbe942e59 95de26357 bb4d8be67 3804aaa23 fc7f442a0 9519d3015 73f80f83b 940e23e46 fe3af9d8e",
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:56:00.000Z',
  ...expectedValidationCommands,
]);

const expectedCommits = Object.freeze([
  ['acf32f006acc19e28c08459a7ad908987373934e', 'Merge published progress page state'],
  ['9548397c4ffd1ca9e3761812b934bb56e5a33397', 'docs: publish progress page'],
  ['244117a4b8777650b2b641f0a894be94d10fecc1', 'docs: refresh progress for RPP-0941 integration'],
  ['bd7ab6e19578eeab8dfea6d726c95aec78ee3fc1', "Merge branch 'session/rpp-941' into lane/evidence-integration-20260527"],
  ['bbe942e597db169f4ee53f6e9b3159c66aeccb15', 'docs: refresh progress for RPP-0940 integration'],
  ['95de2635766d5be72aeb0775f3dc7ba0cfbb439e', "Merge branch 'session/rpp-940' into lane/evidence-integration-20260527"],
  ['3804aaa2372d36f76bd8b80c74bdc29a0fddf8e3', 'Add RPP-0940 go/no-go v2 evidence'],
  ['bb4d8be6753e95a2c41a4aea19ee857d7734e1b3', 'Add RPP-0941 release gate 1 final audit v3'],
  ['73f80f83bc45585984162740ec445ad1ae38daed', 'Add RPP-0942 gate 2 final audit v3'],
  ['fc7f442a065d262e33aed01a41384eca0f48a30c', 'Add RPP-0943 release gate 3 final audit v3'],
  ['9519d3015e496973220e3a4204d2dec59303d746', 'Add RPP-0944 gate 4 final audit evidence'],
  ['940e23e46ebb6bb05f15d580f41f6a45c1f27725', 'Add RPP-0926 critic audit update v2 evidence'],
  ['fe3af9d8e40aaf15bc0698359401661f44faf4cd', 'Add RPP-0906 critic audit disposition'],
]);

const expectedGapIds = Object.freeze([
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
]);

const expectedGapCodes = Object.freeze([
  'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
  'REPRINT_PUSH_LOCAL_URL_REQUIRED',
  'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
  'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
  'REPRINT_PUSH_SECRET_REQUIRED',
  'APPLICATION_PASSWORD_BINDING_REQUIRED',
  'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
  'SAME_SOURCE_IDENTITY_REQUIRED',
  'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
  'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
  'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
  'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
  'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
  'TMUX_STATUS_MARKER_REQUIRED',
  'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
  'AGENTS_RELEASE_GATES_ROW_REQUIRED',
  'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
]);

test('RPP-0946 evidence records support-only critic-audit NO-GO posture on the updated lane head', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0946 critic audit update v3$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 3$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-946`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0926Head));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0946');
  assert.equal(report.proofId, 'rpp-0946-critic-audit-update-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'critic-audit-risk-disposition-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0926-critic-audit-update-v2.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-946',
    headBeforeEvidence: auditedHead,
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '9548397c4ffd1ca9e3761812b934bb56e5a33397',
    originMainSubject: 'docs: publish progress page',
  });

  assert.deepEqual(report.posture, {
    productionEndpointAdded: false,
    productionMutationAttempted: false,
    productionLiveSourceProofAdded: false,
    releaseGateStatusMoved: false,
    progressFilesChanged: false,
    completionChecklistChanged: false,
    releaseGateFilesChanged: false,
    finalReleaseNoGoRetained: true,
  });
});

test('RPP-0946 evidence links exact commands to commit anchors', () => {
  const { report, text } = loadEvidenceReport();

  for (const command of expectedExactCommands) {
    assert.ok(text.includes(`\`${command}\``) || text.includes(command), `missing exact command: ${command}`);
  }

  assert.deepEqual(report.validationCommands, expectedValidationCommands);
  assert.equal(report.relevantCurrentCommits.length, expectedCommits.length);

  for (const [sha, subject] of expectedCommits) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assert.ok(text.includes(`\`${sha}\``), `${sha} must be linked in the evidence text`);
    assert.ok(text.includes(subject), `${subject} must be linked in the evidence text`);
  }

  assert.deepEqual(
    report.commandCommitLinks.map((entry) => entry.command),
    expectedExactCommands.slice(0, 7),
  );
  assert.deepEqual(report.commandCommitLinks[0].commitRefs, [auditedHead]);
  assert.deepEqual(report.commandCommitLinks[1].commitRefs, [
    'acf32f006',
    '9548397c4',
    '244117a4b',
    'bd7ab6e19',
    'bbe942e59',
    '95de26357',
  ]);
  assert.deepEqual(report.commandCommitLinks[4].commitRefs, [
    'fc7f442a0',
    '9519d3015',
    '73f80f83b',
    'bb4d8be67',
    '940e23e46',
    'fe3af9d8e',
  ]);
  assert.deepEqual(report.commandCommitLinks[5].commitRefs, [
    '940e23e46',
    'fe3af9d8e',
  ]);
});

test('RPP-0946 evidence names remaining release-blocking gaps and keeps the verdict held', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.riskDisposition.decision, 'NO-GO');
  assert.equal(report.riskDisposition.productionBackedEvidenceObserved, false);
  assert.equal(report.riskDisposition.remainingCriticBlockersPreserved, true);
  assert.equal(report.riskDisposition.closedProductionRisks, 0);
  assert.equal(report.riskDisposition.releaseBlocker, true);
  assert.equal(report.riskDisposition.requiredNextEvidence.length, 10);

  assert.deepEqual(report.remainingReleaseBlockingEvidenceGaps.map((gap) => gap.id), expectedGapIds);
  assert.deepEqual(report.remainingReleaseBlockingEvidenceGaps.map((gap) => gap.code), expectedGapCodes);
  assert.equal(report.remainingReleaseBlockingEvidenceGaps.length, 17);

  assert.deepEqual(report.releaseGateSnapshot.totals, {
    gates: 20,
    passed: 3,
    candidate: 0,
    missing: 17,
    failed: 0,
    blocking: 17,
  });
  assert.equal(report.releaseGateSnapshot.exitCode, 1);
  assert.equal(report.releaseGateSnapshot.releaseStatus, 'NO-GO');
  assert.equal(report.releaseGateSnapshot.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.releaseGateSnapshot.mutationAttempted, false);
  assert.equal(report.releaseGateSnapshot.releaseMovementAllowed, false);
  assert.equal(
    report.releaseGateSnapshot.statusMarker,
    '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]',
  );

  assert.match(text, /All remaining release-blocking gaps below stay open; this audit closes none\./);
  assert.match(text, /This support-only evidence causes no release-gate status movement\./);
  assert.match(text, /The final release verdict remains \*\*NO-GO\*\*/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);
});

test('RPP-0946 artifacts remain redacted and final release gates remain NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0946 critic audit update v3' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.primaryFailureBucket, 'topology');
  assert.equal(result.report.statusMarker, report.releaseGateSnapshot.statusMarker);
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '3/20');
  assert.equal(result.report.releaseMovement.candidateGates, '3/20');
  assert.deepEqual(result.report.totals, report.releaseGateSnapshot.totals);
  assert.deepEqual(
    result.report.releaseMovement.missingEvidence.map((gap) => gap.id),
    expectedGapIds,
  );
});

test('RPP-0946 evidence records no release-gate status movement or protected file movement', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.evidenceLimits, {
    mode: 'critic-audit-support-only',
    rawPayloadsStored: false,
    credentialsStored: false,
    privatePathsStored: false,
    releaseGateChanged: false,
    releaseGateFilesChanged: false,
    progressRecordChanged: false,
    progressPageChanged: false,
    completionChecklistChanged: false,
    statusFilesChanged: false,
    dashboardsStarted: false,
    remoteTunnelsUsed: false,
  });
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0946 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
