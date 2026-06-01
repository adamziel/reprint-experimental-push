import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ARTIFACT_REDACTION_REASON_CODES,
  scanArtifacts,
} from '../scripts/release/artifact-redaction-scan.mjs';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import {
  REQUIRED_RELEASE_CHECKS,
  summarizeRequiredReleaseChecks,
} from '../src/required-release-checks.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'fixtures/protocol/push-required-release-checks-contract.json');
const requiredChecksScript = path.join(repoRoot, 'scripts/release/required-release-checks-report.mjs');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0948-privacy-redaction-review-v3.md');
const fixedNow = '2026-05-28T08:30:00.000Z';
const freshObservedAt = '2026-05-28T08:00:00.000Z';
const auditedLaneHead = 'd42afbd346db9f8cc0d344faae0f5729ff55539a';
const redactionCheckId = 'artifact-redaction-proof';
const redactionCommand = 'node --test test/evidence-redaction.test.js';
const requiredRedactionArtifacts = [
  'src/evidence-redaction.js',
  'test/evidence-redaction.test.js',
  'docs/evidence/ao-evidence-redaction.md',
  'docs/scenario-matrix.md',
];

const expectedSurfaceHashes = {
  artifactRedactionScanHash: 'sha256:2489960afb710def170c7d8a296b1feb5e08bc4ad1030bcc3269c38ec1a76df0',
  requiredReleaseChecksHash: 'sha256:8da71bfb4b6fe04583bc53dc0ad9ef8294860eda2561b3016e388620d3e8f0ae',
  requiredReleaseChecksReportHash: 'sha256:c80d2eaa5c8e5965fdd0457ce41acb732db25bb31aae635ea6db85e5b2ffe2ad',
  requiredChecksFixtureHash: 'sha256:44544d57cc6ee49ab1e2128ba650db0c50fc8607b9ce9d2510044df7398e029c',
  privacyRedactionReviewHash: 'sha256:8b7a8ad1857674b040ff4b0adb0bc30f718c6b5f857e869dac137024e6370e1b',
};

const redactionFailureFixtures = [
  {
    caseId: 'raw-url',
    code: ARTIFACT_REDACTION_REASON_CODES.RAW_HTTP_URL,
    file: 'raw-url.md',
    contents: 'Captured source endpoint: https://source-redaction.example.invalid/reprint.\n',
    leaked: 'source-redaction.example.invalid',
  },
  {
    caseId: 'credential',
    code: ARTIFACT_REDACTION_REASON_CODES.CREDENTIAL_VALUE,
    file: 'credential.txt',
    contents: 'Captured application credential: abcd efgh ijkl mnop qrst uvwx\n',
    leaked: 'abcd efgh ijkl mnop qrst uvwx',
  },
  {
    caseId: 'token',
    code: ARTIFACT_REDACTION_REASON_CODES.TOKEN_VALUE,
    file: 'token.md',
    contents: 'apiToken: ghp_abcdefghijklmnopqrstuvwxyz123456\n',
    leaked: 'abcdefghijklmnopqrstuvwxyz123456',
  },
  {
    caseId: 'cookie',
    code: ARTIFACT_REDACTION_REASON_CODES.COOKIE_VALUE,
    file: 'cookie.html',
    contents: '<pre>Set-Cookie: wordpress_logged_in_rpp=private-session-cookie; Path=/;</pre>\n',
    leaked: 'private-session-cookie',
  },
  {
    caseId: 'serialized-private-option',
    code: ARTIFACT_REDACTION_REASON_CODES.SERIALIZED_PRIVATE_OPTION,
    file: 'serialized-private-option.json',
    contents: JSON.stringify({
      option_name: 'plugin_settings',
      option_value: 'a:1:{s:11:"private_key";s:16:"operator-key";}',
    }, null, 2),
    leaked: 'operator-key',
  },
  {
    caseId: 'explicit-secret-key',
    code: ARTIFACT_REDACTION_REASON_CODES.SECRET_LIKE_KEY,
    file: 'explicit-secret-key.json',
    contents: JSON.stringify({ operatorSecret: 'launch-window-code' }, null, 2),
    leaked: 'launch-window-code',
  },
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

  assert.ok(match?.groups?.json, 'RPP-0948 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function makeArtifactRoot(t, fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-948-redaction-artifact-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const fullPath = path.join(root, fixture.file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, fixture.contents);

  return root;
}

function failedRequiredCheckFixture(fixture, index) {
  const payload = loadFixture();
  payload.evaluation.now = fixedNow;
  payload.observations[redactionCheckId] = {
    ...payload.observations[redactionCheckId],
    status: 'failed',
    failureSurfaceCount: 1,
    failureReasonCode: fixture.code,
    failedArtifactSurface: fixture.caseId,
    subjectHash: `sha256:${String(index + 1).repeat(64)}`,
  };

  return payload;
}

function supportOnlyRequiredCheckFixture() {
  const payload = loadFixture();
  payload.evaluation.now = fixedNow;
  payload.observations[redactionCheckId] = {
    status: 'support_only',
    supportOnly: true,
    command: redactionCommand,
    artifacts: [...requiredRedactionArtifacts],
    observedAt: freshObservedAt,
    subjectHash: `sha256:${'a'.repeat(64)}`,
  };

  return payload;
}

function writeRequiredCheckFixture(t, fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-948-required-checks-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'required-checks-fixture.json');
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

function summarizeFixture(fixture) {
  return summarizeRequiredReleaseChecks({
    checks: clone(fixture.checks),
    observations: clone(fixture.observations),
    now: fixedNow,
  });
}

function runRequiredChecksCli(t, fixture) {
  const fixtureFile = writeRequiredCheckFixture(t, fixture);
  return spawnSync(process.execPath, [
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
}

function redactionProblem(summary) {
  return [...summary.missingChecks, ...summary.staleChecks]
    .find((problem) => problem.id === redactionCheckId);
}

function reasonCodes(report) {
  return report.rejectedFiles.flatMap((entry) => entry.reasons.map((reason) => reason.code));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('RPP-0948 review v3 records support-only held redaction proof posture', () => {
  const { text, report } = loadEvidenceReport();
  const redactionCheck = REQUIRED_RELEASE_CHECKS.find((check) => check.id === redactionCheckId);

  assert.ok(redactionCheck);
  assert.equal(redactionCheck.severity, 'blocking');
  assert.equal(redactionCheck.productionRequired, true);
  assert.equal(redactionCheck.command, redactionCommand);
  assert.deepEqual(redactionCheck.artifacts, requiredRedactionArtifacts);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0948');
  assert.equal(report.sliceId, 'RPP-0948');
  assert.equal(report.workerId, 'rpp-948');
  assert.equal(report.variant, 3);
  assert.equal(report.auditedBranch, 'session/rpp-948');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.equal(report.evidenceMode, 'hash-count-surface-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.releaseReadiness, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateStatusMovement, 'none');
  assert.equal(report.releaseGateStatusUpdateAttempted, false);
  assert.deepEqual(report.releaseGateStatusFilesChanged, []);
  assert.equal(report.successCriterion, 'CI blocks release when a required proof fails.');
  assert.deepEqual(report.requiredProof.requiredArtifacts, requiredRedactionArtifacts);
  assert.equal(report.requiredProof.command, redactionCommand);
  assert.deepEqual(report.surfaceHashes, expectedSurfaceHashes);
  assert.equal(report.hashCountSurfaceOnly.auditedSurfaceCount, 5);
  assert.equal(report.hashCountSurfaceOnly.requiredCheckCount, 10);
  assert.equal(report.hashCountSurfaceOnly.redactionRequiredCheckCount, 1);
  assert.equal(report.hashCountSurfaceOnly.failureModeCount, 6);
  assert.equal(report.hashCountSurfaceOnly.supportOnlyCaseCount, 1);
  assert.equal(report.hashCountSurfaceOnly.rawUrlsIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.credentialsIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.tokensIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.cookiesIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.serializedPrivateOptionsIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.explicitSecretKeysIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.privateValuesIncluded, false);
  assert.equal(report.hashCountSurfaceOnly.payloadsStored, false);
  assert.equal(report.hashCountSurfaceOnly.hashOnlyEvidenceAllowed, true);
  assert.equal(report.hashCountSurfaceOnly.countOnlyEvidenceAllowed, true);
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);

  for (const fixture of redactionFailureFixtures) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(fixture.leaked)), fixture.caseId);
  }
});

test('RPP-0948 scanner failures become blocking required redaction proof failures', async (t) => {
  for (const [index, fixture] of redactionFailureFixtures.entries()) {
    const root = makeArtifactRoot(t, fixture);
    const scanReport = await scanArtifacts([fixture.file], { cwd: root });
    const serializedScanReport = JSON.stringify(scanReport);
    const requiredFixture = failedRequiredCheckFixture(fixture, index);
    const summary = summarizeFixture(requiredFixture);
    const problem = redactionProblem(summary);

    assert.equal(scanReport.ok, false, fixture.caseId);
    assert.deepEqual(scanReport.scannedFiles, [fixture.file], fixture.caseId);
    assert.ok(reasonCodes(scanReport).includes(fixture.code), `missing ${fixture.code}`);
    assert.match(serializedScanReport, /<redacted:/, fixture.caseId);
    assert.doesNotMatch(serializedScanReport, new RegExp(escapeRegExp(fixture.leaked)), fixture.caseId);

    assert.equal(summary.ok, false, fixture.caseId);
    assert.equal(summary.releaseReady, false, fixture.caseId);
    assert.equal(summary.requiredCount, 10, fixture.caseId);
    assert.equal(summary.passedCount, 9, fixture.caseId);
    assert.ok(problem, fixture.caseId);
    assert.equal(problem.code, 'REQUIRED_RELEASE_CHECK_FAILED', fixture.caseId);
    assert.equal(summary.missingChecks.some((entry) => entry.id === redactionCheckId), true, fixture.caseId);
  }
});

test('RPP-0948 required release checks CLI exits nonzero for each redaction failure reason', (t) => {
  for (const [index, fixture] of redactionFailureFixtures.entries()) {
    const requiredFixture = failedRequiredCheckFixture(fixture, index);
    const result = runRequiredChecksCli(t, requiredFixture);
    const report = JSON.parse(result.stdout);

    assert.equal(result.status, 1, fixture.caseId);
    assert.equal(result.stderr, '', fixture.caseId);
    assert.equal(report.command, 'required-release-checks-report', fixture.caseId);
    assert.equal(report.releaseReady, false, fixture.caseId);
    assert.equal(report.releaseStatus, 'held', fixture.caseId);
    assert.equal(report.requiredCount, 10, fixture.caseId);
    assert.equal(report.passedCount, 9, fixture.caseId);
    assert.equal(report.missingCount, 1, fixture.caseId);
    assert.equal(report.staleCount, 0, fixture.caseId);
    assert.deepEqual(report.summary.missingChecks.map((problem) => [problem.id, problem.code]), [
      [redactionCheckId, 'REQUIRED_RELEASE_CHECK_FAILED'],
    ], fixture.caseId);
    assert.equal(report.checks.find((check) => check.id === redactionCheckId).observation.status, 'failed');
  }
});

test('RPP-0948 support-only redaction observation cannot move final release readiness', (t) => {
  const requiredFixture = supportOnlyRequiredCheckFixture();
  const summary = summarizeFixture(requiredFixture);
  const problem = redactionProblem(summary);
  const result = runRequiredChecksCli(t, requiredFixture);
  const report = JSON.parse(result.stdout);
  const redactionReport = report.checks.find((check) => check.id === redactionCheckId);

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.requiredCount, 10);
  assert.equal(summary.passedCount, 9);
  assert.ok(problem);
  assert.equal(problem.code, 'REQUIRED_RELEASE_CHECK_NOT_PASSED');
  assert.equal(problem.observedStatus, 'support_only');
  assert.equal(result.status, 1);
  assert.equal(report.releaseReady, false);
  assert.equal(report.releaseStatus, 'held');
  assert.equal(report.missingCount, 1);
  assert.equal(report.staleCount, 0);
  assert.deepEqual(report.summary.missingChecks.map((entry) => [entry.id, entry.code]), [
    [redactionCheckId, 'REQUIRED_RELEASE_CHECK_NOT_PASSED'],
  ]);
  assert.equal(redactionReport.observation.status, 'support_only');
  assert.equal(redactionReport.observation.commandMatches, true);
  assert.equal(redactionReport.observation.artifactCount, requiredRedactionArtifacts.length);
  assert.equal(redactionReport.observation.requiredArtifactCount, requiredRedactionArtifacts.length);
});

test('RPP-0948 evidence artifact remains redacted and records no gate movement', async () => {
  const scanReport = await scanArtifacts([
    'docs/evidence/rpp-0948-privacy-redaction-review-v3.md',
  ], { cwd: repoRoot });
  const { text, report } = loadEvidenceReport();

  assert.equal(scanReport.ok, true);
  assert.deepEqual(scanReport.rejectedFiles, []);
  assert.deepEqual(scanReport.scannedFiles, [
    'docs/evidence/rpp-0948-privacy-redaction-review-v3.md',
  ]);
  assert.ok(scanReport.allowedHashEvidence >= 5);
  assert.equal(report.supportOnly, true);
  assert.equal(report.releaseGateStatusMovement, 'none');
  assert.equal(report.releaseGateStatusUpdateAttempted, false);
  assert.deepEqual(report.releaseGateStatusFilesChanged, []);
  assert.equal(report.supportOnlyObservationCase.releaseGateStatusMovement, 'none');
  assert.equal(report.releaseReadiness, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.doesNotMatch(text, /\bhttps?:\/\//i);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
});
