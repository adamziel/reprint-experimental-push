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

function runGate(args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, '--now', fixedNow, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      ...env,
    },
    encoding: 'utf8',
  });
}

function parseReport(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-gates-'));
  const filePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

function releaseEnv() {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    REPRINT_PUSH_USERNAME: 'admin',
    REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
  };
}

function completeEvidence(scope) {
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
      marker: scope === 'final-release'
        ? '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]'
        : '[release-gates:candidate-for-review final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
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

test('release gate CLI is wired as a local CI-style package script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['check:release-gates'], 'node ./scripts/release/check-release-gates.mjs');
});

test('release gate CLI fails closed with JSON and named missing evidence buckets', () => {
  const result = runGate();
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.status, 'held');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, false);

  const topology = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'topology');
  assert.ok(topology, 'topology bucket should be named');
  assert.deepEqual(
    topology.gates.slice(0, 3).map((gate) => [gate.id, gate.code, gate.envKey]),
    [
      ['source-url', 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED', 'REPRINT_PUSH_SOURCE_URL'],
      ['local-url', 'REPRINT_PUSH_LOCAL_URL_REQUIRED', 'REPRINT_PUSH_LOCAL_URL'],
      ['remote-changed-url', 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED', 'REPRINT_PUSH_REMOTE_CHANGED_URL'],
    ],
  );
  assert.match(report.statusMarker, /^\[release-gates-ci:held final=\d+\/20 candidate=\d+\/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED\]$/);
});

test('release gate CLI does not inflate complete local candidate evidence into release readiness', () => {
  const evidenceFile = writeEvidence({
    scope: 'local-candidate',
    evidence: completeEvidence('local-candidate'),
  });
  const result = runGate(['--evidence-file', evidenceFile, '--scope', 'local-candidate'], releaseEnv());
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.status, 'candidate-for-review');
  assert.equal(report.candidateMovement.allowed, true);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '0/20');
  assert.equal(report.releaseMovement.candidateGates, '20/20');
  assert.equal(report.missingProductionEvidenceBuckets.reduce((sum, bucket) => sum + bucket.gateCount, 0), 20);
  assert.ok(
    report.missingProductionEvidenceBuckets.every((bucket) => bucket.gates.every((gate) => gate.status === 'candidate')),
    'candidate gates must still be reported as missing production evidence',
  );
});

test('release gate CLI exits zero only when final release evidence satisfies every gate', () => {
  const evidenceFile = writeEvidence({
    scope: 'final-release',
    evidence: completeEvidence('final-release'),
  });
  const result = runGate(['--evidence-file', evidenceFile], releaseEnv());
  const report = parseReport(result);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.status, 'release-ready');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.gates, '20/20');
  assert.deepEqual(report.missingProductionEvidenceBuckets, []);
  assert.equal(report.primaryFailureCode, null);
});
