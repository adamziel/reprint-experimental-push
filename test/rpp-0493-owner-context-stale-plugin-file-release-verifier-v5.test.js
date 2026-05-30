import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  ownerContextStalePluginFileReleaseVerifierBoundary,
  summarizeOwnerContextStalePluginFileReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boundary = ownerContextStalePluginFileReleaseVerifierBoundary;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawSentinels = Object.freeze([
  'RPP_0493_BASE_ROW_PRIVATE',
  'RPP_0493_LOCAL_ROW_PRIVATE',
  'RPP_0493_BASE_OWNER_FILE_PRIVATE',
  'RPP_0493_SHARED_OWNER_FILE_PRIVATE',
  'RPP_0493_STALE_OWNER_FILE_PRIVATE',
]);

function assertHashOnly(value, label = 'RPP-0493 release-verifier evidence') {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked ${sentinel}`);
  }
  assert.equal(json.includes('meta_value'), false, `${label} leaked a raw meta_value key`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0493 release verifier carries owner-context stale plugin-file refusal as local NO-GO evidence', () => {
  const proof = summarizeOwnerContextStalePluginFileReleaseVerifierProof();

  assert.equal(proof.rpp, 'RPP-0493');
  assert.equal(proof.proofKind, 'owner-context-stale-plugin-file-refusal');
  assert.equal(proof.evidenceSource, 'release-verifier-owner-context-stale-plugin-file-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'OWNER_CONTEXT_STALE_PLUGIN_FILE_REFUSAL_CARRIED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.owner, boundary.owner);
  assert.equal(proof.driver, boundary.driver);
  assert.deepEqual(proof.resource, {
    resourceKey: boundary.resourceKey,
    table: boundary.table,
    rowId: boundary.rowId,
    pluginResourceKey: boundary.pluginResourceKey,
    pluginFileResourceKey: boundary.pluginFileResourceKey,
  });

  assert.equal(proof.readyApply.status, 'ready');
  assert.equal(proof.readyApply.mutationCount, 1);
  assert.equal(proof.readyApply.decisionCount, 1);
  assert.equal(proof.readyApply.blockerCount, 0);
  assert.equal(proof.readyApply.preconditionCount, 1);
  assert.equal(proof.readyApply.appliedMutations, 1);
  assert.equal(proof.readyApply.ownerContextRequired, true);
  assert.equal(proof.readyApply.policySource, 'local-snapshot');
  assert.equal(proof.readyApply.releaseGateEvidenceScope, 'local-release-verifier');
  assert.notEqual(proof.readyApply.rowHashAfter, proof.readyApply.rowHashBefore);
  assert.match(proof.readyApply.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.readyApply.rowHashAfter, sha256EvidencePattern);
  assert.match(proof.readyApply.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.readyApply.remoteHashAfter, sha256EvidencePattern);
  assert.match(proof.readyApply.mutationHash, sha256EvidencePattern);
  assert.match(proof.readyApply.ownerContextHash, sha256EvidencePattern);
  assert.equal(proof.readyApply.ownerFileContext.resourceKey, boundary.pluginFileResourceKey);
  assert.equal(proof.readyApply.ownerFileContext.localRemoteMatch, true);
  assert.equal(proof.readyApply.ownerFileContext.changedSinceBase, true);
  assert.match(proof.readyApply.ownerFileContext.contextHash, sha256EvidencePattern);
  assert.match(proof.readyApply.ownerMetadataContextHash, sha256EvidencePattern);
  assert.match(proof.readyApply.driverApplyValidationHash, sha256EvidencePattern);
  assert.match(proof.readyApply.journalHash, sha256EvidencePattern);
});

test('RPP-0493 release verifier keeps stale planner and replay refusals fail-closed', () => {
  const proof = summarizeOwnerContextStalePluginFileReleaseVerifierProof();

  assert.equal(proof.stalePlanner.status, 'blocked');
  assert.equal(proof.stalePlanner.mutationCount, 0);
  assert.equal(proof.stalePlanner.blockerCount, 1);
  assert.equal(proof.stalePlanner.blockerClass, 'stale-plugin-owner-context');
  assert.equal(proof.stalePlanner.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.deepEqual(proof.stalePlanner.stalePluginFileResourceKeys, [boundary.pluginFileResourceKey]);
  assert.equal(proof.stalePlanner.remoteUnchanged, true);
  assert.equal(proof.stalePlanner.blockedPlanApplyCode, 'PLAN_NOT_READY');
  assert.match(proof.stalePlanner.blockerHash, sha256EvidencePattern);
  assert.match(proof.stalePlanner.ownerFileRefusalEvidenceHash, sha256EvidencePattern);
  assert.match(proof.stalePlanner.ownerContextRefusalEvidenceHash, sha256EvidencePattern);
  assert.match(proof.stalePlanner.driverAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.stalePlanner.blockedPlanApplyErrorHash, sha256EvidencePattern);

  assert.equal(proof.staleReplay.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(proof.staleReplay.contextResourceKey, boundary.pluginFileResourceKey);
  assert.equal(proof.staleReplay.expectedHashMatchesReadyContext, true);
  assert.equal(proof.staleReplay.actualHashDiffersFromReadyContext, true);
  assert.equal(proof.staleReplay.beforeMutationCalls, 0);
  assert.equal(proof.staleReplay.rowHashAfter, proof.staleReplay.rowHashBefore);
  assert.equal(proof.staleReplay.remoteHashAfter, proof.staleReplay.remoteHashBefore);
  assert.equal(proof.staleReplay.remoteUnchanged, true);
  assert.match(proof.staleReplay.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.staleReplay.rowHashAfter, sha256EvidencePattern);
  assert.match(proof.staleReplay.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.staleReplay.remoteHashAfter, sha256EvidencePattern);
  assert.match(proof.staleReplay.errorDetailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertHashOnly(proof);
});

test('RPP-0493 production-shaped release verifier includes the owner-context proof in pluginDriver output', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );
  const proof = summarizeOwnerContextStalePluginFileReleaseVerifierProof();
  const replay = summarizeOwnerContextStalePluginFileReleaseVerifierProof();

  assert.deepEqual(replay, proof, 'RPP-0493 proof should be deterministic');
  assert.match(verifierSource, /summarizeOwnerContextStalePluginFileReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /const ownerContextStalePluginFileEvidence =\s*summarizeOwnerContextStalePluginFileReleaseVerifierProof\(\);/,
  );
  assert.match(
    verifierSource,
    /ownerContext:\s*\{\s*stalePluginFile: ownerContextStalePluginFileEvidence,\s*staleMetadata: summarizeOwnerContextStaleMetadataReleaseVerifierEvidence\(\),\s*\}/,
  );
  assertHashOnly(proof);
});
