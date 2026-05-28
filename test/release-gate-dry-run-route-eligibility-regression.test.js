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
const secretValue = 'RPP_0072_SHOULD_NOT_LEAK';
const expectedDryRunRoute = '/wp-json/reprint-push/v1/dry-run';
const ineligibleObservedStatus = 'dry-run-route-rejected-before-plan-upload';
const requiredDryRunEvidence = ['dry-run route eligibility checked before apply'];
const expectedFailureReason = 'Dry-run route eligibility proof failed.';
const expectedHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED]';

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
    dryRunRouteEligibility: dryRunRouteEvidence(),
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

function dryRunRouteEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    eligible: true,
    observed: expectedDryRunRoute,
    checkedRoute: expectedDryRunRoute,
    sourceUrl,
    method: 'POST',
    routeNamespace: 'reprint-push/v1',
    routeName: 'dry-run',
    planUploadAllowed: true,
    mutationAttempted: false,
    scope,
    ...overrides,
  };
}

function dryRunRouteIneligibleEvidence() {
  return dryRunRouteEvidence({
    ok: false,
    eligible: false,
    observed: ineligibleObservedStatus,
    planUploadAllowed: false,
    rejectionStatus: 403,
    rejectionCode: 'dry_run_route_not_allowed',
  });
}

function releaseGateFixture(dryRunRouteEligibility = dryRunRouteEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'dry-run-route-eligibility-regression',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    expectedDryRunRoute: {
      sourceUrl,
      route: expectedDryRunRoute,
      method: 'POST',
    },
    evidence: completeFinalEvidence({ dryRunRouteEligibility }),
  };
}

function writeFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-dry-run-route-regression-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(payload) {
  const evidenceFile = writeFixture(payload);
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

test('dry-run route eligibility regression passes exact final evidence before provenance for RPP-0072', () => {
  const result = runCheckedCommand(releaseGateFixture());
  const report = parseReport(result);
  const gate = gateById(report, 'dry-run-route-eligibility');

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
    eligible: true,
    observed: expectedDryRunRoute,
    checkedRoute: expectedDryRunRoute,
    sourceUrl,
    method: 'POST',
    routeNamespace: 'reprint-push/v1',
    routeName: 'dry-run',
    planUploadAllowed: true,
    mutationAttempted: false,
    scope: 'final-release',
    required: requiredDryRunEvidence,
    requiredScope: 'final-release',
  });
});

test('dry-run route eligibility regression fails closed before mutation for RPP-0072', () => {
  const result = runCheckedCommand(releaseGateFixture(dryRunRouteIneligibleEvidence()));
  const report = parseReport(result);
  const routeBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route');
  const gate = gateById(report, 'dry-run-route-eligibility');
  const expectedEvidence = {
    ok: false,
    eligible: false,
    observed: ineligibleObservedStatus,
    checkedRoute: expectedDryRunRoute,
    sourceUrl,
    method: 'POST',
    routeNamespace: 'reprint-push/v1',
    routeName: 'dry-run',
    planUploadAllowed: false,
    mutationAttempted: false,
    scope: 'final-release',
    rejectionStatus: 403,
    rejectionCode: 'dry_run_route_not_allowed',
    required: requiredDryRunEvidence,
  };

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.gateState, 'held');
  assert.equal(report.primaryFailureBucket, 'route');
  assert.equal(report.primaryFailureCode, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');
  assert.equal(report.statusMarker, expectedHeldMarker);
  assert.ok(result.stdout.includes(expectedHeldMarker), 'stdout JSON must expose the final bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, expectedMutationPolicy);
  assert.doesNotMatch(result.stdout, new RegExp(secretValue));
  assert.doesNotMatch(result.stderr, new RegExp(secretValue));

  assert.deepEqual(gate, {
    id: 'dry-run-route-eligibility',
    rpp: 'RPP-0012',
    title: 'Dry-run route eligibility proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
    reason: expectedFailureReason,
    evidence: expectedEvidence,
  });
  assert.deepEqual(report.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: expectedFailureReason,
    missingEvidence: [
      {
        id: 'dry-run-route-eligibility',
        rpp: 'RPP-0012',
        status: 'failed',
        code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        reason: expectedFailureReason,
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
        id: 'dry-run-route-eligibility',
        rpp: 'RPP-0012',
        title: 'Dry-run route eligibility proof',
        status: 'failed',
        code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        reason: expectedFailureReason,
        required: requiredDryRunEvidence,
        observed: ineligibleObservedStatus,
        scope: 'final-release',
      },
    ],
  });
  assert.equal(report.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
});
