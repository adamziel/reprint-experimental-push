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
const requiredProductionSecretEvidence = [
  'REPRINT_PUSH_USERNAME + REPRINT_PUSH_APPLICATION_PASSWORD',
  'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
];

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

function generatedMissingProductionSecretFixture() {
  const evidence = completeFinalEvidence();
  delete evidence.productionSecret;
  return {
    scope: 'final-release',
    fixtureKind: 'missing-production-secret-with-all-other-final-evidence',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    },
    omittedEnvKeys: [
      'REPRINT_PUSH_USERNAME',
      'REPRINT_PUSH_APPLICATION_PASSWORD',
      'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
    ],
    omittedEvidenceKey: 'productionSecret',
    evidence,
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-production-secret-gate-coverage-'));
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

test('generated missing production secret fixture fails closed before mutation for RPP-0047', () => {
  const fixture = generatedMissingProductionSecretFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');
  const secretGate = report.evaluation.gates.find((gate) => gate.id === 'production-secret');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_SECRET_REQUIRED]';

  assert.equal(fixture.env.REPRINT_PUSH_USERNAME, undefined);
  assert.equal(fixture.env.REPRINT_PUSH_APPLICATION_PASSWORD, undefined);
  assert.equal(fixture.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND, undefined);
  assert.equal(fixture.evidence.productionSecret, undefined);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_SECRET_REQUIRED');
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
    reason: 'A live source URL is present but production credentials or an auth session source command are missing.',
    missingEvidence: [
      {
        id: 'production-secret',
        rpp: 'RPP-0007',
        status: 'failed',
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
        reason: 'A live source URL is present but production credentials or an auth session source command are missing.',
        evidence: {
          required: requiredProductionSecretEvidence,
          observed: 'missing-production-credentials',
          sourceUrl,
          scope: 'final-release',
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
        id: 'production-secret',
        rpp: 'RPP-0007',
        title: 'Missing production secret gate',
        status: 'failed',
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
        reason: 'A live source URL is present but production credentials or an auth session source command are missing.',
        required: requiredProductionSecretEvidence,
        observed: 'missing-production-credentials',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(secretGate, {
    id: 'production-secret',
    rpp: 'RPP-0007',
    title: 'Missing production secret gate',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'REPRINT_PUSH_SECRET_REQUIRED',
    reason: 'A live source URL is present but production credentials or an auth session source command are missing.',
    evidence: {
      required: requiredProductionSecretEvidence,
      observed: 'missing-production-credentials',
      sourceUrl,
      scope: 'final-release',
    },
  });
});
