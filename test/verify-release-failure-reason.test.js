import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const verifyReleaseStatusMarker = '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]';
const releaseGateStatusMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

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

function releaseEnv() {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    REPRINT_PUSH_USERNAME: 'admin',
    REPRINT_PUSH_APPLICATION_PASSWORD: 'production-secret-for-test',
  };
}

function completeEvidence(scope, overrides = {}) {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-failure-evidence-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
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
      // Not a JSON object boundary; keep scanning for the next brace.
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

test('verify:release nonzero failure reason emits a status marker and release-gate evidence for RPP-0040', () => {
  const proof = runVerifyReleaseMissingSource();

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr);
  assert.ok(
    proof.stdout.trim().endsWith(verifyReleaseStatusMarker),
    'verify:release stdout should end with a tmux-visible bracketed status marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'missing-source proof must fail before starting a mutating/live verifier path',
  );

  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
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

  const verifyReleaseFailure = {
    ok: true,
    exitCode: proof.status,
    reason: verifyReport.releaseProof.code,
    command: 'npm run verify:release',
    checkedCommand: verifyReport.topologyEvidence.checkedCommand,
    statusMarker: verifyReport.statusMarker,
    mutationAttempted: verifyReport.mutationAttempted,
    scope: 'final-release',
  };
  const fixture = writeReleaseGateEvidenceFixture({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release', { verifyReleaseFailure }),
  });
  const checked = runReleaseGateCli([
    '--evidence-file',
    fixture.file,
    '--scope',
    'final-release',
    '--now',
    fixedNow.toISOString(),
  ], {
    cwd: fixture.dir,
    env: {},
    now: fixedNow,
  });
  const gate = checked.report.evaluation.gates.find((entry) => entry.id === 'verify-release-failure-reason');

  assert.equal(checked.exitCode, 1);
  assert.equal(checked.report.ok, false);
  assert.equal(checked.report.releaseStatus, 'NO-GO');
  assert.equal(checked.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(checked.report.releaseMovement.allowed, true);
  assert.equal(checked.report.releaseMovement.finalGates, '20/20');
  assert.equal(checked.report.statusMarker, releaseGateStatusMarker);
  assert.equal(checked.report.mutationAttempted, false);
  assert.deepEqual(checked.report.mutationPolicy, {
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
    evidence: {
      ...verifyReleaseFailure,
      required: 'nonzero verify:release exit with named reason',
      observed: {
        exitCode: 1,
        reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        command: 'npm run verify:release',
        mutationAttempted: false,
        statusMarker: verifyReleaseStatusMarker,
      },
      requiredScope: 'final-release',
    },
  });
});
