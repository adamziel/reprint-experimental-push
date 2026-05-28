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

function runGate(args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, '--now', fixedNow, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      ...env,
    },
    encoding: 'utf8',
  });
}

function parseReport(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-release-gates-'));
  const filePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

function releaseEnv() {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    REPRINT_PUSH_USERNAME: 'admin',
    REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
  };
}

function completeEvidence(scope) {
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
      marker: scope === 'final-release'
        ? '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]'
        : '[release-gates:candidate-for-review final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, state: scope, scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      scope,
    },
  };
}

function operatorProofProvenanceRows(overrides = {}) {
  const rowsById = {
    'release-gate:tmux-status-marker': {
      evidenceId: 'release-gate:tmux-status-marker',
      rppId: 'RPP-0017',
      sourceKind: 'operator-production',
      artifactPath: 'docs/evidence/release/tmux-status-marker.ndjson',
      observedAt: '2026-05-27T23:30:00.000Z',
      command: 'tmux capture-pane -pt release-gates',
      status: 'checked-passed',
      subjectHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      operatorScope: 'final-release',
      productionRequired: true,
    },
    'release-gate:progress-release-timestamp': {
      evidenceId: 'release-gate:progress-release-timestamp',
      rppId: 'RPP-0018',
      sourceKind: 'operator-production',
      artifactPath: 'docs/evidence/release/progress-timestamp.json',
      observedAt: '2026-05-27T23:31:00.000Z',
      command: 'node scripts/release/read-progress-timestamp.mjs',
      status: 'checked-passed',
      subjectHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      operatorScope: 'final-release',
      productionRequired: true,
    },
    'release-gate:agents-release-gates-row': {
      evidenceId: 'release-gate:agents-release-gates-row',
      rppId: 'RPP-0019',
      sourceKind: 'operator-production',
      artifactPath: 'docs/evidence/release/agents-release-gates-row.json',
      observedAt: '2026-05-27T23:32:00.000Z',
      command: 'cat .agents/RELEASE_GATES.md',
      status: 'checked-passed',
      subjectHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      operatorScope: 'final-release',
      productionRequired: true,
    },
    'release-gate:verify-release-failure-reason': {
      evidenceId: 'release-gate:verify-release-failure-reason',
      rppId: 'RPP-0020',
      sourceKind: 'operator-production',
      artifactPath: 'docs/evidence/release/verify-release-failure-reason.json',
      observedAt: '2026-05-27T23:33:00.000Z',
      command: 'npm run verify:release',
      status: 'checked-failed',
      subjectHash: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
      operatorScope: 'final-release',
      productionRequired: true,
    },
  };

  for (const [evidenceId, rowOverrides] of Object.entries(overrides)) {
    rowsById[evidenceId] = {
      ...rowsById[evidenceId],
      ...rowOverrides,
    };
  }

  return Object.keys(rowsById).sort().map((evidenceId) => rowsById[evidenceId]);
}

test('release gate CLI is wired as a local CI-style package script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['check:release-gates'], 'node ./scripts/release/check-release-gates.mjs');
});

test('release gate CLI fails closed with JSON and named missing evidence buckets', () => {
  const result = runGate();
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.status, 'held');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, false);

  const topology = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'topology');
  assert.ok(topology, 'topology bucket should be named');
  assert.deepEqual(
    topology.gates.slice(0, 3).map((gate) => [gate.id, gate.code, gate.envKey]),
    [
      ['source-url', 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED', 'REPRINT_PUSH_SOURCE_URL'],
      ['local-url', 'REPRINT_PUSH_LOCAL_URL_REQUIRED', 'REPRINT_PUSH_LOCAL_URL'],
      ['remote-changed-url', 'REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED', 'REPRINT_PUSH_REMOTE_CHANGED_URL'],
    ],
  );
  assert.match(report.statusMarker, /^\[release-gates-ci:held final=\d+\/20 candidate=\d+\/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED\]$/);
});

test('release gate CLI does not inflate complete local candidate evidence into release readiness', () => {
  const evidenceFile = writeEvidence({
    scope: 'local-candidate',
    evidence: completeEvidence('local-candidate'),
  });
  const result = runGate(['--evidence-file', evidenceFile, '--scope', 'local-candidate'], releaseEnv());
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.status, 'candidate-for-review');
  assert.equal(report.candidateMovement.allowed, true);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '0/20');
  assert.equal(report.releaseMovement.candidateGates, '20/20');
  assert.equal(report.missingProductionEvidenceBuckets.reduce((sum, bucket) => sum + bucket.gateCount, 0), 20);
  assert.ok(
    report.missingProductionEvidenceBuckets.every((bucket) => bucket.gates.every((gate) => gate.status === 'candidate')),
    'candidate gates must still be reported as missing production evidence',
  );
});

test('release gate CLI keeps synthetic final release evidence at NO-GO without provenance', () => {
  const evidenceFile = writeEvidence({
    scope: 'final-release',
    evidence: completeEvidence('final-release'),
  });
  const result = runGate(['--evidence-file', evidenceFile], releaseEnv());
  const report = parseReport(result);

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'release-ready');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, false);
  assert.deepEqual(report.releaseEvidenceProvenance.requiredEvidenceIds, [
    'release-gate:tmux-status-marker',
    'release-gate:progress-release-timestamp',
    'release-gate:agents-release-gates-row',
    'release-gate:verify-release-failure-reason',
  ]);
  assert.deepEqual(
    report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'provenance').gates.map((gate) => [
      gate.id,
      gate.code,
    ]),
    [
      ['release-gate:tmux-status-marker', 'PRODUCTION_EVIDENCE_REQUIRED'],
      ['release-gate:progress-release-timestamp', 'PRODUCTION_EVIDENCE_REQUIRED'],
      ['release-gate:agents-release-gates-row', 'PRODUCTION_EVIDENCE_REQUIRED'],
      ['release-gate:verify-release-failure-reason', 'PRODUCTION_EVIDENCE_REQUIRED'],
    ],
  );
});

test('release gate CLI keeps stale or local-only production-required provenance at NO-GO', () => {
  const evidenceFile = writeEvidence({
    scope: 'final-release',
    evidence: completeEvidence('final-release'),
    releaseEvidenceProvenance: {
      maxEvidenceAgeHours: 24,
      evidenceRows: operatorProofProvenanceRows({
        'release-gate:tmux-status-marker': {
          sourceKind: 'local-playground',
          operatorScope: 'local-candidate',
        },
        'release-gate:progress-release-timestamp': {
          observedAt: '2026-05-26T23:59:59.000Z',
        },
      }),
    },
  });
  const result = runGate(['--evidence-file', evidenceFile], releaseEnv());
  const report = parseReport(result);
  const provenanceBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'provenance');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_SOURCE_REQUIRED');
  assert.deepEqual(
    provenanceBucket.gates.map((gate) => [gate.id, gate.code]),
    [
      ['release-gate:tmux-status-marker', 'PRODUCTION_SOURCE_REQUIRED'],
      ['release-gate:progress-release-timestamp', 'OBSERVED_AT_STALE'],
    ],
  );
  assert.deepEqual(report.releaseEvidenceProvenance.summary.productionRequired, {
    total: 4,
    accepted: 2,
    rejected: 2,
  });
});

test('release gate CLI exits zero only when final release evidence and provenance satisfy every gate', () => {
  const evidenceFile = writeEvidence({
    scope: 'final-release',
    evidence: completeEvidence('final-release'),
    releaseEvidenceProvenance: {
      maxEvidenceAgeHours: 24,
      evidenceRows: operatorProofProvenanceRows(),
    },
  });
  const result = runGate(['--evidence-file', evidenceFile], releaseEnv());
  const report = parseReport(result);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.releaseStatus, 'GO');
  assert.equal(report.status, 'release-ready');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.gates, '20/20');
  assert.deepEqual(report.missingProductionEvidenceBuckets, []);
  assert.equal(report.primaryFailureCode, null);
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.releaseEvidenceProvenance.summary.productionRequired, {
    total: 4,
    accepted: 4,
    rejected: 0,
  });
});
