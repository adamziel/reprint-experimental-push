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
const expectedRoutePrefix = '/wp-json/reprint-push/v1';
const secretValue = 'RPP_0070_SHOULD_NOT_LEAK';
const sameSourceReason = 'Source URL identity drifted across the checked release path.';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=SAME_SOURCE_IDENTITY_REQUIRED]';
const readyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const requiredSameSourceEvidence = ['preflight, dry-run, apply, and recovery use the same source URL'];

const expectedDriftEvidence = Object.freeze({
  ok: false,
  same: false,
  sameSource: false,
  observed: 'recovery-inspect-used-remote-changed-source',
  expectedSourceUrl: sourceUrl,
  preflightSourceUrl: sourceUrl,
  dryRunSourceUrl: sourceUrl,
  applySourceUrl: sourceUrl,
  journalSourceUrl: sourceUrl,
  recoverySourceUrl: remoteChangedUrl,
  routePrefix: expectedRoutePrefix,
  checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
  scope: 'final-release',
  required: requiredSameSourceEvidence,
});

const expectedMatchingEvidence = Object.freeze({
  ok: true,
  same: true,
  sameSource: true,
  observed: 'same-source-url',
  expectedSourceUrl: sourceUrl,
  preflightSourceUrl: sourceUrl,
  dryRunSourceUrl: sourceUrl,
  applySourceUrl: sourceUrl,
  journalSourceUrl: sourceUrl,
  recoverySourceUrl: sourceUrl,
  routePrefix: expectedRoutePrefix,
  checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
  scope: 'final-release',
  required: requiredSameSourceEvidence,
  requiredScope: 'final-release',
});

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function matchingSourceIdentityEvidence() {
  return {
    ok: true,
    same: true,
    sameSource: true,
    observed: 'same-source-url',
    expectedSourceUrl: sourceUrl,
    preflightSourceUrl: sourceUrl,
    dryRunSourceUrl: sourceUrl,
    applySourceUrl: sourceUrl,
    journalSourceUrl: sourceUrl,
    recoverySourceUrl: sourceUrl,
    routePrefix: expectedRoutePrefix,
    checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
    scope: 'final-release',
  };
}

function driftedSourceIdentityEvidence() {
  return {
    ...matchingSourceIdentityEvidence(),
    ok: false,
    same: false,
    sameSource: false,
    observed: 'recovery-inspect-used-remote-changed-source',
    recoverySourceUrl: remoteChangedUrl,
  };
}

function completeFinalEvidence(sourceIdentity = matchingSourceIdentityEvidence()) {
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
    sourceIdentity,
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

function generatedFixture(sourceIdentity = matchingSourceIdentityEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'same-source-url-identity-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedSourceIdentity: {
      expectedCode: 'SAME_SOURCE_IDENTITY_REQUIRED',
      expectedMarker: heldMarker,
      mutationAttempted: false,
      releaseStatus: 'NO-GO',
      checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
      expectedSourceUrl: sourceUrl,
    },
    evidence: completeFinalEvidence(sourceIdentity),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-same-source-regression-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(payload) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(payload),
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

test('same source URL identity regression fails closed before mutation for RPP-0070', () => {
  const fixture = generatedFixture(driftedSourceIdentityEvidence());
  const result = runCheckedCommand(fixture);
  const report = parseReport(result);

  assert.equal(fixture.expectedSourceIdentity.expectedCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(fixture.expectedSourceIdentity.expectedMarker, heldMarker);
  assert.equal(fixture.expectedSourceIdentity.releaseStatus, 'NO-GO');
  assert.deepEqual(fixture.expectedSourceIdentity.checkedRoutes, ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect']);
  assert.equal(fixture.expectedSourceIdentity.expectedSourceUrl, sourceUrl);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'identity');
  assert.equal(report.primaryFailureCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the final held status marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);

  assert.deepEqual(gateById(report, 'same-source-identity'), {
    id: 'same-source-identity',
    rpp: 'RPP-0010',
    title: 'Same source URL identity proof',
    category: 'identity',
    status: 'failed',
    blocking: true,
    code: 'SAME_SOURCE_IDENTITY_REQUIRED',
    reason: sameSourceReason,
    evidence: expectedDriftEvidence,
  });
  assert.equal(gateById(report, 'preflight-route-identity').status, 'passed');
  assert.equal(gateById(report, 'dry-run-route-eligibility').status, 'passed');
  assert.equal(gateById(report, 'apply-route-pre-mutation').status, 'passed');

  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: sameSourceReason,
    missingEvidence: [
      {
        id: 'same-source-identity',
        rpp: 'RPP-0010',
        status: 'failed',
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        reason: sameSourceReason,
        evidence: expectedDriftEvidence,
      },
    ],
  });
  assert.deepEqual(report.missingProductionEvidenceBuckets, [
    {
      bucket: 'identity',
      gateCount: 1,
      gates: [
        {
          bucket: 'identity',
          id: 'same-source-identity',
          rpp: 'RPP-0010',
          title: 'Same source URL identity proof',
          status: 'failed',
          code: 'SAME_SOURCE_IDENTITY_REQUIRED',
          reason: sameSourceReason,
          required: requiredSameSourceEvidence,
          observed: 'recovery-inspect-used-remote-changed-source',
          scope: 'final-release',
        },
      ],
    },
  ]);
  assert.deepEqual(report.releaseMovement.missingEvidence.map((entry) => entry.id), ['same-source-identity']);
  assert.equal(report.evaluation.gates.filter((gate) => gate.status !== 'passed').length, 1);
});

test('matching same source proof passes the gate while release remains NO-GO without provenance for RPP-0070', () => {
  const result = runCheckedCommand(generatedFixture());
  const report = parseReport(result);
  const gate = gateById(report, 'same-source-identity');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, readyMarker);
  assert.ok(result.stdout.includes(readyMarker), 'stdout JSON must expose the final release-ready gate marker');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, false);
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assertSecretRedacted(result, report);
  assert.deepEqual(gate, {
    id: 'same-source-identity',
    rpp: 'RPP-0010',
    title: 'Same source URL identity proof',
    category: 'identity',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Same source URL identity proof is backed by final release evidence.',
    evidence: expectedMatchingEvidence,
  });
});
