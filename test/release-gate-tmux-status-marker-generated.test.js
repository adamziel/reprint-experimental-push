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
const finalMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=TMUX_STATUS_MARKER_REQUIRED]';
const malformedMarker = 'release-gates-ci:release-ready final=20/20 candidate=20/20 reason=missing-brackets';
const requiredStatusMarkerEvidence = 'final bracketed stdout status marker';

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
    tmuxStatusMarker: tmuxMarkerEvidence(finalMarker),
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

function tmuxMarkerEvidence(marker = finalMarker, overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    marker,
    command: 'tmux capture-pane -pt release-gates',
    observed: marker,
    scope,
    ...overrides,
  };
}

function generatedFixture(tmuxStatusMarker = tmuxMarkerEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'tmux-stdout-proof-status-marker-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedTmuxProof: {
      command: 'tmux capture-pane -pt release-gates',
      finalMarker,
      heldMarker,
      malformedMarker,
      mutationAttempted: false,
    },
    evidence: completeFinalEvidence({ tmuxStatusMarker }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-status-marker-gate-coverage-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidenceFile) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--evidence-file',
    evidenceFile,
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

test('generated tmux stdout proof rejects malformed marker before mutation for RPP-0057', () => {
  const fixture = generatedFixture(tmuxMarkerEvidence(malformedMarker));
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'tmux-status-marker');
  const operatorProofBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'operator-proof');
  const expectedGateEvidence = {
    required: requiredStatusMarkerEvidence,
    observed: malformedMarker,
    scope: 'final-release',
  };

  assert.equal(fixture.expectedTmuxProof.command, 'tmux capture-pane -pt release-gates');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'operator-proof');
  assert.equal(report.primaryFailureCode, 'TMUX_STATUS_MARKER_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the held tmux-visible marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate, {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'TMUX_STATUS_MARKER_REQUIRED',
    reason: 'The tmux stdout status marker is missing or not bracketed.',
    evidence: expectedGateEvidence,
  });
  assert.deepEqual(report.releaseMovement.missingEvidence, [
    {
      id: 'tmux-status-marker',
      rpp: 'RPP-0017',
      status: 'failed',
      code: 'TMUX_STATUS_MARKER_REQUIRED',
      reason: 'The tmux stdout status marker is missing or not bracketed.',
      evidence: expectedGateEvidence,
    },
  ]);
  assert.deepEqual(operatorProofBucket, {
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
        required: requiredStatusMarkerEvidence,
        observed: malformedMarker,
        scope: 'final-release',
      },
    ],
  });
});

test('generated tmux stdout proof emits exact final marker while release remains NO-GO for RPP-0057', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'tmux-status-marker');

  assert.equal(fixture.evidence.tmuxStatusMarker.marker, finalMarker);
  assert.equal(fixture.evidence.tmuxStatusMarker.command, 'tmux capture-pane -pt release-gates');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, finalMarker);
  assert.ok(result.stdout.includes(finalMarker), 'stdout JSON must expose the final tmux-visible bracketed marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate, {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'tmux stdout proof status marker is backed by final release evidence.',
    evidence: {
      required: requiredStatusMarkerEvidence,
      observed: finalMarker,
      scope: 'final-release',
      requiredScope: 'final-release',
    },
  });
});
