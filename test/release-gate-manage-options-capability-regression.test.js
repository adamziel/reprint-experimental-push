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
const checkedUser = 'editor';
const secretValue = 'RPP_0069_SHOULD_NOT_LEAK';
const capabilityReason = 'The checked production user does not prove manage_options capability.';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=MANAGE_OPTIONS_CAPABILITY_REQUIRED]';
const readyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

const expectedFailedCapabilityEvidence = Object.freeze({
  ok: false,
  hasManageOptions: false,
  observed: 'subscriber',
  checkedUser,
  requiredCapability: 'manage_options',
  checkedRoute: '/wp/v2/settings',
  command: 'wp user get editor --field=roles && wp cap list editor',
  scope: 'final-release',
  required: ['authenticated user has manage_options on checked route'],
});

const expectedPassedCapabilityEvidence = Object.freeze({
  ok: true,
  hasManageOptions: true,
  observed: 'manage_options',
  checkedUser: 'admin',
  requiredCapability: 'manage_options',
  checkedRoute: '/wp/v2/settings',
  command: 'wp user get admin --field=roles && wp cap list admin',
  scope: 'final-release',
  required: ['authenticated user has manage_options on checked route'],
  requiredScope: 'final-release',
});

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function manageOptionsPassedEvidence() {
  return {
    ok: true,
    hasManageOptions: true,
    observed: 'manage_options',
    checkedUser: 'admin',
    requiredCapability: 'manage_options',
    checkedRoute: '/wp/v2/settings',
    command: 'wp user get admin --field=roles && wp cap list admin',
    scope: 'final-release',
  };
}

function manageOptionsDeniedEvidence() {
  return {
    ok: false,
    hasManageOptions: false,
    observed: 'subscriber',
    checkedUser,
    requiredCapability: 'manage_options',
    checkedRoute: '/wp/v2/settings',
    command: 'wp user get editor --field=roles && wp cap list editor',
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: manageOptionsPassedEvidence(),
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
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
    agentsReleaseGateStatusRow: { ok: true, present: true, state: scope, scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
    ...overrides,
  };
}

function generatedFixture(evidenceOverrides = {}) {
  return {
    scope: 'final-release',
    fixtureKind: 'manage-options-capability-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedManageOptionsCapability: {
      expectedCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
      expectedMarker: heldMarker,
      mutationAttempted: false,
      releaseStatus: 'NO-GO',
      requiredCapability: 'manage_options',
    },
    evidence: completeFinalEvidence(evidenceOverrides),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-manage-options-capability-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(payload) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(payload),
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

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function assertSecretRedacted(result, report) {
  assert.doesNotMatch(result.stdout, new RegExp(secretValue));
  assert.doesNotMatch(result.stderr, new RegExp(secretValue));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secretValue));
}

test('manage_options capability variant-2 scenario matrix records negative and positive paths for RPP-0029', () => {
  const scenarios = [
    {
      name: 'negative-subscriber-without-manage-options',
      evidence: manageOptionsDeniedEvidence(),
      expectedGateStatus: 'failed',
      expectedCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
      expectedBucket: 'auth',
      expectedMarker: heldMarker,
      expectedReleaseAllowed: false,
      expectedFinalGates: '19/20',
      expectedObserved: 'subscriber',
      expectedUser: 'editor',
      expectedCapability: false,
    },
    {
      name: 'positive-admin-with-manage-options',
      evidence: manageOptionsPassedEvidence(),
      expectedGateStatus: 'passed',
      expectedCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      expectedBucket: 'provenance',
      expectedMarker: readyMarker,
      expectedReleaseAllowed: true,
      expectedFinalGates: '20/20',
      expectedObserved: 'manage_options',
      expectedUser: 'admin',
      expectedCapability: true,
    },
  ];
  const matrix = [];

  for (const scenario of scenarios) {
    const fixture = generatedFixture({
      manageOptionsCapability: scenario.evidence,
    });
    const result = runCheckedCommand(fixture);
    const report = parseReport(result);
    const gate = gateById(report, 'manage-options-capability');

    assert.equal(result.status, 1, scenario.name);
    assert.equal(report.releaseStatus, 'NO-GO', scenario.name);
    assert.equal(report.primaryFailureBucket, scenario.expectedBucket, scenario.name);
    assert.equal(report.primaryFailureCode, scenario.expectedCode, scenario.name);
    assert.equal(report.statusMarker, scenario.expectedMarker, scenario.name);
    assert.ok(result.stdout.includes(scenario.expectedMarker), scenario.name);
    assert.equal(report.releaseMovement.allowed, scenario.expectedReleaseAllowed, scenario.name);
    assert.equal(report.releaseMovement.finalGates, scenario.expectedFinalGates, scenario.name);
    assert.equal(report.mutationAttempted, false, scenario.name);
    assert.deepEqual(report.mutationPolicy, expectedMutationPolicy, scenario.name);
    assertSecretRedacted(result, report);

    matrix.push({
      scenario: scenario.name,
      gateStatus: gate.status,
      gateCode: gate.code,
      checkedUser: gate.evidence.checkedUser,
      observed: gate.evidence.observed,
      hasManageOptions: gate.evidence.hasManageOptions,
      finalGates: report.releaseMovement.finalGates,
      releaseAllowed: report.releaseMovement.allowed,
      primaryFailureCode: report.primaryFailureCode,
      mutationAttempted: report.mutationAttempted,
    });
  }

  assert.deepEqual(matrix, [
    {
      scenario: 'negative-subscriber-without-manage-options',
      gateStatus: 'failed',
      gateCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
      checkedUser: 'editor',
      observed: 'subscriber',
      hasManageOptions: false,
      finalGates: '19/20',
      releaseAllowed: false,
      primaryFailureCode: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
      mutationAttempted: false,
    },
    {
      scenario: 'positive-admin-with-manage-options',
      gateStatus: 'passed',
      gateCode: 'OK',
      checkedUser: 'admin',
      observed: 'manage_options',
      hasManageOptions: true,
      finalGates: '20/20',
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
    },
  ]);
});

test('manage_options capability regression fails closed before mutation for RPP-0069', () => {
  const fixture = generatedFixture({ manageOptionsCapability: manageOptionsDeniedEvidence() });
  const result = runCheckedCommand(fixture);
  const report = parseReport(result);

  assert.equal(fixture.expectedManageOptionsCapability.expectedCode, 'MANAGE_OPTIONS_CAPABILITY_REQUIRED');
  assert.equal(fixture.expectedManageOptionsCapability.expectedMarker, heldMarker);
  assert.equal(fixture.expectedManageOptionsCapability.releaseStatus, 'NO-GO');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'MANAGE_OPTIONS_CAPABILITY_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the final held status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'manage-options-capability'), {
    id: 'manage-options-capability',
    rpp: 'RPP-0009',
    title: 'manage_options capability proof',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
    reason: capabilityReason,
    evidence: expectedFailedCapabilityEvidence,
  });
  assert.equal(gateById(report, 'production-secret').status, 'passed');
  assert.equal(gateById(report, 'application-password-binding').status, 'passed');

  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: capabilityReason,
    missingEvidence: [
      {
        id: 'manage-options-capability',
        rpp: 'RPP-0009',
        status: 'failed',
        code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        reason: capabilityReason,
        evidence: expectedFailedCapabilityEvidence,
      },
    ],
  });
  assert.deepEqual(report.missingProductionEvidenceBuckets, [
    {
      bucket: 'auth',
      gateCount: 1,
      gates: [
        {
          bucket: 'auth',
          id: 'manage-options-capability',
          rpp: 'RPP-0009',
          title: 'manage_options capability proof',
          status: 'failed',
          code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
          reason: capabilityReason,
          required: ['authenticated user has manage_options on checked route'],
          observed: 'subscriber',
          scope: 'final-release',
        },
      ],
    },
  ]);
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['manage-options-capability']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});

test('positive manage_options proof passes the gate while release remains NO-GO without provenance for RPP-0069', () => {
  const result = runCheckedCommand(generatedFixture());
  const report = parseReport(result);
  const gate = gateById(report, 'manage-options-capability');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, readyMarker);
  assert.ok(result.stdout.includes(readyMarker), 'stdout JSON must expose the final release-ready gate marker');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, false);
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);
  assert.deepEqual(gate, {
    id: 'manage-options-capability',
    rpp: 'RPP-0009',
    title: 'manage_options capability proof',
    category: 'auth',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'manage_options capability proof is backed by final release evidence.',
    evidence: expectedPassedCapabilityEvidence,
  });
});
