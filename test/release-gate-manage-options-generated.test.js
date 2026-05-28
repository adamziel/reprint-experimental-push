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
const checkedUser = 'release-operator';
const checkedRoute = '/wp-json/reprint-push/v1/preflight';
const requiredManageOptionsEvidence = ['authenticated user has manage_options on checked route'];

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
      observed: 'bound-to-source-url',
      checkedUser,
      scope,
    },
    manageOptionsCapability: manageOptionsPassEvidence(),
    sourceIdentity: { ok: true, same: true, observed: 'same-source-url', scope },
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

function manageOptionsPassEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    hasManageOptions: true,
    observed: 'manage_options',
    checkedUser,
    route: checkedRoute,
    method: 'GET',
    expectedCapability: 'manage_options',
    capabilities: { manage_options: true },
    scope,
    ...overrides,
  };
}

function manageOptionsDeniedEvidence() {
  return manageOptionsPassEvidence({
    ok: false,
    hasManageOptions: false,
    observed: 'subscriber-without-manage_options',
    capabilities: { manage_options: false },
  });
}

function generatedFixture(overrides = {}) {
  return {
    scope: 'final-release',
    fixtureKind: 'manage-options-capability-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: 'fixture-only-application-password',
    },
    expectedCapability: {
      user: checkedUser,
      route: checkedRoute,
      capability: 'manage_options',
    },
    evidence: completeFinalEvidence(overrides),
  };
}

function generatedMissingFixture() {
  const fixture = generatedFixture();
  delete fixture.evidence.manageOptionsCapability;
  fixture.fixtureKind = 'manage-options-capability-missing-generated';
  fixture.omittedEvidenceKey = 'manageOptionsCapability';
  return fixture;
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manage-options-gate-coverage-'));
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

test('generated manage_options fixture passes when the checked user has capability for RPP-0049', () => {
  const result = runCheckedCommand(writeEvidence(generatedFixture()));
  const report = parseReport(result);
  const gate = gateById(report, 'manage-options-capability');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    ok: true,
    hasManageOptions: true,
    observed: 'manage_options',
    checkedUser,
    route: checkedRoute,
    method: 'GET',
    expectedCapability: 'manage_options',
    capabilities: { manage_options: true },
    scope: 'final-release',
    required: requiredManageOptionsEvidence,
    requiredScope: 'final-release',
  });
});

test('generated manage_options denial fails closed before mutation for RPP-0049', () => {
  const fixture = generatedFixture({ manageOptionsCapability: manageOptionsDeniedEvidence() });
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');
  const gate = gateById(report, 'manage-options-capability');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=MANAGE_OPTIONS_CAPABILITY_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    hasManageOptions: false,
    observed: 'subscriber-without-manage_options',
    checkedUser,
    route: checkedRoute,
    method: 'GET',
    expectedCapability: 'manage_options',
    capabilities: { manage_options: false },
    scope: 'final-release',
    required: requiredManageOptionsEvidence,
  };

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'MANAGE_OPTIONS_CAPABILITY_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final bracketed marker');
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
    reason: 'The checked production user does not prove manage_options capability.',
    missingEvidence: [
      {
        id: 'manage-options-capability',
        rpp: 'RPP-0009',
        status: 'failed',
        code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        reason: 'The checked production user does not prove manage_options capability.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(authBucket, {
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
        reason: 'The checked production user does not prove manage_options capability.',
        required: requiredManageOptionsEvidence,
        observed: 'subscriber-without-manage_options',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'manage-options-capability',
    rpp: 'RPP-0009',
    title: 'manage_options capability proof',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
    reason: 'The checked production user does not prove manage_options capability.',
    evidence: expectedEvidence,
  });
});

test('generated missing manage_options evidence fails closed before mutation for RPP-0049', () => {
  const fixture = generatedMissingFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');
  const gate = gateById(report, 'manage-options-capability');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=MANAGE_OPTIONS_CAPABILITY_REQUIRED]';
  const expectedEvidence = {
    required: requiredManageOptionsEvidence,
    observed: 'missing-evidence',
    evidenceKey: 'manageOptionsCapability',
    scope: 'missing',
  };

  assert.equal(fixture.evidence.manageOptionsCapability, undefined);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'MANAGE_OPTIONS_CAPABILITY_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'manage_options capability proof is required for the checked production user.',
    missingEvidence: [
      {
        id: 'manage-options-capability',
        rpp: 'RPP-0009',
        status: 'missing',
        code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        reason: 'manage_options capability proof is required for the checked production user.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(authBucket, {
    bucket: 'auth',
    gateCount: 1,
    gates: [
      {
        bucket: 'auth',
        id: 'manage-options-capability',
        rpp: 'RPP-0009',
        title: 'manage_options capability proof',
        status: 'missing',
        code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
        reason: 'manage_options capability proof is required for the checked production user.',
        required: requiredManageOptionsEvidence,
        observed: 'missing-evidence',
        evidenceKey: 'manageOptionsCapability',
        scope: 'missing',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'manage-options-capability',
    rpp: 'RPP-0009',
    title: 'manage_options capability proof',
    category: 'auth',
    status: 'missing',
    blocking: true,
    code: 'MANAGE_OPTIONS_CAPABILITY_REQUIRED',
    reason: 'manage_options capability proof is required for the checked production user.',
    evidence: expectedEvidence,
  });
});
