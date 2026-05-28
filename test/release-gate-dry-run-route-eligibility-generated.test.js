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
const checkedDryRunRoute = '/wp-json/reprint-push/v1/dry-run';
const requiredDryRunRouteEvidence = ['dry-run route eligibility checked before apply'];

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
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: dryRunEligibilityEvidence(),
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

function dryRunEligibilityEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    eligible: true,
    observed: 'dry-run-route-eligible',
    checkedRoute: checkedDryRunRoute,
    observedRoute: checkedDryRunRoute,
    sourceUrl,
    method: 'POST',
    preflightStatus: 200,
    dryRunStatus: 200,
    applyAttempted: false,
    mutationAttempted: false,
    scope,
    ...overrides,
  };
}

function dryRunRejectedEvidence() {
  return dryRunEligibilityEvidence({
    ok: false,
    eligible: false,
    observed: 'dry-run-route-rejected-before-apply',
    preflightStatus: 200,
    dryRunStatus: 412,
    rejectionCode: 'dry_run_precondition_failed',
  });
}

function generatedFixture(dryRunRouteEligibility = dryRunEligibilityEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'dry-run-route-eligibility-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedDryRunRoute: {
      sourceUrl,
      route: checkedDryRunRoute,
      method: 'POST',
    },
    evidence: completeFinalEvidence({ dryRunRouteEligibility }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-route-eligibility-gate-coverage-'));
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

test('generated dry-run route eligibility fixture passes when dry-run is eligible for RPP-0052', () => {
  const result = runCheckedCommand(writeEvidence(generatedFixture()));
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
    observed: 'dry-run-route-eligible',
    checkedRoute: checkedDryRunRoute,
    observedRoute: checkedDryRunRoute,
    sourceUrl,
    method: 'POST',
    preflightStatus: 200,
    dryRunStatus: 200,
    applyAttempted: false,
    mutationAttempted: false,
    scope: 'final-release',
    required: requiredDryRunRouteEvidence,
    requiredScope: 'final-release',
  });
});

test('generated dry-run route rejection fails closed before mutation for RPP-0052', () => {
  const fixture = generatedFixture(dryRunRejectedEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const routeBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route');
  const gate = gateById(report, 'dry-run-route-eligibility');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    eligible: false,
    observed: 'dry-run-route-rejected-before-apply',
    checkedRoute: checkedDryRunRoute,
    observedRoute: checkedDryRunRoute,
    sourceUrl,
    method: 'POST',
    preflightStatus: 200,
    dryRunStatus: 412,
    applyAttempted: false,
    mutationAttempted: false,
    scope: 'final-release',
    rejectionCode: 'dry_run_precondition_failed',
    required: requiredDryRunRouteEvidence,
  };

  assert.equal(fixture.evidence.dryRunRouteEligibility.dryRunStatus, 412);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'route');
  assert.equal(report.primaryFailureCode, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');
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
    reason: 'Dry-run route eligibility proof failed.',
    missingEvidence: [
      {
        id: 'dry-run-route-eligibility',
        rpp: 'RPP-0012',
        status: 'failed',
        code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        reason: 'Dry-run route eligibility proof failed.',
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
        reason: 'Dry-run route eligibility proof failed.',
        required: requiredDryRunRouteEvidence,
        observed: 'dry-run-route-rejected-before-apply',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'dry-run-route-eligibility',
    rpp: 'RPP-0012',
    title: 'Dry-run route eligibility proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
    reason: 'Dry-run route eligibility proof failed.',
    evidence: expectedEvidence,
  });
});
