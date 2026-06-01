import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbookPath = path.join(repoRoot, 'docs/operations/operator-runbook.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0909-operator-runbook.md');

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

test('RPP-0909 operator runbook defines production prerequisites before mutation', () => {
  const runbook = readText(runbookPath);

  assert.match(runbook, /^# Reprint Push Operator Runbook/m);
  assert.match(runbook, /Variant: RPP-0909 operator runbook variant 1/);
  assert.match(runbook, /Final release: `NO-GO`/);
  assert.match(runbook, /separate release gate has approved the\s+exact production run/);

  for (const required of [
    'separate release gate approval',
    'source and target site identities',
    'immutable plan identifier',
    'dry-run result',
    'current precondition hashes',
    'single-writer lease',
    'durable restart-readable journal',
    'idempotency key hash',
    'backup or snapshot identifier',
    'approved authentication material is not copied into evidence',
    'not copied into evidence',
    'no remote tunnel',
  ]) {
    assert.ok(runbook.includes(required), `runbook prerequisite must include ${required}`);
  }
});

test('RPP-0909 operator runbook captures evidence needed for safe recovery decisions', () => {
  const runbook = readText(runbookPath);

  for (const required of [
    'run identifier',
    'release gate decision',
    'source identity hash',
    'target identity hash',
    'plan hash',
    'mutation count',
    'target count',
    'lease owner hash',
    'journal location hash',
    'monotonic journal sequence numbers',
    'per-target before hash',
    'planned after hash',
    'observed hash',
    'failed push identifier',
    'checked recovery path',
    'journal ownership result',
    'same request body',
    'redaction result',
  ]) {
    assert.ok(runbook.includes(required), `runbook evidence list must include ${required}`);
  }

  assert.match(runbook, /\[Apply Journal Recovery States\]\(\.\.\/recovery\/apply-journal\.md\)/);
  assert.match(runbook, /\[Acceptable Post-Failure States\]\(\.\.\/recovery\/acceptable-states\.md\)/);
  assert.match(runbook, /\[Operator Safe Recovery\]\(\.\.\/recovery\/operator-safe-recovery\.md\)/);
});

test('RPP-0909 stop conditions block hidden recovery assumptions and unsafe actions', () => {
  const runbook = readText(runbookPath);

  for (const state of acceptableStates) {
    assert.ok(runbook.includes(`\`${state}\``), `runbook must name ${state}`);
  }

  for (const stop of [
    'separate release gate approval is absent',
    'source or target identity is ambiguous',
    'single-writer lease is missing',
    'durable journal is missing',
    'precondition hashes drift',
    'target count, mutation count, or plan hash does not match',
    'current observed hashes cannot be explained',
    'terminal evidence is missing',
    'manual production edits',
    'cleanup that deletes recovery artifacts',
    'raw or sensitive material',
    'remote tunnel',
    'blocked-recovery',
    'release-gate movement',
  ]) {
    assert.ok(runbook.includes(stop), `runbook stop conditions must include ${stop}`);
  }

  assert.match(runbook, /Do not infer production safety from a green status code/);
  assert.match(runbook, /Missing\s+evidence is a stop condition/);
  assert.match(runbook, /The checked recovery path must be the path\s+used for inspection and any retry or finalization/);
  assert.match(runbook, /An unknown answer stops the run/);
  assert.match(runbook, /Final release remains `NO-GO`/);
});

test('RPP-0909 evidence JSON records support-only NO-GO operator posture', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0909');
  assert.equal(report.proofId, 'rpp-0909-operator-runbook-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.operatorRunbookContract.safeProductionOperation, true);
  assert.equal(report.operatorRunbookContract.noHiddenRecoveryAssumptions, true);
  assert.equal(report.operatorRunbookContract.productionApplyRequiresSeparateGate, true);
  assert.equal(report.operatorRunbookContract.manualProductionRepairAuthorized, false);
  assert.equal(report.operatorRunbookContract.releaseGateMovement, 'none');
  assert.equal(report.operatorRunbookContract.dashboardsStarted, false);
  assert.equal(report.operatorRunbookContract.remoteTunnelsUsed, false);
  assert.deepEqual(report.recoveryPolicy.acceptableStates, acceptableStates);
  assert.equal(report.recoveryPolicy.unknownStateAction, 'blocked-recovery');
  assert.equal(report.recoveryPolicy.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.recoveryPolicy.sameRecoveryPathRequired, true);
  assert.equal(report.recoveryPolicy.samePlanEnvelopeRequired, true);
  assert.equal(report.recoveryPolicy.manualPatchingAllowed, false);
  assert.equal(report.releasePosture.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releasePosture.releaseMovementAllowed, false);
  assert.equal(report.releasePosture.productionBackedEvidenceAdded, false);
  assert.ok(text.includes('Final release remains `NO-GO`'));
});

test('RPP-0909 evidence remains redacted and complete enough for support integration', () => {
  const { report, text } = loadEvidenceReport();
  const runbook = readText(runbookPath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0909 operator runbook evidence' }));

  for (const required of [
    'separate-release-gate-approval',
    'source-target-identity-verification',
    'single-writer-lease',
    'durable-restart-readable-journal',
    'idempotency-key-hash',
    'local-only-network-posture',
  ]) {
    assert.ok(report.prerequisites.includes(required), `evidence prerequisites must include ${required}`);
  }

  for (const stop of [
    'missing-or-wrong-release-gate-approval',
    'missing-uninspectable-unowned-nonmonotonic-journal',
    'precondition-drift',
    'completed-replay-would-create-fresh-mutations',
    'manual-production-edit-required',
    'remote-tunnel-or-unapproved-ingress-required',
    'unknown-hidden-assumption-answer',
  ]) {
    assert.ok(report.stopConditions.includes(stop), `evidence stop conditions must include ${stop}`);
  }

  assert.equal(report.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(report.redactionPosture.rawValuesIncluded, false);
  assert.equal(report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(report.redactionPosture.cookiesIncluded, false);
  assert.equal(report.redactionPosture.privatePathsIncluded, false);
  assert.equal(report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(runbook.includes('http://'), false);
  assert.equal(runbook.includes('https://'), false);
});

function loadEvidenceReport() {
  const text = readText(evidencePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0909 evidence must contain one JSON record block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
