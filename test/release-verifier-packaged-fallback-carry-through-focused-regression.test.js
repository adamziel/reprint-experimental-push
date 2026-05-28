import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackagedProductionPluginSourceCommand } from '../scripts/playground/packaged-production-plugin-source-command.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const evidenceReportPath = path.join(repoRoot, 'docs/evidence/ao-release-gates.md');
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'http://127.0.0.1:49152';
const remoteChangedUrl = 'http://127.0.0.1:49154';
const localUrl = 'http://127.0.0.1:49153';
const secretValue = 'RPP_0084_SHOULD_NOT_LEAK';
const fallbackReason = 'Packaged production-plugin fallback is support evidence only and cannot move release gates.';
const focusedCommand = 'node --test test/release-verifier-packaged-fallback-carry-through-focused-regression.test.js test/release-gate-packaged-fallback-regression.test.js test/release-gate-packaged-fallback-generated.test.js test/release-verifier-missing-remote-changed-url-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const statusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const packagedAuthSourceCommand = resolvePackagedProductionPluginSourceCommand({
  sourceUrl,
  username: 'admin',
  applicationPassword: secretValue,
});
const redactedPackagedAuthSourceCommand = packagedAuthSourceCommand.replace(secretValue, '<redacted>');

const expectedFailedFallbackEvidence = {
  required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
  observed: 'packaged-production-plugin-fallback',
  scope: 'final-release',
};

const expectedPassedFallbackEvidence = {
  required: 'non-packaged release boundary',
  observed: 'not-packaged-production-plugin-fallback',
  source: 'evidence.packagedFallback',
  scope: 'final-release',
  requiredScope: 'final-release',
};

function runVerifyReleasePackagedFallback() {
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
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: packagedAuthSourceCommand,
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

function packagedFallbackEvidenceFromReport(report) {
  return {
    ok: false,
    observed: true,
    reason: report.boundary.liveSource.observed,
    sourceCommand: report.topologyEvidence.topology.sourceCommand,
    scope: 'final-release',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-packaged-fallback-carry-through-'));
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

test('release verifier carries packaged fallback rejection through before mutation for RPP-0084', () => {
  const proof = runVerifyReleasePackagedFallback();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(statusMarker),
    'verify:release stdout should end with the packaged-fallback held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'packaged fallback must fail before starting live verifier servers',
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
        remoteChanged: remoteChangedUrl,
        localEdited: localUrl,
      },
      boundary: {
        firstRemainingProductionBoundary: 'explicit live production-owned release boundary',
        status: 'blocked',
        verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        liveSource: {
          required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
          observed: 'packaged-production-plugin-fallback',
          verdict: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
        },
      },
      releaseProof: {
        ok: false,
        status: 1,
        code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
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
        source: 49152,
        remoteChanged: 49154,
        localEdited: 49153,
        applyRevalidationSource: 49152,
      },
      sourceService: {
        role: 'source',
        url: sourceUrl,
        kind: 'packaged plugin fallback',
        port: 49152,
        isPlayground: false,
        isDocker: false,
        isRealWp: false,
        isPackagedPlugin: true,
        isLiveSource: false,
      },
      remoteChangedService: {
        role: 'remote changed/drift source',
        url: remoteChangedUrl,
        kind: 'Playground/local loopback WordPress',
        port: 49154,
        isPlayground: true,
        isDocker: false,
        isRealWp: false,
        isPackagedPlugin: false,
        isLiveSource: true,
      },
      localEditedService: {
        role: 'local edited site',
        url: localUrl,
        kind: 'Playground/local loopback WordPress',
        port: 49153,
        isPlayground: true,
        isDocker: false,
        isRealWp: false,
        isPackagedPlugin: false,
        isLiveSource: true,
      },
      topologyEvidence: {
        sourceUrl,
        localEditedSite: localUrl,
        remoteChangedDriftSource: remoteChangedUrl,
        sameRemoteIdentity: null,
        sourceCommand: redactedPackagedAuthSourceCommand,
        sourceCommandReadbackUrl: '',
        packagedFallbackSource: true,
        blocker: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
      },
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: fallbackReason,
      },
    },
  );

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    packagedFallback: packagedFallbackEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const fallbackGate = gateById(releaseGateReport, 'packaged-fallback');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'boundary');
  assert.equal(releaseGateReport.primaryFailureCode, 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(fallbackGate.evidence, expectedFailedFallbackEvidence);
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: fallbackReason,
    missingEvidence: [
      {
        id: 'packaged-fallback',
        rpp: 'RPP-0004',
        status: 'failed',
        code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
        reason: fallbackReason,
        evidence: expectedFailedFallbackEvidence,
      },
    ],
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier packaged fallback carry-through keeps the non-fallback scenario matrix path for RPP-0084', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    packagedFallback: { ok: true, observed: false, scope: 'final-release' },
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const fallbackGate = gateById(releaseGateReport, 'packaged-fallback');

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
  assert.deepEqual(fallbackGate, {
    id: 'packaged-fallback',
    rpp: 'RPP-0004',
    title: 'Packaged fallback rejection',
    category: 'boundary',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Packaged fallback rejection is backed by final release evidence.',
    evidence: expectedPassedFallbackEvidence,
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier packaged fallback carry-through is recorded in RPP-0084 reports', () => {
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');

  assert.ok(evidenceReport.includes('| RPP-0084 | Evidence toward release verifier packaged fallback rejection carry-through'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; fallback gate: \`REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED\`; scenario matrix: \`negative+positive\`.`));
  assert.ok(progressReport.includes('Release verifier packaged fallback rejection carry-through now checks `RPP-0084`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; verifier marker: \`${statusMarker}\`; fallback gate: \`REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED\`; scenario matrix: \`negative+positive\`.`));
});
