import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_RELEASE_CHECKS,
  summarizeRequiredReleaseChecks,
  validateRequiredReleaseChecksSummary,
} from '../src/required-release-checks.js';
import { runRequiredReleaseChecksReport } from '../scripts/release/required-release-checks-report.mjs';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDocPath = 'docs/audit/telemetry-free-audit-mode.md';
const evidenceDocPath = 'docs/evidence/rpp-0918-telemetry-free-audit-mode.md';
const fixedNow = '2026-06-01T00:00:00.000Z';
const observedAt = '2026-05-31T23:30:00.000Z';
const failedProofId = 'artifact-redaction-proof';

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

function writeObservations(t, observations) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0918-audit-'));
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

  const forbidden = /(?:analytics|authorization|bearer|cookie|credential|hostname|operator|password|secret|telemetry|token|username|url)/i;
  return Object.entries(value).flatMap(([key, entry]) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    return [
      ...(forbidden.test(key) ? [keyPath] : []),
      ...forbiddenTelemetryKeys(entry, keyPath),
    ];
  });
}

test('RPP-0918 required proof failure blocks release readiness without telemetry fields', () => {
  const summary = summarizeRequiredReleaseChecks({
    observations: failedRequiredProofObservations(),
    now: fixedNow,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(summary.passedCount, REQUIRED_RELEASE_CHECKS.length - 1);
  assert.deepEqual(summary.staleChecks, []);
  assert.deepEqual(validateRequiredReleaseChecksSummary(summary), { ok: true, errors: [] });
  assert.deepEqual(summary.missingChecks.map((check) => ({
    id: check.id,
    code: check.code,
    command: check.command,
    artifacts: check.artifacts,
  })), [
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
  assert.deepEqual(forbiddenTelemetryKeys(Object.values(failedRequiredProofObservations())), []);
});

test('RPP-0918 report command exits nonzero for failed required proof', (t) => {
  const observationsFile = writeObservations(t, failedRequiredProofObservations());
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
  assert.equal(result.report.summary.missingChecks[0].id, failedProofId);
  assert.equal(result.report.summary.missingChecks[0].code, 'REQUIRED_RELEASE_CHECK_FAILED');
});

test('RPP-0918 support docs are redaction-safe and NO-GO scoped', async () => {
  const auditDoc = fs.readFileSync(path.join(repoRoot, auditDocPath), 'utf8');
  const evidenceDoc = fs.readFileSync(path.join(repoRoot, evidenceDocPath), 'utf8');
  const combined = `${auditDoc}\n${evidenceDoc}`;

  assert.match(auditDoc, /Mode: support-only/);
  assert.match(evidenceDoc, /Release posture: NO-GO/);
  assert.match(combined, /does not\s+collect telemetry/i);
  assert.match(combined, /releaseReady: false/);
  assert.doesNotMatch(combined, /Release posture: GO/);
  assert.doesNotMatch(combined, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/);
  assert.doesNotMatch(combined, /\btelemetry\s*[:=]\s*["']?(?:enabled|true|on|1)\b/i);

  const redactionReport = await scanArtifacts([auditDocPath, evidenceDocPath], { cwd: repoRoot });
  assert.equal(redactionReport.ok, true);
  assert.deepEqual(redactionReport.rejectedFiles, []);
  assert.deepEqual(redactionReport.scannedFiles, [auditDocPath, evidenceDocPath]);
});
