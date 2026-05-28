import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0091_SHOULD_NOT_LEAK';
const expectedPreflightRoute = '/wp-json/reprint-push/v1/preflight';
const wrongPreflightRoute = '/wp-json/reprint-push/v1/apply';
const requiredPreflightRouteEvidence = ['preflight route identity checked before mutation'];
const preflightRouteReason = 'Preflight route identity proof failed.';
const statusMarker = '[verify-release:held exit=1 reason=PREFLIGHT_ROUTE_IDENTITY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PREFLIGHT_ROUTE_IDENTITY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const authSessionSourceCommand = `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'${sourceUrl}',username:'${checkedUser}',applicationPassword:'${secretValue}',capabilities:{manage_options:true}}))"`;
const redactedAuthSessionSourceCommand = authSessionSourceCommand.replace(secretValue, '<redacted>');

const expectedFailedRouteEvidence = {
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

const expectedPassedRouteEvidence = {
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
};

function runVerifyReleasePreflightRouteIdentityDrift() {
  return spawnSync('npm', ['run', 'verify:release'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 300_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: authSessionSourceCommand,
      REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: '',
      REPRINT_PUSH_PREFLIGHT_ROUTE_IDENTITY_EXPECTED_ROUTE: expectedPreflightRoute,
      REPRINT_PUSH_PREFLIGHT_ROUTE_IDENTITY_OBSERVED_ROUTE: wrongPreflightRoute,
    },
  });
}

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
      route: expectedPreflightRoute,
      method: 'GET',
      expectedCapability: 'manage_options',
      capabilities: { manage_options: true },
      scope,
    },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: preflightRouteEvidence(),
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
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
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
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

function preflightRouteIdentityEvidenceFromReport(report) {
  return {
    ok: false,
    sameRoute: false,
    observed: report.boundary.preflightRouteIdentity.observed,
    checkedRoute: report.boundary.preflightRouteIdentity.checkedRoute,
    observedRoute: report.boundary.preflightRouteIdentity.observedRoute,
    sourceUrl: report.boundary.preflightRouteIdentity.sourceUrl,
    method: report.boundary.preflightRouteIdentity.method,
    routeNamespace: report.boundary.preflightRouteIdentity.routeNamespace,
    routeName: report.boundary.preflightRouteIdentity.routeName,
    mutationAttempted: report.boundary.preflightRouteIdentity.mutationAttempted,
    scope: 'final-release',
    required: report.boundary.preflightRouteIdentity.required,
  };
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: report.releaseProof.status,
    reason: report.releaseProof.code,
    command: 'npm run verify:release',
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-preflight-route-carry-through-'));
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
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: redactedAuthSessionSourceCommand,
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
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
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
      // npm output can contain braces outside JSON payloads.
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

test('release verifier carries preflight route identity failure before mutation for RPP-0091', () => {
  const proof = runVerifyReleasePreflightRouteIdentityDrift();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the preflight route identity held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'preflight route identity failure must exit before starting live verifier servers',
  );
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));

  assert.deepEqual(
    {
      ok: verifyReport.ok,
      statusMarker: verifyReport.statusMarker,
      mutationAttempted: verifyReport.mutationAttempted,
      topology: verifyReport.topology,
      boundary: verifyReport.boundary,
      preflight: verifyReport.preflight,
      releaseProof: verifyReport.releaseProof,
      authSessionSource: verifyReport.authSessionSource,
      checkedCommand: verifyReport.topologyEvidence.checkedCommand,
      runner: verifyReport.topologyEvidence.runner,
      ports: verifyReport.topologyEvidence.ports,
      sourceService: verifyReport.topologyEvidence.services.source,
      remoteChangedService: verifyReport.topologyEvidence.services.remoteChanged,
      localEditedService: verifyReport.topologyEvidence.services.localEdited,
      topologyEvidence: verifyReport.topologyEvidence.topology,
      releaseMovement: verifyReport.releaseMovement,
    },
    {
      ok: false,
      statusMarker,
      mutationAttempted: false,
      topology: {
        sourceUrl,
        remoteBase: null,
        remoteChanged: null,
        localEdited: null,
      },
      boundary: {
        firstRemainingProductionBoundary: 'preflight route identity on the checked live release path',
        status: 'blocked',
        verdict: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        preflightRouteIdentity: expectedFailedRouteEvidence,
      },
      preflight: {
        status: 0,
        authSessionType: 'preflight-route-identity-mismatch',
        routeProfile: 'production-shaped',
        routeIdentity: expectedFailedRouteEvidence,
        session: {
          id: '',
          type: 'preflight-route-identity-mismatch',
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
      },
      authSessionSource: {
        command: redactedAuthSessionSourceCommand,
        ok: true,
        sourceUrl,
        username: checkedUser,
        applicationPasswordPresent: true,
        capabilities: { manage_options: true },
      },
      checkedCommand: 'timeout 300s npm run verify:release',
      runner: {
        script: 'scripts/playground/production-shaped-live-release-verify.mjs',
        process: 'node',
        routeProfile: 'production-shaped',
        packagedFallbackAllowed: false,
      },
      ports: {
        sandboxIngress: 8080,
        source: 443,
        remoteChanged: 443,
        localEdited: 443,
        applyRevalidationSource: 443,
      },
      sourceService: {
        role: 'source',
        url: sourceUrl,
        kind: 'real WP over https',
        port: 443,
        isPlayground: false,
        isDocker: false,
        isRealWp: true,
        isPackagedPlugin: false,
        isLiveSource: true,
      },
      remoteChangedService: {
        role: 'remote changed/drift source',
        url: remoteChangedUrl,
        kind: 'real WP over https',
        port: 443,
        isPlayground: false,
        isDocker: false,
        isRealWp: true,
        isPackagedPlugin: false,
        isLiveSource: true,
      },
      localEditedService: {
        role: 'local edited site',
        url: localUrl,
        kind: 'real WP over https',
        port: 443,
        isPlayground: false,
        isDocker: false,
        isRealWp: true,
        isPackagedPlugin: false,
        isLiveSource: true,
      },
      topologyEvidence: {
        sourceUrl,
        localEditedSite: localUrl,
        remoteChangedDriftSource: remoteChangedUrl,
        sameRemoteIdentity: null,
        sourceCommand: redactedAuthSessionSourceCommand,
        sourceCommandReadbackUrl: sourceUrl,
        packagedFallbackSource: false,
        blocker: null,
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    preflightRouteIdentity: preflightRouteIdentityEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const routeBucket = releaseGateReport.missingProductionEvidenceBuckets
    .find((bucket) => bucket.bucket === 'route');
  const preflightRouteGate = gateById(releaseGateReport, 'preflight-route-identity');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'route');
  assert.equal(releaseGateReport.primaryFailureCode, 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(preflightRouteGate.evidence, expectedFailedRouteEvidence);
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: preflightRouteReason,
    missingEvidence: [
      {
        id: 'preflight-route-identity',
        rpp: 'RPP-0011',
        status: 'failed',
        code: 'PREFLIGHT_ROUTE_IDENTITY_REQUIRED',
        reason: preflightRouteReason,
        evidence: expectedFailedRouteEvidence,
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
        reason: preflightRouteReason,
        required: requiredPreflightRouteEvidence,
        observed: wrongPreflightRoute,
        scope: 'final-release',
      },
    ],
  });
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier preflight route identity carry-through keeps the matching-route positive path for RPP-0091', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence());
  const releaseGateReport = parseReport(releaseGateResult);
  const preflightRouteGate = gateById(releaseGateReport, 'preflight-route-identity');

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
  assert.deepEqual(preflightRouteGate, {
    id: 'preflight-route-identity',
    rpp: 'RPP-0011',
    title: 'Preflight route identity proof',
    category: 'route',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Preflight route identity proof is backed by final release evidence.',
    evidence: expectedPassedRouteEvidence,
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});
