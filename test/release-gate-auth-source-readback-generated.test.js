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

function generatedAuthSourceReadbackDriftFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'auth-source-command-readback-drift-with-all-other-final-evidence',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
    },
    evidence: completeFinalEvidence({
      authSourceCommandReadback: {
        ok: false,
        issuedSourceUrl: sourceUrl,
        readbackSourceUrl: driftedReadbackUrl,
        command: 'node ./scripts/playground/auth-session-source-command.js',
        scope: 'final-release',
      },
    }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-source-readback-gate-coverage-'));
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

test('generated auth source command readback drift fixture fails closed before mutation for RPP-0046', () => {
  const fixture = generatedAuthSourceReadbackDriftFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const authBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'auth');
  const readbackGate = report.evaluation.gates.find((gate) => gate.id === 'auth-source-readback');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED]';

  assert.equal(fixture.evidence.authSourceCommandReadback.ok, false);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
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
    reason: 'Auth source command readback drifted from the checked live source URL.',
    missingEvidence: [
      {
        id: 'auth-source-readback',
        rpp: 'RPP-0006',
        status: 'failed',
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        reason: 'Auth source command readback drifted from the checked live source URL.',
        evidence: {
          required: sourceUrl,
          observed: driftedReadbackUrl,
          issuedSourceUrl: sourceUrl,
          readbackSourceUrl: driftedReadbackUrl,
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
        id: 'auth-source-readback',
        rpp: 'RPP-0006',
        title: 'Auth source command readback drift',
        status: 'failed',
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        reason: 'Auth source command readback drifted from the checked live source URL.',
        required: sourceUrl,
        observed: driftedReadbackUrl,
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(readbackGate, {
    id: 'auth-source-readback',
    rpp: 'RPP-0006',
    title: 'Auth source command readback drift',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
    reason: 'Auth source command readback drifted from the checked live source URL.',
    evidence: {
      required: sourceUrl,
      observed: driftedReadbackUrl,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: driftedReadbackUrl,
      scope: 'final-release',
    },
  });
});
