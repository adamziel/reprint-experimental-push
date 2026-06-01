import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(repoRoot, 'audits/critic.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0906-critic-audit-update.md');

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0906-critic-audit-update.test.js',
  'node --test --test-name-pattern RPP-0906 test/rpp-0906-critic-audit-update.test.js',
  'node scripts/release/artifact-redaction-scan.mjs audits/critic.md docs/evidence/rpp-0906-critic-audit-update.md',
  'git diff --check',
]);

const expectedCommitSubjects = Object.freeze({
  '609f52cd9': 'Merge published progress page state',
  'ddc4ff4c5': 'docs: publish progress page',
  '500b7b8f8': 'docs: refresh progress for RPP-0905 integration',
  bcdad0f0f: 'Add RPP-0905 objective audit update',
  '7c2516ca5': 'Add RPP-0903 release gate 3 final audit evidence',
});

test('RPP-0906 evidence records support-only critic-audit NO-GO posture', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0906');
  assert.equal(report.proofId, 'rpp-0906-critic-audit-update-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'critic-audit-risk-disposition-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'audit file links exact commands and commits');
  assert.equal(report.auditFile, 'audits/critic.md');
  assert.equal(report.auditHeading, 'RPP-0906 Critic Audit Risk Disposition');

  assert.deepEqual(report.posture, {
    productionEndpointAdded: false,
    productionMutationAttempted: false,
    productionLiveSourceProofAdded: false,
    releaseGateStatusMoved: false,
    progressFilesChanged: false,
    completionChecklistChanged: false,
    finalReleaseNoGoRetained: true,
  });

  assert.equal(report.riskDisposition.decision, 'NO-GO');
  assert.equal(report.riskDisposition.productionBackedEvidenceObserved, false);
  assert.equal(report.riskDisposition.remainingCriticBlockersPreserved, true);
  assert.equal(report.riskDisposition.closedProductionRisks, 0);
  assert.equal(report.riskDisposition.releaseBlocker, true);
  assert.ok(report.riskDisposition.requiredNextEvidence.length >= 10);
});

test('RPP-0906 evidence links exact commands to relevant current commits', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.validationCommands, expectedValidationCommands);
  assert.equal(report.relevantCurrentCommits.length, 5);

  for (const [sha, subject] of Object.entries(expectedCommitSubjects)) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
  }

  assert.deepEqual(report.commandCommitLinks, [
    {
      command: 'git log --oneline --decorate -12',
      commitRefs: ['609f52cd9', 'ddc4ff4c5', '500b7b8f8', '7c2516ca5'],
      purpose: 'Established current branch head, remote main reference, and recent integrated audit/progress context.',
    },
    {
      command: "git log --oneline --all --grep='RPP-0905' -8",
      commitRefs: ['500b7b8f8', 'bcdad0f0f'],
      purpose: 'Located the prior objective-audit update and its integration progress commit.',
    },
    {
      command: "git log --oneline --all --grep='audit' -12",
      commitRefs: ['7c2516ca5', 'b9b889422', '23784c4f2', 'bcdad0f0f'],
      purpose: 'Located recent final-audit evidence commits without moving any release gate.',
    },
  ]);
});

test('RPP-0906 critic audit section mirrors command, commit, and final NO-GO evidence', () => {
  const audit = fs.readFileSync(auditPath, 'utf8');
  const { report } = loadEvidenceReport();
  const section = auditSection(audit, '## RPP-0906 Critic Audit Risk Disposition');

  assert.match(section, /Final release verdict: \*\*NO-GO\*\*/);
  assert.match(section, /support-only and no-production-backed/);
  assert.match(section, /no release-gate status movement/);
  assert.match(section, /RPP-0906 integration recommendation: \*\*NO-GO\*\*/);
  assert.ok(section.includes('docs/evidence/rpp-0906-critic-audit-update.md'));

  for (const commit of report.relevantCurrentCommits) {
    assert.ok(section.includes(`| \`${commit.sha}\` | ${commit.subject} |`), `${commit.sha} must be linked in critic audit`);
  }

  for (const link of report.commandCommitLinks) {
    assert.ok(section.includes(`| \`${link.command}\` |`), `${link.command} must be listed exactly`);
    for (const sha of link.commitRefs) {
      assert.ok(section.includes(`\`${sha}\``), `${link.command} must link ${sha}`);
    }
  }

  for (const command of expectedValidationCommands) {
    assert.ok(section.includes(command), `${command} must be listed in the validation block`);
  }
});

test('RPP-0906 docs remain redacted and final release gates remain NO-GO', () => {
  const { report, text } = loadEvidenceReport();
  const audit = fs.readFileSync(auditPath, 'utf8');

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0906 critic audit update' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(audit.includes('http://'), false);
  assert.equal(audit.includes('https://'), false);

  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0906 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function auditSection(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `${heading} must exist`);

  const nextHeading = source.indexOf('\n## ', start + heading.length);
  return nextHeading === -1 ? source.slice(start) : source.slice(start, nextHeading);
}
