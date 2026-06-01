import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0873-maintenance-mode-interaction-v4';
const maintenanceProofScope = 'maintenance-mode-interaction-v4';
const successCriterion = 'source/local/changed URLs are captured and identity-checked';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const roleDefinitions = Object.freeze([
  Object.freeze({ role: 'source', topologyRole: 'source' }),
  Object.freeze({ role: 'local', topologyRole: 'localEdited' }),
  Object.freeze({ role: 'changed', topologyRole: 'remoteChanged' }),
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
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/maintenance-mode-v4',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/maintenance-mode-v4/',
  REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8080/maintenance-mode-v4-local',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/maintenance-mode-v4',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/maintenance-mode-v4/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/maintenance-mode-v4',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/maintenance-mode-v4',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/maintenance-mode-v4',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/maintenance-mode-v4',
  REPRINT_PUSH_USERNAME: 'maintenance-v4-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0873-application-password-must-not-leak',
});

const forbiddenNeedles = Object.freeze([
  'https://',
  'http://',
  'source.example.test',
  'changed.example.test',
  'changed.ngrok-free.app',
  'ngrok-free.app',
  '127.0.0.1',
  'localhost',
  'admin:rpp0873-secret',
  'rpp0873-secret',
  'token=rpp0873-token',
  'rpp0873-token',
  'rpp0873-fragment',
  'rpp-0873-application-password-must-not-leak',
]);

test('RPP-0873 captures source/local/changed URL identities and records maintenance-mode interaction variant 4 scope', () => {
  const proof = buildMaintenanceModeInteractionVariant4Proof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0873');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.variant3Pattern, 'RPP-0853');
  assert.equal(proof.builtOn.variant2Pattern, 'RPP-0833');
  assert.equal(proof.builtOn.variant1Pattern, 'RPP-0813');
  assert.equal(proof.builtOn.validator.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.validator.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.contract, 'source/local/changed URL capture and maintenance-mode identity binding regression proof');

  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesIdentityChecked, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.topology.identityChecked, true);
  assert.equal(proof.topology.sameSourceAcrossRoutes, true);
  assert.equal(proof.topology.remoteAliasMatchesSource, true);
  assert.equal(proof.topology.noTunnelPolicyEnforced, true);
  assert.equal(proof.topology.noUrlSecretParts, true);
  assert.equal(proof.topology.localLoopbackIngress, true);
  assert.equal(proof.topology.packagedFallbackDisabled, true);
  assert.equal(proof.topology.networkProbePerformed, false);
  assert.equal(proof.topology.rawUrlValuesStored, false);
  assert.equal(proof.topology.hostnameValuesStored, false);
  assert.equal(proof.topology.rejectedRawInputsStored, false);

  assert.deepEqual(
    proof.roleIdentities.map((entry) => [entry.role, entry.topologyRole, entry.serviceSurface]),
    [
      ['source', 'source', 'external-https-wordpress'],
      ['local', 'localEdited', 'sandbox-loopback-8080-wordpress'],
      ['changed', 'remoteChanged', 'external-https-wordpress'],
    ],
  );
  assert.ok(proof.roleIdentities.every((entry) =>
    entry.provided === true
      && entry.valid === true
      && entry.accepted === true
      && sha256Pattern.test(entry.identityHash)
      && sha256Pattern.test(entry.originHash)));
  assert.equal(new Set(proof.roleIdentities.map((entry) => entry.identityHash)).size, 3);

  assert.equal(proof.roleIdentityChecks.requiredRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.capturedRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.validRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.acceptedRoleCount, 3);
  assert.equal(proof.roleIdentityChecks.distinctRoleIdentityCount, 3);
  assert.equal(proof.roleIdentityChecks.sourceLocalChangedUrlIdentitiesCaptured, true);
  assert.equal(proof.roleIdentityChecks.sourceLocalChangedUrlIdentitiesIdentityChecked, true);
  assert.equal(proof.roleIdentityChecks.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.roleIdentityChecks.sameSourceAcrossRoutes, true);
  assert.equal(proof.roleIdentityChecks.routeSourceBindingsIdentityChecked, true);
  assert.equal(proof.roleIdentityChecks.remoteAliasMatchesSource, true);
  assert.equal(proof.roleIdentityChecks.noTunnelPolicyEnforced, true);
  assert.equal(proof.roleIdentityChecks.noUrlSecretParts, true);
  assert.equal(proof.roleIdentityChecks.localLoopbackIngress, true);
  assert.equal(proof.roleIdentityChecks.packagedFallbackDisabled, true);
  assert.deepEqual(
    proof.roleIdentityChecks.routeSourceBindings.map((entry) => [entry.route, entry.configured, entry.sameSource]),
    [
      ['preflight', true, true],
      ['dryRun', true, true],
      ['apply', true, true],
      ['journal', true, true],
      ['recovery', true, true],
    ],
  );
  assert.ok(proof.roleIdentityChecks.routeSourceBindings.every((entry) =>
    sha256Pattern.test(entry.sourceIdentityHash)
      && sha256Pattern.test(entry.routeIdentityHash)
      && entry.sourceIdentityHash === entry.routeIdentityHash));

  assert.equal(proof.maintenanceModeV4.proofScope, maintenanceProofScope);
  assert.equal(proof.maintenanceModeV4.variant, 4);
  assert.equal(proof.maintenanceModeV4.successCriterion, successCriterion);
  assert.equal(proof.maintenanceModeV4.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.maintenanceModeV4.roleUrlsAccepted, true);
  assert.equal(proof.maintenanceModeV4.maintenanceInteractionAccepted, true);
  assert.deepEqual(proof.maintenanceModeV4.capturedIdentityRoles, ['source', 'local', 'changed']);
  assert.equal(proof.maintenanceModeV4.sourceLocalChangedIdentitiesCaptured, true);
  assert.equal(proof.maintenanceModeV4.sourceLocalChangedIdentitiesIdentityChecked, true);
  assert.equal(proof.maintenanceModeV4.routeSourceBindingsIdentityChecked, true);
  assert.equal(proof.maintenanceModeV4.sourceLocalChangedIdentityCount, 3);
  assert.equal(proof.maintenanceModeV4.roleIdentityCount, 3);
  assert.equal(proof.maintenanceModeV4.distinctRoleIdentityCount, 3);
  assert.equal(proof.maintenanceModeV4.routeSourceCount, 5);
  assert.equal(proof.maintenanceModeV4.configuredRouteSourceCount, 5);
  assert.equal(proof.maintenanceModeV4.maintenanceRoleStateCount, 3);
  assert.equal(proof.maintenanceModeV4.maintenanceSurfaceCount, 3);
  assert.equal(proof.maintenanceModeV4.identitySurfaceCount, 12);
  assert.equal(proof.maintenanceModeV4.rejectedSurfaceCount, 0);
  assert.deepEqual(proof.maintenanceModeV4.surfaceNames, [
    'required-role-urls-present',
    'required-role-urls-valid',
    'source-local-changed-url-identities-captured',
    'source-local-changed-url-identities-distinct',
    'remote-source-alias-matches-source',
    'route-source-identities-match-source',
    'no-forbidden-tunnel-hosts',
    'no-url-userinfo-query-or-fragment',
    'loopback-limited-to-sandbox-8080',
    'packaged-fallback-disabled',
    'maintenance-state-bindings-identity-bound',
    'redacted-hash-count-surface-only',
  ]);
  assert.deepEqual(proof.maintenanceModeV4.maintenanceSurfaceNames, [
    'core-maintenance-file',
    'maintenance-plugin-option',
    'route-health-status',
  ]);
  assert.deepEqual(
    proof.maintenanceModeV4.roleStateBindings.map((entry) => [entry.role, entry.maintenanceState, entry.identityBound]),
    [
      ['source', 'baseline-open', true],
      ['local', 'local-maintenance-enabled', true],
      ['changed', 'changed-maintenance-enabled', true],
    ],
  );
  assert.ok(proof.maintenanceModeV4.maintenanceSurfaces.every((entry) =>
    entry.payloadCaptured === false && sha256EvidencePattern.test(entry.resourceKeyHash)));
  assert.ok(proof.maintenanceModeV4.roleStateBindings.every((entry) =>
    sha256Pattern.test(entry.urlIdentityHash)
      && sha256Pattern.test(entry.urlOriginHash)
      && sha256EvidencePattern.test(entry.stateHash)));
  assert.match(proof.maintenanceModeV4.roleIdentityDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.routeIdentityDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.maintenanceSurfaceDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.stateBindingDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.surfaceDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.policyDigest, sha256EvidencePattern);
  assert.match(proof.maintenanceModeV4.scopeHash, sha256EvidencePattern);
  assert.equal(proof.maintenanceModeV4.payloadsStored, false);
  assert.equal(proof.maintenanceModeV4.rawUrlValuesStored, false);
  assert.equal(proof.maintenanceModeV4.hostnameValuesStored, false);
  assert.equal(proof.maintenanceModeV4.rejectedRawInputsStored, false);
  assert.equal(proof.maintenanceModeV4.releasePolicy, 'support-only-no-release-movement');

  assert.equal(proof.localOnlyPolicy.sandboxIngressPort, 8080);
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.remoteTunnelsAllowed, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackAllowed, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackObserved, false);
  assert.equal(proof.localOnlyPolicy.networkProbePerformed, false);

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.sourceLocalChangedUrlIdentitiesCaptured, true);
  assert.equal(proof.invariants.roleUrlsIdentityChecked, true);
  assert.equal(proof.invariants.sourceLocalChangedRoleIdentitiesDistinct, true);
  assert.equal(proof.invariants.perRouteSourceIdentityBound, true);
  assert.equal(proof.invariants.maintenanceModeVariant4ScopeRecorded, true);
  assert.equal(proof.invariants.maintenanceStatesBoundToDistinctUrlIdentities, true);
  assert.equal(proof.invariants.maintenanceDoesNotBypassChangedUrlIdentity, true);
  assert.equal(proof.invariants.rejectsTunnelUrls, true);
  assert.equal(proof.invariants.rejectsSecretShapedUrlParts, true);
  assert.equal(proof.invariants.rejectsDuplicateRoleUrlIdentities, true);
  assert.equal(proof.invariants.loopbackIngressLimitedToSandbox8080, true);
  assert.equal(proof.invariants.packagedFallbackDisabled, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertRedactedMaintenanceProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0873 maintenance mode variant 4 proof' }));
});

test('RPP-0873 rejects tunnel, secret-shaped, duplicate, and packaged fallback inputs before accepting variant 4 scope', () => {
  const proof = buildMaintenanceModeInteractionVariant4Proof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0873-secret@source.example.test/maintenance-mode-v4',
      REPRINT_PUSH_LOCAL_URL: 'https://source.example.test/maintenance-mode-v4?token=rpp0873-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/maintenance-mode-v4#rpp0873-fragment',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesIdentityChecked, false);
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecretParts, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.topology.rawUrlValuesStored, false);
  assert.equal(proof.maintenanceModeV4.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.maintenanceModeV4.roleUrlsAccepted, false);
  assert.equal(proof.maintenanceModeV4.maintenanceInteractionAccepted, false);
  assert.equal(proof.maintenanceModeV4.rejectedSurfaceCount, 5);
  assert.equal(proof.maintenanceModeV4.rawUrlValuesStored, false);
  assert.equal(proof.maintenanceModeV4.hostnameValuesStored, false);
  assert.equal(proof.maintenanceModeV4.rejectedRawInputsStored, false);
  assert.ok(proof.maintenanceModeV4.roleStateBindings.every((entry) => entry.identityBound === false));
  assert.deepEqual(
    proof.maintenanceModeV4.rejectedSurfaceNames,
    [
      'source-local-changed-url-identities-distinct',
      'no-forbidden-tunnel-hosts',
      'no-url-userinfo-query-or-fragment',
      'packaged-fallback-disabled',
      'maintenance-state-bindings-identity-bound',
    ],
  );
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertRedactedMaintenanceProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0873 rejected maintenance mode proof' }));
});

test('RPP-0873 maintenance-mode variant 4 proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildMaintenanceModeInteractionVariant4Proof({ env: goodEnv });
  const secondProof = buildMaintenanceModeInteractionVariant4Proof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.maintenanceModeV4.scopeHash, secondProof.maintenanceModeV4.scopeHash);
  assert.equal(firstProof.maintenanceModeV4.roleIdentityDigest, secondProof.maintenanceModeV4.roleIdentityDigest);
  assert.equal(firstProof.maintenanceModeV4.routeIdentityDigest, secondProof.maintenanceModeV4.routeIdentityDigest);
  assert.equal(firstProof.maintenanceModeV4.maintenanceSurfaceDigest, secondProof.maintenanceModeV4.maintenanceSurfaceDigest);
  assert.equal(firstProof.maintenanceModeV4.stateBindingDigest, secondProof.maintenanceModeV4.stateBindingDigest);
  assert.equal(firstProof.maintenanceModeV4.surfaceDigest, secondProof.maintenanceModeV4.surfaceDigest);
  assert.deepEqual(firstProof.roleIdentities, secondProof.roleIdentities);
  assert.deepEqual(firstProof.roleIdentityChecks.routeSourceBindings, secondProof.roleIdentityChecks.routeSourceBindings);
  assert.deepEqual(firstProof.roleIdentityChecks.identitySurfaces, secondProof.roleIdentityChecks.identitySurfaces);
  assert.deepEqual(firstProof.maintenanceModeV4.maintenanceSurfaces, secondProof.maintenanceModeV4.maintenanceSurfaces);
  assert.deepEqual(firstProof.maintenanceModeV4.roleStateBindings, secondProof.maintenanceModeV4.roleStateBindings);
  assert.equal(firstProof.maintenanceModeV4.payloadsStored, false);
  assert.equal(firstProof.maintenanceModeV4.rawUrlValuesStored, false);
  assert.equal(firstProof.maintenanceModeV4.hostnameValuesStored, false);
  assert.equal(firstProof.maintenanceModeV4.rejectedRawInputsStored, false);
  assert.equal(firstProof.maintenanceModeV4.identitySurfaceCount, 12);
  assert.equal(firstProof.maintenanceModeV4.maintenanceSurfaceCount, 3);
  assert.equal(firstProof.maintenanceModeV4.maintenanceRoleStateCount, 3);
  assert.equal(firstProof.invariants.hashCountSurfaceOnly, true);
  assertRedactedMaintenanceProof(firstProof);
  assertRedactedMaintenanceProof(secondProof);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0873 first maintenance mode proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0873 second maintenance mode proof' }));
});

function buildMaintenanceModeInteractionVariant4Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
  const topologyOk = topologyProof.ok === true;
  const roleIdentities = buildRoleIdentities(topologyProof, topologyOk);
  const routeSourceBindings = buildRouteSourceBindings(topologyProof);
  const sourceLocalChangedUrlIdentitiesCaptured = roleIdentities.every((entry) =>
    entry.provided === true
      && entry.valid === true
      && sha256Pattern.test(entry.identityHash)
      && sha256Pattern.test(entry.originHash));
  const sourceLocalChangedUrlIdentitiesIdentityChecked = topologyOk
    && sourceLocalChangedUrlIdentitiesCaptured
    && topologyProof.rppEvidence.identityChecked === true;
  const routeSourceBindingsIdentityChecked = topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true
    && routeSourceBindings.length === routeOrder.length
    && routeSourceBindings.every((entry) => entry.sameSource === true);
  const maintenanceSurfaces = buildMaintenanceSurfaces();
  const roleStateBindings = buildMaintenanceRoleStateBindings(roleIdentities);
  const maintenanceStatesIdentityBound = topologyOk && roleStateBindings.every((entry) => entry.identityBound);
  const identitySurfaces = buildIdentitySurfaces(topologyProof, {
    sourceLocalChangedUrlIdentitiesCaptured,
    maintenanceStatesIdentityBound,
  });
  const rejectedSurfaceNames = identitySurfaces
    .filter((entry) => entry.ok !== true)
    .map((entry) => entry.surface);
  const distinctRoleIdentityCount = new Set(roleIdentities
    .map((entry) => entry.identityHash)
    .filter(Boolean)).size;
  const localOnlyPolicy = {
    sandboxIngressPort: 8080,
    onlySandbox8080Ingress: topologyProof.identityChecks.localLoopbackIngress.ok === true,
    remoteTunnelsAllowed: false,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
    packagedFallbackAllowed: false,
    packagedFallbackObserved: topologyProof.identityChecks.packagedFallbackDisabled.ok !== true,
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
  };
  const roleIdentityScope = roleIdentities.map((entry) => ({
    role: entry.role,
    topologyRole: entry.topologyRole,
    provided: entry.provided,
    valid: entry.valid,
    accepted: entry.accepted,
    identityHash: entry.identityHash,
    originHash: entry.originHash,
    serviceSurface: entry.serviceSurface,
  }));
  const routeIdentityScope = routeSourceBindings.map((entry) => ({
    route: entry.route,
    configured: entry.configured,
    sameSource: entry.sameSource,
    sourceIdentityHash: entry.sourceIdentityHash,
    routeIdentityHash: entry.routeIdentityHash,
    bindingSurface: entry.bindingSurface,
  }));
  const maintenanceSurfaceScope = maintenanceSurfaces.map((entry) => ({
    surface: entry.surface,
    resourceKind: entry.resourceKind,
    resourceKeyHash: entry.resourceKeyHash,
    payloadCaptured: entry.payloadCaptured,
  }));
  const stateBindingScope = roleStateBindings.map((entry) => ({
    role: entry.role,
    topologyRole: entry.topologyRole,
    maintenanceState: entry.maintenanceState,
    urlIdentityHash: entry.urlIdentityHash,
    urlOriginHash: entry.urlOriginHash,
    stateHash: entry.stateHash,
    identityBound: entry.identityBound,
  }));
  const maintenanceModeV4ScopeCore = {
    proofScope: maintenanceProofScope,
    successCriterion,
    roleIdentityScope,
    routeIdentityScope,
    identitySurfaces,
    maintenanceSurfaceScope,
    stateBindingScope,
    localOnlyPolicy,
    snapshotBoundary: 'before-route-receipts-or-mutation',
    releasePolicy: 'support-only-no-release-movement',
    redactionPolicy: {
      payloadsStored: false,
      rawUrlValuesStored: false,
      hostnameValuesStored: false,
      rejectedRawInputsStored: false,
    },
  };
  const maintenanceModeV4 = {
    proofScope: maintenanceProofScope,
    variant: 4,
    successCriterion,
    scopeAcceptedForReleaseTopology: topologyOk,
    roleUrlsAccepted: topologyOk && roleIdentities.every((entry) => entry.accepted),
    maintenanceInteractionAccepted: maintenanceStatesIdentityBound,
    capturedIdentityRoles: roleIdentities.filter((entry) => entry.provided && entry.valid).map((entry) => entry.role),
    sourceLocalChangedIdentitiesCaptured: sourceLocalChangedUrlIdentitiesCaptured,
    sourceLocalChangedIdentitiesIdentityChecked: sourceLocalChangedUrlIdentitiesIdentityChecked,
    routeSourceBindingsIdentityChecked,
    sourceLocalChangedIdentityCount: roleIdentities.filter((entry) =>
      entry.provided === true
        && entry.valid === true
        && sha256Pattern.test(entry.identityHash)).length,
    roleIdentityCount: roleIdentities.length,
    capturedRoleIdentityCount: roleIdentities.filter((entry) => entry.provided).length,
    validRoleIdentityCount: roleIdentities.filter((entry) => entry.valid).length,
    acceptedRoleIdentityCount: roleIdentities.filter((entry) => entry.accepted).length,
    distinctRoleIdentityCount,
    routeSourceCount: routeSourceBindings.length,
    configuredRouteSourceCount: routeSourceBindings.filter((entry) => entry.configured).length,
    maintenanceRoleStateCount: roleStateBindings.length,
    maintenanceSurfaceCount: maintenanceSurfaces.length,
    identitySurfaceCount: identitySurfaces.length,
    acceptedSurfaceCount: identitySurfaces.filter((entry) => entry.ok === true).length,
    rejectedSurfaceCount: rejectedSurfaceNames.length,
    surfaceNames: identitySurfaces.map((entry) => entry.surface),
    rejectedSurfaceNames,
    maintenanceSurfaceNames: maintenanceSurfaces.map((entry) => entry.surface),
    maintenanceSurfaces,
    roleStateBindings,
    roleIdentityDigest: `sha256:${digest(roleIdentityScope)}`,
    routeIdentityDigest: `sha256:${digest(routeIdentityScope)}`,
    maintenanceSurfaceDigest: `sha256:${digest(maintenanceSurfaceScope)}`,
    stateBindingDigest: `sha256:${digest(stateBindingScope)}`,
    surfaceDigest: `sha256:${digest(identitySurfaces)}`,
    policyDigest: `sha256:${digest(localOnlyPolicy)}`,
    scopeHash: `sha256:${digest(maintenanceModeV4ScopeCore)}`,
    payloadsStored: false,
    rawUrlValuesStored: false,
    hostnameValuesStored: false,
    rejectedRawInputsStored: false,
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    snapshotBoundary: maintenanceModeV4ScopeCore.snapshotBoundary,
    releasePolicy: 'support-only-no-release-movement',
  };
  const roleIdentityChecks = {
    requiredRoleCount: roleDefinitions.length,
    capturedRoleCount: maintenanceModeV4.capturedRoleIdentityCount,
    validRoleCount: maintenanceModeV4.validRoleIdentityCount,
    acceptedRoleCount: maintenanceModeV4.acceptedRoleIdentityCount,
    distinctRoleIdentityCount,
    sourceLocalChangedUrlIdentitiesCaptured,
    sourceLocalChangedUrlIdentitiesIdentityChecked,
    sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
    sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
    routeSourceBindingsIdentityChecked,
    remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
    noUrlSecretParts: topologyProof.identityChecks.noUrlSecrets.ok,
    localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
    maintenanceStatesIdentityBound,
    roleIdentityHashes: Object.fromEntries(roleIdentities.map((entry) => [entry.role, entry.identityHash])),
    routeSourceBindings,
    identitySurfaces,
  };
  const distinctStateBindingHashes = new Set(roleStateBindings
    .map((entry) => entry.urlIdentityHash)
    .filter(Boolean));
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    sourceLocalChangedUrlIdentitiesCaptured,
    roleUrlsIdentityChecked: topologyOk
      && topologyProof.rppEvidence.identityChecked === true
      && roleIdentities.every((entry) => entry.accepted),
    sourceLocalChangedRoleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true
      && distinctRoleIdentityCount === 3,
    perRouteSourceIdentityBound: routeSourceBindingsIdentityChecked,
    maintenanceModeVariant4ScopeRecorded: maintenanceModeV4.proofScope === maintenanceProofScope
      && maintenanceModeV4.variant === 4
      && maintenanceModeV4.successCriterion === successCriterion
      && maintenanceModeV4.roleIdentityCount === 3
      && maintenanceModeV4.maintenanceRoleStateCount === 3
      && maintenanceModeV4.maintenanceSurfaceCount === 3,
    maintenanceStatesBoundToDistinctUrlIdentities: topologyOk
      && distinctStateBindingHashes.size === 3
      && roleStateBindings.every((entry) => entry.identityBound),
    maintenanceDoesNotBypassChangedUrlIdentity: topologyOk
      && roleIdentityChecks.roleIdentityHashes.changed !== roleIdentityChecks.roleIdentityHashes.source,
    rejectsTunnelUrls: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    rejectsSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    rejectsDuplicateRoleUrlIdentities: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
    loopbackIngressLimitedToSandbox8080: topologyProof.identityChecks.localLoopbackIngress.ok === true
      && localOnlyPolicy.sandboxIngressPort === 8080,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true
      && localOnlyPolicy.packagedFallbackAllowed === false,
    noMaintenancePayloadStored: maintenanceModeV4.payloadsStored === false
      && maintenanceSurfaces.every((entry) => entry.payloadCaptured === false),
    hashCountSurfaceOnly: maintenanceModeV4.payloadsStored === false
      && maintenanceModeV4.rawUrlValuesStored === false
      && maintenanceModeV4.hostnameValuesStored === false
      && maintenanceModeV4.rejectedRawInputsStored === false
      && maintenanceModeV4.identitySurfaceCount === 12
      && maintenanceModeV4.maintenanceSurfaceCount === 3
      && maintenanceModeV4.maintenanceRoleStateCount === 3
      && sha256EvidencePattern.test(maintenanceModeV4.scopeHash)
      && roleIdentities.every((entry) => sha256Pattern.test(entry.identityHash) && sha256Pattern.test(entry.originHash)),
    noNetworkProbe: topologyProof.constraints.networkProbePerformed === false,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0873',
    proofId,
    variant: 4,
    checkedAt: now.toISOString(),
    status: passed ? 'passed' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      variant3Pattern: 'RPP-0853',
      variant2Pattern: 'RPP-0833',
      variant1Pattern: 'RPP-0813',
      validator: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        status: topologyProof.status,
      },
      contract: 'source/local/changed URL capture and maintenance-mode identity binding regression proof',
    },
    topology: {
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured,
      sourceLocalChangedUrlIdentitiesCaptured,
      sourceLocalChangedUrlIdentitiesIdentityChecked,
      sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
      identityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
      remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
      noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
      noUrlSecretParts: topologyProof.identityChecks.noUrlSecrets.ok,
      localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
      networkProbePerformed: topologyProof.constraints.networkProbePerformed,
      rawUrlValuesStored: false,
      hostnameValuesStored: false,
      rejectedRawInputsStored: false,
    },
    roleIdentities,
    roleIdentityChecks,
    maintenanceModeV4,
    localOnlyPolicy,
    invariants,
    failures: sanitizeFailures(topologyProof.failures),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function buildRoleIdentities(topologyProof, topologyOk) {
  return roleDefinitions.map((definition) => {
    const captured = topologyProof.urlCapture[definition.topologyRole];
    return {
      role: definition.role,
      topologyRole: definition.topologyRole,
      provided: captured.provided === true,
      valid: captured.valid === true,
      accepted: topologyOk && captured.provided === true && captured.valid === true,
      identityHash: captured.identityHash || '',
      originHash: captured.originHash || '',
      serviceSurface: redactedServiceSurface(captured),
    };
  });
}

function buildRouteSourceBindings(topologyProof) {
  const routes = topologyProof.identityChecks.sameSourceAcrossRoutes.routes;
  return routeOrder.map((route) => {
    const routeCheck = routes[route] || {};
    const configured = routeCheck.configured === true;
    const sameSource = routeCheck.sameSource === true;
    const sourceIdentityHash = routeCheck.sourceIdentityHash || topologyProof.urlCapture.source.identityHash || '';
    const routeIdentityHash = routeCheck.routeIdentityHash || routeCheck.sourceIdentityHash || topologyProof.urlCapture.source.identityHash || '';
    return {
      route,
      configured,
      sameSource,
      sourceIdentityHash,
      routeIdentityHash,
      bindingSurface: configured ? (sameSource ? 'bound-to-source-identity' : 'source-identity-drift') : 'inherits-source-identity',
    };
  });
}

function buildIdentitySurfaces(topologyProof, {
  sourceLocalChangedUrlIdentitiesCaptured,
  maintenanceStatesIdentityBound,
}) {
  return [
    { surface: 'required-role-urls-present', ok: topologyProof.identityChecks.requiredUrlsPresent.ok },
    { surface: 'required-role-urls-valid', ok: topologyProof.identityChecks.requiredUrlsValid.ok },
    { surface: 'source-local-changed-url-identities-captured', ok: sourceLocalChangedUrlIdentitiesCaptured },
    { surface: 'source-local-changed-url-identities-distinct', ok: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok },
    { surface: 'remote-source-alias-matches-source', ok: topologyProof.identityChecks.remoteAliasMatchesSource.ok },
    { surface: 'route-source-identities-match-source', ok: topologyProof.identityChecks.sameSourceAcrossRoutes.ok },
    { surface: 'no-forbidden-tunnel-hosts', ok: topologyProof.identityChecks.noTunnelHosts.ok },
    { surface: 'no-url-userinfo-query-or-fragment', ok: topologyProof.identityChecks.noUrlSecrets.ok },
    { surface: 'loopback-limited-to-sandbox-8080', ok: topologyProof.identityChecks.localLoopbackIngress.ok },
    { surface: 'packaged-fallback-disabled', ok: topologyProof.identityChecks.packagedFallbackDisabled.ok },
    { surface: 'maintenance-state-bindings-identity-bound', ok: maintenanceStatesIdentityBound },
    { surface: 'redacted-hash-count-surface-only', ok: true },
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

function buildMaintenanceRoleStateBindings(roleIdentities) {
  const roleUrls = new Map(roleIdentities.map((entry) => [entry.role, entry]));
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

function redactedServiceSurface(captured) {
  if (!captured?.provided) {
    return 'missing-url-role';
  }
  if (captured.valid !== true) {
    return 'invalid-url-role';
  }
  if (captured.forbiddenTunnel) {
    return 'forbidden-remote-tunnel';
  }
  if (captured.loopback) {
    return captured.loopbackAllowed ? 'sandbox-loopback-8080-wordpress' : 'loopback-outside-sandbox-8080';
  }
  return captured.protocol === 'https' ? 'external-https-wordpress' : 'external-http-wordpress';
}

function sanitizeFailures(failures) {
  return failures.map((failure) => ({
    code: failure.code,
    role: failure.role || '',
    route: failure.route || '',
    surface: failureSurface(failure.code),
  })).sort((left, right) =>
    `${left.code}:${left.role}:${left.route}`.localeCompare(`${right.code}:${right.role}:${right.route}`));
}

function failureSurface(code) {
  if (code === 'SAME_SOURCE_IDENTITY_REQUIRED' || code === 'REPRINT_PUSH_SOURCE_URL_MISMATCH') {
    return 'route-source-identities-match-source';
  }
  if (code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED') {
    return 'no-forbidden-tunnel-hosts';
  }
  if (code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS') {
    return 'no-url-userinfo-query-or-fragment';
  }
  if (code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080') {
    return 'loopback-limited-to-sandbox-8080';
  }
  if (code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED') {
    return 'packaged-fallback-disabled';
  }
  if (code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT') {
    return 'source-local-changed-url-identities-distinct';
  }
  return 'required-role-urls-valid';
}

function assertRedactedMaintenanceProof(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /[a-z0-9-]+\.(?:example|test|app|io|me|net|run|life)\b/i);
  assert.doesNotMatch(serialized, /\b(?:localhost|127\.\d+\.\d+\.\d+)\b/i);
  assert.doesNotMatch(serialized, /(?:[?&][a-z0-9_-]+=|@[^/]+)/i);
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
