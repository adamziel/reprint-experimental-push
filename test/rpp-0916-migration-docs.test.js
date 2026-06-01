import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationGuidePath = path.join(repoRoot, 'docs/migration/reprint-push-migration.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0916-migration-docs.md');

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='migration\\|migrate\\|schema' -30",
  "git log --oneline --all --grep='RPP-0601\\|RPP-0621\\|RPP-0641\\|RPP-0661\\|RPP-0681' -20",
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0916-migration-docs.test.js',
  'node --test --test-name-pattern RPP-0916 test/rpp-0916-migration-docs.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/migration/reprint-push-migration.md docs/evidence/rpp-0916-migration-docs.md',
  'git diff --check',
]);

const expectedCommitSubjects = Object.freeze({
  e73be8def: 'Merge published progress page state',
  '525258ec1': 'docs: publish progress page',
  '15924c879': 'docs: refresh progress for RPP-0911 integration',
  '173a16387': "Merge branch 'session/rpp-911' into lane/evidence-integration-20260527",
  '5df68c6cc': 'Add RPP-0681 journal schema migration release proof',
  cbc259b3b: 'Add RPP-0661 journal table schema migration proof',
  e5145c196: 'Add RPP-0641 journal schema migration coverage',
  eb2c86d94: 'Add RPP-0621 journal schema migration proof',
  fcb99733b: 'feat: add SQLite recovery journal migration proof',
  '46656bc4d': 'feat: add recovery journal schema migration proof',
});

const requiredProductionProof = Object.freeze([
  'source-target-identity-hashes',
  'current-release-envelope-id',
  'migration-command-transcript',
  'pre-migration-schema-summary',
  'pre-migration-row-count-digest',
  'strict-pre-migration-readback-or-fail-closed-result',
  'migration-summary',
  'post-migration-row-count-digest',
  'post-migration-restart-readback',
  'recovery-state-classification',
  'artifact-redaction-scan-result',
  'release-gate-decision-record',
]);

test('RPP-0916 migration guide defines support-only migration controls', () => {
  const guide = readText(migrationGuidePath);

  assert.match(guide, /^# Reprint Push Migration Support Guide/m);
  assert.match(guide, /Variant: RPP-0916 migration docs variant 1/);
  assert.match(guide, /\[RPP-0916 migration docs evidence\]\(\.\.\/evidence\/rpp-0916-migration-docs\.md\)/);
  assert.match(guide, /Current status: `NO-GO`/);
  assert.match(guide, /support-only and evidence-indexing only/);
  assert.match(guide, /Sandbox SQLite and file-backed proofs[\s\S]*are not production-backed migration proof/);
  assert.match(guide, /Final release remains `NO-GO`/);
  assert.match(guide, /production-backed migration proof is absent/);
  assert.match(guide, /remote tunnel, non-approved ingress path, dashboard, tag, pull request, or\s+release-gate status change/);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(guide.includes(command), `${command} must be listed exactly in the guide`);
  }
});

test('RPP-0916 evidence records final NO-GO support-only migration posture', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0916');
  assert.equal(report.proofId, 'rpp-0916-migration-docs-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'migration-docs-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.documents.migrationGuide, 'docs/migration/reprint-push-migration.md');

  assert.equal(report.posture.productionEndpointAdded, false);
  assert.equal(report.posture.productionMigrationAttempted, false);
  assert.equal(report.posture.productionMigrationProofAdded, false);
  assert.equal(report.posture.releaseGateStatusMoved, false);
  assert.equal(report.posture.progressFilesChanged, false);
  assert.equal(report.posture.completionChecklistChanged, false);
  assert.equal(report.posture.finalReleaseNoGoRetained, true);

  assert.equal(report.migrationDocContract.mode, 'support-only-migration-documentation');
  assert.equal(report.migrationDocContract.documentedMigrationSurface, 'recovery-journal-schema');
  assert.equal(report.migrationDocContract.generalWordPressDataMigrationAuthorized, false);
  assert.equal(report.migrationDocContract.productionMutationAuthorized, false);
  assert.equal(report.migrationDocContract.productionBackedMigrationProofRequiredForRelease, true);
  assert.equal(report.migrationDocContract.releaseMovementAuthorized, false);
  assert.equal(report.migrationDocContract.remoteTunnelRequired, false);

  assert.deepEqual(report.requiredProductionBackedMigrationProof, requiredProductionProof);
  assert.ok(report.stopConditions.includes('production-backed-migration-proof-absent'));
  assert.ok(report.stopConditions.includes('release-gate-status-change-required'));
});

test('RPP-0916 audit file links exact commands to existing commits', () => {
  const { report } = loadEvidenceReport();
  const guide = readText(migrationGuidePath);

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(guide.includes(command), `${command} must be listed exactly in the migration guide`);
  }

  for (const [sha, subject] of Object.entries(expectedCommitSubjects)) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assertGitSubject(sha, subject);
    assert.ok(guide.includes(`| \`${sha}\` | ${subject} |`), `${sha} must be linked in the guide`);
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

test('RPP-0916 docs remain redacted and final release stays NO-GO', () => {
  const { report, text } = loadEvidenceReport();
  const guide = readText(migrationGuidePath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0916 migration docs evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(guide.includes('http://'), false);
  assert.equal(guide.includes('https://'), false);

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

  assert.ok(match?.groups?.json, 'RPP-0916 evidence must contain one JSON record block');
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
