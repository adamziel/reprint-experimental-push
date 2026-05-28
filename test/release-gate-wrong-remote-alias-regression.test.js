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
const secretValue = 'RPP_0065_SHOULD_NOT_LEAK';
const aliasMismatchReason = 'REPRINT_PUSH_REMOTE_URL must match REPRINT_PUSH_SOURCE_URL on the checked release path.';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_SOURCE_URL_MISMATCH]';
const readyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

const expectedMismatchEvidence = Object.freeze({
  required: sourceUrl,
  observed: wrongRemoteAliasUrl,
  envKey: 'REPRINT_PUSH_REMOTE_URL',
  sourceEnvKey: 'REPRINT_PUSH_SOURCE_URL',
  scope: 'final-release',
});

const expectedAcceptedAliasEvidence = Object.freeze({
  required: 'REPRINT_PUSH_REMOTE_URL absent or same as REPRINT_PUSH_SOURCE_URL',
  observed: sourceUrl,
  sourceUrl,
  scope: 'final-release',
  requiredScope: 'final-release',
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

function generatedFixture(remoteAliasUrl) {
  return {
    scope: 'final-release',
    fixtureKind: 'wrong-remote-alias-rejection-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_REMOTE_URL: remoteAliasUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedScenarioMatrix: {
      negative: {
        remoteAliasUrl: wrongRemoteAliasUrl,
        expectedCode: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        expectedMarker: heldMarker,
        mutationAttempted: false,
        releaseStatus: 'NO-GO',
      },
      positive: {
        remoteAliasUrl: sourceUrl,
        expectedMarker: readyMarker,
        mutationAttempted: false,
        releaseStatus: 'NO-GO',
      },
    },
    evidence: completeFinalEvidence(),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-wrong-remote-alias-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(fixture) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(fixture),
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

test('wrong remote alias regression emits a final held marker before mutation for RPP-0065', () => {
  const fixture = generatedFixture(wrongRemoteAliasUrl);
  const result = runCheckedCommand(fixture);
  const report = parseReport(result);
  const topologyBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'topology');

  assert.equal(fixture.expectedScenarioMatrix.negative.expectedCode, 'REPRINT_PUSH_SOURCE_URL_MISMATCH');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_SOURCE_URL_MISMATCH');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the final bracketed status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'remote-alias'), {
    id: 'remote-alias',
    rpp: 'RPP-0005',
    title: 'Wrong remote alias rejection',
    category: 'topology',
    status: 'failed',
    blocking: true,
    code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
    reason: aliasMismatchReason,
    evidence: expectedMismatchEvidence,
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: aliasMismatchReason,
    missingEvidence: [
      {
        id: 'remote-alias',
        rpp: 'RPP-0005',
        status: 'failed',
        code: 'REPRINT_PUSH_SOURCE_URL_MISMATCH',
        reason: aliasMismatchReason,
        evidence: expectedMismatchEvidence,
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
        reason: aliasMismatchReason,
        required: sourceUrl,
        observed: wrongRemoteAliasUrl,
        envKey: 'REPRINT_PUSH_REMOTE_URL',
        scope: 'final-release',
      },
    ],
  });
});

test('matching remote alias passes the gate while release remains NO-GO for RPP-0065', () => {
  const fixture = generatedFixture(sourceUrl);
  const result = runCheckedCommand(fixture);
  const report = parseReport(result);
  const gate = gateById(report, 'remote-alias');

  assert.equal(fixture.expectedScenarioMatrix.positive.remoteAliasUrl, sourceUrl);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, readyMarker);
  assert.ok(result.stdout.includes(readyMarker), 'stdout JSON must expose the accepted-alias final marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gate, {
    id: 'remote-alias',
    rpp: 'RPP-0005',
    title: 'Wrong remote alias rejection',
    category: 'topology',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Wrong remote alias rejection is backed by final release evidence.',
    evidence: expectedAcceptedAliasEvidence,
  });
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, false);
  assert.equal(report.missingProductionEvidenceBuckets.some((bucket) => bucket.bucket === 'topology'), false);
});
