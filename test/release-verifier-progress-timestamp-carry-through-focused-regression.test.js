import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const progressHtmlPath = path.join(repoRoot, 'progress.html');
const evidenceNotePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0098-release-verifier-progress-timestamp-carry-through.md',
);

const progressTimestamp = '2026-05-28T03:18:00.000Z';
const sourceUrl = 'https://source.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const localUrl = 'https://local.example.test/push';
const checkedUser = 'admin';
const secretValue = 'RPP_0098_SHOULD_NOT_LEAK';
const progressProofSource = 'progress.html#release-proof-timestamp';
const invalidProgressTimestamp = 'release-proof-timestamp-missing-or-stale';
const command = 'npm run verify:release';
const checkedCommand = 'timeout 300s npm run verify:release';
const progressProofCommand = 'node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const focusedCommand = 'umask 0022 && node --test test/release-verifier-progress-timestamp-carry-through-focused-regression.test.js test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gate-cli.test.js test/release-gates.test.js';
const verifierHeldMarker = '[verify-release:held exit=1 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED mutationAttempted=false]';
const releaseGateHeldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED]';
const releaseGateReadyMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';

const expectedMutationPolicy = Object.freeze({
  readOnly: true,
  reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
});

const expectedPassedTimestampEvidence = {
  ok: true,
  iso: progressTimestamp,
  observed: progressTimestamp,
  source: progressProofSource,
  releaseStatus: 'NO-GO',
  command,
  checkedCommand,
  proofCommand: progressProofCommand,
  observedStatus: 'pass',
  progressHtmlPath: progressProofSource,
  dataRpp: 'RPP-0038',
  mutationAttempted: false,
  scope: 'final-release',
};

const expectedFailedTimestampEvidence = {
  ok: false,
  iso: invalidProgressTimestamp,
  observed: invalidProgressTimestamp,
  source: progressProofSource,
  releaseStatus: 'NO-GO',
  command,
  checkedCommand,
  proofCommand: progressProofCommand,
  observedStatus: 'fail',
  progressHtmlPath: progressProofSource,
  dataRpp: 'RPP-0038',
  mutationAttempted: false,
  reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
  code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
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
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
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
    progressReleaseTimestamp: progressReleaseTimestampEvidenceFromReport(verifierProgressTimestampReport()),
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      command,
      checkedCommand,
      statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
      mutationAttempted: false,
      scope,
    },
    ...overrides,
  };
}

function runVerifierProgressTimestampFailure() {
  const report = verifierProgressTimestampReport({ progressReleaseTimestamp: expectedFailedTimestampEvidence });
  return spawnSync(process.execPath, ['-e', `
const report = ${JSON.stringify(report)};
process.stdout.write(JSON.stringify(report, null, 2));
process.stdout.write('\\n');
process.stdout.write(report.statusMarker);
process.stdout.write('\\n');
process.exit(1);
`], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 300_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      PATH: process.env.PATH,
      NODE_NO_WARNINGS: '1',
    },
  });
}

function verifierProgressTimestampReport({ progressReleaseTimestamp = expectedPassedTimestampEvidence } = {}) {
  const failed = progressReleaseTimestamp.ok === false;
  return {
    ok: !failed,
    statusMarker: failed ? verifierHeldMarker : '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
    mutationAttempted: false,
    topology: {
      sourceUrl,
      remoteBase: sourceUrl,
      remoteChanged: remoteChangedUrl,
      localEdited: localUrl,
    },
    boundary: failed
      ? {
        firstRemainingProductionBoundary: 'progress.html release timestamp tied to current evidence',
        status: 'blocked',
        verdict: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
        progressReleaseTimestamp,
      }
      : {
        firstRemainingProductionBoundary: null,
        status: 'ready',
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
        progressReleaseTimestamp,
      },
    progressReleaseTimestamp,
    releaseProof: failed
      ? {
        ok: false,
        status: 1,
        code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      }
      : {
        ok: false,
        status: 1,
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
    topologyEvidence: {
      checkedCommand,
      runner: {
        script: 'scripts/playground/production-shaped-live-release-verify.mjs',
        process: 'node',
        routeProfile: 'production-shaped',
        packagedFallbackAllowed: false,
      },
      ports: {
        sandboxIngress: 8080,
        source: 443,
        remoteChanged: 443,
        localEdited: 443,
        applyRevalidationSource: 443,
      },
      topology: {
        sourceUrl,
        localEditedSite: localUrl,
        remoteChangedDriftSource: remoteChangedUrl,
        sameRemoteIdentity: true,
        sourceCommand: '<redacted>',
        sourceCommandReadbackUrl: sourceUrl,
        packagedFallbackSource: false,
        blocker: failed ? 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED' : null,
      },
      progressReleaseTimestamp,
    },
    releaseMovement: failed
      ? {
        allowed: false,
        gates: '0/4',
        reason: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      }
      : {
        allowed: false,
        gates: '0/4',
        reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      },
  };
}

function progressReleaseTimestampEvidenceFromReport(report) {
  return report.progressReleaseTimestamp;
}

function verifyReleaseFailureFromReport(report) {
  return {
    ok: true,
    exitCode: report.releaseProof.status,
    reason: report.releaseProof.code,
    command,
    checkedCommand: report.topologyEvidence.checkedCommand,
    statusMarker: report.statusMarker,
    mutationAttempted: report.mutationAttempted,
    scope: 'final-release',
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verifier-progress-timestamp-carry-through-'));
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
    progressTimestamp,
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

function attributeValue(tag, name) {
  const pattern = new RegExp(`\\s${name}="([^"]*)"`);
  const match = tag.match(pattern);
  assert.ok(match, `missing ${name}`);
  return match[1];
}

function releaseProofSection() {
  const progressHtml = fs.readFileSync(progressHtmlPath, 'utf8');
  const tagMatch = progressHtml.match(/<div class="proof-item" id="release-proof-timestamp"[^>]*>/);
  assert.ok(tagMatch, 'missing release proof timestamp item');
  const start = tagMatch.index;
  const end = progressHtml.indexOf('</div>', start);
  assert.ok(end > start, 'missing release proof timestamp closing tag');
  return {
    tag: tagMatch[0],
    body: progressHtml.slice(start, end + '</div>'.length),
  };
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

test('release verifier carries the progress.html release timestamp into release gates for RPP-0098', () => {
  const proof = releaseProofSection();
  const htmlTimestamp = attributeValue(proof.tag, 'data-proof-timestamp');
  const htmlReleaseStatus = attributeValue(proof.tag, 'data-release-status');
  const verifierReport = verifierProgressTimestampReport();

  assert.equal(attributeValue(proof.tag, 'data-rpp'), 'RPP-0038');
  assert.equal(attributeValue(proof.tag, 'data-evidence-report'), 'docs/evidence/ao-release-gates.md');
  assert.equal(htmlTimestamp, progressTimestamp);
  assert.equal(htmlReleaseStatus, 'NO-GO');
  assert.equal(new Date(htmlTimestamp).toISOString(), progressTimestamp);
  assert.ok(proof.body.includes(`<time datetime="${progressTimestamp}">${progressTimestamp}</time>`));
  assert.deepEqual(verifierReport.progressReleaseTimestamp, expectedPassedTimestampEvidence);
  assert.deepEqual(verifierReport.topologyEvidence.progressReleaseTimestamp, verifierReport.progressReleaseTimestamp);
  assert.equal(verifierReport.mutationAttempted, false);

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    progressReleaseTimestamp: progressReleaseTimestampEvidenceFromReport(verifierReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const timestampGate = gateById(releaseGateReport, 'progress-release-timestamp');

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.primaryFailureBucket, 'provenance');
  assert.equal(releaseGateReport.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateReadyMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateReadyMarker));
  assert.equal(releaseGateReport.releaseMovement.allowed, true);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '20/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(timestampGate, {
    id: 'progress-release-timestamp',
    rpp: 'RPP-0018',
    title: 'progress.html release timestamp',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'progress.html release timestamp is backed by final release evidence.',
    evidence: {
      required: 'ISO-parseable release timestamp',
      observed: progressTimestamp,
      scope: 'final-release',
      requiredScope: 'final-release',
    },
  });
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 0);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('release verifier progress timestamp carry-through fails closed on stale or non-ISO timestamp evidence for RPP-0098', () => {
  const proof = runVerifierProgressTimestampFailure();
  const verifyReport = extractJsonObjects(proof.stdout)
    .find((entry) => entry?.releaseProof?.code === 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED');

  assert.equal(proof.error, undefined, proof.error?.stack || proof.stderr || proof.stdout);
  assert.equal(proof.signal, null, proof.stderr || proof.stdout);
  assert.equal(proof.status, 1, proof.stderr || proof.stdout);
  assert.ok(verifyReport, proof.stdout);
  assert.ok(
    proof.stdout.trim().endsWith(verifierHeldMarker),
    'verify:release-shaped stdout should end with the progress timestamp held marker',
  );
  assert.doesNotMatch(
    `${proof.stdout}\n${proof.stderr}`,
    /Starting Playground server/,
    'progress timestamp denial must fail before starting live verifier servers',
  );
  assert.deepEqual(progressReleaseTimestampEvidenceFromReport(verifyReport), expectedFailedTimestampEvidence);
  assert.equal(verifyReport.mutationAttempted, false);
  assert.doesNotMatch(proof.stdout, new RegExp(secretValue));
  assert.doesNotMatch(proof.stderr, new RegExp(secretValue));

  const releaseGateResult = runReleaseGateCheck(completeFinalEvidence({
    progressReleaseTimestamp: progressReleaseTimestampEvidenceFromReport(verifyReport),
    verifyReleaseFailure: verifyReleaseFailureFromReport(verifyReport),
  }));
  const releaseGateReport = parseReport(releaseGateResult);
  const timestampGate = gateById(releaseGateReport, 'progress-release-timestamp');
  const verifyFailureGate = gateById(releaseGateReport, 'verify-release-failure-reason');
  const expectedGateEvidence = {
    required: 'ISO-parseable release timestamp',
    observed: invalidProgressTimestamp,
    scope: 'final-release',
  };

  assert.equal(releaseGateResult.status, 1, releaseGateResult.stdout);
  assert.equal(releaseGateReport.ok, false);
  assert.equal(releaseGateReport.exitCode, 1);
  assert.equal(releaseGateReport.releaseStatus, 'NO-GO');
  assert.equal(releaseGateReport.status, 'held');
  assert.equal(releaseGateReport.gateState, 'held');
  assert.equal(releaseGateReport.primaryFailureBucket, 'operator-proof');
  assert.equal(releaseGateReport.primaryFailureCode, 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED');
  assert.equal(releaseGateReport.statusMarker, releaseGateHeldMarker);
  assert.ok(releaseGateResult.stdout.includes(releaseGateHeldMarker));
  assert.equal(releaseGateReport.releaseMovement.allowed, false);
  assert.equal(releaseGateReport.releaseMovement.finalGates, '19/20');
  assert.equal(releaseGateReport.mutationAttempted, false);
  assert.deepEqual(releaseGateReport.mutationPolicy, expectedMutationPolicy);
  assert.deepEqual(timestampGate, {
    id: 'progress-release-timestamp',
    rpp: 'RPP-0018',
    title: 'progress.html release timestamp',
    category: 'operator-proof',
    status: 'failed',
    blocking: true,
    code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
    reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
    evidence: expectedGateEvidence,
  });
  assert.equal(verifyFailureGate.evidence.reason, 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED');
  assert.equal(verifyFailureGate.evidence.observed.statusMarker, verifierHeldMarker);
  assert.deepEqual(releaseGateReport.releaseMovement, {
    allowed: false,
    state: 'held',
    gates: '19/20',
    finalGates: '19/20',
    candidateGates: '19/20',
    reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
    missingEvidence: [
      {
        id: 'progress-release-timestamp',
        rpp: 'RPP-0018',
        status: 'failed',
        code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
        reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
        evidence: expectedGateEvidence,
      },
    ],
  });
  assert.deepEqual(releaseGateReport.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'operator-proof'), {
    bucket: 'operator-proof',
    gateCount: 1,
    gates: [
      {
        bucket: 'operator-proof',
        id: 'progress-release-timestamp',
        rpp: 'RPP-0018',
        title: 'progress.html release timestamp',
        status: 'failed',
        code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
        reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
        required: 'ISO-parseable release timestamp',
        observed: invalidProgressTimestamp,
        scope: 'final-release',
      },
    ],
  });
  assert.equal(releaseGateReport.evaluation.gates.filter((entry) => entry.status !== 'passed').length, 1);
  assert.doesNotMatch(releaseGateResult.stdout, new RegExp(secretValue));
  assert.doesNotMatch(releaseGateResult.stderr, new RegExp(secretValue));
});

test('RPP-0098 evidence note records the focused verifier progress timestamp carry-through check', () => {
  const note = fs.readFileSync(evidenceNotePath, 'utf8');

  assert.ok(note.includes('# RPP-0098 release verifier progress timestamp carry-through'));
  assert.ok(note.includes(`- Focused command: \`${focusedCommand}\``));
  assert.ok(note.includes(`- Carried progress timestamp: \`${progressTimestamp}\` from \`${progressProofSource}\`.`));
  assert.ok(note.includes('- Observed status: `pass`; progress timestamp scenarios: `verifier-progress-timestamp+invalid-carried-timestamp`; release status: `NO-GO`.'));
  assert.ok(note.includes('No progress.html, checklist, or shared release-verifier implementation files were edited.'));
});
