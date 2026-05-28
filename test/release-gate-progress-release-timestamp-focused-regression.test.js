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
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');

const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';
const progressTimestamp = '2026-05-28T03:18:00.000Z';
const focusedCommand = 'node --test test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const finalMarker = '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=all-release-gates-are-backed-by-final-release-evidence]';
const heldMarker = '[release-gates-ci:held final=19/20 candidate=19/20 reason=PROGRESS_RELEASE_TIMESTAMP_REQUIRED]';

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
    applicationPasswordCredentialBinding: { ok: true, bound: true, observed: 'bound-to-source-url', scope },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: '/reprint-push/v1/preflight', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: '/reprint-push/v1/dry-run', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'inspect-read-only', scope },
    tmuxStatusMarker: { ok: true, marker: finalMarker, scope },
    progressReleaseTimestamp: progressTimestampEvidence(),
    agentsReleaseGateStatusRow: { ok: true, present: true, observed: 'release-gates-status-row-no-go', scope },
    verifyReleaseFailure: { ok: true, exitCode: 1, reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED', scope },
    ...overrides,
  };
}

function progressTimestampEvidence(iso = progressTimestamp, overrides = {}) {
  return {
    iso,
    source: 'progress.html#release-proof-timestamp',
    releaseStatus: 'NO-GO',
    command: focusedCommand,
    observedStatus: 'pass',
    scope: 'final-release',
    ...overrides,
  };
}

function writeEvidence(evidence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-release-timestamp-focused-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify({
    scope: 'final-release',
    env: {
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
    },
    evidence,
  }, null, 2)}\n`);
  return file;
}

function runCheckedCommand(evidence) {
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

test('focused progress timestamp regression rejects non-ISO evidence before mutation for RPP-0078', () => {
  const evidence = completeFinalEvidence({
    progressReleaseTimestamp: progressTimestampEvidence('not-an-iso-release-proof-timestamp'),
  });
  const result = runCheckedCommand(evidence);
  const report = parseReport(result);
  const gate = gateById(report, 'progress-release-timestamp');

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'operator-proof');
  assert.equal(report.primaryFailureCode, 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED');
  assert.equal(report.statusMarker, heldMarker);
  assert.equal(report.releaseMovement.allowed, false);
  assert.equal(report.releaseMovement.finalGates, '19/20');
  assert.equal(report.releaseMovement.candidateGates, '19/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.mutationPolicy, {
    readOnly: true,
    reason: 'check-release-gates evaluates supplied evidence only and never calls preflight, dry-run, apply, journal, or recovery mutation routes',
  });
  assert.deepEqual(gate.evidence, {
    required: 'ISO-parseable release timestamp',
    observed: 'not-an-iso-release-proof-timestamp',
    scope: 'final-release',
  });
  assert.deepEqual(report.releaseMovement.missingEvidence, [
    {
      id: 'progress-release-timestamp',
      rpp: 'RPP-0018',
      status: 'failed',
      code: 'PROGRESS_RELEASE_TIMESTAMP_REQUIRED',
      reason: 'Release timestamp evidence must be an ISO-parseable timestamp.',
      evidence: gate.evidence,
    },
  ]);
});

test('focused progress timestamp regression links command and observed status while release stays NO-GO for RPP-0078', () => {
  const proof = releaseProofSection();
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');
  const timestamp = attributeValue(proof.tag, 'data-proof-timestamp');
  const evidence = completeFinalEvidence({
    progressReleaseTimestamp: progressTimestampEvidence(timestamp),
  });
  const result = runCheckedCommand(evidence);
  const report = parseReport(result);
  const gate = gateById(report, 'progress-release-timestamp');

  assert.equal(attributeValue(proof.tag, 'data-rpp'), 'RPP-0038');
  assert.equal(attributeValue(proof.tag, 'data-evidence-report'), 'docs/evidence/ao-release-gates.md');
  assert.equal(attributeValue(proof.tag, 'data-release-status'), 'NO-GO');
  assert.equal(new Date(timestamp).toISOString(), progressTimestamp);
  assert.equal(evidence.progressReleaseTimestamp.command, focusedCommand);
  assert.equal(evidence.progressReleaseTimestamp.observedStatus, 'pass');
  assert.ok(evidenceReport.includes('| RPP-0078 | Evidence toward focused progress.html release timestamp regression'));
  assert.ok(evidenceReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; progress.html release status: \`NO-GO\`; proof timestamp: \`${timestamp}\`.`));
  assert.ok(progressReport.includes('Focused progress timestamp regression now checks `RPP-0078`'));
  assert.ok(progressReport.includes(`- Command: \`${focusedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; progress.html release status: \`NO-GO\`; proof timestamp: \`${timestamp}\`.`));

  assert.equal(result.status, 1, result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.releaseStatus, 'NO-GO');
  assert.equal(report.primaryFailureBucket, 'provenance');
  assert.equal(report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(report.statusMarker, finalMarker);
  assert.equal(report.releaseMovement.allowed, true);
  assert.equal(report.releaseMovement.finalGates, '20/20');
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    required: 'ISO-parseable release timestamp',
    observed: timestamp,
    scope: 'final-release',
    requiredScope: 'final-release',
  });
  assert.equal(gate.reason, 'progress.html release timestamp is backed by final release evidence.');
});
