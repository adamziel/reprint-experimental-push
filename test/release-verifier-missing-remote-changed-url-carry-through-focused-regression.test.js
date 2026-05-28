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
const localUrl = 'https://local.example.test/push';
const secretValue = 'RPP_0083_SHOULD_NOT_LEAK';
const focusedCommand = 'node --test test/release-verifier-missing-remote-changed-url-carry-through-focused-regression.test.js test/release-gate-missing-remote-changed-url-regression.test.js test/release-gate-remote-changed-url-generated.test.js test/release-verifier-missing-local-url-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const statusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED mutationAttempted=false]';
const releaseGateStatusMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED]';
const remoteChangedReason = 'REPRINT_PUSH_REMOTE_CHANGED_URL is required to prove stale remote replay fails before mutation.';
const expectedMissingRemoteChangedEvidence = {
  required: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
  observed: 'missing-remote-changed-source',
  envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
  scope: 'missing',
};

function runVerifyReleaseMissingOnlyRemoteChanged() {
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
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_REMOTE_CHANGED_URL: '',
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
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
      marker: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-missing-remote-changed-carry-through-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: 'admin',
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

test('release verifier carries missing REPRINT_PUSH_REMOTE_CHANGED_URL through before mutation for RPP-0083', () => {
  const proof = runVerifyReleaseMissingOnlyRemoteChanged();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the missing-remote-changed-url held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'missing changed-remote URL must fail before starting live verifier servers',
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
      releaseProof: verifyReport.releaseProof,
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
        remoteBase: sourceUrl,
        remoteChanged: null,
        localEdited: localUrl,
      },
      boundary: {
        firstRemainingProductionBoundary: 'source/local/changed production topology',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
        topology: {
          required: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
          observed: {
            sourceUrl,
            remoteChangedUrl: '',
            localUrl,
          },
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
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
        remoteChanged: null,
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
        url: null,
        kind: 'missing',
        port: null,
        isPlayground: false,
        isDocker: false,
        isRealWp: false,
        isPackagedPlugin: false,
        isLiveSource: false,
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
        remoteChangedDriftSource: '',
        sameRemoteIdentity: null,
        sourceCommand: '',
        sourceCommandReadbackUrl: '',
        packagedFallbackSource: false,
        blocker: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: remoteChangedReason,
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const remoteChangedGate = gateById(releaseGateReport, 'remote-changed-url');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'topology');
  assert.equal(releaseGateReport.primaryFailureCode, 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateStatusMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateStatusMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(remoteChangedGate.evidence, expectedMissingRemoteChangedEvidence);
  assert.equal(gateById(releaseGateReport, 'source-url').status, 'passed');
  assert.equal(gateById(releaseGateReport, 'local-url').status, 'passed');
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: remoteChangedReason,
    missingEvidence: [
      {
        id: 'remote-changed-url',
        rpp: 'RPP-0003',
        status: 'missing',
        code: 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED',
        reason: remoteChangedReason,
        evidence: expectedMissingRemoteChangedEvidence,
      },
    ],
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier missing changed-remote carry-through is recorded in RPP-0083 reports', () => {
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');

  assert.ok(evidenceReport.includes('| RPP-0083 | Evidence toward release verifier missing `REPRINT_PUSH_REMOTE_CHANGED_URL` carry-through'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; changed-remote gate: \`REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED\`; release status: \`NO-GO\`.`));
  assert.ok(progressReport.includes('Release verifier missing changed-remote URL carry-through now checks'));
  assert.ok(progressReport.includes('`RPP-0083`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; changed-remote gate: \`REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED\`; release status: \`NO-GO\`.`));
});
