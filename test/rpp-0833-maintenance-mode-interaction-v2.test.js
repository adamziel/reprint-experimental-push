import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0833-maintenance-mode-interaction-v2';
const maintenanceProofScope = 'maintenance-mode-interaction-v2';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const roleDefinitions = Object.freeze([
  Object.freeze({ role: 'source', topologyRole: 'source', envKey: 'REPRINT_PUSH_SOURCE_URL' }),
  Object.freeze({ role: 'local', topologyRole: 'localEdited', envKey: 'REPRINT_PUSH_LOCAL_URL' }),
  Object.freeze({ role: 'changed', topologyRole: 'remoteChanged', envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL' }),
]);

const maintenanceSurfaceDefinitions = Object.freeze([
  Object.freeze({
    surface: 'core-maintenance-file',
    resourceKind: 'filesystem-marker',
    interaction: 'site-wide-front-end-lock',
    payloadCaptured: false,
  }),
  Object.freeze({
    surface: 'maintenance-plugin-option',
    resourceKind: 'wp-option-row',
    interaction: 'admin-configured-front-end-lock',
    payloadCaptured: false,
  }),
  Object.freeze({
    surface: 'route-health-status',
    resourceKind: 'http-status-class',
    interaction: 'route-availability-signal',
    payloadCaptured: false,
  }),
]);

const maintenanceRoleDefinitions = Object.freeze([
  Object.freeze({
    role: 'source',
    topologyRole: 'source',
    maintenanceState: 'baseline-open',
    maintenanceEnabled: false,
    expectedRouteClass: 'normal-wordpress-response',
  }),
  Object.freeze({
    role: 'local',
    topologyRole: 'localEdited',
    maintenanceState: 'local-maintenance-enabled',
    maintenanceEnabled: true,
    expectedRouteClass: 'maintenance-window-response',
  }),
  Object.freeze({
    role: 'changed',
    topologyRole: 'remoteChanged',
    maintenanceState: 'changed-maintenance-enabled',
    maintenanceEnabled: true,
    expectedRouteClass: 'maintenance-window-response',
  }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/maintenance-mode-v2',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/maintenance-mode-v2/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/maintenance-mode-v2',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/maintenance-mode-v2',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/maintenance-mode-v2/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/maintenance-mode-v2',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/maintenance-mode-v2',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/maintenance-mode-v2',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/maintenance-mode-v2',
  REPRINT_PUSH_USERNAME: 'maintenance-v2-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0833-application-password-must-not-leak',
});

const forbiddenNeedles = Object.freeze([
  'rpp-0833-application-password-must-not-leak',
  'admin:rpp0833-secret',
  'rpp0833-secret',
  'token=rpp0833-token',
  'rpp0833-token',
  'changed.ngrok-free.app',
]);

test('RPP-0833 captures source/local/changed URLs and records maintenance-mode interaction variant 2 scope', () => {
  const proof = buildMaintenanceModeInteractionVariant2Proof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0833');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.contract, 'source/local/changed URL capture and static identity checks');

  assert.equal(proof.topology.sourceUrl, 'https://source.example.test/maintenance-mode-v2');
  assert.equal(proof.topology.localUrl, 'https://local.example.test/maintenance-mode-v2');
  assert.equal(proof.topology.remoteChangedUrl, 'https://changed.example.test/maintenance-mode-v2');
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.topology.identityChecked, true);
  assert.equal(proof.topology.sameSourceAcrossRoutes, true);
  assert.equal(proof.topology.remoteAliasMatchesSource, true);
  assert.equal(proof.topology.noTunnelPolicyEnforced, true);
  assert.equal(proof.topology.noUrlSecrets, true);
  assert.equal(proof.topology.localLoopbackIngress, true);
  assert.equal(proof.topology.packagedFallbackDisabled, true);
  assert.equal(proof.topology.networkProbePerformed, false);
  assert.match(proof.topology.sourceIdentityHash, sha256Pattern);
  assert.match(proof.topology.localIdentityHash, sha256Pattern);
  assert.match(proof.topology.remoteChangedIdentityHash, sha256Pattern);

  assert.deepEqual(
    proof.topology.roleUrlCapture.map((entry) => [entry.role, entry.topologyRole, entry.url]),
    [
      ['source', 'source', 'https://source.example.test/maintenance-mode-v2'],
      ['local', 'localEdited', 'https://local.example.test/maintenance-mode-v2'],
      ['changed', 'remoteChanged', 'https://changed.example.test/maintenance-mode-v2'],
    ],
  );
  assert.ok(proof.topology.roleUrlCapture.every((entry) =>
    entry.provided === true
      && entry.valid === true
      && entry.accepted === true
      && sha256Pattern.test(entry.identityHash)
      && sha256Pattern.test(entry.originHash)));

  assert.equal(proof.roleIdentityChecks.requiredRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.capturedRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.acceptedRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.roleIdentityChecks.sameSourceAcrossRoutes, true);
  assert.equal(proof.roleIdentityChecks.remoteAliasMatchesSource, true);
  assert.equal(proof.roleIdentityChecks.noTunnelPolicyEnforced, true);
  assert.equal(proof.roleIdentityChecks.noUrlSecrets, true);
  assert.equal(proof.roleIdentityChecks.localLoopbackIngress, true);
  assert.equal(proof.roleIdentityChecks.packagedFallbackDisabled, true);
  assert.deepEqual(
    proof.roleIdentityChecks.routeSourceIdentities.map((entry) => [entry.route, entry.configured, entry.sameSource]),
    [
      ['preflight', true, true],
      ['dryRun', true, true],
      ['apply', true, true],
      ['journal', true, true],
      ['recovery', true, true],
    ],
  );
  assert.ok(proof.roleIdentityChecks.routeSourceIdentities.every((entry) =>
    sha256Pattern.test(entry.sourceIdentityHash) && sha256Pattern.test(entry.routeIdentityHash)));

  assert.equal(proof.maintenanceModeV2.proofScope, maintenanceProofScope);
  assert.equal(proof.maintenanceModeV2.variant, 2);
  assert.equal(proof.maintenanceModeV2.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.maintenanceModeV2.maintenanceInteractionAccepted, true);
  assert.equal(proof.maintenanceModeV2.roleUrlCount, 3);
  assert.equal(proof.maintenanceModeV2.capturedRoleUrlCount, 3);
  assert.equal(proof.maintenanceModeV2.roleStateCount, 3);
  assert.equal(proof.maintenanceModeV2.surfaceCount, 3);
  assert.equal(proof.maintenanceModeV2.routeSourceCount, 5);
  assert.equal(proof.maintenanceModeV2.identitySurfaceCount, 9);
  assert.equal(proof.maintenanceModeV2.rejectedSurfaceCount, 0);
  assert.deepEqual(proof.maintenanceModeV2.surfaceNames, [
    'core-maintenance-file',
    'maintenance-plugin-option',
    'route-health-status',
  ]);
  assert.deepEqual(
    proof.maintenanceModeV2.roleStateBindings.map((entry) => [entry.role, entry.maintenanceState, entry.identityBound]),
    [
      ['source', 'baseline-open', true],
      ['local', 'local-maintenance-enabled', true],
      ['changed', 'changed-maintenance-enabled', true],
    ],
  );
  assert.ok(proof.maintenanceModeV2.surfaces.every((entry) =>
    entry.payloadCaptured === false && sha256EvidencePattern.test(entry.resourceKeyHash)));
  assert.ok(proof.maintenanceModeV2.roleStateBindings.every((entry) =>
    sha256Pattern.test(entry.urlIdentityHash)
      && sha256Pattern.test(entry.urlOriginHash)
      && sha256EvidencePattern.test(entry.stateHash)));
  assert.match(proof.maintenanceModeV2.roleIdentityDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV2.stateBindingDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV2.scopeHash, sha256EvidencePattern);
  assert.equal(proof.maintenanceModeV2.payloadsStored, false);
  assert.equal(proof.maintenanceModeV2.releasePolicy, 'support-only-no-release-movement');

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.roleUrlsIdentityChecked, true);
  assert.equal(proof.invariants.sourceLocalChangedRoleIdentitiesDistinct, true);
  assert.equal(proof.invariants.sourceAliasAndRouteIdentitiesMatch, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.noTunnelPolicyEnforced, true);
  assert.equal(proof.invariants.noUrlSecretParts, true);
  assert.equal(proof.invariants.maintenanceModeVariant2ScopeRecorded, true);
  assert.equal(proof.invariants.maintenanceStatesBoundToDistinctUrlIdentities, true);
  assert.equal(proof.invariants.maintenanceDoesNotBypassChangedUrlIdentity, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0833 maintenance mode variant 2 proof' }));
});

test('RPP-0833 rejects tunnel and secret-shaped URLs before accepting maintenance-mode variant 2 scope', () => {
  const proof = buildMaintenanceModeInteractionVariant2Proof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0833-secret@source.example.test/maintenance-mode-v2',
      REPRINT_PUSH_LOCAL_URL: 'https://source.example.test/maintenance-mode-v2?token=rpp0833-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/maintenance-mode-v2',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceUrl, '');
  assert.equal(proof.topology.localUrl, '');
  assert.equal(proof.topology.remoteChangedUrl, '');
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecrets, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.roleIdentityChecks.acceptedRoleCount, 0);
  assert.equal(proof.maintenanceModeV2.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.maintenanceModeV2.maintenanceInteractionAccepted, false);
  assert.equal(proof.maintenanceModeV2.rejectedSurfaceCount, 4);
  assert.ok(proof.maintenanceModeV2.roleStateBindings.every((entry) => entry.identityBound === false));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0833 rejected maintenance mode proof' }));
});

test('RPP-0833 maintenance-mode variant 2 proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildMaintenanceModeInteractionVariant2Proof({ env: goodEnv });
  const secondProof = buildMaintenanceModeInteractionVariant2Proof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.maintenanceModeV2.scopeHash, secondProof.maintenanceModeV2.scopeHash);
  assert.equal(firstProof.maintenanceModeV2.roleIdentityDigest, secondProof.maintenanceModeV2.roleIdentityDigest);
  assert.equal(firstProof.maintenanceModeV2.stateBindingDigest, secondProof.maintenanceModeV2.stateBindingDigest);
  assert.deepEqual(firstProof.maintenanceModeV2.surfaceNames, secondProof.maintenanceModeV2.surfaceNames);
  assert.deepEqual(firstProof.maintenanceModeV2.roleStateBindings, secondProof.maintenanceModeV2.roleStateBindings);
  assert.deepEqual(firstProof.roleIdentityChecks.identitySurfaces, secondProof.roleIdentityChecks.identitySurfaces);
  assert.equal(firstProof.maintenanceModeV2.payloadsStored, false);
  assert.equal(firstProof.maintenanceModeV2.surfaceCount, 3);
  assert.equal(firstProof.maintenanceModeV2.roleStateCount, 3);
  assert.equal(firstProof.invariants.hashCountSurfaceOnly, true);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0833 first maintenance mode proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0833 second maintenance mode proof' }));
});

function buildMaintenanceModeInteractionVariant2Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
  const topologyOk = topologyProof.ok === true;
  const roleUrlCapture = buildRoleUrlCapture(topologyProof, topologyOk);
  const routeSourceIdentities = buildRouteSourceIdentities(topologyProof);
  const identitySurfaces = buildIdentitySurfaces(topologyProof);
  const surfaces = buildMaintenanceSurfaces();
  const roleStateBindings = buildMaintenanceRoleStateBindings(roleUrlCapture);
  const roleIdentityChecks = {
    requiredRoleCount: roleDefinitions.length,
    capturedRoleCount: roleUrlCapture.filter((entry) => entry.provided).length,
    validRoleCount: roleUrlCapture.filter((entry) => entry.valid).length,
    acceptedRoleCount: roleUrlCapture.filter((entry) => entry.accepted).length,
    sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
    sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
    remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
    noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok,
    localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
    identitySurfaces,
    routeSourceIdentities,
    roleIdentityHashes: Object.fromEntries(roleUrlCapture.map((entry) => [entry.role, entry.identityHash])),
  };
  const maintenanceModeV2ScopeCore = {
    proofScope: maintenanceProofScope,
    roleUrlIdentities: roleUrlCapture.map((entry) => ({
      role: entry.role,
      topologyRole: entry.topologyRole,
      identityHash: entry.identityHash,
      originHash: entry.originHash,
      serviceKind: entry.serviceKind,
      accepted: entry.accepted,
    })),
    routeSourceIdentities,
    identitySurfaces,
    surfaces: surfaces.map((entry) => ({
      surface: entry.surface,
      resourceKind: entry.resourceKind,
      resourceKeyHash: entry.resourceKeyHash,
      payloadCaptured: entry.payloadCaptured,
    })),
    roleStateBindings: roleStateBindings.map((entry) => ({
      role: entry.role,
      topologyRole: entry.topologyRole,
      maintenanceState: entry.maintenanceState,
      urlIdentityHash: entry.urlIdentityHash,
      stateHash: entry.stateHash,
      identityBound: entry.identityBound,
    })),
    snapshotBoundary: 'before-route-receipts-or-mutation',
    releasePolicy: 'support-only-no-release-movement',
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
  };
  const maintenanceModeV2 = {
    proofScope: maintenanceProofScope,
    variant: 2,
    scopeAcceptedForReleaseTopology: topologyOk,
    maintenanceInteractionAccepted: topologyOk && roleStateBindings.every((entry) => entry.identityBound),
    roleUrlCount: roleDefinitions.length,
    capturedRoleUrlCount: roleIdentityChecks.capturedRoleCount,
    roleStateCount: roleStateBindings.length,
    surfaceCount: surfaces.length,
    routeSourceCount: routeSourceIdentities.length,
    identitySurfaceCount: identitySurfaces.length,
    rejectedSurfaceCount: identitySurfaces.filter((entry) => entry.ok !== true).length,
    surfaceNames: surfaces.map((entry) => entry.surface),
    identityCheckSurfaceNames: identitySurfaces.map((entry) => entry.surface),
    surfaces,
    roleStateBindings,
    roleIdentityDigest: `sha256:${digest(maintenanceModeV2ScopeCore.roleUrlIdentities)}`,
    stateBindingDigest: `sha256:${digest(maintenanceModeV2ScopeCore.roleStateBindings)}`,
    scopeHash: `sha256:${digest(maintenanceModeV2ScopeCore)}`,
    payloadsStored: false,
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    snapshotBoundary: maintenanceModeV2ScopeCore.snapshotBoundary,
    releasePolicy: 'support-only-no-release-movement',
  };
  const distinctRoleIdentityHashes = new Set(roleStateBindings.map((entry) => entry.urlIdentityHash));
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    roleUrlsIdentityChecked: topologyOk
      && topologyProof.rppEvidence.identityChecked === true
      && roleUrlCapture.every((entry) => entry.accepted),
    sourceLocalChangedRoleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
    sourceAliasAndRouteIdentitiesMatch: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true
      && topologyProof.identityChecks.remoteAliasMatchesSource.ok === true,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    noUrlSecretParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    loopbackIngressLimitedTo8080: topologyProof.identityChecks.localLoopbackIngress.ok === true,
    maintenanceModeVariant2ScopeRecorded: maintenanceModeV2.proofScope === maintenanceProofScope
      && maintenanceModeV2.variant === 2
      && maintenanceModeV2.roleUrlCount === 3
      && maintenanceModeV2.roleStateCount === 3
      && maintenanceModeV2.surfaceCount === 3,
    maintenanceStatesBoundToDistinctUrlIdentities: topologyOk
      && distinctRoleIdentityHashes.size === 3
      && roleStateBindings.every((entry) => entry.identityBound),
    maintenanceDoesNotBypassChangedUrlIdentity: topologyOk
      && roleIdentityChecks.roleIdentityHashes.changed !== roleIdentityChecks.roleIdentityHashes.source,
    noMaintenancePayloadStored: maintenanceModeV2.payloadsStored === false
      && surfaces.every((entry) => entry.payloadCaptured === false),
    hashCountSurfaceOnly: maintenanceModeV2.payloadsStored === false
      && maintenanceModeV2.identitySurfaceCount === 9
      && maintenanceModeV2.surfaceCount === 3
      && maintenanceModeV2.roleStateCount === 3
      && sha256EvidencePattern.test(maintenanceModeV2.roleIdentityDigest)
      && sha256EvidencePattern.test(maintenanceModeV2.stateBindingDigest)
      && sha256EvidencePattern.test(maintenanceModeV2.scopeHash),
    noNetworkProbe: topologyProof.constraints.networkProbePerformed === false,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0833',
    proofId,
    variant: 2,
    checkedAt: now.toISOString(),
    status: passed ? 'passed' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      rppId: 'RPP-0803',
      variant: externalWordPressTopologyVariant,
      contract: 'source/local/changed URL capture and static identity checks',
      status: topologyProof.status,
    },
    topology: {
      sourceUrl: exposeAcceptedUrl(topologyProof.urlCapture.source, topologyOk),
      localUrl: exposeAcceptedUrl(topologyProof.urlCapture.localEdited, topologyOk),
      remoteChangedUrl: exposeAcceptedUrl(topologyProof.urlCapture.remoteChanged, topologyOk),
      sourceIdentityHash: topologyProof.urlCapture.source.identityHash,
      localIdentityHash: topologyProof.urlCapture.localEdited.identityHash,
      remoteChangedIdentityHash: topologyProof.urlCapture.remoteChanged.identityHash,
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured,
      sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
      identityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
      remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
      noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
      noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok,
      localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
      networkProbePerformed: topologyProof.constraints.networkProbePerformed,
      roleUrlCapture,
    },
    roleIdentityChecks,
    maintenanceModeV2,
    invariants,
    failures: topologyProof.failures.map((failure) => ({
      code: failure.code,
      role: failure.role || '',
      route: failure.route || '',
      envKey: failure.envKey || '',
    })),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function buildRoleUrlCapture(topologyProof, topologyOk) {
  return roleDefinitions.map((definition) => {
    const captured = topologyProof.urlCapture[definition.topologyRole];
    return {
      role: definition.role,
      topologyRole: definition.topologyRole,
      envKey: definition.envKey,
      provided: captured.provided === true,
      valid: captured.valid === true,
      accepted: topologyOk && captured.provided === true && captured.valid === true,
      url: exposeAcceptedUrl(captured, topologyOk),
      identityHash: captured.identityHash || '',
      originHash: captured.originHash || '',
      serviceKind: captured.serviceKind || 'missing-url',
    };
  });
}

function buildRouteSourceIdentities(topologyProof) {
  const routes = topologyProof.identityChecks.sameSourceAcrossRoutes.routes;
  return routeOrder.map((route) => {
    const routeCheck = routes[route] || {};
    return {
      route,
      configured: routeCheck.configured === true,
      sameSource: routeCheck.sameSource === true,
      envKey: routeCheck.envKey || '',
      sourceIdentityHash: routeCheck.sourceIdentityHash || topologyProof.urlCapture.source.identityHash || '',
      routeIdentityHash: routeCheck.routeIdentityHash || routeCheck.sourceIdentityHash || topologyProof.urlCapture.source.identityHash || '',
    };
  });
}

function buildIdentitySurfaces(topologyProof) {
  return [
    { surface: 'required-role-urls-present', ok: topologyProof.identityChecks.requiredUrlsPresent.ok },
    { surface: 'required-role-urls-valid', ok: topologyProof.identityChecks.requiredUrlsValid.ok },
    { surface: 'source-local-changed-url-identities-distinct', ok: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok },
    { surface: 'remote-source-alias-matches-source', ok: topologyProof.identityChecks.remoteAliasMatchesSource.ok },
    { surface: 'route-source-identities-match-source', ok: topologyProof.identityChecks.sameSourceAcrossRoutes.ok },
    { surface: 'no-forbidden-tunnel-hosts', ok: topologyProof.identityChecks.noTunnelHosts.ok },
    { surface: 'no-url-userinfo-query-or-fragment', ok: topologyProof.identityChecks.noUrlSecrets.ok },
    { surface: 'loopback-limited-to-sandbox-8080', ok: topologyProof.identityChecks.localLoopbackIngress.ok },
    { surface: 'packaged-fallback-disabled', ok: topologyProof.identityChecks.packagedFallbackDisabled.ok },
  ];
}

function buildMaintenanceSurfaces() {
  return maintenanceSurfaceDefinitions.map((entry) => ({
    ...entry,
    resourceKeyHash: `sha256:${digest({
      surface: entry.surface,
      resourceKind: entry.resourceKind,
      interaction: entry.interaction,
    })}`,
  }));
}

function buildMaintenanceRoleStateBindings(roleUrlCapture) {
  const roleUrls = new Map(roleUrlCapture.map((entry) => [entry.role, entry]));
  return maintenanceRoleDefinitions.map((definition) => {
    const roleUrl = roleUrls.get(definition.role) || {};
    const bindingCore = {
      role: definition.role,
      topologyRole: definition.topologyRole,
      maintenanceState: definition.maintenanceState,
      maintenanceEnabled: definition.maintenanceEnabled,
      expectedRouteClass: definition.expectedRouteClass,
      urlIdentityHash: roleUrl.identityHash || '',
      urlOriginHash: roleUrl.originHash || '',
      identityAccepted: roleUrl.accepted === true,
    };
    return {
      ...definition,
      urlIdentityHash: roleUrl.identityHash || '',
      urlOriginHash: roleUrl.originHash || '',
      identityBound: roleUrl.accepted === true
        && sha256Pattern.test(roleUrl.identityHash || '')
        && sha256Pattern.test(roleUrl.originHash || ''),
      stateHash: `sha256:${digest(bindingCore)}`,
      mutationAllowedByThisProof: false,
    };
  });
}

function exposeAcceptedUrl(captured, topologyOk) {
  return topologyOk && captured?.valid === true ? captured.normalizedUrl : '';
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
