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
const expectedRoute = '/wp-json/reprint-push/v1';
const requiredSameSourceEvidence = ['preflight, dry-run, apply, and recovery use the same source URL'];

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
    productionSecret: { ok: true, present: true, observed: 'auth-session-source-command', scope },
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: sameSourceEvidence(),
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

function sameSourceEvidence(overrides = {}) {
  const scope = 'final-release';
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
    routePrefix: expectedRoute,
    scope,
    ...overrides,
  };
}

function sameSourceDriftEvidence() {
  return sameSourceEvidence({
    ok: false,
    same: false,
    sameSource: false,
    observed: 'apply-used-remote-changed-source',
    applySourceUrl: remoteChangedUrl,
  });
}

function generatedFixture(sourceIdentity = sameSourceEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'same-source-url-identity-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedSourceIdentity: {
      sourceUrl,
      routePrefix: expectedRoute,
      checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
    },
    evidence: completeFinalEvidence({ sourceIdentity }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'same-source-gate-coverage-'));
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

test('generated same-source fixture emits a final bracketed release-ready marker for RPP-0050', () => {
  const result = runCheckedCommand(writeEvidence(generatedFixture()));
  const report = parseReport(result);
  const gate = gateById(report, 'same-source-identity');
  const expectedMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, expectedMarker);
  assert.ok(result.stdout.includes(expectedMarker), 'stdout JSON must expose the final bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
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
    routePrefix: expectedRoute,
    scope: 'final-release',
    required: requiredSameSourceEvidence,
    requiredScope: 'final-release',
  });
});

test('generated same-source drift fails closed before mutation for RPP-0050', () => {
  const fixture = generatedFixture(sameSourceDriftEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const identityBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'identity');
  const gate = gateById(report, 'same-source-identity');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=SAME_SOURCE_IDENTITY_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    same: false,
    sameSource: false,
    observed: 'apply-used-remote-changed-source',
    expectedSourceUrl: sourceUrl,
    preflightSourceUrl: sourceUrl,
    dryRunSourceUrl: sourceUrl,
    applySourceUrl: remoteChangedUrl,
    journalSourceUrl: sourceUrl,
    recoverySourceUrl: sourceUrl,
    routePrefix: expectedRoute,
    scope: 'final-release',
    required: requiredSameSourceEvidence,
  };

  assert.equal(fixture.evidence.sourceIdentity.applySourceUrl, remoteChangedUrl);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'identity');
  assert.equal(report.primaryFailureCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
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
    reason: 'Source URL identity drifted across the checked release path.',
    missingEvidence: [
      {
        id: 'same-source-identity',
        rpp: 'RPP-0010',
        status: 'failed',
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        reason: 'Source URL identity drifted across the checked release path.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(identityBucket, {
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
        reason: 'Source URL identity drifted across the checked release path.',
        required: requiredSameSourceEvidence,
        observed: 'apply-used-remote-changed-source',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'same-source-identity',
    rpp: 'RPP-0010',
    title: 'Same source URL identity proof',
    category: 'identity',
    status: 'failed',
    blocking: true,
    code: 'SAME_SOURCE_IDENTITY_REQUIRED',
    reason: 'Source URL identity drifted across the checked release path.',
    evidence: expectedEvidence,
  });
});
