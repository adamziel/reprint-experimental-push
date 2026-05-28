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
const wrongRemoteAliasUrl = 'https://wrong.example.test/push/';

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

function generatedWrongRemoteAliasFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'wrong-REPRINT_PUSH_REMOTE_URL-alias-with-all-other-final-evidence',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_REMOTE_URL: wrongRemoteAliasUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
    },
    evidence: completeFinalEvidence(),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrong-remote-alias-gate-coverage-'));
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

test('generated wrong REPRINT_PUSH_REMOTE_URL alias fixture fails closed before mutation for RPP-0045', () => {
  const fixture = generatedWrongRemoteAliasFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const topologyBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'topology');
  const remoteAliasGate = report.evaluation.gates.find((gate) => gate.id === 'remote-alias');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_SOURCE_URL_MISMATCH]';

  assert.equal(fixture.env.REPRINT_PUSH_REMOTE_URL, wrongRemoteAliasUrl);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_SOURCE_URL_MISMATCH');
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
    reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
    missingEvidence: [
      {
        id: 'remote-alias',
        rpp: 'RPP-0005',
        status: 'failed',
        code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
        evidence: {
          required: sourceUrl,
          observed: wrongRemoteAliasUrl,
          envKey: 'REPRINT_PUSH_REMOTE_URL',
          sourceEnvKey: 'REPRINT_PUSH_SOURCE_URL',
          scope: 'final-release',
        },
      },
    ],
  });
  assert.deepEqual(topologyBucket, {
    bucket: 'topology',
    gateCount: 1,
    gates: [
      {
        bucket: 'topology',
        id: 'remote-alias',
        rpp: 'RPP-0005',
        title: 'Wrong remote alias rejection',
        status: 'failed',
        code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
        required: sourceUrl,
        observed: wrongRemoteAliasUrl,
        envKey: 'REPRINT_PUSH_REMOTE_URL',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(remoteAliasGate, {
    id: 'remote-alias',
    rpp: 'RPP-0005',
    title: 'Wrong remote alias rejection',
    category: 'topology',
    status: 'failed',
    blocking: true,
    code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
    reason: 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.',
    evidence: {
      required: sourceUrl,
      observed: wrongRemoteAliasUrl,
      envKey: 'REPRINT_PUSH_REMOTE_URL',
      sourceEnvKey: 'REPRINT_PUSH_SOURCE_URL',
      scope: 'final-release',
    },
  });
});
