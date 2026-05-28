import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseAgentsReleaseGatesStatusRow,
  readAgentsReleaseGatesStatusRow,
} from '../scripts/release/agents-release-gates-status-row.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const agentsReleaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');
const evidenceReportPath = path.join(repoRoot, 'docs/evidence/ao-release-gates.md');
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');

const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const fixedNow = '2026-05-28T03:19:00.000Z';
const focusedCommand = 'node --test test/release-gate-agents-status-row-focused-regression.test.js test/release-gates-status-row.test.js test/release-gate-status-row-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const finalMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const dishonestMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=AGENTS_RELEASE_GATES_ROW_REQUIRED]';
const requiredStatusRowEvidence = ['machine-readable release gate status row'];
const expectedStatusRow = {
  ok: true,
  present: true,
  observed: 'release-gates-status-row-no-go',
  path: '.agents/RELEASE_GATES.md',
  releaseVerdict: '0/4',
  releaseStatus: 'NO-GO',
  gateStatuses: [
    { gate: 'GATE-1', title: 'Production Executor/Auth Boundary', status: 'support_only' },
    { gate: 'GATE-2', title: 'Durable Recovery Journal Boundary', status: 'support_only' },
    { gate: 'GATE-3', title: 'Live Docker/Playground Production Topology', status: 'support_only' },
    { gate: 'GATE-4', title: 'Plugin-Driver Ownership Boundary', status: 'support_only' },
  ],
  statusCounts: { support_only: 4 },
  lastRefreshed: '2026-05-28 02:24 CEST on lane/evidence-integration-20260527',
  errors: [],
  scope: 'final-release',
};

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
    tmuxStatusMarker: { ok: true, marker: finalMarker, scope },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: expectedStatusRow,
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
    ...overrides,
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-release-gates-row-focused-'));
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

function dishonestReleaseVerdictRow() {
  const sourceMarkdown = fs.readFileSync(agentsReleaseGatesPath, 'utf8');
  const parsed = parseAgentsReleaseGatesStatusRow(
    sourceMarkdown.replace('`release_verdict`: `0/4`', '`release_verdict`: `4/4`'),
    { path: '.agents/RELEASE_GATES.md', scope: 'final-release' },
  );
  assert.equal(parsed.ok, false);
  return parsed.evidence;
}

test('focused .agents status row regression rejects dishonest release verdict for RPP-0079', () => {
  const dishonestRow = dishonestReleaseVerdictRow();
  const evidence = completeFinalEvidence({
    agentsReleaseGateStatusRow: dishonestRow,
  });
  const result = runCheckedCommand(evidence);
  const report = parseReport(result);
  const gate = gateById(report, 'agents-release-gates-row');
  const expectedEvidence = {
    ...expectedStatusRow,
    ok: false,
    observed: 'dishonest-release-verdict',
    code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    reason: '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
    releaseVerdict: '4/4',
    errors: ['dishonest-release-verdict'],
    required: requiredStatusRowEvidence,
  };

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'operator-proof');
  assert.equal(report.primaryFailureCode, 'AGENTS_RELEASE_GATES_ROW_REQUIRED');
  assert.equal(report.statusMarker, dishonestMarker);
  assert.ok(result.stdout.includes(dishonestMarker), 'stdout JSON must expose the dishonest-row held marker');
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.releaseMovement.candidateGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate.evidence, expectedEvidence);
  assert.deepEqual(report.releaseMovement.missingEvidence, [
    {
      id: 'agents-release-gates-row',
      rpp: 'RPP-0019',
      status: 'failed',
      code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      reason: '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
      evidence: expectedEvidence,
    },
  ]);
});

test('focused .agents status row regression records matrix while release stays NO-GO for RPP-0079', () => {
  const positiveRow = readAgentsReleaseGatesStatusRow({ rootDir: repoRoot, scope: 'final-release' });
  const dishonestRow = dishonestReleaseVerdictRow();
  const evidence = completeFinalEvidence({
    agentsReleaseGateStatusRow: positiveRow.evidence,
  });
  const result = runCheckedCommand(evidence);
  const report = parseReport(result);
  const gate = gateById(report, 'agents-release-gates-row');
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');
  const observedMatrix = [
    {
      scenario: 'negative-dishonest-release-verdict',
      parserOk: false,
      gateStatus: 'failed',
      primaryFailureCode: dishonestRow.code,
      rowReleaseVerdict: dishonestRow.releaseVerdict,
      rowReleaseStatus: dishonestRow.releaseStatus,
      releaseStatus: 'NO-GO',
      releaseAllowed: false,
      marker: dishonestMarker,
      mutationAttempted: false,
    },
    {
      scenario: 'positive-generated-no-go-row',
      parserOk: positiveRow.ok,
      gateStatus: gate.status,
      primaryFailureCode: report.primaryFailureCode,
      rowReleaseVerdict: positiveRow.evidence.releaseVerdict,
      rowReleaseStatus: positiveRow.evidence.releaseStatus,
      releaseStatus: report.releaseStatus,
      releaseAllowed: report.releaseMovement.allowed,
      marker: report.statusMarker,
      mutationAttempted: report.mutationAttempted,
    },
  ];

  assert.deepEqual(positiveRow, { ok: true, evidence: expectedStatusRow });
  assert.ok(evidenceReport.includes('| RPP-0079 | Evidence toward focused `.agents/RELEASE_GATES.md` status row regression'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes('- Observed status: `pass`; generated `.agents/RELEASE_GATES.md` verdict: `0/4`; release status: `NO-GO`.'));
  assert.ok(progressReport.includes('Focused `.agents/RELEASE_GATES.md` status row regression now checks `RPP-0079`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes('- Observed status: `pass`; generated `.agents/RELEASE_GATES.md` verdict: `0/4`; release status: `NO-GO`.'));

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, finalMarker);
  assert.ok(result.stdout.includes(finalMarker), 'stdout JSON must expose the generated status-row final marker');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    ...expectedStatusRow,
    required: requiredStatusRowEvidence,
    requiredScope: 'final-release',
  });
  assert.deepEqual(observedMatrix, [
    {
      scenario: 'negative-dishonest-release-verdict',
      parserOk: false,
      gateStatus: 'failed',
      primaryFailureCode: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      rowReleaseVerdict: '4/4',
      rowReleaseStatus: 'NO-GO',
      releaseStatus: 'NO-GO',
      releaseAllowed: false,
      marker: dishonestMarker,
      mutationAttempted: false,
    },
    {
      scenario: 'positive-generated-no-go-row',
      parserOk: true,
      gateStatus: 'passed',
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      rowReleaseVerdict: '0/4',
      rowReleaseStatus: 'NO-GO',
      releaseStatus: 'NO-GO',
      releaseAllowed: true,
      marker: finalMarker,
      mutationAttempted: false,
    },
  ]);
});
