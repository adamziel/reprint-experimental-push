import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  remoteOnlyPluginMetadataReleaseVerifierBoundary,
  summarizeRemoteOnlyPluginMetadataReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const focusedPrivateFixtures = Object.freeze([
  '<?php echo "rpp-0286-release-verifier-local-file-private";',
  'rpp-0286-release-verifier-local-post-private',
  'rpp-0286-release-verifier-remote-plugin-version-private',
  'rpp-0286-release-verifier-remote-channel-private',
  'rpp-0286-release-verifier-remote-note-private',
  'rpp-0286-release-verifier-remote-integrity-private',
  'rpp-0286-release-verifier-remote-capability-private',
  'rpp-0286-release-verifier-focused-stale-private',
]);

function assertHashEvidence(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function assertNoPrivateMetadataPayloads(value, label = 'RPP-0286 release verifier proof') {
  const serialized = JSON.stringify(value);
  for (const fixture of focusedPrivateFixtures) {
    assert.equal(serialized.includes(fixture), false, `${label} leaked ${fixture}`);
  }
  assert.equal(serialized.includes('remote-metadata-'), false, `${label} leaked generated metadata channel`);
  assert.equal(
    serialized.includes('rpp-0286-release-verifier-generated-stale-'),
    false,
    `${label} leaked generated stale replay fixture`,
  );
}

test('RPP-0286 release verifier carries focused remote-only plugin metadata preservation as hash-only evidence', () => {
  const proof = summarizeRemoteOnlyPluginMetadataReleaseVerifierProof({
    now: new Date('2026-05-30T10:28:06.000Z'),
    generatedNow: new Date('2026-05-28T00:00:00.000Z'),
  });
  const focused = proof.focused;

  assert.equal(proof.rpp, 'RPP-0286');
  assert.equal(proof.evidenceSource, 'release-verifier-remote-only-plugin-metadata-preservation-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'REMOTE_ONLY_PLUGIN_METADATA_PRESERVED_BY_RELEASE_VERIFIER');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-generated-release-verifier');
  assert.deepEqual(proof.resource, {
    pluginName: 'forms',
    resourceKey: 'plugin:forms',
    generatedPluginName: remoteOnlyPluginMetadataReleaseVerifierBoundary.generatedPluginName,
    generatedResourceKey: remoteOnlyPluginMetadataReleaseVerifierBoundary.generatedResourceKey,
  });
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'remote-only-plugin-metadata-preservation',
    variant: 'v5',
    focusedFixtureCovered: true,
    generatedHarnessCovered: true,
    remoteOnlyMetadataDecision: 'keep-remote',
  });

  assert.equal(focused.ok, true);
  assert.equal(focused.fixture, 'focused');
  assert.equal(focused.plan.status, 'ready');
  assert.deepEqual(focused.plan.summary, {
    mutations: 2,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(focused.plan.mutationCount, 2);
  assert.equal(focused.plan.preconditionCount, 2);
  assertHashEvidence(focused.plan.hash, 'focused plan hash');

  assert.equal(focused.metadata.resourceKey, 'plugin:forms');
  assert.equal(focused.metadata.decision, 'keep-remote');
  assert.equal(focused.metadata.localChange, 'unchanged');
  assert.equal(focused.metadata.remoteChange, 'update');
  assert.equal(focused.metadata.exactKeepRemote, true);
  assert.equal(focused.metadata.plannedMutation, false);
  assert.equal(focused.metadata.plannedPrecondition, false);
  assert.equal(focused.metadata.baseHash, focused.metadata.localHash);
  assert.notEqual(focused.metadata.remoteHash, focused.metadata.baseHash);
  assertHashEvidence(focused.metadata.baseHash, 'focused metadata base hash');
  assertHashEvidence(focused.metadata.remoteHash, 'focused metadata remote hash');
  assertHashEvidence(focused.metadata.decisionHash, 'focused metadata decision hash');

  assert.equal(focused.independentMutations.count, 2);
  assert.equal(focused.independentMutations.everyMutationHasLiveRemotePrecondition, true);
  assertHashEvidence(focused.independentMutations.resourceKeysHash, 'focused mutation keys hash');
  assertHashEvidence(focused.independentMutations.preconditionResourceKeysHash, 'focused precondition keys hash');

  assert.equal(focused.apply.appliedMutations, 2);
  assert.equal(focused.apply.remoteMetadataPreserved, true);
  assert.equal(focused.apply.appliedMetadataHash, focused.metadata.remoteHash);
  assert.equal(focused.apply.noPluginMetadataJournalEvents, true);
  assert.ok(focused.apply.durableJournalEventCount > 0, 'focused proof should record durable journal events');
  assertHashEvidence(focused.apply.durableJournalResourceKeysHash, 'focused journal keys hash');

  assert.equal(focused.staleReplay.preMutation, true);
  assert.equal(focused.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(focused.staleReplay.expectedHashMatchesMutation, true);
  assert.equal(focused.staleReplay.actualHashMatchesDriftedTarget, true);
  assert.equal(focused.staleReplay.remoteUnchanged, true);
  assert.equal(focused.staleReplay.metadataPreserved, true);
  assert.equal(focused.staleReplay.metadataHashAfter, focused.metadata.remoteHash);
  assertHashEvidence(focused.staleReplay.expectedHash, 'focused stale expected hash');
  assertHashEvidence(focused.staleReplay.actualHash, 'focused stale actual hash');
  assertHashEvidence(focused.staleReplay.remoteHashBefore, 'focused stale remote before hash');
  assert.equal(focused.staleReplay.remoteHashAfter, focused.staleReplay.remoteHashBefore);
  assertHashEvidence(focused.staleReplay.detailsHash, 'focused stale details hash');
  assertHashEvidence(focused.proofHash, 'focused proof hash');
  assertHashEvidence(proof.proofHash, 'RPP-0286 proof hash');

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.ok(proof.redaction.checkedFixtureCount > focusedPrivateFixtures.length);
  assertNoPrivateMetadataPayloads(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0286 release verifier remote-only metadata proof' }));
});

test('RPP-0286 release verifier proves generated remote-only plugin metadata fixtures are preserved', () => {
  const proof = summarizeRemoteOnlyPluginMetadataReleaseVerifierProof();
  const generated = proof.generated;

  assert.equal(generated.ok, true);
  assert.equal(generated.fixture, 'generated');
  assert.equal(generated.family, 'remote-only-plugin-metadata');
  assert.equal(generated.totalCases, 10);
  assert.deepEqual(generated.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.deepEqual(generated.statuses, { ready: 10 });
  assert.deepEqual(
    generated.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of generated.cases) {
    assert.equal(entry.family, 'remote-only-plugin-metadata', `${entry.id} family`);
    assert.equal(entry.status, 'ready', `${entry.id} status`);
    assert.equal(entry.tags.includes('remote-preserve'), true, `${entry.id} remote-preserve tag`);
    assert.equal(
      entry.tags.includes('plugin-metadata-preserve'),
      true,
      `${entry.id} plugin-metadata-preserve tag`,
    );
    assert.ok(entry.plan.mutationCount > 0, `${entry.id} mutation count`);
    assert.equal(entry.plan.preconditionCount, entry.plan.mutationCount, `${entry.id} precondition count`);
    assert.ok(entry.plan.summary.decisions >= 1, `${entry.id} decision count`);
    assert.equal(entry.plan.summary.conflicts, 0, `${entry.id} conflict count`);
    assert.equal(entry.plan.summary.blockers, 0, `${entry.id} blocker count`);
    assertHashEvidence(entry.plan.hash, `${entry.id} plan hash`);

    assert.equal(entry.validation.applied, true, `${entry.id} validation applied`);
    assert.equal(entry.validation.unplannedRemotePreserved, true, `${entry.id} validation remote preserved`);
    assert.equal(entry.validation.staleReplayRejected, true, `${entry.id} validation stale rejected`);
    assert.equal(entry.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${entry.id} stale code`);
    assert.equal(entry.validation.staleReplayRemoteUnchanged, true, `${entry.id} stale remote unchanged`);

    assert.equal(
      entry.metadata.resourceKey,
      remoteOnlyPluginMetadataReleaseVerifierBoundary.generatedResourceKey,
      `${entry.id} metadata resource`,
    );
    assert.equal(entry.metadata.decision, 'keep-remote', `${entry.id} metadata decision`);
    assert.equal(entry.metadata.localChange, 'unchanged', `${entry.id} local metadata change`);
    assert.equal(entry.metadata.remoteChange, 'update', `${entry.id} remote metadata change`);
    assert.equal(entry.metadata.exactKeepRemote, true, `${entry.id} exact keep-remote`);
    assert.equal(entry.metadata.plannedMutation, false, `${entry.id} no metadata mutation`);
    assert.equal(entry.metadata.plannedPrecondition, false, `${entry.id} no metadata precondition`);
    assert.equal(entry.metadata.baseHash, entry.metadata.localHash, `${entry.id} local hash unchanged`);
    assert.notEqual(entry.metadata.remoteHash, entry.metadata.baseHash, `${entry.id} remote metadata drift`);
    assert.equal(entry.metadata.appliedMetadataHash, entry.metadata.remoteHash, `${entry.id} applied metadata hash`);
    assert.equal(entry.metadata.appliedRemoteHashPreserved, true, `${entry.id} applied remote hash preserved`);
    assertHashEvidence(entry.metadata.decisionHash, `${entry.id} decision hash`);

    assert.equal(entry.apply.appliedMutations, entry.plan.mutationCount, `${entry.id} applied mutation count`);
    assert.equal(entry.apply.noPluginMetadataJournalEvents, true, `${entry.id} plugin metadata journal events`);
    assertHashEvidence(entry.apply.durableJournalResourceKeysHash, `${entry.id} durable journal keys hash`);

    assert.equal(entry.staleReplay.preMutation, true, `${entry.id} stale pre-mutation`);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED', `${entry.id} stale code`);
    assert.equal(entry.staleReplay.remoteUnchanged, true, `${entry.id} stale remote unchanged`);
    assert.equal(entry.staleReplay.metadataPreserved, true, `${entry.id} stale metadata preserved`);
    assert.equal(entry.staleReplay.metadataHashAfter, entry.metadata.remoteHash, `${entry.id} stale metadata hash`);
    assert.equal(entry.staleReplay.expectedHashMatchesMutation, true, `${entry.id} stale expected hash`);
    assert.equal(entry.staleReplay.actualHashMatchesDriftedTarget, true, `${entry.id} stale actual hash`);
    assertHashEvidence(entry.staleReplay.expectedHash, `${entry.id} stale expected hash evidence`);
    assertHashEvidence(entry.staleReplay.actualHash, `${entry.id} stale actual hash evidence`);
    assertHashEvidence(entry.staleReplay.detailsHash, `${entry.id} stale details hash`);
    assertHashEvidence(entry.proofHash, `${entry.id} proof hash`);
  }

  assertHashEvidence(generated.proofHash, 'generated proof hash');
  assertNoPrivateMetadataPayloads(proof, 'generated RPP-0286 proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0286 generated release verifier proof' }));
});

test('RPP-0286 production-shaped release verifier emits remote-only metadata carry-through', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeRemoteOnlyPluginMetadataReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /remoteOnlyPluginMetadata: summarizeRemoteOnlyPluginMetadataReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /mergeInvariants: mergeInvariantProof/);
  assert.match(verifierSource, /REMOTE_ONLY_PLUGIN_METADATA_PRESERVED_BY_RELEASE_VERIFIER/);
});
