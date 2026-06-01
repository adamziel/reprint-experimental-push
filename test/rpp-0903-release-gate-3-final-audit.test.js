import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerReleaseCommand,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { readAgentsReleaseGatesStatusRow } from '../scripts/release/agents-release-gates-status-row.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseGateScript = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const fixedNow = '2026-06-01T01:26:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const finalMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const missingLocalMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_LOCAL_URL_REQUIRED]';
const mutationPolicy = {
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
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
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'bound-to-source-url',
      scope,
    },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'recovery-inspect-read-only', scope },
    tmuxStatusMarker: { ok: true, marker: finalMarker, scope },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: readAgentsReleaseGatesStatusRow({
      rootDir: repoRoot,
      scope,
    }).evidence,
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function finalReleaseInputMissingLocalTopology() {
  return {
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    evidence: completeFinalEvidence(),
    releaseEvidenceProvenance: {
      maxEvidenceAgeHours: 24,
      evidenceRows: operatorProofProvenanceRows(),
    },
  };
}

function operatorProofProvenanceRows() {
  return [
    provenanceRow('release-gate:tmux-status-marker', 'RPP-0017', 'docs/evidence/release/tmux-status-marker.ndjson', 1),
    provenanceRow('release-gate:progress-release-timestamp', 'RPP-0018', 'docs/evidence/release/progress-timestamp.json', 2),
    provenanceRow('release-gate:agents-release-gates-row', 'RPP-0019', 'docs/evidence/release/agents-release-gates-row.json', 3),
    provenanceRow('release-gate:verify-release-failure-reason', 'RPP-0020', 'docs/evidence/release/verify-release-failure-reason.json', 4, {
      status: 'checked-failed',
    }),
  ];
}

function provenanceRow(evidenceId, rppId, artifactPath, hashDigit, overrides = {}) {
  return {
    evidenceId,
    rppId,
    sourceKind: 'operator-production',
    artifactPath,
    observedAt: '2026-06-01T01:20:00.000Z',
    command: 'checked release-gate audit command',
    status: 'checked-passed',
    subjectHash: `sha256:${String(hashDigit).repeat(64)}`,
    operatorScope: 'final-release',
    productionRequired: true,
    ...overrides,
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0903-release-gate-3-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function runReleaseGate(payload) {
  const evidenceFile = writeEvidence(payload);
  return spawnSync(process.execPath, [
    releaseGateScript,
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
  assert.ok(gate, `missing release gate ${id}`);
  return gate;
}

test('RPP-0903 release gate 3 final audit blocks release when local topology proof is missing', () => {
  const result = runReleaseGate(finalReleaseInputMissingLocalTopology());
  const report = parseReport(result);
  const localUrlGate = gateById(report, 'local-url');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.status, 'held');
  assert.equal(report.primaryFailureBucket, 'topology');
  assert.equal(report.primaryFailureCode, 'REPRINT_PUSH_LOCAL_URL_REQUIRED');
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.releaseMovement.candidateGates, '19/20');
  assert.equal(report.statusMarker, missingLocalMarker);
  assert.ok(result.stdout.includes(missingLocalMarker), 'stdout JSON must expose the held marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, mutationPolicy);
  assert.equal(report.releaseEvidenceProvenance.required, true);
  assert.equal(report.releaseEvidenceProvenance.ready, true);
  assert.deepEqual(report.missingProductionEvidenceBuckets, [
    {
      bucket: 'topology',
      gateCount: 1,
      gates: [
        {
          bucket: 'topology',
          id: 'local-url',
          rpp: 'RPP-0002',
          title: 'REPRINT_PUSH_LOCAL_URL gate',
          status: 'missing',
          code: 'REPRINT_PUSH_LOCAL_URL_REQUIRED',
          reason: 'REPRINT_PUSH_LOCAL_URL is required to prove the local edited site boundary.',
          required: 'REPRINT_PUSH_LOCAL_URL',
          observed: 'missing-local-edited-site',
          envKey: 'REPRINT_PUSH_LOCAL_URL',
          scope: 'missing',
        },
      ],
    },
  ]);
  assert.deepEqual(localUrlGate.evidence, {
    required: 'REPRINT_PUSH_LOCAL_URL',
    observed: 'missing-local-edited-site',
    envKey: 'REPRINT_PUSH_LOCAL_URL',
    scope: 'missing',
  });
});

test('RPP-0903 release gate 3 final audit consumes blocked Docker proof artifacts as held CI input', () => {
  const plan = buildDockerTopologyPlan({
    cwd: repoRoot,
    workDir: '/tmp/rpp-0903-docker-work',
    evidenceDir: '/tmp/rpp-0903-docker-evidence',
    env: {
      REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: '25',
      REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF: '1',
    },
  });
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'blocked',
    generatedAt: fixedNow,
  });
  const artifactFile = writeEvidence(artifact);
  const result = runReleaseGateCli(['--evidence-file', artifactFile, '--scope', 'final-release', '--now', fixedNow], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNow),
  });

  assert.equal(artifact.gate, 'GATE-3');
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.scope, 'missing');
  assert.deepEqual(artifact.env, {});
  assert.equal(artifact.evidence.dockerLocalProductionProof.ok, false);
  assert.equal(artifact.evidence.dockerLocalProductionProof.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.ok, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.ok(
    artifact.rppEvidence.advancedItems.includes('RPP-0903 release gate 3 blocks when a required proof fails'),
  );
  assert.deepEqual(validateReleaseGateArtifact(artifact), {
    ok: true,
    failures: [],
    releaseGateEvaluation: artifact.releaseGateEvaluation,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(result.report.mutationPolicy, mutationPolicy);
});

test('RPP-0903 release gate 3 final audit keeps current GATE-3 status support_only', () => {
  const statusRow = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const gate3 = statusRow.evidence.gateStatuses.find((gate) => gate.gate === 'GATE-3');

  assert.equal(statusRow.ok, true);
  assert.equal(statusRow.evidence.releaseVerdict, '0/4');
  assert.equal(statusRow.evidence.releaseStatus, 'NO-GO');
  assert.deepEqual(statusRow.evidence.statusCounts, { support_only: 4 });
  assert.deepEqual(gate3, {
    gate: 'GATE-3',
    title: 'Live Docker/Playground Production Topology',
    status: 'support_only',
  });
});
