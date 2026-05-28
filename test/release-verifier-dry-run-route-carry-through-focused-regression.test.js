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
const expectedDryRunRoute = '/wp-json/reprint-push/v1/dry-run';
const ineligibleObservedStatus = 'dry-run-route-rejected-before-plan-upload';
const secretValue = 'RPP_0092_SHOULD_NOT_LEAK';
const requiredDryRunEvidence = ['dry-run route eligibility checked before apply'];
const expectedFailureReason = 'Dry-run route eligibility proof failed.';
const statusMarker = '[verify-release:held exit=1 reason=DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const authSessionSourceCommand = `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'${sourceUrl}',username:'${checkedUser}',applicationPassword:'${secretValue}',capabilities:{manage_options:true}}))"`;
const redactedAuthSessionSourceCommand = authSessionSourceCommand.replace(secretValue, '<redacted>');

const expectedVerifierDryRunEvidence = {
  ok: false,
  eligible: false,
  observed: ineligibleObservedStatus,
  checkedRoute: expectedDryRunRoute,
  sourceUrl,
  method: 'POST',
  routeNamespace: 'reprint-push/v1',
  routeName: 'dry-run',
  planUploadAllowed: false,
  applyAttempted: false,
  mutationAttempted: false,
  scope: 'final-release',
  rejectionStatus: 403,
  rejectionCode: 'dry_run_route_not_allowed',
};

const expectedGateDryRunEvidence = {
  ...expectedVerifierDryRunEvidence,
  required: requiredDryRunEvidence,
};

const expectedPassedDryRunEvidence = {
  ok: true,
  eligible: true,
  observed: expectedDryRunRoute,
  checkedRoute: expectedDryRunRoute,
  sourceUrl,
  method: 'POST',
  routeNamespace: 'reprint-push/v1',
  routeName: 'dry-run',
  planUploadAllowed: true,
  applyAttempted: false,
  mutationAttempted: false,
  scope: 'final-release',
  required: requiredDryRunEvidence,
  requiredScope: 'final-release',
};

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function runVerifyReleaseDryRunRouteIneligible() {
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
      REPRINT_PUSH_SIMULATE_DRY_RUN_ROUTE_ELIGIBILITY_FAILURE: '1',
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
      route: '/wp-json/reprint-push/v1/preflight',
      method: 'GET',
      expectedCapability: 'manage_options',
      capabilities: { manage_options: true },
      scope,
    },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: {
      ok: true,
      eligible: true,
      observed: expectedDryRunRoute,
      checkedRoute: expectedDryRunRoute,
      sourceUrl,
      method: 'POST',
      routeNamespace: 'reprint-push/v1',
      routeName: 'dry-run',
      planUploadAllowed: true,
      applyAttempted: false,
      mutationAttempted: false,
      scope,
    },
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

function dryRunRouteEligibilityEvidenceFromReport(report) {
  return report.dryRunRouteEligibility;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-dry-run-route-carry-through-'));
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

test('release verifier carries dry-run route eligibility failure before mutation for RPP-0092', () => {
  const proof = runVerifyReleaseDryRunRouteIneligible();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the dry-run route held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'dry-run route eligibility must fail before starting live verifier servers',
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
      dryRunRouteEligibility: verifyReport.dryRunRouteEligibility,
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
        firstRemainingProductionBoundary: 'dry-run route eligibility on the checked live release path',
        status: 'blocked',
        verdict: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        route: {
          required: 'dry-run route eligibility checked before apply',
          observed: ineligibleObservedStatus,
          verdict: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        },
        dryRunRouteEligibility: expectedVerifierDryRunEvidence,
      },
      preflight: {
        status: 0,
        authSessionType: ineligibleObservedStatus,
        routeProfile: 'production-shaped',
        session: {
          id: '',
          type: ineligibleObservedStatus,
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
      },
      authSessionSource: {
        command: redactedAuthSessionSourceCommand,
        ok: true,
        sourceUrl,
        username: checkedUser,
        applicationPasswordPresent: true,
        capabilities: { manage_options: true },
      },
      dryRunRouteEligibility: expectedVerifierDryRunEvidence,
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
        reason: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    dryRunRouteEligibility: dryRunRouteEligibilityEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const dryRunGate = gateById(releaseGateReport, 'dry-run-route-eligibility');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.status, 'held');
  assert.equal(releaseGateReport.gateState, 'held');
  assert.equal(releaseGateReport.primaryFailureBucket, 'route');
  assert.equal(releaseGateReport.primaryFailureCode, 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(dryRunGate, {
    id: 'dry-run-route-eligibility',
    rpp: 'RPP-0012',
    title: 'Dry-run route eligibility proof',
    category: 'route',
    status: 'failed',
    blocking: true,
    code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
    reason: expectedFailureReason,
    evidence: expectedGateDryRunEvidence,
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
        id: 'dry-run-route-eligibility',
        rpp: 'RPP-0012',
        status: 'failed',
        code: 'DRY_RUN_ROUTE_ELIGIBILITY_REQUIRED',
        reason: expectedFailureReason,
        evidence: expectedGateDryRunEvidence,
      },
    ],
  });
  assert.deepEqual(releaseGateReport.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'route'), {
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
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier dry-run route carry-through keeps eligible positive path for RPP-0092', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence());
  const releaseGateReport = parseReport(releaseGateResult);
  const dryRunGate = gateById(releaseGateReport, 'dry-run-route-eligibility');

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
  assert.deepEqual(dryRunGate, {
    id: 'dry-run-route-eligibility',
    rpp: 'RPP-0012',
    title: 'Dry-run route eligibility proof',
    category: 'route',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Dry-run route eligibility proof is backed by final release evidence.',
    evidence: expectedPassedDryRunEvidence,
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});
