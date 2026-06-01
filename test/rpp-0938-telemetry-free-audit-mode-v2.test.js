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
const evidenceDocPath = 'docs/evidence/rpp-0938-telemetry-free-audit-mode-v2.md';
const fixedNow = '2026-06-01T00:00:00.000Z';
const observedAt = '2026-05-31T23:30:00.000Z';
const failedProofId = 'artifact-redaction-proof';
const missingProofId = 'provenance-proof';

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

function writeObservations(t, observations) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0938-audit-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const file = path.join(dir, 'observations.json');
  fs.writeFileSync(file, `${JSON.stringify({ observations, now: fixedNow }, null, 2)}\n`);
  return file;
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

test('RPP-0938 failed required proof remains blocking without telemetry fields', () => {
  const controlSummary = summarizeRequiredReleaseChecks({
    observations: passingObservations(),
    now: fixedNow,
  });
  assert.equal(controlSummary.ok, true);
  assert.equal(controlSummary.releaseReady, true);
  assert.equal(controlSummary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(controlSummary.passedCount, REQUIRED_RELEASE_CHECKS.length);

  const failedObservations = failedRequiredProofObservations();
  const summary = summarizeRequiredReleaseChecks({
    observations: failedObservations,
    now: fixedNow,
  });

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
});

test('RPP-0938 report command fails closed when required proof is missing', (t) => {
  const observationsFile = writeObservations(t, missingRequiredProofObservations());
  const result = runRequiredReleaseChecksReport([
    '--observations-file',
    observationsFile,
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    now: fixedNow,
  });

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
});

test('RPP-0938 release movement contract has no telemetry dependency', () => {
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
  assert.deepEqual(forbiddenTelemetryKeys(REQUIRED_RELEASE_CHECKS_CONTRACT.release_movement_policy), []);
});

test('RPP-0938 support evidence is redaction-safe and keeps final release NO-GO', async () => {
  const evidenceDoc = fs.readFileSync(path.join(repoRoot, evidenceDocPath), 'utf8');

  assert.match(evidenceDoc, /Mode: support-only telemetry-free audit/);
  assert.match(evidenceDoc, /Audited lane head: RPP-0938 telemetry-free audit mode v2/);
  assert.match(evidenceDoc, /Verdict: held/);
  assert.match(evidenceDoc, /Release posture: NO-GO/);
  assert.match(evidenceDoc, /Production-backed evidence: absent/);
  assert.match(evidenceDoc, /Release gate movement: none/);
  assert.match(evidenceDoc, /REQUIRED_RELEASE_CHECK_FAILED/);
  assert.match(evidenceDoc, /REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING/);
  assert.match(evidenceDoc, /branch protection is not consulted/i);
  assert.match(evidenceDoc, /external services are not required/i);
  assert.match(evidenceDoc, /does not\s+claim a final releasable build without production-backed evidence/i);
  assert.doesNotMatch(evidenceDoc, /Release posture: GO/);
  assert.doesNotMatch(evidenceDoc, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/);
  assert.doesNotMatch(evidenceDoc, /\btelemetry\s*[:=]\s*["']?(?:enabled|true|on|1)\b/i);

  const redactionReport = await scanArtifacts([evidenceDocPath], { cwd: repoRoot });
  assert.equal(redactionReport.ok, true);
  assert.deepEqual(redactionReport.rejectedFiles, []);
  assert.deepEqual(redactionReport.scannedFiles, [evidenceDocPath]);
});
