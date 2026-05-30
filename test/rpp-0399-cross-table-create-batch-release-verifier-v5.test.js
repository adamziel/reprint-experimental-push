import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  crossTableCreateBatchReleaseVerifierBoundary,
  summarizeCrossTableCreateBatchReleaseVerifierProof,
  summarizeGraphIdentityReleaseVerifierProofs,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'RPP-0399 private cross-table create post',
  'rpp-0399-private-cross-table-create-body',
  'rpp-0399-private-cross-table-postmeta',
  'RPP-0399 private cross-table term',
  'rpp-0399-private-cross-table-termmeta',
  'RPP-0399 stale remote private create target',
]);

function assertSha256(value, label = 'sha256 hash') {
  assert.match(value, sha256Pattern, label);
}

function assertSha256Evidence(value, label = 'sha256 evidence') {
  assert.match(value, sha256EvidencePattern, label);
}

function assertNoRawFixtures(value, label = 'RPP-0399 release verifier proof') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture ${raw}`);
  }
  for (const rawKey of ['post_title', 'post_content', 'meta_value', 'term_name', 'termmetaValue']) {
    assert.equal(serialized.includes(rawKey), false, `${label} exposed raw field ${rawKey}`);
  }
}

test('RPP-0399 release verifier carries a cross-table create batch through apply', () => {
  const proof = summarizeCrossTableCreateBatchReleaseVerifierProof({
    now: new Date('2026-05-30T16:39:00.000Z'),
  });
  const boundary = crossTableCreateBatchReleaseVerifierBoundary;

  assert.equal(proof.rpp, 'RPP-0399');
  assert.equal(proof.evidenceSource, 'release-verifier-cross-table-create-batch-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'CROSS_TABLE_CREATE_BATCH_APPLIED_SUPPORT_ONLY');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.batch.resourceKeys, Object.values(boundary.resources));
  assert.deepEqual(proof.batch.tables, [
    'wp_postmeta',
    'wp_posts',
    'wp_term_relationships',
    'wp_term_taxonomy',
    'wp_termmeta',
    'wp_terms',
  ]);
  assert.equal(proof.batch.createMutationCount, 6);
  assert.equal(proof.batch.referenceEdgeCount, 5);

  assert.equal(proof.plan.status, 'ready');
  assert.deepEqual(proof.plan.summary, {
    mutations: 6,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(proof.plan.mutationCount, 6);
  assert.equal(proof.plan.preconditionCount, 6);
  assert.equal(proof.plan.decisionCount, 0);
  assertSha256Evidence(proof.plan.hash, 'plan hash');

  assert.equal(proof.mutations.length, 6);
  for (const mutation of proof.mutations) {
    assert.ok(Object.values(boundary.resources).includes(mutation.resourceKey));
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, 'create');
    assert.equal(mutation.localChange, 'create');
    assert.equal(mutation.remoteChange, 'unchanged');
    assert.equal(mutation.exactMutation, true);
    assertSha256(mutation.baseHash, `${mutation.resourceKey} base hash`);
    assertSha256(mutation.localHash, `${mutation.resourceKey} local hash`);
    assertSha256(mutation.remoteBeforeHash, `${mutation.resourceKey} remote hash`);
    assert.equal(mutation.baseHash, mutation.remoteBeforeHash);
    assert.equal(mutation.mutationBaseHash, mutation.baseHash);
    assert.equal(mutation.mutationRemoteBeforeHash, mutation.remoteBeforeHash);
    assert.equal(mutation.mutationLocalHash, mutation.localHash);
    assert.equal(mutation.precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(mutation.precondition.checkedAgainst, 'live-remote');
    assert.equal(mutation.precondition.exactPrecondition, true);
    assertSha256Evidence(mutation.precondition.preconditionHash, 'precondition evidence hash');
    assertSha256Evidence(mutation.mutationHash, 'mutation evidence hash');
  }

  assert.deepEqual(
    proof.referenceEdges.map((entry) => [entry.relationshipKey, entry.sourceResourceKey, entry.targetResourceKey]),
    [
      ['wp_postmeta.post_id', boundary.resources.postmeta, boundary.resources.post],
      ['wp_term_taxonomy.term_id', boundary.resources.taxonomy, boundary.resources.term],
      ['wp_term_relationships.object_id', boundary.resources.relationship, boundary.resources.post],
      ['wp_term_relationships.term_taxonomy_id', boundary.resources.relationship, boundary.resources.taxonomy],
      ['wp_termmeta.term_id', boundary.resources.termmeta, boundary.resources.term],
    ],
  );
  assert.ok(proof.referenceEdges.every((entry) => entry.preserved));

  assert.equal(proof.applyCarryThrough.mutateRemote, true);
  assert.equal(proof.applyCarryThrough.applyPlanSucceeded, true);
  assert.equal(proof.applyCarryThrough.appliedMutations, 6);
  assert.equal(proof.applyCarryThrough.beforeMutationCount, 6);
  assert.equal(proof.applyCarryThrough.journalEntries, 6);
  assert.equal(proof.applyCarryThrough.journalPlannedEvents, 6);
  assert.equal(proof.applyCarryThrough.journalObservedEvents, 6);
  assert.equal(proof.applyCarryThrough.journalApplied, true);
  assert.equal(proof.applyCarryThrough.allRowsCreated, true);
  assert.equal(proof.applyCarryThrough.finalMatchesLocal, true);
  assert.equal(proof.applyCarryThrough.carriedThroughApply, true);
  assertSha256Evidence(proof.applyCarryThrough.remoteHashBefore, 'remote before hash');
  assertSha256Evidence(proof.applyCarryThrough.remoteHashAfter, 'remote after hash');
  assert.notEqual(proof.applyCarryThrough.remoteHashBefore, proof.applyCarryThrough.remoteHashAfter);

  assert.equal(proof.staleReplay.preMutation, true);
  assert.equal(proof.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(proof.staleReplay.failedBeforeMutation, true);
  assert.equal(proof.staleReplay.remoteUnchanged, true);
  assert.equal(proof.staleReplay.staleResourceKey, boundary.resources.post);
  assertSha256Evidence(proof.staleReplay.remoteHashBefore, 'stale remote before hash');
  assert.equal(proof.staleReplay.remoteHashAfter, proof.staleReplay.remoteHashBefore);
  assertSha256Evidence(proof.staleReplay.detailsHash, 'stale details hash');

  assert.deepEqual(proof.invariants, {
    planReady: true,
    everyMutationCreate: true,
    everyMutationHasLivePrecondition: true,
    everyPreconditionMatchesAbsentBase: true,
    crossTableReferencesPreserved: true,
    applyMutatedRemote: true,
    allRowsCreated: true,
    finalMatchesLocal: true,
    journalApplied: true,
    staleReplayRejectedBeforeMutation: true,
  });
  assertSha256Evidence(proof.proofHash, 'proof hash');
  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0399 cross-table create batch proof' }));
});

test('RPP-0399 release verifier exposes the cross-table create batch in graphIdentity output', () => {
  const graphIdentity = summarizeGraphIdentityReleaseVerifierProofs();
  assert.equal(
    graphIdentity.crossTableCreateBatch.verdict,
    'CROSS_TABLE_CREATE_BATCH_APPLIED_SUPPORT_ONLY',
  );
  assert.equal(graphIdentity.crossTableCreateBatch.applyCarryThrough.carriedThroughApply, true);
  assert.equal(graphIdentity.crossTableCreateBatch.batch.tag, crossTableCreateBatchReleaseVerifierBoundary.tag);
  assertNoRawFixtures(graphIdentity, 'RPP-0399 graphIdentity bundle');
});

test('RPP-0399 production-shaped release verifier emits graph identity carry-through proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeCrossTableCreateBatchReleaseVerifierProof/);
  assert.match(verifierSource, /crossTableCreateBatch: summarizeCrossTableCreateBatchReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /graphIdentity: graphIdentityProofs/);
  assert.match(verifierSource, /CROSS_TABLE_CREATE_BATCH_APPLIED_SUPPORT_ONLY/);
});
