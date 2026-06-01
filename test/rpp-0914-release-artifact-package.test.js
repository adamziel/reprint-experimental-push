import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'docs/release/release-artifact-package.md');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0914-release-artifact-package.md');

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const requiredPrerequisites = Object.freeze([
  'release-gate-approval-bound-to-run',
  'source-target-identity-hashes',
  'immutable-plan-hash-and-receipt-id',
  'clean-dry-run-no-unresolved-conflicts',
  'current-precondition-hashes-for-all-targets',
  'single-writer-lease-owner-hash',
  'durable-restart-readable-journal-reference',
  'idempotency-key-hash-and-request-body-hash',
  'backup-or-snapshot-reference-hash',
  'named-operator-reviewer-recovery-owner',
  'artifact-redaction-scan-pass',
  'local-only-network-posture',
]);

const requiredArtifactPaths = Object.freeze([
  'docs/release/release-artifact-package.md',
  'docs/evidence/rpp-0914-release-artifact-package.md',
  'docs/operations/operator-runbook.md',
  'docs/recovery/operator-safe-recovery.md',
  'docs/recovery/apply-journal.md',
  'docs/recovery/acceptable-states.md',
  'docs/evidence/rpp-0904-operator-safe-recovery-audit.md',
  'docs/evidence/rpp-0909-operator-runbook.md',
]);

const requiredExcludedMaterial = Object.freeze([
  'production-credentials',
  'application-password-values',
  'authorization-headers',
  'cookies-or-session-identifiers',
  'raw-database-rows',
  'raw-option-or-post-content',
  'file-bytes-or-private-paths',
  'live-service-configuration',
  'backup-contents',
  'customer-data-or-private-notes',
]);

const requiredStopConditions = Object.freeze([
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
  'hidden-assumption-answer-missing',
]);

test('RPP-0914 manifest defines a support-only NO-GO package contract', () => {
  const { report, text } = loadMarkdownJson(manifestPath);

  assert.match(text, /^# Reprint Push Release Artifact Package Manifest$/m);
  assert.match(text, /Variant: RPP-0914 release artifact package variant 1/);
  assert.match(text, /Final release: `NO-GO`/);
  assert.match(text, /does not move release gates/);
  assert.match(text, /does not include production secret material/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0914');
  assert.equal(report.packageId, 'rpp-0914-release-artifact-package-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGateMovement, 'none');
  assert.equal(report.remoteTunnelsUsed, false);
  assert.equal(report.dashboardsStarted, false);
});

test('RPP-0914 manifest records safe recovery prerequisites and included artifacts', () => {
  const { report, text } = loadMarkdownJson(manifestPath);

  for (const required of requiredPrerequisites) {
    assert.ok(report.prerequisites.includes(required), `missing prerequisite ${required}`);
  }

  const artifactPaths = report.includedArtifacts.map((artifact) => artifact.path);
  assert.deepEqual(artifactPaths, requiredArtifactPaths);

  for (const artifact of report.includedArtifacts) {
    assert.equal(artifact.productionSecretMaterial, false, `${artifact.path} must exclude production secrets`);
    assert.equal(artifact.productionBackedEvidence, false, `${artifact.path} must stay support-only`);
    assert.match(artifact.purpose, /\S/);
    assert.match(artifact.contains, /\S/);
  }

  assert.match(text, /\[Operator Runbook\]\(\.\.\/operations\/operator-runbook\.md\)/);
  assert.match(text, /\[Operator Safe Recovery\]\(\.\.\/recovery\/operator-safe-recovery\.md\)/);
  assert.match(text, /\[Apply Journal Recovery States\]\(\.\.\/recovery\/apply-journal\.md\)/);
  assert.match(text, /\[Acceptable Post-Failure States\]\(\.\.\/recovery\/acceptable-states\.md\)/);
  assert.match(text, /^## Safe Recovery Prerequisites$/m);
  assert.match(text, /^## Included Artifacts$/m);
  assert.match(text, /^## Excluded Production Secrets$/m);
});

test('RPP-0914 manifest stop conditions close hidden recovery assumptions', () => {
  const { report, text } = loadMarkdownJson(manifestPath);

  assert.deepEqual(report.safeRecoveryContract.acceptableStates, acceptableStates);
  assert.equal(report.safeRecoveryContract.noHiddenAssumptions, true);
  assert.equal(report.safeRecoveryContract.normalValidatedApplyOnly, true);
  assert.equal(report.safeRecoveryContract.sameRunEnvelopeRequired, true);
  assert.equal(report.safeRecoveryContract.sameRecoveryPathRequired, true);
  assert.equal(report.safeRecoveryContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.safeRecoveryContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.safeRecoveryContract.unknownStateAction, 'blocked-recovery');
  assert.equal(report.safeRecoveryContract.manualProductionRepairAuthorized, false);

  for (const stopCondition of requiredStopConditions) {
    assert.ok(report.stopConditions.includes(stopCondition), `missing stop condition ${stopCondition}`);
  }

  for (const pattern of [
    /Missing evidence means\s+stop/,
    /Do not infer safety from a successful status code/,
    /the recovery action must use the same checked path and\s+the same run envelope/,
    /Final release remains `NO-GO`/,
    /no\s+release-gate status movement/,
  ]) {
    assert.match(text, pattern);
  }
});

test('RPP-0914 evidence records package alignment and support-only integration posture', () => {
  const manifest = loadMarkdownJson(manifestPath).report;
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0914');
  assert.equal(report.proofId, 'rpp-0914-release-artifact-package-v1');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.packageContract.noHiddenAssumptions, true);
  assert.equal(report.packageContract.releaseGateMovement, 'none');
  assert.equal(report.packageContract.dashboardsStarted, false);
  assert.equal(report.packageContract.remoteTunnelsUsed, false);
  assert.deepEqual(report.packageContract.acceptableStates, acceptableStates);
  assert.deepEqual(report.prerequisites, manifest.prerequisites);
  assert.deepEqual(report.includedArtifacts, requiredArtifactPaths);
  assert.deepEqual(report.excludedMaterial, manifest.excludedMaterial);
  assert.deepEqual(report.stopConditions, manifest.stopConditions);
  assert.equal(report.releasePosture.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releasePosture.releaseMovementAllowed, false);
  assert.equal(report.releasePosture.productionBackedEvidenceAdded, false);
  assert.ok(text.includes('Final release remains `NO-GO`'));
  assert.ok(text.includes('no release-gate status movement is allowed'));
});

test('RPP-0914 package evidence excludes production secrets and remains redacted', () => {
  const manifest = loadMarkdownJson(manifestPath);
  const evidence = loadMarkdownJson(evidencePath);

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(manifest.report, { label: 'RPP-0914 package manifest' }));
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence.report, { label: 'RPP-0914 package evidence' }));

  for (const excluded of requiredExcludedMaterial) {
    assert.ok(manifest.report.excludedMaterial.includes(excluded), `manifest must exclude ${excluded}`);
    assert.ok(evidence.report.excludedMaterial.includes(excluded), `evidence must exclude ${excluded}`);
  }

  assert.equal(evidence.report.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(evidence.report.redactionPosture.rawValuesIncluded, false);
  assert.equal(evidence.report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(evidence.report.redactionPosture.cookiesIncluded, false);
  assert.equal(evidence.report.redactionPosture.privatePathsIncluded, false);
  assert.equal(evidence.report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(evidence.report.redactionPosture.productionSecretMaterialIncluded, false);
  assert.equal(manifest.text.includes('http://'), false);
  assert.equal(manifest.text.includes('https://'), false);
  assert.equal(evidence.text.includes('http://'), false);
  assert.equal(evidence.text.includes('https://'), false);
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
