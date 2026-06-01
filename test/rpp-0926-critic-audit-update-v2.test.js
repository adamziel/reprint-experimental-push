import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0926-critic-audit-update-v2.md');
const evidenceRelativePath = 'docs/evidence/rpp-0926-critic-audit-update-v2.md';
const fixedNowIso = '2026-06-01T02:20:00.000Z';
const auditedHead = '6cf89e18661ca4241dea2dc07472110e36161c7b';
const staleRpp0906Head = '609f52cd9';

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0926-critic-audit-update-v2.test.js',
  'node --test --test-name-pattern RPP-0926 test/rpp-0926-critic-audit-update-v2.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0926-critic-audit-update-v2.md',
  'git diff --check',
]);

const expectedExactCommands = Object.freeze([
  'git rev-parse HEAD',
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='RPP-0921' -8",
  "git log --oneline --all --grep='RPP-0920' -8",
  "git log --oneline --all --grep='audit' -12",
  "git show -s --format='%H %s' 6cf89e186 09f6e6c3a 9d0a63b8e 50b30c619 a3d55cd6d 809926c1e 3fd76ca37 adb750be8 f83ce7f0f b86d41498 fe3af9d8e",
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:20:00.000Z',
  ...expectedValidationCommands,
]);

const expectedCommits = Object.freeze([
  ['6cf89e18661ca4241dea2dc07472110e36161c7b', 'Merge published progress page state'],
  ['09f6e6c3aa110b795eb6768cae693a84e36225b9', 'docs: publish progress page'],
  ['9d0a63b8eecc7cd1adf8b926000f19243365356e', 'docs: refresh progress for RPP-0921 integration'],
  ['50b30c6197b283e84e68f73a35a204429703da4a', "Merge branch 'session/rpp-921' into lane/evidence-integration-20260527"],
  ['a3d55cd6d201e430e84dff3dfbd5e6ba4d93f0c4', 'docs: refresh progress for RPP-0920 integration'],
  ['809926c1e3855941281dd02e1b9fd4d7da5ef153', 'Add RPP-0920 go/no-go decision record'],
  ['3fd76ca37e7a314e3d5fe8d65179c105190c4dda', 'Add RPP-0921 gate 1 final audit v2 evidence'],
  ['b86d414986c9ff026e87986e54177a83be6e5028', 'Add RPP-0922 gate 2 support audit v2'],
  ['adb750be8a1d7c9992ab126796f7c1bf710c779c', 'Add RPP-0923 gate 3 final audit v2 evidence'],
  ['f83ce7f0fb33af1ef90ee95a4cf10c63b131ea5c', 'Add RPP-0924 gate 4 final audit evidence'],
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

test('RPP-0926 evidence records support-only critic-audit NO-GO posture on the updated lane head', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0926 critic audit update v2$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Variant: 2$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-926`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0906Head));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0926');
  assert.equal(report.proofId, 'rpp-0926-critic-audit-update-v2');
  assert.equal(report.variant, 2);
  assert.equal(report.status, 'critic-audit-risk-disposition-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0906-critic-audit-update.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-926',
    headBeforeEvidence: auditedHead,
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '09f6e6c3aa110b795eb6768cae693a84e36225b9',
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

test('RPP-0926 evidence links exact commands to commit anchors', () => {
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
    expectedExactCommands.slice(0, 6),
  );
  assert.deepEqual(report.commandCommitLinks[0].commitRefs, [auditedHead]);
  assert.deepEqual(report.commandCommitLinks[1].commitRefs, [
    '6cf89e186',
    '09f6e6c3a',
    '9d0a63b8e',
    '50b30c619',
    'a3d55cd6d',
    '809926c1e',
  ]);
  assert.deepEqual(report.commandCommitLinks[4].commitRefs, [
    'adb750be8',
    'f83ce7f0f',
    'b86d41498',
    '3fd76ca37',
    'fe3af9d8e',
  ]);
});

test('RPP-0926 evidence names remaining release-blocking gaps and keeps the verdict held', () => {
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

test('RPP-0926 artifacts remain redacted and final release gates remain NO-GO', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0926 critic audit update v2' }));
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

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0926 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
