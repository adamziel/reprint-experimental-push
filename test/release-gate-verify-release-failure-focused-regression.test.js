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
const remoteChangedUrl = 'https://changed.example.test/push';
const focusedCommand = 'node --test test/release-gate-verify-release-failure-focused-regression.test.js test/verify-release-failure-reason.test.js test/release-gate-verify-release-failure-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const verifyReleaseStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const invalidVerifyFailureMarker = '[verify-release:held exit=0 reason=missing-nonzero-failure mutationAttempted=false]';
const releaseGateStatusMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const invalidReleaseGateMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=VERIFY_RELEASE_FAILURE_REASON_REQUIRED]';
const requiredVerifyFailureEvidence = 'nonzero verify:release exit with named reason';

function runVerifyReleaseMissingSource() {
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
      REPRINT_PUSH_SOURCE_URL: '',
      REPRINT_PUSH_REMOTE_URL: '',
      REPRINT_PUSH_REMOTE_CHANGED_URL: '',
      REPRINT_PUSH_LOCAL_URL: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
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
    tmuxStatusMarker: { ok: true, marker: releaseGateStatusMarker, scope },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: verifyReleaseFailureEvidence(),
    ...overrides,
  };
}

function verifyReleaseFailureEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    exitCode: 1,
    reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: verifyReleaseStatusMarker,
    mutationAttempted: false,
    scope,
    ...overrides,
  };
}

function invalidZeroExitEvidence() {
  return verifyReleaseFailureEvidence({
    exitCode: 0,
    reason: '',
    statusMarker: invalidVerifyFailureMarker,
  });
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-failure-focused-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidence) {
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
      // Keep scanning; npm output can contain braces outside JSON reports.
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

test('focused verify:release regression emits final held marker before mutation for RPP-0080', () => {
  const proof = runVerifyReleaseMissingSource();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(verifyReleaseStatusMarker),
    'verify:release stdout should end with a tmux-visible bracketed status marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'missing-source proof must fail before starting a mutating/live verifier path',
  );
  assert.ok(verifyReport, proof.stdout);
  assert.deepEqual(
    {
      ok: verifyReport.ok,
      statusMarker: verifyReport.statusMarker,
      mutationAttempted: verifyReport.mutationAttempted,
      releaseProof: verifyReport.releaseProof,
      checkedCommand: verifyReport.topologyEvidence.checkedCommand,
      topologyBlocker: verifyReport.topologyEvidence.topology.blocker,
      releaseMovement: verifyReport.releaseMovement,
    },
    {
      ok: false,
      statusMarker: verifyReleaseStatusMarker,
      mutationAttempted: false,
      releaseProof: {
        ok: false,
        status: 1,
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
      checkedCommand: 'timeout 300s npm run verify:release',
      topologyBlocker: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery.',
      },
    },
  );
});

test('focused verify:release regression preserves nonzero evidence and rejects zero-exit forgery for RPP-0080', () => {
  const validResult = runCheckedCommand(completeFinalEvidence());
  const invalidResult = runCheckedCommand(completeFinalEvidence({
    verifyReleaseFailure: invalidZeroExitEvidence(),
  }));
  const validReport = parseReport(validResult);
  const invalidReport = parseReport(invalidResult);
  const validGate = gateById(validReport, 'verify-release-failure-reason');
  const invalidGate = gateById(invalidReport, 'verify-release-failure-reason');
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');

  assert.ok(evidenceReport.includes('| RPP-0080 | Evidence toward focused `verify:release` nonzero failure reason regression'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; verify:release marker: \`${verifyReleaseStatusMarker}\`; release status: \`NO-GO\`.`));
  assert.ok(progressReport.includes('Focused `verify:release` nonzero failure reason regression now checks `RPP-0080`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; verify:release marker: \`${verifyReleaseStatusMarker}\`; release status: \`NO-GO\`.`));

  assert.equal(validResult.status, 1, validResult.stdout);
  assert.equal(validReport.ok, false);
  assert.equal(validReport.exitCode, 1);
  assert.equal(validReport.releaseStatus, 'NO-GO');
  assert.equal(validReport.primaryFailureBucket, 'provenance');
  assert.equal(validReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(validReport.statusMarker, releaseGateStatusMarker);
  assert.ok(validResult.stdout.includes(releaseGateStatusMarker), 'stdout JSON must expose the final release-gate marker');
  assert.equal(validReport.releaseMovement.allowed, true);
  assert.equal(validReport.releaseMovement.finalGates, '20/20');
  assert.equal(validReport.mutationAttempted, false);
  assert.deepEqual(validGate.evidence, {
    ...verifyReleaseFailureEvidence(),
    required: requiredVerifyFailureEvidence,
    observed: {
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      mutationAttempted: false,
      statusMarker: verifyReleaseStatusMarker,
    },
    requiredScope: 'final-release',
  });

  assert.equal(invalidResult.status, 1, invalidResult.stdout);
  assert.equal(invalidReport.ok, false);
  assert.equal(invalidReport.exitCode, 1);
  assert.equal(invalidReport.releaseStatus, 'NO-GO');
  assert.equal(invalidReport.primaryFailureBucket, 'operator-proof');
  assert.equal(invalidReport.primaryFailureCode, 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED');
  assert.equal(invalidReport.statusMarker, invalidReleaseGateMarker);
  assert.ok(invalidResult.stdout.includes(invalidReleaseGateMarker), 'stdout JSON must expose the held release-gate marker');
  assert.equal(invalidReport.releaseMovement.allowed, false);
  assert.equal(invalidReport.releaseMovement.finalGates, '19/20');
  assert.equal(invalidReport.mutationAttempted, false);
  assert.deepEqual(invalidGate.evidence, {
    ...invalidZeroExitEvidence(),
    required: requiredVerifyFailureEvidence,
    observed: {
      exitCode: 0,
      reason: 'missing-failure-reason',
      command: 'npm run verify:release',
      mutationAttempted: false,
      statusMarker: invalidVerifyFailureMarker,
    },
    scope: 'final-release',
  });
});
