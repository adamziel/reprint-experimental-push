import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const command = 'node scripts/playground/production-shaped-apply-revalidation-smoke.mjs';
const checkedRecoveryRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const requiredRecoveryInspectEvidence = ['recovery inspect read-only proof'];
const releaseReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED]';

function completeFinalEvidence(overrides = {}) {
  const scope = 'final-release';
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: recoveryInspectReadOnlyEvidence(),
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
    ...overrides,
  };
}

function recoveryInspectReadOnlyEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    readOnly: true,
    observed: 'inspect-read-only',
    observedStatus: 200,
    command,
    checkedRoute: checkedRecoveryRoute,
    method: 'POST',
    mutatesReleaseState: false,
    mutationAttempted: false,
    recoveryRowsBefore: 2,
    recoveryRowsAfter: 2,
    recoveryStateBefore: 'blocked-recovery',
    recoveryStateAfter: 'blocked-recovery',
    sourceUrl,
    scope,
    ...overrides,
  };
}

function recoveryInspectWriteObservedEvidence() {
  return recoveryInspectReadOnlyEvidence({
    ok: false,
    readOnly: false,
    observed: 'inspect-write-observed',
    observedStatus: 200,
    mutatesReleaseState: true,
    mutationAttempted: true,
    recoveryRowsAfter: 3,
    recoveryStateAfter: 'mutated-recovery',
  });
}

function generatedFixture(recoveryInspectReadOnly = recoveryInspectReadOnlyEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'recovery-inspect-read-only-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedRecoveryInspectReadOnly: {
      sourceUrl,
      route: checkedRecoveryRoute,
      command,
      method: 'POST',
      recoveryRowsStable: true,
      stateStable: true,
      mutationAttempted: false,
      finalMarker: releaseReadyMarker,
    },
    scenarioMatrix: [
      {
        scenario: 'negative-recovery-inspect-write-observed',
        expectedGateStatus: 'failed',
        expectedCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        expectedMarker: heldMarker,
        mutationBlockedByReleaseGate: true,
      },
      {
        scenario: 'positive-recovery-inspect-read-only',
        expectedGateStatus: 'passed',
        expectedCode: 'OK',
        expectedMarker: releaseReadyMarker,
        mutationBlockedByReadOnlyRoute: true,
      },
    ],
    evidence: completeFinalEvidence({ recoveryInspectReadOnly }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-inspect-read-only-gate-coverage-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidenceFile) {
  return spawnSync(process.execPath, [
    scriptPath,
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

function parseReport(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

test('generated recovery inspect read-only fixture emits final marker and preserves no-mutation evidence for RPP-0055', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'recovery-inspect-read-only');

  assert.deepEqual(fixture.scenarioMatrix.map((entry) => entry.scenario), [
    'negative-recovery-inspect-write-observed',
    'positive-recovery-inspect-read-only',
  ]);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, releaseReadyMarker);
  assert.ok(result.stdout.includes(releaseReadyMarker), 'stdout JSON must expose the tmux-visible final marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    ok: true,
    readOnly: true,
    observed: 'inspect-read-only',
    observedStatus: 200,
    command,
    checkedRoute: checkedRecoveryRoute,
    method: 'POST',
    mutatesReleaseState: false,
    mutationAttempted: false,
    recoveryRowsBefore: 2,
    recoveryRowsAfter: 2,
    recoveryStateBefore: 'blocked-recovery',
    recoveryStateAfter: 'blocked-recovery',
    sourceUrl,
    scope: 'final-release',
    required: requiredRecoveryInspectEvidence,
    requiredScope: 'final-release',
  });
});

test('generated recovery inspect write-observed fixture fails closed with held marker for RPP-0055', () => {
  const fixture = generatedFixture(recoveryInspectWriteObservedEvidence());
  const positiveFixture = generatedFixture(recoveryInspectReadOnlyEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const positiveResult = runCheckedCommand(writeEvidence(positiveFixture));
  const report = parseReport(result);
  const positiveReport = parseReport(positiveResult);
  const recoveryBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'recovery');
  const gate = gateById(report, 'recovery-inspect-read-only');
  const positiveGate = gateById(positiveReport, 'recovery-inspect-read-only');
  const expectedEvidence = {
    ok: false,
    readOnly: false,
    observed: 'inspect-write-observed',
    observedStatus: 200,
    command,
    checkedRoute: checkedRecoveryRoute,
    method: 'POST',
    mutatesReleaseState: true,
    mutationAttempted: true,
    recoveryRowsBefore: 2,
    recoveryRowsAfter: 3,
    recoveryStateBefore: 'blocked-recovery',
    recoveryStateAfter: 'mutated-recovery',
    sourceUrl,
    scope: 'final-release',
    required: requiredRecoveryInspectEvidence,
  };
  const observedMatrix = [
    {
      scenario: fixture.scenarioMatrix[0].scenario,
      marker: report.statusMarker,
      gateStatus: gate.status,
      gateCode: gate.code,
      readOnly: gate.evidence.readOnly,
      mutatesReleaseState: gate.evidence.mutatesReleaseState,
      recoveryRowsBefore: gate.evidence.recoveryRowsBefore,
      recoveryRowsAfter: gate.evidence.recoveryRowsAfter,
      recoveryStateBefore: gate.evidence.recoveryStateBefore,
      recoveryStateAfter: gate.evidence.recoveryStateAfter,
      releaseAllowed: report.releaseMovement.allowed,
      primaryFailureCode: report.primaryFailureCode,
      mutationAttempted: report.mutationAttempted,
    },
    {
      scenario: fixture.scenarioMatrix[1].scenario,
      marker: positiveReport.statusMarker,
      gateStatus: positiveGate.status,
      gateCode: positiveGate.code,
      readOnly: positiveGate.evidence.readOnly,
      mutatesReleaseState: positiveGate.evidence.mutatesReleaseState,
      recoveryRowsBefore: positiveGate.evidence.recoveryRowsBefore,
      recoveryRowsAfter: positiveGate.evidence.recoveryRowsAfter,
      recoveryStateBefore: positiveGate.evidence.recoveryStateBefore,
      recoveryStateAfter: positiveGate.evidence.recoveryStateAfter,
      releaseAllowed: positiveReport.releaseMovement.allowed,
      primaryFailureCode: positiveReport.primaryFailureCode,
      mutationAttempted: positiveReport.mutationAttempted,
    },
  ];

  assert.equal(fixture.evidence.recoveryInspectReadOnly.recoveryRowsAfter, 3);
  assert.equal(positiveFixture.scenarioMatrix[1].mutationBlockedByReadOnlyRoute, true);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(positiveResult.status, 1, positiveResult.stdout);
  assert.equal(report.ok, false);
  assert.equal(positiveReport.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(positiveReport.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'recovery');
  assert.equal(report.primaryFailureCode, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the tmux-visible held marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(observedMatrix, [
    {
      scenario: 'negative-recovery-inspect-write-observed',
      marker: heldMarker,
      gateStatus: 'failed',
      gateCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      readOnly: false,
      mutatesReleaseState: true,
      recoveryRowsBefore: 2,
      recoveryRowsAfter: 3,
      recoveryStateBefore: 'blocked-recovery',
      recoveryStateAfter: 'mutated-recovery',
      releaseAllowed: false,
      primaryFailureCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      mutationAttempted: false,
    },
    {
      scenario: 'positive-recovery-inspect-read-only',
      marker: releaseReadyMarker,
      gateStatus: 'passed',
      gateCode: 'OK',
      readOnly: true,
      mutatesReleaseState: false,
      recoveryRowsBefore: 2,
      recoveryRowsAfter: 2,
      recoveryStateBefore: 'blocked-recovery',
      recoveryStateAfter: 'blocked-recovery',
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
    },
  ]);
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'Recovery inspect route was not proven read-only.',
    missingEvidence: [
      {
        id: 'recovery-inspect-read-only',
        rpp: 'RPP-0015',
        status: 'failed',
        code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        reason: 'Recovery inspect route was not proven read-only.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(recoveryBucket, {
    bucket: 'recovery',
    gateCount: 1,
    gates: [
      {
        bucket: 'recovery',
        id: 'recovery-inspect-read-only',
        rpp: 'RPP-0015',
        title: 'Recovery inspect read-only proof',
        status: 'failed',
        code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        reason: 'Recovery inspect route was not proven read-only.',
        required: requiredRecoveryInspectEvidence,
        observed: 'inspect-write-observed',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'recovery-inspect-read-only',
    rpp: 'RPP-0015',
    title: 'Recovery inspect read-only proof',
    category: 'recovery',
    status: 'failed',
    blocking: true,
    code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
    reason: 'Recovery inspect route was not proven read-only.',
    evidence: expectedEvidence,
  });
});
