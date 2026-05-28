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
const command = 'node scripts/playground/production-shaped-apply-revalidation-smoke.mjs';
const checkedApplyRoute = '/wp-json/reprint-push/v1/apply';
const requiredApplyRouteEvidence = ['apply route rejects before mutation when preconditions fail'];

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
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: applyPreMutationEvidence(),
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

function applyPreMutationEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    preMutation: true,
    observed: 'PRECONDITION_FAILED',
    observedStatus: 412,
    command,
    checkedRoute: checkedApplyRoute,
    method: 'POST',
    preconditionCheck: 'storage-boundary-cas',
    phase: 'before-first-mutation',
    appliedBeforeFailure: 0,
    mutationAttempted: false,
    sourceUrl,
    scope,
    ...overrides,
  };
}

function applyMutationBeforeRejectionEvidence() {
  return applyPreMutationEvidence({
    ok: false,
    preMutation: false,
    observed: 'MUTATED_BEFORE_PRECONDITION',
    observedStatus: 200,
    phase: 'after-first-mutation',
    appliedBeforeFailure: 1,
    mutationAttempted: true,
  });
}

function generatedFixture(applyRoutePreMutation = applyPreMutationEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'apply-route-pre-mutation-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedApplyRoutePreMutation: {
      sourceUrl,
      route: checkedApplyRoute,
      method: 'POST',
      command,
      requiredStatus: 412,
      requiredPhase: 'before-first-mutation',
      mutationAttempted: false,
    },
    evidence: completeFinalEvidence({ applyRoutePreMutation }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-route-pre-mutation-gate-coverage-'));
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

test('generated apply route pre-mutation fixture preserves command and observed status for RPP-0053', () => {
  const result = runCheckedCommand(writeEvidence(generatedFixture()));
  const report = parseReport(result);
  const gate = gateById(report, 'apply-route-pre-mutation');
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
    preMutation: true,
    observed: 'PRECONDITION_FAILED',
    observedStatus: 412,
    command,
    checkedRoute: checkedApplyRoute,
    method: 'POST',
    preconditionCheck: 'storage-boundary-cas',
    phase: 'before-first-mutation',
    appliedBeforeFailure: 0,
    mutationAttempted: false,
    sourceUrl,
    scope: 'final-release',
    required: requiredApplyRouteEvidence,
    requiredScope: 'final-release',
  });
});

test('generated apply route mutation-before-rejection proof fails closed for RPP-0053', () => {
  const fixture = generatedFixture(applyMutationBeforeRejectionEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const routeBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route');
  const gate = gateById(report, 'apply-route-pre-mutation');
  const expectedMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLY_ROUTE_PRE_MUTATION_REQUIRED]';
  const expectedEvidence = {
    ok: false,
    preMutation: false,
    observed: 'MUTATED_BEFORE_PRECONDITION',
    observedStatus: 200,
    command,
    checkedRoute: checkedApplyRoute,
    method: 'POST',
    preconditionCheck: 'storage-boundary-cas',
    phase: 'after-first-mutation',
    appliedBeforeFailure: 1,
    mutationAttempted: true,
    sourceUrl,
    scope: 'final-release',
    required: requiredApplyRouteEvidence,
  };

  assert.equal(fixture.evidence.applyRoutePreMutation.appliedBeforeFailure, 1);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'route');
  assert.equal(report.primaryFailureCode, 'APPLY_ROUTE_PRE_MUTATION_REQUIRED');
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
    reason: 'Apply route pre-mutation proof failed or mutated before rejection.',
    missingEvidence: [
      {
        id: 'apply-route-pre-mutation',
        rpp: 'RPP-0013',
        status: 'failed',
        code: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        reason: 'Apply route pre-mutation proof failed or mutated before rejection.',
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
        id: 'apply-route-pre-mutation',
        rpp: 'RPP-0013',
        title: 'Apply route pre-mutation proof',
        status: 'failed',
        code: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        reason: 'Apply route pre-mutation proof failed or mutated before rejection.',
        required: requiredApplyRouteEvidence,
        observed: 'MUTATED_BEFORE_PRECONDITION',
        scope: 'final-release',
      },
    ],
  });
  assert.deepEqual(gate, {
    id: 'apply-route-pre-mutation',
    rpp: 'RPP-0013',
    title: 'Apply route pre-mutation proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
    reason: 'Apply route pre-mutation proof failed or mutated before rejection.',
    evidence: expectedEvidence,
  });
});
