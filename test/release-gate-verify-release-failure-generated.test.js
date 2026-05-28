import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const verifyReleaseStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const releaseGateStatusMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const invalidVerifyFailureMarker = '[verify-release:held exit=0 reason=missing-nonzero-failure mutationAttempted=false]';
const invalidReleaseGateMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=VERIFY_RELEASE_FAILURE_REASON_REQUIRED]';
const requiredVerifyFailureEvidence = 'nonzero verify:release exit with named reason';

function runVerifyReleaseMissingSource() {
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
      REPRINT_PUSH_REMOTE_CHANGED_URL: '',
      REPRINT_PUSH_LOCAL_URL: '',
      REPRINT_PUSH_USERNAME: '',
      REPRINT_PUSH_APPLICATION_PASSWORD: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
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
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates:release-ready final=20/20 candidate=20/20 reason=OK]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: verifyReleaseFailureEvidence(),
    ...overrides,
  };
}

function verifyReleaseFailureEvidence(overrides = {}) {
  const scope = 'final-release';
  return {
    ok: true,
    exitCode: 1,
    reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: verifyReleaseStatusMarker,
    mutationAttempted: false,
    scope,
    ...overrides,
  };
}

function invalidZeroExitEvidence() {
  return {
    ok: true,
    exitCode: 0,
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: invalidVerifyFailureMarker,
    mutationAttempted: false,
    scope: 'final-release',
  };
}

function generatedFixture(verifyReleaseFailure = verifyReleaseFailureEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'verify-release-nonzero-failure-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
    },
    expectedVerifyReleaseFailure: {
      checkedCommand: 'timeout 300s npm run verify:release',
      command: 'npm run verify:release',
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      statusMarker: verifyReleaseStatusMarker,
      mutationAttempted: false,
    },
    evidence: completeFinalEvidence({ verifyReleaseFailure }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-failure-generated-'));
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
      // Keep scanning; npm output can contain braces outside JSON reports.
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

test('generated verify:release run emits nonzero final status marker for RPP-0060', () => {
  const proof = runVerifyReleaseMissingSource();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(verifyReleaseStatusMarker),
    'verify:release stdout should end with a tmux-visible bracketed status marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'missing-source proof must fail before starting a mutating/live verifier path',
  );
  assert.ok(verifyReport, proof.stdout);
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
      statusMarker: verifyReleaseStatusMarker,
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
});

test('generated verify:release evidence stays NO-GO and preserves exact nonzero reason for RPP-0060', () => {
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'verify-release-failure-reason');
  const expectedEvidence = {
    ...fixture.evidence.verifyReleaseFailure,
    required: requiredVerifyFailureEvidence,
    observed: {
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      mutationAttempted: false,
      statusMarker: verifyReleaseStatusMarker,
    },
    requiredScope: 'final-release',
  };

  assert.deepEqual(fixture.expectedVerifyReleaseFailure, {
    checkedCommand: 'timeout 300s npm run verify:release',
    command: 'npm run verify:release',
    exitCode: 1,
    reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    statusMarker: verifyReleaseStatusMarker,
    mutationAttempted: false,
  });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, releaseGateStatusMarker);
  assert.ok(result.stdout.includes(releaseGateStatusMarker), 'stdout JSON must expose the final release-gate marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate, {
    id: 'verify-release-failure-reason',
    rpp: 'RPP-0020',
    title: 'verify:release nonzero failure reason',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'verify:release nonzero failure reason is backed by final release evidence.',
    evidence: expectedEvidence,
  });
});

test('generated verify:release zero-exit evidence fails closed before mutation for RPP-0060', () => {
  const fixture = generatedFixture(invalidZeroExitEvidence());
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'verify-release-failure-reason');
  const operatorProofBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'operator-proof');
  const expectedObserved = {
    exitCode: 0,
    reason: 'missing-failure-reason',
    command: 'npm run verify:release',
    mutationAttempted: false,
    statusMarker: invalidVerifyFailureMarker,
  };
  const expectedEvidence = {
    ...fixture.evidence.verifyReleaseFailure,
    required: requiredVerifyFailureEvidence,
    observed: expectedObserved,
    scope: 'final-release',
  };

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'operator-proof');
  assert.equal(report.primaryFailureCode, 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED');
  assert.equal(report.statusMarker, invalidReleaseGateMarker);
  assert.ok(result.stdout.includes(invalidReleaseGateMarker), 'stdout JSON must expose the held release-gate marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate, {
    id: 'verify-release-failure-reason',
    rpp: 'RPP-0020',
    title: 'verify:release nonzero failure reason',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
    reason: 'verify:release nonzero failure evidence must include a nonzero exit code and named reason.',
    evidence: expectedEvidence,
  });
  assert.deepEqual(report.releaseMovement.missingEvidence, [
    {
      id: 'verify-release-failure-reason',
      rpp: 'RPP-0020',
      status: 'failed',
      code: 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
      reason: 'verify:release nonzero failure evidence must include a nonzero exit code and named reason.',
      evidence: expectedEvidence,
    },
  ]);
  assert.deepEqual(operatorProofBucket, {
    bucket: 'operator-proof',
    gateCount: 1,
    gates: [
      {
        bucket: 'operator-proof',
        id: 'verify-release-failure-reason',
        rpp: 'RPP-0020',
        title: 'verify:release nonzero failure reason',
        status: 'failed',
        code: 'VERIFY_RELEASE_FAILURE_REASON_REQUIRED',
        reason: 'verify:release nonzero failure evidence must include a nonzero exit code and named reason.',
        required: requiredVerifyFailureEvidence,
        observed: expectedObserved,
        scope: 'final-release',
      },
    ],
  });
});
