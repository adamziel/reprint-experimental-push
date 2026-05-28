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
const releaseReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

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
    productionSecret: { ok: true, present: true, observed: 'production-credential-present', scope },
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: applyPreMutationEvidence(),
    journalRouteReadOnly: journalReadOnlyEvidence(),
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

function applyPreMutationEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    preMutation: true,
    observed: 'PRECONDITION_FAILED',
    observedStatus: 412,
    command,
    checkedRoute: '/wp-json/reprint-push/v1/apply',
    method: 'POST',
    preconditionCheck: 'storage-boundary-cas',
    phase: 'before-first-mutation',
    appliedBeforeFailure: 0,
    mutationAttempted: false,
    sourceUrl,
    scope,
    ...overrides,
  };
}

function journalReadOnlyEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    readOnly: true,
    observed: 'journal-read-only',
    observedStatus: 200,
    command,
    checkedRoute: '/wp-json/reprint/v1/push/db-journal?limit=80',
    method: 'GET',
    mutatesReleaseState: false,
    mutationAttempted: false,
    journalRowsBefore: 7,
    journalRowsAfter: 7,
    scope,
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
    checkedRoute: '/wp-json/reprint/v1/push/recovery/inspect',
    method: 'POST',
    mutatesReleaseState: false,
    mutationAttempted: false,
    recoveryRowsBefore: 2,
    recoveryRowsAfter: 2,
    recoveryStateBefore: 'blocked-recovery',
    recoveryStateAfter: 'blocked-recovery',
    scope,
    ...overrides,
  };
}

function writeFixture(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-focused-regression-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidence) {
  const evidenceFile = writeFixture(evidence);
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
    env: {
      PATH: process.env.PATH,
      NODE_NO_WARNINGS: '1',
    },
    encoding: 'utf8',
  });
}

function parseReport(result) {
  assert.equal(result.error, undefined, result.error?.stack || result.stderr || result.stdout);
  assert.equal(result.signal, null, result.stderr || result.stdout);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function reportFor(evidence) {
  const result = runCheckedCommand(evidence);
  return { result, report: parseReport(result) };
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function assertReadOnlyChecker(report) {
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
}

test('apply route pre-mutation focused regression links command and observed status for RPP-0073', () => {
  const positive = reportFor(completeFinalEvidence());
  const negative = reportFor(completeFinalEvidence({
    applyRoutePreMutation: applyPreMutationEvidence({
      ok: false,
      preMutation: false,
      observed: 'MUTATED_BEFORE_PRECONDITION',
      observedStatus: 200,
      phase: 'after-first-mutation',
      appliedBeforeFailure: 1,
      mutationAttempted: true,
    }),
  }));
  const positiveGate = gateById(positive.report, 'apply-route-pre-mutation');
  const negativeGate = gateById(negative.report, 'apply-route-pre-mutation');

  assert.equal(positive.result.status, 1);
  assert.equal(positive.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(positive.report.releaseMovement.allowed, true);
  assert.equal(positive.report.releaseMovement.finalGates, '20/20');
  assert.equal(positiveGate.status, 'passed');
  assert.equal(positiveGate.evidence.command, command);
  assert.equal(positiveGate.evidence.observedStatus, 412);
  assert.equal(positiveGate.evidence.phase, 'before-first-mutation');
  assertReadOnlyChecker(positive.report);

  assert.equal(negative.result.status, 1);
  assert.equal(negative.report.primaryFailureCode, 'APPLY_ROUTE_PRE_MUTATION_REQUIRED');
  assert.equal(negative.report.primaryFailureBucket, 'route');
  assert.equal(negative.report.statusMarker, '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLY_ROUTE_PRE_MUTATION_REQUIRED]');
  assert.ok(negative.result.stdout.includes(negative.report.statusMarker));
  assert.equal(negative.report.releaseMovement.allowed, false);
  assert.equal(negative.report.releaseMovement.finalGates, '19/20');
  assert.equal(negativeGate.status, 'failed');
  assert.equal(negativeGate.evidence.command, command);
  assert.equal(negativeGate.evidence.observedStatus, 200);
  assert.equal(negativeGate.evidence.phase, 'after-first-mutation');
  assert.equal(negativeGate.evidence.appliedBeforeFailure, 1);
  assertReadOnlyChecker(negative.report);
});

test('journal route read-only focused regression records negative and positive paths for RPP-0074', () => {
  const scenarios = [
    {
      name: 'negative-journal-write-observed',
      evidence: journalReadOnlyEvidence({
        ok: false,
        readOnly: false,
        observed: 'journal-write-observed',
        method: 'POST',
        mutatesReleaseState: true,
        mutationAttempted: true,
        journalRowsAfter: 8,
      }),
      expectedCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      expectedAllowed: false,
      expectedStatus: 'failed',
    },
    {
      name: 'positive-journal-read-only',
      evidence: journalReadOnlyEvidence(),
      expectedCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      expectedAllowed: true,
      expectedStatus: 'passed',
    },
  ];
  const matrix = [];

  for (const scenario of scenarios) {
    const { result, report } = reportFor(completeFinalEvidence({
      journalRouteReadOnly: scenario.evidence,
    }));
    const gate = gateById(report, 'journal-route-read-only');

    assert.equal(result.status, 1, scenario.name);
    assert.equal(report.primaryFailureCode, scenario.expectedCode, scenario.name);
    assert.equal(report.releaseMovement.allowed, scenario.expectedAllowed, scenario.name);
    assert.equal(gate.status, scenario.expectedStatus, scenario.name);
    assertReadOnlyChecker(report);
    matrix.push({
      scenario: scenario.name,
      gateStatus: gate.status,
      gateCode: gate.code,
      readOnly: gate.evidence.readOnly,
      method: gate.evidence.method,
      rowsBefore: gate.evidence.journalRowsBefore,
      rowsAfter: gate.evidence.journalRowsAfter,
      releaseAllowed: report.releaseMovement.allowed,
      primaryFailureCode: report.primaryFailureCode,
      mutationAttempted: report.mutationAttempted,
    });
  }

  assert.deepEqual(matrix, [
    {
      scenario: 'negative-journal-write-observed',
      gateStatus: 'failed',
      gateCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      readOnly: false,
      method: 'POST',
      rowsBefore: 7,
      rowsAfter: 8,
      releaseAllowed: false,
      primaryFailureCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      mutationAttempted: false,
    },
    {
      scenario: 'positive-journal-read-only',
      gateStatus: 'passed',
      gateCode: 'OK',
      readOnly: true,
      method: 'GET',
      rowsBefore: 7,
      rowsAfter: 7,
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
    },
  ]);
});

test('recovery inspect read-only focused regression prints final bracketed markers for RPP-0075', () => {
  const scenarios = [
    {
      name: 'negative-recovery-inspect-write-observed',
      evidence: recoveryInspectReadOnlyEvidence({
        ok: false,
        readOnly: false,
        observed: 'inspect-write-observed',
        mutatesReleaseState: true,
        mutationAttempted: true,
        recoveryRowsAfter: 3,
        recoveryStateAfter: 'mutated-recovery',
      }),
      marker: '[release-gates-ci:held final=19/20 candidate=19/20 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED]',
      expectedCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      expectedAllowed: false,
      expectedStatus: 'failed',
    },
    {
      name: 'positive-recovery-inspect-read-only',
      evidence: recoveryInspectReadOnlyEvidence(),
      marker: releaseReadyMarker,
      expectedCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      expectedAllowed: true,
      expectedStatus: 'passed',
    },
  ];

  for (const scenario of scenarios) {
    const { result, report } = reportFor(completeFinalEvidence({
      recoveryInspectReadOnly: scenario.evidence,
    }));
    const gate = gateById(report, 'recovery-inspect-read-only');

    assert.equal(result.status, 1, scenario.name);
    assert.equal(report.statusMarker, scenario.marker, scenario.name);
    assert.ok(result.stdout.includes(scenario.marker), scenario.name);
    assert.equal(report.primaryFailureCode, scenario.expectedCode, scenario.name);
    assert.equal(report.releaseMovement.allowed, scenario.expectedAllowed, scenario.name);
    assert.equal(gate.status, scenario.expectedStatus, scenario.name);
    assert.equal(gate.evidence.recoveryRowsBefore, 2, scenario.name);
    assert.equal(gate.evidence.recoveryStateBefore, 'blocked-recovery', scenario.name);
    assertReadOnlyChecker(report);
  }
});

test('releaseMovement summary focused regression reports named codes and no mutation for RPP-0076', () => {
  const denied = reportFor(completeFinalEvidence({
    sourceIdentity: {
      ok: false,
      same: false,
      sameSource: false,
      observed: 'source-url-drift',
      scope: 'final-release',
    },
  }));
  const allowed = reportFor(completeFinalEvidence());

  assert.equal(denied.result.status, 1);
  assert.equal(denied.report.primaryFailureCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(denied.report.releaseMovement.allowed, false);
  assert.equal(denied.report.releaseMovement.finalGates, '19/20');
  assert.equal(denied.report.summary.releaseMovement.allowed, false);
  assert.equal(denied.report.summary.missingEvidence[0].code, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assertReadOnlyChecker(denied.report);

  assert.equal(allowed.result.status, 1);
  assert.equal(allowed.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(allowed.report.releaseMovement.allowed, true);
  assert.equal(allowed.report.releaseMovement.finalGates, '20/20');
  assert.equal(allowed.report.summary.releaseMovement.allowed, true);
  assert.deepEqual(allowed.report.summary.missingEvidence, []);
  assertReadOnlyChecker(allowed.report);
});
