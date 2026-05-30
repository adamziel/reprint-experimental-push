import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  localDeleteRemoteEditReleaseVerifierBoundary,
  summarizeLocalDeleteRemoteEditReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0283-release-verifier-base-private-title',
  'rpp-0283-release-verifier-base-private-body',
  'rpp-0283-release-verifier-remote-private-title',
  'rpp-0283-release-verifier-remote-private-body',
  'rpp-0283-release-verifier-local-private-file',
]);

function assertNoRawFixtures(value, label) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('post_title'), false, `${label} must not expose raw post_title fields`);
  assert.equal(serialized.includes('post_content'), false, `${label} must not expose raw post_content fields`);
}

test('RPP-0283 release verifier carries local delete versus remote edit as hash-only conflict evidence', () => {
  const proof = summarizeLocalDeleteRemoteEditReleaseVerifierProof({
    now: new Date('2026-05-30T14:28:30.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0283');
  assert.equal(proof.evidenceSource, 'release-verifier-local-delete-remote-edit-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'LOCAL_DELETE_REMOTE_EDIT_HASH_ONLY_CONFLICT_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.invariant, 'local-delete-versus-remote-edit');
  assert.deepEqual(proof.resource, {
    resourceKey: localDeleteRemoteEditReleaseVerifierBoundary.resourceKey,
    table: 'wp_posts',
    rowId: 'ID:283',
  });
  assert.deepEqual(proof.independentMutationResource, {
    resourceKey: localDeleteRemoteEditReleaseVerifierBoundary.independentFileKey,
    type: 'file',
  });
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'local-delete-versus-remote-edit',
    variant: 'v5',
    serializedPlanEvidence: 'hash-only',
    remoteEditPreserved: true,
  });

  assert.equal(proof.plan.status, 'conflict');
  assert.deepEqual(proof.plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(proof.plan.mutationCount, 1);
  assert.equal(proof.plan.preconditionCount, 1);
  assert.equal(proof.plan.conflictCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.targetConflict.resourceKey, localDeleteRemoteEditReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.targetConflict.class, 'row-conflict');
  assert.equal(proof.targetConflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(proof.targetConflict.localChange, 'delete');
  assert.equal(proof.targetConflict.remoteChange, 'update');
  assert.deepEqual(proof.targetConflict.states, {
    base: 'present',
    local: 'absent',
    remote: 'present',
  });
  assert.match(proof.targetConflict.hashes.base, sha256HexPattern);
  assert.match(proof.targetConflict.hashes.local, sha256HexPattern);
  assert.match(proof.targetConflict.hashes.remote, sha256HexPattern);
  assert.equal(proof.targetConflict.conflictIsLocalDeleteRemoteEdit, true);
  assert.equal(proof.targetConflict.targetMutationPresent, false);
  assert.equal(proof.targetConflict.targetPreconditionPresent, false);

  assert.equal(proof.independentMutation.resourceKey, localDeleteRemoteEditReleaseVerifierBoundary.independentFileKey);
  assert.equal(proof.independentMutation.action, 'put');
  assert.equal(proof.independentMutation.changeKind, 'update');
  assert.match(proof.independentMutation.baseHash, sha256HexPattern);
  assert.match(proof.independentMutation.localHash, sha256HexPattern);
  assert.match(proof.independentMutation.remoteBeforeHash, sha256HexPattern);
  assert.equal(proof.independentMutation.precondition.resourceKey, proof.independentMutation.resourceKey);
  assert.equal(proof.independentMutation.precondition.mutationId, proof.independentMutation.id);
  assert.equal(proof.independentMutation.precondition.expectedHash, proof.independentMutation.remoteBeforeHash);
  assert.equal(proof.independentMutation.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.independentMutation.retainedWithLiveRemotePrecondition, true);

  assert.equal(proof.preconditions.allMutationsHaveLiveRemotePreconditions, true);
  assert.equal(proof.preconditions.targetPreconditionPresent, false);
  assert.equal(proof.preconditions.count, 1);

  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.match(proof.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.deepEqual(proof.applyRefusal.durableJournalEventTypes, []);
  assert.equal(proof.applyRefusal.remoteDataPreserved, true);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.equal(proof.applyRefusal.targetRowHashAfter, proof.applyRefusal.targetRowHashBefore);
  assert.equal(proof.applyRefusal.independentHashAfter, proof.applyRefusal.independentHashBefore);
  assert.match(proof.applyRefusal.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.targetRowHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.independentHashBefore, sha256EvidencePattern);

  assert.equal(proof.planEvidence.status, 'conflict');
  assert.equal(proof.planEvidence.target.resourceKey, localDeleteRemoteEditReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.planEvidence.target.mutationPresent, false);
  assert.equal(proof.planEvidence.target.preconditionPresent, false);
  assert.equal(proof.planEvidence.independentMutation.resourceKey, localDeleteRemoteEditReleaseVerifierBoundary.independentFileKey);
  assert.equal(proof.planEvidence.independentMutation.mutationPresent, true);
  assert.equal(proof.planEvidence.independentMutation.preconditionPresent, true);
  assert.equal(proof.planEvidence.mutations.length, 1);
  assert.equal(proof.planEvidence.preconditions.length, 1);
  assert.equal(proof.planEvidence.conflicts.length, 1);
  assert.equal(proof.planEvidence.conflicts[0].localChange, 'delete');
  assert.equal(proof.planEvidence.conflicts[0].remoteChange, 'update');
  assert.match(proof.planEvidence.conflicts[0].remoteHash, sha256HexPattern);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.deepEqual(proof.redaction.surfaces, [
    'release-verifier-local-delete-remote-edit-plan-evidence',
    'apply-refusal-details',
    'release-verifier-proof',
  ]);
  assert.match(proof.redaction.serializedPlanEvidenceHash, sha256EvidencePattern);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.equal(proof.rawValuesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);

  assertNoRawFixtures(proof.planEvidence, 'RPP-0283 serialized plan evidence');
  assertNoRawFixtures(proof, 'RPP-0283 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0283 release verifier local delete remote edit proof' }));
});

test('RPP-0283 production-shaped release verifier emits local delete remote edit carry-through', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeLocalDeleteRemoteEditReleaseVerifierProof/);
  assert.match(verifierSource, /localDeleteRemoteEdit: summarizeLocalDeleteRemoteEditReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /LOCAL_DELETE_REMOTE_EDIT_HASH_ONLY_CONFLICT_PRESERVED/);
});
