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
  'docs/evidence/rpp-0097-release-verifier-tmux-status-marker-carry-through.md',
);

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0097_SHOULD_NOT_LEAK';
const verifierStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const malformedCarriedMarker = verifierStatusMarker.slice(1, -1);
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=TMUX_STATUS_MARKER_REQUIRED]';
const focusedCommand = 'umask 0022 && node --test test/release-verifier-tmux-status-marker-carry-through-focused-regression.test.js test/release-gate-tmux-status-marker-focused-regression.test.js test/release-gate-tmux-status-marker-generated.test.js test/release-gate-cli.test.js test/release-gates.test.js';
const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

const expectedPassedTmuxEvidence = {
  required: 'final bracketed stdout status marker',
  observed: verifierStatusMarker,
  scope: 'final-release',
  requiredScope: 'final-release',
};

const expectedFailedTmuxEvidence = {
  required: 'final bracketed stdout status marker',
  observed: malformedCarriedMarker,
  scope: 'final-release',
};

function runVerifyReleaseMissingSourceForMarker() {
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
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

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-tmux-marker-carry-through-'));
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

test('release verifier carries its final tmux-visible stdout marker into the release-gate marker evidence for RPP-0097', () => {
  const proof = runVerifyReleaseMissingSourceForMarker();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.equal(verifyReport.statusMarker, verifierStatusMarker);
  assert.equal(verifyReport.mutationAttempted, false);
  assert.ok(
    proof.stdout.trim().endsWith(verifierStatusMarker),
    'verify:release stdout should end with the carried tmux-visible held marker',
  );
  assert.match(
    proof.stderr,
    /REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires REPRINT_PUSH_SOURCE_URL; gates remain 0\/4 and packaged fallback is not allowed for release movement\./,
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'marker carry-through source proof must fail before starting live verifier servers',
  );
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    tmuxStatusMarker: tmuxStatusMarkerEvidence(verifyReport.statusMarker),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const tmuxGate = gateById(releaseGateReport, 'tmux-status-marker');
  const verifyFailureGate = gateById(releaseGateReport, 'verify-release-failure-reason');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'provenance');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateReadyMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateReadyMarker));
  assert.ok(releaseGateResult.stdout.includes(verifierStatusMarker));
  assert.equal(releaseGateReport.releaseMovement.allowed, true);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '20/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(tmuxGate, {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'tmux stdout proof status marker is backed by final release evidence.',
    evidence: expectedPassedTmuxEvidence,
  });
  assert.equal(verifyFailureGate.evidence.statusMarker, verifierStatusMarker);
  assert.equal(verifyFailureGate.evidence.observed.statusMarker, verifierStatusMarker);
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 0);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier tmux marker carry-through fails closed when the carried marker loses brackets for RPP-0097', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    tmuxStatusMarker: tmuxStatusMarkerEvidence(malformedCarriedMarker),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const tmuxGate = gateById(releaseGateReport, 'tmux-status-marker');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'operator-proof');
  assert.equal(releaseGateReport.primaryFailureCode, 'TMUX_STATUS_MARKER_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.releaseMovement.allowed, false);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '19/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(tmuxGate, {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'TMUX_STATUS_MARKER_REQUIRED',
    reason: 'The tmux stdout status marker is missing or not bracketed.',
    evidence: expectedFailedTmuxEvidence,
  });
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'The tmux stdout status marker is missing or not bracketed.',
    missingEvidence: [
      {
        id: 'tmux-status-marker',
        rpp: 'RPP-0017',
        status: 'failed',
        code: 'TMUX_STATUS_MARKER_REQUIRED',
        reason: 'The tmux stdout status marker is missing or not bracketed.',
        evidence: expectedFailedTmuxEvidence,
      },
    ],
  });
  assert.deepEqual(releaseGateReport.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'operator-proof'), {
    bucket: 'operator-proof',
    gateCount: 1,
    gates: [
      {
        bucket: 'operator-proof',
        id: 'tmux-status-marker',
        rpp: 'RPP-0017',
        title: 'tmux stdout proof status marker',
        status: 'failed',
        code: 'TMUX_STATUS_MARKER_REQUIRED',
        reason: 'The tmux stdout status marker is missing or not bracketed.',
        required: 'final bracketed stdout status marker',
        observed: malformedCarriedMarker,
        scope: 'final-release',
      },
    ],
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('RPP-0097 evidence note records the focused verifier marker carry-through check', () => {
  const note = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(note.includes('# RPP-0097 release verifier tmux status marker carry-through'));
  assert.ok(note.includes(`- Focused command: \`${focusedCommand}\``));
  assert.ok(note.includes(`- Verifier marker carried into gate evidence: \`${verifierStatusMarker}\``));
  assert.ok(note.includes('- Observed status: `pass`; release gate marker evidence scenarios: `verifier-marker+malformed-carried-marker`.'));
  assert.ok(note.includes('Focused checks passed but the checklist item remains unchecked.'));
});
