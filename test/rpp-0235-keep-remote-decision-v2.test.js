import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
      'wp-content/themes/theme/style.css': 'body { color: red; }',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function plannerSummaryCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

function keepRemoteEvidence(plan, keepRemoteKeys) {
  return {
    rpp: 'RPP-0235',
    behavior: 'keep-remote decisions preserve remote resources with hash-only evidence',
    command: 'node --test test/rpp-0235-keep-remote-decision-v2.test.js',
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey),
    keepRemote: keepRemoteKeys.map((resourceKey) => {
      const decision = decisionFor(plan, resourceKey);
      assert.ok(decision, `missing keep-remote decision for ${resourceKey}`);
      return {
        resourceKey,
        decision: decision.decision,
        baseHash: decision.baseHash,
        localHash: decision.change.local.hash,
        remoteHash: decision.remoteHash,
        localChange: decision.change.localChange,
        remoteChange: decision.change.remoteChange,
        baseState: decision.change.base.state,
        localState: decision.change.local.state,
        remoteState: decision.change.remote.state,
      };
    }),
  };
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
  }
}

test('RPP-0235 keep-remote decisions preserve remote resources with hash-only evidence, variant 2', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const localMutationKey = 'file:wp-content/themes/theme/style.css';
  const keepRemoteKeys = [
    'file:index.php',
    'plugin:forms',
    'row:["wp_posts","ID:1"]',
  ];
  const privateValues = [
    'rpp0235-v2-remote-private-index-content',
    '9.9.9-rpp0235-v2-private-version',
    'RPP-0235 v2 remote private post title',
    'rpp0235-v2-local-private-style-edit',
  ];

  local.files['wp-content/themes/theme/style.css'] = privateValues[3];
  remote.files['index.php'] = privateValues[0];
  remote.plugins.forms = { version: privateValues[1], active: false };
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];

  const plan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const evidence = keepRemoteEvidence(plan, keepRemoteKeys);
  const replayEvidence = keepRemoteEvidence(replayPlan, keepRemoteKeys);
  const proof = { ...evidence, proofHash: digest(evidence) };

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 3,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(plan.summary, plannerSummaryCounts(plan));
  assert.deepEqual(evidence, replayEvidence, 'keep-remote evidence changed between deterministic planning runs');
  assert.match(proof.proofHash, SHA256_HEX_PATTERN);
  assert.equal(mutationFor(plan, localMutationKey)?.action, 'put');
  assert.equal(plan.preconditions.length, 1);
  assert.equal(plan.preconditions[0].resourceKey, localMutationKey);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const remoteHashesBeforeApply = new Map();
  for (const resourceKey of keepRemoteKeys) {
    const decision = decisionFor(plan, resourceKey);
    assert.equal(decision.decision, 'keep-remote');
    assert.equal(decision.change.localChange, 'unchanged');
    assert.equal(decision.change.remoteChange, 'update');
    assert.match(decision.baseHash, SHA256_HEX_PATTERN);
    assert.match(decision.remoteHash, SHA256_HEX_PATTERN);
    assert.equal(decision.change.base.hash, decision.baseHash);
    assert.equal(decision.change.local.hash, decision.baseHash);
    assert.equal(decision.change.remote.hash, decision.remoteHash);
    assert.equal(resourceHash(base, decision.resource), decision.baseHash);
    assert.equal(resourceHash(local, decision.resource), decision.baseHash);
    assert.equal(resourceHash(remote, decision.resource), decision.remoteHash);
    assert.equal(mutationFor(plan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
    assert.equal(
      plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
      false,
      `${resourceKey} emitted a precondition`,
    );
    assertHashOnlyEvidenceRedacted(decision, privateValues);
    remoteHashesBeforeApply.set(resourceKey, resourceHash(remote, decision.resource));
  }

  assertHashOnlyEvidenceRedacted(proof, privateValues);

  const result = applyPlan(remote, plan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], privateValues[3]);
  assert.equal(result.site.files['index.php'], privateValues[0]);
  assert.deepEqual(result.site.plugins.forms, { version: privateValues[1], active: false });
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, privateValues[2]);

  for (const resourceKey of keepRemoteKeys) {
    const decision = decisionFor(plan, resourceKey);
    assert.equal(
      resourceHash(result.site, decision.resource),
      remoteHashesBeforeApply.get(resourceKey),
      `${resourceKey} changed during apply`,
    );
  }
});
