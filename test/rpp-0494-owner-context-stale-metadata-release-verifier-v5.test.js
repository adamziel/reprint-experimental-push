import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  ownerContextStaleMetadataReleaseVerifierBoundary,
  summarizeOwnerContextStaleMetadataReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = [
  'rpp-0494-release-verifier-base-postmeta',
  'rpp-0494-release-verifier-local-postmeta',
  '49.4.0-rpp-0494-remote-plugin-metadata',
  'rpp-0494-remote-plugin-channel',
  'rpp-0494-remote-plugin-note',
  'rpp-0494 forms owner file',
];

function assertNoRawMetadataPayloads(value) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `RPP-0494 proof leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('meta_value'), false, 'proof must not expose raw meta_value fields');
  assert.equal(serialized.includes('option_value'), false, 'proof must not expose raw option_value fields');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0494 release verifier stale metadata proof' }));
}

test('RPP-0494 release verifier carries owner metadata planner refusal as hash-only support evidence', () => {
  const proof = summarizeOwnerContextStaleMetadataReleaseVerifierEvidence({
    now: new Date('2026-05-30T10:49:40.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0494');
  assert.equal(proof.evidenceSource, 'release-verifier-owner-context-stale-metadata-refusal-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'OWNER_CONTEXT_STALE_METADATA_REFUSAL_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.deepEqual(proof.releaseGate, {
    status: 'NO-GO',
    acceptedForReleaseGate: false,
    reason: 'local release-verifier owner-context stale metadata refusal evidence only',
  });
  assert.equal(proof.owner, 'forms');
  assert.equal(proof.driver, 'wp-postmeta');
  assert.deepEqual(proof.resource, {
    resourceKey: ownerContextStaleMetadataReleaseVerifierBoundary.resourceKey,
    table: 'wp_postmeta',
    rowId: 'meta_id:9494',
    pluginResourceKey: 'plugin:forms',
  });
  assert.deepEqual(proof.allowlist, {
    resourceKey: ownerContextStaleMetadataReleaseVerifierBoundary.resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-postmeta',
    table: 'wp_postmeta',
    supportsDelete: false,
    policySource: 'local-snapshot',
  });

  assert.equal(proof.plannerRefusal.ok, true);
  assert.equal(proof.plannerRefusal.status, 'blocked');
  assert.deepEqual(proof.plannerRefusal.summary, {
    mutations: 0,
    decisions: 1,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(proof.plannerRefusal.pluginDecision.resourceKey, 'plugin:forms');
  assert.equal(proof.plannerRefusal.pluginDecision.decision, 'keep-remote');
  assert.match(proof.plannerRefusal.pluginDecision.decisionHash, sha256EvidencePattern);
  assert.equal(proof.plannerRefusal.blocker.class, 'stale-plugin-owner-context');
  assert.equal(proof.plannerRefusal.blocker.pluginOwner, 'forms');
  assert.equal(proof.plannerRefusal.blocker.driver, 'wp-postmeta');
  assert.equal(proof.plannerRefusal.blocker.policySource, 'local-snapshot');
  assert.match(proof.plannerRefusal.blocker.baseHash, sha256Pattern);
  assert.match(proof.plannerRefusal.blocker.localHash, sha256Pattern);
  assert.match(proof.plannerRefusal.blocker.remoteHash, sha256Pattern);
  assert.match(proof.plannerRefusal.blocker.driverAuditHash, sha256EvidencePattern);
  assert.match(proof.plannerRefusal.blocker.ownerContextRefusalHash, sha256EvidencePattern);
  assert.match(proof.plannerRefusal.blocker.blockerHash, sha256EvidencePattern);

  assert.equal(proof.plannerRefusal.metadataRefusal.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(proof.plannerRefusal.metadataRefusal.operation, 'refuse-before-mutation');
  assert.equal(proof.plannerRefusal.metadataRefusal.resourceKey, ownerContextStaleMetadataReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.plannerRefusal.metadataRefusal.pluginOwner, 'forms');
  assert.deepEqual(proof.plannerRefusal.metadataRefusal.stalePluginMetadataResourceKeys, ['plugin:forms']);
  assert.deepEqual(Object.keys(proof.plannerRefusal.metadataRefusal.context[0]).sort(), [
    'baseHash',
    'localChange',
    'localHash',
    'remoteChange',
    'remoteHash',
    'resourceKey',
  ]);
  assert.equal(proof.plannerRefusal.metadataRefusal.context[0].resourceKey, 'plugin:forms');
  assert.equal(proof.plannerRefusal.metadataRefusal.context[0].localChange, 'unchanged');
  assert.equal(proof.plannerRefusal.metadataRefusal.context[0].remoteChange, 'update');
  assert.match(proof.plannerRefusal.metadataRefusal.evidenceHash, sha256EvidencePattern);
  assert.equal(proof.plannerRefusal.applyRefusal.preMutation, true);
  assert.equal(proof.plannerRefusal.applyRefusal.code, 'PLAN_NOT_READY');
  assert.match(proof.plannerRefusal.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.equal(
    proof.plannerRefusal.remotePreservation.rowHashAfter,
    proof.plannerRefusal.remotePreservation.rowHashBefore,
  );
  assert.equal(
    proof.plannerRefusal.remotePreservation.remoteHashAfter,
    proof.plannerRefusal.remotePreservation.remoteHashBefore,
  );
  assert.equal(proof.plannerRefusal.remotePreservation.remoteDataPreserved, true);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawMetadataPayloads(proof);
});

test('RPP-0494 release verifier carries ready-plan metadata owner context into pre-mutation replay refusal', () => {
  const proof = summarizeOwnerContextStaleMetadataReleaseVerifierEvidence({
    now: new Date('2026-05-30T10:49:40.000Z'),
  });

  assert.equal(proof.readyReplay.ok, true);
  assert.equal(proof.readyReplay.status, 'ready');
  assert.equal(proof.readyReplay.summary.mutations, 1);
  assert.equal(proof.readyReplay.summary.blockers, 0);
  assert.equal(proof.readyReplay.mutation.resourceKey, ownerContextStaleMetadataReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.readyReplay.mutation.action, 'put');
  assert.equal(proof.readyReplay.mutation.pluginOwner, 'forms');
  assert.equal(proof.readyReplay.mutation.driver, 'wp-postmeta');
  assert.equal(proof.readyReplay.mutation.policySource, 'local-snapshot');
  assert.equal(proof.readyReplay.mutation.ownerContextRequired, true);
  assert.deepEqual(proof.readyReplay.mutation.ownerContextResourceKeys, [
    'file:wp-content/plugins/forms/forms.php',
    'plugin:forms',
  ]);
  assert.match(proof.readyReplay.mutation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.readyReplay.mutation.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.readyReplay.mutation.mutationHash, sha256EvidencePattern);
  assert.equal(proof.readyReplay.precondition.resourceKey, ownerContextStaleMetadataReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.readyReplay.precondition.expectedHash, proof.readyReplay.mutation.remoteBeforeHash);
  assert.equal(proof.readyReplay.precondition.checkedAgainst, 'live-remote');
  assert.match(proof.readyReplay.precondition.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.readyReplay.ownerMetadataContext.resourceKey, 'plugin:forms');
  assert.equal(proof.readyReplay.ownerMetadataContext.remoteHash, proof.readyReplay.ownerMetadataContext.baseHash);
  assert.match(proof.readyReplay.ownerMetadataContext.remoteHash, sha256Pattern);
  assert.match(proof.readyReplay.ownerMetadataContext.contextHash, sha256EvidencePattern);
  assert.equal(proof.readyReplay.refusal.preMutation, true);
  assert.equal(proof.readyReplay.refusal.beforeMutationCalls, 0);
  assert.equal(proof.readyReplay.refusal.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(proof.readyReplay.refusal.contextResourceKey, 'plugin:forms');
  assert.equal(proof.readyReplay.refusal.expectedHash, proof.readyReplay.ownerMetadataContext.remoteHash);
  assert.match(proof.readyReplay.refusal.actualHash, sha256Pattern);
  assert.notEqual(proof.readyReplay.refusal.actualHash, proof.readyReplay.refusal.expectedHash);
  assert.match(proof.readyReplay.refusal.detailsHash, sha256EvidencePattern);
  assert.equal(proof.readyReplay.remotePreservation.rowHashAfter, proof.readyReplay.remotePreservation.rowHashBefore);
  assert.equal(
    proof.readyReplay.remotePreservation.remoteHashAfter,
    proof.readyReplay.remotePreservation.remoteHashBefore,
  );
  assert.equal(proof.readyReplay.remotePreservation.remoteDataPreserved, true);
  assertNoRawMetadataPayloads(proof);
});

test('RPP-0494 production-shaped release verifier carries stale metadata refusal under pluginDriver ownerContext', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /summarizeOwnerContextStaleMetadataReleaseVerifierEvidence/);
  assert.match(
    verifierSource,
    /ownerContext:\s*\{\s*stalePluginFile: ownerContextStalePluginFileEvidence,\s*staleMetadata: summarizeOwnerContextStaleMetadataReleaseVerifierEvidence\(\),\s*\}/,
  );
  assert.match(verifierSource, /OWNER_CONTEXT_STALE_METADATA_REFUSAL_PRESERVED/);
});
