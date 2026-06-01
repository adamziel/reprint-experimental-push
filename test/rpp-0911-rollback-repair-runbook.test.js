import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = path.join(repoRoot, 'docs/operations/rollback-repair-runbook.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0911-rollback-repair-runbook.md');

const expectedStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const expectedAuditCommands = Object.freeze([
  "git show -s --format='%h%x09%H%x09%s' HEAD",
  'git log --oneline --decorate -12',
  "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
  "git log --oneline --all --grep='RPP-0904\\|RPP-0905\\|RPP-0906' -12",
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0911-rollback-repair-runbook.test.js',
  'node --test --test-name-pattern RPP-0911 test/rpp-0911-rollback-repair-runbook.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/operations/rollback-repair-runbook.md docs/evidence/rpp-0911-rollback-repair-runbook.md',
  'git diff --check',
]);

const expectedCommitSubjects = Object.freeze({
  c4faf5245: 'Merge published progress page state',
  '404506c5e': 'docs: publish progress page',
  fe3af9d8e: 'Add RPP-0906 critic audit disposition',
  '54f6b6b3c': 'Add RPP-0904 operator safe recovery docs',
  '12f684cd3': 'Add RPP-0690 old-remote recovery release proof',
  bced8d1ae: 'Add RPP-0691 new-remote recovery release proof',
  '3b0d2c873': 'Add RPP-0692 blocked recovery release proof',
  d3c23e7e6: 'Add RPP-0693 unknown-drift recovery release proof',
  e627a9717: 'Add RPP-0700 manual recovery audit export release proof',
});

test('RPP-0911 runbook defines support-only rollback and repair controls', () => {
  const runbook = readText(runbookPath);

  assert.match(runbook, /^# Rollback and Repair Runbook/m);
  assert.match(runbook, /Variant: RPP-0911 rollback\/repair runbook variant 1/);
  assert.match(runbook, /\[Apply Journal Recovery States\]\(\.\.\/recovery\/apply-journal\.md\)/);
  assert.match(runbook, /\[Acceptable Post-Failure States\]\(\.\.\/recovery\/acceptable-states\.md\)/);
  assert.match(runbook, /\[RPP-0911 rollback repair runbook evidence\]\(\.\.\/evidence\/rpp-0911-rollback-repair-runbook\.md\)/);

  for (const state of expectedStates) {
    assert.ok(runbook.includes(`\`${state}\``), `runbook must name ${state}`);
  }

  assert.match(runbook, /Automatic rollback is not authorized/);
  assert.match(runbook, /hash-only support artifacts/);
  assert.match(runbook, /Do not hand-edit production rows, files, options, plugin data, or content/);
  assert.match(runbook, /Repair means roll-forward reconciliation/);
  assert.match(runbook, /Drift outside the\s+before\/after envelope always blocks automated repair/);
  assert.match(runbook, /Final release remains `NO-GO`/);
});

test('RPP-0911 evidence records final NO-GO support-only posture', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0911');
  assert.equal(report.proofId, 'rpp-0911-rollback-repair-runbook-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'rollback-repair-runbook-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.documents.runbook, 'docs/operations/rollback-repair-runbook.md');

  assert.deepEqual(report.runbookContract.acceptableStates, expectedStates);
  assert.equal(report.runbookContract.unknownStateAction, 'blocked-recovery');
  assert.equal(report.runbookContract.missingEvidenceAction, 'blocked-recovery');
  assert.equal(report.runbookContract.driftOutsideEnvelopeAction, 'blocked-recovery');
  assert.equal(report.runbookContract.manualWriteRepairAuthorized, false);
  assert.equal(report.runbookContract.automaticRollbackAuthorized, false);
  assert.equal(report.runbookContract.releaseMovementAuthorized, false);

  assert.equal(report.rollbackPolicy.decision, 'not-authorized-by-current-artifacts');
  assert.equal(report.rollbackPolicy.rawBeforeValuesAvailable, false);
  assert.equal(report.repairPolicy.decision, 'support-only-roll-forward-review');
  assert.equal(report.repairPolicy.manualPatchAction, 'forbidden');
  assert.equal(report.posture.releaseGateStatusMoved, false);
  assert.equal(report.posture.progressFilesChanged, false);
  assert.equal(report.posture.completionChecklistChanged, false);
  assert.equal(report.posture.finalReleaseNoGoRetained, true);
});

test('RPP-0911 audit file links exact commands to existing commits', () => {
  const { report } = loadEvidenceReport();
  const runbook = readText(runbookPath);

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(runbook.includes(command), `${command} must be listed exactly in the runbook`);
  }

  for (const [sha, subject] of Object.entries(expectedCommitSubjects)) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assertGitSubject(sha, subject);
    assert.ok(runbook.includes(`| \`${sha}\` | ${subject} |`), `${sha} must be linked in the runbook`);
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

test('RPP-0911 docs remain redacted and final release stays NO-GO', () => {
  const { report, text } = loadEvidenceReport();
  const runbook = readText(runbookPath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0911 rollback repair runbook evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(runbook.includes('http://'), false);
  assert.equal(runbook.includes('https://'), false);

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

  assert.ok(match?.groups?.json, 'RPP-0911 evidence must contain one JSON record block');
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
