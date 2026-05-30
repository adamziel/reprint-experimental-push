import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  localDirectoryDeleteRemoteDescendantReleaseVerifierBoundary,
  summarizeLocalDirectoryDeleteRemoteDescendantReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const scenarioMatrixPath = path.join(repoRoot, 'docs/scenario-matrix.md');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  '<?php echo "rpp-0284-release-verifier-base-index";',
  '<?php echo "rpp-0284-release-verifier-local-index";',
  'remote-private-rpp-0284-release-verifier-descendant-bytes',
]);

function assertNoRawFixtures(value, label = 'RPP-0284 release verifier evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('"content":'), false, `${label} must not expose raw file content fields`);
}

test('RPP-0284 release verifier carries local directory delete versus remote descendant create as hash-only support evidence', () => {
  const boundary = localDirectoryDeleteRemoteDescendantReleaseVerifierBoundary;
  const proof = summarizeLocalDirectoryDeleteRemoteDescendantReleaseVerifierProof({
    now: new Date('2026-05-30T10:28:40.000Z'),
  });
  const replayProof = summarizeLocalDirectoryDeleteRemoteDescendantReleaseVerifierProof({
    now: new Date('2026-05-30T10:28:40.000Z'),
  });

  assert.deepEqual(proof, replayProof, 'RPP-0284 release verifier evidence should be deterministic');
  assert.equal(proof.rpp, 'RPP-0284');
  assert.equal(proof.evidenceSource, 'release-verifier-local-directory-delete-remote-descendant-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'LOCAL_DIRECTORY_DELETE_REMOTE_DESCENDANT_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'local-directory-delete-remote-descendant-create',
    variant: 'v5',
    remoteDescendantPreserved: true,
  });
  assert.deepEqual(proof.scenario, {
    directoryResourceKey: boundary.resourceKey,
    remoteDescendantResourceKey: boundary.descendantResourceKey,
    independentResourceKey: boundary.independentResourceKey,
  });

  assert.equal(proof.plan.status, 'conflict');
  assert.deepEqual(proof.plan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(proof.plan.mutationCount, 1);
  assert.equal(proof.plan.decisionCount, 1);
  assert.equal(proof.plan.conflictCount, 1);
  assert.equal(proof.plan.preconditionCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.surface.directory.resourceKey, boundary.resourceKey);
  assert.equal(proof.surface.remoteDescendant.resourceKey, boundary.descendantResourceKey);
  assert.equal(proof.surface.independentResource.resourceKey, boundary.independentResourceKey);
  assert.match(proof.surface.directory.baseHash, sha256HexPattern);
  assert.match(proof.surface.directory.localHash, sha256HexPattern);
  assert.match(proof.surface.remoteDescendant.remoteHash, sha256HexPattern);

  assert.equal(proof.conflict.resourceKey, boundary.resourceKey);
  assert.equal(proof.conflict.relatedResourceKey, boundary.descendantResourceKey);
  assert.equal(proof.conflict.class, 'file-topology-conflict');
  assert.equal(
    proof.conflict.reason,
    'Local file deletion or type change would hide or remove a live remote descendant.',
  );
  assert.equal(proof.conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(proof.conflict.localChange, 'delete');
  assert.equal(proof.conflict.remoteChange, 'unchanged');
  assert.equal(proof.conflict.relatedRemoteChange, 'create');
  assert.equal(proof.conflict.plannedMutation, false);
  assert.equal(proof.conflict.plannedPrecondition, false);
  assert.match(proof.conflict.remoteHash, sha256HexPattern);
  assert.match(proof.conflict.relatedRemoteHash, sha256HexPattern);
  assert.match(proof.conflict.conflictHash, sha256EvidencePattern);

  assert.equal(proof.remoteDescendant.resourceKey, boundary.descendantResourceKey);
  assert.equal(proof.remoteDescendant.decision, 'keep-remote');
  assert.equal(proof.remoteDescendant.localChange, 'unchanged');
  assert.equal(proof.remoteDescendant.remoteChange, 'create');
  assert.equal(proof.remoteDescendant.plannedMutation, false);
  assert.equal(proof.remoteDescendant.plannedPrecondition, false);
  assert.match(proof.remoteDescendant.remoteHash, sha256HexPattern);
  assert.match(proof.remoteDescendant.decisionHash, sha256EvidencePattern);

  assert.equal(proof.independentMutation.resourceKey, boundary.independentResourceKey);
  assert.equal(proof.independentMutation.action, 'put');
  assert.equal(proof.independentMutation.changeKind, 'update');
  assert.equal(proof.independentMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(proof.independentMutation.expectedHashMatchesMutation, true);
  assert.match(proof.independentMutation.preconditionExpectedHash, sha256HexPattern);
  assert.match(proof.independentMutation.mutationHash, sha256EvidencePattern);
  assert.match(proof.independentMutation.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeDurableJournal, true);
  assert.equal(proof.applyRefusal.beforeMutation, true);
  assert.equal(proof.applyRefusal.remoteSnapshotPreserved, true);
  assert.equal(proof.applyRefusal.remoteDescendantPreserved, true);
  assert.equal(proof.applyRefusal.descendantHashAfter, proof.applyRefusal.descendantHashBefore);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.equal(proof.applyRefusal.durableJournalEventCount, 0);
  assert.equal(proof.applyRefusal.beforeMutationCallCount, 0);
  assert.match(proof.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.applyRefusal.descendantHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.remoteHashBefore, sha256EvidencePattern);

  assert.deepEqual(proof.redaction, {
    format: 'hash-only',
    rawValuesIncluded: false,
    checkedFixtureCount: rawFixtures.length,
  });
  assert.equal(proof.rawValuesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0284 release verifier proof' }));
});

test('RPP-0284 release verifier and scenario matrix name the carry-through command', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const scenarioMatrix = fs.readFileSync(scenarioMatrixPath, 'utf8');

  assert.match(verifierSource, /export function summarizeLocalDirectoryDeleteRemoteDescendantReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /localDirectoryDeleteRemoteDescendant:\s*summarizeLocalDirectoryDeleteRemoteDescendantReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /mergeInvariants:\s*mergeInvariantProof/);
  assert.match(verifierSource, /LOCAL_DIRECTORY_DELETE_REMOTE_DESCENDANT_PRESERVED/);
  assert.match(
    scenarioMatrix,
    /\| Local directory delete versus remote descendant create, variant 5 \|[^|]*release verifier[^|]*PLAN_NOT_READY[^|]*remote descendant[^|]*\| `node --test test\/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5\.test\.js`/,
  );
});
