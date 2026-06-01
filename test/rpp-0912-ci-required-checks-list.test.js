import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ciListPath = path.join(repoRoot, 'docs/ci/required-release-checks.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0912-ci-required-checks-list.md');

const expectedCheckIds = [
  'release-gates-evaluator',
  'recovery-journal-proof',
  'auth-inspect-proof',
  'graph-identity-proof',
  'plugin-driver-proof',
  'route-proof-contracts',
  'evidence-coverage-proof',
  'operator-proof',
  'artifact-redaction-proof',
  'provenance-proof',
];

const expectedCommands = [
  'git rev-parse HEAD',
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:56:00.000Z',
  'node --check test/rpp-0912-ci-required-checks-list.test.js',
  'node --test --test-name-pattern RPP-0912 test/rpp-0912-ci-required-checks-list.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/ci/required-release-checks.md docs/evidence/rpp-0912-ci-required-checks-list.md',
  'git diff --check',
];

test('RPP-0912 CI checklist records every required blocking check', () => {
  const checklist = readText(ciListPath);

  assert.match(checklist, /^# CI required release checks$/m);
  assert.match(checklist, /Variant: RPP-0912 CI required checks list variant 1/);
  assert.match(checklist, /Release gate status moves only after\s+production-backed evidence is present/);
  assert.match(checklist, /Support-only\s+evidence is not production-backed evidence/);
  assert.match(checklist, /missing production-backed proof\nkeeps the final release at \*\*NO-GO\*\*/);
  assert.match(checklist, /This list does not authorize release-gate status changes/);
  assert.match(
    checklist,
    /\[RPP-0912 support-only evidence artifact\]\(\.\.\/evidence\/rpp-0912-ci-required-checks-list\.md\)/,
  );

  for (const checkId of expectedCheckIds) {
    assert.ok(checklist.includes(`| \`${checkId}\` |`), `${checkId} must be present`);
    assert.match(rowFor(checklist, checkId), /\| Blocking \| Required \|/);
  }
});

test('RPP-0912 evidence records support-only discipline with no release eligibility', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0912');
  assert.equal(report.sliceId, 'RPP-0912');
  assert.equal(report.proofId, 'rpp-0912-ci-required-checks-list-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.auditedBranch, 'session/rpp-912');
  assert.equal(report.auditedLaneHeadBeforeEvidence, 'deb262d6e34a7415470f5106e6483caf76350d40');
  assert.equal(report.status, 'support-only-ci-required-checks-list-recorded');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.successCriterion, 'Release gate status moves only with production-backed evidence.');

  assert.deepEqual(report.gateMovementRule, {
    mode: 'support-only',
    releaseGateMovementAllowed: false,
    currentEvidenceMovementAttempted: false,
    productionBackedEvidenceObserved: false,
    requiredEvidenceForMovement: 'production-backed',
    supportOnlyEvidenceEffect: 'no-movement',
    missingProductionBackedProofEffect: 'blocks-release-gate-movement',
    allowedStatusWithoutProductionEvidence: 'support_only',
    blockedStatusesWithoutProductionEvidence: [
      'partially_proven',
      'proven',
    ],
    finalReleaseRequiredPosture: 'NO-GO',
  });

  assert.deepEqual(report.statusRowReadback, {
    path: '.agents/RELEASE_GATES.md',
    releaseVerdict: '0/4',
    releaseStatus: 'NO-GO',
    gateStatuses: {
      'GATE-1': 'support_only',
      'GATE-2': 'support_only',
      'GATE-3': 'support_only',
      'GATE-4': 'support_only',
    },
    statusCounts: {
      support_only: 4,
    },
  });

  assert.equal(report.evidenceLimits.mutationAttempted, false);
  assert.equal(report.evidenceLimits.releaseGateChanged, false);
  assert.equal(report.evidenceLimits.releaseStatusChanged, false);
  assert.equal(report.evidenceLimits.progressRecordChanged, false);
  assert.equal(report.evidenceLimits.completionChecklistChanged, false);
});

test('RPP-0912 required checks stay blocking and require production-backed observations', () => {
  const { report } = loadEvidenceReport();

  assert.deepEqual(report.requiredChecks.map((check) => check.id), expectedCheckIds);

  for (const check of report.requiredChecks) {
    assert.equal(typeof check.command, 'string', `${check.id} command must be present`);
    assert.ok(check.command.startsWith('node --test '), `${check.id} command must be a node test`);
    assert.ok(Array.isArray(check.artifacts), `${check.id} artifacts must be present`);
    assert.ok(check.artifacts.length > 0, `${check.id} artifacts must not be empty`);
    assert.equal(check.blocking, true, `${check.id} must stay blocking`);
    assert.equal(check.productionRequired, true, `${check.id} must require production proof`);
    assert.equal(check.productionBacked, false, `${check.id} must not claim production proof`);
    assert.equal(check.releaseGateMovementAllowed, false, `${check.id} must not allow gate movement`);
    assert.equal(check.supportOnlyEvidenceEffect, 'no-movement', `${check.id} support-only effect`);
    assert.equal(
      check.missingProductionBackedProofEffect,
      'blocks-release-gate-movement',
      `${check.id} missing proof effect`,
    );
  }
});

test('RPP-0912 final release gate remains NO-GO without production-backed proof', () => {
  const { report } = loadEvidenceReport();
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', report.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(report.generatedAt),
  });

  assert.equal(
    report.releaseGateExpectation.command,
    'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T01:56:00.000Z',
  );
  assert.equal(result.exitCode, report.releaseGateExpectation.expectedExit);
  assert.equal(result.report.releaseStatus, report.releaseGateExpectation.expectedReleaseStatus);
  assert.equal(result.report.primaryFailureCode, report.releaseGateExpectation.expectedPrimaryFailureCode);
  assert.equal(result.report.primaryFailureBucket, report.releaseGateExpectation.expectedPrimaryFailureBucket);
  assert.equal(result.report.mutationAttempted, report.releaseGateExpectation.expectedMutationAttempted);
  assert.equal(result.report.releaseMovement.allowed, report.releaseGateExpectation.expectedReleaseMovementAllowed);
  assert.equal(result.report.statusMarker, report.releaseGateExpectation.expectedStatusMarker);
});

test('RPP-0912 evidence is redacted and records exact validation commands', () => {
  const checklist = readText(ciListPath);
  const { text, report } = loadEvidenceReport();

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0912 CI required checks list' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(checklist.includes('http://'), false);
  assert.equal(checklist.includes('https://'), false);
  assert.match(text, /Gate movement therefore remains blocked/);
  assert.match(text, /final release remains \*\*NO-GO\*\*/);

  assert.deepEqual(report.validationCommands.map((entry) => entry.command), expectedCommands);
  for (const entry of report.validationCommands) {
    assert.equal(Number.isInteger(entry.expectedExit), true, `${entry.command} expected exit`);
    assert.equal(typeof entry.observed, 'string', `${entry.command} observed result`);
    assert.ok(entry.observed.length > 0, `${entry.command} observed result`);
  }
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0912 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function rowFor(text, checkId) {
  const row = text.split('\n').find((line) => line.startsWith(`| \`${checkId}\` |`));

  assert.ok(row, `${checkId} row must exist`);
  return row;
}
