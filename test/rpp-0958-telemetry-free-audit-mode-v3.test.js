import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_RELEASE_CHECKS,
  REQUIRED_RELEASE_CHECKS_CONTRACT,
  summarizeRequiredReleaseChecks,
  validateRequiredReleaseChecksSummary,
} from '../src/required-release-checks.js';
import { runRequiredReleaseChecksReport } from '../scripts/release/required-release-checks-report.mjs';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDocPath = 'docs/evidence/rpp-0958-telemetry-free-audit-mode-v3.md';
const fixedNow = '2026-06-01T03:45:00.000Z';
const observedAt = '2026-06-01T03:15:00.000Z';
const failedProofId = 'artifact-redaction-proof';
const missingProofId = 'provenance-proof';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function passingObservations() {
  return Object.fromEntries(REQUIRED_RELEASE_CHECKS.map((check) => [
    check.id,
    {
      status: 'passed',
      command: check.command,
      artifacts: [...check.artifacts],
      observedAt,
    },
  ]));
}

function failedRequiredProofObservations() {
  const observations = passingObservations();
  observations[failedProofId] = {
    ...observations[failedProofId],
    status: 'failed',
  };
  return observations;
}

function missingRequiredProofObservations() {
  const observations = passingObservations();
  delete observations[missingProofId];
  return observations;
}

function writeObservations(t, observations, prefix = 'rpp-0958-audit-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const file = path.join(dir, 'observations.json');
  fs.writeFileSync(file, `${JSON.stringify({ observations, now: fixedNow }, null, 2)}\n`);
  return file;
}

function runReportWithObservations(t, observations) {
  const observationsFile = writeObservations(t, observations);
  return runRequiredReleaseChecksReport([
    '--observations-file',
    observationsFile,
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    now: fixedNow,
  });
}

function loadEvidenceRecord() {
  const text = fs.readFileSync(path.join(repoRoot, evidenceDocPath), 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0958 evidence must contain one JSON record block');
  return {
    text,
    record: JSON.parse(match.groups.json),
  };
}

function forbiddenTelemetryKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenTelemetryKeys(entry, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const forbidden = /(?:analytics|authorization|bearer|cookie|credential|dashboard|hostname|password|secret|telemetry|token|tunnel|url|username)/i;
  return Object.entries(value).flatMap(([key, entry]) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    return [
      ...(forbidden.test(key) ? [keyPath] : []),
      ...forbiddenTelemetryKeys(entry, keyPath),
    ];
  });
}

function requiredProblemView(problem) {
  return {
    id: problem.id,
    code: problem.code,
    command: problem.command,
    artifacts: problem.artifacts,
  };
}

function finalReleaseDecision(evidenceRecord, requiredSummary) {
  return {
    localRequiredChecksReady: requiredSummary.releaseReady,
    supportOnly: evidenceRecord.supportOnly,
    productionBacked: evidenceRecord.productionBacked,
    releaseEligible: evidenceRecord.releaseEligible,
    releaseGateStatusMovementAllowed: evidenceRecord.releaseGateStatusMovementAllowed,
    releaseReadyForFinal: requiredSummary.releaseReady
      && evidenceRecord.productionBacked
      && evidenceRecord.releaseEligible
      && evidenceRecord.releaseGateStatusMovementAllowed,
    finalReleaseStatus: evidenceRecord.finalReleaseStatus,
  };
}

test('RPP-0958 failed required proof blocks release without telemetry fields', (t) => {
  const controlSummary = summarizeRequiredReleaseChecks({
    observations: passingObservations(),
    now: fixedNow,
  });
  assert.equal(controlSummary.ok, true);
  assert.equal(controlSummary.releaseReady, true);
  assert.equal(controlSummary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(controlSummary.passedCount, REQUIRED_RELEASE_CHECKS.length);

  const failedObservations = failedRequiredProofObservations();
  const result = runReportWithObservations(t, failedObservations);
  const summary = result.report.summary;

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.releaseStatus, 'held');
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(summary.passedCount, REQUIRED_RELEASE_CHECKS.length - 1);
  assert.deepEqual(summary.staleChecks, []);
  assert.deepEqual(summary.nonBlockingChecks, []);
  assert.deepEqual(validateRequiredReleaseChecksSummary(summary), { ok: true, errors: [] });
  assert.deepEqual(summary.missingChecks.map(requiredProblemView), [
    {
      id: failedProofId,
      code: 'REQUIRED_RELEASE_CHECK_FAILED',
      command: 'node --test test/evidence-redaction.test.js',
      artifacts: [
        'src/evidence-redaction.js',
        'test/evidence-redaction.test.js',
        'docs/evidence/ao-evidence-redaction.md',
        'docs/scenario-matrix.md',
      ],
    },
  ]);
  assert.deepEqual(forbiddenTelemetryKeys(Object.values(failedObservations)), []);
  assert.deepEqual(forbiddenTelemetryKeys(summary), []);
  assert.deepEqual(forbiddenTelemetryKeys(result.report), []);
});

test('RPP-0958 report command fails closed when required proof is missing', (t) => {
  const result = runReportWithObservations(t, missingRequiredProofObservations());

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.releaseStatus, 'held');
  assert.equal(result.report.contract.branchProtection, 'not consulted');
  assert.equal(result.report.contract.externalServices, 'not required');
  assert.equal(result.report.summary.missingChecks.length, 1);
  assert.deepEqual(requiredProblemView(result.report.summary.missingChecks[0]), {
    id: missingProofId,
    code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
    command: 'node --test test/protocol-compatibility.test.js',
    artifacts: [
      'src/protocol-compatibility.js',
      'test/protocol-compatibility.test.js',
      'fixtures/protocol/push-production-pull-bridge-contract.json',
      'docs/protocol.md',
    ],
  });
  assert.deepEqual(result.report.summary.staleChecks, []);
  assert.deepEqual(forbiddenTelemetryKeys(result.report.summary), []);
  assert.deepEqual(forbiddenTelemetryKeys(result.report), []);
});

test('RPP-0958 release movement has no telemetry dependency and no status movement', () => {
  const { record } = loadEvidenceRecord();

  assert.equal(
    REQUIRED_RELEASE_CHECKS_CONTRACT.release_movement_policy.branch_protection,
    'not consulted',
  );
  assert.equal(
    REQUIRED_RELEASE_CHECKS_CONTRACT.release_movement_policy.external_services,
    'not required',
  );
  assert.match(
    REQUIRED_RELEASE_CHECKS_CONTRACT.release_movement_policy.releaseReady,
    /true only when every blocking production-required check/,
  );
  assert.deepEqual(
    clone(record.releaseMovementContract),
    {
      branchProtection: 'not consulted',
      externalServices: 'not required',
      requiredChecksMustAllPass: true,
      missingRequiredProofBlocksRelease: true,
      failedRequiredProofBlocksRelease: true,
    },
  );
  assert.equal(record.releaseGateStatusMovement, 'none');
  assert.equal(record.releaseGateStatusMovementAllowed, false);
  assert.equal(record.releaseGateStatusUpdateAttempted, false);
  assert.deepEqual(record.releaseGateStatusFilesEdited, []);
  assert.deepEqual(forbiddenTelemetryKeys(REQUIRED_RELEASE_CHECKS_CONTRACT.release_movement_policy), []);
  assert.deepEqual(forbiddenTelemetryKeys(record), []);
});

test('RPP-0958 support-only evidence keeps final release NO-GO', () => {
  const { record } = loadEvidenceRecord();
  const controlSummary = summarizeRequiredReleaseChecks({
    observations: passingObservations(),
    now: fixedNow,
  });
  const decision = finalReleaseDecision(record, controlSummary);

  assert.equal(controlSummary.releaseReady, true);
  assert.deepEqual(decision, {
    localRequiredChecksReady: true,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    releaseGateStatusMovementAllowed: false,
    releaseReadyForFinal: false,
    finalReleaseStatus: 'NO-GO',
  });
  assert.equal(record.finalReleasePolicy.supportOnlyObservationCanPassLocalFixture, true);
  assert.equal(record.finalReleasePolicy.supportOnlyObservationCanMoveFinalRelease, false);
  assert.equal(record.finalReleasePolicy.productionBackedEvidenceRequiredForFinalGo, true);
  assert.equal(record.finalReleasePolicy.finalReleaseRequiredPosture, 'NO-GO');
});

test('RPP-0958 support evidence is redaction-safe and records no release-gate movement', async () => {
  const { text, record } = loadEvidenceRecord();

  assert.equal(record.schemaVersion, 1);
  assert.equal(record.rppId, 'RPP-0958');
  assert.equal(record.workerId, 'rpp-958');
  assert.equal(record.variant, 3);
  assert.equal(record.evidenceMode, 'support-only-required-check-fixture');
  assert.equal(record.supportOnly, true);
  assert.equal(record.productionBacked, false);
  assert.equal(record.releaseEligible, false);
  assert.equal(record.finalReleaseStatus, 'NO-GO');
  assert.equal(record.verdict, 'held');
  assert.deepEqual(record.requiredProofFailureCase, {
    checkId: failedProofId,
    expectedCode: 'REQUIRED_RELEASE_CHECK_FAILED',
    expectedExit: 1,
    expectedReportStatus: 'held',
    expectedReleaseReady: false,
    expectedFinalReleaseStatus: 'NO-GO',
  });
  assert.deepEqual(record.missingProofCase, {
    checkId: missingProofId,
    expectedCode: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
    expectedExit: 1,
    expectedReportStatus: 'held',
    expectedReleaseReady: false,
    expectedFinalReleaseStatus: 'NO-GO',
  });
  assert.match(text, /Mode: support-only telemetry-free audit/);
  assert.match(text, /Audited lane head: RPP-0958 telemetry-free audit mode v3/);
  assert.match(text, /Verdict: held/);
  assert.match(text, /Release posture: NO-GO/);
  assert.match(text, /Production-backed evidence: absent/);
  assert.match(text, /Release gate movement: none/);
  assert.match(text, /REQUIRED_RELEASE_CHECK_FAILED/);
  assert.match(text, /REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING/);
  assert.match(text, /branch\s+protection is not consulted/i);
  assert.match(text, /external services are not required/i);
  assert.match(text, /does not move release-gate status/i);
  assert.doesNotMatch(text, /Release posture: GO/);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/);
  assert.doesNotMatch(text, /\btelemetry\s*[:=]\s*["']?(?:enabled|true|on|1)\b/i);
  assert.deepEqual(record.releaseGateStatusFilesEdited, []);
  assert.equal(record.releaseGateStatusUpdateAttempted, false);

  const redactionReport = await scanArtifacts([evidenceDocPath], { cwd: repoRoot });
  assert.equal(redactionReport.ok, true);
  assert.deepEqual(redactionReport.rejectedFiles, []);
  assert.deepEqual(redactionReport.scannedFiles, [evidenceDocPath]);
});
