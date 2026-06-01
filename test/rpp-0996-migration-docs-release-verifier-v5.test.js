import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readAgentsReleaseGatesStatusRow } from '../scripts/release/agents-release-gates-status-row.mjs';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0996-migration-docs-release-verifier-v5.md');
const patternEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0976-migration-docs-v4.md');
const evidenceRelativePath = 'docs/evidence/rpp-0996-migration-docs-release-verifier-v5.md';
const testRelativePath = 'test/rpp-0996-migration-docs-release-verifier-v5.test.js';
const fixedNowIso = '2026-06-01T06:00:00.000Z';
const auditedLaneHead = '7e0c6ce2e32da9c8cac594b7cfebeaf0dd4b9d9b';

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='migration\\|migrate\\|schema' -30",
  "git log --oneline --all --grep='RPP-0976\\|RPP-0956\\|RPP-0936\\|RPP-0916\\|RPP-0681\\|RPP-0661\\|RPP-0641\\|RPP-0621\\|RPP-0601' -40",
  "git log --oneline --all --grep='RPP-0976\\|RPP-0991\\|RPP-0990\\|RPP-0989\\|RPP-0988\\|RPP-0987\\|RPP-0986\\|RPP-0985\\|RPP-0984\\|RPP-0983\\|RPP-0982\\|RPP-0981' -40",
  "git show -s --format='%H%x09%s' 7e0c6ce2e 1b43c11b0 115df467f ccafbc2ff 0183e4a19 00958d891 b54c8be6c f54fe397b 086faeb97 983a81eb4 6257e4dbe 97ced4aea 659801f87 9682d763b ca3440069 dd8f12e92 89f9bd56d 5df68c6cc cbc259b3b e5145c196 d4c32b440 eb2c86d94 fcb99733b 46656bc4d",
]);

const expectedReleaseVerifierCommands = Object.freeze([
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T06:00:00.000Z',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0996-migration-docs-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0996 test/rpp-0996-migration-docs-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0996-migration-docs-release-verifier-v5.md',
  'git diff --check',
]);

const expectedCommits = Object.freeze([
  ['7e0c6ce2e32da9c8cac594b7cfebeaf0dd4b9d9b', '7e0c6ce2e', 'Merge published progress page state'],
  ['1b43c11b0622c2dd31731518a6327857610fc68e', '1b43c11b0', 'docs: publish progress page'],
  ['115df467fe6bf687ec87ce9d200a0f97015e03d1', '115df467f', 'docs: refresh progress for RPP-0991 integration'],
  [
    'ccafbc2ff11829cb489a82239c65169c97e574f1',
    'ccafbc2ff',
    "Merge branch 'session/rpp-991' into lane/evidence-integration-20260527",
  ],
  ['0183e4a192b2e2cbbbfef08aa8669b80863811b8', '0183e4a19', 'Add RPP-0991 rollback repair verifier v5 evidence'],
  ['00958d8910ad0a9d265eed3cecc1d59ff42c2ff1', '00958d891', 'docs: refresh progress for RPP-0990 integration'],
  [
    'b54c8be6c8fb036e497331d442c4f7990f58da85',
    'b54c8be6c',
    "Merge branch 'session/rpp-990' into lane/evidence-integration-20260527",
  ],
  ['f54fe397be1bfd5f4278c719210fe328768da8be', 'f54fe397b', 'Add RPP-0990 failure triage verifier v5 evidence'],
  ['086faeb97fca1d15e35ab4521461b10843976854', '086faeb97', 'Add RPP-0989 operator runbook verifier v5 evidence'],
  ['983a81eb472454f0a0d2425175a0222399d3eeef', '983a81eb4', 'Add RPP-0988 privacy redaction verifier v5 evidence'],
  ['6257e4dbe42da1ccb4134c560b6266b921464c69', '6257e4dbe', 'Add RPP-0987 security checklist verifier v5 evidence'],
  ['97ced4aeaf5b80afd40dbbdc3887a0eb3d5deedb', '97ced4aea', 'Add RPP-0986 critic audit verifier v5 evidence'],
  ['659801f8749627ab283cd6474ae493bcf45258a1', '659801f87', 'docs: refresh progress for RPP-0976 integration'],
  ['9682d763be7fb0157deebff36c177bcaf37b5e21', '9682d763b', 'Add RPP-0976 migration docs v4 evidence'],
  ['ca34400698c2b4a2a98bc4111ead5c515db5b727', 'ca3440069', 'Add RPP-0956 migration docs v3 evidence'],
  ['dd8f12e92edcd17881e4455599fae72b71bd1ccc', 'dd8f12e92', 'Add RPP-0936 migration docs v2 evidence'],
  ['89f9bd56d4684b54753b8c5be4c06c9c371dad88', '89f9bd56d', 'Add RPP-0916 migration docs evidence'],
  ['5df68c6cc9517ffb6660d8c536e6a1d42bc52ab1', '5df68c6cc', 'Add RPP-0681 journal schema migration release proof'],
  ['cbc259b3b3c1e13c23bba714912f9a0a5c6f6dd0', 'cbc259b3b', 'Add RPP-0661 journal table schema migration proof'],
  ['e5145c196dd5c49907f67f5c1c4b0a6ba321f8a5', 'e5145c196', 'Add RPP-0641 journal schema migration coverage'],
  ['d4c32b44098268f31324be8097321e5e7bf230e6', 'd4c32b440', 'Merge session rpp-244 RPP-0621 journal schema migration proof'],
  ['eb2c86d941c6cbcc80796eef08bbe88c48094886', 'eb2c86d94', 'Add RPP-0621 journal schema migration proof'],
  ['fcb99733bc2bd1f01ec982bf2214d86cd3f837d9', 'fcb99733b', 'feat: add SQLite recovery journal migration proof'],
  ['46656bc4d27e3b571ec91279f950acd85858fd01', '46656bc4d', 'feat: add recovery journal schema migration proof'],
]);

test('RPP-0996 evidence records support-only migration docs release verifier v5 posture', () => {
  const { report, text } = loadEvidenceReport();

  assert.match(text, /^# RPP-0996 migration docs release verifier v5 evidence$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Slice: RPP-0996$/m);
  assert.match(text, /^Variant: 5$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-996`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0996');
  assert.equal(report.sliceId, 'RPP-0996');
  assert.equal(report.proofId, 'rpp-0996-migration-docs-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.generatedAt, fixedNowIso);
  assert.equal(report.status, 'migration-docs-release-verifier-v5-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseVerifier, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditRecordPath, evidenceRelativePath);
  assert.equal(report.patternRecordPath, 'docs/evidence/rpp-0976-migration-docs-v4.md');

  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-996',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '7e0c6ce2e',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '1b43c11b0622c2dd31731518a6327857610fc68e',
    originMainShortSha: '1b43c11b0',
    originMainSubject: 'docs: publish progress page',
  });

  assert.deepEqual(report.writeScope.allowedFiles, [evidenceRelativePath, testRelativePath]);
  assert.equal(report.writeScope.releaseGateStatusMovement, false);
  assert.deepEqual(report.writeScope.prohibitedFiles, [
    'checklist',
    'progress log',
    'progress.html',
    'package metadata',
    'shared harness code',
    'release gate status files',
    'dashboard state',
    'tags',
  ]);
});

test('RPP-0996 carries forward the RPP-0976 v4 migration docs contract', () => {
  const { report, text } = loadEvidenceReport();
  const { report: pattern } = loadEvidenceReport(patternEvidencePath);

  assert.deepEqual(report.carriedForwardMigrationDocsContract, {
    patternRppId: 'RPP-0976',
    patternProofId: 'rpp-0976-migration-docs-v4',
    patternVariant: 4,
    patternRecordPath: 'docs/evidence/rpp-0976-migration-docs-v4.md',
    requiresExactAuditCommandLinks: true,
    requiresExactReleaseVerifierCommandLinks: true,
    requiresExactValidationCommandLinks: true,
    requiresCommitAnchors: true,
    requiresMigrationPrerequisites: true,
    requiresProductionBackedMigrationProofBeforeReleaseMovement: true,
    requiresFinalReleaseNoGo: true,
    requiresNoReleaseGateMovement: true,
    carriedForwardFields: [
      'migrationDocContract',
      'migrationPrerequisites',
      'requiredProductionBackedMigrationProof',
      'openProductionProofGaps',
      'stopConditions',
      'releaseHold',
      'evidenceLimits',
    ],
    rule: 'Carry forward the RPP-0976 v4 migration documentation contract unchanged unless production-backed migration proof exists; no such proof is present in this release-verifier support-only slice.',
  });

  assert.deepEqual(report.migrationDocContract, pattern.migrationDocContract);
  assert.deepEqual(report.migrationPrerequisites, pattern.migrationPrerequisites);
  assert.deepEqual(report.requiredProductionBackedMigrationProof, pattern.requiredProductionBackedMigrationProof);
  assert.deepEqual(report.openProductionProofGaps, pattern.openProductionProofGaps);
  assert.deepEqual(report.stopConditions, pattern.stopConditions);
  assert.deepEqual(report.releaseHold, pattern.releaseHold);
  assert.match(text, /carries forward the RPP-0976 v4 migration docs contract/);
  assert.match(text, /production-backed migration proof is required before release movement/);
});

test('RPP-0996 release verifier carry-through stays support-only and fail-closed', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.releaseVerifierCarryThrough, {
    variant: 5,
    scope: 'support-only-release-verifier-carry-through',
    contractSourceRppId: 'RPP-0976',
    contractSourceProofId: 'rpp-0976-migration-docs-v4',
    contractSourceRecordPath: 'docs/evidence/rpp-0976-migration-docs-v4.md',
    supportOnlyValidationRecorded: true,
    laneContextAnchorsRecorded: true,
    auditCommandsLinkedToCommits: true,
    releaseVerifierCommandsRecorded: true,
    releaseVerifierCommandsLinkedToCommits: true,
    validationCommandsLinkedToCommits: true,
    productionBackedMigrationProofAdded: false,
    productionLiveSourceProofAdded: false,
    productionDurabilityProofAdded: false,
    releaseGateMovementClaimed: false,
    finalReleaseStatus: 'NO-GO',
  });

  assert.deepEqual(report.releaseVerifierRequiredEvidence, [
    'support-only-validation-output',
    'lane-context-commit-anchors',
    'exact-audit-command-links',
    'exact-release-verifier-command-links',
    'exact-validation-command-links',
    'open-production-backed-migration-proof-gaps',
    'final-no-go-release-posture',
  ]);
  assert.deepEqual(
    report.unresolvedProductionBackedProofGaps.map((gap) => gap.id),
    report.requiredProductionBackedMigrationProof,
  );
  for (const gap of report.unresolvedProductionBackedProofGaps) {
    assert.equal(gap.status, 'open');
    assert.equal(gap.releaseBlocking, true);
    assert.equal(gap.failClosedAction, 'hold-final-release-no-go');
  }

  assert.match(text, /Unresolved production-backed migration proof gaps remain open and fail closed/);
  assert.match(text, /final release verdict remains \*\*NO-GO\*\*/);
  assert.match(text, /Integration recommendation: \*\*NO-GO\*\*/);
});

test('RPP-0996 audit file links exact audit, release-verifier, and validation commands to commit anchors', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.releaseVerifierCommands, expectedReleaseVerifierCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [
    ...expectedAuditCommands,
    ...expectedReleaseVerifierCommands,
    ...expectedValidationCommands,
  ]) {
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
    report.releaseVerifierCommandCommitLinks.map((entry) => entry.command),
    expectedReleaseVerifierCommands,
  );
  assert.deepEqual(
    report.validationCommandCommitLinks.map((entry) => entry.command),
    expectedValidationCommands,
  );

  const knownShortRefs = new Set(report.relevantCurrentCommits.map((commit) => commit.shortSha));
  for (const link of [
    ...report.commandCommitLinks,
    ...report.releaseVerifierCommandCommitLinks,
    ...report.validationCommandCommitLinks,
  ]) {
    assert.ok(link.commitRefs.length > 0, `${link.command} must name at least one commit`);
    assert.match(link.purpose, /\S/);
    for (const commitRef of link.commitRefs) {
      assert.ok(knownShortRefs.has(commitRef), `${link.command} must reference known commit ${commitRef}`);
    }
  }

  const focusedTestLink = report.validationCommandCommitLinks.find(
    (entry) => entry.command === expectedValidationCommands[1],
  );
  assert.ok(focusedTestLink.commitRefs.includes('9682d763b'));
  assert.ok(focusedTestLink.commitRefs.includes('0183e4a19'));
  assert.ok(focusedTestLink.purpose.includes('release-verifier carry-through'));
});

test('RPP-0996 release verifier commands preserve final NO-GO without release movement', () => {
  const { report } = loadEvidenceReport();
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const statusRow = readAgentsReleaseGatesStatusRow({ rootDir: repoRoot });

  assert.equal(report.releaseGateSnapshot.command, expectedReleaseVerifierCommands[0]);
  assert.equal(report.releaseGateSnapshot.expectedExit, 1);
  assert.equal(report.releaseGateSnapshot.exitCode, 1);
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

  assert.equal(statusRow.ok, true);
  assert.equal(report.statusRowReadback.command, expectedReleaseVerifierCommands[1]);
  assert.equal(statusRow.evidence.releaseVerdict, '0/4');
  assert.equal(statusRow.evidence.releaseStatus, 'NO-GO');
  assert.deepEqual(
    statusRow.evidence.gateStatuses.map((entry) => entry.status),
    report.statusRowReadback.gateStatuses,
  );
  assert.deepEqual(report.statusRowReadback.statusCounts, { support_only: 4 });
});

test('RPP-0996 evidence is redacted and records no release-gate, progress, or checklist movement', async () => {
  const { report, text } = loadEvidenceReport();
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });

  assert.deepEqual(report.posture, {
    productionEndpointAdded: false,
    productionMigrationAttempted: false,
    productionMutationAttempted: false,
    productionMigrationProofAdded: false,
    productionLiveSourceProofAdded: false,
    productionDurabilityProofAdded: false,
    releaseVerifierSnapshotRecorded: true,
    releaseGateStatusMoved: false,
    releaseGateStatusMovement: 'none',
    releaseGateFilesChanged: false,
    progressFilesChanged: false,
    completionChecklistChanged: false,
    finalReleaseNoGoRetained: true,
  });

  assert.equal(report.releaseHold.held, true);
  assert.equal(report.releaseHold.reason, 'production-backed-migration-proof-absent');
  assert.equal(report.releaseHold.productionBackedMigrationProofPresent, false);
  assert.equal(report.releaseHold.blockedReleaseMovement, true);
  assert.equal(report.releaseHold.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseHold.releaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.mode, 'migration-docs-release-verifier-support-only-v5');
  assert.equal(report.evidenceLimits.rawPayloadsStored, false);
  assert.equal(report.evidenceLimits.credentialsStored, false);
  assert.equal(report.evidenceLimits.privatePathArtifactsStored, false);
  assert.equal(report.evidenceLimits.privateUrlArtifactsStored, false);
  assert.equal(report.evidenceLimits.remoteTunnelInstructionsStored, false);
  assert.equal(report.evidenceLimits.remoteTunnelsUsed, false);
  assert.equal(report.evidenceLimits.liveServiceConfigurationStored, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseGateFilesChanged, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMoved, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.progressPageChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
  assert.equal(report.evidenceLimits.packageMetadataChanged, false);
  assert.equal(report.evidenceLimits.sharedHarnessCodeChanged, false);
  assert.equal(report.evidenceLimits.productionBackedProofGapsOpen, true);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0996 migration docs release verifier v5 evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
});

function loadEvidenceReport(filePath = evidencePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON record block`);
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
