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

function releaseEnv() {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    REPRINT_PUSH_USERNAME: 'admin',
    REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
  };
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

function packagedFallbackFixture(packagedFallback) {
  return {
    scope: 'final-release',
    fixtureKind: packagedFallback.observed === true
      ? 'packaged-fallback-with-all-other-final-evidence'
      : 'non-packaged-boundary-with-all-final-evidence',
    env: releaseEnv(),
    evidence: completeFinalEvidence({ packagedFallback }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-fallback-gate-coverage-'));
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

function runScenario(name, packagedFallback) {
  const result = runCheckedCommand(writeEvidence(packagedFallbackFixture(packagedFallback)));
  const report = parseReport(result);
  const gate = report.evaluation.gates.find((entry) => entry.id === 'packaged-fallback');
  const boundaryBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'boundary') || null;
  const provenanceBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'provenance') || null;

  return {
    name,
    processStatus: result.status,
    ok: report.ok,
    releaseStatus: report.releaseStatus,
    primaryFailureBucket: report.primaryFailureBucket,
    primaryFailureCode: report.primaryFailureCode,
    mutationAttempted: report.mutationAttempted,
    mutationPolicy: report.mutationPolicy,
    statusMarker: report.statusMarker,
    releaseMovement: report.releaseMovement,
    packagedFallbackGate: gate,
    boundaryBucket,
    provenanceBucketSummary: provenanceBucket && {
      bucket: provenanceBucket.bucket,
      gateCount: provenanceBucket.gateCount,
      gates: provenanceBucket.gates.map((entry) => [entry.id, entry.code]),
    },
  };
}

test('generated packaged fallback scenario matrix fails closed without mutation for RPP-0044', () => {
  const scenarioMatrix = [
    runScenario('negative-packaged-fallback', {
      ok: false,
      observed: true,
      reason: 'packaged-production-plugin-fallback',
      scope: 'final-release',
    }),
    runScenario('positive-non-packaged-boundary', {
      ok: true,
      observed: false,
      scope: 'final-release',
    }),
  ];

  assert.deepEqual(scenarioMatrix, [
    {
      name: 'negative-packaged-fallback',
      processStatus: 1,
      ok: false,
      releaseStatus: 'NO-GO',
      primaryFailureBucket: 'boundary',
      primaryFailureCode: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
      mutationAttempted: false,
      mutationPolicy: {
        readOnly: true,
        reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
      },
      statusMarker: '[release-gates-ci:held final=19/20 candidate=19/20 reason=REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED]',
      releaseMovement: {
        allowed: false,
        state: 'held',
        gates: '19/20',
        finalGates: '19/20',
        candidateGates: '19/20',
        reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
        missingEvidence: [
          {
            id: 'packaged-fallback',
            rpp: 'RPP-0004',
            status: 'failed',
            code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
            reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
            evidence: {
              required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
              observed: 'packaged-production-plugin-fallback',
              scope: 'final-release',
            },
          },
        ],
      },
      packagedFallbackGate: {
        id: 'packaged-fallback',
        rpp: 'RPP-0004',
        title: 'Packaged fallback rejection',
        category: 'boundary',
        status: 'failed',
        blocking: true,
        code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
        reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
        evidence: {
          required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
          observed: 'packaged-production-plugin-fallback',
          scope: 'final-release',
        },
      },
      boundaryBucket: {
        bucket: 'boundary',
        gateCount: 1,
        gates: [
          {
            bucket: 'boundary',
            id: 'packaged-fallback',
            rpp: 'RPP-0004',
            title: 'Packaged fallback rejection',
            status: 'failed',
            code: 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED',
            reason: 'Packaged production-plugin fallback is support evidence only and cannot move release gates.',
            required: 'non-packaged REPRINT_PUSH_SOURCE_URL',
            observed: 'packaged-production-plugin-fallback',
            scope: 'final-release',
          },
        ],
      },
      provenanceBucketSummary: null,
    },
    {
      name: 'positive-non-packaged-boundary',
      processStatus: 1,
      ok: false,
      releaseStatus: 'NO-GO',
      primaryFailureBucket: 'provenance',
      primaryFailureCode: 'PRODUCTION_EVIDENCE_REQUIRED',
      mutationAttempted: false,
      mutationPolicy: {
        readOnly: true,
        reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
      },
      statusMarker: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]',
      releaseMovement: {
        allowed: true,
        state: 'release-ready',
        gates: '20/20',
        finalGates: '20/20',
        candidateGates: '20/20',
        reason: 'all release gates are backed by final release evidence',
        missingEvidence: [],
      },
      packagedFallbackGate: {
        id: 'packaged-fallback',
        rpp: 'RPP-0004',
        title: 'Packaged fallback rejection',
        category: 'boundary',
        status: 'passed',
        blocking: false,
        code: 'OK',
        reason: 'Packaged fallback rejection is backed by final release evidence.',
        evidence: {
          required: 'non-packaged release boundary',
          observed: 'not-packaged-production-plugin-fallback',
          source: 'evidence.packagedFallback',
          scope: 'final-release',
          requiredScope: 'final-release',
        },
      },
      boundaryBucket: null,
      provenanceBucketSummary: {
        bucket: 'provenance',
        gateCount: 4,
        gates: [
          ['release-gate:tmux-status-marker', 'PRODUCTION_EVIDENCE_REQUIRED'],
          ['release-gate:progress-release-timestamp', 'PRODUCTION_EVIDENCE_REQUIRED'],
          ['release-gate:agents-release-gates-row', 'PRODUCTION_EVIDENCE_REQUIRED'],
          ['release-gate:verify-release-failure-reason', 'PRODUCTION_EVIDENCE_REQUIRED'],
        ],
      },
    },
  ]);
});
