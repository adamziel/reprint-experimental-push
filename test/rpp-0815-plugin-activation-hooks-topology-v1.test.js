import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  productionPluginDriverBoundary,
  summarizeProductionPluginDriverBoundaryProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0815-plugin-activation-hooks-topology-v1.md',
);
const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const activationHookSideEffectResourceKey = 'row:["wp_options","option_name:reprint_push_activation_hook_state"]';
const rawNeedles = Object.freeze([
  'rpp-0815-unproven-private-hook-state',
  'rpp-0815-driver-proofed-private-hook-state',
  'option_value',
  'register_activation_hook(__FILE__',
]);

test('RPP-0815 progress report records candidate versus release-ready activation hook scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0815');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'activation-hook-topology-candidate');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-production-shaped-plugin-driver-boundary');
  assert.equal(report.candidateScope.topologyShape.activationSurface, 'plugin-activation-hooks');
  assert.equal(report.candidateScope.topologyShape.directActivePluginsMutationAllowed, false);
  assert.equal(report.candidateScope.topologyShape.activationHookSideEffectsAutoReleaseEligible, false);
  assert.equal(report.candidateScope.topologyShape.driverProofedActivationHookEffectsQuarantined, true);
  assert.equal(report.candidateScope.topologyShape.dependencyPreflightRequired, true);
  assert.equal(report.candidateScope.topologyShape.dynamicHookExecutionObserved, false);
  assert.equal(report.candidateScope.topologyShape.rawActivationHookValuesIncluded, false);

  assert.deepEqual(report.candidateScope.candidateClaims, [
    'candidate-shape-recorded',
    'direct-active-plugins-refusal-linked',
    'activation-dependency-preflight-linked',
    'unproven-hook-effects-blocked',
    'driver-proofed-hook-effects-quarantined-as-support-only',
  ]);
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('live-wordpress-activate-plugin-execution-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('dynamic-hook-side-effect-inventory'),
  );

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-bound-wordpress-plugin-activation-run'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'activation-hook-side-effects-inventoried-with-explicit-driver-proofs',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'durable-journal-and-recovery-inspect-cover-activation-side-effects',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('no-accepted-production-bound-plugin-activation-run'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'driver-proofed-hook-effects-are-quarantined-not-release-eligible',
    ),
  );

  assert.match(report.scopeComparisonHash, sha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0815 candidate scope matches existing activation-hook boundary signals', () => {
  const { report } = loadProgressReport();
  const boundarySignals = buildActivationHookBoundarySignals();

  assert.deepEqual(report.candidateScope.activationHookBoundarySignals, boundarySignals);
  assert.equal(
    report.adjacentSupportEvidence.activationHookSideEffectBoundary.unprovenStatus,
    boundarySignals.unprovenStatus,
  );
  assert.equal(
    report.adjacentSupportEvidence.activationHookSideEffectBoundary.unprovenVerdict,
    boundarySignals.unprovenVerdict,
  );
  assert.equal(
    report.adjacentSupportEvidence.activationHookSideEffectBoundary.driverProofedStatus,
    boundarySignals.driverProofedStatus,
  );
  assert.equal(
    report.adjacentSupportEvidence.activationHookSideEffectBoundary.driverProofedVerdict,
    boundarySignals.driverProofedVerdict,
  );
  assert.equal(
    report.candidateScope.topologyShape.activationHookSideEffectResourceKey,
    activationHookSideEffectResourceKey,
  );
  assert.equal(
    report.candidateScope.topologyShape.directActivePluginsResourceKey,
    'row:["wp_options","option_name:active_plugins"]',
  );
});

test('RPP-0815 adjacent activation and dependency evidence stays support-only', () => {
  const { report } = loadProgressReport();

  assert.deepEqual(report.adjacentSupportEvidence.pluginActivationDependency.rppIds, [
    'RPP-0449',
    'RPP-0489',
  ]);
  assert.equal(report.adjacentSupportEvidence.pluginActivationDependency.productionBacked, false);
  assert.equal(report.adjacentSupportEvidence.pluginActivationDependency.releaseEligible, false);
  assert.equal(
    report.adjacentSupportEvidence.pluginActivationDependency.candidateSignal,
    'dependency-drift-refuses-before-activation',
  );

  assert.deepEqual(report.adjacentSupportEvidence.directActivePluginsMutationRefusal.rppIds, [
    'RPP-0472',
    'RPP-0492',
  ]);
  assert.equal(report.adjacentSupportEvidence.directActivePluginsMutationRefusal.productionBacked, false);
  assert.equal(report.adjacentSupportEvidence.directActivePluginsMutationRefusal.releaseEligible, false);
  assert.equal(
    report.adjacentSupportEvidence.directActivePluginsMutationRefusal.candidateSignal,
    'direct-active-plugins-writes-refused-before-mutation',
  );
});

test('RPP-0815 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0815 activation hook topology progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawActivationHookValuesIncluded, false);
  assert.equal(report.redaction.urlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);

  for (const needle of rawNeedles) {
    assert.equal(text.includes(needle), false, `RPP-0815 evidence leaked raw activation hook fixture ${needle}`);
  }
  assert.doesNotMatch(text, /https?:\/\//i);
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0815 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function buildActivationHookBoundarySignals() {
  const boundary = productionPluginDriverBoundary;
  const remoteBaseSnapshot = productionPluginDriverSnapshot('base', 1, 'base');
  const localEditedSnapshot = productionPluginDriverSnapshot('local-update', 2, 'local-update');
  const remoteChangedSnapshot = productionPluginDriverSnapshot('remote-changed', 3, 'remote-changed');
  const releasePlan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });

  const unprovenPlan = cloneJson(releasePlan);
  addActivationHookSideEffectMutation(unprovenPlan, { withDriverProof: false });
  const unprovenSummary = summarizeProductionPluginDriverBoundaryProof({
    proof: productionPluginDriverProof(unprovenPlan, boundary),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });

  const driverProofedPlan = cloneJson(releasePlan);
  addActivationHookSideEffectMutation(driverProofedPlan, { withDriverProof: true });
  const driverProofedSummary = summarizeProductionPluginDriverBoundaryProof({
    proof: productionPluginDriverProof(driverProofedPlan, boundary),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });

  assert.equal(unprovenSummary.status, 'blocked');
  assert.equal(driverProofedSummary.status, 'blocked');

  return {
    unprovenStatus: unprovenSummary.activationHookEffects.status,
    unprovenVerdict: unprovenSummary.activationHookEffects.verdict,
    unprovenResourceKeys: unprovenSummary.activationHookEffects.unprovenResourceKeys,
    driverProofedStatus: driverProofedSummary.activationHookEffects.status,
    driverProofedVerdict: driverProofedSummary.activationHookEffects.verdict,
    driverProofedSupportOnly: driverProofedSummary.activationHookEffects.supportOnly,
    driverProofedReleaseEligible: driverProofedSummary.activationHookEffects.releaseEligible,
    driverProofedResourceKeys: driverProofedSummary.activationHookEffects.supportOnlyResourceKeys,
  };
}

function productionPluginDriverSnapshot(mode, version, marker) {
  return {
    files: {},
    plugins: {},
    db: {
      wp_reprint_push_release_state: {
        'state_id:1': {
          state_id: 1,
          payload: {
            owner: productionPluginDriverBoundary.owner,
            mode,
            version,
            releaseBoundaryProof: 'plugin-driver-boundary',
          },
          updated_marker: marker,
          __pluginOwner: productionPluginDriverBoundary.owner,
        },
      },
    },
    meta: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: productionPluginDriverBoundary.resourceKey,
            pluginOwner: productionPluginDriverBoundary.owner,
            driver: productionPluginDriverBoundary.driver,
            table: productionPluginDriverBoundary.table,
            supportsDelete: false,
          },
        ],
      },
    },
  };
}

function productionPluginDriverProof(plan, boundary = productionPluginDriverBoundary) {
  return {
    planObject: plan,
    dryRun: {
      status: 200,
      receiptHash: 'a'.repeat(64),
    },
    apply: {
      status: 200,
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        verifiedResourceKeys: [boundary.resourceKey],
        planHash: digest(plan),
        receiptHash: 'a'.repeat(64),
        preconditionSetHash: 'b'.repeat(64),
        mutationSetHash: 'c'.repeat(64),
      },
    },
    recoveryInspect: {
      status: 200,
    },
    replay: {
      status: 200,
    },
    dbJournal: {
      rows: 2,
      applyCommitted: true,
      mutationApplied: 1,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
      },
    },
    latestReadRetryEvidence: {
      path: '/snapshot',
      preservedRemote: true,
    },
  };
}

function addActivationHookSideEffectMutation(plan, { withDriverProof }) {
  plan.mutations.push({
    id: `mutation-activation-hook-side-effect-${plan.mutations.length + 1}`,
    resourceKey: activationHookSideEffectResourceKey,
    resource: {
      type: 'row',
      table: 'wp_options',
      id: 'option_name:reprint_push_activation_hook_state',
      key: activationHookSideEffectResourceKey,
    },
    action: 'put',
    value: {
      value: {
        option_name: 'reprint_push_activation_hook_state',
        option_value: {
          mode: withDriverProof
            ? 'rpp-0815-driver-proofed-private-hook-state'
            : 'rpp-0815-unproven-private-hook-state',
        },
        autoload: 'no',
        __pluginOwner: productionPluginDriverBoundary.owner,
        __activationHookEffect: true,
      },
    },
    remoteBeforeHash: '0'.repeat(64),
    baseHash: '0'.repeat(64),
    localHash: withDriverProof ? '2'.repeat(64) : '1'.repeat(64),
    pluginOwnedResource: {
      pluginOwner: productionPluginDriverBoundary.owner,
      driver: 'wp-option',
      policySource: 'rpp-0815-activation-hook-side-effect-proof',
      supportsDelete: false,
      activationHookEffect: true,
      ...(withDriverProof ? {
        driverEvidence: {
          supported: true,
          activationHookEffect: true,
          source: 'live-remote',
          plugin: productionPluginDriverBoundary.owner,
          resourceKey: `plugin:${productionPluginDriverBoundary.owner}`,
          baseHash: 'a'.repeat(64),
          remoteHash: 'a'.repeat(64),
        },
      } : {}),
    },
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
