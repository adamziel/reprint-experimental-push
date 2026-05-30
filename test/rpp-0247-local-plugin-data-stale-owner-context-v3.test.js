import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const ownerFilePath = 'wp-content/plugins/forms/forms.php';
const ownerFileKey = `file:${ownerFilePath}`;
const generatedPluginOptionTag = 'plugin-owned-option-change-v3-ready';
const sha256Pattern = /^[a-f0-9]{64}$/;

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

function generatedPluginOptionReadyCases() {
  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(generatedPluginOptionTag));

  assert.equal(cases.length, 10, 'RPP-0247 needs one generated v3-ready plugin option case per tier');
  return cases;
}

function planGeneratedCase(testCase) {
  return createPushPlan({
    base: cloneJson(testCase.base),
    local: cloneJson(testCase.local),
    remote: cloneJson(testCase.remote),
    now: fixedGeneratedHarnessNow,
  });
}

function generatedPluginOptionMutation(plan, testCase) {
  const matches = plan.mutations.filter((mutation) =>
    mutation.pluginOwnedResource?.pluginOwner === 'forms'
    && mutation.pluginOwnedResource?.driver === 'wp-option'
    && mutation.resourceKey.includes('generated_plugin_owned_option_'));

  assert.equal(matches.length, 1, `${testCase.id} should expose one generated local plugin option mutation`);
  return matches[0];
}

function pluginOwnedMutations(plan, testCase) {
  const matches = plan.mutations.filter((mutation) =>
    mutation.pluginOwnedResource?.pluginOwner === 'forms'
    && mutation.pluginOwnedResource?.driver === 'wp-option');

  assert.ok(matches.length > 0, `${testCase.id} should expose generated plugin-owned local data mutations`);
  return matches;
}

function ownerFileContext(mutation, testCase) {
  const context = mutation.pluginOwnedResource?.ownerContext
    ?.find((entry) => entry.resourceKey === ownerFileKey);

  assert.ok(context, `${testCase.id} should bind the generated mutation to the owning plugin file`);
  assert.equal(context.type, 'file');
  assert.match(context.remoteHash, sha256Pattern);
  return context;
}

function assertGeneratedReadyPlanShape(testCase, plan, mutation) {
  assert.equal(plan.status, 'ready', `${testCase.id} should produce a ready generated plan`);
  assert.equal(plan.blockers.length, 0, `${testCase.id} should not emit blockers`);
  assert.equal(plan.conflicts.length, 0, `${testCase.id} should not emit conflicts`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(
    Array.isArray(mutation.pluginOwnedResource.ownerContext)
      && mutation.pluginOwnedResource.ownerContext.length > 0,
    `${testCase.id} should carry owner context evidence`,
  );

  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
  assert.ok(precondition, `${testCase.id} missing live remote precondition for generated mutation`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
}

function remoteState(remote, mutation) {
  return {
    json: JSON.stringify(remote),
    siteHash: digest(remote),
    targetHash: resourceHash(remote, mutation.resource),
    ownerFile: remote.files[ownerFilePath],
  };
}

function assertRemoteStateUnchanged(remote, before, mutation, label) {
  assert.equal(JSON.stringify(remote), before.json, `${label} changed the remote JSON snapshot`);
  assert.equal(digest(remote), before.siteHash, `${label} changed the remote hash`);
  assert.equal(resourceHash(remote, mutation.resource), before.targetHash, `${label} changed the plugin-owned row`);
  assert.equal(remote.files[ownerFilePath], before.ownerFile, `${label} changed the owner plugin file`);
}

function redactedMutationEvidence(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    pluginOwnedResource: {
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      driver: mutation.pluginOwnedResource.driver,
      policySource: mutation.pluginOwnedResource.policySource,
      ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired === true,
      ownerContext: mutation.pluginOwnedResource.ownerContext.map((context) => ({
        type: context.type,
        resourceKey: context.resourceKey,
        baseHash: context.baseHash,
        localHash: context.localHash,
        remoteHash: context.remoteHash,
      })),
    },
  };
}

function refusalEvidence(error) {
  return {
    code: error.code,
    details: {
      mutationId: error.details.mutationId || null,
      resourceKey: error.details.resourceKey || null,
      pluginOwner: error.details.pluginOwner || null,
      contextResourceKey: error.details.contextResourceKey || null,
      expectedHash: error.details.expectedHash || null,
      actualHash: error.details.actualHash || null,
    },
  };
}

function collectPrivateStrings(value, found = new Set()) {
  if (typeof value === 'string') {
    if (/private|rpp0247/i.test(value)) {
      found.add(value);
    }
    return found;
  }
  if (!value || typeof value !== 'object') {
    return found;
  }
  if (value instanceof Set) {
    for (const entry of value) {
      collectPrivateStrings(entry, found);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPrivateStrings(entry, found);
    }
    return found;
  }
  for (const entry of Object.values(value)) {
    collectPrivateStrings(entry, found);
  }
  return found;
}

function assertNoPrivateEvidence(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function staleOwnerContextEvidence() {
  const proofs = [];

  for (const testCase of generatedPluginOptionReadyCases()) {
    const plan = planGeneratedCase(testCase);
    const mutation = generatedPluginOptionMutation(plan, testCase);
    const pluginMutations = pluginOwnedMutations(plan, testCase);
    ownerFileContext(mutation, testCase);
    const staleOwnerFile = `<?php /* rpp0247 generated stale owner private file ${testCase.id} */`;
    const staleRemote = cloneJson(testCase.remote);
    staleRemote.files[ownerFilePath] = staleOwnerFile;
    const before = remoteState(staleRemote, mutation);
    const error = captureError(() => applyPlan(staleRemote, plan));

    assertGeneratedReadyPlanShape(testCase, plan, mutation);
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(
      pluginMutations.some((entry) => entry.resourceKey === error.details.resourceKey),
      true,
      `${testCase.id} refusal should target a generated plugin-owned local data mutation`,
    );
    const refusedMutation = pluginMutations.find((entry) => entry.resourceKey === error.details.resourceKey);
    const refusedContext = ownerFileContext(refusedMutation, testCase);
    assert.equal(error.details.pluginOwner, 'forms');
    assert.equal(error.details.contextResourceKey, ownerFileKey);
    assert.equal(error.details.expectedHash, refusedContext.remoteHash);
    assert.match(error.details.actualHash, sha256Pattern);
    assert.notEqual(error.details.actualHash, error.details.expectedHash);
    assertRemoteStateUnchanged(staleRemote, before, mutation, `${testCase.id} stale owner context refusal`);

    const proof = {
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      summary: plan.summary,
      mutation: redactedMutationEvidence(mutation),
      refusedMutation: redactedMutationEvidence(refusedMutation),
      refusal: refusalEvidence(error),
      rowHashBefore: before.targetHash,
      rowHashAfter: resourceHash(staleRemote, mutation.resource),
      remotePreserved: digest(staleRemote) === before.siteHash,
    };
    assertNoPrivateEvidence(
      proof,
      [...collectPrivateStrings(testCase), staleOwnerFile],
      `${testCase.id} stale owner context hash-only evidence`,
    );
    proofs.push(proof);
  }

  return {
    tag: generatedPluginOptionTag,
    caseCount: proofs.length,
    refusalCodes: proofs.map((proof) => proof.refusal.code),
    tiers: proofs.map((proof) => proof.tier),
    proofs,
  };
}

function tamperGeneratedPlan(plan, mutationId, mutateMutation) {
  const forged = cloneJson(plan);
  const mutation = forged.mutations.find((entry) => entry.id === mutationId);
  assert.ok(mutation, `missing generated mutation ${mutationId} in forged plan`);
  mutateMutation(mutation);
  return forged;
}

test('RPP-0247 generated local plugin data rejects stale owner context before mutation', () => {
  const evidence = staleOwnerContextEvidence();
  const replayEvidence = staleOwnerContextEvidence();

  assert.deepEqual(evidence, replayEvidence, 'RPP-0247 stale owner generated evidence must be deterministic');
  assert.equal(evidence.caseCount, 10);
  assert.deepEqual(evidence.tiers, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(new Set(evidence.refusalCodes), new Set(['STALE_PLUGIN_OWNER_CONTEXT']));
  assert.equal(
    evidence.proofs.every((proof) => proof.remotePreserved && proof.rowHashBefore === proof.rowHashAfter),
    true,
    'RPP-0247 stale owner refusals should preserve generated plugin-owned data',
  );
});

test('RPP-0247 generated local plugin data rejects forged owner context evidence', () => {
  const testCase = generatedPluginOptionReadyCases()[0];
  const plan = planGeneratedCase(testCase);
  const mutation = generatedPluginOptionMutation(plan, testCase);
  const context = ownerFileContext(mutation, testCase);
  const validApply = applyPlan(cloneJson(testCase.remote), plan);

  assertGeneratedReadyPlanShape(testCase, plan, mutation);
  assert.equal(resourceHash(validApply.site, mutation.resource), mutation.localHash);

  const attacks = [
    {
      name: 'missing-owner-context-and-required-flag',
      mutate(entry) {
        delete entry.pluginOwnedResource.ownerContext;
        delete entry.pluginOwnedResource.ownerContextRequired;
      },
      assertDetails(error) {
        assert.equal(error.details.contextResourceKey, undefined);
        assert.equal(error.details.expectedHash, undefined);
        assert.equal(error.details.actualHash, undefined);
      },
    },
    {
      name: 'forged-owner-context-hash',
      mutate(entry) {
        entry.pluginOwnedResource.ownerContext.find((candidate) =>
          candidate.resourceKey === ownerFileKey).remoteHash = '0'.repeat(64);
      },
      assertDetails(error) {
        assert.equal(error.details.contextResourceKey, ownerFileKey);
        assert.equal(error.details.expectedHash, '0'.repeat(64));
        assert.equal(error.details.actualHash, context.remoteHash);
      },
    },
  ];
  const evidence = [];

  for (const attack of attacks) {
    const forged = tamperGeneratedPlan(plan, mutation.id, attack.mutate);
    const remote = cloneJson(testCase.remote);
    const before = remoteState(remote, mutation);
    const error = captureError(() => applyPlan(remote, forged));

    assert.ok(error instanceof PushPlanError, `${attack.name} should reject with PushPlanError`);
    assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
    assert.equal(error.details.resourceKey, mutation.resourceKey);
    assert.equal(error.details.pluginOwner, 'forms');
    attack.assertDetails(error);
    assertRemoteStateUnchanged(remote, before, mutation, `RPP-0247 ${attack.name}`);
    evidence.push({ attack: attack.name, refusal: refusalEvidence(error) });
  }

  assertNoPrivateEvidence(
    evidence,
    [...collectPrivateStrings(testCase)],
    `${testCase.id} forged owner context refusal evidence`,
  );
});
