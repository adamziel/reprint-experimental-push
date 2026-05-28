import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import {
  parseAgentsReleaseGatesStatusRow,
  readAgentsReleaseGatesStatusRow,
} from '../scripts/release/agents-release-gates-status-row.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-28T03:19:00.000Z');
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';

function releaseEnv(overrides = {}) {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    ...overrides,
  };
}

function completeEvidence(scope = 'final-release', overrides = {}) {
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow.toISOString(), scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, state: scope, scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
    ...overrides,
  };
}

function writeReleaseGateEvidenceFixture(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gates-status-row-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

function runCheckedCommand(evidence) {
  const { dir, file } = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', {
      agentsReleaseGateStatusRow: evidence,
    }),
  });

  return runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: dir,
    env: {},
    now: fixedNow,
  });
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

test('.agents/RELEASE_GATES.md status row scenario matrix remains honest and NO-GO for RPP-0039', () => {
  const positiveRow = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const sourceMarkdown = fs.readFileSync(path.join(repoRoot, '.agents/RELEASE_GATES.md'), 'utf8');
  const dishonestRow = parseAgentsReleaseGatesStatusRow(
    sourceMarkdown.replace('`release_verdict`: `0/4`', '`release_verdict`: `4/4`'),
    {
      path: '.agents/RELEASE_GATES.md',
      scope: 'final-release',
    },
  );

  assert.deepEqual(positiveRow, {
    ok: true,
    evidence: {
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
    },
  });
  assert.equal(dishonestRow.ok, false);
  assert.deepEqual(dishonestRow.evidence, {
    ...positiveRow.evidence,
    ok: false,
    observed: 'dishonest-release-verdict',
    code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    reason: '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
    releaseVerdict: '4/4',
    errors: ['dishonest-release-verdict'],
  });

  const negative = runCheckedCommand(dishonestRow.evidence);
  const positive = runCheckedCommand(positiveRow.evidence);
  const negativeGate = gateById(negative.report, 'agents-release-gates-row');
  const positiveGate = gateById(positive.report, 'agents-release-gates-row');

  assert.equal(negative.exitCode, 1);
  assert.equal(negative.report.ok, false);
  assert.equal(negative.report.releaseStatus, 'NO-GO');
  assert.equal(negative.report.primaryFailureBucket, 'operator-proof');
  assert.equal(negative.report.primaryFailureCode, 'AGENTS_RELEASE_GATES_ROW_REQUIRED');
  assert.equal(negative.report.releaseMovement.allowed, false);
  assert.equal(negative.report.releaseMovement.finalGates, '19/20');
  assert.equal(negative.report.mutationAttempted, false);
  assert.equal(negativeGate.status, 'failed');
  assert.equal(negativeGate.code, 'AGENTS_RELEASE_GATES_ROW_REQUIRED');
  assert.equal(
    negativeGate.reason,
    '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
  );
  assert.deepEqual(negativeGate.evidence, {
    ...dishonestRow.evidence,
    required: ['machine-readable release gate status row'],
  });

  assert.equal(positive.exitCode, 1);
  assert.equal(positive.report.ok, false);
  assert.equal(positive.report.releaseStatus, 'NO-GO');
  assert.equal(positive.report.primaryFailureBucket, 'provenance');
  assert.equal(positive.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(positive.report.releaseMovement.allowed, true);
  assert.equal(positive.report.releaseMovement.finalGates, '20/20');
  assert.equal(positive.report.mutationAttempted, false);
  assert.equal(positiveGate.status, 'passed');
  assert.equal(positiveGate.code, 'OK');
  assert.equal(
    positiveGate.reason,
    '.agents/RELEASE_GATES.md status row is backed by final release evidence.',
  );
  assert.deepEqual(positiveGate.evidence, {
    ...positiveRow.evidence,
    required: ['machine-readable release gate status row'],
    requiredScope: 'final-release',
  });

  assert.deepEqual(
    [
      {
        scenario: 'negative-dishonest-release-verdict',
        parserOk: dishonestRow.ok,
        gateStatus: negativeGate.status,
        primaryFailureCode: negative.report.primaryFailureCode,
        rowReleaseVerdict: dishonestRow.evidence.releaseVerdict,
        rowReleaseStatus: dishonestRow.evidence.releaseStatus,
        releaseStatus: negative.report.releaseStatus,
        releaseAllowed: negative.report.releaseMovement.allowed,
        mutationAttempted: negative.report.mutationAttempted,
      },
      {
        scenario: 'positive-generated-no-go-row',
        parserOk: positiveRow.ok,
        gateStatus: positiveGate.status,
        primaryFailureCode: positive.report.primaryFailureCode,
        rowReleaseVerdict: positiveRow.evidence.releaseVerdict,
        rowReleaseStatus: positiveRow.evidence.releaseStatus,
        releaseStatus: positive.report.releaseStatus,
        releaseAllowed: positive.report.releaseMovement.allowed,
        mutationAttempted: positive.report.mutationAttempted,
      },
    ],
    [
      {
        scenario: 'negative-dishonest-release-verdict',
        parserOk: false,
        gateStatus: 'failed',
        primaryFailureCode: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
        rowReleaseVerdict: '4/4',
        rowReleaseStatus: 'NO-GO',
        releaseStatus: 'NO-GO',
        releaseAllowed: false,
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
        mutationAttempted: false,
      },
    ],
  );
});

test('missing .agents/RELEASE_GATES.md status row fails closed with exact requirement for RPP-0039', () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-release-gates-row-'));
  const missingRow = readAgentsReleaseGatesStatusRow({
    rootDir: missingRoot,
    scope: 'final-release',
  });
  const checked = runCheckedCommand(missingRow.evidence);
  const gate = gateById(checked.report, 'agents-release-gates-row');

  assert.deepEqual(missingRow, {
    ok: false,
    evidence: {
      ok: false,
      present: false,
      observed: 'missing-agents-release-gates-row',
      code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      reason: '.agents/RELEASE_GATES.md status row evidence is required before release movement.',
      path: '.agents/RELEASE_GATES.md',
      scope: 'final-release',
    },
  });
  assert.equal(checked.exitCode, 1);
  assert.equal(checked.report.ok, false);
  assert.equal(checked.report.releaseStatus, 'NO-GO');
  assert.equal(checked.report.primaryFailureBucket, 'operator-proof');
  assert.equal(checked.report.primaryFailureCode, 'AGENTS_RELEASE_GATES_ROW_REQUIRED');
  assert.equal(checked.report.releaseMovement.allowed, false);
  assert.equal(checked.report.releaseMovement.finalGates, '19/20');
  assert.equal(checked.report.mutationAttempted, false);
  assert.deepEqual(checked.report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate, {
    id: 'agents-release-gates-row',
    rpp: 'RPP-0019',
    title: '.agents/RELEASE_GATES.md status row',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    reason: '.agents/RELEASE_GATES.md status row evidence is required before release movement.',
    evidence: {
      ...missingRow.evidence,
      required: ['machine-readable release gate status row'],
    },
  });
});
