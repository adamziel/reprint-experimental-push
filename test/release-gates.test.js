import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RELEASE_GATE_DEFINITIONS,
  evaluateReleaseGates,
  formatReleaseGateStatusMarker,
  releaseGateSummary,
} from '../src/release-gates.js';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';

function releaseEnv(overrides = {}) {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    ...overrides,
  };
}

function completeEvidence(scope = 'final-release', overrides = {}) {
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
      marker: scope === 'final-release'
        ? '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]'
        : '[release-gates:candidate-for-review final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow.toISOString(), scope },
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

function gateById(evaluation, id) {
  const gate = evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function writeReleaseGateEvidenceFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-evidence-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

test('release gate definitions are machine-readable and cover the near release-gate foundation items', () => {
  assert.equal(RELEASE_GATE_DEFINITIONS.length, 20);
  assert.deepEqual(
    RELEASE_GATE_DEFINITIONS.slice(0, 5).map((gate) => gate.rpp),
    ['RPP-0001', 'RPP-0002', 'RPP-0003', 'RPP-0004', 'RPP-0005'],
  );
  assert.deepEqual(
    RELEASE_GATE_DEFINITIONS.slice(-5).map((gate) => gate.rpp),
    ['RPP-0016', 'RPP-0017', 'RPP-0018', 'RPP-0019', 'RPP-0020'],
  );
});

test('missing topology URLs fail closed with exact missing evidence objects', () => {
  const evaluation = evaluateReleaseGates({
    env: {},
    evidence: {},
    scope: 'final-release',
    now: fixedNow,
  });

  assert.equal(evaluation.status, 'held');
  assert.equal(evaluation.releaseMovement.allowed, false);
  assert.equal(evaluation.releaseMovement.state, 'held');
  assert.equal(evaluation.releaseMovement.reason, 'REPRINT_PUSH_SOURCE_URL is required before release gates can run preflight, dry-run, apply, or recovery.');

  assert.deepEqual(gateById(evaluation, 'source-url').evidence, {
    required: 'REPRINT_PUSH_SOURCE_URL',
    observed: 'missing-live-source',
    envKey: 'REPRINT_PUSH_SOURCE_URL',
    scope: 'missing',
  });
  assert.deepEqual(gateById(evaluation, 'local-url').evidence, {
    required: 'REPRINT_PUSH_LOCAL_URL',
    observed: 'missing-local-edited-site',
    envKey: 'REPRINT_PUSH_LOCAL_URL',
    scope: 'missing',
  });
  assert.deepEqual(gateById(evaluation, 'remote-changed-url').evidence, {
    required: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
    observed: 'missing-remote-changed-source',
    envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
    scope: 'missing',
  });
});

test('packaged production-plugin fallback is rejected even when every other gate has evidence', () => {
  const evaluation = evaluateReleaseGates({
    env: releaseEnv(),
    evidence: completeEvidence('final-release'),
    packagedFallback: true,
    scope: 'final-release',
    now: fixedNow,
  });

  const gate = gateById(evaluation, 'packaged-fallback');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED');
  assert.deepEqual(gate.evidence, {
    required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
    observed: 'packaged-production-plugin-fallback',
    scope: 'final-release',
  });
  assert.equal(evaluation.releaseMovement.allowed, false);
  assert.equal(evaluation.releaseMovement.finalGates, '19/20');
  assert.equal(evaluation.releaseMovement.reason, 'Packaged production-plugin fallback is support evidence only and cannot move release gates.');
});

test('wrong remote alias rejection holds release movement without weakening other evidence', () => {
  const evaluation = evaluateReleaseGates({
    env: releaseEnv({ REPRINT_PUSH_REMOTE_URL: 'https://wrong.example.test/push/' }),
    evidence: completeEvidence('final-release'),
    scope: 'final-release',
    now: fixedNow,
  });

  const gate = gateById(evaluation, 'remote-alias');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'REPRINT_PUSH_SOURCE_URL_MISMATCH');
  assert.deepEqual(gate.evidence, {
    required: sourceUrl,
    observed: 'https://wrong.example.test/push/',
    envKey: 'REPRINT_PUSH_REMOTE_URL',
    sourceEnvKey: 'REPRINT_PUSH_SOURCE_URL',
    scope: 'final-release',
  });
  assert.equal(evaluation.releaseMovement.allowed, false);
  assert.equal(evaluation.releaseMovement.finalGates, '19/20');
  assert.equal(evaluation.releaseMovement.missingEvidence.length, 1);
});


test('auth source command readback drift is a named blocking gate', () => {
  const evaluation = evaluateReleaseGates({
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      authSourceCommandReadback: {
        ok: false,
        issuedSourceUrl: sourceUrl,
        readbackSourceUrl: 'https://forged.example.test/push',
        scope: 'final-release',
      },
    }),
    scope: 'final-release',
    now: fixedNow,
  });

  const gate = gateById(evaluation, 'auth-source-readback');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(gate.reason, 'Auth source command readback drifted from the checked live source URL.');
  assert.deepEqual(gate.evidence, {
    required: sourceUrl,
    observed: 'https://forged.example.test/push',
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: 'https://forged.example.test/push',
    scope: 'final-release',
  });
  assert.equal(evaluation.releaseMovement.allowed, false);
});

test('check-release-gates command proves auth source readback drift before mutation for RPP-0026', () => {
  const driftedReadback = 'https://forged.example.test/push';
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      authSourceCommandReadback: {
        ok: false,
        issuedSourceUrl: sourceUrl,
        readbackSourceUrl: driftedReadback,
        command: 'node ./scripts/playground/auth-session-source-command.js',
        scope: 'final-release',
      },
    }),
  });

  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.primaryFailureBucket, 'auth');
  assert.equal(result.report.primaryFailureCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '19/20');
  assert.deepEqual(result.report.missingProductionEvidenceBuckets, [
    {
      bucket: 'auth',
      gateCount: 1,
      gates: [
        {
          bucket: 'auth',
          id: 'auth-source-readback',
          rpp: 'RPP-0006',
          title: 'Auth source command readback drift',
          status: 'failed',
          code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          reason: 'Auth source command readback drifted from the checked live source URL.',
          required: sourceUrl,
          observed: driftedReadback,
          envKey: undefined,
          evidenceKey: undefined,
          scope: 'final-release',
          requiredScope: undefined,
        },
      ],
    },
  ]);

  const gate = gateById(result.report.evaluation, 'auth-source-readback');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(gate.reason, 'Auth source command readback drifted from the checked live source URL.');
  assert.deepEqual(gate.evidence, {
    required: sourceUrl,
    observed: driftedReadback,
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: driftedReadback,
    scope: 'final-release',
  });
});

test('check-release-gates command proves Application Password binding drift before mutation for RPP-0028', () => {
  const credentialSourceUrl = 'https://forged.example.test/push';
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      applicationPasswordCredentialBinding: {
        ok: false,
        bound: false,
        sameSource: false,
        observed: 'credential-bound-to-other-source',
        credentialSourceUrl,
        checkedSourceUrl: sourceUrl,
        scope: 'final-release',
      },
    }),
  });

  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'auth');
  assert.equal(result.report.primaryFailureCode, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '19/20');
  assert.deepEqual(result.report.missingProductionEvidenceBuckets, [
    {
      bucket: 'auth',
      gateCount: 1,
      gates: [
        {
          bucket: 'auth',
          id: 'application-password-binding',
          rpp: 'RPP-0008',
          title: 'Application Password credential binding',
          status: 'failed',
          code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
          reason: 'Application Password credential binding drifted from the checked source identity.',
          required: ['Application Password bound to checked source identity'],
          observed: 'credential-bound-to-other-source',
          envKey: undefined,
          evidenceKey: undefined,
          scope: 'final-release',
          requiredScope: undefined,
        },
      ],
    },
  ]);

  const gate = gateById(result.report.evaluation, 'application-password-binding');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
  assert.equal(gate.reason, 'Application Password credential binding drifted from the checked source identity.');
  assert.deepEqual(gate.evidence, {
    ok: false,
    bound: false,
    sameSource: false,
    observed: 'credential-bound-to-other-source',
    credentialSourceUrl,
    checkedSourceUrl: sourceUrl,
    scope: 'final-release',
    required: ['Application Password bound to checked source identity'],
  });
});

test('same source URL identity drift emits a final bracketed marker for RPP-0030', () => {
  const sourceDrift = {
    ok: false,
    same: false,
    sameSource: false,
    observed: 'dry-run-used-remote-changed-source',
    sourceUrl,
    preflightSourceUrl: sourceUrl,
    dryRunSourceUrl: remoteChangedUrl,
    applySourceUrl: sourceUrl,
    recoverySourceUrl: sourceUrl,
    scope: 'final-release',
  };
  const evaluation = evaluateReleaseGates({
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      sourceIdentity: sourceDrift,
    }),
    scope: 'final-release',
    now: fixedNow,
  });
  const gate = gateById(evaluation, 'same-source-identity');

  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(gate.reason, 'Source URL identity drifted across the checked release path.');
  assert.deepEqual(gate.evidence, {
    ...sourceDrift,
    required: ['preflight, dry-run, apply, and recovery use the same source URL'],
  });
  assert.equal(evaluation.releaseMovement.allowed, false);
  assert.equal(evaluation.releaseMovement.finalGates, '19/20');
  assert.equal(evaluation.releaseMovement.reason, 'Source URL identity drifted across the checked release path.');
  assert.equal(
    formatReleaseGateStatusMarker(evaluation),
    '[release-gates:held final=19/20 candidate=19/20 reason=SAME_SOURCE_IDENTITY_REQUIRED]',
  );
});

test('check-release-gates command proves preflight route identity drift before mutation for RPP-0031', () => {
  const expectedRoute = '/reprint-push/v1/preflight';
  const observedRoute = '/wrong/v1/preflight';
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      preflightRouteIdentity: {
        ok: false,
        sameRoute: false,
        observed: observedRoute,
        checkedRoute: expectedRoute,
        observedRoute,
        sourceUrl,
        scope: 'final-release',
      },
    }),
  });

  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'route');
  assert.equal(result.report.primaryFailureCode, 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '19/20');
  assert.deepEqual(result.report.missingProductionEvidenceBuckets, [
    {
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
          required: ['preflight route identity checked before mutation'],
          observed: observedRoute,
          envKey: undefined,
          evidenceKey: undefined,
          scope: 'final-release',
          requiredScope: undefined,
        },
      ],
    },
  ]);

  const gate = gateById(result.report.evaluation, 'preflight-route-identity');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED');
  assert.equal(gate.reason, 'Preflight route identity proof failed.');
  assert.deepEqual(gate.evidence, {
    ok: false,
    sameRoute: false,
    observed: observedRoute,
    checkedRoute: expectedRoute,
    observedRoute,
    sourceUrl,
    scope: 'final-release',
    required: ['preflight route identity checked before mutation'],
  });
});

test('check-release-gates command proves dry-run route eligibility failure for RPP-0032', () => {
  const checkedRoute = '/reprint-push/v1/dry-run';
  const observedRoute = '/reprint-push/v1/dry-run';
  const observed = 'dry-run-route-rejected';
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      dryRunRouteEligibility: {
        ok: false,
        eligible: false,
        observed,
        checkedRoute,
        observedRoute,
        sourceUrl,
        scope: 'final-release',
      },
    }),
  });

  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'route');
  assert.equal(result.report.primaryFailureCode, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '19/20');
  assert.deepEqual(result.report.missingProductionEvidenceBuckets, [
    {
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
          required: ['dry-run route eligibility checked before apply'],
          observed,
          envKey: undefined,
          evidenceKey: undefined,
          scope: 'final-release',
          requiredScope: undefined,
        },
      ],
    },
  ]);

  const gate = gateById(result.report.evaluation, 'dry-run-route-eligibility');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');
  assert.equal(gate.reason, 'Dry-run route eligibility proof failed.');
  assert.deepEqual(gate.evidence, {
    ok: false,
    eligible: false,
    observed,
    checkedRoute,
    observedRoute,
    sourceUrl,
    scope: 'final-release',
    required: ['dry-run route eligibility checked before apply'],
  });
});

test('check-release-gates command links apply route pre-mutation proof for RPP-0033', () => {
  const command = 'node scripts/playground/production-shaped-apply-revalidation-smoke.mjs';
  const applyProof = {
    ok: true,
    preMutation: true,
    observed: 'PRECONDITION_FAILED',
    observedStatus: 412,
    command,
    checkedRoute: '/reprint-push/v1/apply',
    preconditionCheck: 'storage-boundary-cas',
    phase: 'before-first-mutation',
    appliedBeforeFailure: 0,
    sourceUrl,
    scope: 'final-release',
  };
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      applyRoutePreMutation: applyProof,
    }),
  });

  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'provenance');
  assert.equal(result.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.equal(result.report.releaseMovement.allowed, true);
  assert.equal(result.report.releaseMovement.finalGates, '20/20');

  const gate = gateById(result.report.evaluation, 'apply-route-pre-mutation');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.code, 'OK');
  assert.equal(gate.reason, 'Apply route pre-mutation proof is backed by final release evidence.');
  assert.deepEqual(gate.evidence, {
    ...applyProof,
    required: ['apply route rejects before mutation when preconditions fail'],
    requiredScope: 'final-release',
  });
});

test('check-release-gates command proves recovery inspect read-only marker for RPP-0035', () => {
  const command = 'node scripts/playground/production-shaped-apply-revalidation-smoke.mjs';
  const checkedRoute = '/reprint-push/v1/recovery/inspect';
  const scenarios = [
    {
      name: 'negative-recovery-inspect-write-observed',
      evidence: {
        ok: false,
        readOnly: false,
        observed: 'inspect-write-observed',
        observedStatus: 200,
        command,
        checkedRoute,
        method: 'POST',
        mutatesReleaseState: true,
        mutationAttempted: true,
        recoveryRowsBefore: 2,
        recoveryRowsAfter: 3,
        recoveryStateBefore: 'blocked-recovery',
        recoveryStateAfter: 'mutated-recovery',
        scope: 'final-release',
      },
      expected: {
        exitCode: 1,
        releaseAllowed: false,
        finalGates: '19/20',
        primaryFailureBucket: 'recovery',
        primaryFailureCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        statusMarker: '[release-gates-ci:held final=19/20 candidate=19/20 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED]',
        gateStatus: 'failed',
        gateCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        gateReason: 'Recovery inspect route was not proven read-only.',
        gateEvidence: {
          ok: false,
          readOnly: false,
          observed: 'inspect-write-observed',
          observedStatus: 200,
          command,
          checkedRoute,
          method: 'POST',
          mutatesReleaseState: true,
          mutationAttempted: true,
          recoveryRowsBefore: 2,
          recoveryRowsAfter: 3,
          recoveryStateBefore: 'blocked-recovery',
          recoveryStateAfter: 'mutated-recovery',
          scope: 'final-release',
          required: ['recovery inspect read-only proof'],
        },
        missingProductionEvidenceBuckets: [
          {
            bucket: 'recovery',
            gateCount: 1,
            gates: [
              {
                bucket: 'recovery',
                id: 'recovery-inspect-read-only',
                rpp: 'RPP-0015',
                title: 'Recovery inspect read-only proof',
                status: 'failed',
                code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
                reason: 'Recovery inspect route was not proven read-only.',
                required: ['recovery inspect read-only proof'],
                observed: 'inspect-write-observed',
                envKey: undefined,
                evidenceKey: undefined,
                scope: 'final-release',
                requiredScope: undefined,
              },
            ],
          },
        ],
      },
    },
    {
      name: 'positive-recovery-inspect-read-only',
      evidence: {
        ok: true,
        readOnly: true,
        observed: 'inspect-read-only',
        observedStatus: 200,
        command,
        checkedRoute,
        method: 'POST',
        mutatesReleaseState: false,
        mutationAttempted: false,
        recoveryRowsBefore: 2,
        recoveryRowsAfter: 2,
        recoveryStateBefore: 'blocked-recovery',
        recoveryStateAfter: 'blocked-recovery',
        scope: 'final-release',
      },
      expected: {
        exitCode: 1,
        releaseAllowed: true,
        finalGates: '20/20',
        primaryFailureBucket: 'provenance',
        primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
        statusMarker: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]',
        gateStatus: 'passed',
        gateCode: 'OK',
        gateReason: 'Recovery inspect read-only proof is backed by final release evidence.',
        gateEvidence: {
          ok: true,
          readOnly: true,
          observed: 'inspect-read-only',
          observedStatus: 200,
          command,
          checkedRoute,
          method: 'POST',
          mutatesReleaseState: false,
          mutationAttempted: false,
          recoveryRowsBefore: 2,
          recoveryRowsAfter: 2,
          recoveryStateBefore: 'blocked-recovery',
          recoveryStateAfter: 'blocked-recovery',
          scope: 'final-release',
          required: ['recovery inspect read-only proof'],
          requiredScope: 'final-release',
        },
      },
    },
  ];
  const observedMatrix = [];

  for (const scenario of scenarios) {
    const { dir, file } = writeReleaseGateEvidenceFixture({
      scope: 'final-release',
      env: releaseEnv(),
      evidence: completeEvidence('final-release', {
        recoveryInspectReadOnly: scenario.evidence,
      }),
    });

    const result = runReleaseGateCli([
      '--evidence-file',
      file,
      '--scope',
      'final-release',
      '--now',
      fixedNow.toISOString(),
    ], {
      cwd: dir,
      env: {},
      now: fixedNow,
    });
    const gate = gateById(result.report.evaluation, 'recovery-inspect-read-only');

    assert.equal(result.exitCode, scenario.expected.exitCode, scenario.name);
    assert.equal(result.report.ok, false, scenario.name);
    assert.equal(result.report.releaseStatus, 'NO-GO', scenario.name);
    assert.equal(result.report.primaryFailureBucket, scenario.expected.primaryFailureBucket, scenario.name);
    assert.equal(result.report.primaryFailureCode, scenario.expected.primaryFailureCode, scenario.name);
    assert.equal(result.report.statusMarker, scenario.expected.statusMarker, scenario.name);
    assert.equal(result.report.mutationAttempted, false, scenario.name);
    assert.deepEqual(result.report.mutationPolicy, {
      readOnly: true,
      reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
    }, scenario.name);
    assert.equal(result.report.releaseMovement.allowed, scenario.expected.releaseAllowed, scenario.name);
    assert.equal(result.report.releaseMovement.finalGates, scenario.expected.finalGates, scenario.name);
    assert.equal(gate.status, scenario.expected.gateStatus, scenario.name);
    assert.equal(gate.code, scenario.expected.gateCode, scenario.name);
    assert.equal(gate.reason, scenario.expected.gateReason, scenario.name);
    assert.deepEqual(gate.evidence, scenario.expected.gateEvidence, scenario.name);

    if (scenario.expected.missingProductionEvidenceBuckets) {
      assert.deepEqual(
        result.report.missingProductionEvidenceBuckets,
        scenario.expected.missingProductionEvidenceBuckets,
        scenario.name,
      );
    }

    observedMatrix.push({
      scenario: scenario.name,
      marker: result.report.statusMarker,
      gateStatus: gate.status,
      gateCode: gate.code,
      readOnly: gate.evidence.readOnly,
      mutatesReleaseState: gate.evidence.mutatesReleaseState,
      recoveryRowsBefore: gate.evidence.recoveryRowsBefore,
      recoveryRowsAfter: gate.evidence.recoveryRowsAfter,
      releaseAllowed: result.report.releaseMovement.allowed,
      primaryFailureCode: result.report.primaryFailureCode,
      mutationAttempted: result.report.mutationAttempted,
    });
  }

  assert.deepEqual(observedMatrix, [
    {
      scenario: 'negative-recovery-inspect-write-observed',
      marker: '[release-gates-ci:held final=19/20 candidate=19/20 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED]',
      gateStatus: 'failed',
      gateCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      readOnly: false,
      mutatesReleaseState: true,
      recoveryRowsBefore: 2,
      recoveryRowsAfter: 3,
      releaseAllowed: false,
      primaryFailureCode: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      mutationAttempted: false,
    },
    {
      scenario: 'positive-recovery-inspect-read-only',
      marker: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]',
      gateStatus: 'passed',
      gateCode: 'OK',
      readOnly: true,
      mutatesReleaseState: false,
      recoveryRowsBefore: 2,
      recoveryRowsAfter: 2,
      releaseAllowed: true,
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
    },
  ]);
});

test('source URL without production credentials fails at the explicit missing-secret gate', () => {
  const evidence = completeEvidence('final-release');
  delete evidence.productionSecret;

  const evaluation = evaluateReleaseGates({
    env: releaseEnv(),
    evidence,
    scope: 'final-release',
    now: fixedNow,
  });

  const gate = gateById(evaluation, 'production-secret');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.code, 'REPRINT_PUSH_SECRET_REQUIRED');
  assert.equal(
    gate.reason,
    'A live source URL is present but production credentials or an auth session source command are missing.',
  );
  assert.deepEqual(gate.evidence, {
    required: [
      'REPRINT_PUSH_USERNAME + REPRINT_PUSH_APPLICATION_PASSWORD',
      'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
    ],
    observed: 'missing-production-credentials',
    sourceUrl,
    scope: 'final-release',
  });
  assert.equal(evaluation.releaseMovement.allowed, false);
});


test('remaining release gates name missing evidence keys and hold release movement', () => {
  const cases = [
    ['application-password-binding', 'applicationPasswordCredentialBinding', 'APPLICATION_PASSWORD_BINDING_REQUIRED'],
    ['manage-options-capability', 'manageOptionsCapability', 'MANAGE_OPTIONS_CAPABILITY_REQUIRED'],
    ['same-source-identity', 'sourceIdentity', 'SAME_SOURCE_IDENTITY_REQUIRED'],
    ['preflight-route-identity', 'preflightRouteIdentity', 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED'],
    ['dry-run-route-eligibility', 'dryRunRouteEligibility', 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED'],
    ['apply-route-pre-mutation', 'applyRoutePreMutation', 'APPLY_ROUTE_PRE_MUTATION_REQUIRED'],
    ['journal-route-read-only', 'journalRouteReadOnly', 'JOURNAL_ROUTE_READ_ONLY_REQUIRED'],
    ['recovery-inspect-read-only', 'recoveryInspectReadOnly', 'RECOVERY_INSPECT_READ_ONLY_REQUIRED'],
    ['tmux-status-marker', 'tmuxStatusMarker', 'TMUX_STATUS_MARKER_REQUIRED'],
    ['progress-release-timestamp', 'progressReleaseTimestamp', 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED'],
    ['agents-release-gates-row', 'agentsReleaseGateStatusRow', 'AGENTS_RELEASE_GATES_ROW_REQUIRED'],
    ['verify-release-failure-reason', 'verifyReleaseFailure', 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED'],
  ];

  for (const [gateId, evidenceKey, expectedCode] of cases) {
    const evidence = completeEvidence('final-release');
    delete evidence[evidenceKey];

    const evaluation = evaluateReleaseGates({
      env: releaseEnv(),
      evidence,
      scope: 'final-release',
      now: fixedNow,
    });
    const gate = gateById(evaluation, gateId);

    assert.equal(gate.status, 'missing', gateId);
    assert.equal(gate.code, expectedCode, gateId);
    assert.equal(gate.evidence.evidenceKey, evidenceKey, gateId);
    assert.equal(gate.evidence.scope, 'missing', gateId);
    assert.equal(evaluation.releaseMovement.allowed, false, gateId);
    assert.equal(evaluation.releaseMovement.finalGates, '19/20', gateId);
    assert.ok(
      evaluation.releaseMovement.missingEvidence.some((entry) => entry.id === gateId && entry.code === expectedCode),
      gateId,
    );
  }
});

test('explicit failed route, auth, and read-only proof evidence stays fail-closed', () => {
  const cases = [
    ['application-password-binding', 'applicationPasswordCredentialBinding', { ok: false, observed: 'credential-bound-to-other-source' }, 'APPLICATION_PASSWORD_BINDING_REQUIRED'],
    ['manage-options-capability', 'manageOptionsCapability', { ok: false, observed: 'subscriber' }, 'MANAGE_OPTIONS_CAPABILITY_REQUIRED'],
    ['same-source-identity', 'sourceIdentity', { same: false, observed: 'apply-used-other-source' }, 'SAME_SOURCE_IDENTITY_REQUIRED'],
    ['preflight-route-identity', 'preflightRouteIdentity', { sameRoute: false, observed: '/wrong/v1/preflight' }, 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED'],
    ['dry-run-route-eligibility', 'dryRunRouteEligibility', { eligible: false, observed: 'dry-run-rejected' }, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED'],
    ['apply-route-pre-mutation', 'applyRoutePreMutation', { preMutation: false, observed: 'mutated-before-rejection' }, 'APPLY_ROUTE_PRE_MUTATION_REQUIRED'],
    ['journal-route-read-only', 'journalRouteReadOnly', { readOnly: false, observed: 'journal-write-observed' }, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED'],
    ['recovery-inspect-read-only', 'recoveryInspectReadOnly', { readOnly: false, observed: 'inspect-write-observed' }, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED'],
  ];

  for (const [gateId, evidenceKey, failingEvidence, expectedCode] of cases) {
    const evaluation = evaluateReleaseGates({
      env: releaseEnv(),
      evidence: completeEvidence('final-release', {
        [evidenceKey]: { ...failingEvidence, scope: 'final-release' },
      }),
      scope: 'final-release',
      now: fixedNow,
    });
    const gate = gateById(evaluation, gateId);

    assert.equal(gate.status, 'failed', gateId);
    assert.equal(gate.code, expectedCode, gateId);
    assert.equal(gate.evidence.scope, 'final-release', gateId);
    assert.equal(evaluation.releaseMovement.allowed, false, gateId);
    assert.equal(evaluation.releaseMovement.finalGates, '19/20', gateId);
  }
});

test('operator proof gates reject stale marker, timestamp, status row, and zero-exit verifier evidence', () => {
  const cases = [
    [
      'tmux-status-marker',
      { tmuxStatusMarker: { ok: true, marker: 'release-gates:held reason=missing-brackets', scope: 'final-release' } },
      'TMUX_STATUS_MARKER_REQUIRED',
    ],
    [
      'progress-release-timestamp',
      { progressReleaseTimestamp: { iso: 'not-a-date', scope: 'final-release' } },
      'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
    ],
    [
      'agents-release-gates-row',
      { agentsReleaseGateStatusRow: { ok: false, observed: 'stale-row', scope: 'final-release' } },
      'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    ],
    [
      'verify-release-failure-reason',
      { verifyReleaseFailure: { ok: true, exitCode: 0, reason: 'missing-nonzero-failure', scope: 'final-release' } },
      'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
    ],
  ];

  for (const [gateId, override, expectedCode] of cases) {
    const evaluation = evaluateReleaseGates({
      env: releaseEnv(),
      evidence: completeEvidence('final-release', override),
      scope: 'final-release',
      now: fixedNow,
    });
    const gate = gateById(evaluation, gateId);

    assert.equal(gate.status, 'failed', gateId);
    assert.equal(gate.code, expectedCode, gateId);
    assert.equal(evaluation.releaseMovement.allowed, false, gateId);
    assert.equal(evaluation.releaseMovement.finalGates, '19/20', gateId);
  }
});

test('local candidate evidence can be complete while final release readiness remains held', () => {
  const candidate = evaluateReleaseGates({
    env: releaseEnv(),
    evidence: completeEvidence('local-candidate'),
    scope: 'local-candidate',
    now: fixedNow,
  });

  assert.equal(candidate.status, 'candidate-for-review');
  assert.equal(candidate.candidateMovement.allowed, true);
  assert.equal(candidate.candidateMovement.gates, '20/20');
  assert.equal(candidate.releaseMovement.allowed, false);
  assert.equal(candidate.releaseMovement.gates, 'candidate-for-review');
  assert.equal(candidate.releaseMovement.finalGates, '0/20');
  assert.equal(candidate.releaseMovement.candidateGates, '20/20');
  assert.equal(
    candidate.releaseMovement.reason,
    'local candidate evidence is complete, but final release evidence is still required; release hold remains fail-closed',
  );
  assert.equal(candidate.releaseMovement.missingEvidence.length, 20);
  assert.ok(candidate.releaseMovement.missingEvidence.every((entry) => entry.status === 'candidate'));

  const final = evaluateReleaseGates({
    env: releaseEnv(),
    evidence: completeEvidence('final-release'),
    scope: 'final-release',
    now: fixedNow,
  });

  assert.equal(final.status, 'release-ready');
  assert.equal(final.releaseMovement.allowed, true);
  assert.equal(final.releaseMovement.gates, '20/20');
  assert.equal(final.releaseMovement.missingEvidence.length, 0);
});

test('status marker and summary expose a concise fail-closed machine-readable verdict', () => {
  const evaluation = evaluateReleaseGates({
    env: {},
    evidence: {},
    scope: 'final-release',
    now: fixedNow,
  });
  const marker = formatReleaseGateStatusMarker(evaluation);
  const summary = releaseGateSummary(evaluation);

  assert.match(
    marker,
    /^\[release-gates:held final=\d+\/20 candidate=\d+\/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED\]$/,
  );
  assert.equal(summary.status, 'held');
  assert.equal(summary.releaseMovement.allowed, false);
  assert.ok(summary.missingEvidence.some((entry) => entry.rpp === 'RPP-0002'));
});
