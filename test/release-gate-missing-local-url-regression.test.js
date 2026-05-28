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
const remoteChangedUrl = 'https://changed.example.test/push';
const secretValue = 'RPP_0062_SHOULD_NOT_LEAK';
const expectedLocalReason = 'REPRINT_PUSH_LOCAL_URL is required to prove the local edited site boundary.';
const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_LOCAL_URL_REQUIRED]';

const expectedLocalEvidence = Object.freeze({
  required: 'REPRINT_PUSH_LOCAL_URL',
  observed: 'missing-local-edited-site',
  envKey: 'REPRINT_PUSH_LOCAL_URL',
  scope: 'missing',
});

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function completeFinalEvidence() {
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
    agentsReleaseGateStatusRow: { ok: true, present: true, state: scope, scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
  };
}

function missingLocalUrlFixture() {
  return {
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: '',
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    evidence: completeFinalEvidence(),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-missing-local-url-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

function runCheckedCommand() {
  const { file } = writeFixture(missingLocalUrlFixture());
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    file,
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

test('missing REPRINT_PUSH_LOCAL_URL checked command fails closed without mutation for RPP-0062', () => {
  const result = runCheckedCommand();
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LOCAL_URL_REQUIRED');
  assert.equal(report.statusMarker, expectedMarker);
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);

  assert.deepEqual(gateById(report, 'local-url'), {
    id: 'local-url',
    rpp: 'RPP-0002',
    title: 'REPRINT_PUSH_LOCAL_URL gate',
    category: 'topology',
    status: 'missing',
    blocking: true,
    code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
    reason: expectedLocalReason,
    evidence: expectedLocalEvidence,
  });
  assert.equal(gateById(report, 'source-url').status, 'passed');
  assert.equal(gateById(report, 'remote-changed-url').status, 'passed');

  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: expectedLocalReason,
    missingEvidence: [
      {
        id: 'local-url',
        rpp: 'RPP-0002',
        status: 'missing',
        code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
        reason: expectedLocalReason,
        evidence: expectedLocalEvidence,
      },
    ],
  });
  assert.deepEqual(report.missingProductionEvidenceBuckets, [
    {
      bucket: 'topology',
      gateCount: 1,
      gates: [
        {
          bucket: 'topology',
          id: 'local-url',
          rpp: 'RPP-0002',
          title: 'REPRINT_PUSH_LOCAL_URL gate',
          status: 'missing',
          code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
          reason: expectedLocalReason,
          required: 'REPRINT_PUSH_LOCAL_URL',
          observed: 'missing-local-edited-site',
          envKey: 'REPRINT_PUSH_LOCAL_URL',
          scope: 'missing',
        },
      ],
    },
  ]);
});

test('missing local URL evidence remains NO-GO and redacts production secrets for RPP-0062', () => {
  const result = runCheckedCommand();
  const report = parseReport(result);
  const serializedReport = JSON.stringify(report);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseEvidenceProvenance.required, false);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.releaseEvidenceProvenance.requiredEvidenceIds, []);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue));
  assert.doesNotMatch(result.stderr, new RegExp(secretValue));
  assert.doesNotMatch(serializedReport, new RegExp(secretValue));
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['local-url']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});
