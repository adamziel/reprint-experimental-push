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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0973-github-pages-progress-publish-v4.md');
const priorEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0953-github-pages-progress-publish-v3.md');
const fixedNow = '2026-05-28T08:30:00.000Z';
const staleObservedAt = '2026-05-28T01:59:59.000Z';
const publishCheckId = 'github-pages-progress-publish-proof';
const publishCommand = 'npm run publish:progress-page:dry-run';
const matchingProgressHash = 'sha256:7777777777777777777777777777777777777777777777777777777777777777';
const mismatchedPublicHash = 'sha256:8888888888888888888888888888888888888888888888888888888888888888';
const requiredPublishArtifacts = [
  'scripts/release/publish-progress-page.mjs',
  'progress.html',
  'docs/evidence/ao-progress-report.md',
  'docs/release/github-pages-progress-publish.md',
  'docs/evidence/rpp-0973-github-pages-progress-publish-v4.md',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function loadEvidenceReport(file = evidencePath) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.basename(file)} must contain one JSON report block`);
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
    publicationEvidenceMode: 'support-only',
    productionBacked: false,
    releaseEligible: false,
    releaseGateStatusMovement: 'none',
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

function publishProblem(summary) {
  return [...summary.missingChecks, ...summary.staleChecks]
    .find((problem) => problem.id === publishCheckId);
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
    progressHtmlPublicationSupportOnly: report.releaseBoundary.progressHtmlPublicationSupportOnly,
    productionBackedEvidenceObserved: report.releaseBoundary.productionBackedEvidenceObserved,
    releaseGateStatusMovementAllowed: report.releaseBoundary.releaseGateStatusMovementAllowed,
    releaseGateStatusMovementObserved: report.releaseBoundary.releaseGateStatusMovementObserved,
    releaseReadyForFinal: summary.releaseReady && report.productionBacked && report.releaseEligible,
    finalReleaseStatus: report.finalReleaseStatus,
  };
}

function writeFixture(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-973-progress-publish-v4-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'required-checks-fixture.json');
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

function runRequiredChecksFixture(t, publishObservation) {
  const fixture = loadFixture();
  fixture.checks = [...fixture.checks, publishRequiredCheck()];
  if (publishObservation !== undefined) {
    fixture.observations[publishCheckId] = publishObservation;
  }
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

  return {
    result,
    report: JSON.parse(result.stdout),
  };
}

function comparableRequiredArtifacts(report) {
  return report.requiredProof.requiredArtifacts.map((artifact) => (
    artifact.replace(/docs\/evidence\/rpp-\d+-github-pages-progress-publish-v\d+\.md/, '<variant-evidence>')
  ));
}

test('RPP-0973 evidence carries forward RPP-0953 v3 progress publish contract', () => {
  const { text, report } = loadEvidenceReport();
  const { report: priorReport } = loadEvidenceReport(priorEvidencePath);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0973');
  assert.equal(report.workerId, 'rpp-973');
  assert.equal(report.variant, 4);
  assert.equal(report.auditedBranch, 'session/rpp-973');
  assert.equal(report.auditedLaneHeadBeforeEvidence, '47d71f95499fc6915474aec3eeb4ca1ff14e90dd');
  assert.equal(report.evidenceMode, 'support-only-required-check-fixture');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateStatusMovement, 'none');
  assert.equal(report.carriedForwardFrom.rppId, 'RPP-0953');
  assert.equal(report.carriedForwardFrom.variant, 3);
  assert.equal(report.carriedForwardFrom.carriedForward, true);
  assert.equal(report.requiredProof.checkId, priorReport.requiredProof.checkId);
  assert.equal(report.requiredProof.command, priorReport.requiredProof.command);
  assert.equal(report.requiredProof.freshnessWindowMs, priorReport.requiredProof.freshnessWindowMs);
  assert.deepEqual(comparableRequiredArtifacts(report), comparableRequiredArtifacts(priorReport));
  assert.equal(report.contractCarryForward.requiredProofCheckIdUnchanged, true);
  assert.equal(report.contractCarryForward.requiredCommandUnchanged, true);
  assert.equal(report.contractCarryForward.freshnessWindowUnchanged, true);
  assert.equal(report.contractCarryForward.artifactMatchPolicyUnchanged, true);
  assert.equal(report.contractCarryForward.supportOnlyBoundaryUnchanged, true);
  assert.equal(report.publicProgressPublishVerification.missingRequiredProofBlocksRelease, true);
  assert.equal(report.publicProgressPublishVerification.staleRequiredProofBlocksRelease, true);
  assert.equal(report.publicProgressPublishVerification.mismatchedPublicArtifactBlocksRelease, true);
  assert.equal(report.publicProgressPublishVerification.missingPublicArtifactBlocksRelease, true);
  assert.equal(report.publicProgressPublishVerification.supportOnlyObservationCanMoveFinalReleaseReadiness, false);
  assert.equal(report.publicProgressPublishVerification.releaseGateStatusMovementAllowed, false);
  assert.equal(report.releaseReadinessPolicy.progressHtmlPublicationIsSupportEvidenceOnly, true);
  assert.equal(report.releaseReadinessPolicy.productionBackedEvidenceRequiredForFinalGo, true);
  assert.equal(report.releaseBoundary.progressHtmlPublicationSupportOnly, true);
  assert.equal(report.releaseBoundary.productionBackedEvidenceObserved, false);
  assert.equal(report.releaseBoundary.releaseGateStatusMovementAllowed, false);
  assert.equal(report.releaseBoundary.releaseGateStatusMovementObserved, 'none');
  assert.equal(report.evidenceLimits.publishCommandExecuted, false);
  assert.equal(report.evidenceLimits.progressHtmlChanged, false);
  assert.equal(report.evidenceLimits.remotePushAttempted, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
});

test('RPP-0973 public progress publish verification fails closed when proof is missing or stale', () => {
  const missingSummary = summarizeWithObservations((observations) => {
    delete observations[publishCheckId];
  });
  const missingProblem = publishProblem(missingSummary);

  assert.equal(missingSummary.ok, false);
  assert.equal(missingSummary.releaseReady, false);
  assert.equal(missingSummary.requiredCount, 11);
  assert.equal(missingSummary.passedCount, 10);
  assert.ok(missingProblem);
  assert.equal(missingProblem.code, 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING');

  const staleSummary = summarizeWithObservations((observations) => {
    observations[publishCheckId] = passedPublishObservation({
      observedAt: staleObservedAt,
    });
  });
  const staleProblem = publishProblem(staleSummary);

  assert.equal(staleSummary.ok, false);
  assert.equal(staleSummary.releaseReady, false);
  assert.equal(staleSummary.requiredCount, 11);
  assert.equal(staleSummary.passedCount, 10);
  assert.ok(staleProblem);
  assert.equal(staleProblem.code, 'REQUIRED_RELEASE_CHECK_STALE');
  assert.equal(staleProblem.staleAfterMs, 21600000);
});

test('RPP-0973 public progress publish verification fails closed on mismatched or missing public artifact', () => {
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
  assert.equal(mismatchedSummary.ok, false);
  assert.equal(mismatchedSummary.releaseReady, false);
  assert.equal(mismatchedSummary.requiredCount, 11);
  assert.equal(mismatchedSummary.passedCount, 10);
  assert.ok(mismatchProblem);
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
  assert.equal(missingPublicSummary.ok, false);
  assert.equal(missingPublicSummary.releaseReady, false);
  assert.equal(missingPublicSummary.requiredCount, 11);
  assert.equal(missingPublicSummary.passedCount, 10);
  assert.ok(missingPublicProblem);
  assert.equal(missingPublicProblem.code, 'REQUIRED_RELEASE_CHECK_FAILED');
});

test('RPP-0973 required release checks exit nonzero and remain held on failed publish proof', (t) => {
  const failureCases = [
    {
      name: 'public hash mismatch',
      observation: publishObservationFromArtifactProof({
        publishedPublicArtifact: {
          path: 'progress.html',
          sha256: mismatchedPublicHash,
        },
      }),
      artifactFailureCode: 'PROGRESS_PUBLISH_ARTIFACT_HASH_MISMATCH',
    },
    {
      name: 'missing public artifact',
      observation: publishObservationFromArtifactProof({
        publishedPublicArtifact: undefined,
      }),
      artifactFailureCode: 'PROGRESS_PUBLISH_PUBLIC_ARTIFACT_MISSING',
    },
  ];

  for (const failureCase of failureCases) {
    const { result, report } = runRequiredChecksFixture(t, failureCase.observation);

    assert.equal(result.status, 1, `${failureCase.name}: ${result.stdout || result.stderr}`);
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
    const publishCheck = report.checks.find((check) => check.id === publishCheckId);
    assert.equal(publishCheck.observation.status, 'failed');
    assert.equal(failureCase.observation.artifactFailureCode, failureCase.artifactFailureCode);
  }
});

test('RPP-0973 required release checks exit nonzero on missing, stale, or incomplete publish proof', (t) => {
  const missingRun = runRequiredChecksFixture(t, undefined);

  assert.equal(missingRun.result.status, 1, missingRun.result.stdout || missingRun.result.stderr);
  assert.equal(missingRun.report.releaseReady, false);
  assert.equal(missingRun.report.releaseStatus, 'held');
  assert.equal(missingRun.report.missingCount, 1);
  assert.equal(missingRun.report.staleCount, 0);
  assert.deepEqual(missingRun.report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
    [publishCheckId, 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING'],
  ]);

  const staleRun = runRequiredChecksFixture(t, passedPublishObservation({
    observedAt: staleObservedAt,
  }));

  assert.equal(staleRun.result.status, 1, staleRun.result.stdout || staleRun.result.stderr);
  assert.equal(staleRun.report.releaseReady, false);
  assert.equal(staleRun.report.releaseStatus, 'stale');
  assert.equal(staleRun.report.missingCount, 0);
  assert.equal(staleRun.report.staleCount, 1);
  assert.deepEqual(staleRun.report.summary.staleChecks.map((problem) => [problem.id, problem.code]), [
    [publishCheckId, 'REQUIRED_RELEASE_CHECK_STALE'],
  ]);

  const commandMismatchRun = runRequiredChecksFixture(t, passedPublishObservation({
    command: 'npm run publish:progress-page',
  }));

  assert.equal(commandMismatchRun.result.status, 1, commandMismatchRun.result.stdout || commandMismatchRun.result.stderr);
  assert.equal(commandMismatchRun.report.releaseReady, false);
  assert.equal(commandMismatchRun.report.releaseStatus, 'held');
  assert.deepEqual(commandMismatchRun.report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
    [publishCheckId, 'REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH'],
  ]);

  const missingArtifactRun = runRequiredChecksFixture(t, passedPublishObservation({
    artifacts: requiredPublishArtifacts.filter((artifact) => artifact !== 'progress.html'),
  }));

  assert.equal(missingArtifactRun.result.status, 1, missingArtifactRun.result.stdout || missingArtifactRun.result.stderr);
  assert.equal(missingArtifactRun.report.releaseReady, false);
  assert.equal(missingArtifactRun.report.releaseStatus, 'held');
  assert.deepEqual(missingArtifactRun.report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
    [publishCheckId, 'REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING'],
  ]);
});

test('RPP-0973 progress.html publication remains support-only and cannot move final release', () => {
  const { report } = loadEvidenceReport();
  const matchedObservation = publishObservationFromArtifactProof();
  const matchedSummary = summarizeWithObservations((observations) => {
    observations[publishCheckId] = matchedObservation;
  });
  const finalVerdict = finalReleaseVerdict(report, matchedSummary);

  assert.equal(matchedObservation.status, 'passed');
  assert.equal(matchedObservation.artifactMatchStatus, 'matched');
  assert.equal(matchedObservation.publicationEvidenceMode, 'support-only');
  assert.equal(matchedObservation.productionBacked, false);
  assert.equal(matchedObservation.releaseEligible, false);
  assert.equal(matchedObservation.releaseGateStatusMovement, 'none');
  assert.equal(matchedSummary.releaseReady, true);
  assert.equal(matchedSummary.requiredCount, 11);
  assert.equal(matchedSummary.passedCount, 11);
  assert.equal(finalVerdict.requiredChecksReleaseReady, true);
  assert.equal(finalVerdict.progressHtmlPublicationSupportOnly, true);
  assert.equal(finalVerdict.productionBackedEvidenceObserved, false);
  assert.equal(finalVerdict.releaseGateStatusMovementAllowed, false);
  assert.equal(finalVerdict.releaseGateStatusMovementObserved, 'none');
  assert.equal(finalVerdict.releaseReadyForFinal, false);
  assert.equal(finalVerdict.finalReleaseStatus, 'NO-GO');
});

test('RPP-0973 support evidence remains redacted and release-gate neutral', async () => {
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0973-github-pages-progress-publish-v4.md',
  ], { cwd: repoRoot });
  const { text } = loadEvidenceReport();

  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(scan.scannedFiles, [
    'docs/evidence/rpp-0973-github-pages-progress-publish-v4.md',
  ]);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
  assert.match(text, /does not move release-gate status/);
  assert.match(text, /keeps final release\s+`NO-GO`/);
  assert.match(text, /cannot move final release readiness/);
  assert.match(text, /causes no release-gate status\s+movement/);
});
