import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';
import {
  summarizeGraphIdentityReleaseVerifierProofs,
  summarizePostGuidSlugCollisionReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function generatedGuidSlugRawValues() {
  const values = [];
  for (const testCase of generatePushHarnessCases()
    .filter((entry) => entry.tags.has('post-guid-slug-collision-guard'))) {
    const localEntry = Object.entries(testCase.local.db.wp_posts)
      .find(([, row]) => String(row.post_title || '').startsWith('Generated GUID slug collision guard '));
    assert.ok(localEntry, `${testCase.id} missing generated collision local row`);
    const [localRowId, localRow] = localEntry;
    values.push(localRow.post_title, localRow.post_name, localRow.guid);

    const remoteEntry = Object.entries(testCase.remote.db.wp_posts)
      .find(([rowId, row]) =>
        rowId !== localRowId
        && row.guid === localRow.guid
        && row.post_type === localRow.post_type
        && row.post_name === localRow.post_name);
    if (remoteEntry) {
      values.push(remoteEntry[1].post_title, remoteEntry[1].post_name, remoteEntry[1].guid);
    }
    values.push(`rpp-0398-ready-stale-replay-${testCase.id}`);
  }
  return values.filter(Boolean);
}

function assertNoRawGuidSlugValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const raw of generatedGuidSlugRawValues()) {
    assert.equal(serialized.includes(raw), false, `release verifier proof leaked raw GUID/slug fixture ${raw}`);
  }
}

test('RPP-0398 release verifier carries GUID and slug collision generated ready/stale cases', () => {
  const proof = summarizePostGuidSlugCollisionReleaseVerifierProof({
    now: new Date('2026-05-30T16:18:00.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0398');
  assert.equal(proof.evidenceSource, 'release-verifier-post-guid-slug-collision-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'POST_GUID_SLUG_COLLISION_READY_AND_STALE_VERIFIED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-generated-release-verifier');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'post-guid-slug-collision',
    variant: 'v5',
    generatedHarnessReadyAndStale: true,
    executorRejectsStaleCollisionBeforeMutation: true,
  });
  assert.deepEqual(proof.invariant, {
    readyUniquePostMutation: true,
    staleCollisionBlockerClass: 'stale-wordpress-graph-identity',
    collisionRelationshipType: 'post-natural-identity-collision',
    collisionIdentityKinds: ['guid', 'post_type+post_name'],
    staleApplyRefusalCode: 'PLAN_NOT_READY',
    readyStaleReplayRefusalCode: 'PRECONDITION_FAILED',
  });
  assert.deepEqual(proof.coverage, {
    family: 'post-guid-slug-collision-guard',
    target: 'postGuidSlugCollisionReleaseVerifierVariant5',
    total: 20,
    perTier: {
      0: 2,
      1: 2,
      2: 2,
      3: 2,
      4: 2,
      5: 2,
      6: 2,
      7: 2,
      8: 2,
      9: 2,
    },
    statuses: { blocked: 10, ready: 10 },
  });
  assert.deepEqual(proof.totals, {
    readyCases: 10,
    staleCases: 10,
    readyApplied: 10,
    readyStaleReplayRejected: 10,
    collisionBlockers: 10,
    collisionRemoteDecisions: 10,
    staleApplyRefusedBeforeMutation: 10,
  });
  assert.equal(proof.caseProofs.length, 20);

  const readyProofs = proof.caseProofs.filter((entry) => entry.variant === 'ready-unique');
  const staleProofs = proof.caseProofs.filter((entry) => entry.variant === 'stale-collision');
  assert.equal(readyProofs.length, 10);
  assert.equal(staleProofs.length, 10);

  for (const entry of readyProofs) {
    assert.equal(entry.status, 'ready', `${entry.id} status`);
    assert.equal(entry.exactReady, true, `${entry.id} exact ready proof`);
    assert.match(entry.planHash, sha256EvidencePattern);
    assert.equal(entry.surface.remoteResourceKey, null);
    assert.deepEqual(entry.surface.identityKinds, ['guid', 'post_type+post_name']);
    assert.match(entry.surface.identityHash, sha256EvidencePattern);
    assert.match(entry.surface.localHash, sha256Pattern);
    assert.equal(entry.surface.baseState, 'absent');
    assert.equal(entry.surface.remoteSourceState, 'absent');
    assert.equal(entry.mutation.action, 'put');
    assert.equal(entry.mutation.changeKind, 'create');
    assert.equal(entry.mutation.precondition.resourceKey, entry.mutation.resourceKey);
    assert.equal(entry.mutation.precondition.expectedHash, entry.mutation.remoteBeforeHash);
    assert.equal(entry.mutation.precondition.checkedAgainst, 'live-remote');
    assert.equal(entry.mutation.precondition.matchesMutation, true);
    assert.equal(entry.applyCarryThrough.applied, true);
    assert.equal(entry.applyCarryThrough.targetApplied, true);
    assert.match(entry.applyCarryThrough.remoteHashAfter, sha256EvidencePattern);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.resourceKey, entry.mutation.resourceKey);
    assert.equal(entry.staleReplay.expectedHash, entry.mutation.remoteBeforeHash);
    assert.match(entry.staleReplay.actualHash, sha256Pattern);
    assert.equal(entry.staleReplay.rejectedBeforeMutation, true);
    assert.equal(entry.staleReplay.eventCount, 0);
    assert.equal(entry.staleReplay.remoteHashAfter, entry.staleReplay.remoteHashBefore);
    assert.match(entry.staleReplay.detailsHash, sha256EvidencePattern);
    assert.equal(entry.validation.applied, true);
    assert.equal(entry.validation.staleReplayRejected, true);
    assert.equal(entry.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  }

  for (const entry of staleProofs) {
    assert.equal(entry.status, 'blocked', `${entry.id} status`);
    assert.equal(entry.exactStaleCollision, true, `${entry.id} exact stale proof`);
    assert.match(entry.planHash, sha256EvidencePattern);
    assert.ok(entry.surface.remoteResourceKey, `${entry.id} missing remote collision resource`);
    assert.deepEqual(entry.surface.identityKinds, ['guid', 'post_type+post_name']);
    assert.match(entry.surface.identityHash, sha256EvidencePattern);
    assert.match(entry.surface.localHash, sha256Pattern);
    assert.match(entry.surface.remoteCollisionHash, sha256Pattern);
    assert.equal(entry.collisionBlocker.class, 'stale-wordpress-graph-identity');
    assert.equal(entry.collisionBlocker.plannedMutation, false);
    assert.match(entry.collisionBlocker.blockerHash, sha256EvidencePattern);
    assert.equal(entry.collisionReference.relationshipType, 'post-natural-identity-collision');
    assert.equal(entry.collisionReference.targetResourceKey, entry.surface.remoteResourceKey);
    assert.deepEqual(entry.collisionReference.identityKinds, ['guid', 'post_type+post_name']);
    assert.match(entry.collisionReference.targetRemoteHash, sha256Pattern);
    assert.equal(entry.remoteCollisionDecision.decision, 'keep-remote');
    assert.equal(entry.remoteCollisionDecision.noMutation, true);
    assert.equal(entry.remoteCollisionDecision.noPrecondition, true);
    assert.equal(entry.applyRefusal.code, 'PLAN_NOT_READY');
    assert.equal(entry.applyRefusal.rejectedBeforeMutation, true);
    assert.equal(entry.applyRefusal.eventCount, 0);
    assert.equal(entry.applyRefusal.remoteHashAfter, entry.applyRefusal.remoteHashBefore);
    assert.match(entry.applyRefusal.detailsHash, sha256EvidencePattern);
    assert.equal(entry.validation.applied, false);
    assert.equal(entry.validation.nonReadyRemoteUnchanged, true);
  }

  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawGuidSlugValues(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0398 release verifier GUID/slug collision proof' }));
});

test('RPP-0398 production-shaped release verifier emits GUID and slug collision carry-through proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const graphIdentity = summarizeGraphIdentityReleaseVerifierProofs();

  assert.equal(graphIdentity.postGuidSlugCollision.rpp, 'RPP-0398');
  assert.equal(graphIdentity.postGuidSlugCollision.status, 'support_only');
  assert.match(verifierSource, /export function summarizePostGuidSlugCollisionReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /postGuidSlugCollision: summarizePostGuidSlugCollisionReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /POST_GUID_SLUG_COLLISION_READY_AND_STALE_VERIFIED/);
});
