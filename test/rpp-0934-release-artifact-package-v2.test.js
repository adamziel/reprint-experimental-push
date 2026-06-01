import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0934-release-artifact-package-v2.md');
const patternEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0914-release-artifact-package.md');

const auditedLaneHead = '7f2f8e6a1058afab14eab82635427de8a48a8c87';

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const requiredArtifactPaths = Object.freeze([
  'docs/release/release-artifact-package.md',
  'docs/evidence/rpp-0914-release-artifact-package.md',
  'docs/evidence/rpp-0934-release-artifact-package-v2.md',
  'docs/operations/operator-runbook.md',
  'docs/evidence/rpp-0929-operator-runbook-v2.md',
  'docs/recovery/operator-safe-recovery.md',
  'docs/recovery/apply-journal.md',
  'docs/recovery/acceptable-states.md',
  'docs/evidence/rpp-0904-operator-safe-recovery-audit.md',
  'docs/evidence/rpp-0909-operator-runbook.md',
]);

const requiredArtifactNames = Object.freeze([
  'release artifact package manifest',
  'RPP-0914 release artifact package pattern evidence',
  'RPP-0934 release artifact package v2 evidence',
  'operator runbook',
  'operator runbook v2 evidence',
  'operator safe recovery guide',
  'apply journal recovery states',
  'acceptable post-failure states',
  'RPP-0904 operator safe recovery audit',
  'RPP-0909 operator runbook evidence',
]);

const requiredStopConditions = Object.freeze([
  'packaged-artifact-name-or-path-missing',
  'audited-lane-head-missing-or-stale',
  'operator-recovery-prerequisite-missing',
  'safe-recovery-evidence-missing',
  'release-gate-approval-missing-expired-or-different-run',
  'source-target-identity-ambiguous-or-unverified',
  'dry-run-conflicts-or-stale-preconditions',
  'current-precondition-hash-drift',
  'plan-receipt-target-or-mutation-count-mismatch',
  'single-writer-lease-missing-stale-unowned-or-contested',
  'journal-missing-uninspectable-unowned-nonmonotonic-or-not-restart-readable',
  'observed-hashes-not-explained-by-before-or-after-hashes',
  'terminal-evidence-missing-after-mutation-boundary',
  'same-key-replay-would-create-fresh-mutations',
  'manual-production-edit-or-direct-database-change-required',
  'artifact-redaction-scan-fails',
  'remote-tunnel-or-unapproved-ingress-required',
  'blocked-recovery-or-unknown-state',
  'publication-target-not-local-or-approved',
  'package-publication-requested-from-this-slice',
  'finalization-terminal-evidence-missing',
  'release-movement-requested-without-production-backed-gates',
  'hidden-assumption-answer-missing',
]);

const requiredLifecyclePhases = Object.freeze([
  'before-packaging',
  'before-publication',
  'before-finalization',
  'before-release-movement',
]);

test('RPP-0934 evidence records a held support-only package v2 contract', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0934 Release Artifact Package Evidence Variant 2$/m);
  assert.match(text, /Audited lane head before this evidence file: `7f2f8e6a1058afab14eab82635427de8a48a8c87`/);
  assert.match(text, /verdict stays held/);
  assert.match(text, /final release remains `NO-GO`/);
  assert.match(text, /no release-gate status movement is\s+allowed/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0934');
  assert.equal(report.proofId, 'rpp-0934-release-artifact-package-v2');
  assert.equal(report.variant, 2);
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-934');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.equal(report.packageContract.verdictHeld, true);
  assert.equal(report.packageContract.releaseGateMovement, 'none');
  assert.equal(report.packageContract.releaseMovementAllowed, false);
  assert.equal(report.packageContract.packagePublicationAllowed, false);
  assert.equal(report.packageContract.packageFinalizationAllowed, false);
});

test('RPP-0934 package names artifacts and inherits RPP-0914 recovery prerequisites', () => {
  const pattern = loadMarkdownJson(patternEvidencePath).report;
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.documents.patternEvidence, 'docs/evidence/rpp-0914-release-artifact-package.md');
  assert.deepEqual(report.operatorRecoveryPrerequisites, pattern.prerequisites);
  assert.deepEqual(report.excludedMaterial, pattern.excludedMaterial);

  const artifactPaths = report.packagedArtifacts.map((artifact) => artifact.path);
  const artifactNames = report.packagedArtifacts.map((artifact) => artifact.name);

  assert.deepEqual(artifactPaths, requiredArtifactPaths);
  assert.deepEqual(artifactNames, requiredArtifactNames);

  for (const artifact of report.packagedArtifacts) {
    assert.equal(artifact.supportOnly, true, `${artifact.path} must stay support-only`);
    assert.equal(artifact.productionBackedEvidence, false, `${artifact.path} must not claim production evidence`);
    assert.equal(artifact.productionSecretMaterial, false, `${artifact.path} must exclude production secrets`);
    assert.match(artifact.purpose, /\S/);
  }

  assert.match(text, /^## Packaged Artifacts$/m);
  assert.match(text, /operator recovery prerequisites/);
  assert.match(text, /Every packaged artifact remains support-only/);
});

test('RPP-0934 evidence requires safe recovery evidence and stop conditions', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.packageContract.noHiddenAssumptions, true);
  assert.equal(report.packageContract.normalValidatedApplyOnly, true);
  assert.equal(report.packageContract.sameRunEnvelopeRequired, true);
  assert.equal(report.packageContract.sameRecoveryPathRequired, true);
  assert.equal(report.packageContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.packageContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.packageContract.unknownStateAction, 'blocked-recovery');
  assert.deepEqual(report.packageContract.acceptableStates, acceptableStates);

  assert.ok(report.safeRecoveryEvidence.length >= 7);
  for (const evidence of report.safeRecoveryEvidence) {
    assert.match(evidence.name, /\S/);
    assert.match(evidence.requires, /\S/);
    assert.equal(evidence.stopIfMissing, true, `${evidence.name} must stop if missing`);
  }

  for (const stopCondition of requiredStopConditions) {
    assert.ok(report.stopConditions.includes(stopCondition), `missing stop condition ${stopCondition}`);
  }

  assert.match(text, /^## Safe Recovery Evidence$/m);
  assert.match(text, /Missing or unknown evidence stops the action/);
  assert.match(text, /status codes, screenshots, or artifact\s+names/);
});

test('RPP-0934 blocks hidden assumptions before package lifecycle movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  const blockerPhases = report.hiddenAssumptionBlockers.map((blocker) => blocker.phase);
  const guardPhases = report.lifecycleGuards.map((guard) => guard.phase);

  assert.deepEqual(blockerPhases, requiredLifecyclePhases);
  assert.deepEqual(guardPhases, requiredLifecyclePhases);

  for (const blocker of report.hiddenAssumptionBlockers) {
    assert.ok(blocker.mustAnswer.length >= 4, `${blocker.phase} must ask concrete blocker questions`);
    assert.match(blocker.unknownAnswerAction, /stop|blocked|hold/);
  }

  for (const guard of report.lifecycleGuards) {
    assert.ok(guard.requiredEvidence.length >= 3, `${guard.phase} must require explicit evidence`);
    assert.match(guard.hiddenAssumptionAction, /stop|blocked|hold/);
    assert.equal(guard.releaseMovementAllowed, false, `${guard.phase} must not allow release movement`);
  }

  assert.match(text, /Before\s+packaging/);
  assert.match(text, /Before\s+publication/);
  assert.match(text, /Before\s+finalization/);
  assert.match(text, /Before\s+release movement/);
  assert.match(text, /This slice provides no such release evidence, so release movement is\s+blocked/);
});

test('RPP-0934 package evidence remains redacted and makes no release movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0934 package v2 evidence' }));

  assert.equal(report.releaseHold.noReleaseGateMovement, true);
  assert.equal(report.releaseHold.releaseGateStatusMoved, false);
  assert.equal(report.releaseHold.statusFilesChanged, false);
  assert.equal(report.releaseHold.progressFilesChanged, false);
  assert.equal(report.releaseHold.completionChecklistChanged, false);
  assert.equal(report.releaseHold.productionRepairAuthorized, false);
  assert.equal(report.releaseHold.packagePublished, false);
  assert.equal(report.releaseHold.releaseFinalized, false);
  assert.equal(report.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(report.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(report.redactionPosture.cookiesIncluded, false);
  assert.equal(report.redactionPosture.privatePathsIncluded, false);
  assert.equal(report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(report.redactionPosture.productionSecretMaterialIncluded, false);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
});

function loadMarkdownJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}
