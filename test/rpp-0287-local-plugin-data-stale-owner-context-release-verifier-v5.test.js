import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  localPluginDataStaleOwnerContextReleaseVerifierBoundary,
  summarizeLocalPluginDataStaleOwnerContextReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'private-rpp0287-base-local-plugin-option',
  'private-rpp0287-local-plugin-option',
  '<?php /* private rpp0287 owner file base */',
  '<?php /* private rpp0287 owner file stale remote */',
]);

function assertNoRawOwnerContextPayloads(value, label) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('option_value'), false, `${label} must not expose option_value fields`);
  assert.equal(serialized.includes('__pluginOwner'), false, `${label} must not expose raw owner marker fields`);
}

test('RPP-0287 release verifier carries stale owner context executor refusals as hash-only support evidence', () => {
  const proof = summarizeLocalPluginDataStaleOwnerContextReleaseVerifierProof({
    now: new Date('2026-05-30T10:28:07.000Z'),
  });
  const boundary = localPluginDataStaleOwnerContextReleaseVerifierBoundary;

  assert.equal(proof.rpp, 'RPP-0287');
  assert.equal(proof.evidenceSource, 'release-verifier-local-plugin-data-stale-owner-context-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'LOCAL_PLUGIN_DATA_STALE_OWNER_CONTEXT_REJECTED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.driver, 'wp-option');
  assert.equal(proof.owner, 'forms');
  assert.deepEqual(proof.resource, {
    resourceKey: boundary.resourceKey,
    table: boundary.table,
    rowId: boundary.rowId,
    ownerFileResourceKey: boundary.ownerFileResourceKey,
  });
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'local-plugin-data-stale-owner-context',
    variant: 'v5',
    executorRejectsStaleMutationAttempts: true,
    executorRejectsForgedMutationAttempts: true,
  });
  assert.deepEqual(proof.allowlist, {
    resourceKey: boundary.resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    supportsDelete: false,
    policySource: 'local-snapshot',
  });

  assert.equal(proof.plan.status, 'ready');
  assert.deepEqual(proof.plan.summary, { mutations: 1, conflicts: 0, blockers: 0 });
  assert.equal(proof.plan.mutationCount, 1);
  assert.equal(proof.plan.preconditionCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.mutationBoundary.resourceKey, boundary.resourceKey);
  assert.equal(proof.mutationBoundary.action, 'put');
  assert.equal(proof.mutationBoundary.changeKind, 'update');
  assert.equal(proof.mutationBoundary.pluginOwner, 'forms');
  assert.equal(proof.mutationBoundary.driver, 'wp-option');
  assert.equal(proof.mutationBoundary.policySource, 'local-snapshot');
  assert.equal(proof.mutationBoundary.supportsDelete, false);
  assert.equal(proof.mutationBoundary.ownerContextRequired, true);
  assert.equal(proof.mutationBoundary.exactMutation, true);
  assert.match(proof.mutationBoundary.baseHash, sha256HexPattern);
  assert.match(proof.mutationBoundary.localHash, sha256HexPattern);
  assert.match(proof.mutationBoundary.remoteBeforeHash, sha256HexPattern);
  assert.match(proof.mutationBoundary.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.mutationHash, sha256EvidencePattern);

  assert.equal(proof.ownerContext.required, true);
  assert.deepEqual(proof.ownerContext.resourceKeys, [
    boundary.ownerFileResourceKey,
    'plugin:forms',
  ]);
  assert.equal(proof.ownerContext.fileContextPresent, true);
  assert.match(proof.ownerContext.fileContextHash, sha256EvidencePattern);
  assert.match(proof.ownerContext.ownerContextHash, sha256EvidencePattern);

  assert.equal(proof.precondition.resourceKey, boundary.resourceKey);
  assert.equal(proof.precondition.expectedHash, proof.mutationBoundary.remoteBeforeHash);
  assert.equal(proof.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.precondition.exactPrecondition, true);
  assert.match(proof.precondition.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.validApply.ok, true);
  assert.equal(proof.validApply.appliedMutations, 1);
  assert.equal(proof.validApply.rowHashAfter, `sha256:${proof.mutationBoundary.localHash}`);
  assert.match(proof.validApply.journalHash, sha256EvidencePattern);

  const stale = proof.staleOwnerContextRefusal;
  assert.equal(stale.rejectedBeforeMutation, true);
  assert.equal(stale.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(stale.beforeMutationCalls, 0);
  assert.equal(stale.details.resourceKey, boundary.resourceKey);
  assert.equal(stale.details.pluginOwner, 'forms');
  assert.equal(stale.details.contextResourceKey, boundary.ownerFileResourceKey);
  assert.match(stale.details.expectedHash, sha256HexPattern);
  assert.match(stale.details.actualHash, sha256HexPattern);
  assert.notEqual(stale.details.actualHash, stale.details.expectedHash);
  assert.equal(stale.rowHashAfter, stale.rowHashBefore);
  assert.equal(stale.remoteHashAfter, stale.remoteHashBefore);
  assert.equal(stale.remoteDataPreserved, true);
  assert.equal(stale.unexpectedApplyMutationCount, 0);
  assert.match(stale.detailsHash, sha256EvidencePattern);
  assert.match(stale.rowHashBefore, sha256EvidencePattern);
  assert.match(stale.remoteHashBefore, sha256EvidencePattern);

  assert.deepEqual(
    proof.forgedMutationRefusals.map((entry) => entry.attack),
    ['missing-owner-context-envelope', 'forged-owner-context-hash'],
  );
  for (const forged of proof.forgedMutationRefusals) {
    assert.equal(forged.rejectedBeforeMutation, true, `${forged.attack} should fail before mutation`);
    assert.equal(forged.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(forged.beforeMutationCalls, 0);
    assert.equal(forged.remoteDataPreserved, true);
    assert.equal(forged.rowHashAfter, forged.rowHashBefore);
    assert.equal(forged.remoteHashAfter, forged.remoteHashBefore);
    assert.equal(forged.unexpectedApplyMutationCount, 0);
    assert.match(forged.forgedPlanHash, sha256EvidencePattern);
    assert.match(forged.detailsHash, sha256EvidencePattern);
    assert.equal(forged.details.resourceKey, boundary.resourceKey);
    assert.equal(forged.details.pluginOwner, 'forms');
  }
  const missingEnvelope = proof.forgedMutationRefusals[0];
  assert.equal(missingEnvelope.details.contextResourceKey, boundary.ownerFileResourceKey);
  assert.equal(missingEnvelope.details.expectedHash, null);
  assert.match(missingEnvelope.details.actualHash, sha256HexPattern);
  const forgedHash = proof.forgedMutationRefusals[1];
  assert.equal(forgedHash.details.contextResourceKey, boundary.ownerFileResourceKey);
  assert.equal(forgedHash.details.expectedHash, '0'.repeat(64));
  assert.match(forgedHash.details.actualHash, sha256HexPattern);
  assert.notEqual(forgedHash.details.actualHash, forgedHash.details.expectedHash);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.rawFieldNamesIncluded, false);
  assert.deepEqual(proof.redaction.surfaces, [
    'ready-plan-boundary',
    'valid-apply-hash',
    'stale-owner-context-refusal',
    'forged-mutation-refusals',
    'release-verifier-proof',
  ]);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawOwnerContextPayloads(proof, 'RPP-0287 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0287 release verifier stale owner context proof' }));
});

test('RPP-0287 production-shaped release verifier carries stale owner context summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const carryThroughMatches = verifierSource.match(
    /localPluginDataStaleOwnerContext: localPluginDataStaleOwnerContextReleaseVerifierProof/g,
  ) || [];

  assert.match(verifierSource, /export function summarizeLocalPluginDataStaleOwnerContextReleaseVerifierProof/);
  assert.match(verifierSource, /LOCAL_PLUGIN_DATA_STALE_OWNER_CONTEXT_REJECTED/);
  assert.match(verifierSource, /mergeInvariants:\s*\{\s*localPluginDataStaleOwnerContext: localPluginDataStaleOwnerContextReleaseVerifierProof,/);
  assert.equal(carryThroughMatches.length, 2, 'expected failure and success verifier outputs to carry RPP-0287 proof');
});
