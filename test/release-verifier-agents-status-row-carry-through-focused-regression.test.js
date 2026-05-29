import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAgentsReleaseGatesStatusRow,
  readAgentsReleaseGatesStatusRow,
} from '../scripts/release/agents-release-gates-status-row.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const agentsReleaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');
const evidenceNotePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0099-release-verifier-agents-status-row-carry-through.md',
);

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0099_SHOULD_NOT_LEAK';
const verifierStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=AGENTS_RELEASE_GATES_ROW_REQUIRED]';
const focusedCommand = 'umask 0022 && node --test test/release-verifier-agents-status-row-carry-through-focused-regression.test.js test/release-gate-agents-status-row-focused-regression.test.js test/release-gates-status-row.test.js test/release-gate-status-row-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const checkedCommand = 'timeout 300s npm run verify:release';
const verifyReleaseCommand = 'npm run verify:release';
const requiredStatusRowEvidence = ['machine-readable release gate status row'];
const statusRowFailureReason = '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

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

function runVerifyReleaseMissingSourceForStatusRow() {
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
      bindingId: 'release-verifier-auth-session-source-command',
      scope,
    },
    manageOptionsCapability: {
      ok: true,
      hasManageOptions: true,
      observed: 'manage_options',
      checkedUser,
      route: '/wp-json/reprint-push/v1/preflight',
      method: 'GET',
      expectedCapability: 'manage_options',
      capabilities: { manage_options: true },
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
      sourceUrl,
      method: 'POST',
      routeNamespace: 'reprint-push/v1',
      routeName: 'dry-run',
      planUploadAllowed: true,
      applyAttempted: false,
      mutationAttempted: false,
      scope,
    },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: tmuxStatusMarkerEvidenceFromVerifierReport(),
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: statusRowEvidenceFromVerifierReport(expectedStatusRow),
    verifyReleaseFailure: verifyReleaseFailureFromReport(),
    ...overrides,
  };
}

function verifyReleaseFailureFromReport(report = null) {
  return {
    ok: true,
    exitCode: report?.releaseProof?.status ?? 1,
    reason: report?.releaseProof?.code || 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    command: verifyReleaseCommand,
    checkedCommand: report?.topologyEvidence?.checkedCommand || checkedCommand,
    statusMarker: report?.statusMarker || verifierStatusMarker,
    mutationAttempted: report?.mutationAttempted ?? false,
    scope: 'final-release',
  };
}

function tmuxStatusMarkerEvidenceFromVerifierReport(report = null) {
  const marker = report?.statusMarker || verifierStatusMarker;
  return {
    ok: true,
    marker,
    observed: marker,
    command: verifyReleaseCommand,
    checkedCommand: report?.topologyEvidence?.checkedCommand || checkedCommand,
    stdoutVisible: true,
    scope: 'final-release',
  };
}

function statusRowEvidenceFromVerifierReport(statusRowEvidence, report = null) {
  return {
    ...statusRowEvidence,
    command: 'node scripts/release/agents-release-gates-status-row.mjs',
    carriedBy: verifyReleaseCommand,
    checkedCommand: report?.topologyEvidence?.checkedCommand || checkedCommand,
    statusMarker: report?.statusMarker || verifierStatusMarker,
    verifyReleaseReason: report?.releaseProof?.code || 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    mutationAttempted: report?.mutationAttempted ?? false,
    scope: statusRowEvidence.scope || 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-agents-status-row-carry-through-'));
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
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
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

function dishonestReleaseVerdictRow() {
  const sourceMarkdown = fs.readFileSync(agentsReleaseGatesPath, 'utf8');
  const parsed = parseAgentsReleaseGatesStatusRow(
    sourceMarkdown.replace('`release_verdict`: `0/4`', '`release_verdict`: `4/4`'),
    { path: '.agents/RELEASE_GATES.md', scope: 'final-release' },
  );
  assert.equal(parsed.ok, false);
  return parsed.evidence;
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

test('release verifier carries parsed .agents status row evidence into release gates for RPP-0099', () => {
  const proof = runVerifyReleaseMissingSourceForStatusRow();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  const positiveRow = readAgentsReleaseGatesStatusRow({ rootDir: repoRoot, scope: 'final-release' });
  const carriedRow = statusRowEvidenceFromVerifierReport(positiveRow.evidence, verifyReport);
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    agentsReleaseGateStatusRow: carriedRow,
    tmuxStatusMarker: tmuxStatusMarkerEvidenceFromVerifierReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const statusRowGate = gateById(releaseGateReport, 'agents-release-gates-row');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.equal(verifyReport.statusMarker, verifierStatusMarker);
  assert.equal(verifyReport.mutationAttempted, false);
  assert.equal(verifyReport.topologyEvidence.checkedCommand, checkedCommand);
  assert.ok(
    proof.stdout.trim().endsWith(verifierStatusMarker),
    'verify:release stdout should end with the missing-source held marker used for carry-through metadata',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'status row carry-through source proof must fail before starting live verifier servers',
  );
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));
  assert.deepEqual(positiveRow, { ok: true, evidence: expectedStatusRow });
  assert.deepEqual(carriedRow, {
    ...expectedStatusRow,
    command: 'node scripts/release/agents-release-gates-status-row.mjs',
    carriedBy: verifyReleaseCommand,
    checkedCommand,
    statusMarker: verifierStatusMarker,
    verifyReleaseReason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    mutationAttempted: false,
  });

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
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(statusRowGate, {
    id: 'agents-release-gates-row',
    rpp: 'RPP-0019',
    title: '.agents/RELEASE_GATES.md status row',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: '.agents/RELEASE_GATES.md status row is backed by final release evidence.',
    evidence: {
      ...carriedRow,
      required: requiredStatusRowEvidence,
      requiredScope: 'final-release',
    },
  });
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier .agents status row carry-through records negative and positive matrix for RPP-0099', () => {
  const verifyReport = {
    statusMarker: verifierStatusMarker,
    mutationAttempted: false,
    releaseProof: { status: 1, code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED' },
    topologyEvidence: { checkedCommand },
  };
  const positiveRow = readAgentsReleaseGatesStatusRow({ rootDir: repoRoot, scope: 'final-release' });
  const dishonestRow = dishonestReleaseVerdictRow();
  const negativeCarriedRow = statusRowEvidenceFromVerifierReport(dishonestRow, verifyReport);
  const positiveCarriedRow = statusRowEvidenceFromVerifierReport(positiveRow.evidence, verifyReport);
  const negativeResult = runReleaseGateCheck(completeFinalEvidence({
    agentsReleaseGateStatusRow: negativeCarriedRow,
    tmuxStatusMarker: tmuxStatusMarkerEvidenceFromVerifierReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const positiveResult = runReleaseGateCheck(completeFinalEvidence({
    agentsReleaseGateStatusRow: positiveCarriedRow,
    tmuxStatusMarker: tmuxStatusMarkerEvidenceFromVerifierReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const negativeReport = parseReport(negativeResult);
  const positiveReport = parseReport(positiveResult);
  const negativeGate = gateById(negativeReport, 'agents-release-gates-row');
  const positiveGate = gateById(positiveReport, 'agents-release-gates-row');
  const expectedNegativeEvidence = {
    ...expectedStatusRow,
    ok: false,
    observed: 'dishonest-release-verdict',
    code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    reason: statusRowFailureReason,
    releaseVerdict: '4/4',
    errors: ['dishonest-release-verdict'],
    command: 'node scripts/release/agents-release-gates-status-row.mjs',
    carriedBy: verifyReleaseCommand,
    checkedCommand,
    statusMarker: verifierStatusMarker,
    verifyReleaseReason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    mutationAttempted: false,
    required: requiredStatusRowEvidence,
  };
  const observedMatrix = [
    {
      scenario: 'negative-dishonest-release-verdict-carried-from-verifier-run',
      parserOk: false,
      gateStatus: negativeGate.status,
      primaryFailureCode: negativeReport.primaryFailureCode,
      rowReleaseVerdict: negativeCarriedRow.releaseVerdict,
      rowReleaseStatus: negativeCarriedRow.releaseStatus,
      carriedMarker: negativeCarriedRow.statusMarker,
      releaseStatus: negativeReport.releaseStatus,
      releaseAllowed: negativeReport.releaseMovement.allowed,
      marker: negativeReport.statusMarker,
      mutationAttempted: negativeReport.mutationAttempted,
    },
    {
      scenario: 'positive-generated-no-go-row-carried-from-verifier-run',
      parserOk: positiveRow.ok,
      gateStatus: positiveGate.status,
      primaryFailureCode: positiveReport.primaryFailureCode,
      rowReleaseVerdict: positiveCarriedRow.releaseVerdict,
      rowReleaseStatus: positiveCarriedRow.releaseStatus,
      carriedMarker: positiveCarriedRow.statusMarker,
      releaseStatus: positiveReport.releaseStatus,
      releaseAllowed: positiveReport.releaseMovement.allowed,
      marker: positiveReport.statusMarker,
      mutationAttempted: positiveReport.mutationAttempted,
    },
  ];

  assert.equal(negativeResult.status, 1, negativeResult.stdout);
  assert.equal(negativeReport.ok, false);
  assert.equal(negativeReport.exitCode, 1);
  assert.equal(negativeReport.releaseStatus, 'NO-GO');
  assert.equal(negativeReport.primaryFailureBucket, 'operator-proof');
  assert.equal(negativeReport.primaryFailureCode, 'AGENTS_RELEASE_GATES_ROW_REQUIRED');
  assert.equal(negativeReport.statusMarker, releaseGateHeldMarker);
  assert.ok(negativeResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(negativeReport.releaseMovement.allowed, false);
  assert.equal(negativeReport.releaseMovement.finalGates, '19/20');
  assert.equal(negativeReport.mutationAttempted, false);
  assert.deepEqual(negativeReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(negativeGate, {
    id: 'agents-release-gates-row',
    rpp: 'RPP-0019',
    title: '.agents/RELEASE_GATES.md status row',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
    reason: statusRowFailureReason,
    evidence: expectedNegativeEvidence,
  });
  assert.deepEqual(negativeReport.releaseMovement.missingEvidence, [
    {
      id: 'agents-release-gates-row',
      rpp: 'RPP-0019',
      status: 'failed',
      code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      reason: statusRowFailureReason,
      evidence: expectedNegativeEvidence,
    },
  ]);

  assert.equal(positiveResult.status, 1, positiveResult.stdout);
  assert.equal(positiveReport.ok, false);
  assert.equal(positiveReport.exitCode, 1);
  assert.equal(positiveReport.releaseStatus, 'NO-GO');
  assert.equal(positiveReport.primaryFailureBucket, 'provenance');
  assert.equal(positiveReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(positiveReport.statusMarker, releaseGateReadyMarker);
  assert.equal(positiveReport.releaseMovement.allowed, true);
  assert.equal(positiveReport.releaseMovement.finalGates, '20/20');
  assert.equal(positiveReport.mutationAttempted, false);
  assert.deepEqual(positiveGate.evidence, {
    ...positiveCarriedRow,
    required: requiredStatusRowEvidence,
    requiredScope: 'final-release',
  });
  assert.deepEqual(observedMatrix, [
    {
      scenario: 'negative-dishonest-release-verdict-carried-from-verifier-run',
      parserOk: false,
      gateStatus: 'failed',
      primaryFailureCode: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      rowReleaseVerdict: '4/4',
      rowReleaseStatus: 'NO-GO',
      carriedMarker: verifierStatusMarker,
      releaseStatus: 'NO-GO',
      releaseAllowed: false,
      marker: releaseGateHeldMarker,
      mutationAttempted: false,
    },
    {
      scenario: 'positive-generated-no-go-row-carried-from-verifier-run',
      parserOk: true,
      gateStatus: 'passed',
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      rowReleaseVerdict: '0/4',
      rowReleaseStatus: 'NO-GO',
      carriedMarker: verifierStatusMarker,
      releaseStatus: 'NO-GO',
      releaseAllowed: true,
      marker: releaseGateReadyMarker,
      mutationAttempted: false,
    },
  ]);
  assert.doesNotMatch(`${negativeResult.stdout}\n${negativeResult.stderr}`, new RegExp(secretValue));
  assert.doesNotMatch(`${positiveResult.stdout}\n${positiveResult.stderr}`, new RegExp(secretValue));
});

test('RPP-0099 evidence note records focused command, scenario matrix, and implementation scope', () => {
  const evidenceNote = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(evidenceNote.includes('Evidence toward `RPP-0099` release verifier `.agents/RELEASE_GATES.md` status row carry-through.'));
  assert.ok(evidenceNote.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceNote.includes('- Observed status: `pass`; tests: `37/37`; negative code: `AGENTS_RELEASE_GATES_ROW_REQUIRED`; positive release status: `NO-GO`.'));
  assert.ok(evidenceNote.includes('Scenario matrix: `dishonest-release-verdict` fails closed at `19/20`; generated `0/4` row passes the row gate and leaves release movement held only by provenance.'));
  assert.ok(evidenceNote.includes('No shared release-verifier implementation file changed.'));
});
