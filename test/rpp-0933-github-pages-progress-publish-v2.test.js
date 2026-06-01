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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0933-github-pages-progress-publish-v2.md');
const fixedNow = '2026-05-28T08:30:00.000Z';
const publishCheckId = 'github-pages-progress-publish-proof';
const publishCommand = 'npm run publish:progress-page:dry-run';
const matchingProgressHash = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
const mismatchedPublicHash = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';
const requiredPublishArtifacts = [
  'scripts/release/publish-progress-page.mjs',
  'progress.html',
  'docs/evidence/ao-progress-report.md',
  'docs/release/github-pages-progress-publish.md',
  'docs/evidence/rpp-0933-github-pages-progress-publish-v2.md',
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

  assert.ok(match?.groups?.json, 'RPP-0933 evidence must contain one JSON report block');
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

function passedPublishObservation(overrides = {}) {
  return {
    status: 'passed',
    command: publishCommand,
    artifacts: [...requiredPublishArtifacts],
    observedAt: '2026-05-28T08:00:00.000Z',
    laneArtifact: {
      path: 'progress.html',
      sha256: matchingProgressHash,
    },
    publishedPublicArtifact: {
      path: 'progress.html',
      sha256: matchingProgressHash,
    },
    artifactMatchStatus: 'matched',
    ...overrides,
  };
}

function allChecks() {
  const fixture = loadFixture();
  return [...clone(fixture.checks), publishRequiredCheck()];
}

function passedObservations() {
  const fixture = loadFixture();
  return {
    ...clone(fixture.observations),
    [publishCheckId]: passedPublishObservation(),
  };
}

function summarizeWithObservations(updateObservations) {
  const observations = passedObservations();
  updateObservations(observations);

  return summarizeRequiredReleaseChecks({
    checks: allChecks(),
    observations,
    now: fixedNow,
  });
}

function publishProblem(summary, id = publishCheckId) {
  return [...summary.missingChecks, ...summary.staleChecks]
    .find((problem) => problem.id === id);
}

function evaluateProgressArtifactMatch(observation, requirement) {
  const lane = observation?.laneArtifact;
  const published = observation?.publishedPublicArtifact;

  if (!lane || lane.path !== requirement.laneArtifact.path) {
    return {
      status: 'failed',
      code: 'PROGRESS_PUBLISH_LANE_ARTIFACT_MISSING',
    };
  }

  if (!published || published.path !== requirement.publishedPublicArtifact.path) {
    return {
      status: 'failed',
      code: 'PROGRESS_PUBLISH_PUBLIC_ARTIFACT_MISSING',
    };
  }

  if (!lane.sha256 || !published.sha256 || lane.sha256 !== published.sha256) {
    return {
      status: 'failed',
      code: 'PROGRESS_PUBLISH_ARTIFACT_HASH_MISMATCH',
    };
  }

  return {
    status: 'passed',
    code: 'PROGRESS_PUBLISH_ARTIFACT_HASH_MATCHED',
  };
}

function publishObservationFromArtifactProof(overrides = {}) {
  const { report } = loadEvidenceReport();
  const observation = passedPublishObservation(overrides);
  const match = evaluateProgressArtifactMatch(observation, report.artifactMatchRequirement);

  if (match.status === 'passed') {
    return {
      ...observation,
      artifactMatchStatus: 'matched',
    };
  }

  return {
    ...observation,
    status: 'failed',
    artifactMatchStatus: 'failed',
    artifactFailureCode: match.code,
  };
}

function finalReleaseVerdict(report, summary) {
  return {
    requiredChecksReleaseReady: summary.releaseReady,
    productionBackedEvidenceObserved: report.releaseBoundary.productionBackedEvidenceObserved,
    releaseGateStatusMovementAllowed: report.releaseBoundary.releaseGateStatusMovementAllowed,
    releaseReadyForFinal: summary.releaseReady && report.productionBacked && report.releaseEligible,
    finalReleaseStatus: report.finalReleaseStatus,
  };
}

function writeFixture(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-933-progress-publish-v2-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'required-checks-fixture.json');
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

test('RPP-0933 evidence keeps GitHub Pages publish v2 proof required and held', () => {
  const { text, report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0933');
  assert.equal(report.workerId, 'rpp-933');
  assert.equal(report.variant, 2);
  assert.equal(report.auditedBranch, 'session/rpp-933');
  assert.equal(report.auditedLaneHeadBeforeEvidence, 'b9af7c7609a32d56493f562d6089b21831eebca7');
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
  assert.equal(report.artifactMatchRequirement.required, true);
  assert.equal(report.artifactMatchRequirement.comparison, 'sha256');
  assert.equal(report.artifactMatchRequirement.laneArtifact.path, 'progress.html');
  assert.equal(report.artifactMatchRequirement.publishedPublicArtifact.path, 'progress.html');
  assert.equal(report.artifactMatchRequirement.mismatchBlocksRelease, true);
  assert.equal(report.releaseReadinessPolicy.laneArtifactMustMatchPublishedPublicArtifact, true);
  assert.equal(report.releaseReadinessPolicy.productionBackedEvidenceRequiredForFinalGo, true);
  assert.equal(report.releaseBoundary.productionBackedEvidenceObserved, false);
  assert.equal(report.releaseBoundary.finalReleaseStatusWithoutProductionBackedEvidence, 'NO-GO');
  assert.equal(report.evidenceLimits.publishCommandExecuted, false);
  assert.equal(report.evidenceLimits.remotePushAttempted, false);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
});

test('RPP-0933 progress publish proof requires lane and public artifact hashes to match', () => {
  const { report } = loadEvidenceReport();
  const matchedObservation = publishObservationFromArtifactProof();
  const matchedSummary = summarizeWithObservations((observations) => {
    observations[publishCheckId] = matchedObservation;
  });

  assert.equal(matchedObservation.status, 'passed');
  assert.equal(matchedObservation.artifactMatchStatus, 'matched');
  assert.equal(matchedSummary.releaseReady, true);
  assert.equal(matchedSummary.requiredCount, 11);
  assert.equal(matchedSummary.passedCount, 11);

  const mismatchedObservation = publishObservationFromArtifactProof({
    publishedPublicArtifact: {
      path: 'progress.html',
      sha256: mismatchedPublicHash,
    },
  });
  const mismatchedSummary = summarizeWithObservations((observations) => {
    observations[publishCheckId] = mismatchedObservation;
  });
  const mismatchProblem = publishProblem(mismatchedSummary);

  assert.equal(mismatchedObservation.status, 'failed');
  assert.equal(mismatchedObservation.artifactFailureCode, 'PROGRESS_PUBLISH_ARTIFACT_HASH_MISMATCH');
  assert.equal(mismatchedSummary.releaseReady, false);
  assert.equal(mismatchedSummary.passedCount, 10);
  assert.equal(mismatchProblem.code, 'REQUIRED_RELEASE_CHECK_FAILED');

  const missingPublicObservation = publishObservationFromArtifactProof({
    publishedPublicArtifact: undefined,
  });
  const missingPublicSummary = summarizeWithObservations((observations) => {
    observations[publishCheckId] = missingPublicObservation;
  });
  const missingPublicProblem = publishProblem(missingPublicSummary);

  assert.equal(missingPublicObservation.status, 'failed');
  assert.equal(missingPublicObservation.artifactFailureCode, 'PROGRESS_PUBLISH_PUBLIC_ARTIFACT_MISSING');
  assert.equal(missingPublicSummary.releaseReady, false);
  assert.equal(missingPublicSummary.passedCount, 10);
  assert.equal(missingPublicProblem.code, 'REQUIRED_RELEASE_CHECK_FAILED');

  const finalVerdict = finalReleaseVerdict(report, matchedSummary);
  assert.equal(finalVerdict.requiredChecksReleaseReady, true);
  assert.equal(finalVerdict.productionBackedEvidenceObserved, false);
  assert.equal(finalVerdict.releaseGateStatusMovementAllowed, false);
  assert.equal(finalVerdict.releaseReadyForFinal, false);
  assert.equal(finalVerdict.finalReleaseStatus, 'NO-GO');
});

test('RPP-0933 missing or failed required proofs hold release readiness', () => {
  for (const check of allChecks()) {
    const missingSummary = summarizeWithObservations((observations) => {
      delete observations[check.id];
    });
    const missingProblem = publishProblem(missingSummary, check.id);

    assert.equal(missingSummary.ok, false, `${check.id} missing`);
    assert.equal(missingSummary.releaseReady, false, `${check.id} missing`);
    assert.equal(missingSummary.requiredCount, 11, `${check.id} missing`);
    assert.equal(missingSummary.passedCount, 10, `${check.id} missing`);
    assert.ok(missingProblem, `${check.id} missing`);
    assert.equal(missingProblem.code, 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING', `${check.id} missing`);

    const failedSummary = summarizeWithObservations((observations) => {
      observations[check.id] = {
        ...observations[check.id],
        status: 'failed',
      };
    });
    const failedProblem = publishProblem(failedSummary, check.id);

    assert.equal(failedSummary.ok, false, `${check.id} failed`);
    assert.equal(failedSummary.releaseReady, false, `${check.id} failed`);
    assert.equal(failedSummary.requiredCount, 11, `${check.id} failed`);
    assert.equal(failedSummary.passedCount, 10, `${check.id} failed`);
    assert.ok(failedProblem, `${check.id} failed`);
    assert.equal(failedProblem.code, 'REQUIRED_RELEASE_CHECK_FAILED', `${check.id} failed`);
  }
});

test('RPP-0933 required release checks CLI exits nonzero on failed publish proof', (t) => {
  const fixture = loadFixture();
  fixture.checks = [...fixture.checks, publishRequiredCheck()];
  fixture.observations[publishCheckId] = publishObservationFromArtifactProof({
    publishedPublicArtifact: {
      path: 'progress.html',
      sha256: mismatchedPublicHash,
    },
  });
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

test('RPP-0933 support evidence remains redacted and release-gate neutral', async () => {
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0933-github-pages-progress-publish-v2.md',
  ], { cwd: repoRoot });
  const { text } = loadEvidenceReport();

  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(scan.scannedFiles, [
    'docs/evidence/rpp-0933-github-pages-progress-publish-v2.md',
  ]);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
  assert.match(text, /does not move release-gate status/);
  assert.match(text, /keeps final release `NO-GO`/);
});
