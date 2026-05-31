import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const ownerPlugin = 'woocommerce';
const ownerPluginResourceKey = `plugin:${ownerPlugin}`;
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;
const ownerPluginFileResourceKey = `file:${ownerPluginFilePath}`;

const orderResources = Object.freeze([
  resource('wp_posts', 'ID:8106'),
  resource('wp_postmeta', 'post_id:8106:meta_key:_billing_email'),
  resource('wp_wc_orders', 'id:9106'),
  resource('wp_wc_order_addresses', 'id:9206'),
  resource('wp_woocommerce_order_items', 'order_item_id:9306'),
]);
const orderResourceKeys = Object.freeze(orderResources.map((entry) => entry.key));

const rawFixtures = Object.freeze({
  baseOrderTitle: 'rpp-0806-base-private-order-title',
  localOrderTitle: 'rpp-0806-local-private-order-title',
  baseBillingEmail: 'rpp-0806-base-buyer@example.test',
  localBillingEmail: 'rpp-0806-local-buyer@example.test',
  baseOrderKey: 'wc_order_rpp_0806_base_private_key',
  localOrderKey: 'wc_order_rpp_0806_local_private_key',
  baseAddress: 'rpp-0806-base-private-address',
  localAddress: 'rpp-0806-local-private-address',
  baseOrderItem: 'rpp-0806-base-private-order-item',
  localOrderItem: 'rpp-0806-local-private-order-item',
  basePluginFile: 'rpp-0806-base-woocommerce-plugin-file',
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowKey(table, id),
  };
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function baseSite() {
  return {
    files: {
      [ownerPluginFilePath]: `<?php /* ${rawFixtures.basePluginFile} */`,
    },
    plugins: {
      [ownerPlugin]: {
        version: '8.9.0',
        active: true,
      },
    },
    db: {
      wp_posts: {
        'ID:8106': {
          ID: 8106,
          post_type: 'shop_order',
          post_status: 'wc-processing',
          post_title: rawFixtures.baseOrderTitle,
          post_excerpt: 'base order note',
          __pluginOwner: ownerPlugin,
        },
      },
      wp_postmeta: {
        'post_id:8106:meta_key:_billing_email': {
          meta_id: 81061,
          post_id: 8106,
          meta_key: '_billing_email',
          meta_value: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_orders: {
        'id:9106': {
          id: 9106,
          type: 'shop_order',
          status: 'wc-processing',
          total_amount: '42.00',
          order_key: rawFixtures.baseOrderKey,
          billing_email: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_order_addresses: {
        'id:9206': {
          id: 9206,
          order_id: 9106,
          address_type: 'billing',
          address_1: rawFixtures.baseAddress,
          email: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_woocommerce_order_items: {
        'order_item_id:9306': {
          order_item_id: 9306,
          order_id: 8106,
          order_item_name: rawFixtures.baseOrderItem,
          order_item_type: 'line_item',
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function localOrderEdit(base) {
  const local = cloneJson(base);
  local.db.wp_posts['ID:8106'].post_status = 'wc-completed';
  local.db.wp_posts['ID:8106'].post_title = rawFixtures.localOrderTitle;
  local.db.wp_postmeta['post_id:8106:meta_key:_billing_email'].meta_value = rawFixtures.localBillingEmail;
  local.db.wp_wc_orders['id:9106'].status = 'wc-completed';
  local.db.wp_wc_orders['id:9106'].total_amount = '43.00';
  local.db.wp_wc_orders['id:9106'].order_key = rawFixtures.localOrderKey;
  local.db.wp_wc_orders['id:9106'].billing_email = rawFixtures.localBillingEmail;
  local.db.wp_wc_order_addresses['id:9206'].address_1 = rawFixtures.localAddress;
  local.db.wp_wc_order_addresses['id:9206'].email = rawFixtures.localBillingEmail;
  local.db.wp_woocommerce_order_items['order_item_id:9306'].order_item_name = rawFixtures.localOrderItem;
  return local;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function applyRefusal(remote, plan) {
  const before = cloneJson(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  return {
    error,
    beforeMutationCalls,
    remoteHashBefore: `sha256:${digest(before)}`,
    remoteHashAfter: `sha256:${digest(remote)}`,
  };
}

function forgedReadyOrderPlan(base, local, remote) {
  const target = resource('wp_wc_orders', 'id:9106');
  const remoteBeforeHash = resourceHash(remote, target);
  const localHash = resourceHash(local, target);
  return {
    schemaVersion: 1,
    id: 'plan-rpp-0806-forged-woocommerce-order',
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    mutations: [{
      id: 'mutation-1',
      resource: target,
      resourceKey: target.key,
      action: 'put',
      value: serializeResourceValue(local.db.wp_wc_orders['id:9106']),
      remoteBeforeHash,
      baseHash: resourceHash(base, target),
      localHash,
      changeKind: 'update',
      change: {
        localChange: 'update',
        remoteChange: 'unchanged',
      },
    }],
    preconditions: [{
      mutationId: 'mutation-1',
      resource: target,
      resourceKey: target.key,
      expectedHash: remoteBeforeHash,
      checkedAgainst: 'live-remote',
    }],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };
}

function buildOrderSafetyProof() {
  const base = baseSite();
  const local = localOrderEdit(base);
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const refusal = applyRefusal(remote, plan);
  const blockedResources = orderResourceKeys.map((resourceKey) => {
    const blocker = blockerFor(plan, resourceKey);
    assert.ok(blocker, `missing blocker for ${resourceKey}`);
    return {
      resourceKey,
      blockerClass: blocker.class,
      reasonCode: blocker.reasonCode,
      driver: blocker.driver,
      policySource: blocker.policySource,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      refusalEvidenceHash: `sha256:${digest(blocker.unknownPluginOwnedResourceRefusalEvidence)}`,
      blockerHash: `sha256:${digest(blocker)}`,
    };
  });
  const proof = {
    rpp: 'RPP-0806',
    variant: 1,
    scenario: 'woocommerce-order-safety-refusal',
    evidenceScope: 'local-model-plus-topology-prerequisite',
    productionBacked: false,
    ownerPlugin,
    ownerPluginResources: [ownerPluginResourceKey, ownerPluginFileResourceKey],
    orderSurfaces: orderResources.map((entry) => ({
      table: entry.table,
      resourceKey: entry.key,
    })),
    plan: {
      status: plan.status,
      summary: plan.summary,
      plannedOrderMutations: orderResourceKeys.filter((resourceKey) => mutationFor(plan, resourceKey)).length,
      plannedOrderPreconditions: orderResourceKeys.filter((resourceKey) =>
        plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey)).length,
    },
    blockedResources,
    applyRefusal: {
      code: refusal.error.code,
      beforeMutationCalls: refusal.beforeMutationCalls,
      remoteHashBefore: refusal.remoteHashBefore,
      remoteHashAfter: refusal.remoteHashAfter,
      remoteUnchanged: refusal.remoteHashBefore === refusal.remoteHashAfter,
    },
  };
  return {
    plan,
    proof: {
      ...proof,
      proofHash: `sha256:${digest(proof)}`,
    },
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0806-docker-work',
    evidenceDir: '/tmp/rpp-0806-docker-evidence',
    env: {},
  });
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'blocked',
    verify: { status: 2, signal: null },
    generatedAt: '2026-06-01T00:00:00.000Z',
  });

  return { plan, probe, artifact };
}

test('RPP-0806 blocks WooCommerce legacy and HPOS order rows before any mutation', () => {
  const { plan, proof } = buildOrderSafetyProof();
  const serializedProof = JSON.stringify(proof);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.blockers, orderResourceKeys.length);
  assert.equal(proof.plan.plannedOrderMutations, 0);
  assert.equal(proof.plan.plannedOrderPreconditions, 0);
  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.equal(proof.applyRefusal.remoteUnchanged, true);
  assert.match(proof.proofHash, sha256EvidencePattern);
  for (const blocked of proof.blockedResources) {
    assert.equal(blocked.blockerClass, 'unsupported-plugin-owned-resource');
    assert.equal(blocked.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
    assert.equal(blocked.driver, null);
    assert.equal(blocked.policySource, null);
    assert.match(blocked.baseHash, /^[a-f0-9]{64}$/);
    assert.match(blocked.localHash, /^[a-f0-9]{64}$/);
    assert.match(blocked.remoteHash, /^[a-f0-9]{64}$/);
    assert.match(blocked.refusalEvidenceHash, sha256EvidencePattern);
    assert.match(blocked.blockerHash, sha256EvidencePattern);
  }
  for (const raw of Object.values(rawFixtures)) {
    assert.equal(serializedProof.includes(raw), false, `RPP-0806 proof leaked raw order fixture ${raw}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0806 order refusal proof' }));
});

test('RPP-0806 executor rejects a forged WooCommerce order mutation before mutation-capable work', () => {
  const base = baseSite();
  const local = localOrderEdit(base);
  const remote = cloneJson(base);
  const forgedPlan = forgedReadyOrderPlan(base, local, remote);
  const refusal = applyRefusal(remote, forgedPlan);
  const serializedDetails = JSON.stringify(refusal.error.details);

  assert.ok(refusal.error instanceof PushPlanError);
  assert.equal(refusal.error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(refusal.error.details.resourceKey, rowKey('wp_wc_orders', 'id:9106'));
  assert.equal(refusal.error.details.pluginOwner, ownerPlugin);
  assert.equal(refusal.error.details.driver, null);
  assert.equal(refusal.error.details.applyValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(refusal.error.details.applyValidationEvidence.pluginOwner, ownerPlugin);
  assert.equal(refusal.beforeMutationCalls, 0);
  assert.equal(refusal.remoteHashBefore, refusal.remoteHashAfter);
  assert.match(refusal.remoteHashBefore, sha256EvidencePattern);
  for (const raw of Object.values(rawFixtures)) {
    assert.equal(serializedDetails.includes(raw), false, `forged refusal leaked raw order fixture ${raw}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(refusal.error.details, {
    label: 'RPP-0806 forged order refusal details',
  }));
});

test('RPP-0806 topology command artifact records exact unavailable capability fail-closed', () => {
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);
  const topologyEvidence = {
    rpp: 'RPP-0806',
    command: artifact.commands.runHarness,
    status: artifact.status,
    failClosed: artifact.failClosed,
    exactUnavailableCapability: {
      code: probe.blocker.code,
      command: probe.checks.dockerCli.command,
      missingExecutable: probe.checks.dockerCli.missingExecutable,
    },
    topology: {
      variant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
      runtime: artifact.runtime,
      publishedHostPort: artifact.topology.publishedPorts[0].hostPort,
      publishedHost: artifact.topology.publishedPorts[0].host,
      proxyPolicy: 'local-only',
      tunnels: 'disallowed',
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    },
    proofHash: `sha256:${digest({
      command: artifact.commands.runHarness,
      status: artifact.status,
      blockerCode: probe.blocker.code,
      topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
      hostPort: artifact.topology.publishedPorts[0].hostPort,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    })}`,
  };

  assert.equal(validation.ok, true);
  assert.equal(artifact.commands.runHarness, 'npm run verify:release:docker-local-production');
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(probe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerLocalProductionProof.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.topology.publishedPorts[0].host, '127.0.0.1');
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);
  assert.equal(artifact.topology.noTunnelPolicy.forbidden.includes('ngrok'), true);
  assert.equal(topologyEvidence.releaseGate.acceptedForReleaseGate, false);
  assert.equal(topologyEvidence.releaseGate.releaseMovementAllowed, false);
  assert.match(topologyEvidence.proofHash, sha256EvidencePattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(topologyEvidence, {
    label: 'RPP-0806 topology unavailable-capability proof',
  }));
});
