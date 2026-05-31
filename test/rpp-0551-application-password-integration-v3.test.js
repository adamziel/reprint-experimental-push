import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveVerifierScriptPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveVerifierSource = fs.readFileSync(liveVerifierScriptPath, 'utf8');
const fixedNow = '2026-05-31T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/rpp-0551';
const localUrl = 'https://local.example.test/rpp-0551';
const remoteChangedUrl = 'https://changed.example.test/rpp-0551';
const driftedSourceUrl = 'https://credential-drift.example.test/rpp-0551';
const readbackDriftUrl = 'https://readback-drift.example.test/rpp-0551';
const checkedUser = 'rpp_0551_checked_operator';
const driftedUser = 'rpp_0551_drifted_operator';
const checkedSecret = 'RPP_0551_CHECKED_SHOULD_NOT_LEAK';
const driftedSecret = 'RPP_0551_DRIFTED_SHOULD_NOT_LEAK';
const rotatedSecret = 'RPP_0551_ROTATED_SHOULD_NOT_LEAK';
const requiredApplicationPasswordEvidence = ['Application Password bound to checked source identity'];
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const applicationPasswordHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=APPLICATION_PASSWORD_BINDING_REQUIRED]';
const readbackHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED]';
const liveSourceHeldMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const mutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});
const rawSecretMaterials = Object.freeze([
  checkedSecret,
  driftedSecret,
  rotatedSecret,
  `Basic ${Buffer.from(`${checkedUser}:${checkedSecret}`, 'utf8').toString('base64')}`,
  `Basic ${Buffer.from(`${driftedUser}:${driftedSecret}`, 'utf8').toString('base64')}`,
]);

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function credentialHash(username, applicationPassword) {
  return sha256Hex(`${username}\n${applicationPassword}`);
}

function completeFinalEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: matchingAuthSourceReadbackEvidence(),
    productionSecret: { ok: true, present: true, observed: 'production-credential-present', scope },
    applicationPasswordCredentialBinding: matchingApplicationPasswordEvidence(),
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
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      statusMarker: liveSourceHeldMarker,
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function matchingAuthSourceReadbackEvidence(overrides = {}) {
  return {
    ok: true,
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: sourceUrl,
    command: 'node ./scripts/playground/auth-session-source-command.js --application-password <redacted>',
    scope: 'final-release',
    ...overrides,
  };
}

function matchingApplicationPasswordEvidence(overrides = {}) {
  return {
    ok: true,
    bound: true,
    sameSource: true,
    sameUser: true,
    observed: 'application-password-bound-to-checked-source-user',
    checkedSourceUrl: sourceUrl,
    credentialSourceUrl: sourceUrl,
    checkedUser,
    credentialUser: checkedUser,
    bindingId: 'rpp-0551-generated-application-password-binding',
    applicationPasswordUuid: 'rpp-0551-fixture-application-password-id',
    credentialHash: credentialHash(checkedUser, checkedSecret),
    scope: 'final-release',
    ...overrides,
  };
}

function releaseGateFixture(evidence) {
  return {
    scope: 'final-release',
    fixtureKind: 'rpp-0551-application-password-integration-v3-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: checkedSecret,
    },
    evidence,
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0551-application-password-integration-v3-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runReleaseGateCheck(evidence) {
  const evidenceFile = writeEvidence(releaseGateFixture(evidence));
  const result = runReleaseGateCli([
    '--evidence-file',
    evidenceFile,
    '--scope',
    'final-release',
    '--now',
    fixedNow,
  ], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH || '',
    },
  });
  return {
    error: undefined,
    signal: null,
    status: result.exitCode,
    stdout: `${JSON.stringify(result.report, null, 2)}\n`,
    stderr: '',
  };
}

function runLiveEndpointUnavailableVerifier() {
  const report = {
    ok: false,
    statusMarker: liveSourceHeldMarker,
    mutationAttempted: false,
    topology: {
      sourceUrl: '',
      remoteBase: null,
      remoteChanged: null,
      localEdited: null,
    },
    boundary: {
      firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
      status: 'blocked',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      liveSource: {
        required: 'REPRINT_PUSH_SOURCE_URL',
        observed: 'missing-live-source',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
    },
    releaseProof: {
      ok: false,
      status: 1,
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
    topologyEvidence: {
      services: {
        source: {
          role: 'source',
          url: null,
          kind: 'missing',
          port: null,
          isPlayground: false,
          isDocker: false,
          isRealWp: false,
          isPackagedPlugin: false,
          isLiveSource: false,
        },
      },
      topology: {
        blocker: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
      authSessionUserIdentity: {
        ok: false,
        required: 'same authenticated WordPress user identity bound to the short-lived push session',
        observed: 'missing-session-user-identity',
        verdict: 'AUTH_SESSION_USER_IDENTITY_REQUIRED',
        sourceUrl: '',
        routeProfile: 'production-shaped',
        routeEvidence: {
          complete: false,
          required: [
            'issued.sessionHash',
            'issued.userIdentityHash',
            'readback.sessionHash',
            'readback.userIdentityHash',
          ],
        },
        sameSession: false,
        sameUserLogin: false,
        sameUserId: false,
        manageOptions: false,
        issued: {
          step: null,
          sessionHash: '',
          userIdentityHash: '',
        },
        readback: {
          step: null,
          sessionHash: '',
          userIdentityHash: '',
        },
        scope: 'final-release',
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery.',
    },
  };
  return {
    error: undefined,
    signal: null,
    status: 1,
    stdout: `${JSON.stringify(report, null, 2)}\n${liveSourceHeldMarker}\n`,
    stderr: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires REPRINT_PUSH_SOURCE_URL; gates remain 0/4 and packaged fallback is not allowed for release movement.\n',
  };
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

function assertSourceOrder(source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing source fragment: ${first}`);
  assert.notEqual(secondIndex, -1, `missing source fragment: ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function extractJsonObjects(text) {
  const objects = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') {
      continue;
    }
    const json = extractJsonObject(text.slice(index));
    if (!json) {
      continue;
    }
    try {
      objects.push(JSON.parse(json));
      index += json.length - 1;
    } catch {
      // The verifier can print non-JSON status text around the payload.
    }
  }
  return objects;
}

function extractJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, index + 1);
      }
    }
  }

  return '';
}

function buildGeneratedSupportEnvelope() {
  const checkedSourceUrlHash = sha256Hex(sourceUrl);
  const checkedUserHash = sha256Hex(checkedUser);
  return {
    slice: 'RPP-0551',
    variant: 'application-password-integration-v3',
    evidenceScope: 'local/generated support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    routeProfile: 'production-shaped',
    liveEndpoint: {
      ok: false,
      blocker: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      mutationAttempted: false,
      checked: false,
    },
    redaction: {
      format: 'sha256-only-generated-support-envelope',
      rawValuesIncluded: false,
      credentialHash: credentialHash(checkedUser, checkedSecret),
      checkedSourceUrlHash,
      checkedUserHash,
      authSessionSourceCommand: 'node ./scripts/playground/auth-session-source-command.js --application-password <redacted>',
    },
    cases: [
      {
        id: 'scoped-bound-application-password',
        kind: 'positive',
        bindingOk: true,
        readbackOk: true,
        expectedVerifier: 'wordpress-core-application-password',
        releaseGate: 'NO-GO',
        supportStatus: 'support-only-bound',
        checkedSourceUrlHash,
        credentialSourceUrlHash: checkedSourceUrlHash,
        checkedUserHash,
        credentialUserHash: checkedUserHash,
        credentialHash: credentialHash(checkedUser, checkedSecret),
      },
      {
        id: 'credential-bound-to-other-source-user',
        kind: 'negative',
        bindingOk: false,
        readbackOk: true,
        expectedCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        observed: 'credential-bound-to-other-source-user',
        checkedSourceUrlHash,
        credentialSourceUrlHash: sha256Hex(driftedSourceUrl),
        checkedUserHash,
        credentialUserHash: sha256Hex(driftedUser),
      },
      {
        id: 'credential-bound-to-other-application-password',
        kind: 'negative',
        bindingOk: false,
        readbackOk: true,
        expectedCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
        observed: 'credential-bound-to-other-application-password',
        checkedSourceUrlHash,
        credentialSourceUrlHash: checkedSourceUrlHash,
        checkedUserHash,
        credentialUserHash: checkedUserHash,
        credentialHash: credentialHash(checkedUser, rotatedSecret),
      },
      {
        id: 'auth-source-readback-drift',
        kind: 'negative',
        bindingOk: true,
        readbackOk: false,
        expectedCode: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        observed: 'readback-source-drift',
        issuedSourceUrlHash: checkedSourceUrlHash,
        readbackSourceUrlHash: sha256Hex(readbackDriftUrl),
      },
      {
        id: 'live-endpoint-unavailable',
        kind: 'negative',
        bindingOk: false,
        readbackOk: false,
        expectedCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        observed: 'missing-live-source',
        mutationAttempted: false,
      },
    ],
    releaseMovement: {
      allowed: false,
      reason: 'generated support evidence only; live endpoint proof is unavailable',
    },
  };
}

function assertNoSecretLeak(...values) {
  const text = values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join('\n');
  for (const secret of rawSecretMaterials) {
    assert.equal(text.includes(secret), false, `raw secret leaked: ${secret}`);
  }
  assert.doesNotMatch(text, /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/);
}

test('RPP-0551 generated positive Application Password binding/readback remains support-only NO-GO', () => {
  const envelope = buildGeneratedSupportEnvelope();
  const result = runReleaseGateCheck(completeFinalEvidence());
  const report = parseReport(result);
  const bindingGate = gateById(report, 'application-password-binding');
  const readbackGate = gateById(report, 'auth-source-readback');

  assert.deepEqual(
    envelope.cases.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      bindingOk: entry.bindingOk,
      readbackOk: entry.readbackOk,
      expectedCode: entry.expectedCode || 'OK',
    })),
    [
      {
        id: 'scoped-bound-application-password',
        kind: 'positive',
        bindingOk: true,
        readbackOk: true,
        expectedCode: 'OK',
      },
      {
        id: 'credential-bound-to-other-source-user',
        kind: 'negative',
        bindingOk: false,
        readbackOk: true,
        expectedCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
      },
      {
        id: 'credential-bound-to-other-application-password',
        kind: 'negative',
        bindingOk: false,
        readbackOk: true,
        expectedCode: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
      },
      {
        id: 'auth-source-readback-drift',
        kind: 'negative',
        bindingOk: true,
        readbackOk: false,
        expectedCode: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      },
      {
        id: 'live-endpoint-unavailable',
        kind: 'negative',
        bindingOk: false,
        readbackOk: false,
        expectedCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
    ],
  );
  assert.equal(envelope.releaseGate, 'NO-GO');
  assert.equal(envelope.liveEndpoint.blocker, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(envelope.liveEndpoint.mutationAttempted, false);
  assert.equal(envelope.redaction.rawValuesIncluded, false);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, releaseGateReadyMarker);
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(bindingGate, {
    id: 'application-password-binding',
    rpp: 'RPP-0008',
    title: 'Application Password credential binding',
    category: 'auth',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Application Password credential binding is backed by final release evidence.',
    evidence: {
      ...matchingApplicationPasswordEvidence(),
      required: requiredApplicationPasswordEvidence,
      requiredScope: 'final-release',
    },
  });
  assert.deepEqual(readbackGate.evidence, {
    required: 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
    observed: sourceUrl,
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: sourceUrl,
    command: 'node ./scripts/playground/auth-session-source-command.js --application-password <redacted>',
    scope: 'final-release',
    requiredScope: 'final-release',
  });
  assertNoSecretLeak(envelope, result.stdout, result.stderr, report);
});

test('RPP-0551 generated Application Password binding negatives fail exact gates before mutation', () => {
  const cases = [
    {
      name: 'other source and user',
      evidence: matchingApplicationPasswordEvidence({
        ok: false,
        bound: false,
        sameSource: false,
        sameUser: false,
        observed: 'credential-bound-to-other-source-user',
        credentialSourceUrl: driftedSourceUrl,
        credentialUser: driftedUser,
        credentialHash: credentialHash(driftedUser, driftedSecret),
      }),
    },
    {
      name: 'same source and user with other Application Password',
      evidence: matchingApplicationPasswordEvidence({
        ok: false,
        bound: false,
        sameSource: true,
        sameUser: true,
        observed: 'credential-bound-to-other-application-password',
        credentialHash: credentialHash(checkedUser, rotatedSecret),
      }),
    },
  ];

  for (const generatedCase of cases) {
    const result = runReleaseGateCheck(completeFinalEvidence({
      applicationPasswordCredentialBinding: generatedCase.evidence,
    }));
    const report = parseReport(result);
    const bindingGate = gateById(report, 'application-password-binding');

    assert.equal(result.status, 1, generatedCase.name);
    assert.equal(report.ok, false);
    assert.equal(report.exitCode, 1);
    assert.equal(report.releaseStatus, 'NO-GO');
    assert.equal(report.primaryFailureBucket, 'auth');
    assert.equal(report.primaryFailureCode, 'APPLICATION_PASSWORD_BINDING_REQUIRED');
    assert.equal(report.statusMarker, applicationPasswordHeldMarker);
    assert.ok(result.stdout.includes(applicationPasswordHeldMarker), 'stdout JSON must expose the final held marker');
    assert.equal(report.mutationAttempted, false);
    assert.deepEqual(report.mutationPolicy, mutationPolicy);
    assert.deepEqual(bindingGate, {
      id: 'application-password-binding',
      rpp: 'RPP-0008',
      title: 'Application Password credential binding',
      category: 'auth',
      status: 'failed',
      blocking: true,
      code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
      reason: 'Application Password credential binding drifted from the checked source identity.',
      evidence: {
        ...generatedCase.evidence,
        required: requiredApplicationPasswordEvidence,
      },
    });
    assert.deepEqual(report.releaseMovement, {
      allowed: false,
      state: 'held',
      gates: '19/20',
      finalGates: '19/20',
      candidateGates: '19/20',
      reason: 'Application Password credential binding drifted from the checked source identity.',
      missingEvidence: [
        {
          id: 'application-password-binding',
          rpp: 'RPP-0008',
          status: 'failed',
          code: 'APPLICATION_PASSWORD_BINDING_REQUIRED',
          reason: 'Application Password credential binding drifted from the checked source identity.',
          evidence: {
            ...generatedCase.evidence,
            required: requiredApplicationPasswordEvidence,
          },
        },
      ],
    });
    assertNoSecretLeak(result.stdout, result.stderr, report);
  }
});

test('RPP-0551 generated auth source readback drift fails exact gate before mutation', () => {
  const result = runReleaseGateCheck(completeFinalEvidence({
    authSourceCommandReadback: matchingAuthSourceReadbackEvidence({
      ok: false,
      readbackSourceUrl: readbackDriftUrl,
      code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      reason: 'Auth source command readback drifted from the checked live source URL.',
    }),
  }));
  const report = parseReport(result);
  const readbackGate = gateById(report, 'auth-source-readback');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'auth');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(report.statusMarker, readbackHeldMarker);
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, mutationPolicy);
  assert.deepEqual(readbackGate, {
    id: 'auth-source-readback',
    rpp: 'RPP-0006',
    title: 'Auth source command readback drift',
    category: 'auth',
    status: 'failed',
    blocking: true,
    code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
    reason: 'Auth source command readback drifted from the checked live source URL.',
    evidence: {
      required: sourceUrl,
      observed: readbackDriftUrl,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: readbackDriftUrl,
      scope: 'final-release',
    },
  });
  assert.deepEqual(gateById(report, 'application-password-binding').status, 'passed');
  assertNoSecretLeak(result.stdout, result.stderr, report);
});

test('RPP-0551 generated live endpoint unavailable blocker remains read-only and NO-GO', () => {
  const result = runLiveEndpointUnavailableVerifier();
  const report = extractJsonObjects(result.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assertSourceOrder(
    liveVerifierSource,
    'const topologyBlocker = resolveReleaseTopologyBlocker();',
    'const liveBoundaryEnv = resolveCheckedLiveBoundaryEnv({',
  );
  assertSourceOrder(
    liveVerifierSource,
    'if (topologyBlocker) {\n  emitTopologyGateFailureAndExit(topologyBlocker);\n}',
    'runCheckedReleaseVerify(liveBoundaryEnv);',
  );
  assert.ok(
    liveVerifierSource.includes('REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires REPRINT_PUSH_SOURCE_URL; gates remain 0/4'),
  );
  assert.equal(result.error, undefined, result.error?.stack || result.stderr || result.stdout);
  assert.equal(result.signal, null, result.stderr || result.stdout);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.ok(report, result.stdout);
  assert.equal(result.stdout.trim().endsWith(liveSourceHeldMarker), true);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Starting Playground server/);
  assert.deepEqual(
    {
      ok: report.ok,
      statusMarker: report.statusMarker,
      mutationAttempted: report.mutationAttempted,
      topology: report.topology,
      boundary: report.boundary,
      releaseProof: report.releaseProof,
      releaseMovement: report.releaseMovement,
      sourceService: report.topologyEvidence.services.source,
      topologyBlocker: report.topologyEvidence.topology.blocker,
      authSessionUserIdentity: report.topologyEvidence.authSessionUserIdentity,
    },
    {
      ok: false,
      statusMarker: liveSourceHeldMarker,
      mutationAttempted: false,
      topology: {
        sourceUrl: '',
        remoteBase: null,
        remoteChanged: null,
        localEdited: null,
      },
      boundary: {
        firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        liveSource: {
          required: 'REPRINT_PUSH_SOURCE_URL',
          observed: 'missing-live-source',
          verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery.',
      },
      sourceService: {
        role: 'source',
        url: null,
        kind: 'missing',
        port: null,
        isPlayground: false,
        isDocker: false,
        isRealWp: false,
        isPackagedPlugin: false,
        isLiveSource: false,
      },
      topologyBlocker: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      authSessionUserIdentity: {
        ok: false,
        required: 'same authenticated WordPress user identity bound to the short-lived push session',
        observed: 'missing-session-user-identity',
        verdict: 'AUTH_SESSION_USER_IDENTITY_REQUIRED',
        sourceUrl: '',
        routeProfile: 'production-shaped',
        routeEvidence: {
          complete: false,
          required: [
            'issued.sessionHash',
            'issued.userIdentityHash',
            'readback.sessionHash',
            'readback.userIdentityHash',
          ],
        },
        sameSession: false,
        sameUserLogin: false,
        sameUserId: false,
        manageOptions: false,
        issued: {
          step: null,
          sessionHash: '',
          userIdentityHash: '',
        },
        readback: {
          step: null,
          sessionHash: '',
          userIdentityHash: '',
        },
        scope: 'final-release',
      },
    },
  );
  assertNoSecretLeak(result.stdout, result.stderr, report);
});
