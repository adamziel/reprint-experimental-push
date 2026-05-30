import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T10:28:50.000Z');
const command = 'node --test test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js';
const caveat = 'Focused local release-verifier evidence only; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  '<?php echo "rpp-0285-release-verifier-base-index";',
  'rpp-0285-release-verifier-base-style',
  'rpp-0285-release-verifier-local-replacement-bytes',
  'rpp-0285-release-verifier-local-style',
  'rpp-0285-release-verifier-remote-descendant-bytes',
]);

const boundary = Object.freeze({
  swapPath: 'wp-content/uploads/rpp-0285-gallery',
  descendantPath: 'wp-content/uploads/rpp-0285-gallery/remote-only-proof.txt',
  independentPath: 'wp-content/themes/rpp-0285/style.css',
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashEvidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function baseSite() {
  return {
    files: {
      'index.php': rawFixtures[0],
      [boundary.swapPath]: { type: 'directory' },
      [boundary.independentPath]: rawFixtures[1],
    },
    plugins: {},
    db: {
      wp_options: {},
    },
  };
}

function releaseVerifierResources() {
  return {
    swapResource: {
      type: 'file',
      path: boundary.swapPath,
      key: `file:${boundary.swapPath}`,
    },
    descendantResource: {
      type: 'file',
      path: boundary.descendantPath,
      key: `file:${boundary.descendantPath}`,
    },
    independentResource: {
      type: 'file',
      path: boundary.independentPath,
      key: `file:${boundary.independentPath}`,
    },
  };
}

function releaseVerifierSnapshots() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files[boundary.swapPath] = rawFixtures[2];
  local.files[boundary.independentPath] = rawFixtures[3];
  remote.files[boundary.descendantPath] = rawFixtures[4];

  return { base, local, remote };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function failingDurableJournal() {
  return {
    claimFenced: true,
    claimHash: 'c'.repeat(64),
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence += 1;
      return record;
    },
  };
}

function assertNoRawFixtures(value, label = 'RPP-0285 release verifier evidence') {
  const serialized = JSON.stringify(value);

  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('"content":'), false, `${label} must not expose raw file content fields`);
}

function summarizeLocalFileTypeSwapRemoteDescendantReleaseVerifierProof({
  now = fixedNow,
} = {}) {
  const resources = releaseVerifierResources();
  const { base, local, remote } = releaseVerifierSnapshots();
  const plan = createPushPlan({ base, local, remote, now });
  const replayPlan = createPushPlan({
    base: cloneJson(base),
    local: cloneJson(local),
    remote: cloneJson(remote),
    now,
  });
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resources.swapResource.key);
  const replayConflict = replayPlan.conflicts.find((entry) => entry.resourceKey === resources.swapResource.key);
  const descendantDecision = decisionFor(plan, resources.descendantResource.key);
  const replayDescendantDecision = decisionFor(replayPlan, resources.descendantResource.key);
  const independentMutation = mutationFor(plan, resources.independentResource.key);
  const independentPrecondition = preconditionFor(plan, resources.independentResource.key);
  const durableJournal = failingDurableJournal();
  const remoteBefore = cloneJson(remote);
  const remoteHashBefore = hashEvidence(remoteBefore);
  const descendantHashBefore = hashEvidence(resourceHash(remoteBefore, resources.descendantResource));
  let beforeMutationCallCount = 0;
  const refusal = captureError(() => applyPlan(remote, plan, {
    durableJournal,
    beforeMutation() {
      beforeMutationCallCount += 1;
    },
  }));
  const remoteHashAfter = hashEvidence(remote);
  const descendantHashAfter = hashEvidence(resourceHash(remote, resources.descendantResource));

  assert.ok(conflict, 'missing RPP-0285 file topology conflict');
  assert.deepEqual(conflict, replayConflict, 'conflict evidence should be deterministic');
  assert.ok(descendantDecision, 'missing RPP-0285 remote descendant decision');
  assert.deepEqual(descendantDecision, replayDescendantDecision, 'descendant evidence should be deterministic');
  assert.ok(independentMutation, 'missing RPP-0285 independent mutation evidence');
  assert.ok(independentPrecondition, 'missing RPP-0285 independent mutation precondition');
  assert.ok(refusal instanceof PushPlanError);

  const proof = {
    rpp: 'RPP-0285',
    evidenceSource: 'release-verifier-local-file-type-swap-remote-descendant-v5',
    status: 'support_only',
    verdict: 'LOCAL_FILE_TYPE_SWAP_REMOTE_DESCENDANT_HASH_ONLY_CONFLICT_PRESERVED',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    evidenceScope: 'local-focused-release-verifier',
    command,
    caveat,
    releaseVerifier: {
      checkedBy: 'test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js',
      check: 'local-file-type-swap-remote-descendant',
      variant: 'v5',
      serializedPlanEvidence: 'hash-only',
      remoteDescendantPreserved: true,
    },
    scenario: {
      typeSwapResourceKey: resources.swapResource.key,
      remoteDescendantResourceKey: resources.descendantResource.key,
      independentResourceKey: resources.independentResource.key,
    },
    plan: {
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      decisionCount: plan.decisions.length,
      conflictCount: plan.conflicts.length,
      preconditionCount: plan.preconditions.length,
      hash: hashEvidence(plan),
    },
    surface: {
      typeSwap: {
        resourceKey: resources.swapResource.key,
        baseHash: resourceHash(base, resources.swapResource),
        localHash: resourceHash(local, resources.swapResource),
        remoteHash: resourceHash(remoteBefore, resources.swapResource),
      },
      remoteDescendant: {
        resourceKey: resources.descendantResource.key,
        baseHash: resourceHash(base, resources.descendantResource),
        localHash: resourceHash(local, resources.descendantResource),
        remoteHash: resourceHash(remoteBefore, resources.descendantResource),
      },
      independentResource: {
        resourceKey: resources.independentResource.key,
        baseHash: resourceHash(base, resources.independentResource),
        localHash: resourceHash(local, resources.independentResource),
        remoteHash: resourceHash(remoteBefore, resources.independentResource),
      },
    },
    conflict: {
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      reason: conflict.reason,
      resolutionPolicy: conflict.resolutionPolicy,
      relatedResourceKey: conflict.relatedResourceKey,
      localChange: conflict.change.localChange,
      remoteChange: conflict.change.remoteChange,
      relatedLocalChange: conflict.relatedChange.localChange,
      relatedRemoteChange: conflict.relatedChange.remoteChange,
      plannedMutation: Boolean(mutationFor(plan, resources.swapResource.key)),
      plannedPrecondition: Boolean(preconditionFor(plan, resources.swapResource.key)),
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      relatedRemoteHash: conflict.relatedChange.remote.hash,
      conflictHash: hashEvidence(conflict),
    },
    remoteDescendant: {
      resourceKey: descendantDecision.resourceKey,
      decision: descendantDecision.decision,
      localChange: descendantDecision.change.localChange,
      remoteChange: descendantDecision.change.remoteChange,
      plannedMutation: Boolean(mutationFor(plan, resources.descendantResource.key)),
      plannedPrecondition: Boolean(preconditionFor(plan, resources.descendantResource.key)),
      remoteHash: resourceHash(remoteBefore, resources.descendantResource),
      decisionHash: hashEvidence(descendantDecision),
    },
    independentMutation: {
      resourceKey: independentMutation.resourceKey,
      action: independentMutation.action,
      changeKind: independentMutation.changeKind,
      preconditionCheckedAgainst: independentPrecondition.checkedAgainst,
      expectedHashMatchesMutation: independentPrecondition.expectedHash === independentMutation.remoteBeforeHash,
      baseHash: resourceHash(base, resources.independentResource),
      localHash: resourceHash(local, resources.independentResource),
      remoteBeforeHash: independentMutation.remoteBeforeHash,
      mutationHash: hashEvidence(independentMutation),
      preconditionHash: hashEvidence(independentPrecondition),
    },
    applyRefusal: {
      code: refusal.code,
      beforeDurableJournal: durableJournal.events.length === 0,
      beforeMutation: beforeMutationCallCount === 0,
      remoteSnapshotPreserved: remoteHashAfter === remoteHashBefore,
      remoteDescendantPreserved: descendantHashAfter === descendantHashBefore,
      durableJournalEventCount: durableJournal.events.length,
      beforeMutationCallCount,
      detailsHash: hashEvidence(refusal.details),
      remoteHashBefore,
      remoteHashAfter,
      descendantHashBefore,
      descendantHashAfter,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      checkedFixtureCount: rawFixtures.length,
    },
    rawValuesIncluded: false,
  };

  return {
    ...proof,
    proofHash: hashEvidence(proof),
  };
}

test('RPP-0285 release verifier carries local file type swap versus remote descendant as hash-only conflict evidence', () => {
  const proof = summarizeLocalFileTypeSwapRemoteDescendantReleaseVerifierProof();

  assert.equal(proof.rpp, 'RPP-0285');
  assert.equal(proof.evidenceSource, 'release-verifier-local-file-type-swap-remote-descendant-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'LOCAL_FILE_TYPE_SWAP_REMOTE_DESCENDANT_HASH_ONLY_CONFLICT_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-focused-release-verifier');
  assert.equal(proof.command, command);
  assert.equal(proof.caveat, caveat);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'test/rpp-0285-local-file-type-swap-remote-descendant-release-verifier-v5.test.js',
    check: 'local-file-type-swap-remote-descendant',
    variant: 'v5',
    serializedPlanEvidence: 'hash-only',
    remoteDescendantPreserved: true,
  });
  assert.deepEqual(proof.scenario, {
    typeSwapResourceKey: `file:${boundary.swapPath}`,
    remoteDescendantResourceKey: `file:${boundary.descendantPath}`,
    independentResourceKey: `file:${boundary.independentPath}`,
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

  assert.equal(proof.surface.typeSwap.resourceKey, proof.scenario.typeSwapResourceKey);
  assert.equal(proof.surface.remoteDescendant.resourceKey, proof.scenario.remoteDescendantResourceKey);
  assert.equal(proof.surface.independentResource.resourceKey, proof.scenario.independentResourceKey);
  assert.match(proof.surface.typeSwap.baseHash, sha256HexPattern);
  assert.match(proof.surface.typeSwap.localHash, sha256HexPattern);
  assert.match(proof.surface.typeSwap.remoteHash, sha256HexPattern);
  assert.match(proof.surface.remoteDescendant.remoteHash, sha256HexPattern);
  assert.match(proof.surface.independentResource.localHash, sha256HexPattern);

  assert.equal(proof.conflict.resourceKey, proof.scenario.typeSwapResourceKey);
  assert.equal(proof.conflict.class, 'file-topology-conflict');
  assert.equal(
    proof.conflict.reason,
    'Local file deletion or type change would hide or remove a live remote descendant.',
  );
  assert.equal(proof.conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(proof.conflict.relatedResourceKey, proof.scenario.remoteDescendantResourceKey);
  assert.equal(proof.conflict.localChange, 'type-change');
  assert.equal(proof.conflict.remoteChange, 'unchanged');
  assert.equal(proof.conflict.relatedLocalChange, 'unchanged');
  assert.equal(proof.conflict.relatedRemoteChange, 'create');
  assert.equal(proof.conflict.plannedMutation, false);
  assert.equal(proof.conflict.plannedPrecondition, false);
  assert.match(proof.conflict.baseHash, sha256HexPattern);
  assert.match(proof.conflict.localHash, sha256HexPattern);
  assert.match(proof.conflict.remoteHash, sha256HexPattern);
  assert.match(proof.conflict.relatedRemoteHash, sha256HexPattern);
  assert.match(proof.conflict.conflictHash, sha256EvidencePattern);

  assert.equal(proof.remoteDescendant.resourceKey, proof.scenario.remoteDescendantResourceKey);
  assert.equal(proof.remoteDescendant.decision, 'keep-remote');
  assert.equal(proof.remoteDescendant.localChange, 'unchanged');
  assert.equal(proof.remoteDescendant.remoteChange, 'create');
  assert.equal(proof.remoteDescendant.plannedMutation, false);
  assert.equal(proof.remoteDescendant.plannedPrecondition, false);
  assert.match(proof.remoteDescendant.remoteHash, sha256HexPattern);
  assert.match(proof.remoteDescendant.decisionHash, sha256EvidencePattern);

  assert.equal(proof.independentMutation.resourceKey, proof.scenario.independentResourceKey);
  assert.equal(proof.independentMutation.action, 'put');
  assert.equal(proof.independentMutation.changeKind, 'update');
  assert.equal(proof.independentMutation.preconditionCheckedAgainst, 'live-remote');
  assert.equal(proof.independentMutation.expectedHashMatchesMutation, true);
  assert.match(proof.independentMutation.baseHash, sha256HexPattern);
  assert.match(proof.independentMutation.localHash, sha256HexPattern);
  assert.match(proof.independentMutation.remoteBeforeHash, sha256HexPattern);
  assert.match(proof.independentMutation.mutationHash, sha256EvidencePattern);
  assert.match(proof.independentMutation.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeDurableJournal, true);
  assert.equal(proof.applyRefusal.beforeMutation, true);
  assert.equal(proof.applyRefusal.remoteSnapshotPreserved, true);
  assert.equal(proof.applyRefusal.remoteDescendantPreserved, true);
  assert.equal(proof.applyRefusal.durableJournalEventCount, 0);
  assert.equal(proof.applyRefusal.beforeMutationCallCount, 0);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.equal(proof.applyRefusal.descendantHashAfter, proof.applyRefusal.descendantHashBefore);
  assert.match(proof.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.applyRefusal.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.applyRefusal.descendantHashBefore, sha256EvidencePattern);

  assert.deepEqual(proof.redaction, {
    format: 'hash-only',
    rawValuesIncluded: false,
    checkedFixtureCount: rawFixtures.length,
  });
  assert.equal(proof.rawValuesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0285 release verifier proof' }));
});

test('RPP-0285 release verifier proof is deterministic and excludes raw fixture values', () => {
  const proof = summarizeLocalFileTypeSwapRemoteDescendantReleaseVerifierProof();
  const replayProof = summarizeLocalFileTypeSwapRemoteDescendantReleaseVerifierProof();

  assert.deepEqual(proof, replayProof, 'RPP-0285 release verifier proof should be deterministic');
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof);
});
