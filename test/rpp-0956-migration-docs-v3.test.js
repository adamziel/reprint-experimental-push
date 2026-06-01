import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0956-migration-docs-v3.md');

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='migration\\|migrate\\|schema' -30",
  "git log --oneline --all --grep='RPP-0601\\|RPP-0621\\|RPP-0641\\|RPP-0661\\|RPP-0681\\|RPP-0916\\|RPP-0936' -30",
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0956-migration-docs-v3.test.js',
  'node --test --test-name-pattern RPP-0956 test/rpp-0956-migration-docs-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0956-migration-docs-v3.md',
  'git diff --check',
]);

const expectedCommitSubjects = Object.freeze({
  '30579db75': 'Merge published progress page state',
  '39c1156f1': 'docs: publish progress page',
  f6061df19: 'docs: refresh progress for RPP-0953 integration',
  '5b0b14345': "Merge branch 'session/rpp-953' into lane/evidence-integration-20260527",
  fc86ab19d: 'docs: refresh progress for RPP-0952 integration',
  '94e3a1c05': 'docs: refresh progress for RPP-0951 integration',
  '8da4ba80a': 'docs: refresh progress for RPP-0936 integration',
  dd8f12e92: 'Add RPP-0936 migration docs v2 evidence',
  '003c106bc': 'docs: refresh progress for RPP-0916 integration',
  '89f9bd56d': 'Add RPP-0916 migration docs evidence',
  '5df68c6cc': 'Add RPP-0681 journal schema migration release proof',
  cbc259b3b: 'Add RPP-0661 journal table schema migration proof',
  e5145c196: 'Add RPP-0641 journal schema migration coverage',
  d4c32b440: 'Merge session rpp-244 RPP-0621 journal schema migration proof',
  eb2c86d94: 'Add RPP-0621 journal schema migration proof',
  fcb99733b: 'feat: add SQLite recovery journal migration proof',
  '46656bc4d': 'feat: add recovery journal schema migration proof',
});

const expectedMigrationPrerequisites = Object.freeze([
  'approved-production-storage-boundary',
  'same-release-envelope-source-and-target',
  'source-target-identity-hashes',
  'current-release-envelope-id',
  'migration-command-transcript-with-start-end-times',
  'pre-migration-schema-summary',
  'pre-migration-row-count-digest',
  'strict-pre-migration-readback-or-explicit-fail-closed-result',
  'migration-summary',
  'post-migration-row-count-digest',
  'post-migration-restart-readback',
  'recovery-state-classification',
  'artifact-redaction-scan-result',
  'release-gate-decision-record',
]);

const expectedStopConditions = Object.freeze([
  'production-backed-migration-proof-absent',
  'approved-production-storage-boundary-missing',
  'command-transcript-missing',
  'release-envelope-mismatch',
  'pre-or-post-row-count-missing',
  'strict-readback-missing',
  'post-restart-readback-failed',
  'unknown-recovery-state',
  'raw-or-sensitive-artifact-detected',
  'remote-tunnel-or-unapproved-ingress-required',
  'dashboard-pr-tag-or-release-gate-status-change-required',
]);

test('RPP-0956 evidence records support-only migration docs v3 posture', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0956');
  assert.equal(report.proofId, 'rpp-0956-migration-docs-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'migration-docs-audited');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');

  assert.equal(report.documents.migrationGuide, 'docs/migration/reprint-push-migration.md');
  assert.equal(report.documents.evidence, 'docs/evidence/rpp-0956-migration-docs-v3.md');
  assert.equal(report.documents.patternEvidence, 'docs/evidence/rpp-0936-migration-docs-v2.md');
  assert.equal(report.documents.priorMigrationDocsEvidence, 'docs/evidence/rpp-0916-migration-docs.md');

  assert.equal(report.posture.productionEndpointAdded, false);
  assert.equal(report.posture.productionMigrationAttempted, false);
  assert.equal(report.posture.productionMigrationProofAdded, false);
  assert.equal(report.posture.productionLiveSourceProofAdded, false);
  assert.equal(report.posture.releaseGateStatusMoved, false);
  assert.equal(report.posture.releaseGateStatusMovement, 'none');
  assert.equal(report.posture.progressFilesChanged, false);
  assert.equal(report.posture.completionChecklistChanged, false);
  assert.equal(report.posture.finalReleaseNoGoRetained, true);

  assert.equal(report.migrationDocContract.mode, 'support-only-migration-documentation-audit');
  assert.equal(report.migrationDocContract.documentedMigrationSurface, 'recovery-journal-schema');
  assert.equal(report.migrationDocContract.generalWordPressDataMigrationAuthorized, false);
  assert.equal(report.migrationDocContract.productionMutationAuthorized, false);
  assert.equal(report.migrationDocContract.productionBackedMigrationProofRequiredForRelease, true);
  assert.equal(report.migrationDocContract.releaseMovementAuthorized, false);
  assert.equal(report.migrationDocContract.remoteTunnelRequired, false);
  assert.equal(report.migrationDocContract.dashboardsStarted, false);
});

test('RPP-0956 audit file names migration prerequisites and stop conditions', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.migrationPrerequisites, expectedMigrationPrerequisites);
  assert.deepEqual(report.stopConditions, expectedStopConditions);

  for (const prerequisite of expectedMigrationPrerequisites) {
    assert.ok(text.includes(prerequisite), `${prerequisite} must be written in the audit file`);
  }

  for (const stopCondition of expectedStopConditions) {
    assert.ok(text.includes(stopCondition), `${stopCondition} must be written in the audit file`);
  }
});

test('RPP-0956 audit file links exact commands to existing commit anchors', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(text.includes(command), `${command} must be listed exactly in the audit file`);
  }

  assert.equal(report.relevantCurrentCommits[0].name, 'current-branch-head-before-rpp-0956');
  assert.equal(report.relevantCurrentCommits[0].sha, '30579db75');

  for (const [sha, subject] of Object.entries(expectedCommitSubjects)) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assertGitSubject(sha, subject);
    assert.ok(text.includes(`"sha": "${sha}"`), `${sha} must be included in the audit file`);
    assert.ok(text.includes(`"subject": "${escapeJsonString(subject)}"`), `${subject} must be included in the audit file`);
  }

  const knownCommitRefs = new Set(report.relevantCurrentCommits.map((commit) => commit.sha));
  for (const link of report.commandCommitLinks) {
    assert.ok(expectedAuditCommands.includes(link.command), `${link.command} must be an exact audit command`);
    assert.ok(link.commitRefs.length > 0, `${link.command} must name at least one commit`);
    assert.match(link.purpose, /\S/);

    for (const sha of link.commitRefs) {
      assert.ok(knownCommitRefs.has(sha), `${link.command} must reference known commit ${sha}`);
    }
  }
});

test('RPP-0956 final release blocks movement without production-backed migration proof', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.releaseHold.held, true);
  assert.equal(report.releaseHold.reason, 'production-backed-migration-proof-absent');
  assert.equal(report.releaseHold.productionBackedMigrationProofPresent, false);
  assert.equal(report.releaseHold.blockedReleaseMovement, true);
  assert.equal(report.releaseHold.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseHold.releaseGateStatusMovement, 'none');
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseGateFilesChanged, false);
  assert.equal(report.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.deepEqual(report.evidenceLimits.statusFilesChanged, []);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0956 migration docs v3 evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);

  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
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

  assert.ok(match?.groups?.json, 'RPP-0956 evidence must contain one JSON record block');
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

function escapeJsonString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
