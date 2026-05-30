import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  productionImporterExporterIdentityMapReleaseVerifierBoundary,
  summarizeGraphIdentityReleaseVerifierProofs,
  summarizeProductionImporterExporterIdentityMapReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0400-private-importer-exporter-source-title',
  'rpp-0400-private-importer-exporter-source-body',
  'rpp-0400-private-importer-exporter-child-title',
  'rpp-0400-private-importer-exporter-child-body',
  'rpp-0400-private-importer-exporter-meta',
  'rpp-0400-private-importer-exporter-stale-title',
  'rpp-0400-private-importer-exporter-stale-body',
]);

function rewriteTypes(proof) {
  return proof.mapEvidence.dependentRewrites.flatMap((entry) =>
    entry.rewrites.map((rewrite) => rewrite.relationshipType));
}

test('RPP-0400 release verifier carries production importer/exporter identity-map evidence hash-only', () => {
  const boundary = productionImporterExporterIdentityMapReleaseVerifierBoundary;
  const proof = summarizeProductionImporterExporterIdentityMapReleaseVerifierProof({
    now: new Date('2026-05-30T16:04:00.000Z'),
  });
  const serialized = JSON.stringify(proof);

  assert.equal(proof.rpp, 'RPP-0400');
  assert.equal(proof.evidenceSource, 'release-verifier-production-importer-exporter-identity-map-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_CARRIED_THROUGH');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseVerifier.checkedBy, 'scripts/playground/production-shaped-release-verify.mjs');
  assert.equal(proof.releaseVerifier.check, 'production-importer-exporter-identity-map');
  assert.equal(proof.boundary.mapAlias, 'pushIdentityMap');
  assert.equal(proof.boundary.sourceResourceKey, boundary.sourceResourceKey);
  assert.equal(proof.boundary.targetResourceKey, boundary.targetResourceKey);
  assert.equal(proof.counts.source.mapEntries, 1);
  assert.equal(proof.counts.localEdited.sourcePosts, 1);
  assert.equal(proof.counts.localEdited.childPosts, 1);
  assert.equal(proof.counts.localEdited.sourcePostmeta, 1);
  assert.equal(proof.counts.importedRemote.targetPosts, 1);

  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 2);
  assert.equal(proof.plan.summary.decisions, 2);
  assert.equal(proof.plan.summary.blockers, 0);
  assert.equal(proof.preconditions.allMutationsHaveLiveRemotePreconditions, true);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.mapEvidence.mapAlias, 'pushIdentityMap');
  assert.equal(proof.mapEvidence.mapSource, 'base-snapshot.meta.identityMap[2].resources[0]');
  assert.equal(
    proof.mapEvidence.sourceDecision.identityMapSource,
    'base-snapshot.meta.identityMap[2].resources[0]',
  );
  assert.equal(proof.mapEvidence.sourceDecision.decision, 'map-local-identity-to-remote');
  assert.equal(proof.mapEvidence.sourceDecision.targetResourceKey, boundary.targetResourceKey);
  assert.equal(proof.mapEvidence.targetDecision.decision, 'keep-remote');
  assert.equal(proof.mapEvidence.targetDecision.resourceKey, boundary.targetResourceKey);
  assert.deepEqual(rewriteTypes(proof).sort(), ['post-parent', 'postmeta-post']);
  assert.ok(proof.mapEvidence.dependentRewrites.some((entry) =>
    entry.resourceKey === boundary.childResourceKey
    && entry.rewrites.some((rewrite) =>
      rewrite.relationshipType === 'post-parent'
      && rewrite.targetResourceKey === boundary.targetResourceKey)));
  assert.ok(proof.mapEvidence.dependentRewrites.some((entry) =>
    entry.resourceKey === boundary.targetPostmetaResourceKey
    && entry.rewrites.some((rewrite) =>
      rewrite.relationshipType === 'postmeta-post'
      && rewrite.targetResourceKey === boundary.targetResourceKey)));

  assert.equal(proof.appliedEvidence.sourceAbsentAfterApply, true);
  assert.equal(proof.appliedEvidence.targetPostHashBefore, proof.appliedEvidence.targetPostHashAfter);
  assert.equal(proof.appliedEvidence.childPostParent, boundary.targetPostId);
  assert.equal(proof.appliedEvidence.postmetaPostId, boundary.targetPostId);
  assert.equal(proof.appliedEvidence.targetIdsApplied, true);
  assert.equal(proof.appliedEvidence.postmetaResourceKey, boundary.targetPostmetaResourceKey);

  assert.equal(proof.stale.planStatus, 'blocked');
  assert.equal(proof.stale.staleRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.stale.staleRefusal.beforeMutationCalls, 0);
  assert.equal(proof.stale.staleRefusal.durableJournalEventCount, 0);
  assert.equal(proof.stale.staleRefusal.remoteUnchanged, true);
  assert.equal(proof.stale.staleRefusal.remoteHashBefore, proof.stale.staleRefusal.remoteHashAfter);
  assert.ok(proof.stale.staleBlockerEvidence.some((entry) =>
    entry.class === 'stale-wordpress-graph-identity'
    && entry.resourceKey === boundary.sourceResourceKey));

  assert.deepEqual(
    Object.entries(proof.invariants).filter(([, value]) => value !== true),
    [],
    'all RPP-0400 release-verifier invariants should hold',
  );
  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.equal(serialized.includes('post_title'), false);
  assert.equal(serialized.includes('post_content'), false);
  assert.equal(serialized.includes('meta_value'), false);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `proof leaked raw fixture value ${raw}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0400 release verifier importer/exporter proof' }));
});

test('RPP-0400 release verifier emits graph identity bundle beside production verifier summaries', () => {
  const graphIdentity = summarizeGraphIdentityReleaseVerifierProofs();
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.equal(graphIdentity.productionImporterExporterIdentityMap.rpp, 'RPP-0400');
  assert.equal(graphIdentity.productionImporterExporterIdentityMap.status, 'support_only');
  assert.match(
    verifierSource,
    /productionImporterExporterIdentityMap:\s*summarizeProductionImporterExporterIdentityMapReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /export function summarizeProductionImporterExporterIdentityMapReleaseVerifierProof/);
  assert.match(verifierSource, /graphIdentity:\s*graphIdentityProofs/);
});
