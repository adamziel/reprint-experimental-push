import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readAgentsReleaseGatesStatusRow } from '../scripts/release/agents-release-gates-status-row.mjs';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runRequiredReleaseChecksReport } from '../scripts/release/required-release-checks-report.mjs';
import {
  REQUIRED_RELEASE_CHECKS,
  REQUIRED_RELEASE_CHECK_SEVERITIES,
  summarizeRequiredReleaseChecks,
  validateRequiredReleaseChecksSummary,
} from '../src/required-release-checks.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseGateScript = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const auditDocPath = 'docs/evidence/rpp-0943-release-gate-3-final-audit-v3.md';
const fixedNow = '2026-06-01T02:45:00.000Z';
const observedAt = '2026-06-01T02:30:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const invalidLocalUrl = 'not-a-release-url';
const remoteChangedUrl = 'https://changed.example.test/push';
const failedRequiredCheckId = 'release-gates-evaluator';
const missingRequiredCheckId = 'operator-proof';
const missingLocalMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_LOCAL_URL_REQUIRED]';
const invalidLocalMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_LOCAL_URL_INVALID]';
const mutationPolicy = {
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
};

function completeFinalEvidence(options = {}) {
  const scope = 'final-release';
  const marker = options.marker || invalidLocalMarker;
  const failureReason = options.failureReason || 'REPRINT_PUSH_LOCAL_URL_INVALID';

  return {
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: {
      ok: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
      command: 'node ./scripts/playground/auth-session-source-command.js',
      scope,
    },
    productionSecret: { ok: true, present: true, observed: 'auth-session-source-command', scope },
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'bound-to-source-url',
      scope,
    },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'recovery-inspect-read-only', scope },
    tmuxStatusMarker: { ok: true, marker, scope },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: readAgentsReleaseGatesStatusRow({
      rootDir: repoRoot,
      scope,
    }).evidence,
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: failureReason,
      mutationAttempted: false,
      statusMarker: marker,
      scope,
    },
    ...(options.overrides || {}),
  };
}

function finalReleaseInputMissingLocalTopology() {
  return {
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    evidence: completeFinalEvidence({
      marker: missingLocalMarker,
      failureReason: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
    }),
    releaseEvidenceProvenance: {
      maxEvidenceAgeHours: 24,
      evidenceRows: operatorProofProvenanceRows(),
    },
  };
}

function finalReleaseInputInvalidLocalTopology() {
  return {
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: invalidLocalUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    evidence: completeFinalEvidence(),
    releaseEvidenceProvenance: {
      maxEvidenceAgeHours: 24,
      evidenceRows: operatorProofProvenanceRows(),
    },
  };
}

function operatorProofProvenanceRows() {
  return [
    provenanceRow('release-gate:tmux-status-marker', 'RPP-0017', 'docs/evidence/release/tmux-status-marker.ndjson', 1),
    provenanceRow('release-gate:progress-release-timestamp', 'RPP-0018', 'docs/evidence/release/progress-timestamp.json', 2),
    provenanceRow('release-gate:agents-release-gates-row', 'RPP-0019', 'docs/evidence/release/agents-release-gates-row.json', 3),
    provenanceRow('release-gate:verify-release-failure-reason', 'RPP-0020', 'docs/evidence/release/verify-release-failure-reason.json', 4, {
      status: 'checked-failed',
    }),
  ];
}

function provenanceRow(evidenceId, rppId, artifactPath, hashDigit, overrides = {}) {
  return {
    evidenceId,
    rppId,
    sourceKind: 'operator-production',
    artifactPath,
    observedAt,
    command: 'checked release-gate audit command',
    status: 'checked-passed',
    subjectHash: `sha256:${String(hashDigit).repeat(64)}`,
    operatorScope: 'final-release',
    productionRequired: true,
    ...overrides,
  };
}

function passingRequiredCheckObservations() {
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

function missingRequiredCheckObservations() {
  const observations = passingRequiredCheckObservations();
  delete observations[missingRequiredCheckId];
  return observations;
}

function failedRequiredCheckObservations() {
  const observations = passingRequiredCheckObservations();
  observations[failedRequiredCheckId] = {
    ...observations[failedRequiredCheckId],
    status: 'failed',
  };
  return observations;
}

function supportOnlyRequiredCheckObservations() {
  return Object.fromEntries(REQUIRED_RELEASE_CHECKS.map((check) => [
    check.id,
    {
      status: 'support_only',
      command: check.command,
      artifacts: [...check.artifacts],
      observedAt,
      supportOnly: true,
      productionBacked: false,
    },
  ]));
}

function writeJson(t, prefix, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runReleaseGate(t, payload) {
  const evidenceFile = writeJson(t, 'rpp-0943-release-gate-3-', payload);
  return spawnSync(process.execPath, [
    releaseGateScript,
    '--evidence-file',
    evidenceFile,
    '--scope',
    'final-release',
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
}

function runRequiredChecksReport(t, observations) {
  const observationsFile = writeJson(t, 'rpp-0943-required-checks-', { observations, now: fixedNow });
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

function parseReport(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing release gate ${id}`);
  return gate;
}

function assertRequiredChecksRemainBlocking() {
  assert.ok(REQUIRED_RELEASE_CHECKS.length > 0, 'required release checks must be present');

  for (const check of REQUIRED_RELEASE_CHECKS) {
    assert.equal(check.severity, REQUIRED_RELEASE_CHECK_SEVERITIES.blocking, `${check.id} must be blocking`);
    assert.equal(check.productionRequired !== false, true, `${check.id} must require production proof`);
  }
}

function assertHeldReleaseGate(result, expected) {
  const report = parseReport(result);
  const localUrlGate = gateById(report, 'local-url');
  const productionSecretGate = gateById(report, 'production-secret');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, expected.code);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.releaseMovement.candidateGates, '19/20');
  assert.equal(report.statusMarker, expected.marker);
  assert.ok(result.stdout.includes(expected.marker), 'stdout JSON must expose the held CI marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, mutationPolicy);
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, true);

  assert.equal(localUrlGate.status, expected.gateStatus);
  assert.equal(localUrlGate.blocking, true);
  assert.equal(localUrlGate.code, expected.code);
  assert.equal(localUrlGate.evidence.required, expected.required);
  assert.equal(localUrlGate.evidence.observed, expected.observed);
  assert.equal(localUrlGate.evidence.envKey, 'REPRINT_PUSH_LOCAL_URL');
  assert.equal(localUrlGate.evidence.scope, expected.scope);

  assert.equal(productionSecretGate.evidence.username, '');
  assertRedactedSecretField(productionSecretGate.evidence.applicationPassword);
  assert.equal(productionSecretGate.evidence.authSessionSourceCommand, 'configured');
  assertNoTelemetryOrRawSecrets(report);
}

function assertRequiredCheckProblem(result, expected) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.releaseStatus, 'held');
  assert.equal(result.report.contract.branchProtection, 'not consulted');
  assert.equal(result.report.contract.externalServices, 'not required');
  assert.equal(result.report.summary.missingChecks.length, 1);
  assert.equal(result.report.summary.missingChecks[0].id, expected.id);
  assert.equal(result.report.summary.missingChecks[0].code, expected.code);
  assert.equal(result.report.summary.missingChecks[0].command, expected.command);
  assertNoTelemetryOrRawSecrets(result.report);
}

function telemetryKeyPaths(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => telemetryKeyPaths(entry, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const telemetry = /(?:analytics|beacon|metric|span|telemetry|trace)/i;
  return Object.entries(value).flatMap(([key, entry]) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    return [
      ...(telemetry.test(key) ? [keyPath] : []),
      ...telemetryKeyPaths(entry, keyPath),
    ];
  });
}

function assertNoTelemetryOrRawSecrets(report) {
  const serialized = JSON.stringify(report);
  assert.deepEqual(telemetryKeyPaths(report), []);
  assert.doesNotMatch(serialized, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/);
  assert.doesNotMatch(serialized, /\bREPRINT_PUSH_(?:USERNAME|APPLICATION_PASSWORD|LAB_AUTH_ADMIN_USER|LAB_AUTH_ADMIN_APP_PASSWORD)\b/);
  assert.doesNotMatch(serialized, /"applicationPassword"\s*:\s*"configured"/);
  assert.doesNotMatch(serialized, /"username"\s*:\s*"configured"/);
}

function assertRedactedSecretField(value) {
  assert.equal(value.redacted, true);
  assert.equal(value.redaction, 'reprint-push-evidence-redaction-v1');
  assert.equal(value.reason, 'secret-or-session-field');
  assert.equal(value.valueType, 'string');
}

test('RPP-0943 release gate 3 final audit v3 blocks release when required topology proof is missing or failed', (t) => {
  assertHeldReleaseGate(runReleaseGate(t, finalReleaseInputMissingLocalTopology()), {
    code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
    marker: missingLocalMarker,
    gateStatus: 'missing',
    required: 'REPRINT_PUSH_LOCAL_URL',
    observed: 'missing-local-edited-site',
    scope: 'missing',
  });

  assertHeldReleaseGate(runReleaseGate(t, finalReleaseInputInvalidLocalTopology()), {
    code: 'REPRINT_PUSH_LOCAL_URL_INVALID',
    marker: invalidLocalMarker,
    gateStatus: 'failed',
    required: 'absolute http(s) REPRINT_PUSH_LOCAL_URL',
    observed: invalidLocalUrl,
    scope: 'final-release',
  });
});

test('RPP-0943 release gate 3 final audit v3 reports missing or failed required CI proof as held readiness', (t) => {
  assertRequiredChecksRemainBlocking();

  const missingSummary = summarizeRequiredReleaseChecks({
    observations: missingRequiredCheckObservations(),
    now: fixedNow,
  });
  assert.equal(missingSummary.ok, false);
  assert.equal(missingSummary.releaseReady, false);
  assert.equal(missingSummary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(missingSummary.passedCount, REQUIRED_RELEASE_CHECKS.length - 1);
  assert.deepEqual(validateRequiredReleaseChecksSummary(missingSummary), { ok: true, errors: [] });
  assert.deepEqual(missingSummary.missingChecks.map((check) => ({
    id: check.id,
    code: check.code,
    command: check.command,
  })), [
    {
      id: missingRequiredCheckId,
      code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
      command: 'node --test test/release-gates.test.js',
    },
  ]);
  assertRequiredCheckProblem(runRequiredChecksReport(t, missingRequiredCheckObservations()), {
    id: missingRequiredCheckId,
    code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
    command: 'node --test test/release-gates.test.js',
  });

  const failedSummary = summarizeRequiredReleaseChecks({
    observations: failedRequiredCheckObservations(),
    now: fixedNow,
  });
  assert.equal(failedSummary.ok, false);
  assert.equal(failedSummary.releaseReady, false);
  assert.equal(failedSummary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(failedSummary.passedCount, REQUIRED_RELEASE_CHECKS.length - 1);
  assert.deepEqual(validateRequiredReleaseChecksSummary(failedSummary), { ok: true, errors: [] });
  assert.deepEqual(failedSummary.missingChecks.map((check) => ({
    id: check.id,
    code: check.code,
    command: check.command,
  })), [
    {
      id: failedRequiredCheckId,
      code: 'REQUIRED_RELEASE_CHECK_FAILED',
      command: 'node --test test/release-gates.test.js',
    },
  ]);
  assertRequiredCheckProblem(runRequiredChecksReport(t, failedRequiredCheckObservations()), {
    id: failedRequiredCheckId,
    code: 'REQUIRED_RELEASE_CHECK_FAILED',
    command: 'node --test test/release-gates.test.js',
  });
});

test('RPP-0943 release gate 3 final audit v3 keeps support-only observations from moving release readiness', (t) => {
  const observations = supportOnlyRequiredCheckObservations();
  const summary = summarizeRequiredReleaseChecks({
    observations,
    now: fixedNow,
  });
  const result = runRequiredChecksReport(t, observations);

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.requiredCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(summary.passedCount, 0);
  assert.deepEqual(summary.staleChecks, []);
  assert.deepEqual(validateRequiredReleaseChecksSummary(summary), { ok: true, errors: [] });
  assert.equal(summary.missingChecks.length, REQUIRED_RELEASE_CHECKS.length);
  assert.deepEqual(new Set(summary.missingChecks.map((check) => check.code)), new Set([
    'REQUIRED_RELEASE_CHECK_NOT_PASSED',
  ]));
  assert.deepEqual(new Set(summary.missingChecks.map((check) => check.observedStatus)), new Set([
    'support_only',
  ]));

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.releaseStatus, 'held');
  assert.equal(result.report.passedCount, 0);
  assert.equal(result.report.missingCount, REQUIRED_RELEASE_CHECKS.length);
  assert.equal(result.report.contract.branchProtection, 'not consulted');
  assert.equal(result.report.contract.externalServices, 'not required');
  assertNoTelemetryOrRawSecrets(result.report);
});

test('RPP-0943 release gate 3 final audit v3 keeps evidence support-only and GATE-3 held', async () => {
  const auditDoc = fs.readFileSync(path.join(repoRoot, auditDocPath), 'utf8');
  const statusRow = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const gate3 = statusRow.evidence.gateStatuses.find((gate) => gate.gate === 'GATE-3');
  const redactionReport = await scanArtifacts([auditDocPath], { cwd: repoRoot });

  assert.match(auditDoc, /Mode: support-only GATE-3 final audit/);
  assert.match(auditDoc, /Release posture: NO-GO/);
  assert.match(auditDoc, /Audited lane head before this evidence file: `357c70c4f26554b79beeda92bffcd52fb44004e4`/);
  assert.match(auditDoc, /REPRINT_PUSH_LOCAL_URL_REQUIRED/);
  assert.match(auditDoc, /REPRINT_PUSH_LOCAL_URL_INVALID/);
  assert.match(auditDoc, /support-only observations cannot move final release readiness/i);
  assert.match(auditDoc, /no\s+release-gate status movement/i);
  assert.doesNotMatch(auditDoc, /Release posture: GO/);
  assert.doesNotMatch(auditDoc, /\btelemetry\s*[:=]\s*["']?(?:enabled|true|on|1)\b/i);
  assert.doesNotMatch(auditDoc, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/);

  assert.equal(statusRow.ok, true);
  assert.equal(statusRow.evidence.releaseVerdict, '0/4');
  assert.equal(statusRow.evidence.releaseStatus, 'NO-GO');
  assert.deepEqual(statusRow.evidence.statusCounts, { support_only: 4 });
  assert.deepEqual(gate3, {
    gate: 'GATE-3',
    title: 'Live Docker/Playground Production Topology',
    status: 'support_only',
  });
  assert.equal(redactionReport.ok, true);
  assert.deepEqual(redactionReport.rejectedFiles, []);
  assert.deepEqual(redactionReport.scannedFiles, [auditDocPath]);
});
