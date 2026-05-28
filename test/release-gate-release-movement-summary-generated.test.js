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
const releaseReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const deniedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=SAME_SOURCE_IDENTITY_REQUIRED]';
const requiredSourceIdentityEvidence = ['preflight, dry-run, apply, and recovery use the same source URL'];
const expectedSummaryGateEvidence = {
  producedBy: 'evaluateReleaseGates',
  schemaVersion: 1,
  observed: 'releaseMovement summary will be emitted with this evaluation',
  scope: 'final-release',
  requiredScope: 'final-release',
};

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
    sourceIdentity: sameSourceIdentityEvidence(),
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
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

function sameSourceIdentityEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    same: true,
    sameSource: true,
    observed: 'same-source-url',
    expectedSourceUrl: sourceUrl,
    preflightSourceUrl: sourceUrl,
    dryRunSourceUrl: sourceUrl,
    applySourceUrl: sourceUrl,
    journalSourceUrl: sourceUrl,
    recoverySourceUrl: sourceUrl,
    scope,
    ...overrides,
  };
}

function deniedSourceDriftEvidence() {
  return sameSourceIdentityEvidence({
    ok: false,
    same: false,
    sameSource: false,
    observed: 'summary-denied-source-drift',
    dryRunSourceUrl: remoteChangedUrl,
  });
}

function generatedFixture(sourceIdentity = sameSourceIdentityEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'release-movement-summary-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedReleaseMovementSummary: {
      deniedScenario: {
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        allowed: false,
        finalGates: '19/20',
        marker: deniedMarker,
      },
      allowedScenario: {
        code: 'PRODUCTION_EVIDENCE_REQUIRED',
        allowed: true,
        finalGates: '20/20',
        releaseStatus: 'NO-GO',
        marker: releaseReadyMarker,
      },
      mutationAttempted: false,
    },
    evidence: completeFinalEvidence({ sourceIdentity }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-movement-summary-gate-coverage-'));
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

function compactProvenanceBuckets(report) {
  return report.missingProductionEvidenceBuckets.map((bucket) => ({
    bucket: bucket.bucket,
    gateCount: bucket.gateCount,
    codes: bucket.gates.map((gate) => gate.code),
    ids: bucket.gates.map((gate) => gate.id),
  }));
}

test('generated releaseMovement denied summary exits with named code for RPP-0056', () => {
  const fixture = generatedFixture(deniedSourceDriftEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const summaryGate = gateById(report, 'release-movement-summary');
  const identityGate = gateById(report, 'same-source-identity');
  const identityBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'identity');
  const expectedEvidence = {
    ok: false,
    same: false,
    sameSource: false,
    observed: 'summary-denied-source-drift',
    expectedSourceUrl: sourceUrl,
    preflightSourceUrl: sourceUrl,
    dryRunSourceUrl: remoteChangedUrl,
    applySourceUrl: sourceUrl,
    journalSourceUrl: sourceUrl,
    recoverySourceUrl: sourceUrl,
    scope: 'final-release',
    required: requiredSourceIdentityEvidence,
  };

  assert.equal(fixture.expectedReleaseMovementSummary.deniedScenario.code, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'identity');
  assert.equal(report.primaryFailureCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(report.statusMarker, deniedMarker);
  assert.ok(result.stdout.includes(deniedMarker), 'stdout JSON must expose the denied summary marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'Source URL identity drifted across the checked release path.',
    missingEvidence: [
      {
        id: 'same-source-identity',
        rpp: 'RPP-0010',
        status: 'failed',
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        reason: 'Source URL identity drifted across the checked release path.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(report.summary.releaseMovement, report.releaseMovement);
  assert.deepEqual(report.summary.missingEvidence, report.releaseMovement.missingEvidence);
  assert.deepEqual(summaryGate.evidence, expectedSummaryGateEvidence);
  assert.deepEqual(identityBucket, {
    bucket: 'identity',
    gateCount: 1,
    gates: [
      {
        bucket: 'identity',
        id: 'same-source-identity',
        rpp: 'RPP-0010',
        title: 'Same source URL identity proof',
        status: 'failed',
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        reason: 'Source URL identity drifted across the checked release path.',
        required: requiredSourceIdentityEvidence,
        observed: 'summary-denied-source-drift',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(identityGate.evidence, expectedEvidence);
});

test('generated releaseMovement allowed summary remains NO-GO without provenance for RPP-0056', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const summaryGate = gateById(report, 'release-movement-summary');
  const observedMatrix = [
    {
      scenario: 'denied-source-identity-drift',
      expectedCode: fixture.expectedReleaseMovementSummary.deniedScenario.code,
      expectedAllowed: fixture.expectedReleaseMovementSummary.deniedScenario.allowed,
      expectedFinalGates: fixture.expectedReleaseMovementSummary.deniedScenario.finalGates,
      expectedMarker: fixture.expectedReleaseMovementSummary.deniedScenario.marker,
    },
    {
      scenario: 'allowed-final-evidence-without-provenance',
      exitCode: report.exitCode,
      primaryFailureCode: report.primaryFailureCode,
      releaseAllowed: report.releaseMovement.allowed,
      finalGates: report.releaseMovement.finalGates,
      summaryAllowed: report.summary.releaseMovement.allowed,
      summaryMissingEvidence: report.summary.missingEvidence.length,
      marker: report.statusMarker,
      mutationAttempted: report.mutationAttempted,
    },
  ];

  assert.equal(fixture.expectedReleaseMovementSummary.allowedScenario.code, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, releaseReadyMarker);
  assert.ok(result.stdout.includes(releaseReadyMarker), 'stdout JSON must expose the allowed summary marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: true,
    state: 'release-ready',
    gates: '20/20',
    finalGates: '20/20',
    candidateGates: '20/20',
    reason: 'all release gates are backed by final release evidence',
    missingEvidence: [],
  });
  assert.deepEqual(report.summary.releaseMovement, report.releaseMovement);
  assert.deepEqual(report.summary.missingEvidence, []);
  assert.deepEqual(summaryGate.evidence, expectedSummaryGateEvidence);
  assert.deepEqual(compactProvenanceBuckets(report), [
    {
      bucket: 'provenance',
      gateCount: 4,
      codes: [
        'PRODUCTION_EVIDENCE_REQUIRED',
        'PRODUCTION_EVIDENCE_REQUIRED',
        'PRODUCTION_EVIDENCE_REQUIRED',
        'PRODUCTION_EVIDENCE_REQUIRED',
      ],
      ids: [
        'release-gate:tmux-status-marker',
        'release-gate:progress-release-timestamp',
        'release-gate:agents-release-gates-row',
        'release-gate:verify-release-failure-reason',
      ],
    },
  ]);
  assert.deepEqual(observedMatrix, [
    {
      scenario: 'denied-source-identity-drift',
      expectedCode: 'SAME_SOURCE_IDENTITY_REQUIRED',
      expectedAllowed: false,
      expectedFinalGates: '19/20',
      expectedMarker: deniedMarker,
    },
    {
      scenario: 'allowed-final-evidence-without-provenance',
      exitCode: 1,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      releaseAllowed: true,
      finalGates: '20/20',
      summaryAllowed: true,
      summaryMissingEvidence: 0,
      marker: releaseReadyMarker,
      mutationAttempted: false,
    },
  ]);
});
