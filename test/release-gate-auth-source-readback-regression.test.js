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
const driftedReadbackUrl = 'https://forged.example.test/push';
const secretValue = 'RPP_0066_SHOULD_NOT_LEAK';
const authReadbackReason = 'Auth source command readback drifted from the checked live source URL.';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED]';

const expectedDriftEvidence = Object.freeze({
  required: sourceUrl,
  observed: driftedReadbackUrl,
  issuedSourceUrl: sourceUrl,
  readbackSourceUrl: driftedReadbackUrl,
  scope: 'final-release',
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
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

function authReadbackDriftEvidence() {
  return {
    ok: false,
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: driftedReadbackUrl,
    command: 'node ./scripts/playground/auth-session-source-command.js',
    scope: 'final-release',
  };
}

function generatedFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'auth-source-command-readback-drift-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedAuthReadback: {
      command: 'node ./scripts/playground/auth-session-source-command.js',
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: driftedReadbackUrl,
      expectedCode: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      expectedMarker: heldMarker,
      mutationAttempted: false,
      releaseStatus: 'NO-GO',
    },
    evidence: completeFinalEvidence({
      authSourceCommandReadback: authReadbackDriftEvidence(),
    }),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-auth-readback-drift-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand() {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(generatedFixture()),
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

test('auth source command readback drift regression fails closed before mutation for RPP-0066', () => {
  const result = runCheckedCommand();
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the final held status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'auth-source-readback'), {
    id: 'auth-source-readback',
    rpp: 'RPP-0006',
    title: 'Auth source command readback drift',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
    reason: authReadbackReason,
    evidence: expectedDriftEvidence,
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: authReadbackReason,
    missingEvidence: [
      {
        id: 'auth-source-readback',
        rpp: 'RPP-0006',
        status: 'failed',
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        reason: authReadbackReason,
        evidence: expectedDriftEvidence,
      },
    ],
  });
  assert.deepEqual(authBucket, {
    bucket: 'auth',
    gateCount: 1,
    gates: [
      {
        bucket: 'auth',
        id: 'auth-source-readback',
        rpp: 'RPP-0006',
        title: 'Auth source command readback drift',
        status: 'failed',
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        reason: authReadbackReason,
        required: sourceUrl,
        observed: driftedReadbackUrl,
        scope: 'final-release',
      },
    ],
  });
});

test('auth source readback drift evidence remains NO-GO and redacted for RPP-0066', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(fixture.expectedAuthReadback.command, 'node ./scripts/playground/auth-session-source-command.js');
  assert.equal(fixture.expectedAuthReadback.expectedCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(fixture.expectedAuthReadback.expectedMarker, heldMarker);
  assert.equal(fixture.expectedAuthReadback.releaseStatus, 'NO-GO');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseEvidenceProvenance.required, false);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.releaseEvidenceProvenance.requiredEvidenceIds, []);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assertSecretRedacted(result, report);
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['auth-source-readback']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});
