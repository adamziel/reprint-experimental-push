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

const fixedNow = '2026-06-01T00:00:00.000Z';
const fixedNowDate = new Date(fixedNow);
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const ownerPlugin = 'woocommerce';
const ownerPluginFilePath = `wp-content/plugins/${ownerPlugin}/${ownerPlugin}.php`;

const orderSurfaces = Object.freeze([
  surface('legacy-shop-order-post', 'legacy', 'wp_posts', 'ID:8262'),
  surface('legacy-order-billing-postmeta', 'legacy', 'wp_postmeta', 'post_id:8262:meta_key:_billing_email'),
  surface('legacy-order-line-item', 'legacy', 'wp_woocommerce_order_items', 'order_item_id:8362'),
  surface('legacy-order-line-item-meta', 'legacy', 'wp_woocommerce_order_itemmeta', 'meta_id:8462'),
  surface('hpos-order-row', 'hpos', 'wp_wc_orders', 'id:9262'),
  surface('hpos-order-address-row', 'hpos', 'wp_wc_order_addresses', 'id:9362'),
  surface('hpos-order-operational-row', 'hpos', 'wp_wc_order_operational_data', 'order_id:9262'),
  surface('hpos-order-meta-row', 'hpos', 'wp_wc_orders_meta', 'meta_id:9462'),
]);
const orderResourceKeys = Object.freeze(orderSurfaces.map((entry) => resourceForSurface(entry).key));

const rawFixtures = Object.freeze({
  basePluginFile: 'rpp-0866-base-woocommerce-plugin-file',
  baseLegacyTitle: 'rpp-0866-base-private-legacy-title',
  localLegacyTitle: 'rpp-0866-local-private-legacy-title',
  baseBillingEmail: 'rpp-0866-base-buyer@example.test',
  localBillingEmail: 'rpp-0866-local-buyer@example.test',
  baseOrderKey: 'wc_order_rpp_0866_base_private_key',
  localOrderKey: 'wc_order_rpp_0866_local_private_key',
  baseAddress: 'rpp-0866-base-private-address',
  localAddress: 'rpp-0866-local-private-address',
  baseLineItem: 'rpp-0866-base-private-line-item',
  localLineItem: 'rpp-0866-local-private-line-item',
  baseLineMeta: 'rpp-0866-base-private-line-meta',
  localLineMeta: 'rpp-0866-local-private-line-meta',
  baseHposMeta: 'rpp-0866-base-private-hpos-meta',
  localHposMeta: 'rpp-0866-local-private-hpos-meta',
});

test('RPP-0866 builds hash-count-surface-only WooCommerce order refusal proof', () => {
  const { plan, proof } = buildWooCommerceOrderSafetyProof();
  const serializedProof = JSON.stringify(proof);

  assert.equal(proof.validation.ok, true, JSON.stringify(proof.validation.failures));
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.blockers, orderSurfaces.length);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0866');
  assert.equal(proof.variant, 4);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.orderSafety.surfaceCount, orderSurfaces.length);
  assert.deepEqual(proof.orderSafety.storageSurfaceCounts, {
    legacy: 4,
    hpos: 4,
    total: 8,
  });
  assert.deepEqual(proof.orderSafety.pluginOwnedRowCounts, {
    base: orderSurfaces.length,
    local: orderSurfaces.length,
    remote: orderSurfaces.length,
    expected: orderSurfaces.length,
  });
  assert.equal(proof.orderSafety.plan.plannedOrderMutations, 0);
  assert.equal(proof.orderSafety.plan.plannedOrderPreconditions, 0);
  assert.equal(proof.orderSafety.plan.blockedOrderSurfaces, orderSurfaces.length);
  assert.equal(proof.orderSafety.blockers.count, orderSurfaces.length);
  assert.deepEqual(proof.orderSafety.blockers.classes, ['unsupported-plugin-owned-resource']);
  assert.deepEqual(proof.orderSafety.blockers.reasonCodes, ['UNKNOWN_PLUGIN_OWNED_RESOURCE']);
  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.equal(proof.applyRefusal.remoteUnchanged, true);
  assert.equal(proof.forgedMutationRefusals.count, orderSurfaces.length);
  assert.equal(proof.forgedMutationRefusals.beforeMutationCalls, 0);
  assert.equal(proof.forgedMutationRefusals.refusedBeforeMutation, true);
  assert.equal(proof.forgedMutationRefusals.remoteUnchanged, true);
  assert.match(proof.proofHash, sha256EvidencePattern);

  for (const surfaceProof of proof.orderSafety.blockers.bySurface) {
    assert.match(surfaceProof.resourceKeyHash, sha256EvidencePattern);
    assert.match(surfaceProof.baseHash, sha256HexPattern);
    assert.match(surfaceProof.localHash, sha256HexPattern);
    assert.match(surfaceProof.remoteHash, sha256HexPattern);
    assert.match(surfaceProof.blockerHash, sha256EvidencePattern);
    assert.match(surfaceProof.refusalEvidenceHash, sha256EvidencePattern);
  }
  for (const raw of Object.values(rawFixtures)) {
    assert.equal(serializedProof.includes(raw), false, `RPP-0866 proof leaked raw order fixture ${raw}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0866 WooCommerce order refusal proof',
  }));
});

test('RPP-0866 refuses every forged WooCommerce order mutation before mutation-capable work', () => {
  const base = baseSite();
  const local = localOrderEdit(base);
  const remote = cloneJson(base);
  const results = orderSurfaces.map((surfaceEntry) => {
    const forgedPlan = forgedReadyOrderPlan(base, local, remote, surfaceEntry);
    const refusal = applyRefusal(cloneJson(remote), forgedPlan);
    return { surfaceEntry, forgedPlan, refusal };
  });

  assert.equal(results.length, orderSurfaces.length);
  for (const { surfaceEntry, forgedPlan, refusal } of results) {
    assert.ok(refusal.error instanceof PushPlanError);
    assert.equal(forgedPlan.status, 'ready');
    assert.equal(forgedPlan.summary.mutations, 1);
    assert.equal(refusal.error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
    assert.equal(refusal.error.details.resourceKey, resourceForSurface(surfaceEntry).key);
    assert.equal(refusal.error.details.pluginOwner, ownerPlugin);
    assert.equal(refusal.error.details.driver, null);
    assert.equal(refusal.error.details.applyValidationEvidence.outcome, 'refused-before-mutation');
    assert.equal(refusal.error.details.applyValidationEvidence.pluginOwner, ownerPlugin);
    assert.equal(refusal.error.details.applyValidationEvidence.driver, null);
    assert.equal(refusal.beforeMutationCalls, 0);
    assert.equal(refusal.remoteHashBefore, refusal.remoteHashAfter);
    assert.match(refusal.remoteHashBefore, sha256EvidencePattern);
    for (const raw of Object.values(rawFixtures)) {
      assert.equal(
        JSON.stringify(refusal.error.details).includes(raw),
        false,
        `forged refusal leaked raw order fixture ${raw}`,
      );
    }
    assert.doesNotThrow(() => assertEvidenceHasNoRawValues(refusal.error.details, {
      label: `RPP-0866 forged ${surfaceEntry.surfaceId} refusal details`,
    }));
  }
});

test('RPP-0866 topology command artifact records exact unavailable capability fail-closed', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildTopologyProof({ artifact, plan, probe });

  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(validateWooCommerceOrderSafetyProof({
    ...emptyValidOrderProofShell(),
    topologyCommand: proof.topologyCommand,
    localOnlyPolicy: proof.localOnlyPolicy,
    releaseGate: proof.releaseGate,
    invariants: {
      ...emptyValidOrderProofShell().invariants,
      topologyCommandStartedSitesOrExactCapabilityRecorded: true,
      failClosedWhenSitesNotStarted: true,
      localOnlyTopologyPolicy: true,
      noPackagedFallback: true,
    },
  }).ok, true);
  assert.equal(proof.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(proof.topologyCommand.successCriterion, 'sites-started-or-exact-unavailable-capability-recorded');
  assert.equal(proof.topologyCommand.sitesStarted, false);
  assert.equal(proof.topologyCommand.status, 'blocked');
  assert.equal(proof.topologyCommand.exitCode, 2);
  assert.equal(proof.topologyCommand.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.capability, 'docker-cli');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.command, 'docker --version');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.missingExecutable, true);
  assert.equal(proof.topologyCommand.statusMarker, '[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]');
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(proof.localOnlyPolicy.packagedFallbackObserved, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackDisabled, true);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.releaseMovementAllowed, false);
  assert.equal(proof.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(proof.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.match(proof.topologyHash, sha256EvidencePattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0866 topology unavailable-capability proof',
  }));
});

test('RPP-0866 validation rejects non-started topology without an exact capability code', () => {
  const { proof } = buildWooCommerceOrderSafetyProof();
  const ambiguous = {
    ...proof,
    topologyCommand: {
      ...proof.topologyCommand,
      exactUnavailableCapability: {
        ...proof.topologyCommand.exactUnavailableCapability,
        code: '',
      },
    },
  };
  const validation = validateWooCommerceOrderSafetyProof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'RPP_0866_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

function surface(surfaceId, storage, table, rowId) {
  return Object.freeze({ surfaceId, storage, table, rowId });
}

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

function resourceForSurface(surfaceEntry) {
  return resource(surfaceEntry.table, surfaceEntry.rowId);
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
        version: '9.2.0',
        active: true,
      },
    },
    db: {
      wp_posts: {
        'ID:8262': {
          ID: 8262,
          post_type: 'shop_order',
          post_status: 'wc-processing',
          post_title: rawFixtures.baseLegacyTitle,
          post_excerpt: 'base order note',
          __pluginOwner: ownerPlugin,
        },
      },
      wp_postmeta: {
        'post_id:8262:meta_key:_billing_email': {
          meta_id: 82621,
          post_id: 8262,
          meta_key: '_billing_email',
          meta_value: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_woocommerce_order_items: {
        'order_item_id:8362': {
          order_item_id: 8362,
          order_id: 8262,
          order_item_name: rawFixtures.baseLineItem,
          order_item_type: 'line_item',
          __pluginOwner: ownerPlugin,
        },
      },
      wp_woocommerce_order_itemmeta: {
        'meta_id:8462': {
          meta_id: 8462,
          order_item_id: 8362,
          meta_key: '_line_subtotal',
          meta_value: rawFixtures.baseLineMeta,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_orders: {
        'id:9262': {
          id: 9262,
          type: 'shop_order',
          status: 'wc-processing',
          total_amount: '82.60',
          order_key: rawFixtures.baseOrderKey,
          billing_email: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_order_addresses: {
        'id:9362': {
          id: 9362,
          order_id: 9262,
          address_type: 'billing',
          address_1: rawFixtures.baseAddress,
          email: rawFixtures.baseBillingEmail,
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_order_operational_data: {
        'order_id:9262': {
          order_id: 9262,
          order_stock_reduced: 'no',
          download_permission_granted: 'no',
          date_updated_gmt: '2026-05-31 08:26:00',
          __pluginOwner: ownerPlugin,
        },
      },
      wp_wc_orders_meta: {
        'meta_id:9462': {
          meta_id: 9462,
          order_id: 9262,
          meta_key: '_rpp_private_hpos_meta',
          meta_value: rawFixtures.baseHposMeta,
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function localOrderEdit(base) {
  const local = cloneJson(base);
  local.db.wp_posts['ID:8262'].post_status = 'wc-completed';
  local.db.wp_posts['ID:8262'].post_title = rawFixtures.localLegacyTitle;
  local.db.wp_postmeta['post_id:8262:meta_key:_billing_email'].meta_value = rawFixtures.localBillingEmail;
  local.db.wp_woocommerce_order_items['order_item_id:8362'].order_item_name = rawFixtures.localLineItem;
  local.db.wp_woocommerce_order_itemmeta['meta_id:8462'].meta_value = rawFixtures.localLineMeta;
  local.db.wp_wc_orders['id:9262'].status = 'wc-completed';
  local.db.wp_wc_orders['id:9262'].total_amount = '83.60';
  local.db.wp_wc_orders['id:9262'].order_key = rawFixtures.localOrderKey;
  local.db.wp_wc_orders['id:9262'].billing_email = rawFixtures.localBillingEmail;
  local.db.wp_wc_order_addresses['id:9362'].address_1 = rawFixtures.localAddress;
  local.db.wp_wc_order_addresses['id:9362'].email = rawFixtures.localBillingEmail;
  local.db.wp_wc_order_operational_data['order_id:9262'].order_stock_reduced = 'yes';
  local.db.wp_wc_order_operational_data['order_id:9262'].download_permission_granted = 'yes';
  local.db.wp_wc_order_operational_data['order_id:9262'].date_updated_gmt = '2026-05-31 09:26:00';
  local.db.wp_wc_orders_meta['meta_id:9462'].meta_value = rawFixtures.localHposMeta;
  return local;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNowDate });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function countPluginOwnedOrderRows(site) {
  return orderSurfaces.filter((surfaceEntry) => {
    const row = site.db?.[surfaceEntry.table]?.[surfaceEntry.rowId];
    return row?.__pluginOwner === ownerPlugin;
  }).length;
}

function storageSurfaceCounts() {
  return orderSurfaces.reduce((counts, surfaceEntry) => {
    counts[surfaceEntry.storage] += 1;
    counts.total += 1;
    return counts;
  }, { legacy: 0, hpos: 0, total: 0 });
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
    remoteUnchanged: digest(before) === digest(remote),
  };
}

function forgedReadyOrderPlan(base, local, remote, surfaceEntry) {
  const target = resourceForSurface(surfaceEntry);
  const remoteBeforeHash = resourceHash(remote, target);
  const localHash = resourceHash(local, target);
  return {
    schemaVersion: 1,
    id: `plan-rpp-0866-forged-${surfaceEntry.surfaceId}`,
    generatedAt: fixedNow,
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
      value: serializeResourceValue(local.db[surfaceEntry.table][surfaceEntry.rowId]),
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

function buildWooCommerceOrderSafetyProof() {
  const base = baseSite();
  const local = localOrderEdit(base);
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const blockedPlanRefusal = applyRefusal(cloneJson(remote), plan);
  const topology = buildMissingDockerCapabilityArtifact();

  const blockedBySurface = orderSurfaces.map((surfaceEntry) => {
    const rowResource = resourceForSurface(surfaceEntry);
    const blocker = blockerFor(plan, rowResource.key);
    assert.ok(blocker, `missing blocker for ${surfaceEntry.surfaceId}`);
    assert.equal(blocker.pluginOwner, ownerPlugin);
    return {
      surfaceId: surfaceEntry.surfaceId,
      storage: surfaceEntry.storage,
      table: surfaceEntry.table,
      resourceKeyHash: `sha256:${digest(rowResource.key)}`,
      blockerClass: blocker.class,
      reasonCode: blocker.reasonCode,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      policySource: blocker.policySource,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      refusalEvidenceHash: `sha256:${digest(blocker.unknownPluginOwnedResourceRefusalEvidence)}`,
      blockerHash: `sha256:${digest(blocker)}`,
    };
  });

  const forgedRefusals = orderSurfaces.map((surfaceEntry) => {
    const forgedPlan = forgedReadyOrderPlan(base, local, remote, surfaceEntry);
    const refusal = applyRefusal(cloneJson(remote), forgedPlan);
    assert.equal(refusal.error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
    return {
      surfaceId: surfaceEntry.surfaceId,
      storage: surfaceEntry.storage,
      table: surfaceEntry.table,
      code: refusal.error.code,
      pluginOwner: refusal.error.details.pluginOwner,
      driver: refusal.error.details.driver,
      outcome: refusal.error.details.applyValidationEvidence.outcome,
      beforeMutationCalls: refusal.beforeMutationCalls,
      remoteUnchanged: refusal.remoteUnchanged,
      resourceKeyHash: `sha256:${digest(refusal.error.details.resourceKey)}`,
      detailsHash: `sha256:${digest(refusal.error.details)}`,
      applyValidationEvidenceHash: `sha256:${digest(refusal.error.details.applyValidationEvidence)}`,
    };
  });

  const topologyProof = buildTopologyProof(topology);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0866',
    variant: 4,
    proofId: 'rpp-0866-woocommerce-order-safety-refusal-v4',
    checkedAt: fixedNow,
    status: 'blocked-support-only',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    ownerContext: {
      plugin: ownerPlugin,
      activeInBase: base.plugins[ownerPlugin].active === true,
      activeInRemote: remote.plugins[ownerPlugin].active === true,
      resourceCount: 2,
      pluginResourceKeyHash: `sha256:${digest(`plugin:${ownerPlugin}`)}`,
      pluginFileResourceKeyHash: `sha256:${digest(`file:${ownerPluginFilePath}`)}`,
      pluginHash: `sha256:${resourceHash(remote, { type: 'plugin', name: ownerPlugin, key: `plugin:${ownerPlugin}` })}`,
      pluginFileHash: `sha256:${resourceHash(remote, {
        type: 'file',
        path: ownerPluginFilePath,
        key: `file:${ownerPluginFilePath}`,
      })}`,
    },
    orderSafety: {
      evidenceFormat: 'hash-count-surface-only',
      surfaceCount: orderSurfaces.length,
      tableSurfaces: orderSurfaces.map(({ surfaceId, storage, table }) => ({ surfaceId, storage, table })),
      storageSurfaceCounts: storageSurfaceCounts(),
      pluginOwnedRowCounts: {
        base: countPluginOwnedOrderRows(base),
        local: countPluginOwnedOrderRows(local),
        remote: countPluginOwnedOrderRows(remote),
        expected: orderSurfaces.length,
      },
      plan: {
        status: plan.status,
        summary: plan.summary,
        plannedOrderMutations: orderResourceKeys.filter((resourceKey) => mutationFor(plan, resourceKey)).length,
        plannedOrderPreconditions: orderResourceKeys.filter((resourceKey) =>
          plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey)).length,
        blockedOrderSurfaces: blockedBySurface.length,
      },
      blockers: {
        count: blockedBySurface.length,
        classes: [...new Set(blockedBySurface.map((entry) => entry.blockerClass))].sort(),
        reasonCodes: [...new Set(blockedBySurface.map((entry) => entry.reasonCode))].sort(),
        bySurface: blockedBySurface,
      },
    },
    applyRefusal: {
      code: blockedPlanRefusal.error.code,
      beforeMutationCalls: blockedPlanRefusal.beforeMutationCalls,
      remoteHashBefore: blockedPlanRefusal.remoteHashBefore,
      remoteHashAfter: blockedPlanRefusal.remoteHashAfter,
      remoteUnchanged: blockedPlanRefusal.remoteUnchanged,
    },
    forgedMutationRefusals: {
      count: forgedRefusals.length,
      beforeMutationCalls: forgedRefusals.reduce((sum, entry) => sum + entry.beforeMutationCalls, 0),
      refusedBeforeMutation: forgedRefusals.every((entry) => entry.beforeMutationCalls === 0),
      remoteUnchanged: forgedRefusals.every((entry) => entry.remoteUnchanged === true),
      codes: [...new Set(forgedRefusals.map((entry) => entry.code))].sort(),
      bySurface: forgedRefusals,
    },
    builtOn: topologyProof.builtOn,
    topologyCommand: topologyProof.topologyCommand,
    localOnlyPolicy: topologyProof.localOnlyPolicy,
    releaseGate: topologyProof.releaseGate,
  };
  const invariants = {
    allOrderSurfacesRemainPluginOwned: proofCore.orderSafety.pluginOwnedRowCounts.base === orderSurfaces.length
      && proofCore.orderSafety.pluginOwnedRowCounts.local === orderSurfaces.length
      && proofCore.orderSafety.pluginOwnedRowCounts.remote === orderSurfaces.length,
    plannerBlockedEveryOrderSurface: proofCore.orderSafety.plan.status === 'blocked'
      && proofCore.orderSafety.plan.plannedOrderMutations === 0
      && proofCore.orderSafety.plan.plannedOrderPreconditions === 0
      && proofCore.orderSafety.plan.blockedOrderSurfaces === orderSurfaces.length,
    blockerEvidenceHashOnly: proofCore.orderSafety.blockers.bySurface.every((entry) =>
      sha256EvidencePattern.test(entry.resourceKeyHash)
      && sha256EvidencePattern.test(entry.blockerHash)
      && sha256EvidencePattern.test(entry.refusalEvidenceHash)),
    forgedMutationsRefusedBeforeMutationCapableWork: proofCore.forgedMutationRefusals.count === orderSurfaces.length
      && proofCore.forgedMutationRefusals.refusedBeforeMutation === true
      && proofCore.forgedMutationRefusals.remoteUnchanged === true
      && proofCore.forgedMutationRefusals.codes.length === 1
      && proofCore.forgedMutationRefusals.codes[0] === 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE',
    topologyCommandStartedSitesOrExactCapabilityRecorded: topologyProof.topologyCommand.sitesStarted
      || Boolean(topologyProof.topologyCommand.exactUnavailableCapability?.code),
    failClosedWhenSitesNotStarted: topologyProof.topologyCommand.sitesStarted
      || (topologyProof.topologyCommand.status === 'blocked'
        && topologyProof.localOnlyPolicy.failClosed === true
        && topologyProof.releaseGate.releaseMovementAllowed === false),
    localOnlyTopologyPolicy: topologyProof.localOnlyPolicy.onlySandbox8080Ingress === true
      && topologyProof.localOnlyPolicy.noTunnelPolicyEnforced === true,
    noPackagedFallback: topologyProof.localOnlyPolicy.packagedFallbackObserved === false
      && topologyProof.localOnlyPolicy.packagedFallbackDisabled === true,
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    plan,
    proof: {
      ...withInvariants,
      validation: validateWooCommerceOrderSafetyProof(withInvariants),
      proofHash: `sha256:${digest(withInvariants)}`,
    },
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0866-docker-work',
    evidenceDir: '/tmp/rpp-0866-docker-evidence',
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
    generatedAt: fixedNow,
  });

  return { artifact, plan, probe };
}

function buildTopologyProof({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const sitesStarted = artifact.status === 'passed';
  const proofCore = {
    builtOn: {
      dockerTopologyVariant,
      commandContract: artifact.evidence.dockerVerifyReleaseTopology.command,
      runtime: artifact.runtime,
      gate: artifact.gate,
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      successCriterion: 'sites-started-or-exact-unavailable-capability-recorded',
      status: artifact.status,
      exitCode: artifact.evidence.verifyReleaseFailure?.exitCode || 0,
      sitesStarted,
      siteRoles: plan.sites.map((site) => site.key),
      exactUnavailableCapability: sitesStarted ? null : {
        code: blockerCode,
        capability: dockerCapabilityForBlocker(blockerCode),
        command: probe.checks.dockerCli?.command || '',
        missingExecutable: probe.checks.dockerCli?.missingExecutable === true,
        requiredFor: [
          'woocommerce-order-safety-wordpress-sites-start',
          'woocommerce-legacy-and-hpos-order-refusal-proof',
          'release-verifier-path',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    localOnlyPolicy: {
      failClosed: artifact.failClosed,
      publishedHttpIngress: plan.publishedPorts.map((entry) => ({
        service: entry.service,
        host: entry.host,
        hostPort: entry.hostPort,
        containerPort: entry.containerPort,
      })),
      onlySandbox8080Ingress: plan.validation.checks.onlySandbox8080Ingress,
      noTunnelPolicyEnforced: plan.validation.checks.noTunnelCommands,
      packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
      packagedFallbackDisabled: plan.validation.checks.packagedFallbackDisabled,
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    },
  };
  return {
    ...proofCore,
    topologyHash: `sha256:${digest(proofCore)}`,
  };
}

function validateWooCommerceOrderSafetyProof(proof) {
  const failures = [];
  if (proof.rppId && proof.rppId !== 'RPP-0866') {
    failures.push({ code: 'RPP_0866_ID_MISMATCH' });
  }
  if (proof.variant && proof.variant !== 4) {
    failures.push({ code: 'RPP_0866_VARIANT_MISMATCH' });
  }
  if (proof.supportOnly === false || proof.productionBacked === true || proof.releaseEligible === true) {
    failures.push({ code: 'RPP_0866_SUPPORT_ONLY_RELEASE_STATE_INVALID' });
  }

  const orderSafety = proof.orderSafety || {};
  const expectedSurfaceCount = orderSurfaces.length;
  if (orderSafety.surfaceCount !== expectedSurfaceCount) {
    failures.push({ code: 'RPP_0866_ORDER_SURFACE_COUNT_MISMATCH' });
  }
  const counts = orderSafety.pluginOwnedRowCounts || {};
  if (counts.base !== expectedSurfaceCount || counts.local !== expectedSurfaceCount || counts.remote !== expectedSurfaceCount) {
    failures.push({ code: 'RPP_0866_ORDER_ROWS_NOT_PLUGIN_OWNED' });
  }
  const plan = orderSafety.plan || {};
  if (plan.status !== 'blocked'
    || plan.plannedOrderMutations !== 0
    || plan.plannedOrderPreconditions !== 0
    || plan.blockedOrderSurfaces !== expectedSurfaceCount) {
    failures.push({ code: 'RPP_0866_ORDER_PLAN_NOT_FAIL_CLOSED' });
  }
  const blockers = orderSafety.blockers || {};
  if (blockers.count !== expectedSurfaceCount
    || JSON.stringify(blockers.classes || []) !== JSON.stringify(['unsupported-plugin-owned-resource'])
    || JSON.stringify(blockers.reasonCodes || []) !== JSON.stringify(['UNKNOWN_PLUGIN_OWNED_RESOURCE'])) {
    failures.push({ code: 'RPP_0866_ORDER_BLOCKERS_NOT_EXACT' });
  }
  if (!Array.isArray(blockers.bySurface)
    || blockers.bySurface.some((entry) =>
      !sha256EvidencePattern.test(entry.resourceKeyHash || '')
      || !sha256EvidencePattern.test(entry.blockerHash || '')
      || !sha256EvidencePattern.test(entry.refusalEvidenceHash || ''))) {
    failures.push({ code: 'RPP_0866_ORDER_BLOCKER_EVIDENCE_NOT_HASH_ONLY' });
  }
  if (proof.applyRefusal?.code !== 'PLAN_NOT_READY'
    || proof.applyRefusal?.beforeMutationCalls !== 0
    || proof.applyRefusal?.remoteUnchanged !== true) {
    failures.push({ code: 'RPP_0866_BLOCKED_PLAN_APPLY_NOT_REFUSED_PRE_MUTATION' });
  }
  const forged = proof.forgedMutationRefusals || {};
  if (forged.count !== expectedSurfaceCount
    || forged.beforeMutationCalls !== 0
    || forged.refusedBeforeMutation !== true
    || forged.remoteUnchanged !== true
    || JSON.stringify(forged.codes || []) !== JSON.stringify(['UNSUPPORTED_PLUGIN_OWNED_RESOURCE'])) {
    failures.push({ code: 'RPP_0866_FORGED_MUTATIONS_NOT_REFUSED_PRE_MUTATION' });
  }

  const topologyCommand = proof.topologyCommand || {};
  if (!topologyCommand.sitesStarted) {
    const capability = topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'RPP_0866_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.localOnlyPolicy?.failClosed !== true || proof.releaseGate?.releaseMovementAllowed !== false) {
      failures.push({ code: 'RPP_0866_TOPOLOGY_NOT_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
  }
  if (proof.localOnlyPolicy?.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy?.noTunnelPolicyEnforced !== true) {
    failures.push({ code: 'RPP_0866_TOPOLOGY_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy?.packagedFallbackObserved !== false
    || proof.localOnlyPolicy?.packagedFallbackDisabled !== true) {
    failures.push({ code: 'RPP_0866_TOPOLOGY_PACKAGED_FALLBACK_REJECTED' });
  }
  const invariants = proof.invariants || {};
  for (const key of [
    'allOrderSurfacesRemainPluginOwned',
    'plannerBlockedEveryOrderSurface',
    'blockerEvidenceHashOnly',
    'forgedMutationsRefusedBeforeMutationCapableWork',
    'topologyCommandStartedSitesOrExactCapabilityRecorded',
    'failClosedWhenSitesNotStarted',
    'localOnlyTopologyPolicy',
    'noPackagedFallback',
  ]) {
    if (invariants[key] !== true) {
      failures.push({ code: `RPP_0866_INVARIANT_FAILED_${key}` });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function emptyValidOrderProofShell() {
  return {
    rppId: 'RPP-0866',
    variant: 4,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    orderSafety: {
      surfaceCount: orderSurfaces.length,
      pluginOwnedRowCounts: {
        base: orderSurfaces.length,
        local: orderSurfaces.length,
        remote: orderSurfaces.length,
      },
      plan: {
        status: 'blocked',
        plannedOrderMutations: 0,
        plannedOrderPreconditions: 0,
        blockedOrderSurfaces: orderSurfaces.length,
      },
      blockers: {
        count: orderSurfaces.length,
        classes: ['unsupported-plugin-owned-resource'],
        reasonCodes: ['UNKNOWN_PLUGIN_OWNED_RESOURCE'],
        bySurface: orderSurfaces.map((surfaceEntry) => ({
          surfaceId: surfaceEntry.surfaceId,
          resourceKeyHash: `sha256:${digest(surfaceEntry.surfaceId)}`,
          blockerHash: `sha256:${digest(`blocker:${surfaceEntry.surfaceId}`)}`,
          refusalEvidenceHash: `sha256:${digest(`refusal:${surfaceEntry.surfaceId}`)}`,
        })),
      },
    },
    applyRefusal: {
      code: 'PLAN_NOT_READY',
      beforeMutationCalls: 0,
      remoteUnchanged: true,
    },
    forgedMutationRefusals: {
      count: orderSurfaces.length,
      beforeMutationCalls: 0,
      refusedBeforeMutation: true,
      remoteUnchanged: true,
      codes: ['UNSUPPORTED_PLUGIN_OWNED_RESOURCE'],
    },
    invariants: {
      allOrderSurfacesRemainPluginOwned: true,
      plannerBlockedEveryOrderSurface: true,
      blockerEvidenceHashOnly: true,
      forgedMutationsRefusedBeforeMutationCapableWork: true,
      topologyCommandStartedSitesOrExactCapabilityRecorded: false,
      failClosedWhenSitesNotStarted: false,
      localOnlyTopologyPolicy: false,
      noPackagedFallback: false,
    },
  };
}

function dockerCapabilityForBlocker(code) {
  if (code === 'DOCKER_CLI_MISSING' || code === 'DOCKER_CLI_UNAVAILABLE') {
    return 'docker-cli';
  }
  if (code === 'DOCKER_COMPOSE_UNAVAILABLE') {
    return 'docker-compose-v2';
  }
  if (code === 'DOCKER_DAEMON_UNAVAILABLE') {
    return 'docker-daemon';
  }
  return 'docker-local-production-runtime';
}
