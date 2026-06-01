import assert from 'node:assert/strict';
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
  'docs/evidence/rpp-0986-critic-audit-update-release-verifier-v5.md',
);
const evidenceRelativePath = 'docs/evidence/rpp-0986-critic-audit-update-release-verifier-v5.md';
const baselinePath = path.join(repoRoot, 'docs/evidence/rpp-0966-critic-audit-update-v4.md');
const fixedNowIso = '2026-06-01T10:00:00.000Z';
const auditedHead = '774be41ca40f306ca742db58fe4011aebbe2a22d';
const staleRpp0966Head = '4d3095533ffeac7c4d9434bf9eb4fe7e94bf003d';

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0986-critic-audit-update-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0986 test/rpp-0986-critic-audit-update-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0986-critic-audit-update-release-verifier-v5.md',
  'git diff --check',
]);

const expectedExactCommands = Object.freeze([
  'git rev-parse HEAD',
  'git log --oneline --decorate -16',
  "git log --oneline --all --grep='RPP-0980' -8",
  "git log --oneline --all --grep='RPP-0981' -8",
  "git log --oneline --all --grep='RPP-0966' -8",
  "git log --oneline --all --grep='critic audit' -16",
  "git log --oneline --all --grep='audit' -24",
  "git show -s --format='%H %s' 774be41ca 21d66136e 548a463cb d69a9dced b5dd7c9d7 83b6402c1 9a6b94580 916d88f39 94d855138 29fd81e1f 04385b927 9add88d7c 302f62b60 025d87ec2 b51d6f00b 0da2d08aa 89130d02c b14b96c86 940e23e46 fe3af9d8e",
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T10:00:00.000Z',
  'timeout 300s npm run verify:release',
  ...expectedValidationCommands,
]);

const expectedCommits = Object.freeze([
  ['774be41ca40f306ca742db58fe4011aebbe2a22d', 'Merge published progress page state'],
  ['21d66136ee236b278571ad5b0273a2426c6f63f5', 'docs: publish progress page'],
  ['548a463cb4391abf7433e275abceaa2d53a64c85', 'docs: refresh progress for RPP-0981 integration'],
  ['d69a9dced1f5433d0bb08e666df4814e4f9a773d', "Merge branch 'session/rpp-981' into lane/evidence-integration-20260527"],
  ['b5dd7c9d7755b029b44e6f5e996be4a441ced133', 'Add RPP-0981 release gate 1 verifier v5 evidence'],
  ['83b6402c14ee691676306f92c93c93ae94279260', 'docs: refresh progress for RPP-0980 integration'],
  ['9a6b9458038e6ed9249d878d73ac12a603a6987f', "Merge branch 'session/rpp-980' into lane/evidence-integration-20260527"],
  ['916d88f39a0dd8d88eebadf923ead83a65d61cd7', 'Add RPP-0980 go-no-go release decision v4 evidence'],
  ['94d85513814840651d9e9dd0c994934f1f54461d', 'docs: refresh progress for RPP-0966 integration'],
  ['29fd81e1fef3270877a7b16ba5e2fb6c337ced9b', 'Add RPP-0966 critic audit update v4 evidence'],
  ['04385b92719683423791df37c3a645551b424c14', 'docs: refresh progress for RPP-0967 integration'],
  ['9add88d7ce97416ce1477e2d9bcdf8983627ba4a', 'Add RPP-0967 security review checklist v4 evidence'],
  ['302f62b6086890c40395ed61244dde6162ed0dfa', 'RPP-0965 objective audit update v4'],
  ['025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a', 'Add RPP-0961 release gate 1 final audit v4'],
  ['b51d6f00bf1f530af753a04faf09e79410e8734f', 'Add RPP-0962 release gate 2 audit evidence'],
  ['0da2d08aabfaebfeb38aeaf7c8d613edfcf9002d', 'Add RPP-0963 release gate 3 final audit v4'],
  ['89130d02c43963bea8dd40cbf22a4b67f47d2e5a', 'Add RPP-0964 gate 4 final audit evidence'],
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

test('RPP-0986 evidence records support-only critic-audit release-verifier NO-GO posture', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0986 critic audit update release verifier v5$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 5$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-986`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0966Head));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0986');
  assert.equal(report.proofId, 'rpp-0986-critic-audit-update-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.generatedAt, fixedNowIso);
  assert.equal(report.status, 'critic-audit-release-verifier-carry-through-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0966-critic-audit-update-v4.md');
  assert.equal(report.releaseVerifierVariant, 5);

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-986',
    headBeforeEvidence: auditedHead,
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '21d66136ee236b278571ad5b0273a2426c6f63f5',
    originMainSubject: 'docs: publish progress page',
  });

  assert.deepEqual(report.posture, {
    productionEndpointAdded: false,
    productionMutationAttempted: false,
    productionLiveSourceProofAdded: false,
    releaseVerifierMutationAttempted: false,
    releaseVerifierObservedNoGo: true,
    releaseGateStatusMoved: false,
    progressFilesChanged: false,
    completionChecklistChanged: false,
    releaseGateFilesChanged: false,
    finalReleaseNoGoRetained: true,
  });
});

test('RPP-0986 evidence carries forward the RPP-0966 v4 critic-audit contract', () => {
  const { report, text } = loadEvidenceReport();
  const baselineText = fs.readFileSync(baselinePath, 'utf8');

  assert.deepEqual(report.carriedForwardCriticAuditContract, {
    patternRppId: 'RPP-0966',
    patternProofId: 'rpp-0966-critic-audit-update-v4',
    patternVariant: 4,
    patternRecordPath: 'docs/evidence/rpp-0966-critic-audit-update-v4.md',
    inheritedPatternRecordPath: 'docs/evidence/rpp-0946-critic-audit-update-v3.md',
    requiresExactAuditCommandLinks: true,
    requiresExactValidationCommandLinks: true,
    requiresSupportCommitLinks: true,
    requiresLaneContextCommitLinks: true,
    requiresFinalReleaseNoGo: true,
    requiresNoReleaseGateMovement: true,
    requiresProductionGapsRemainOpen: true,
  });
  assert.match(baselineText, /carries forward the RPP-0946 v3 critic-audit contract/);
  assert.match(baselineText, /The final release verdict remains \*\*NO-GO\*\*/);
  assert.match(text, /carries forward the RPP-0966 v4\s+critic-audit update contract/);
  assert.match(text, /linked support commits, linked lane context\s+commits/);
  assert.match(text, /retains the inherited RPP-0946 v3 critic-audit contract chain/);
});

test('RPP-0986 evidence links exact audit commands, validation commands, and commit anchors', () => {
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
    expectedExactCommands.slice(0, 8),
  );
  assert.deepEqual(report.commandCommitLinks[0].commitRefs, [auditedHead]);
  assert.deepEqual(report.commandCommitLinks[1].commitRefs, [
    '774be41ca',
    '21d66136e',
    '548a463cb',
    'd69a9dced',
    '83b6402c1',
    '9a6b94580',
    'b5dd7c9d7',
  ]);
  assert.deepEqual(report.commandCommitLinks[4].commitRefs, ['94d855138', '29fd81e1f']);
  assert.deepEqual(report.commandCommitLinks[5].commitRefs, [
    '29fd81e1f',
    'b14b96c86',
    '940e23e46',
    'fe3af9d8e',
  ]);
});

test('RPP-0986 evidence records held release-verifier and status-row carry-through', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.statusRowSnapshot, {
    command: 'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
    releaseVerdict: '0/4',
    releaseStatus: 'NO-GO',
    gateStatuses: {
      'GATE-1': 'support_only',
      'GATE-2': 'support_only',
      'GATE-3': 'support_only',
      'GATE-4': 'support_only',
    },
    statusCounts: {
      support_only: 4,
    },
    lastRefreshed: '2026-05-28 02:24 CEST on lane/evidence-integration-20260527',
  });
  assert.deepEqual(report.releaseVerifierCarryThrough, {
    mode: 'support-only-release-verifier',
    command: 'timeout 300s npm run verify:release',
    exitCode: 1,
    statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
    primaryFailureCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    mutationAttempted: false,
    releaseMovementAllowed: false,
    gates: '0/4',
    haltedBeforeMutation: true,
    sourceUrlObserved: 'missing-live-source',
    localEditedObserved: 'missing-local-edited-site',
    remoteChangedObserved: 'missing-remote-changed-source',
  });

  assert.match(text, /release-verifier command stopped fail-closed before mutation/);
  assert.match(text, /`REPRINT_PUSH_LIVE_SOURCE_REQUIRED`/);
  assert.match(text, /\[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false\]/);
  assert.match(text, /`releaseMovement\.allowed: false`/);
  assert.match(text, /`gates: 0\/4`/);
  assert.match(text, /This support-only evidence causes no release-gate status movement\./);
});

test('RPP-0986 evidence names remaining release-blocking gaps and keeps the verdict held', () => {
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
  assert.match(text, /The final release verdict remains \*\*NO-GO\*\*/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);
});

test('RPP-0986 artifacts remain redacted and final release gates remain NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0986 critic audit release verifier v5' }));
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

test('RPP-0986 evidence records no release-gate status movement or protected file movement', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.evidenceLimits, {
    mode: 'critic-audit-release-verifier-support-only',
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

  assert.ok(match?.groups?.json, 'RPP-0986 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
