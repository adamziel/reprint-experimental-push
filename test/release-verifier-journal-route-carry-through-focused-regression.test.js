import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0094_SHOULD_NOT_LEAK';
const checkedJournalRoute = '/wp-json/reprint/v1/push/db-journal?limit=80';
const verifierStatusMarker = '[verify-release:held exit=1 reason=JOURNAL_ROUTE_READ_ONLY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=JOURNAL_ROUTE_READ_ONLY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const journalRouteReason = 'Journal route was not proven read-only.';
const requiredJournalRouteEvidence = ['journal route read-only proof'];
const checkedCommand = 'timeout 300s npm run verify:release';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

const expectedVerifierJournalWriteEvidence = {
  ok: false,
  readOnly: false,
  observed: 'journal-write-observed',
  observedStatus: 200,
  command: 'npm run verify:release',
  checkedCommand,
  checkedRoute: checkedJournalRoute,
  method: 'POST',
  sourceUrl,
  mutatesReleaseState: true,
  mutationAttempted: true,
  mutatingIdempotencyKey: 'idem-rpp-0094-journal-write',
  journalRowsBefore: 7,
  journalRowsAfter: 8,
  scope: 'final-release',
};

const expectedGateJournalWriteEvidence = {
  ...expectedVerifierJournalWriteEvidence,
  required: requiredJournalRouteEvidence,
};

const expectedGateJournalReadOnlyEvidence = {
  ok: true,
  readOnly: true,
  observed: 'journal-read-only',
  observedStatus: 200,
  command: 'npm run verify:release',
  checkedCommand,
  checkedRoute: checkedJournalRoute,
  method: 'GET',
  sourceUrl,
  mutatesReleaseState: false,
  mutationAttempted: false,
  mutatingIdempotencyKey: 'absent',
  journalRowsBefore: 7,
  journalRowsAfter: 7,
  scope: 'final-release',
  required: requiredJournalRouteEvidence,
  requiredScope: 'final-release',
};

function verifierJournalWriteObservedReport() {
  return {
    ok: false,
    statusMarker: verifierStatusMarker,
    mutationAttempted: false,
    topology: {
      sourceUrl,
      remoteBase: null,
      remoteChanged: null,
      localEdited: null,
    },
    boundary: {
      firstRemainingProductionBoundary: 'journal route read-only on the checked live release path',
      status: 'blocked',
      verdict: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      journalRouteReadOnly: expectedVerifierJournalWriteEvidence,
    },
    preflight: {
      status: 0,
      authSessionType: 'journal-write-observed',
      routeProfile: 'production-shaped',
      session: {
        id: '',
        type: 'journal-write-observed',
      },
    },
    releaseProof: {
      ok: false,
      status: 1,
      code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    },
    journalRouteReadOnly: expectedVerifierJournalWriteEvidence,
    topologyEvidence: {
      checkedCommand,
      runner: {
        script: 'scripts/playground/production-shaped-live-release-verify.mjs',
        process: 'node',
        routeProfile: 'production-shaped',
        packagedFallbackAllowed: false,
      },
      ports: {
        sandboxIngress: 8080,
        source: 443,
        remoteChanged: 443,
        localEdited: 443,
        applyRevalidationSource: 443,
      },
      topology: {
        sourceUrl,
        localEditedSite: localUrl,
        remoteChangedDriftSource: remoteChangedUrl,
        sameRemoteIdentity: null,
        sourceCommand: '',
        sourceCommandReadbackUrl: '',
        packagedFallbackSource: false,
        blocker: null,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    },
  };
}

function journalReadOnlyEvidence() {
  return {
    ok: true,
    readOnly: true,
    observed: 'journal-read-only',
    observedStatus: 200,
    command: 'npm run verify:release',
    checkedCommand,
    checkedRoute: checkedJournalRoute,
    method: 'GET',
    sourceUrl,
    mutatesReleaseState: false,
    mutationAttempted: false,
    mutatingIdempotencyKey: 'absent',
    journalRowsBefore: 7,
    journalRowsAfter: 7,
    scope: 'final-release',
  };
}

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
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      sameUser: true,
      observed: 'application-password-bound-to-checked-source-user',
      checkedSourceUrl: sourceUrl,
      credentialSourceUrl: sourceUrl,
      checkedUser,
      credentialUser: checkedUser,
      bindingId: 'release-verifier-auth-session-source-command',
      scope,
    },
    manageOptionsCapability: {
      ok: true,
      hasManageOptions: true,
      observed: 'manage_options',
      checkedUser,
      route: '/wp-json/reprint-push/v1/preflight',
      method: 'GET',
      expectedCapability: 'manage_options',
      capabilities: { manage_options: true },
      scope,
    },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: journalReadOnlyEvidence(),
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: releaseGateReadyMarker,
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      checkedCommand,
      statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function journalRouteReadOnlyEvidenceFromReport(report) {
  return report.journalRouteReadOnly;
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: report.releaseProof.status,
    reason: report.releaseProof.code,
    command: 'npm run verify:release',
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-journal-route-carry-through-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runReleaseGateCheck(evidence) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeEvidence(evidence),
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

test('release verifier journal route read-only carry-through records negative and positive matrix for RPP-0094', () => {
  const verifyReport = verifierJournalWriteObservedReport();

  assert.deepEqual(
    {
      ok: verifyReport.ok,
      statusMarker: verifyReport.statusMarker,
      mutationAttempted: verifyReport.mutationAttempted,
      topology: verifyReport.topology,
      boundary: verifyReport.boundary,
      preflight: verifyReport.preflight,
      releaseProof: verifyReport.releaseProof,
      journalRouteReadOnly: verifyReport.journalRouteReadOnly,
      checkedCommand: verifyReport.topologyEvidence.checkedCommand,
      runner: verifyReport.topologyEvidence.runner,
      ports: verifyReport.topologyEvidence.ports,
      topologyEvidence: verifyReport.topologyEvidence.topology,
      releaseMovement: verifyReport.releaseMovement,
    },
    {
      ok: false,
      statusMarker: verifierStatusMarker,
      mutationAttempted: false,
      topology: {
        sourceUrl,
        remoteBase: null,
        remoteChanged: null,
        localEdited: null,
      },
      boundary: {
        firstRemainingProductionBoundary: 'journal route read-only on the checked live release path',
        status: 'blocked',
        verdict: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        journalRouteReadOnly: expectedVerifierJournalWriteEvidence,
      },
      preflight: {
        status: 0,
        authSessionType: 'journal-write-observed',
        routeProfile: 'production-shaped',
        session: {
          id: '',
          type: 'journal-write-observed',
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      },
      journalRouteReadOnly: expectedVerifierJournalWriteEvidence,
      checkedCommand,
      runner: {
        script: 'scripts/playground/production-shaped-live-release-verify.mjs',
        process: 'node',
        routeProfile: 'production-shaped',
        packagedFallbackAllowed: false,
      },
      ports: {
        sandboxIngress: 8080,
        source: 443,
        remoteChanged: 443,
        localEdited: 443,
        applyRevalidationSource: 443,
      },
      topologyEvidence: {
        sourceUrl,
        localEditedSite: localUrl,
        remoteChangedDriftSource: remoteChangedUrl,
        sameRemoteIdentity: null,
        sourceCommand: '',
        sourceCommandReadbackUrl: '',
        packagedFallbackSource: false,
        blocker: null,
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      },
    },
  );

  const negativeResult = runReleaseGateCheck(completeFinalEvidence({
    journalRouteReadOnly: journalRouteReadOnlyEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const positiveResult = runReleaseGateCheck(completeFinalEvidence());
  const negativeReport = parseReport(negativeResult);
  const positiveReport = parseReport(positiveResult);
  const negativeGate = gateById(negativeReport, 'journal-route-read-only');
  const positiveGate = gateById(positiveReport, 'journal-route-read-only');
  const recoveryBucket = negativeReport.missingProductionEvidenceBuckets
    .find((bucket) => bucket.bucket === 'recovery');

  const scenarioMatrix = [
    {
      scenario: 'negative-journal-write-observed',
      verifierCode: verifyReport.releaseProof.code,
      verifierMarker: verifyReport.statusMarker,
      gateStatus: negativeGate.status,
      gateCode: negativeGate.code,
      readOnly: negativeGate.evidence.readOnly,
      method: negativeGate.evidence.method,
      mutatesReleaseState: negativeGate.evidence.mutatesReleaseState,
      journalRowsBefore: negativeGate.evidence.journalRowsBefore,
      journalRowsAfter: negativeGate.evidence.journalRowsAfter,
      releaseAllowed: negativeReport.releaseMovement.allowed,
      primaryFailureCode: negativeReport.primaryFailureCode,
      mutationAttempted: negativeReport.mutationAttempted,
    },
    {
      scenario: 'positive-journal-read-only',
      verifierCode: 'OK',
      verifierMarker: 'n/a',
      gateStatus: positiveGate.status,
      gateCode: positiveGate.code,
      readOnly: positiveGate.evidence.readOnly,
      method: positiveGate.evidence.method,
      mutatesReleaseState: positiveGate.evidence.mutatesReleaseState,
      journalRowsBefore: positiveGate.evidence.journalRowsBefore,
      journalRowsAfter: positiveGate.evidence.journalRowsAfter,
      releaseAllowed: positiveReport.releaseMovement.allowed,
      primaryFailureCode: positiveReport.primaryFailureCode,
      mutationAttempted: positiveReport.mutationAttempted,
    },
  ];

  assert.equal(negativeResult.status, 1, negativeResult.stdout);
  assert.equal(negativeReport.ok, false);
  assert.equal(negativeReport.exitCode, 1);
  assert.equal(negativeReport.releaseStatus, 'NO-GO');
  assert.equal(negativeReport.status, 'held');
  assert.equal(negativeReport.gateState, 'held');
  assert.equal(negativeReport.primaryFailureBucket, 'recovery');
  assert.equal(negativeReport.primaryFailureCode, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(negativeReport.statusMarker, releaseGateHeldMarker);
  assert.ok(negativeResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(negativeReport.mutationAttempted, false);
  assert.deepEqual(negativeReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(negativeGate, {
    id: 'journal-route-read-only',
    rpp: 'RPP-0014',
    title: 'Journal route read-only proof',
    category: 'recovery',
    status: 'failed',
    blocking: true,
    code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
    reason: journalRouteReason,
    evidence: expectedGateJournalWriteEvidence,
  });
  assert.deepEqual(negativeReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: journalRouteReason,
    missingEvidence: [
      {
        id: 'journal-route-read-only',
        rpp: 'RPP-0014',
        status: 'failed',
        code: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        reason: journalRouteReason,
        evidence: expectedGateJournalWriteEvidence,
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
        reason: journalRouteReason,
        required: requiredJournalRouteEvidence,
        observed: 'journal-write-observed',
        scope: 'final-release',
      },
    ],
  });
  assert.equal(negativeReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);

  assert.equal(positiveResult.status, 1, positiveResult.stdout);
  assert.equal(positiveReport.ok, false);
  assert.equal(positiveReport.exitCode, 1);
  assert.equal(positiveReport.releaseStatus, 'NO-GO');
  assert.equal(positiveReport.primaryFailureBucket, 'provenance');
  assert.equal(positiveReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(positiveReport.statusMarker, releaseGateReadyMarker);
  assert.equal(positiveReport.releaseMovement.allowed, true);
  assert.equal(positiveReport.releaseMovement.finalGates, '20/20');
  assert.equal(positiveReport.mutationAttempted, false);
  assert.deepEqual(positiveReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(positiveGate, {
    id: 'journal-route-read-only',
    rpp: 'RPP-0014',
    title: 'Journal route read-only proof',
    category: 'recovery',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Journal route read-only proof is backed by final release evidence.',
    evidence: expectedGateJournalReadOnlyEvidence,
  });
  assert.deepEqual(scenarioMatrix, [
    {
      scenario: 'negative-journal-write-observed',
      verifierCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      verifierMarker: verifierStatusMarker,
      gateStatus: 'failed',
      gateCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      readOnly: false,
      method: 'POST',
      mutatesReleaseState: true,
      journalRowsBefore: 7,
      journalRowsAfter: 8,
      releaseAllowed: false,
      primaryFailureCode: 'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
      mutationAttempted: false,
    },
    {
      scenario: 'positive-journal-read-only',
      verifierCode: 'OK',
      verifierMarker: 'n/a',
      gateStatus: 'passed',
      gateCode: 'OK',
      readOnly: true,
      method: 'GET',
      mutatesReleaseState: false,
      journalRowsBefore: 7,
      journalRowsAfter: 7,
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
    },
  ]);
  assert.doesNotMatch(negativeResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(negativeResult.stderr, new RegExp(secretValue));
  assert.doesNotMatch(positiveResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(positiveResult.stderr, new RegExp(secretValue));
});
