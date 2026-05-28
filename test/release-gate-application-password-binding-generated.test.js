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
const expectedUsername = 'release-operator';
const driftedUsername = 'other-operator';
const driftedSourceUrl = 'https://credential-drift.example.test/push';
const requiredApplicationPasswordEvidence = ['Application Password bound to checked source identity'];

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
    applicationPasswordCredentialBinding: matchingApplicationPasswordEvidence(),
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
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

function matchingApplicationPasswordEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    bound: true,
    sameSource: true,
    sameUser: true,
    observed: 'application-password-bound-to-checked-source-user',
    expectedSourceUrl: sourceUrl,
    credentialSourceUrl: sourceUrl,
    expectedUsername,
    credentialUsername: expectedUsername,
    applicationPasswordUuid: 'fixture-application-password-id',
    scope,
    ...overrides,
  };
}

function mismatchedApplicationPasswordEvidence() {
  return matchingApplicationPasswordEvidence({
    ok: false,
    bound: false,
    sameSource: false,
    sameUser: false,
    observed: 'credential-bound-to-other-source-user',
    expectedSourceUrl: sourceUrl,
    credentialSourceUrl: driftedSourceUrl,
    expectedUsername,
    credentialUsername: driftedUsername,
  });
}

function generatedFixture(applicationPasswordCredentialBinding) {
  return {
    scope: 'final-release',
    fixtureKind: 'application-password-binding-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: expectedUsername,
      REPRINT_PUSH_APPLICATION_PASSWORD: 'fixture-only-application-password',
    },
    expectedBinding: {
      sourceUrl,
      username: expectedUsername,
    },
    evidence: completeFinalEvidence({ applicationPasswordCredentialBinding }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'application-password-binding-gate-coverage-'));
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

test('generated Application Password binding fixture passes only when bound to the checked source and user for RPP-0048', () => {
  const fixture = generatedFixture(matchingApplicationPasswordEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'application-password-binding');

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
    bound: true,
    sameSource: true,
    sameUser: true,
    observed: 'application-password-bound-to-checked-source-user',
    expectedSourceUrl: sourceUrl,
    credentialSourceUrl: sourceUrl,
    expectedUsername,
    credentialUsername: expectedUsername,
    applicationPasswordUuid: 'fixture-application-password-id',
    scope: 'final-release',
    required: requiredApplicationPasswordEvidence,
    requiredScope: 'final-release',
  });
});

test('generated Application Password binding mismatch fails closed before mutation for RPP-0048', () => {
  const fixture = generatedFixture(mismatchedApplicationPasswordEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');
  const bindingGate = gateById(report, 'application-password-binding');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLICATION_PASSWORD_BINDING_REQUIRED]';

  assert.equal(fixture.env.REPRINT_PUSH_USERNAME, expectedUsername);
  assert.equal(fixture.env.REPRINT_PUSH_APPLICATION_PASSWORD, 'fixture-only-application-password');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
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
    reason: 'Application Password credential binding drifted from the checked source identity.',
    missingEvidence: [
      {
        id: 'application-password-binding',
        rpp: 'RPP-0008',
        status: 'failed',
        code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        reason: 'Application Password credential binding drifted from the checked source identity.',
        evidence: {
          ok: false,
          bound: false,
          sameSource: false,
          sameUser: false,
          observed: 'credential-bound-to-other-source-user',
          expectedSourceUrl: sourceUrl,
          credentialSourceUrl: driftedSourceUrl,
          expectedUsername,
          credentialUsername: driftedUsername,
          applicationPasswordUuid: 'fixture-application-password-id',
          scope: 'final-release',
          required: requiredApplicationPasswordEvidence,
        },
      },
    ],
  });
  assert.deepEqual(authBucket, {
    bucket: 'auth',
    gateCount: 1,
    gates: [
      {
        bucket: 'auth',
        id: 'application-password-binding',
        rpp: 'RPP-0008',
        title: 'Application Password credential binding',
        status: 'failed',
        code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        reason: 'Application Password credential binding drifted from the checked source identity.',
        required: requiredApplicationPasswordEvidence,
        observed: 'credential-bound-to-other-source-user',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(bindingGate, {
    id: 'application-password-binding',
    rpp: 'RPP-0008',
    title: 'Application Password credential binding',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
    reason: 'Application Password credential binding drifted from the checked source identity.',
    evidence: {
      ok: false,
      bound: false,
      sameSource: false,
      sameUser: false,
      observed: 'credential-bound-to-other-source-user',
      expectedSourceUrl: sourceUrl,
      credentialSourceUrl: driftedSourceUrl,
      expectedUsername,
      credentialUsername: driftedUsername,
      applicationPasswordUuid: 'fixture-application-password-id',
      scope: 'final-release',
      required: requiredApplicationPasswordEvidence,
    },
  });
});
