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
const secretValue = 'RPP_0061_SHOULD_NOT_LEAK';
const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]';
const expectedMissingSourceEvidence = {
  required: 'REPRINT_PUSH_SOURCE_URL',
  observed: 'missing-live-source',
  envKey: 'REPRINT_PUSH_SOURCE_URL',
  scope: 'missing',
};
const expectedMutationPolicy = {
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
};

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

function generatedFixture() {
  return {
    scope: 'final-release',
    fixtureKind: 'missing-source-url-gate-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedMissingSourceGate: {
      command: 'node scripts/release/check-release-gates.mjs --evidence-file <fixture> --scope final-release --now 2026-05-28T00:00:00.000Z',
      exitCode: 1,
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      marker: expectedMarker,
      releaseStatus: 'NO-GO',
      mutationAttempted: false,
      redactedSecret: secretValue,
    },
    evidence: completeFinalEvidence(),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-source-url-gate-regression-'));
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

test('missing REPRINT_PUSH_SOURCE_URL checked command fails closed without mutation for RPP-0061', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'source-url');
  const topologyBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'topology');

  assert.equal(fixture.expectedMissingSourceGate.code, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.signal, null);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.status, 'held');
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the missing-source status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(gate, {
    id: 'source-url',
    rpp: 'RPP-0001',
    title: 'REPRINT_PUSH_SOURCE_URL gate',
    category: 'topology',
    status: 'missing',
    blocking: true,
    code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    reason: 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.',
    evidence: expectedMissingSourceEvidence,
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.',
    missingEvidence: [
      {
        id: 'source-url',
        rpp: 'RPP-0001',
        status: 'missing',
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        reason: 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.',
        evidence: expectedMissingSourceEvidence,
      },
    ],
  });
  assert.deepEqual(topologyBucket, {
    bucket: 'topology',
    gateCount: 1,
    gates: [
      {
        bucket: 'topology',
        id: 'source-url',
        rpp: 'RPP-0001',
        title: 'REPRINT_PUSH_SOURCE_URL gate',
        status: 'missing',
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        reason: 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.',
        required: 'REPRINT_PUSH_SOURCE_URL',
        observed: 'missing-live-source',
        envKey: 'REPRINT_PUSH_SOURCE_URL',
        scope: 'missing',
      },
    ],
  });
});

test('missing source URL evidence remains NO-GO and redacts production secrets for RPP-0061', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const serializedReport = JSON.stringify(report);

  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseEvidenceProvenance.required, false);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.mutationAttempted, false);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue));
  assert.doesNotMatch(result.stderr, new RegExp(secretValue));
  assert.doesNotMatch(serializedReport, new RegExp(secretValue));
  assert.equal(report.evaluation.gates.filter((entry) => entry.status === 'missing').length, 1);
  assert.deepEqual(report.evaluation.gates
    .filter((entry) => entry.status === 'missing')
    .map((entry) => [entry.id, entry.code, entry.evidence]), [
      ['source-url', 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED', expectedMissingSourceEvidence],
    ]);
});
