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
const expectedPreflightRoute = '/wp-json/reprint-push/v1/preflight';
const wrongPreflightRoute = '/wp-json/reprint-push/v1/preview';
const requiredPreflightRouteEvidence = ['preflight route identity checked before mutation'];

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
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: preflightRouteEvidence(),
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

function preflightRouteEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    sameRoute: true,
    observed: expectedPreflightRoute,
    checkedRoute: expectedPreflightRoute,
    observedRoute: expectedPreflightRoute,
    sourceUrl,
    method: 'GET',
    routeNamespace: 'reprint-push/v1',
    routeName: 'preflight',
    mutationAttempted: false,
    scope,
    ...overrides,
  };
}

function wrongPreflightRouteEvidence() {
  return preflightRouteEvidence({
    ok: false,
    sameRoute: false,
    observed: wrongPreflightRoute,
    observedRoute: wrongPreflightRoute,
  });
}

function generatedFixture(preflightRouteIdentity = preflightRouteEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'preflight-route-identity-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedPreflightRoute: {
      sourceUrl,
      route: expectedPreflightRoute,
      method: 'GET',
    },
    evidence: completeFinalEvidence({ preflightRouteIdentity }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-route-identity-gate-coverage-'));
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

test('generated preflight route identity fixture passes when the checked route matches for RPP-0051', () => {
  const result = runCheckedCommand(writeEvidence(generatedFixture()));
  const report = parseReport(result);
  const gate = gateById(report, 'preflight-route-identity');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    ok: true,
    sameRoute: true,
    observed: expectedPreflightRoute,
    checkedRoute: expectedPreflightRoute,
    observedRoute: expectedPreflightRoute,
    sourceUrl,
    method: 'GET',
    routeNamespace: 'reprint-push/v1',
    routeName: 'preflight',
    mutationAttempted: false,
    scope: 'final-release',
    required: requiredPreflightRouteEvidence,
    requiredScope: 'final-release',
  });
});

test('generated preflight route identity mismatch fails closed before mutation for RPP-0051', () => {
  const fixture = generatedFixture(wrongPreflightRouteEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const routeBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route');
  const gate = gateById(report, 'preflight-route-identity');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PREFLIGHT_ROUTE_IDENTITY_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    sameRoute: false,
    observed: wrongPreflightRoute,
    checkedRoute: expectedPreflightRoute,
    observedRoute: wrongPreflightRoute,
    sourceUrl,
    method: 'GET',
    routeNamespace: 'reprint-push/v1',
    routeName: 'preflight',
    mutationAttempted: false,
    scope: 'final-release',
    required: requiredPreflightRouteEvidence,
  };

  assert.equal(fixture.evidence.preflightRouteIdentity.observedRoute, wrongPreflightRoute);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'route');
  assert.equal(report.primaryFailureCode, 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED');
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
    reason: 'Preflight route identity proof failed.',
    missingEvidence: [
      {
        id: 'preflight-route-identity',
        rpp: 'RPP-0011',
        status: 'failed',
        code: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        reason: 'Preflight route identity proof failed.',
        evidence: expectedEvidence,
      },
    ],
  });
  assert.deepEqual(routeBucket, {
    bucket: 'route',
    gateCount: 1,
    gates: [
      {
        bucket: 'route',
        id: 'preflight-route-identity',
        rpp: 'RPP-0011',
        title: 'Preflight route identity proof',
        status: 'failed',
        code: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        reason: 'Preflight route identity proof failed.',
        required: requiredPreflightRouteEvidence,
        observed: wrongPreflightRoute,
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'preflight-route-identity',
    rpp: 'RPP-0011',
    title: 'Preflight route identity proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
    reason: 'Preflight route identity proof failed.',
    evidence: expectedEvidence,
  });
});
