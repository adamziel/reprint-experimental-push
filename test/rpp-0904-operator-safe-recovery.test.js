import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const operatorDocPath = path.join(repoRoot, 'docs/recovery/operator-safe-recovery.md');
const auditPath = path.join(repoRoot, 'docs/evidence/rpp-0904-operator-safe-recovery-audit.md');
const acceptableStatesPath = path.join(repoRoot, 'docs/recovery/acceptable-states.md');
const applyJournalPath = path.join(repoRoot, 'docs/recovery/apply-journal.md');

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

test('RPP-0904 operator runbook carries the existing recovery state contract', () => {
  const doc = readText(operatorDocPath);
  const acceptableStatesDoc = readText(acceptableStatesPath);
  const applyJournalDoc = readText(applyJournalPath);

  assert.match(doc, /^# Operator Safe Recovery/m);
  assert.match(doc, /Variant: RPP-0904 operator docs variant 1/);
  assert.match(doc, /\[Apply Journal Recovery States\]\(\.\/apply-journal\.md\)/);
  assert.match(doc, /\[Acceptable Post-Failure States\]\(\.\/acceptable-states\.md\)/);

  for (const state of acceptableStates) {
    assert.ok(doc.includes(`\`${state}\``), `operator doc must name ${state}`);
    assert.ok(acceptableStatesDoc.includes(`\`${state}\``), `state contract must name ${state}`);
    assert.ok(applyJournalDoc.includes(`\`${state}\``), `journal context must name ${state}`);
  }

  assert.match(doc, /Any state outside that set is unsafe/);
  assert.match(doc, /missing, incomplete, unowned, or uninspectable recovery artifacts remains a\s+release blocker/);
});

test('RPP-0904 operator docs require explicit evidence before retry or finalization', () => {
  const doc = readText(operatorDocPath);

  for (const required of [
    'failed push identifier',
    'checked recovery path',
    'journal ownership result',
    'restart-readable journal records',
    'planned mutation count',
    'before and after hashes',
    'current observed hash',
    'terminal journal evidence',
    'idempotency replay result',
    'redaction result',
  ]) {
    assert.ok(doc.includes(required), `operator evidence list must include ${required}`);
  }

  assert.match(doc, /Do not infer recovery state from a status code/);
  assert.match(doc, /Missing evidence is\s+not evidence that the remote is old or fully updated/);
});

test('RPP-0904 allowed action matrix blocks unsafe recovery assumptions', () => {
  const doc = readText(operatorDocPath);

  assert.match(doc, /Re-run the apply only through the normal validated apply path/);
  assert.match(doc, /revalidates current\s+preconditions/);
  assert.match(doc, /performs zero fresh mutations/);
  assert.match(doc, /Keep apply blocked, preserve artifacts, open a recovery review/);

  for (const forbidden of [
    'Editing remote content by hand',
    'retrying after current hashes drift',
    'reusing a journal for a different plan',
    'Reapplying inserts',
    'replaying stale local values',
    'Automated retry',
    'manual patching',
    'cleanup that deletes artifacts',
    'release movement',
  ]) {
    assert.ok(doc.includes(forbidden), `operator doc must forbid ${forbidden}`);
  }
});

test('RPP-0904 audit JSON matches the documented support-only recovery posture', () => {
  const { text, audit } = loadAudit();

  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.rppId, 'RPP-0904');
  assert.equal(audit.variant, 1);
  assert.equal(audit.status, 'passed-support-only');
  assert.equal(audit.supportOnly, true);
  assert.equal(audit.productionBacked, false);
  assert.equal(audit.releaseEligible, false);
  assert.equal(audit.finalReleaseStatus, 'NO-GO');
  assert.equal(audit.integrationRecommendation, 'NO-GO');
  assert.deepEqual(audit.safeRecoveryContract.acceptableStates, acceptableStates);
  assert.equal(audit.safeRecoveryContract.unknownStateAction, 'blocked-recovery');
  assert.equal(audit.safeRecoveryContract.missingEvidenceAction, 'blocked-recovery');
  assert.equal(audit.safeRecoveryContract.partialRemoteWithoutArtifact, 'release-blocker');
  assert.equal(audit.safeRecoveryContract.manualRepairAuthorized, false);
  assert.equal(audit.safeRecoveryContract.automatedRetryForBlockedRecovery, false);
  assert.equal(audit.allowedActions['old-remote'], 'validated-retry-only-after-revalidation');
  assert.equal(audit.allowedActions['fully-updated-remote'], 'finalize-or-replay-with-zero-fresh-mutations');
  assert.equal(audit.allowedActions['blocked-recovery'], 'stop-preserve-artifacts-review');
  assert.ok(text.includes('Final release remains `NO-GO`'));
});

test('RPP-0904 docs remain redaction-oriented and do not authorize release movement', () => {
  const operatorDoc = readText(operatorDocPath);
  const { audit } = loadAudit();

  assert.match(operatorDoc, /hash-only/);
  assert.match(operatorDoc, /credentials, raw row payloads, option values, post content, file content/);
  assert.match(operatorDoc, /Final release remains\s+`NO-GO`/);
  assert.equal(audit.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(audit.redactionPosture.credentialsIncluded, false);
  assert.equal(audit.redactionPosture.cookiesIncluded, false);
  assert.equal(audit.redactionPosture.privatePathsIncluded, false);
  assert.equal(audit.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.ok(audit.forbiddenActions.includes('release-gate-movement'));
});

function loadAudit() {
  const text = readText(auditPath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0904 audit must contain one JSON block');
  return {
    text,
    audit: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
