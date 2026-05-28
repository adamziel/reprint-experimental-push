import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const progressHtmlPath = path.join(repoRoot, 'progress.html');
const evidenceReportPath = path.join(repoRoot, 'docs/evidence/ao-release-gates.md');
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');
const expectedTimestamp = '2026-05-28T03:18:00.000Z';
const expectedCommand = 'node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const sourceUrl = 'https://source.example.test/push';
const localUrl = 'https://local.example.test/push';
const remoteChangedUrl = 'https://changed.example.test/push';

function releaseEnv() {
  return {
    REPRINT_PUSH_SOURCE_URL: sourceUrl,
    REPRINT_PUSH_LOCAL_URL: localUrl,
    REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
  };
}

function completeEvidence(scope = 'final-release', overrides = {}) {
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
    progressReleaseTimestamp: {
      iso: expectedTimestamp,
      source: 'progress.html#release-proof-timestamp',
      releaseStatus: 'NO-GO',
      scope,
    },
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

function attributeValue(tag, name) {
  const pattern = new RegExp(`\\s${name}="([^"]*)"`);
  const match = tag.match(pattern);
  assert.ok(match, `missing ${name}`);
  return match[1];
}

function proofSection(html) {
  const tagMatch = html.match(/<div class="proof-item" id="release-proof-timestamp"[^>]*>/);
  assert.ok(tagMatch, 'missing release proof timestamp item');
  const start = tagMatch.index;
  const end = html.indexOf('</div>', start);
  assert.ok(end > start, 'missing release proof timestamp closing tag');
  return {
    tag: tagMatch[0],
    body: html.slice(start, end + '</div>'.length),
  };
}

function writeEvidence(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-html-release-timestamp-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

function gateById(report, id) {
  const gate = report.evaluation.gates.find((entry) => entry.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

test('progress.html release timestamp matches evidence report and remains NO-GO for RPP-0038', () => {
  const progressHtml = fs.readFileSync(progressHtmlPath, 'utf8');
  const evidenceReport = fs.readFileSync(evidenceReportPath, 'utf8');
  const progressReport = fs.readFileSync(progressReportPath, 'utf8');
  const proof = proofSection(progressHtml);
  const progressTimestamp = attributeValue(proof.tag, 'data-proof-timestamp');
  const releaseStatus = attributeValue(proof.tag, 'data-release-status');

  assert.equal(attributeValue(proof.tag, 'data-rpp'), 'RPP-0038');
  assert.equal(attributeValue(proof.tag, 'data-evidence-report'), 'docs/evidence/ao-release-gates.md');
  assert.equal(progressTimestamp, expectedTimestamp);
  assert.equal(releaseStatus, 'NO-GO');
  assert.equal(new Date(progressTimestamp).toISOString(), expectedTimestamp);
  assert.ok(proof.body.includes(`<time datetime="${expectedTimestamp}">${expectedTimestamp}</time>`));
  assert.ok(proof.body.includes(`\`${expectedCommand}\``));
  assert.ok(proof.body.includes('observed status `pass`'));
  assert.ok(proof.body.includes('release remains held and `NO-GO`'));

  assert.ok(evidenceReport.includes('| RPP-0038 | Evidence toward variant-2 progress.html release timestamp'));
  assert.ok(evidenceReport.includes(`- Command: \`${expectedCommand}\``));
  assert.ok(evidenceReport.includes(`- Observed status: \`pass\`; progress.html release status: \`${releaseStatus}\`; proof timestamp: \`${progressTimestamp}\`.`));
  assert.ok(progressReport.includes('Branch-local progress timestamp proof for `RPP-0038`'));
  assert.ok(progressReport.includes(`- Command: \`${expectedCommand}\``));
  assert.ok(progressReport.includes(`- Observed status: \`pass\`; progress.html release status: \`${releaseStatus}\`; proof timestamp: \`${progressTimestamp}\`.`));
  assert.ok(progressReport.includes('release remains held until production provenance is supplied'));

  const { dir, file } = writeEvidence({
    scope: 'final-release',
    env: releaseEnv(),
    evidence: completeEvidence('final-release'),
  });
  const result = runReleaseGateCli([
    '--evidence-file',
    file,
    '--scope',
    'final-release',
    '--now',
    expectedTimestamp,
  ], {
    cwd: dir,
    env: {},
    now: new Date(expectedTimestamp),
  });
  const gate = gateById(result.report, 'progress-release-timestamp');

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'provenance');
  assert.equal(result.report.primaryFailureCode, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.deepEqual(gate.evidence, {
    required: 'ISO-parseable release timestamp',
    observed: expectedTimestamp,
    scope: 'final-release',
    requiredScope: 'final-release',
  });
  assert.equal(gate.reason, 'progress.html release timestamp is backed by final release evidence.');
});
