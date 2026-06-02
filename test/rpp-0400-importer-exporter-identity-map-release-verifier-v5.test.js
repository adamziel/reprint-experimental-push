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
import {
  WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
  WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
  wordpressGraphIdentityMapContractHash,
} from '../src/wordpress-graph-contracts.js';

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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function strictIdentityMapRow(boundary) {
  return {
    contractVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
    contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
    sourceResourceKey: boundary.sourceResourceKey,
    targetResourceKey: boundary.targetResourceKey,
    contractHash: wordpressGraphIdentityMapContractHash({
      sourceResourceKey: boundary.sourceResourceKey,
      targetResourceKey: boundary.targetResourceKey,
    }),
    rawValuesIncluded: false,
  };
}

function checkedProductionSnapshots({ legacyMap = false } = {}) {
  const boundary = productionImporterExporterIdentityMapReleaseVerifierBoundary;
  const provenance = {
    exporter: {
      artifactHash: '3'.repeat(64),
      rowCount: 1,
      observedAt: '2026-05-30T16:03:00.000Z',
    },
    importer: {
      packageHash: '4'.repeat(64),
      persistedAt: '2026-05-30T16:03:30.000Z',
      immutableBase: true,
    },
  };
  const remoteBaseSnapshot = {
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${boundary.targetPostId}`]: {
          ID: boundary.targetPostId,
          post_title: 'rpp-0400-private-importer-exporter-source-title',
          post_name: 'rpp-0400-importer-exporter-parent',
          post_content: 'rpp-0400-private-importer-exporter-source-body',
          post_status: 'publish',
          post_type: 'page',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
    },
    meta: {
      ...(legacyMap
        ? {
          pushIdentityMap: {
            provenance,
            resources: [
              {
                sourceResourceKey: boundary.sourceResourceKey,
                targetResourceKey: boundary.targetResourceKey,
              },
            ],
          },
        }
        : {
          wordpressGraphIdentityMap: {
            provenance,
            rows: [strictIdentityMapRow(boundary)],
            rawValuesIncluded: false,
          },
        }),
    },
  };
  const localEditedSnapshot = {
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        [`ID:${boundary.sourcePostId}`]: {
          ID: boundary.sourcePostId,
          post_title: 'rpp-0400-private-importer-exporter-source-title',
          post_name: 'rpp-0400-importer-exporter-parent',
          post_content: 'rpp-0400-private-importer-exporter-source-body',
          post_status: 'publish',
          post_type: 'page',
          post_parent: 0,
          post_author: 0,
        },
        [`ID:${boundary.childPostId}`]: {
          ID: boundary.childPostId,
          post_title: 'rpp-0400-private-importer-exporter-child-title',
          post_name: 'rpp-0400-importer-exporter-child',
          post_content: 'rpp-0400-private-importer-exporter-child-body',
          post_status: 'publish',
          post_type: 'page',
          post_parent: boundary.sourcePostId,
          post_author: 0,
        },
      },
      wp_postmeta: {
        [`post_id:${boundary.sourcePostId}:meta_key:${boundary.metaKey}`]: {
          post_id: boundary.sourcePostId,
          meta_key: boundary.metaKey,
          meta_value: 'rpp-0400-private-importer-exporter-meta',
        },
      },
    },
  };
  const remoteChangedSnapshot = cloneJson(remoteBaseSnapshot);
  remoteChangedSnapshot.db.wp_posts[`ID:${boundary.targetPostId}`].post_title =
    'rpp-0400-private-importer-exporter-stale-title';
  remoteChangedSnapshot.db.wp_posts[`ID:${boundary.targetPostId}`].post_content =
    'rpp-0400-private-importer-exporter-stale-body';

  return {
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  };
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
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.checked, true);
  assert.equal(proof.checkedProductionEvidence, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.status, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.acceptedForReleaseGate, false);
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

test('RPP-0400 release verifier upgrades checked live snapshots to production-backed evidence', () => {
  const boundary = productionImporterExporterIdentityMapReleaseVerifierBoundary;
  const snapshots = checkedProductionSnapshots();
  const proof = summarizeProductionImporterExporterIdentityMapReleaseVerifierProof({
    ...snapshots,
    checkedProductionEvidence: true,
    now: new Date('2026-05-30T16:05:00.000Z'),
  });
  const graphIdentity = summarizeGraphIdentityReleaseVerifierProofs({
    ...snapshots,
    checkedProductionEvidence: true,
  });
  const serialized = JSON.stringify(proof);

  assert.equal(proof.status, 'checked');
  assert.equal(proof.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_PRODUCTION_BACKED');
  assert.equal(proof.evidenceScope, 'production-backed');
  assert.equal(proof.releaseGateEvidenceScope, 'production-backed');
  assert.equal(proof.sourceKind, 'checked-production-snapshots');
  assert.equal(proof.productionScopeClaimed, true);
  assert.equal(proof.checkedProductionEvidence, true);
  assert.equal(proof.productionBacked, true);
  assert.equal(proof.supportOnly, false);
  assert.equal(proof.releaseEligible, true);
  assert.equal(proof.releaseGate, 'GO');
  assert.equal(proof.acceptedForReleaseGate, true);
  assert.equal(proof.releaseGateEvidence.status, 'GO');
  assert.equal(proof.releaseGateEvidence.productionBacked, true);
  assert.equal(proof.releaseGateEvidence.acceptedForReleaseGate, true);
  assert.equal(proof.mapEvidence.mapAlias, 'wordpressGraphIdentityMap');
  assert.equal(proof.mapEvidence.mapSource, 'base-snapshot.meta.identityMap[0].rows[0]');
  assert.equal(proof.mapEvidence.strictContractEvidenceAccepted, true);
  assert.equal(proof.productionStrictIdentityMap.accepted, true);
  assert.equal(proof.productionStrictIdentityMap.contractValidation.reasonCode, 'WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_ACCEPTED');
  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 2);
  assert.equal(proof.plan.summary.decisions, 2);
  assert.equal(proof.counts.source.mapEntries, 1);
  assert.equal(proof.counts.source.targetPosts, 0);
  assert.equal(proof.counts.checkedRemoteBase.targetPosts, 1);
  assert.equal(proof.counts.importedRemote.targetPosts, 1);
  assert.equal(proof.counts.localEdited.sourcePosts, 1);
  assert.equal(proof.counts.localEdited.sourcePostmeta, 1);
  assert.equal(proof.counts.staleRemote.targetPosts, 1);
  assert.equal(proof.checkedSnapshotEvidence.format, 'hash-only');
  assert.match(proof.checkedSnapshotEvidence.sourceProjectionHash, sha256EvidencePattern);
  assert.match(proof.checkedSnapshotEvidence.checkedRemoteBaseHash, sha256EvidencePattern);
  assert.match(proof.checkedSnapshotEvidence.localEditedHash, sha256EvidencePattern);
  assert.match(proof.checkedSnapshotEvidence.importedRemoteProjectionHash, sha256EvidencePattern);
  assert.match(proof.checkedSnapshotEvidence.staleRemoteProjectionHash, sha256EvidencePattern);
  assert.equal(proof.mapEvidence.sourceDecision.identityMapSource, 'base-snapshot.meta.identityMap[0].rows[0]');
  assert.equal(proof.mapEvidence.sourceDecision.targetResourceKey, boundary.targetResourceKey);
  assert.deepEqual(rewriteTypes(proof).sort(), ['post-parent', 'postmeta-post']);
  assert.equal(proof.appliedEvidence.sourceAbsentAfterApply, true);
  assert.equal(proof.appliedEvidence.targetPostHashBefore, proof.appliedEvidence.targetPostHashAfter);
  assert.equal(proof.appliedEvidence.childPostParent, boundary.targetPostId);
  assert.equal(proof.appliedEvidence.postmetaPostId, boundary.targetPostId);
  assert.equal(proof.stale.planStatus, 'blocked');
  assert.equal(proof.stale.staleRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.stale.staleRefusal.remoteUnchanged, true);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.invariants.evidenceHashOnly, true);
  assert.equal(proof.invariants.evidenceRedactsRawValues, true);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.equal(graphIdentity.productionImporterExporterIdentityMap.status, 'checked');
  assert.equal(graphIdentity.productionImporterExporterIdentityMap.productionBacked, true);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `checked proof leaked raw fixture value ${raw}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0400 checked production-backed proof' }));
});

test('RPP-0400 checked snapshots without production evidence stay support-only', () => {
  const snapshots = checkedProductionSnapshots();
  const proof = summarizeProductionImporterExporterIdentityMapReleaseVerifierProof({
    ...snapshots,
    checkedProductionEvidence: false,
    now: new Date('2026-05-30T16:05:00.000Z'),
  });

  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_CARRIED_THROUGH');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.sourceKind, 'checked-production-snapshots');
  assert.equal(proof.checkedProductionEvidence, false);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.status, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.acceptedForReleaseGate, false);
  assert.equal(proof.mapEvidence.strictContractEvidenceAccepted, true);
  assert.equal(proof.productionStrictIdentityMap.accepted, true);
  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 2);
  assert.equal(proof.counts.checkedRemoteBase.targetPosts, 1);
  assert.equal(proof.checkedSnapshotEvidence.format, 'hash-only');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0400 checked support-only proof' }));
});

test('RPP-0400 checked production evidence with legacy identity maps stays support-only', () => {
  const snapshots = checkedProductionSnapshots({ legacyMap: true });
  const proof = summarizeProductionImporterExporterIdentityMapReleaseVerifierProof({
    ...snapshots,
    checkedProductionEvidence: true,
    now: new Date('2026-05-30T16:05:00.000Z'),
  });

  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_CARRIED_THROUGH');
  assert.equal(proof.evidenceScope, 'production-backed');
  assert.equal(proof.checkedProductionEvidence, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.mapEvidence.mapAlias, 'pushIdentityMap');
  assert.equal(proof.mapEvidence.strictContractEvidenceAccepted, false);
  assert.equal(proof.productionStrictIdentityMap.accepted, false);
  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 2);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0400 legacy checked production proof' }));
});

test('RPP-0400 checked production evidence fails closed when checked snapshots are incomplete', () => {
  const snapshots = checkedProductionSnapshots();
  const proof = summarizeProductionImporterExporterIdentityMapReleaseVerifierProof({
    remoteBaseSnapshot: snapshots.remoteBaseSnapshot,
    localEditedSnapshot: snapshots.localEditedSnapshot,
    checkedProductionEvidence: true,
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_RELEASE_VERIFIER_REQUIRED');
  assert.equal(proof.evidenceScope, 'production-backed');
  assert.equal(proof.sourceKind, 'checked-production-snapshots');
  assert.equal(proof.checkedProductionEvidence, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.status, 'NO-GO');
  assert.equal(proof.releaseGateEvidence.verdict, 'PRODUCTION_IMPORTER_EXPORTER_IDENTITY_MAP_INCOMPLETE');
  assert.equal(proof.releaseGateEvidence.acceptedForReleaseGate, false);
  assert.deepEqual(proof.missingEvidence, ['remoteChangedSnapshot']);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0400 incomplete checked production proof' }));
});

test('RPP-0400 release verifier emits graph identity bundle beside production verifier summaries', () => {
  const graphIdentity = summarizeGraphIdentityReleaseVerifierProofs();
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.equal(graphIdentity.productionImporterExporterIdentityMap.rpp, 'RPP-0400');
  assert.equal(graphIdentity.productionImporterExporterIdentityMap.status, 'support_only');
  assert.match(
    verifierSource,
    /productionImporterExporterIdentityMap:\s*summarizeProductionImporterExporterIdentityMapReleaseVerifierProof\(\{/,
  );
  assert.match(verifierSource, /checkedProductionEvidence:\s*packagedSourceFixture === null/s);
  assert.match(verifierSource, /export function summarizeProductionImporterExporterIdentityMapReleaseVerifierProof/);
  assert.match(verifierSource, /graphIdentity:\s*graphIdentityProofs/);
});
