import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  directActivePluginsMutationRefusalBoundary,
  pluginActivationDependencyReleaseVerifierBoundary,
  productionPluginDriverBoundary,
  summarizeDirectActivePluginsMutationRefusalReleaseVerifierProof,
  summarizePluginActivationDependencyReleaseVerifierProof,
  summarizeProductionPluginDriverBoundaryProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0895-plugin-activation-hooks-topology-v5.md',
);
const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const activePluginsResourceKey = 'row:["wp_options","option_name:active_plugins"]';
const activationHookSideEffectResourceKey =
  'row:["wp_options","option_name:reprint_push_activation_hook_state"]';
const rawNeedles = Object.freeze([
  'rpp-0895-unproven-private-hook-state',
  'rpp-0895-driver-proofed-private-hook-state',
  'rpp-0489-private-dependency-build',
  'rpp-0489-private-dependency-token',
  'rpp0492-private',
  'option_value',
  'register_activation_hook(__FILE__',
]);

test('RPP-0895 progress report records candidate versus release-ready activation hook scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0895');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'activation-hook-topology-candidate-v5');
  assert.equal(report.candidateScope.sourcePattern, 'rpp-0875-candidate-scope');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.productionMovementRecorded, false);
  assert.equal(report.candidateScope.rawActivationHookValuesIncluded, false);
  assert.deepEqual(report.candidateScope.candidateClaims, [
    'activation-hook-surfaces-recorded',
    'dependency-boundary-linked',
    'direct-active-plugins-refusal-linked',
    'unproven-side-effects-blocked',
    'driver-proofed-side-effects-quarantined-as-support-only',
    'release-ready-gaps-recorded',
  ]);

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.deepEqual(report.releaseReadyScope.productionMovement, {
    candidatePercentMovement: 'none',
    releaseReadyPercentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-bound-wordpress-activate-plugin-run'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('activation-hook-side-effect-inventory-production-backed'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('no-production-bound-activation-run'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('driver-proofed-side-effects-are-support-only'),
  );
  assert.equal(
    report.releaseReadyScope.readyWhen,
    'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true',
  );

  assert.match(report.scopeComparisonHash, sha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0895 activation-hook surfaces are deterministic surface/count/hash evidence', () => {
  const { report } = loadProgressReport();
  const { surfaces, surfaceHash } = buildActivationHookSurfaces();

  assert.equal(report.activationHookSurfaces.format, 'surface-count-hash-only');
  assert.equal(report.activationHookSurfaces.rawValuesIncluded, false);
  assert.equal(report.activationHookSurfaces.surfaceCount, surfaces.length);
  assert.deepEqual(report.activationHookSurfaces.surfaces, surfaces);
  assert.equal(report.activationHookSurfaces.surfaceHash, surfaceHash);
  assert.match(report.activationHookSurfaces.surfaceHash, sha256EvidencePattern);

  assert.deepEqual(
    report.activationHookSurfaces.surfaces.map((entry) => entry.surface),
    [
      'wordpress-plugin-api-activation',
      'register-activation-hook-entrypoint',
      'plugin-state-resource',
      'direct-active-plugins-row',
      'plugin-owned-activation-data-row',
      'activation-hook-side-effect-row',
      'release-state-driver-row',
    ],
  );
});

test('RPP-0895 dependency and side-effect boundaries match existing guardrails', () => {
  const { report } = loadProgressReport();
  const expectedBoundaries = buildDependencyAndSideEffectBoundaries();

  assert.deepEqual(report.dependencyAndSideEffectBoundaries, expectedBoundaries);

  assert.equal(report.dependencyAndSideEffectBoundaries.dependencyBoundary.status, 'support_only');
  assert.equal(
    report.dependencyAndSideEffectBoundaries.dependencyBoundary.verdict,
    'PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED',
  );
  assert.equal(report.dependencyAndSideEffectBoundaries.dependencyBoundary.staleDependencyPreMutationRefused, true);
  assert.equal(report.dependencyAndSideEffectBoundaries.dependencyBoundary.productionBacked, false);
  assert.equal(report.dependencyAndSideEffectBoundaries.dependencyBoundary.releaseEligible, false);

  assert.equal(report.dependencyAndSideEffectBoundaries.sideEffectBoundary.unproven.status, 'blocked');
  assert.equal(
    report.dependencyAndSideEffectBoundaries.sideEffectBoundary.unproven.verdict,
    'ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED',
  );
  assert.equal(report.dependencyAndSideEffectBoundaries.sideEffectBoundary.driverProofed.status, 'quarantined');
  assert.equal(
    report.dependencyAndSideEffectBoundaries.sideEffectBoundary.driverProofed.verdict,
    'ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY',
  );
  assert.equal(report.dependencyAndSideEffectBoundaries.sideEffectBoundary.driverProofed.supportOnly, true);
  assert.equal(report.dependencyAndSideEffectBoundaries.sideEffectBoundary.driverProofed.releaseEligible, false);
});

test('RPP-0895 existing activation-hook guardrails stay support-only and no-go', () => {
  const { report } = loadProgressReport();
  const expectedGuardrails = buildExistingActivationHookGuardrails();

  assert.deepEqual(report.existingActivationHookGuardrails, expectedGuardrails);
  assert.equal(report.existingActivationHookGuardrails.guardrailCount, expectedGuardrails.guardrails.length);
  assert.equal(report.existingActivationHookGuardrails.productionBacked, false);
  assert.equal(report.existingActivationHookGuardrails.releaseEligible, false);
  assert.equal(report.existingActivationHookGuardrails.releaseGate, 'NO-GO');
  assert.match(report.existingActivationHookGuardrails.guardrailHash, sha256EvidencePattern);

  const byName = Object.fromEntries(
    report.existingActivationHookGuardrails.guardrails.map((entry) => [entry.guardrail, entry]),
  );
  assert.equal(byName['direct-active-plugins-mutation-refusal'].status, 'support_only');
  assert.equal(byName['plugin-driver-active-plugins-direct-mutation-rejection'].status, 'blocked');
  assert.equal(byName['activation-hook-side-effect-driver-proof-required'].status, 'blocked');
  assert.equal(byName['driver-proofed-activation-hook-side-effect-quarantine'].status, 'quarantined');
});

test('RPP-0895 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0895 activation hook topology progress report' }));
  assert.deepEqual(report.redaction, {
    format: 'hash-count-surface-only',
    rawActivationHookValuesIncluded: false,
    urlValuesIncluded: false,
    credentialMaterialIncluded: false,
    scopeComparisonHashCovers: [
      'candidateScope',
      'releaseReadyScope',
      'activationHookSurfaces',
      'dependencyAndSideEffectBoundaries',
      'existingActivationHookGuardrails',
      'integrationRecommendation',
    ],
  });

  for (const needle of rawNeedles) {
    assert.equal(text.includes(needle), false, `RPP-0895 evidence leaked raw fixture value ${needle}`);
  }
  assert.doesNotMatch(text, /https?:\/\//i);
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0895 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    activationHookSurfaces: report.activationHookSurfaces,
    dependencyAndSideEffectBoundaries: report.dependencyAndSideEffectBoundaries,
    existingActivationHookGuardrails: report.existingActivationHookGuardrails,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function buildActivationHookSurfaces() {
  const dependencyProof = summarizePluginActivationDependencyReleaseVerifierProof({ now: fixedNow });
  const surfaces = [
    {
      surface: 'wordpress-plugin-api-activation',
      status: 'required-not-observed',
      productionBacked: false,
      releaseEligible: false,
    },
    {
      surface: 'register-activation-hook-entrypoint',
      status: 'required-not-audited',
      productionBacked: false,
      releaseEligible: false,
    },
    {
      surface: 'plugin-state-resource',
      resourceKey: pluginActivationDependencyReleaseVerifierBoundary.dependentResourceKey,
      status: 'dependency-preflighted-candidate',
      sourceRpp: 'RPP-0489',
      productionBacked: dependencyProof.productionBacked,
      releaseEligible: dependencyProof.releaseEligible,
    },
    {
      surface: 'direct-active-plugins-row',
      resourceKey: directActivePluginsMutationRefusalBoundary.resourceKey,
      requiredDriver: directActivePluginsMutationRefusalBoundary.driver,
      status: 'refused-before-mutation',
      sourceRpp: 'RPP-0492',
      productionBacked: false,
      releaseEligible: false,
    },
    {
      surface: 'plugin-owned-activation-data-row',
      resourceKey: pluginActivationDependencyReleaseVerifierBoundary.dataResourceKey,
      driver: pluginActivationDependencyReleaseVerifierBoundary.driver,
      status: 'hash-only-support',
      sourceRpp: 'RPP-0489',
      productionBacked: dependencyProof.productionBacked,
      releaseEligible: dependencyProof.releaseEligible,
    },
    {
      surface: 'activation-hook-side-effect-row',
      resourceKey: activationHookSideEffectResourceKey,
      driver: 'wp-option',
      status: 'blocked-or-quarantined-support-only',
      productionBacked: false,
      releaseEligible: false,
    },
    {
      surface: 'release-state-driver-row',
      resourceKey: productionPluginDriverBoundary.resourceKey,
      driver: productionPluginDriverBoundary.driver,
      status: 'control-boundary-only',
      productionBacked: false,
      releaseEligible: false,
    },
  ];

  return {
    surfaces,
    surfaceHash: sha256Evidence(surfaces),
  };
}

function buildDependencyAndSideEffectBoundaries() {
  const dependencyProof = summarizePluginActivationDependencyReleaseVerifierProof({ now: fixedNow });
  const activationHookBoundary = buildActivationHookBoundarySignals();

  return {
    dependencyBoundary: {
      rppIds: ['RPP-0449', 'RPP-0489'],
      evidenceScope: 'local-plugin-driver-support',
      status: dependencyProof.status,
      verdict: dependencyProof.verdict,
      productionBacked: dependencyProof.productionBacked,
      releaseEligible: dependencyProof.releaseEligible,
      releaseGate: dependencyProof.releaseGate,
      dependencyPluginResourceKey: pluginActivationDependencyReleaseVerifierBoundary.dependencyResourceKey,
      dependentPluginResourceKey: pluginActivationDependencyReleaseVerifierBoundary.dependentResourceKey,
      pluginOwnedDataResourceKey: pluginActivationDependencyReleaseVerifierBoundary.dataResourceKey,
      atomicGroupKind: dependencyProof.atomicGroup.kind,
      mutationCount: dependencyProof.atomicGroup.mutationCount,
      dependencyCount: dependencyProof.atomicGroup.dependencyCount,
      dependencyRequirementSource: dependencyProof.dependencyRequirement.source,
      dependencyRequirementHash: dependencyProof.dependencyRequirement.requirementHash,
      staleDependencyPreMutationRefused: dependencyProof.staleDependencyRefusal.preMutation,
      staleDependencyCode: dependencyProof.staleDependencyRefusal.code,
      dependencyPluginPreserved: dependencyProof.staleDependencyRefusal.dependencyPluginPreserved,
      dependentPluginPreserved: dependencyProof.staleDependencyRefusal.dependentPluginPreserved,
      targetUnchanged: dependencyProof.staleDependencyRefusal.targetUnchanged,
      proofHash: dependencyProof.proofHash,
    },
    sideEffectBoundary: activationHookBoundary,
  };
}

function buildExistingActivationHookGuardrails() {
  const directActivePluginsProof = summarizeDirectActivePluginsMutationRefusalReleaseVerifierProof({ now: fixedNow });
  const dependencyProof = summarizePluginActivationDependencyReleaseVerifierProof({ now: fixedNow });
  const activationHookBoundary = buildActivationHookBoundarySignals();
  const activePluginsSummary = buildActivePluginsDirectMutationSummary();

  const guardrails = [
    {
      guardrail: 'activation-dependency-preflight',
      sourceRpp: 'RPP-0489',
      status: dependencyProof.status,
      verdict: dependencyProof.verdict,
      releaseGate: dependencyProof.releaseGate,
      staleDependencyPreMutationRefused: dependencyProof.staleDependencyRefusal.preMutation,
      productionBacked: dependencyProof.productionBacked,
      releaseEligible: dependencyProof.releaseEligible,
    },
    {
      guardrail: 'direct-active-plugins-mutation-refusal',
      sourceRpp: 'RPP-0492',
      status: directActivePluginsProof.status,
      verdict: directActivePluginsProof.verdict,
      releaseGate: directActivePluginsProof.releaseGate,
      resourceKey: directActivePluginsMutationRefusalBoundary.resourceKey,
      requiredDriver: directActivePluginsMutationRefusalBoundary.driver,
      supportedVariants: directActivePluginsProof.releaseVerifier.supportedVariants,
      unsupportedVariants: directActivePluginsProof.releaseVerifier.unsupportedVariants,
      failClosedUnsupportedVariants: directActivePluginsProof.releaseVerifier.failClosedUnsupportedVariants,
      productionBacked: directActivePluginsProof.productionBacked,
      releaseEligible: directActivePluginsProof.releaseEligible,
    },
    {
      guardrail: 'plugin-driver-active-plugins-direct-mutation-rejection',
      sourceRpp: 'production-shaped-proof',
      status: activePluginsSummary.status,
      verdict: activePluginsSummary.verdict,
      resourceKeys: activePluginsSummary.ownershipBoundary.activePluginsDirectResourceKeys,
      noActivePluginsDirectMutation: activePluginsSummary.noActivePluginsDirectMutation,
      releaseEligible: false,
    },
    {
      guardrail: 'activation-hook-side-effect-driver-proof-required',
      sourceRpp: 'production-shaped-proof',
      status: activationHookBoundary.unproven.status,
      verdict: activationHookBoundary.unproven.verdict,
      resourceKeys: activationHookBoundary.unproven.resourceKeys,
      productionBacked: false,
      releaseEligible: activationHookBoundary.unproven.releaseEligible,
    },
    {
      guardrail: 'driver-proofed-activation-hook-side-effect-quarantine',
      sourceRpp: 'production-shaped-proof',
      status: activationHookBoundary.driverProofed.status,
      verdict: activationHookBoundary.driverProofed.verdict,
      resourceKeys: activationHookBoundary.driverProofed.resourceKeys,
      supportOnly: activationHookBoundary.driverProofed.supportOnly,
      productionBacked: false,
      releaseEligible: activationHookBoundary.driverProofed.releaseEligible,
    },
  ];

  return {
    evidenceScope: 'local-support-only',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    guardrailCount: guardrails.length,
    guardrails,
    guardrailHash: sha256Evidence(guardrails),
  };
}

function buildActivationHookBoundarySignals() {
  const cleanSummary = buildCleanPluginDriverBoundarySummary();
  const unprovenSummary = buildActivationHookSideEffectSummary({ withDriverProof: false });
  const driverProofedSummary = buildActivationHookSideEffectSummary({ withDriverProof: true });

  return {
    evidenceScope: 'production-shaped-local-boundary-summary',
    productionBacked: false,
    releaseEligible: false,
    resourceKey: activationHookSideEffectResourceKey,
    cleanBoundary: {
      status: cleanSummary.status,
      verdict: cleanSummary.verdict,
      noActivationHookSideEffectMutation: cleanSummary.noActivationHookSideEffectMutation,
      activationHookStatus: cleanSummary.activationHookEffects.status,
      releaseEligible: cleanSummary.activationHookEffects.releaseEligible,
    },
    unproven: {
      status: unprovenSummary.activationHookEffects.status,
      verdict: unprovenSummary.activationHookEffects.verdict,
      supportOnly: unprovenSummary.activationHookEffects.supportOnly,
      releaseEligible: unprovenSummary.activationHookEffects.releaseEligible,
      resourceCount: unprovenSummary.activationHookEffects.resourceKeys.length,
      resourceKeys: unprovenSummary.activationHookEffects.unprovenResourceKeys,
    },
    driverProofed: {
      status: driverProofedSummary.activationHookEffects.status,
      verdict: driverProofedSummary.activationHookEffects.verdict,
      supportOnly: driverProofedSummary.activationHookEffects.supportOnly,
      releaseEligible: driverProofedSummary.activationHookEffects.releaseEligible,
      resourceCount: driverProofedSummary.activationHookEffects.supportOnlyResourceKeys.length,
      resourceKeys: driverProofedSummary.activationHookEffects.supportOnlyResourceKeys,
      explicitDriverProof: driverProofedSummary.activationHookEffects.effects[0].explicitDriverProof,
      driverEvidenceSupported:
        driverProofedSummary.activationHookEffects.effects[0].driverEvidence.supported,
    },
  };
}

function buildCleanPluginDriverBoundarySummary() {
  const remoteBaseSnapshot = productionPluginDriverSnapshot('base', 1, 'base');
  const localEditedSnapshot = productionPluginDriverSnapshot('local-update', 2, 'local-update');
  const remoteChangedSnapshot = productionPluginDriverSnapshot('remote-changed', 3, 'remote-changed');
  const plan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });

  return summarizeProductionPluginDriverBoundaryProof({
    proof: productionPluginDriverProof(plan),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });
}

function buildActivePluginsDirectMutationSummary() {
  const remoteBaseSnapshot = productionPluginDriverSnapshot('base', 1, 'base');
  const localEditedSnapshot = productionPluginDriverSnapshot('local-update', 2, 'local-update');
  const remoteChangedSnapshot = productionPluginDriverSnapshot('remote-changed', 3, 'remote-changed');
  const plan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });
  plan.mutations.push({
    id: 'mutation-rpp-0895-active-plugins-direct',
    resourceKey: activePluginsResourceKey,
    resource: {
      type: 'row',
      table: 'wp_options',
      id: 'option_name:active_plugins',
      key: activePluginsResourceKey,
    },
    action: 'update',
  });

  return summarizeProductionPluginDriverBoundaryProof({
    proof: productionPluginDriverProof(plan),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });
}

function buildActivationHookSideEffectSummary({ withDriverProof }) {
  const remoteBaseSnapshot = productionPluginDriverSnapshot('base', 1, 'base');
  const localEditedSnapshot = productionPluginDriverSnapshot('local-update', 2, 'local-update');
  const remoteChangedSnapshot = productionPluginDriverSnapshot('remote-changed', 3, 'remote-changed');
  const plan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });
  addActivationHookSideEffectMutation(plan, { withDriverProof });

  return summarizeProductionPluginDriverBoundaryProof({
    proof: productionPluginDriverProof(plan),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });
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
    id: `mutation-rpp-0895-activation-hook-side-effect-${plan.mutations.length + 1}`,
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
            ? 'rpp-0895-driver-proofed-private-hook-state'
            : 'rpp-0895-unproven-private-hook-state',
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
      policySource: 'rpp-0895-activation-hook-side-effect-proof',
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

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}
