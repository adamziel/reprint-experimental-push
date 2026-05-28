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
const credentialSourceUrl = 'https://forged.example.test/push';
const checkedUser = 'admin';
const credentialUser = 'editor';
const secretValue = 'RPP_0068_SHOULD_NOT_LEAK';
const bindingReason = 'Application Password credential binding drifted from the checked source identity.';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLICATION_PASSWORD_BINDING_REQUIRED]';

const expectedBindingEvidence = Object.freeze({
  ok: false,
  bound: false,
  sameSource: false,
  sameUser: false,
  observed: 'credential-bound-to-other-source-user',
  credentialSourceUrl,
  checkedSourceUrl: sourceUrl,
  credentialUser,
  checkedUser,
  bindingId: 'rpp-0068-binding-fixture',
  scope: 'final-release',
  required: ['Application Password bound to checked source identity'],
});

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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, sameUser: true, observed: 'bound-to-source-url-user', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
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

function bindingDriftEvidence() {
  return {
    ok: false,
    bound: false,
    sameSource: false,
    sameUser: false,
    observed: 'credential-bound-to-other-source-user',
    credentialSourceUrl,
    checkedSourceUrl: sourceUrl,
    credentialUser,
    checkedUser,
    bindingId: 'rpp-0068-binding-fixture',
    scope: 'final-release',
  };
}

function bindingDriftFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'application-password-credential-binding-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedApplicationPasswordBinding: {
      expectedCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
      expectedMarker: heldMarker,
      mutationAttempted: false,
      releaseStatus: 'NO-GO',
      checkedSourceUrl: sourceUrl,
      credentialSourceUrl,
      checkedUser,
      credentialUser,
    },
    evidence: completeFinalEvidence({
      applicationPasswordCredentialBinding: bindingDriftEvidence(),
    }),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-application-password-binding-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand() {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(bindingDriftFixture()),
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

test('Application Password binding drift regression fails closed before mutation for RPP-0068', () => {
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the final held status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'application-password-binding'), {
    id: 'application-password-binding',
    rpp: 'RPP-0008',
    title: 'Application Password credential binding',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
    reason: bindingReason,
    evidence: expectedBindingEvidence,
  });
  assert.equal(gateById(report, 'production-secret').status, 'passed');
  assert.equal(gateById(report, 'auth-source-readback').status, 'passed');

  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: bindingReason,
    missingEvidence: [
      {
        id: 'application-password-binding',
        rpp: 'RPP-0008',
        status: 'failed',
        code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        reason: bindingReason,
        evidence: expectedBindingEvidence,
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
          id: 'application-password-binding',
          rpp: 'RPP-0008',
          title: 'Application Password credential binding',
          status: 'failed',
          code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
          reason: bindingReason,
          required: ['Application Password bound to checked source identity'],
          observed: 'credential-bound-to-other-source-user',
          scope: 'final-release',
        },
      ],
    },
  ]);
});

test('Application Password binding evidence remains NO-GO and redacted for RPP-0068', () => {
  const fixture = bindingDriftFixture();
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(fixture.expectedApplicationPasswordBinding.expectedCode, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
  assert.equal(fixture.expectedApplicationPasswordBinding.expectedMarker, heldMarker);
  assert.equal(fixture.expectedApplicationPasswordBinding.releaseStatus, 'NO-GO');
  assert.equal(fixture.expectedApplicationPasswordBinding.checkedSourceUrl, sourceUrl);
  assert.equal(fixture.expectedApplicationPasswordBinding.credentialSourceUrl, credentialSourceUrl);
  assert.equal(fixture.expectedApplicationPasswordBinding.checkedUser, checkedUser);
  assert.equal(fixture.expectedApplicationPasswordBinding.credentialUser, credentialUser);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseEvidenceProvenance.required, false);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.releaseEvidenceProvenance.requiredEvidenceIds, []);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assertSecretRedacted(result, report);
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['application-password-binding']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});
