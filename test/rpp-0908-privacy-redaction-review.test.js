import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import {
  REQUIRED_RELEASE_CHECKS,
  summarizeRequiredReleaseChecks,
} from '../src/required-release-checks.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'fixtures/protocol/push-required-release-checks-contract.json');
const requiredChecksScript = path.join(repoRoot, 'scripts/release/required-release-checks-report.mjs');
const reviewDocPath = path.join(repoRoot, 'docs/security/privacy-redaction-review.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0908-privacy-redaction-review.md');
const fixedNow = '2026-05-28T08:30:00.000Z';
const redactionCheckId = 'artifact-redaction-proof';
const redactionCommand = 'node --test test/evidence-redaction.test.js';
const requiredRedactionArtifacts = [
  'src/evidence-redaction.js',
  'test/evidence-redaction.test.js',
  'docs/evidence/ao-evidence-redaction.md',
  'docs/scenario-matrix.md',
];
const expectedSurfaceHashes = {
  requiredReleaseChecksHash: 'sha256:8da71bfb4b6fe04583bc53dc0ad9ef8294860eda2561b3016e388620d3e8f0ae',
  requiredReleaseChecksReportHash: 'sha256:c80d2eaa5c8e5965fdd0457ce41acb732db25bb31aae635ea6db85e5b2ffe2ad',
  artifactRedactionScanHash: 'sha256:2489960afb710def170c7d8a296b1feb5e08bc4ad1030bcc3269c38ec1a76df0',
  evidenceRedactionTestHash: 'sha256:fe0b2fc5fefb42e20ecf917f8b8f74fad8d67808c09f9465cb3ca727c5e0d78b',
  evidenceRedactionDocHash: 'sha256:09d0de0845bab3cdb3db51dee786f0726e5808891bb4553cdd9abe83fb17edc2',
  requiredChecksFixtureHash: 'sha256:44544d57cc6ee49ab1e2128ba650db0c50fc8607b9ce9d2510044df7398e029c',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0908 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function summarizeWithRedactionObservation(updateObservations) {
  const fixture = loadFixture();
  const observations = clone(fixture.observations);
  updateObservations(observations);

  return summarizeRequiredReleaseChecks({
    checks: clone(fixture.checks),
    observations,
    now: fixture.evaluation.now,
  });
}

function blockingProblem(summary) {
  return [...summary.missingChecks, ...summary.staleChecks]
    .find((problem) => problem.id === redactionCheckId);
}

function writeFixture(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-908-redaction-proof-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'required-checks-fixture.json');
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

test('RPP-0908 review records artifact redaction as a blocking required proof', () => {
  const { text, report } = loadEvidenceReport();
  const redactionCheck = REQUIRED_RELEASE_CHECKS.find((check) => check.id === redactionCheckId);

  assert.ok(redactionCheck);
  assert.equal(redactionCheck.severity, 'blocking');
  assert.equal(redactionCheck.productionRequired, true);
  assert.equal(redactionCheck.command, redactionCommand);
  assert.deepEqual(redactionCheck.artifacts, requiredRedactionArtifacts);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0908');
  assert.equal(report.workerId, 'rpp-908');
  assert.equal(report.variant, 1);
  assert.equal(report.evidenceMode, 'hash-count-surface-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateStatusMovement, 'none');
  assert.deepEqual(report.requiredProof.requiredArtifacts, requiredRedactionArtifacts);
  assert.equal(report.requiredProof.command, redactionCommand);
  assert.deepEqual(report.surfaceHashes, expectedSurfaceHashes);
  assert.equal(report.hashCountSurfaceOnly.artifactSurfaceCount, 6);
  assert.equal(report.hashCountSurfaceOnly.requiredCheckCount, 10);
  assert.equal(report.hashCountSurfaceOnly.redactionRequiredCheckCount, 1);
  assert.equal(report.hashCountSurfaceOnly.failureModeCount, 5);
  assert.equal(report.hashCountSurfaceOnly.rawUrlsIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.credentialsIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.cookiesIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.tokensIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.payloadsStored, false);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
});

test('RPP-0908 required redaction proof failures keep release checks held', () => {
  const cases = [
    {
      name: 'missing observation',
      code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
      bucket: 'missingChecks',
      mutate(observations) {
        delete observations[redactionCheckId];
      },
    },
    {
      name: 'failed observation',
      code: 'REQUIRED_RELEASE_CHECK_FAILED',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[redactionCheckId].status = 'failed';
        observations[redactionCheckId].failureSurfaceCount = 1;
        observations[redactionCheckId].subjectHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
      },
    },
    {
      name: 'command mismatch',
      code: 'REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[redactionCheckId].command = 'node --test test/artifact-redaction-scan.test.js';
      },
    },
    {
      name: 'missing artifact observation',
      code: 'REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING',
      bucket: 'missingChecks',
      mutate(observations) {
        observations[redactionCheckId].artifacts = observations[redactionCheckId].artifacts
          .filter((artifact) => artifact !== 'docs/scenario-matrix.md');
      },
    },
    {
      name: 'stale observation',
      code: 'REQUIRED_RELEASE_CHECK_STALE',
      bucket: 'staleChecks',
      mutate(observations) {
        observations[redactionCheckId].observedAt = '2026-05-20T08:00:00.000Z';
      },
    },
  ];

  for (const fixtureCase of cases) {
    const summary = summarizeWithRedactionObservation(fixtureCase.mutate);
    const problem = blockingProblem(summary);

    assert.equal(summary.ok, false, fixtureCase.name);
    assert.equal(summary.releaseReady, false, fixtureCase.name);
    assert.equal(summary.requiredCount, 10, fixtureCase.name);
    assert.equal(summary.passedCount, 9, fixtureCase.name);
    assert.ok(problem, fixtureCase.name);
    assert.equal(problem.code, fixtureCase.code, fixtureCase.name);
    assert.equal(summary[fixtureCase.bucket].some((entry) => entry.id === redactionCheckId), true, fixtureCase.name);
  }
});

test('RPP-0908 required release checks CLI exits nonzero on failed redaction proof', (t) => {
  const fixture = loadFixture();
  fixture.observations[redactionCheckId] = {
    ...fixture.observations[redactionCheckId],
    status: 'failed',
    failureSurfaceCount: 1,
    subjectHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
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
  assert.equal(report.requiredCount, 10);
  assert.equal(report.passedCount, 9);
  assert.equal(report.missingCount, 1);
  assert.equal(report.staleCount, 0);
  assert.deepEqual(report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
    [redactionCheckId, 'REQUIRED_RELEASE_CHECK_FAILED'],
  ]);
  assert.equal(report.checks.find((check) => check.id === redactionCheckId).observation.status, 'failed');
});

test('RPP-0908 review docs remain redacted and hash/count/surface-only', async () => {
  const report = await scanArtifacts([
    'docs/security/privacy-redaction-review.md',
    'docs/evidence/rpp-0908-privacy-redaction-review.md',
  ], { cwd: repoRoot });
  const combinedText = [
    fs.readFileSync(reviewDocPath, 'utf8'),
    fs.readFileSync(evidencePath, 'utf8'),
  ].join('\n');

  assert.equal(report.ok, true);
  assert.deepEqual(report.rejectedFiles, []);
  assert.deepEqual(report.scannedFiles, [
    'docs/evidence/rpp-0908-privacy-redaction-review.md',
    'docs/security/privacy-redaction-review.md',
  ]);
  assert.ok(report.allowedHashEvidence >= 6, 'expected hash-only evidence to be counted');
  assert.doesNotMatch(combinedText, /\bhttps?:\/\//i);
  assert.doesNotMatch(combinedText, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
});
