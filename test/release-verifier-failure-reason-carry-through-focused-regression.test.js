import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const evidenceNotePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0100-release-verifier-failure-reason-carry-through.md',
);

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0100_SHOULD_NOT_LEAK';
const verifierStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=VERIFY_RELEASE_FAILURE_REASON_REQUIRED]';
const requiredVerifyFailureEvidence = 'nonzero verify:release exit with named reason';
const focusedCommand = 'umask 0022 && node --test test/release-verifier-failure-reason-carry-through-focused-regression.test.js';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function runVerifyReleaseMissingSourceForFailureReason() {
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
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: checkedUser,
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
      REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: '',
      REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: '',
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
      scope,
    },
    manageOptionsCapability: {
      ok: true,
      hasManageOptions: true,
      observed: 'manage_options',
      checkedUser,
      route: '/wp-json/reprint-push/v1/preflight',
      method: 'GET',
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
      method: 'POST',
      sourceUrl,
      mutationAttempted: false,
      scope,
    },
    applyRoutePreMutation: {
      ok: true,
      preMutation: true,
      observed: 'PRECONDITION_FAILED',
      observedStatus: 412,
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      checkedRoute: '/wp-json/reprint-push/v1/apply',
      method: 'POST',
      phase: 'before-first-mutation',
      mutationAttempted: false,
      sourceUrl,
      scope,
    },
    journalRouteReadOnly: {
      ok: true,
      readOnly: true,
      observed: 'journal-read-only',
      observedStatus: 200,
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      checkedRoute: '/wp-json/reprint/v1/push/db-journal?limit=80',
      method: 'GET',
      mutatesReleaseState: false,
      mutationAttempted: false,
      sourceUrl,
      scope,
    },
    recoveryInspectReadOnly: {
      ok: true,
      readOnly: true,
      observed: 'inspect-read-only',
      observedStatus: 200,
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      checkedRoute: '/wp-json/reprint/v1/push/recovery/inspect',
      method: 'POST',
      mutatesReleaseState: false,
      mutationAttempted: false,
      sourceUrl,
      scope,
    },
    tmuxStatusMarker: tmuxStatusMarkerEvidence(verifierStatusMarker),
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      statusMarker: verifierStatusMarker,
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function tmuxStatusMarkerEvidence(marker, overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    marker,
    observed: marker,
    command: 'npm run verify:release',
    stdoutVisible: true,
    scope,
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

function missingReasonFailureEvidence(carriedEvidence) {
  return {
    ...carriedEvidence,
    reason: '',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-failure-reason-carry-through-'));
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
    env: {
      PATH: process.env.PATH,
      NODE_NO_WARNINGS: '1',
    },
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

test('release verifier carries verify:release nonzero failure reason and final marker for RPP-0100', () => {
  const proof = runVerifyReleaseMissingSourceForFailureReason();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.equal(
    proof.stdout.trim().split(/\r?\n/).at(-1),
    verifierStatusMarker,
    'verify:release stdout should finish with the carried bracketed status marker',
  );
  assert.match(
    verifierStatusMarker,
    /^\[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false\]$/,
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'missing-source failure reason proof must fail before starting live verifier servers',
  );
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));
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
      statusMarker: verifierStatusMarker,
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

  const carriedFailureEvidence = verifyReleaseFailureFromReport(verifyReport);
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    tmuxStatusMarker: tmuxStatusMarkerEvidence(verifyReport.statusMarker),
    verifyReleaseFailure: carriedFailureEvidence,
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const verifyFailureGate = gateById(releaseGateReport, 'verify-release-failure-reason');
  const tmuxGate = gateById(releaseGateReport, 'tmux-status-marker');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'provenance');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateReadyMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateReadyMarker));
  assert.equal(releaseGateReport.releaseMovement.allowed, true);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '20/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(verifyFailureGate.evidence, {
    ...carriedFailureEvidence,
    required: requiredVerifyFailureEvidence,
    observed: {
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      mutationAttempted: false,
      statusMarker: verifierStatusMarker,
    },
    requiredScope: 'final-release',
  });
  assert.equal(tmuxGate.evidence.observed, verifierStatusMarker);
  assert.equal(tmuxGate.evidence.requiredScope, 'final-release');
  assert.ok(releaseGateResult.stdout.includes(verifierStatusMarker));
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));

  const missingReasonResult = runReleaseGateCheck(completeFinalEvidence({
    tmuxStatusMarker: tmuxStatusMarkerEvidence(verifyReport.statusMarker),
    verifyReleaseFailure: missingReasonFailureEvidence(carriedFailureEvidence),
  }));
  const missingReasonReport = parseReport(missingReasonResult);
  const missingReasonGate = gateById(missingReasonReport, 'verify-release-failure-reason');

  assert.equal(missingReasonResult.status, 1, missingReasonResult.stdout);
  assert.equal(missingReasonReport.ok, false);
  assert.equal(missingReasonReport.exitCode, 1);
  assert.equal(missingReasonReport.releaseStatus, 'NO-GO');
  assert.equal(missingReasonReport.primaryFailureBucket, 'operator-proof');
  assert.equal(missingReasonReport.primaryFailureCode, 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED');
  assert.equal(missingReasonReport.statusMarker, releaseGateHeldMarker);
  assert.ok(missingReasonResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(missingReasonReport.releaseMovement.allowed, false);
  assert.equal(missingReasonReport.releaseMovement.finalGates, '19/20');
  assert.equal(missingReasonReport.mutationAttempted, false);
  assert.deepEqual(missingReasonReport.mutationPolicy, expectedMutationPolicy);
  assert.equal(missingReasonGate.status, 'failed');
  assert.equal(missingReasonGate.blocking, true);
  assert.equal(missingReasonGate.code, 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED');
  assert.equal(
    missingReasonGate.reason,
    'verify:release nonzero failure evidence must include a nonzero exit code and named reason.',
  );
  assert.deepEqual(missingReasonGate.evidence.observed, {
    exitCode: 1,
    reason: 'missing-failure-reason',
    command: 'npm run verify:release',
    mutationAttempted: false,
    statusMarker: verifierStatusMarker,
  });
  assert.equal(missingReasonGate.evidence.required, requiredVerifyFailureEvidence);
  assert.equal(missingReasonGate.evidence.scope, 'final-release');
  assert.equal(missingReasonReport.releaseMovement.missingEvidence.length, 1);
  assert.equal(missingReasonReport.releaseMovement.missingEvidence[0].id, 'verify-release-failure-reason');
  assert.equal(missingReasonReport.releaseMovement.missingEvidence[0].code, 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED');
  assert.doesNotMatch(missingReasonResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(missingReasonResult.stderr, new RegExp(secretValue));
});

test('RPP-0100 evidence note records the focused failure-reason carry-through check', () => {
  const note = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(note.includes('# RPP-0100 release verifier failure reason carry-through'));
  assert.ok(note.includes('Evidence toward `RPP-0100` release verifier `verify:release` nonzero failure reason carry-through.'));
  assert.ok(note.includes(`- Focused command: \`${focusedCommand}\``));
  assert.ok(note.includes(`- Verifier marker carried into \`verifyReleaseFailure.statusMarker\`: \`${verifierStatusMarker}\``));
  assert.ok(note.includes('- Observed status: `pass`; scenarios: `live-missing-source+carried-reason+missing-reason-fail-closed`.'));
  assert.ok(note.includes('No progress.html, checklist, or shared release-verifier implementation files were edited.'));
  assert.ok(note.includes('Checklist item remains unchecked for the integrator.'));
});
