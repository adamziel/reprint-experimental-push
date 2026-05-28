import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const progressHtmlPath = path.join(repoRoot, 'progress.html');
const evidenceReportPath = path.join(repoRoot, 'docs/evidence/ao-release-gates.md');
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const progressTimestamp = '2026-05-28T03:18:00.000Z';
const generatedCommand = 'node --test test/release-gate-progress-release-timestamp-generated.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const progressHtmlCommand = 'node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const finalMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED]';
const invalidTimestamp = 'release-proof-timestamp-missing-or-stale';
const requiredTimestampEvidence = 'ISO-parseable release timestamp';

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
    tmuxStatusMarker: {
      ok: true,
      marker: finalMarker,
      scope,
    },
    progressReleaseTimestamp: progressTimestampEvidence(),
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

function progressTimestampEvidence(iso = progressTimestamp, overrides = {}) {
  const scope = 'final-release';
  return {
    iso,
    source: 'progress.html#release-proof-timestamp',
    releaseStatus: 'NO-GO',
    command: generatedCommand,
    observedStatus: 'pass',
    scope,
    ...overrides,
  };
}

function generatedFixture(progressReleaseTimestamp = progressTimestampEvidence()) {
  return {
    scope: 'final-release',
    fixtureKind: 'progress-html-release-timestamp-generated',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: 'node ./scripts/playground/auth-session-source-command.js',
    },
    expectedProgressProof: {
      progressHtmlPath: 'progress.html#release-proof-timestamp',
      command: generatedCommand,
      observedStatus: 'pass',
      proofTimestamp: progressTimestamp,
      releaseStatus: 'NO-GO',
      finalMarker,
      heldMarker,
      mutationAttempted: false,
    },
    evidence: completeFinalEvidence({ progressReleaseTimestamp }),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-release-timestamp-gate-coverage-'));
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
    progressTimestamp,
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

test('generated progress timestamp proof rejects invalid timestamp before mutation for RPP-0058', () => {
  const fixture = generatedFixture(progressTimestampEvidence(invalidTimestamp));
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'progress-release-timestamp');
  const operatorProofBucket = report.missingProductionEvidenceBuckets.find((bucket) => bucket.bucket === 'operator-proof');
  const expectedGateEvidence = {
    required: requiredTimestampEvidence,
    observed: invalidTimestamp,
    scope: 'final-release',
  };

  assert.equal(fixture.expectedProgressProof.command, generatedCommand);
  assert.equal(fixture.expectedProgressProof.observedStatus, 'pass');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'operator-proof');
  assert.equal(report.primaryFailureCode, 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.ok(result.stdout.includes(heldMarker), 'stdout JSON must expose the held timestamp marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate, {
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
  assert.deepEqual(report.releaseMovement.missingEvidence, [
    {
      id: 'progress-release-timestamp',
      rpp: 'RPP-0018',
      status: 'failed',
      code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
      evidence: expectedGateEvidence,
    },
  ]);
  assert.deepEqual(operatorProofBucket, {
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
        required: requiredTimestampEvidence,
        observed: invalidTimestamp,
        scope: 'final-release',
      },
    ],
  });
});

test('generated progress timestamp proof links command and observed status while release remains NO-GO for RPP-0058', () => {
  const proof = releaseProofSection();
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const fixture = generatedFixture();
  const result = runCheckedCommand(writeEvidence(fixture));
  const report = parseReport(result);
  const gate = gateById(report, 'progress-release-timestamp');

  assert.equal(attributeValue(proof.tag, 'data-rpp'), 'RPP-0038');
  assert.equal(attributeValue(proof.tag, 'data-evidence-report'), 'docs/evidence/ao-release-gates.md');
  assert.equal(attributeValue(proof.tag, 'data-proof-timestamp'), progressTimestamp);
  assert.equal(attributeValue(proof.tag, 'data-release-status'), 'NO-GO');
  assert.ok(proof.body.includes(`\`${progressHtmlCommand}\``));
  assert.ok(proof.body.includes('observed status `pass`'));
  assert.ok(proof.body.includes('release remains held and `NO-GO`'));
  assert.ok(evidenceReport.includes('| RPP-0058 | Evidence toward variant-3 progress.html release timestamp'));
  assert.ok(evidenceReport.includes(`- Command: \`${generatedCommand}\``));
  assert.ok(evidenceReport.includes('- Observed status: `pass`; progress.html release status: `NO-GO`; proof timestamp: `2026-05-28T03:18:00.000Z`.'));

  assert.equal(fixture.evidence.progressReleaseTimestamp.iso, progressTimestamp);
  assert.equal(fixture.evidence.progressReleaseTimestamp.command, generatedCommand);
  assert.equal(fixture.evidence.progressReleaseTimestamp.observedStatus, 'pass');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.statusMarker, finalMarker);
  assert.ok(result.stdout.includes(finalMarker), 'stdout JSON must expose the final timestamp proof marker');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate, {
    id: 'progress-release-timestamp',
    rpp: 'RPP-0018',
    title: 'progress.html release timestamp',
    category: 'operator-proof',
    status: 'passed',
    blocking: false,
    code: 'OK',
    reason: 'progress.html release timestamp is backed by final release evidence.',
    evidence: {
      required: requiredTimestampEvidence,
      observed: progressTimestamp,
      scope: 'final-release',
      requiredScope: 'final-release',
    },
  });
});
