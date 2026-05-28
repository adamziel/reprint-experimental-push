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
const checkedJournalRoute = '/wp-json/reprint/v1/push/db-journal?limit=80';
const requiredJournalRouteEvidence = ['journal route read-only proof'];

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
    journalRouteReadOnly: journalReadOnlyEvidence(),
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
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

function journalReadOnlyEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    readOnly: true,
    observed: 'journal-read-only',
    observedStatus: 200,
    command,
    checkedRoute: checkedJournalRoute,
    method: 'GET',
    mutatesReleaseState: false,
    mutationAttempted: false,
    mutatingIdempotencyKey: 'absent',
    journalRowsBefore: 7,
    journalRowsAfter: 7,
    sourceUrl,
    scope,
    ...overrides,
  };
}

function journalWriteObservedEvidence() {
  return journalReadOnlyEvidence({
    ok: false,
    readOnly: false,
    observed: 'journal-write-observed',
    observedStatus: 200,
    method: 'POST',
    mutatesReleaseState: true,
    mutationAttempted: true,
    mutatingIdempotencyKey: 'idem-journal-write',
    journalRowsAfter: 8,
  });
}

function generatedFixture(journalRouteReadOnly = journalReadOnlyEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'journal-route-read-only-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedJournalRouteReadOnly: {
      sourceUrl,
      route: checkedJournalRoute,
      command,
      allowedMethod: 'GET',
      blockedMutationMethod: 'POST',
      journalRowsStable: true,
      mutationAttempted: false,
    },
    scenarioMatrix: [
      {
        scenario: 'negative-journal-write-observed',
        expectedGateStatus: 'failed',
        expectedCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        mutationBlockedByReleaseGate: true,
      },
      {
        scenario: 'positive-journal-read-only',
        expectedGateStatus: 'passed',
        expectedCode: 'OK',
        mutationBlockedByReadOnlyRoute: true,
      },
    ],
    evidence: completeFinalEvidence({ journalRouteReadOnly }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-route-read-only-gate-coverage-'));
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

test('generated journal route read-only fixture preserves the positive read-only path for RPP-0054', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'journal-route-read-only');
  const expectedMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

  assert.deepEqual(fixture.scenarioMatrix.map((entry) => entry.scenario), [
    'negative-journal-write-observed',
    'positive-journal-read-only',
  ]);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    ok: true,
    readOnly: true,
    observed: 'journal-read-only',
    observedStatus: 200,
    command,
    checkedRoute: checkedJournalRoute,
    method: 'GET',
    mutatesReleaseState: false,
    mutationAttempted: false,
    mutatingIdempotencyKey: 'absent',
    journalRowsBefore: 7,
    journalRowsAfter: 7,
    sourceUrl,
    scope: 'final-release',
    required: requiredJournalRouteEvidence,
    requiredScope: 'final-release',
  });
});

test('generated journal route write-observed fixture fails closed before any verifier mutation for RPP-0054', () => {
  const fixture = generatedFixture(journalWriteObservedEvidence());
  const positiveFixture = generatedFixture(journalReadOnlyEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const positiveResult = runCheckedCommand(writeEvidence(positiveFixture));
  const report = parseReport(result);
  const positiveReport = parseReport(positiveResult);
  const recoveryBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'recovery');
  const gate = gateById(report, 'journal-route-read-only');
  const positiveGate = gateById(positiveReport, 'journal-route-read-only');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=JOURNAL_ROUTE_READ_ONLY_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    readOnly: false,
    observed: 'journal-write-observed',
    observedStatus: 200,
    command,
    checkedRoute: checkedJournalRoute,
    method: 'POST',
    mutatesReleaseState: true,
    mutationAttempted: true,
    mutatingIdempotencyKey: 'idem-journal-write',
    journalRowsBefore: 7,
    journalRowsAfter: 8,
    sourceUrl,
    scope: 'final-release',
    required: requiredJournalRouteEvidence,
  };
  const observedMatrix = [
    {
      scenario: fixture.scenarioMatrix[0].scenario,
      gateStatus: 'failed',
      gateCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      readOnly: expectedEvidence.readOnly,
      mutatesReleaseState: expectedEvidence.mutatesReleaseState,
      journalRowsBefore: expectedEvidence.journalRowsBefore,
      journalRowsAfter: expectedEvidence.journalRowsAfter,
      releaseAllowed: false,
      primaryFailureCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      command,
      mutationAttempted: report.mutationAttempted,
    },
    {
      scenario: fixture.scenarioMatrix[1].scenario,
      gateStatus: positiveGate.status,
      gateCode: positiveGate.code,
      readOnly: positiveGate.evidence.readOnly,
      mutatesReleaseState: positiveGate.evidence.mutatesReleaseState,
      journalRowsBefore: positiveGate.evidence.journalRowsBefore,
      journalRowsAfter: positiveGate.evidence.journalRowsAfter,
      releaseAllowed: positiveReport.releaseMovement.allowed,
      primaryFailureCode: positiveReport.primaryFailureCode,
      command: positiveGate.evidence.command,
      mutationAttempted: positiveReport.mutationAttempted,
    },
  ];

  assert.equal(fixture.evidence.journalRouteReadOnly.journalRowsAfter, 8);
  assert.equal(positiveFixture.scenarioMatrix[1].mutationBlockedByReadOnlyRoute, true);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(positiveResult.status, 1, positiveResult.stdout);
  assert.equal(report.ok, false);
  assert.equal(positiveReport.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(positiveReport.releaseStatus, 'NO-GO');
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'recovery');
  assert.equal(report.primaryFailureCode, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(observedMatrix, [
    {
      scenario: 'negative-journal-write-observed',
      gateStatus: 'failed',
      gateCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      readOnly: false,
      mutatesReleaseState: true,
      journalRowsBefore: 7,
      journalRowsAfter: 8,
      releaseAllowed: false,
      primaryFailureCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      command,
      mutationAttempted: false,
    },
    {
      scenario: 'positive-journal-read-only',
      gateStatus: 'passed',
      gateCode: 'OK',
      readOnly: true,
      mutatesReleaseState: false,
      journalRowsBefore: 7,
      journalRowsAfter: 7,
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      command,
      mutationAttempted: false,
    },
  ]);
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'Journal route was not proven read-only.',
    missingEvidence: [
      {
        id: 'journal-route-read-only',
        rpp: 'RPP-0014',
        status: 'failed',
        code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        reason: 'Journal route was not proven read-only.',
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
        id: 'journal-route-read-only',
        rpp: 'RPP-0014',
        title: 'Journal route read-only proof',
        status: 'failed',
        code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        reason: 'Journal route was not proven read-only.',
        required: requiredJournalRouteEvidence,
        observed: 'journal-write-observed',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'journal-route-read-only',
    rpp: 'RPP-0014',
    title: 'Journal route read-only proof',
    category: 'recovery',
    status: 'failed',
    blocking: true,
    code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    reason: 'Journal route was not proven read-only.',
    evidence: expectedEvidence,
  });
});
