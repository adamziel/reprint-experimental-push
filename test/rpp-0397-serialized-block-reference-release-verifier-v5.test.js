import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  serializedBlockReferenceReleaseVerifierBoundary,
  summarizeSerializedBlockReferenceReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0397-release-verifier-local-private-serialized-block-title',
  'rpp-0397-release-verifier-local-private-serialized-block-caption',
  'rpp-0397-release-verifier-base-private-page-target-title',
  'rpp-0397-release-verifier-base-private-page-target-body',
]);

function assertNoRawFixtures(value, label) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('"post_title":'), false, `${label} must not expose raw post_title fields`);
  assert.equal(serialized.includes('"post_content":'), false, `${label} must not expose raw post_content fields`);
}

test('RPP-0397 release verifier carries serialized block unsupported target as hash-only evidence', () => {
  const proof = summarizeSerializedBlockReferenceReleaseVerifierProof({
    now: new Date('2026-05-30T16:39:07.000Z'),
  });
  const boundary = serializedBlockReferenceReleaseVerifierBoundary;

  assert.equal(proof.rpp, 'RPP-0397');
  assert.equal(proof.evidenceSource, 'release-verifier-serialized-block-reference-detection-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'SERIALIZED_BLOCK_UNSUPPORTED_TARGET_HASH_ONLY_EVIDENCE');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.deepEqual(proof.relationship, {
    relationshipKey: boundary.relationshipKey,
    relationshipType: boundary.relationshipType,
    serializedBlockName: boundary.serializedBlockName,
    serializedBlockAttributePath: boundary.serializedBlockAttributePath,
  });
  assert.deepEqual(proof.source, {
    resourceKey: boundary.sourceResourceKey,
    table: boundary.sourceTable,
    rowId: boundary.sourceRowId,
  });
  assert.deepEqual(proof.target, {
    resourceKey: boundary.targetResourceKey,
    table: boundary.targetTable,
    rowId: boundary.targetRowId,
    postType: boundary.unsupportedTargetPostType,
  });
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'serialized-block-reference-detection',
    variant: 'v5',
    serializedPlanEvidence: 'hash-only',
    unsupportedTargetFailsClosed: true,
    remoteDataPreserved: true,
  });

  assert.equal(proof.plan.status, 'blocked');
  assert.deepEqual(proof.plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(proof.plan.mutationCount, 0);
  assert.equal(proof.plan.preconditionCount, 0);
  assert.equal(proof.plan.blockerCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.sourceBlocker.resourceKey, boundary.sourceResourceKey);
  assert.equal(proof.sourceBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(proof.sourceBlocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(proof.sourceBlocker.reason, /without proven identity mapping or reference rewriting/);
  assert.match(proof.sourceBlocker.baseHash, sha256HexPattern);
  assert.match(proof.sourceBlocker.localHash, sha256HexPattern);
  assert.match(proof.sourceBlocker.remoteHash, sha256HexPattern);
  assert.equal(proof.sourceBlocker.change.localChange, 'create');
  assert.equal(proof.sourceBlocker.change.remoteChange, 'unchanged');
  for (const slot of ['base', 'local', 'remote']) {
    assert.match(proof.sourceBlocker.change[slot].hash, sha256HexPattern);
    assert.equal(Object.hasOwn(proof.sourceBlocker.change[slot], 'value'), false);
  }

  assert.equal(proof.sourceBlocker.references.length, 1);
  const reference = proof.sourceBlocker.references[0];
  assert.equal(reference.relationshipKey, boundary.relationshipKey);
  assert.equal(reference.relationshipType, boundary.relationshipType);
  assert.equal(reference.sourceResourceKey, boundary.sourceResourceKey);
  assert.equal(reference.targetResourceKey, boundary.targetResourceKey);
  assert.equal(reference.serializedBlockName, boundary.serializedBlockName);
  assert.equal(reference.serializedBlockAttributePath, boundary.serializedBlockAttributePath);
  assert.match(reference.targetBaseHash, sha256HexPattern);
  assert.match(reference.targetLocalHash, sha256HexPattern);
  assert.match(reference.targetRemoteHash, sha256HexPattern);
  assert.deepEqual(reference.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${boundary.sourceResourceKey} references a serialized block attachment target that is not a supported attachment row.`,
  });
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'unchanged');
  for (const slot of ['base', 'local', 'remote']) {
    assert.match(reference.targetChange[slot].hash, sha256HexPattern);
    assert.equal(Object.hasOwn(reference.targetChange[slot], 'value'), false);
  }

  assert.deepEqual(proof.targetSupport, {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: `WordPress graph mutation ${boundary.sourceResourceKey} references a serialized block attachment target that is not a supported attachment row.`,
    targetPostType: boundary.unsupportedTargetPostType,
    unsupportedTargetFailsClosed: true,
    sourceMutationPresent: false,
    sourcePreconditionPresent: false,
    targetMutationPresent: false,
    targetPreconditionPresent: false,
  });

  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.match(proof.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.deepEqual(proof.applyRefusal.durableJournalEventTypes, []);
  assert.equal(proof.applyRefusal.remoteDataPreserved, true);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.equal(proof.applyRefusal.sourceHashAfter, proof.applyRefusal.sourceHashBefore);
  assert.equal(proof.applyRefusal.targetHashAfter, proof.applyRefusal.targetHashBefore);
  assert.match(proof.applyRefusal.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.sourceHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.targetHashBefore, sha256EvidencePattern);

  assert.equal(proof.planEvidence.status, 'blocked');
  assert.deepEqual(proof.planEvidence.source, {
    resourceKey: boundary.sourceResourceKey,
    mutationPresent: false,
    preconditionPresent: false,
  });
  assert.deepEqual(proof.planEvidence.target, {
    resourceKey: boundary.targetResourceKey,
    mutationPresent: false,
    preconditionPresent: false,
  });
  assert.equal(proof.planEvidence.mutations.length, 0);
  assert.equal(proof.planEvidence.preconditions.length, 0);
  assert.equal(proof.planEvidence.blockers.length, 1);
  assert.equal(proof.planEvidence.blockers[0].references[0].targetSupport.supported, false);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.deepEqual(proof.redaction.surfaces, [
    'release-verifier-serialized-block-reference-plan-evidence',
    'apply-refusal-details',
    'release-verifier-proof',
  ]);
  assert.match(proof.redaction.serializedPlanEvidenceHash, sha256EvidencePattern);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.equal(proof.rawValuesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);

  assertNoRawFixtures(proof.planEvidence, 'RPP-0397 serialized block plan evidence');
  assertNoRawFixtures(proof, 'RPP-0397 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0397 release verifier serialized block proof' }));
});

test('RPP-0397 production-shaped release verifier emits serialized block graph-identity carry-through', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeSerializedBlockReferenceReleaseVerifierProof/);
  assert.match(verifierSource, /export function summarizeGraphIdentityReleaseVerifierProofs/);
  assert.match(verifierSource, /serializedBlockReference: summarizeSerializedBlockReferenceReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /graphIdentity: graphIdentityProofs/);
  assert.match(verifierSource, /SERIALIZED_BLOCK_UNSUPPORTED_TARGET_HASH_ONLY_EVIDENCE/);
});
