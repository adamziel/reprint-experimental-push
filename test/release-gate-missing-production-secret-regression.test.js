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
const partialSecretValue = 'RPP_0067_SHOULD_NOT_LEAK';
const expectedSecretReason = 'A live source URL is present but production credentials or an auth session source command are missing.';
const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_SECRET_REQUIRED]';

const expectedSecretEvidence = Object.freeze({
  required: [
    'REPRINT_PUSH_USERNAME + REPRINT_PUSH_APPLICATION_PASSWORD',
    'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
  ],
  observed: 'missing-production-credentials',
  sourceUrl,
  scope: 'final-release',
});

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function completeFinalEvidenceWithoutSecret() {
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, observed: 'bound-to-source-url', scope },
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
    agentsReleaseGateStatusRow: { ok: true, present: true, state: scope, scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
  };
}

function missingProductionSecretFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'missing-production-secret-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_APPLICATION_PASSWORD: partialSecretValue,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
    },
    expectedMissingSecret: {
      expectedCode: 'REPRINT_PUSH_SECRET_REQUIRED',
      expectedMarker,
      mutationAttempted: false,
      releaseStatus: 'NO-GO',
    },
    evidence: completeFinalEvidenceWithoutSecret(),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-missing-production-secret-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand() {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(missingProductionSecretFixture()),
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

function assertPartialSecretRedacted(result, report) {
  assert.doesNotMatch(result.stdout, new RegExp(partialSecretValue));
  assert.doesNotMatch(result.stderr, new RegExp(partialSecretValue));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(partialSecretValue));
}

test('missing production secret regression fails closed before mutation for RPP-0067', () => {
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_SECRET_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final held status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertPartialSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'production-secret'), {
    id: 'production-secret',
    rpp: 'RPP-0007',
    title: 'Missing production secret gate',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'REPRINT_PUSH_SECRET_REQUIRED',
    reason: expectedSecretReason,
    evidence: expectedSecretEvidence,
  });
  assert.equal(gateById(report, 'source-url').status, 'passed');
  assert.equal(gateById(report, 'local-url').status, 'passed');
  assert.equal(gateById(report, 'remote-changed-url').status, 'passed');

  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: expectedSecretReason,
    missingEvidence: [
      {
        id: 'production-secret',
        rpp: 'RPP-0007',
        status: 'failed',
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
        reason: expectedSecretReason,
        evidence: expectedSecretEvidence,
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
          id: 'production-secret',
          rpp: 'RPP-0007',
          title: 'Missing production secret gate',
          status: 'failed',
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
          reason: expectedSecretReason,
          required: expectedSecretEvidence.required,
          observed: 'missing-production-credentials',
          scope: 'final-release',
        },
      ],
    },
  ]);
});

test('missing production secret evidence stays NO-GO and redacted for RPP-0067', () => {
  const fixture = missingProductionSecretFixture();
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(fixture.expectedMissingSecret.expectedCode, 'REPRINT_PUSH_SECRET_REQUIRED');
  assert.equal(fixture.expectedMissingSecret.expectedMarker, expectedMarker);
  assert.equal(fixture.expectedMissingSecret.releaseStatus, 'NO-GO');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseEvidenceProvenance.required, false);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.releaseEvidenceProvenance.requiredEvidenceIds, []);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assertPartialSecretRedacted(result, report);
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['production-secret']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});
