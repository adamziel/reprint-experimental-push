import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const evidenceNotePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0096-release-verifier-release-movement-carry-through.md',
);

const fixedNow = '2026-05-28T00:00:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const secretValue = 'RPP_0096_SHOULD_NOT_LEAK';
const sameSourceReason = 'Source URL identity drifted across the checked release path.';
const verifyHeldMarker = '[verify-release:held exit=1 reason=SAME_SOURCE_IDENTITY_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=SAME_SOURCE_IDENTITY_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const focusedCommand = 'node --test test/release-verifier-release-movement-summary-carry-through-focused-regression.test.js';
const checkedRoutes = ['preflight', 'dry-run', 'apply', 'journal', 'recovery-inspect'];
const requiredSameSourceEvidence = ['preflight, dry-run, apply, and recovery use the same source URL'];

const expectedDriftEvidence = {
  ok: false,
  same: false,
  sameSource: false,
  observed: 'recovery-inspect-used-remote-changed-source',
  expectedSourceUrl: sourceUrl,
  preflightSourceUrl: sourceUrl,
  dryRunSourceUrl: sourceUrl,
  applySourceUrl: sourceUrl,
  journalSourceUrl: sourceUrl,
  recoverySourceUrl: remoteChangedUrl,
  routePrefix: '/wp-json/reprint-push/v1',
  checkedRoutes,
  scope: 'final-release',
  required: requiredSameSourceEvidence,
};

const expectedMatchingEvidence = {
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
  checkedRoutes,
  scope: 'final-release',
  required: requiredSameSourceEvidence,
  requiredScope: 'final-release',
};

const expectedSummaryGateEvidence = {
  producedBy: 'evaluateReleaseGates',
  schemaVersion: 1,
  observed: 'releaseMovement summary will be emitted with this evaluation',
  scope: 'final-release',
  requiredScope: 'final-release',
};

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

function runVerifyReleaseSameSourceDenied() {
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
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: secretValue,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: '',
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: '',
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: '',
      REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: '',
      REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: remoteChangedUrl,
    },
  });
}

function matchingSourceIdentityEvidence() {
  return {
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
    checkedRoutes,
    scope: 'final-release',
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
    applicationPasswordCredentialBinding: { ok: true, bound: true, sameSource: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: matchingSourceIdentityEvidence(),
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: releaseGateReadyMarker,
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNow, scope },
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function sourceIdentityEvidenceFromReport(report) {
  return report.sourceIdentity;
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: report.releaseProof.status,
    reason: report.releaseProof.code,
    command: 'npm run verify:release',
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-release-movement-carry-through-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_USERNAME: 'admin',
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

test('release verifier carries denied releaseMovement summary before mutation for RPP-0096', () => {
  const proof = runVerifyReleaseSameSourceDenied();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'SAME_SOURCE_IDENTITY_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(verifyHeldMarker),
    'verify:release stdout should end with the releaseMovement denied marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'releaseMovement denial must fail before starting live verifier servers',
  );
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));

  assert.deepEqual(verifyReport.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: sameSourceReason,
  });
  assert.deepEqual(verifyReport.topologyEvidence.releaseMovement, verifyReport.releaseMovement);
  assert.equal(verifyReport.statusMarker, verifyHeldMarker);
  assert.equal(verifyReport.mutationAttempted, false);
  assert.deepEqual(sourceIdentityEvidenceFromReport(verifyReport), expectedDriftEvidence);

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    sourceIdentity: sourceIdentityEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const summaryGate = gateById(releaseGateReport, 'release-movement-summary');
  const sameSourceGate = gateById(releaseGateReport, 'same-source-identity');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'identity');
  assert.equal(releaseGateReport.primaryFailureCode, 'SAME_SOURCE_IDENTITY_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(summaryGate.evidence, expectedSummaryGateEvidence);
  assert.deepEqual(sameSourceGate.evidence, expectedDriftEvidence);
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: sameSourceReason,
    missingEvidence: [
      {
        id: 'same-source-identity',
        rpp: 'RPP-0010',
        status: 'failed',
        code: 'SAME_SOURCE_IDENTITY_REQUIRED',
        reason: sameSourceReason,
        evidence: expectedDriftEvidence,
      },
    ],
  });
  assert.deepEqual(releaseGateReport.summary.releaseMovement, releaseGateReport.releaseMovement);
  assert.deepEqual(releaseGateReport.summary.missingEvidence, releaseGateReport.releaseMovement.missingEvidence);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier releaseMovement carry-through keeps allowed summary path for RPP-0096', () => {
  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence());
  const releaseGateReport = parseReport(releaseGateResult);
  const summaryGate = gateById(releaseGateReport, 'release-movement-summary');
  const sameSourceGate = gateById(releaseGateReport, 'same-source-identity');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'provenance');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateReadyMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateReadyMarker));
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(summaryGate.evidence, expectedSummaryGateEvidence);
  assert.deepEqual(sameSourceGate, {
    id: 'same-source-identity',
    rpp: 'RPP-0010',
    title: 'Same source URL identity proof',
    category: 'identity',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'Same source URL identity proof is backed by final release evidence.',
    evidence: expectedMatchingEvidence,
  });
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: true,
    state: 'release-ready',
    gates: '20/20',
    finalGates: '20/20',
    candidateGates: '20/20',
    reason: 'all release gates are backed by final release evidence',
    missingEvidence: [],
  });
  assert.deepEqual(releaseGateReport.summary.releaseMovement, releaseGateReport.releaseMovement);
  assert.deepEqual(releaseGateReport.summary.missingEvidence, []);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier releaseMovement carry-through evidence note is recorded for RPP-0096', () => {
  const evidenceNote = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(evidenceNote.includes('Evidence toward `RPP-0096` release verifier releaseMovement carry-through'));
  assert.ok(evidenceNote.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceNote.includes(`- Observed status: \`pass\`; verifier marker: \`${verifyHeldMarker}\`; denied summary: \`releaseMovement.allowed=false\`; allowed summary: \`releaseMovement.allowed=true\`; release status: \`NO-GO\`.`));
  assert.ok(evidenceNote.includes('No progress.html, checklist, or shared release-verifier implementation files were edited.'));
});
