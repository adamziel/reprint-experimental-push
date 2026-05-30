import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const command = 'node --test test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js';
const caveat = 'Focused local Node planner/apply proof only; release remains gated separately.';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
      'index.php': '<?php echo "base";',
      'wp-content/uploads/rpp-0265-gallery': { type: 'directory' },
      'wp-content/themes/rpp-0265/style.css': 'base rpp-0265 style',
    },
    plugins: {},
    db: {
      wp_options: {},
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
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
    claimHash: 'b'.repeat(64),
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

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `evidence leaked fixture value: ${needle}`);
  }
}

function hashOnlyEvidenceFor(plan, {
  swapResource,
  descendantResource,
  independentResource,
  refusal,
  durableJournal,
}) {
  const swapKey = swapResource.key;
  const descendantKey = descendantResource.key;
  const independentKey = independentResource.key;
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === swapKey);
  const descendantDecision = decisionFor(plan, descendantKey);
  const independentMutation = mutationFor(plan, independentKey);
  const independentPrecondition = preconditionFor(plan, independentKey);

  return {
    command,
    caveat,
    scope: 'local-focused-regression',
    productionBacked: false,
    releaseGate: 'NO-GO',
    status: plan.status,
    summary: plan.summary,
    typeSwap: {
      resourceKey: swapKey,
      mutationEmitted: Boolean(mutationFor(plan, swapKey)),
      preconditionEmitted: Boolean(preconditionFor(plan, swapKey)),
      conflictClass: conflict?.class,
      conflictHash: conflict ? `sha256:${digest(conflict)}` : null,
      relatedResourceKey: conflict?.relatedResourceKey,
      localChange: conflict?.change.localChange,
      remoteChange: conflict?.change.remoteChange,
    },
    remoteDescendant: {
      resourceKey: descendantKey,
      decision: descendantDecision?.decision,
      mutationEmitted: Boolean(mutationFor(plan, descendantKey)),
      preconditionEmitted: Boolean(preconditionFor(plan, descendantKey)),
      decisionHash: descendantDecision ? `sha256:${digest(descendantDecision)}` : null,
    },
    independentMutation: {
      resourceKey: independentKey,
      action: independentMutation?.action,
      changeKind: independentMutation?.changeKind,
      mutationHash: independentMutation ? `sha256:${digest(independentMutation)}` : null,
      preconditionHash: independentPrecondition ? `sha256:${digest(independentPrecondition)}` : null,
      checkedAgainst: independentPrecondition?.checkedAgainst,
    },
    refusal: {
      code: refusal.code,
      detailsHash: `sha256:${digest(refusal.details)}`,
    },
    durableJournalEvents: durableJournal.events.length,
  };
}

test('RPP-0265 local file type swap versus remote descendant variant 4 refuses before mutation with hash-only evidence', () => {
  const base = baseSite();
  const swapPath = 'wp-content/uploads/rpp-0265-gallery';
  const descendantPath = `${swapPath}/remote-only-proof.txt`;
  const independentPath = 'wp-content/themes/rpp-0265/style.css';
  const privateLocalReplacement = 'rpp-0265 private local replacement file';
  const privateRemoteDescendant = 'rpp-0265 private remote descendant bytes';
  const privateLocalStyle = 'rpp-0265 private independent local style';
  const swapResource = { type: 'file', path: swapPath, key: `file:${swapPath}` };
  const descendantResource = { type: 'file', path: descendantPath, key: `file:${descendantPath}` };
  const independentResource = { type: 'file', path: independentPath, key: `file:${independentPath}` };
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.files[swapPath] = privateLocalReplacement;
  local.files[independentPath] = privateLocalStyle;
  remote.files[descendantPath] = privateRemoteDescendant;

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const conflict = firstPlan.conflicts.find((entry) => entry.resourceKey === swapResource.key);
  const descendantDecision = decisionFor(firstPlan, descendantResource.key);
  const independentMutation = mutationFor(firstPlan, independentResource.key);
  const independentPrecondition = preconditionFor(firstPlan, independentResource.key);
  const durableJournal = failingDurableJournal();
  const remoteBefore = cloneJson(remote);
  const remoteBeforeHash = digest(remoteBefore);
  const refusal = captureError(() => applyPlan(remote, firstPlan, { durableJournal }));
  const evidence = hashOnlyEvidenceFor(firstPlan, {
    swapResource,
    descendantResource,
    independentResource,
    refusal,
    durableJournal,
  });
  const replayEvidence = hashOnlyEvidenceFor(replayPlan, {
    swapResource,
    descendantResource,
    independentResource,
    refusal,
    durableJournal,
  });

  assert.equal(firstPlan.status, 'conflict');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(evidence, replayEvidence, 'hash-only focused evidence should be deterministic');

  assert.ok(conflict, 'missing file type swap versus remote descendant conflict');
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-file-topology-and-stop');
  assert.equal(conflict.relatedResourceKey, descendantResource.key);
  assert.equal(conflict.change.localChange, 'type-change');
  assert.equal(conflict.change.remoteChange, 'unchanged');
  assert.equal(conflict.relatedChange.localChange, 'unchanged');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(conflict.baseHash, resourceHash(base, swapResource));
  assert.equal(conflict.localHash, resourceHash(local, swapResource));
  assert.equal(conflict.remoteHash, resourceHash(remote, swapResource));
  assert.equal(conflict.relatedChange.remote.hash, resourceHash(remote, descendantResource));
  assert.equal(mutationFor(firstPlan, swapResource.key), undefined, 'unsafe type swap should not emit a mutation');
  assert.equal(preconditionFor(firstPlan, swapResource.key), undefined, 'unsafe type swap should not emit a precondition');

  assert.ok(descendantDecision, 'missing keep-remote decision for remote descendant');
  assert.equal(descendantDecision.decision, 'keep-remote');
  assert.equal(descendantDecision.resourceKey, descendantResource.key);
  assert.equal(descendantDecision.change.localChange, 'unchanged');
  assert.equal(descendantDecision.change.remoteChange, 'create');
  assert.equal(mutationFor(firstPlan, descendantResource.key), undefined, 'remote descendant should not emit a mutation');
  assert.equal(preconditionFor(firstPlan, descendantResource.key), undefined, 'remote descendant should not emit a precondition');

  assert.ok(independentMutation, 'independent local file mutation should stay visible for audit');
  assert.equal(independentMutation.action, 'put');
  assert.equal(independentMutation.changeKind, 'update');
  assert.equal(independentMutation.resourceKey, independentResource.key);
  assert.ok(independentPrecondition, 'independent mutation should keep its live remote precondition');
  assert.equal(independentPrecondition.mutationId, independentMutation.id);
  assert.equal(independentPrecondition.checkedAgainst, 'live-remote');
  assert.equal(independentPrecondition.expectedHash, independentMutation.remoteBeforeHash);

  assert.ok(refusal instanceof PushPlanError);
  assert.equal(refusal.code, 'PLAN_NOT_READY');
  assert.equal(digest(remote), remoteBeforeHash, 'conflict apply should leave the remote snapshot unchanged');
  assert.deepEqual(remote, remoteBefore);
  assert.deepEqual(durableJournal.events, [], 'conflict apply should not open a durable journal claim');
  assert.deepEqual(remote.files[swapPath], { type: 'directory' });
  assert.equal(remote.files[descendantPath], privateRemoteDescendant);
  assert.equal(remote.files[independentPath], base.files[independentPath]);

  assert.equal(evidence.command, command);
  assert.equal(evidence.caveat, caveat);
  assert.equal(evidence.typeSwap.mutationEmitted, false);
  assert.equal(evidence.typeSwap.preconditionEmitted, false);
  assert.equal(evidence.typeSwap.relatedResourceKey, descendantResource.key);
  assert.equal(evidence.typeSwap.localChange, 'type-change');
  assert.equal(evidence.remoteDescendant.decision, 'keep-remote');
  assert.equal(evidence.remoteDescendant.mutationEmitted, false);
  assert.equal(evidence.remoteDescendant.preconditionEmitted, false);
  assert.equal(evidence.independentMutation.checkedAgainst, 'live-remote');
  assert.equal(evidence.durableJournalEvents, 0);
  assert.match(evidence.typeSwap.conflictHash, sha256EvidencePattern);
  assert.match(evidence.remoteDescendant.decisionHash, sha256EvidencePattern);
  assert.match(evidence.independentMutation.mutationHash, sha256EvidencePattern);
  assert.match(evidence.independentMutation.preconditionHash, sha256EvidencePattern);
  assert.match(evidence.refusal.detailsHash, sha256EvidencePattern);
  assertNoNeedles(evidence, [privateLocalReplacement, privateRemoteDescendant, privateLocalStyle]);
  assertNoNeedles(conflict, [privateLocalReplacement, privateRemoteDescendant, privateLocalStyle]);
  assertNoNeedles(descendantDecision, [privateLocalReplacement, privateRemoteDescendant, privateLocalStyle]);
  assertNoNeedles(refusal.details, [privateLocalReplacement, privateRemoteDescendant, privateLocalStyle]);
});
