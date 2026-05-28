import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const evidenceReportPath = path.join(repoRoot, 'docs/evidence/ao-release-gates.md');
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const driftedReadbackUrl = 'https://forged.example.test/push';
const secretValue = 'RPP_0086_SHOULD_NOT_LEAK';
const authReadbackReason = 'Auth source command readback drifted from the checked live source URL.';
const focusedCommand = 'node --test test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-auth-source-readback-generated.test.js test/release-verifier-wrong-remote-alias-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const statusMarker = '[verify-release:held exit=1 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const authSessionSourceCommand = `${process.execPath} -e "process.stdout.write(JSON.stringify({sourceUrl:'${driftedReadbackUrl}', username:'admin', applicationPassword:'${secretValue}'}))"`;
const redactedAuthSessionSourceCommand = authSessionSourceCommand.replace(secretValue, '<redacted>');

const expectedDriftEvidence = {
  required: sourceUrl,
  observed: driftedReadbackUrl,
  issuedSourceUrl: sourceUrl,
  readbackSourceUrl: driftedReadbackUrl,
  scope: 'final-release',
};

const expectedPassedReadbackEvidence = {
  required: 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
  observed: sourceUrl,
  issuedSourceUrl: sourceUrl,
  readbackSourceUrl: sourceUrl,
  command: 'node ./scripts/playground/auth-session-source-command.js',
  scope: 'final-release',
  requiredScope: 'final-release',
};

function runVerifyReleaseAuthSourceReadbackDrift() {
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
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: authSessionSourceCommand,
      REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: '',
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
    productionSecret: { ok: true, present: true, observed: 'auth-session-source-command', scope },
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
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

function authSourceReadbackEvidenceFromReport(report) {
  return {
    ok: false,
    issuedSourceUrl: sourceUrl,
    readbackSourceUrl: report.authSessionSource.sourceUrl,
    command: report.authSessionSource.command,
    code: report.releaseProof.code,
    reason: authReadbackReason,
    scope: 'final-release',
  };
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: 1,
    reason: report.releaseProof.code,
    command: 'npm run verify:release',
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-auth-source-readback-carry-through-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
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

test('release verifier carries auth source command readback drift through before mutation for RPP-0086', () => {
  const proof = runVerifyReleaseAuthSourceReadbackDrift();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the auth-source-readback held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'auth source readback drift must fail before starting live verifier servers',
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
        firstRemainingProductionBoundary: 'auth/session source command on the checked live release path',
        status: 'unimplemented',
        verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        durableJournal: {
          storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
        authSession: {
          required: 'same live REPRINT_PUSH_SOURCE_URL at issuance and readback',
          observed: driftedReadbackUrl,
          verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        },
        liveAuthSessionSource: {
          requiredCommand: 'REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND',
          verdict: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
          requiredSourceUrl: sourceUrl,
          observedSourceUrl: driftedReadbackUrl,
          observed: 'forged-or-mismatched-production-auth-session-source',
          error: 'Auth session source command must return the exact checked sourceUrl',
        },
      },
      preflight: {
        status: 0,
        authSessionType: 'forged-or-mismatched-production-auth-session-source',
        routeProfile: 'production-shaped',
        session: {
          id: '',
          type: 'forged-or-mismatched-production-auth-session-source',
        },
      },
      releaseProof: {
        ok: false,
        status: 409,
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      },
      authSessionSource: {
        command: redactedAuthSessionSourceCommand,
        ok: false,
        sourceUrl: driftedReadbackUrl,
        username: 'admin',
        applicationPasswordPresent: true,
        error: 'Auth session source command must return the exact checked sourceUrl',
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
        sourceCommandReadbackUrl: driftedReadbackUrl,
        packagedFallbackSource: false,
        blocker: null,
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    authSourceCommandReadback: authSourceReadbackEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const readbackGate = gateById(releaseGateReport, 'auth-source-readback');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'auth');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(readbackGate.evidence, expectedDriftEvidence);
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: authReadbackReason,
    missingEvidence: [
      {
        id: 'auth-source-readback',
        rpp: 'RPP-0006',
        status: 'failed',
        code: 'PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED',
        reason: authReadbackReason,
        evidence: expectedDriftEvidence,
      },
    ],
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier auth source readback carry-through keeps same-source positive path for RPP-0086', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence());
  const releaseGateReport = parseReport(releaseGateResult);
  const readbackGate = gateById(releaseGateReport, 'auth-source-readback');

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
  assert.deepEqual(readbackGate, {
    id: 'auth-source-readback',
    rpp: 'RPP-0006',
    title: 'Auth source command readback drift',
    category: 'auth',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Auth source command readback drift is backed by final release evidence.',
    evidence: expectedPassedReadbackEvidence,
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier auth source readback carry-through is recorded in RPP-0086 reports', () => {
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');

  assert.ok(evidenceReport.includes('| RPP-0086 | Evidence toward release verifier auth source command readback drift carry-through'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; auth-source-readback gate: \`PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED\`; release marker: \`${releaseGateHeldMarker}\`.`));
  assert.ok(progressReport.includes('Release verifier auth source command readback drift carry-through now checks `RPP-0086`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; auth-source-readback gate: \`PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED\`; release marker: \`${releaseGateHeldMarker}\`.`));
});
