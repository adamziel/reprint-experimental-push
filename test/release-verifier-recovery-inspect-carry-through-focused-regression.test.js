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
const secretValue = 'RPP_0095_SHOULD_NOT_LEAK';
const command = 'npm run verify:release';
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRecoveryRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const requiredRecoveryInspectEvidence = ['recovery inspect read-only proof'];
const recoveryFailureReason = 'Recovery inspect route was not proven read-only.';
const statusMarker = '[verify-release:held exit=1 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=RECOVERY_INSPECT_READ_ONLY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const authSessionSourceCommand = `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'${sourceUrl}',username:'${checkedUser}',applicationPassword:'${secretValue}',capabilities:{manage_options:true}}))"`;
const redactedAuthSessionSourceCommand = authSessionSourceCommand.replace(secretValue, '<redacted>');

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

const expectedRecoveryWriteObservedEvidence = {
  ok: false,
  readOnly: false,
  observed: 'inspect-write-observed',
  observedStatus: 200,
  command,
  checkedCommand,
  checkedRoute: checkedRecoveryRoute,
  method: 'POST',
  mutatesReleaseState: true,
  mutationAttempted: true,
  recoveryRowsBefore: 2,
  recoveryRowsAfter: 3,
  recoveryStateBefore: 'blocked-recovery',
  recoveryStateAfter: 'mutated-recovery',
  sourceUrl,
  scope: 'final-release',
};

const expectedRecoveryReadOnlyEvidence = {
  ok: true,
  readOnly: true,
  observed: 'inspect-read-only',
  observedStatus: 200,
  command,
  checkedCommand,
  checkedRoute: checkedRecoveryRoute,
  method: 'POST',
  mutatesReleaseState: false,
  mutationAttempted: false,
  recoveryRowsBefore: 2,
  recoveryRowsAfter: 2,
  recoveryStateBefore: 'blocked-recovery',
  recoveryStateAfter: 'blocked-recovery',
  sourceUrl,
  scope: 'final-release',
};

function runVerifierRecoveryInspectWriteObserved() {
  const report = verifierRecoveryInspectWriteObservedReport();
  return spawnSync(process.execPath, ['-e', `
const report = ${JSON.stringify(report)};
process.stdout.write(JSON.stringify(report, null, 2));
process.stdout.write('\\n');
process.stdout.write(report.statusMarker);
process.stdout.write('\\n');
process.exit(1);
`], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 300_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      PATH: process.env.PATH,
      NODE_NO_WARNINGS: '1',
    },
  });
}

function verifierRecoveryInspectWriteObservedReport() {
  const recoveryInspectReadOnly = { ...expectedRecoveryWriteObservedEvidence };
  const releaseMovement = {
    allowed: false,
    gates: '0/4',
    reason: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
  };

  return {
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
      firstRemainingProductionBoundary: 'recovery inspect read-only proof on the checked live release path',
      status: 'blocked',
      verdict: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      route: {
        required: 'recovery inspect read-only proof',
        observed: 'inspect-write-observed',
        verdict: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      },
      recoveryInspectReadOnly,
    },
    preflight: {
      status: 0,
      authSessionType: 'inspect-write-observed',
      routeProfile: 'production-shaped',
      session: {
        id: '',
        type: 'inspect-write-observed',
      },
    },
    releaseProof: {
      ok: false,
      status: 1,
      code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
    },
    authSessionSource: {
      command: redactedAuthSessionSourceCommand,
      ok: true,
      sourceUrl,
      username: checkedUser,
      applicationPasswordPresent: true,
      capabilities: { manage_options: true },
    },
    recoveryInspect: {
      status: 200,
      route: checkedRecoveryRoute,
      method: 'POST',
      readOnly: false,
      mutationAttempted: true,
      recovery: {
        state: 'mutated-recovery',
        rowsBefore: 2,
        rowsAfter: 3,
      },
    },
    recoveryInspectReadOnly,
    topologyEvidence: buildTopologyEvidence({ releaseMovement }),
    releaseMovement,
  };
}

function buildTopologyEvidence({ releaseMovement }) {
  return {
    gate: 'GATE-3',
    checkedCommand,
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
    services: {
      source: httpsService('source', sourceUrl),
      remoteChanged: httpsService('remote changed/drift source', remoteChangedUrl),
      localEdited: httpsService('local edited site', localUrl),
      applyRevalidationSource: httpsService('apply revalidation source', sourceUrl),
    },
    topology: {
      sourceUrl,
      localEditedSite: localUrl,
      remoteChangedDriftSource: remoteChangedUrl,
      sameRemoteIdentity: null,
      sourceCommand: redactedAuthSessionSourceCommand,
      sourceCommandReadbackUrl: sourceUrl,
      packagedFallbackSource: false,
      blocker: null,
    },
    releaseMovement,
  };
}

function httpsService(role, url) {
  return {
    role,
    url,
    kind: 'real WP over https',
    port: 443,
    isPlayground: false,
    isDocker: false,
    isRealWp: true,
    isPackagedPlugin: false,
    isLiveSource: true,
  };
}

function completeFinalEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: {
      ok: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
      command: redactedAuthSessionSourceCommand,
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
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ...expectedRecoveryReadOnlyEvidence },
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
      command,
      checkedCommand,
      statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function recoveryInspectReadOnlyEvidenceFromReport(report) {
  return report.recoveryInspectReadOnly;
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: report.releaseProof.status,
    reason: report.releaseProof.code,
    command,
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-recovery-inspect-carry-through-'));
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

test('release verifier carries recovery inspect write-observed proof to held marker for RPP-0095', () => {
  const proof = runVerifierRecoveryInspectWriteObserved();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.equal(proof.stderr, '');
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the recovery inspect read-only held marker',
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
      recoveryInspect: verifyReport.recoveryInspect,
      recoveryInspectReadOnly: verifyReport.recoveryInspectReadOnly,
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
        firstRemainingProductionBoundary: 'recovery inspect read-only proof on the checked live release path',
        status: 'blocked',
        verdict: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        route: {
          required: 'recovery inspect read-only proof',
          observed: 'inspect-write-observed',
          verdict: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        },
        recoveryInspectReadOnly: expectedRecoveryWriteObservedEvidence,
      },
      preflight: {
        status: 0,
        authSessionType: 'inspect-write-observed',
        routeProfile: 'production-shaped',
        session: {
          id: '',
          type: 'inspect-write-observed',
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      },
      authSessionSource: {
        command: redactedAuthSessionSourceCommand,
        ok: true,
        sourceUrl,
        username: checkedUser,
        applicationPasswordPresent: true,
        capabilities: { manage_options: true },
      },
      recoveryInspect: {
        status: 200,
        route: checkedRecoveryRoute,
        method: 'POST',
        readOnly: false,
        mutationAttempted: true,
        recovery: {
          state: 'mutated-recovery',
          rowsBefore: 2,
          rowsAfter: 3,
        },
      },
      recoveryInspectReadOnly: expectedRecoveryWriteObservedEvidence,
      checkedCommand,
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
      sourceService: httpsService('source', sourceUrl),
      remoteChangedService: httpsService('remote changed/drift source', remoteChangedUrl),
      localEditedService: httpsService('local edited site', localUrl),
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
        reason: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    recoveryInspectReadOnly: recoveryInspectReadOnlyEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const recoveryGate = gateById(releaseGateReport, 'recovery-inspect-read-only');
  const expectedGateEvidence = {
    ...expectedRecoveryWriteObservedEvidence,
    required: requiredRecoveryInspectEvidence,
  };

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.status, 'held');
  assert.equal(releaseGateReport.gateState, 'held');
  assert.equal(releaseGateReport.primaryFailureBucket, 'recovery');
  assert.equal(releaseGateReport.primaryFailureCode, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(recoveryGate, {
    id: 'recovery-inspect-read-only',
    rpp: 'RPP-0015',
    title: 'Recovery inspect read-only proof',
    category: 'recovery',
    status: 'failed',
    blocking: true,
    code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
    reason: recoveryFailureReason,
    evidence: expectedGateEvidence,
  });
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: recoveryFailureReason,
    missingEvidence: [
      {
        id: 'recovery-inspect-read-only',
        rpp: 'RPP-0015',
        status: 'failed',
        code: 'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
        reason: recoveryFailureReason,
        evidence: expectedGateEvidence,
      },
    ],
  });
  assert.deepEqual(releaseGateReport.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'recovery'), {
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
        reason: recoveryFailureReason,
        required: requiredRecoveryInspectEvidence,
        observed: 'inspect-write-observed',
        scope: 'final-release',
      },
    ],
  });
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier recovery inspect carry-through keeps the read-only positive path for RPP-0095', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence());
  const releaseGateReport = parseReport(releaseGateResult);
  const recoveryGate = gateById(releaseGateReport, 'recovery-inspect-read-only');

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
  assert.deepEqual(recoveryGate, {
    id: 'recovery-inspect-read-only',
    rpp: 'RPP-0015',
    title: 'Recovery inspect read-only proof',
    category: 'recovery',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Recovery inspect read-only proof is backed by final release evidence.',
    evidence: {
      ...expectedRecoveryReadOnlyEvidence,
      required: requiredRecoveryInspectEvidence,
      requiredScope: 'final-release',
    },
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});
