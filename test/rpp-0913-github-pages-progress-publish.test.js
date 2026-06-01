import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { summarizeRequiredReleaseChecks } from '../src/required-release-checks.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'fixtures/protocol/push-required-release-checks-contract.json');
const requiredChecksScript = path.join(repoRoot, 'scripts/release/required-release-checks-report.mjs');
const releaseDocPath = path.join(repoRoot, 'docs/release/github-pages-progress-publish.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0913-github-pages-progress-publish.md');
const fixedNow = '2026-05-28T08:30:00.000Z';
const publishCheckId = 'github-pages-progress-publish-proof';
const publishCommand = 'npm run publish:progress-page:dry-run';
const requiredPublishArtifacts = [
  'scripts/release/publish-progress-page.mjs',
  'progress.html',
  'docs/evidence/ao-progress-report.md',
  'docs/release/github-pages-progress-publish.md',
  'docs/evidence/rpp-0913-github-pages-progress-publish.md',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0913 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function publishRequiredCheck() {
  const { report } = loadEvidenceReport();

  return {
    id: report.requiredProof.checkId,
    title: report.requiredProof.title,
    area: report.requiredProof.area,
    ownerScope: report.requiredProof.ownerScope,
    severity: report.requiredProof.severity,
    productionRequired: report.requiredProof.productionRequired,
    command: report.requiredProof.command,
    artifacts: [...report.requiredProof.requiredArtifacts],
    staleAfterMs: report.requiredProof.freshnessWindowMs,
  };
}

function passedPublishObservation() {
  return {
    status: 'passed',
    command: publishCommand,
    artifacts: [...requiredPublishArtifacts],
    observedAt: '2026-05-28T08:00:00.000Z',
  };
}

function summarizeWithPublishObservation(updateObservations) {
  const fixture = loadFixture();
  const observations = clone(fixture.observations);
  observations[publishCheckId] = passedPublishObservation();
  updateObservations(observations);

  return summarizeRequiredReleaseChecks({
    checks: [...clone(fixture.checks), publishRequiredCheck()],
    observations,
    now: fixture.evaluation.now,
  });
}

function publishProblem(summary) {
  return [...summary.missingChecks, ...summary.staleChecks]
    .find((problem) => problem.id === publishCheckId);
}

function writeFixture(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-913-progress-publish-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'required-checks-fixture.json');
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

test('RPP-0913 release note keeps GitHub Pages publish proof required and support-only', () => {
  const releaseDoc = fs.readFileSync(releaseDocPath, 'utf8');
  const { text, report } = loadEvidenceReport();

  assert.match(releaseDoc, /^# GitHub Pages Progress Publish$/m);
  assert.match(releaseDoc, /^Slice: RPP-0913$/m);
  assert.match(releaseDoc, /^Release recommendation: NO-GO$/m);
  assert.match(releaseDoc, /The GitHub Pages progress publish workflow must stay a blocking required proof/);
  assert.match(releaseDoc, /A missing, failed, stale, command-mismatched,\s+or artifact-incomplete observation/);
  assert.match(releaseDoc, /Integration recommendation: keep final release `NO-GO`/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0913');
  assert.equal(report.workerId, 'rpp-913');
  assert.equal(report.variant, 1);
  assert.equal(report.evidenceMode, 'support-only-required-check-fixture');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateStatusMovement, 'none');
  assert.equal(report.requiredProof.checkId, publishCheckId);
  assert.equal(report.requiredProof.severity, 'blocking');
  assert.equal(report.requiredProof.productionRequired, true);
  assert.equal(report.requiredProof.command, publishCommand);
  assert.deepEqual(report.requiredProof.requiredArtifacts, requiredPublishArtifacts);
  assert.equal(report.releaseReadinessPolicy.publishEvidenceRequired, true);
  assert.equal(report.releaseReadinessPolicy.releaseReadyRequiresFreshPassedPublishEvidence, true);
  assert.equal(report.releaseReadinessPolicy.failedPublishEvidenceBlocksRelease, true);
  assert.equal(report.evidenceLimits.publishCommandExecuted, false);
  assert.equal(report.evidenceLimits.remotePushAttempted, false);
  assert.doesNotMatch(`${releaseDoc}\n${text}`, /\bhttps?:\/\//i);
});

test('RPP-0913 required GitHub Pages publish proof failures hold release readiness', () => {
  const cases = [
    {
      name: 'missing observation',
      code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
      bucket: 'missingChecks',
      mutate(observations) {
        delete observations[publishCheckId];
      },
    },
    {
      name: 'failed observation',
      code: 'REQUIRED_RELEASE_CHECK_FAILED',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[publishCheckId].status = 'failed';
        observations[publishCheckId].publishResultHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
      },
    },
    {
      name: 'command mismatch',
      code: 'REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[publishCheckId].command = 'npm run publish:progress-page';
      },
    },
    {
      name: 'missing artifact observation',
      code: 'REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[publishCheckId].artifacts = observations[publishCheckId].artifacts
          .filter((artifact) => artifact !== 'progress.html');
      },
    },
    {
      name: 'stale observation',
      code: 'REQUIRED_RELEASE_CHECK_STALE',
      bucket: 'staleChecks',
      mutate(observations) {
        observations[publishCheckId].observedAt = '2026-05-27T01:59:59.000Z';
      },
    },
  ];

  for (const fixtureCase of cases) {
    const summary = summarizeWithPublishObservation(fixtureCase.mutate);
    const problem = publishProblem(summary);

    assert.equal(summary.ok, false, fixtureCase.name);
    assert.equal(summary.releaseReady, false, fixtureCase.name);
    assert.equal(summary.requiredCount, 11, fixtureCase.name);
    assert.equal(summary.passedCount, 10, fixtureCase.name);
    assert.ok(problem, fixtureCase.name);
    assert.equal(problem.code, fixtureCase.code, fixtureCase.name);
    assert.equal(summary[fixtureCase.bucket].some((entry) => entry.id === publishCheckId), true, fixtureCase.name);
  }
});

test('RPP-0913 required release checks CLI exits nonzero on failed publish proof', (t) => {
  const fixture = loadFixture();
  fixture.checks = [...fixture.checks, publishRequiredCheck()];
  fixture.observations[publishCheckId] = {
    ...passedPublishObservation(),
    status: 'failed',
    publishResultHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  };
  const fixtureFile = writeFixture(t, fixture);
  const result = spawnSync(process.execPath, [
    requiredChecksScript,
    '--fixture',
    fixtureFile,
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(report.command, 'required-release-checks-report');
  assert.equal(report.releaseReady, false);
  assert.equal(report.releaseStatus, 'held');
  assert.equal(report.requiredCount, 11);
  assert.equal(report.passedCount, 10);
  assert.equal(report.missingCount, 1);
  assert.equal(report.staleCount, 0);
  assert.deepEqual(report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
    [publishCheckId, 'REQUIRED_RELEASE_CHECK_FAILED'],
  ]);
  assert.equal(report.checks.find((check) => check.id === publishCheckId).observation.status, 'failed');
});

test('RPP-0913 support docs remain redacted and release-gate neutral', async () => {
  const scan = await scanArtifacts([
    'docs/release/github-pages-progress-publish.md',
    'docs/evidence/rpp-0913-github-pages-progress-publish.md',
  ], { cwd: repoRoot });
  const combinedText = [
    fs.readFileSync(releaseDocPath, 'utf8'),
    fs.readFileSync(evidencePath, 'utf8'),
  ].join('\n');

  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(scan.scannedFiles, [
    'docs/evidence/rpp-0913-github-pages-progress-publish.md',
    'docs/release/github-pages-progress-publish.md',
  ]);
  assert.doesNotMatch(combinedText, /\bhttps?:\/\//i);
  assert.doesNotMatch(combinedText, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
  assert.match(combinedText, /does not move release-gate status/);
  assert.match(combinedText, /keeps final release `NO-GO`/);
});
