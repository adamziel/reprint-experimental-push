import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0966-critic-audit-update-v4.md');
const evidenceRelativePath = 'docs/evidence/rpp-0966-critic-audit-update-v4.md';
const fixedNowIso = '2026-06-01T03:46:00.000Z';
const auditedHead = '4d3095533ffeac7c4d9434bf9eb4fe7e94bf003d';
const staleRpp0946Head = 'acf32f006acc19e28c08459a7ad908987373934e';

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0966-critic-audit-update-v4.test.js',
  'node --test --test-name-pattern RPP-0966 test/rpp-0966-critic-audit-update-v4.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0966-critic-audit-update-v4.md',
  'git diff --check',
]);

const expectedExactCommands = Object.freeze([
  'git rev-parse HEAD',
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='RPP-0961' -8",
  "git log --oneline --all --grep='RPP-0960' -8",
  "git log --oneline --all --grep='audit' -16",
  "git log --oneline --all --grep='critic audit' -12",
  "git show -s --format='%H %s' 4d309553 0d64e9c0e db241c13d bb6123914 6e07ddbfb 950410322 a355bb865 025d87ec2 b51d6f00b 0da2d08aa 89130d02c 302f62b60 b14b96c86 940e23e46 fe3af9d8e",
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:46:00.000Z',
  ...expectedValidationCommands,
]);

const expectedCommits = Object.freeze([
  ['4d3095533ffeac7c4d9434bf9eb4fe7e94bf003d', 'Merge published progress page state'],
  ['0d64e9c0e1741e47fb25fa23c68d96d813877762', 'docs: publish progress page'],
  ['db241c13dc62559756de269e8f6c335d6f7d6941', 'docs: refresh progress for RPP-0961 integration'],
  ['bb6123914f87aad8ead3daed2c6a053aa85008f0', "Merge branch 'session/rpp-961' into lane/evidence-integration-20260527"],
  ['6e07ddbfb072b6442d877fd37c34e99b7573b5a3', 'docs: refresh progress for RPP-0960 integration'],
  ['95041032273f7e4a979c64e76854c5e2558ca06e', "Merge branch 'session/rpp-960' into lane/evidence-integration-20260527"],
  ['a355bb8652e16bef94dd1b37fa76109ec480c92c', 'Add RPP-0960 go/no-go release decision record v3'],
  ['025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a', 'Add RPP-0961 release gate 1 final audit v4'],
  ['b51d6f00bf1f530af753a04faf09e79410e8734f', 'Add RPP-0962 release gate 2 audit evidence'],
  ['0da2d08aabfaebfeb38aeaf7c8d613edfcf9002d', 'Add RPP-0963 release gate 3 final audit v4'],
  ['89130d02c43963bea8dd40cbf22a4b67f47d2e5a', 'Add RPP-0964 gate 4 final audit evidence'],
  ['302f62b6086890c40395ed61244dde6162ed0dfa', 'RPP-0965 objective audit update v4'],
  ['b14b96c866c6fd700d1c09096428500b892d2688', 'Add RPP-0946 critic audit update v3 evidence'],
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

test('RPP-0966 evidence records support-only critic-audit NO-GO posture on the updated lane head', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0966 critic audit update v4$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 4$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-966`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0946Head));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0966');
  assert.equal(report.proofId, 'rpp-0966-critic-audit-update-v4');
  assert.equal(report.variant, 4);
  assert.equal(report.status, 'critic-audit-risk-disposition-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0946-critic-audit-update-v3.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-966',
    headBeforeEvidence: auditedHead,
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '0d64e9c0e1741e47fb25fa23c68d96d813877762',
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

test('RPP-0966 evidence carries forward the RPP-0946 v3 critic-audit contract', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.carriedForwardCriticAuditContract, {
    patternRppId: 'RPP-0946',
    patternProofId: 'rpp-0946-critic-audit-update-v3',
    patternRecordPath: 'docs/evidence/rpp-0946-critic-audit-update-v3.md',
    requiresExactAuditCommandLinks: true,
    requiresExactValidationCommandLinks: true,
    requiresSupportCommitLinks: true,
    requiresLaneContextCommitLinks: true,
    requiresFinalReleaseNoGo: true,
    requiresNoReleaseGateMovement: true,
  });
  assert.match(text, /carries forward the RPP-0946 v3 critic-audit contract/);
  assert.match(text, /linked support commits, linked lane context/);
});

test('RPP-0966 evidence links exact audit commands, validation commands, and commit anchors', () => {
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
    '4d309553',
    '0d64e9c0e',
    'db241c13d',
    'bb6123914',
    '6e07ddbfb',
    '950410322',
  ]);
  assert.deepEqual(report.commandCommitLinks[4].commitRefs, [
    '302f62b60',
    '89130d02c',
    '0da2d08aa',
    'b51d6f00b',
    '025d87ec2',
    'b14b96c86',
    '940e23e46',
  ]);
  assert.deepEqual(report.commandCommitLinks[5].commitRefs, [
    'b14b96c86',
    '940e23e46',
    'fe3af9d8e',
  ]);
});

test('RPP-0966 evidence names remaining release-blocking gaps and keeps the verdict held', () => {
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

test('RPP-0966 artifacts remain redacted and final release gates remain NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0966 critic audit update v4' }));
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

test('RPP-0966 evidence records no release-gate status movement or protected file movement', () => {
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

  assert.ok(match?.groups?.json, 'RPP-0966 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
