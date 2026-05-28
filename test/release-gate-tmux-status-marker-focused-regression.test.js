import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const releaseReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=TMUX_STATUS_MARKER_REQUIRED]';
const malformedMarker = 'release-gates-ci:release-ready final=20/20 candidate=20/20 reason=missing-brackets';
const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

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
    tmuxStatusMarker: tmuxStatusMarkerEvidence(),
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
    ...overrides,
  };
}

function tmuxStatusMarkerEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    marker: releaseReadyMarker,
    observed: releaseReadyMarker,
    command: 'tmux capture-pane -pt release-gates',
    pane: 'release-gates',
    stdoutVisible: true,
    scope,
    ...overrides,
  };
}

function writeFixture(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-tmux-focused-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidence) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    writeFixture(evidence),
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

test('tmux stdout proof focused regression records exact marker evidence for RPP-0077', () => {
  const scenarios = [
    {
      name: 'malformed-marker-without-brackets',
      evidence: tmuxStatusMarkerEvidence({
        ok: true,
        marker: malformedMarker,
        observed: malformedMarker,
      }),
      expectedStatus: 'failed',
      expectedCode: 'TMUX_STATUS_MARKER_REQUIRED',
      expectedReason: 'The tmux stdout status marker is missing or not bracketed.',
      expectedReportMarker: heldMarker,
      expectedReleaseAllowed: false,
      expectedFinalGates: '19/20',
      expectedEvidence: {
        required: 'final bracketed stdout status marker',
        observed: malformedMarker,
        scope: 'final-release',
      },
    },
    {
      name: 'exact-release-ready-marker',
      evidence: tmuxStatusMarkerEvidence(),
      expectedStatus: 'passed',
      expectedCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      expectedReason: 'tmux stdout proof status marker is backed by final release evidence.',
      expectedReportMarker: releaseReadyMarker,
      expectedReleaseAllowed: true,
      expectedFinalGates: '20/20',
      expectedEvidence: {
        required: 'final bracketed stdout status marker',
        observed: releaseReadyMarker,
        scope: 'final-release',
        requiredScope: 'final-release',
      },
    },
  ];
  const matrix = [];

  for (const scenario of scenarios) {
    const result = runCheckedCommand(completeFinalEvidence({
      tmuxStatusMarker: scenario.evidence,
    }));
    const report = parseReport(result);
    const gate = gateById(report, 'tmux-status-marker');

    assert.equal(result.status, 1, scenario.name);
    assert.equal(report.releaseStatus, 'NO-GO', scenario.name);
    assert.equal(report.primaryFailureCode, scenario.expectedCode, scenario.name);
    assert.equal(report.statusMarker, scenario.expectedReportMarker, scenario.name);
    assert.ok(result.stdout.includes(scenario.expectedReportMarker), scenario.name);
    assert.equal(report.releaseMovement.allowed, scenario.expectedReleaseAllowed, scenario.name);
    assert.equal(report.releaseMovement.finalGates, scenario.expectedFinalGates, scenario.name);
    assert.equal(report.mutationAttempted, false, scenario.name);
    assert.deepEqual(report.mutationPolicy, expectedMutationPolicy, scenario.name);
    assert.equal(gate.status, scenario.expectedStatus, scenario.name);
    assert.equal(gate.reason, scenario.expectedReason, scenario.name);
    assert.deepEqual(gate.evidence, scenario.expectedEvidence, scenario.name);

    matrix.push({
      scenario: scenario.name,
      gateStatus: gate.status,
      gateCode: gate.code,
      observed: gate.evidence.observed,
      finalGates: report.releaseMovement.finalGates,
      releaseAllowed: report.releaseMovement.allowed,
      reportMarker: report.statusMarker,
      mutationAttempted: report.mutationAttempted,
    });
  }

  assert.deepEqual(matrix, [
    {
      scenario: 'malformed-marker-without-brackets',
      gateStatus: 'failed',
      gateCode: 'TMUX_STATUS_MARKER_REQUIRED',
      observed: malformedMarker,
      finalGates: '19/20',
      releaseAllowed: false,
      reportMarker: heldMarker,
      mutationAttempted: false,
    },
    {
      scenario: 'exact-release-ready-marker',
      gateStatus: 'passed',
      gateCode: 'OK',
      observed: releaseReadyMarker,
      finalGates: '20/20',
      releaseAllowed: true,
      reportMarker: releaseReadyMarker,
      mutationAttempted: false,
    },
  ]);
});
