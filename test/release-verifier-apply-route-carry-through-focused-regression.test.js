import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const liveVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const applyRevalidationSmokePath = path.join(repoRoot, 'scripts/playground/production-shaped-apply-revalidation-smoke.mjs');
const evidenceNotePath = path.join(repoRoot, 'docs/evidence/rpp-0093-release-verifier-apply-route-carry-through.md');

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0093_SHOULD_NOT_LEAK';
const checkedApplyRoute = '/wp-json/reprint-push/v1/apply';
const applyProofCommand = 'node scripts/playground/production-shaped-apply-revalidation-smoke.mjs';
const verifyReleaseCommand = 'npm run verify:release';
const checkedVerifyCommand = 'timeout 300s npm run verify:release';
const focusedCommand = 'node --test test/release-verifier-apply-route-carry-through-focused-regression.test.js';
const requiredApplyRouteEvidence = ['apply route rejects before mutation when preconditions fail'];
const expectedFailureReason = 'Apply route pre-mutation proof failed or mutated before rejection.';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLY_ROUTE_PRE_MUTATION_REQUIRED]';
const verifyReleaseHeldMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

const expectedPassedApplyEvidence = {
  ok: true,
  preMutation: true,
  observed: 'PRECONDITION_FAILED',
  observedStatus: 412,
  command: verifyReleaseCommand,
  checkedCommand: checkedVerifyCommand,
  proofCommand: applyProofCommand,
  checkedRoute: checkedApplyRoute,
  method: 'POST',
  preconditionCheck: 'storage-boundary-cas',
  phase: 'before-first-mutation',
  checkedAgainst: 'live-remote',
  appliedBeforeFailure: 0,
  mutationAttempted: false,
  sourceUrl,
  scope: 'final-release',
};

const expectedFailedApplyEvidence = {
  ok: false,
  preMutation: false,
  observed: 'MUTATED_BEFORE_PRECONDITION',
  observedStatus: 200,
  command: verifyReleaseCommand,
  checkedCommand: checkedVerifyCommand,
  proofCommand: applyProofCommand,
  checkedRoute: checkedApplyRoute,
  method: 'POST',
  preconditionCheck: 'storage-boundary-cas',
  phase: 'after-first-mutation',
  checkedAgainst: 'live-remote',
  appliedBeforeFailure: 1,
  mutationAttempted: true,
  sourceUrl,
  scope: 'final-release',
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
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      sameUser: true,
      observed: 'application-password-bound-to-checked-source-user',
      checkedSourceUrl: sourceUrl,
      credentialSourceUrl: sourceUrl,
      checkedUser,
      credentialUser: checkedUser,
      bindingId: 'release-verifier-auth-session-source-command',
      scope,
    },
    manageOptionsCapability: {
      ok: true,
      hasManageOptions: true,
      observed: 'manage_options',
      checkedUser,
      route: '/wp-json/reprint-push/v1/preflight',
      method: 'GET',
      expectedCapability: 'manage_options',
      capabilities: { manage_options: true },
      scope,
    },
    sourceIdentity: {
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
      routePrefix: '/wp-json/reprint-push/v1',
      checkedRoutes: ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'],
      scope,
    },
    preflightRouteIdentity: {
      ok: true,
      sameRoute: true,
      observed: '/wp-json/reprint-push/v1/preflight',
      checkedRoute: '/wp-json/reprint-push/v1/preflight',
      observedRoute: '/wp-json/reprint-push/v1/preflight',
      sourceUrl,
      method: 'GET',
      routeNamespace: 'reprint-push/v1',
      routeName: 'preflight',
      mutationAttempted: false,
      scope,
    },
    dryRunRouteEligibility: {
      ok: true,
      eligible: true,
      observed: '/wp-json/reprint-push/v1/dry-run',
      checkedRoute: '/wp-json/reprint-push/v1/dry-run',
      sourceUrl,
      method: 'POST',
      routeNamespace: 'reprint-push/v1',
      routeName: 'dry-run',
      planUploadAllowed: true,
      applyAttempted: false,
      mutationAttempted: false,
      scope,
    },
    applyRoutePreMutation: applyRoutePreMutationEvidenceFromVerifierReport(verifierApplyRouteReport()),
    journalRouteReadOnly: {
      ok: true,
      readOnly: true,
      observed: 'journal-read-only',
      observedStatus: 200,
      command: applyProofCommand,
      checkedRoute: '/wp-json/reprint/v1/push/db-journal?limit=80',
      method: 'GET',
      mutatesReleaseState: false,
      mutationAttempted: false,
      scope,
    },
    recoveryInspectReadOnly: {
      ok: true,
      readOnly: true,
      observed: 'inspect-read-only',
      observedStatus: 200,
      command: applyProofCommand,
      checkedRoute: '/wp-json/reprint/v1/push/recovery/inspect',
      method: 'POST',
      mutatesReleaseState: false,
      mutationAttempted: false,
      scope,
    },
    tmuxStatusMarker: {
      ok: true,
      marker: releaseGateReadyMarker,
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: verifyReleaseCommand,
      checkedCommand: checkedVerifyCommand,
      statusMarker: verifyReleaseHeldMarker,
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function verifierApplyRouteReport({ apply = verifierApplyRejection(), ok = true } = {}) {
  return {
    ok,
    mutationAttempted: false,
    topology: {
      sourceUrl,
      remoteBase: sourceUrl,
      remoteChanged: remoteChangedUrl,
      localEdited: localUrl,
    },
    applyRevalidation: {
      ok,
      topology: {
        sourceUrl,
        remoteBase: sourceUrl,
        remoteChanged: remoteChangedUrl,
        localEdited: localUrl,
        externalTopology: true,
        proxyPolicy: 'local-only',
        ingressPort: 8080,
      },
      apply,
      boundary: ok
        ? {
          firstRemainingProductionBoundary: null,
          status: 'ready',
          verdict: 'LIVE_RELEASE_BOUNDARY_OK',
        }
        : {
          firstRemainingProductionBoundary: 'apply route pre-mutation on the checked live release path',
          status: 'blocked',
          verdict: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        },
    },
    topologyEvidence: {
      checkedCommand: checkedVerifyCommand,
      runner: {
        script: 'scripts/playground/production-shaped-live-release-verify.mjs',
        process: 'node',
        routeProfile: 'production-shaped',
        packagedFallbackAllowed: false,
      },
    },
  };
}

function verifierApplyRejection() {
  return {
    status: 412,
    code: 'PRECONDITION_FAILED',
    preconditionCheck: 'storage-boundary-cas',
    applied: 0,
    applyRevalidation: {
      required: 'fresh-live-hashes-before-first-mutation',
      phase: 'before-first-mutation',
      checkedAgainst: 'live-remote',
      verifiedCount: 3,
      verifiedResourceKeys: ['row:wp_posts:ID:1'],
      receiptBinding: {
        dryRunIdempotencyKeyHash: 'a'.repeat(64),
      },
      claim: {
        activeClaimKeyHash: 'a'.repeat(64),
      },
    },
    storageGuard: { outcome: 'stale-at-write' },
    rejectedRemoteEvidence: {
      preservedRemoteChange: true,
      appliedBeforeFailure: 0,
    },
    recovery: {
      required: true,
      state: 'blocked-recovery',
    },
  };
}

function verifierMutationBeforeRejection() {
  return {
    status: 200,
    code: 'MUTATED_BEFORE_PRECONDITION',
    preconditionCheck: 'storage-boundary-cas',
    applied: 1,
    applyRevalidation: {
      required: 'fresh-live-hashes-before-first-mutation',
      phase: 'after-first-mutation',
      checkedAgainst: 'live-remote',
      verifiedCount: 3,
    },
    storageGuard: { outcome: 'write-before-stale-check' },
    rejectedRemoteEvidence: {
      preservedRemoteChange: false,
      appliedBeforeFailure: 1,
    },
    recovery: {
      required: true,
      state: 'mutation-before-rejection',
    },
  };
}

function applyRoutePreMutationEvidenceFromVerifierReport(report) {
  const apply = report?.applyRevalidation?.apply || {};
  const applyRevalidation = apply.applyRevalidation || {};
  const appliedBeforeFailure = Number.isInteger(apply.rejectedRemoteEvidence?.appliedBeforeFailure)
    ? apply.rejectedRemoteEvidence.appliedBeforeFailure
    : (Number.isInteger(apply.applied) ? apply.applied : null);
  const preMutation = apply.status === 412
    && apply.code === 'PRECONDITION_FAILED'
    && apply.preconditionCheck === 'storage-boundary-cas'
    && appliedBeforeFailure === 0
    && applyRevalidation.phase === 'before-first-mutation'
    && applyRevalidation.checkedAgainst === 'live-remote';

  return {
    ok: preMutation,
    preMutation,
    observed: apply.code || 'missing-apply-route-status',
    observedStatus: apply.status ?? null,
    command: verifyReleaseCommand,
    checkedCommand: report?.topologyEvidence?.checkedCommand || checkedVerifyCommand,
    proofCommand: applyProofCommand,
    checkedRoute: checkedApplyRoute,
    method: 'POST',
    preconditionCheck: apply.preconditionCheck || '',
    phase: applyRevalidation.phase || '',
    checkedAgainst: applyRevalidation.checkedAgainst || '',
    appliedBeforeFailure,
    mutationAttempted: !preMutation && Number(appliedBeforeFailure || 0) > 0,
    sourceUrl: report?.topology?.sourceUrl || report?.applyRevalidation?.topology?.sourceUrl || '',
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-apply-route-carry-through-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runReleaseGateCheck(evidence) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeEvidence(evidence),
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

function assertVerifierSourceCarriesApplyRouteProof() {
  const liveVerifierSource = fs.readFileSync(liveVerifierPath, 'utf8');
  const applyRevalidationSource = fs.readFileSync(applyRevalidationSmokePath, 'utf8');

  assert.match(liveVerifierSource, /const applyRevalidation = runApplyRevalidationProof\(resolveApplyRevalidationAuthEnv/);
  assert.match(liveVerifierSource, /emitCombinedReleaseProof\(verify\.proof, applyRevalidation\)/);
  assert.match(liveVerifierSource, /applyRevalidation: normalizedApplyRevalidation/);
  assert.match(liveVerifierSource, /checkedCommand: 'timeout 300s npm run verify:release'/);
  assert.match(liveVerifierSource, /scripts\/playground\/production-shaped-apply-revalidation-smoke\.mjs/);

  assert.match(applyRevalidationSource, /assert\.equal\(apply\.status, 412\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.code, 'PRECONDITION_FAILED'\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.preconditionCheck, 'storage-boundary-cas'\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.applied, 0, 'stale remote must fail before the first mutation is applied'\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.applyRevalidation\?\.phase, 'before-first-mutation'\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.applyRevalidation\?\.checkedAgainst, 'live-remote'\)/);
  assert.match(applyRevalidationSource, /assert\.equal\(apply\.body\.rejectedRemoteEvidence\?\.appliedBeforeFailure, 0\)/);
  assert.match(applyRevalidationSource, /assertNoPlannedMutationApplied\(afterApply, plan\)/);
}

test('release verifier carries apply route pre-mutation proof and observed status for RPP-0093', () => {
  assertVerifierSourceCarriesApplyRouteProof();
  const applyEvidence = applyRoutePreMutationEvidenceFromVerifierReport(verifierApplyRouteReport());
  assert.deepEqual(applyEvidence, expectedPassedApplyEvidence);

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    applyRoutePreMutation: applyEvidence,
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const applyGate = gateById(releaseGateReport, 'apply-route-pre-mutation');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'provenance');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateReadyMarker);
  assert.equal(releaseGateReport.releaseMovement.allowed, true);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '20/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(applyGate, {
    id: 'apply-route-pre-mutation',
    rpp: 'RPP-0013',
    title: 'Apply route pre-mutation proof',
    category: 'route',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Apply route pre-mutation proof is backed by final release evidence.',
    evidence: {
      ...expectedPassedApplyEvidence,
      required: requiredApplyRouteEvidence,
      requiredScope: 'final-release',
    },
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier apply route carry-through fails closed on mutation-before-rejection evidence for RPP-0093', () => {
  const applyEvidence = applyRoutePreMutationEvidenceFromVerifierReport(verifierApplyRouteReport({
    apply: verifierMutationBeforeRejection(),
    ok: false,
  }));
  assert.deepEqual(applyEvidence, expectedFailedApplyEvidence);

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    applyRoutePreMutation: applyEvidence,
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const routeBucket = releaseGateReport.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route');
  const applyGate = gateById(releaseGateReport, 'apply-route-pre-mutation');
  const expectedGateEvidence = {
    ...expectedFailedApplyEvidence,
    required: requiredApplyRouteEvidence,
  };

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.status, 'held');
  assert.equal(releaseGateReport.gateState, 'held');
  assert.equal(releaseGateReport.primaryFailureBucket, 'route');
  assert.equal(releaseGateReport.primaryFailureCode, 'APPLY_ROUTE_PRE_MUTATION_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(applyGate, {
    id: 'apply-route-pre-mutation',
    rpp: 'RPP-0013',
    title: 'Apply route pre-mutation proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
    reason: expectedFailureReason,
    evidence: expectedGateEvidence,
  });
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: expectedFailureReason,
    missingEvidence: [
      {
        id: 'apply-route-pre-mutation',
        rpp: 'RPP-0013',
        status: 'failed',
        code: 'APPLY_ROUTE_PRE_MUTATION_REQUIRED',
        reason: expectedFailureReason,
        evidence: expectedGateEvidence,
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
        reason: expectedFailureReason,
        required: requiredApplyRouteEvidence,
        observed: 'MUTATED_BEFORE_PRECONDITION',
        scope: 'final-release',
      },
    ],
  });
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('RPP-0093 evidence note records the focused command and observed status', () => {
  const evidenceNote = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(evidenceNote.includes('Evidence toward `RPP-0093` release verifier apply route pre-mutation carry-through.'));
  assert.ok(evidenceNote.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceNote.includes('- Observed status: `pass`; tests: `3/3`; apply route observed status: `412`; failure code: `APPLY_ROUTE_PRE_MUTATION_REQUIRED`.'));
  assert.ok(evidenceNote.includes('No shared release-verifier implementation file changed.'));
});
