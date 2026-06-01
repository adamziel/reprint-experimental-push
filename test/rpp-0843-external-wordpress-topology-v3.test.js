import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0843-external-wordpress-topology-v3';
const topologyProofScope = 'external-wordpress-topology-v3';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const roleDefinitions = Object.freeze([
  Object.freeze({ role: 'source', topologyRole: 'source' }),
  Object.freeze({ role: 'localEdited', topologyRole: 'localEdited' }),
  Object.freeze({ role: 'remoteChanged', topologyRole: 'remoteChanged' }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/external-topology-v3',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/external-topology-v3/',
  REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8080/external-topology-v3-local',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/external-topology-v3',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/external-topology-v3/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/external-topology-v3',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/external-topology-v3',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/external-topology-v3',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/external-topology-v3',
  REPRINT_PUSH_USERNAME: 'topology-v3-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0843-application-password-must-not-leak',
});

const forbiddenNeedles = Object.freeze([
  'https://',
  'http://',
  'source.example.test',
  'local.example.test',
  'changed.example.test',
  'changed.ngrok-free.app',
  'ngrok-free.app',
  '127.0.0.1',
  'localhost',
  'admin:rpp0843-secret',
  'rpp0843-secret',
  'token=rpp0843-token',
  'rpp0843-token',
  'rpp-0843-application-password-must-not-leak',
  '8081',
  '8082',
]);

test('RPP-0843 captures and identity-checks redacted external WordPress topology variant 3 roles', () => {
  const proof = buildExternalTopologyVariant3Proof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0843');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.variant2Pattern, 'RPP-0823');
  assert.equal(proof.builtOn.validator.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.validator.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.contract, 'redacted source/local/changed URL identity proof');

  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
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
      ['localEdited', 'localEdited', 'sandbox-loopback-8080-wordpress'],
      ['remoteChanged', 'remoteChanged', 'external-https-wordpress'],
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
  assert.equal(proof.roleIdentityChecks.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.roleIdentityChecks.sameSourceAcrossRoutes, true);
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

  assert.equal(proof.externalTopologyV3.proofScope, topologyProofScope);
  assert.equal(proof.externalTopologyV3.variant, 3);
  assert.equal(proof.externalTopologyV3.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.externalTopologyV3.roleUrlsAccepted, true);
  assert.equal(proof.externalTopologyV3.roleIdentityCount, 3);
  assert.equal(proof.externalTopologyV3.distinctRoleIdentityCount, 3);
  assert.equal(proof.externalTopologyV3.routeSourceCount, 5);
  assert.equal(proof.externalTopologyV3.configuredRouteSourceCount, 5);
  assert.equal(proof.externalTopologyV3.identitySurfaceCount, 10);
  assert.equal(proof.externalTopologyV3.rejectedSurfaceCount, 0);
  assert.deepEqual(proof.externalTopologyV3.surfaceNames, [
    'required-role-urls-present',
    'required-role-urls-valid',
    'source-local-changed-url-identities-distinct',
    'remote-source-alias-matches-source',
    'route-source-identities-match-source',
    'no-forbidden-tunnel-hosts',
    'no-url-userinfo-query-or-fragment',
    'loopback-limited-to-sandbox-8080',
    'packaged-fallback-disabled',
    'redacted-hash-count-surface-only',
  ]);
  assert.match(proof.externalTopologyV3.roleIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV3.routeIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV3.surfaceDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV3.policyDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV3.scopeHash, sha256EvidencePattern);
  assert.equal(proof.externalTopologyV3.payloadsStored, false);
  assert.equal(proof.externalTopologyV3.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV3.hostnameValuesStored, false);
  assert.equal(proof.externalTopologyV3.rejectedRawInputsStored, false);
  assert.equal(proof.externalTopologyV3.releasePolicy, 'support-only-no-release-movement');

  assert.equal(proof.localOnlyPolicy.sandboxIngressPort, 8080);
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.remoteTunnelsAllowed, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackAllowed, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackObserved, false);
  assert.equal(proof.localOnlyPolicy.networkProbePerformed, false);

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.roleUrlsIdentityChecked, true);
  assert.equal(proof.invariants.sourceLocalChangedRoleIdentitiesDistinct, true);
  assert.equal(proof.invariants.perRouteSourceIdentityBound, true);
  assert.equal(proof.invariants.rejectsTunnelUrls, true);
  assert.equal(proof.invariants.rejectsSecretShapedUrlParts, true);
  assert.equal(proof.invariants.loopbackIngressLimitedToSandbox8080, true);
  assert.equal(proof.invariants.packagedFallbackDisabled, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertRedactedTopologyProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0843 external topology variant 3 proof' }));
});

test('RPP-0843 rejects tunnel, secret-shaped, loopback, and packaged fallback inputs without storing raw values', () => {
  const proof = buildExternalTopologyVariant3Proof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0843-secret@source.example.test/external-topology-v3',
      REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8081/external-topology-v3?token=rpp0843-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/external-topology-v3#rpp0843-fragment',
      REPRINT_PUSH_APPLY_SOURCE_URL: 'http://localhost:8082/external-topology-v3',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.sameSourceAcrossRoutes, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecretParts, false);
  assert.equal(proof.topology.localLoopbackIngress, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.topology.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV3.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.externalTopologyV3.roleUrlsAccepted, false);
  assert.equal(proof.externalTopologyV3.rejectedSurfaceCount, 5);
  assert.equal(proof.externalTopologyV3.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV3.hostnameValuesStored, false);
  assert.equal(proof.externalTopologyV3.rejectedRawInputsStored, false);
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackObserved, true);
  assert.ok(proof.failures.some((failure) => failure.code === 'SAME_SOURCE_IDENTITY_REQUIRED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assert.deepEqual(
    proof.externalTopologyV3.rejectedSurfaceNames,
    [
      'route-source-identities-match-source',
      'no-forbidden-tunnel-hosts',
      'no-url-userinfo-query-or-fragment',
      'loopback-limited-to-sandbox-8080',
      'packaged-fallback-disabled',
    ],
  );
  assertRedactedTopologyProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0843 rejected topology variant 3 proof' }));
});

test('RPP-0843 external topology variant 3 proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildExternalTopologyVariant3Proof({ env: goodEnv });
  const secondProof = buildExternalTopologyVariant3Proof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.externalTopologyV3.scopeHash, secondProof.externalTopologyV3.scopeHash);
  assert.equal(firstProof.externalTopologyV3.roleIdentityDigest, secondProof.externalTopologyV3.roleIdentityDigest);
  assert.equal(firstProof.externalTopologyV3.routeIdentityDigest, secondProof.externalTopologyV3.routeIdentityDigest);
  assert.equal(firstProof.externalTopologyV3.surfaceDigest, secondProof.externalTopologyV3.surfaceDigest);
  assert.deepEqual(firstProof.roleIdentities, secondProof.roleIdentities);
  assert.deepEqual(firstProof.roleIdentityChecks.routeSourceBindings, secondProof.roleIdentityChecks.routeSourceBindings);
  assert.deepEqual(firstProof.roleIdentityChecks.identitySurfaces, secondProof.roleIdentityChecks.identitySurfaces);
  assert.equal(firstProof.externalTopologyV3.payloadsStored, false);
  assert.equal(firstProof.externalTopologyV3.rawUrlValuesStored, false);
  assert.equal(firstProof.externalTopologyV3.hostnameValuesStored, false);
  assert.equal(firstProof.externalTopologyV3.rejectedRawInputsStored, false);
  assert.equal(firstProof.invariants.hashCountSurfaceOnly, true);
  assertRedactedTopologyProof(firstProof);
  assertRedactedTopologyProof(secondProof);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0843 first external topology proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0843 second external topology proof' }));
});

function buildExternalTopologyVariant3Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
  const topologyOk = topologyProof.ok === true;
  const roleIdentities = buildRoleIdentities(topologyProof, topologyOk);
  const routeSourceBindings = buildRouteSourceBindings(topologyProof);
  const identitySurfaces = buildIdentitySurfaces(topologyProof);
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
  const externalTopologyV3ScopeCore = {
    proofScope: topologyProofScope,
    roleIdentityScope,
    routeIdentityScope,
    identitySurfaces,
    localOnlyPolicy,
    releasePolicy: 'support-only-no-release-movement',
    redactionPolicy: {
      payloadsStored: false,
      rawUrlValuesStored: false,
      hostnameValuesStored: false,
      rejectedRawInputsStored: false,
    },
  };
  const externalTopologyV3 = {
    proofScope: topologyProofScope,
    variant: 3,
    scopeAcceptedForReleaseTopology: topologyOk,
    roleUrlsAccepted: topologyOk && roleIdentities.every((entry) => entry.accepted),
    roleIdentityCount: roleIdentities.length,
    capturedRoleIdentityCount: roleIdentities.filter((entry) => entry.provided).length,
    validRoleIdentityCount: roleIdentities.filter((entry) => entry.valid).length,
    acceptedRoleIdentityCount: roleIdentities.filter((entry) => entry.accepted).length,
    distinctRoleIdentityCount,
    routeSourceCount: routeSourceBindings.length,
    configuredRouteSourceCount: routeSourceBindings.filter((entry) => entry.configured).length,
    identitySurfaceCount: identitySurfaces.length,
    acceptedSurfaceCount: identitySurfaces.filter((entry) => entry.ok === true).length,
    rejectedSurfaceCount: rejectedSurfaceNames.length,
    surfaceNames: identitySurfaces.map((entry) => entry.surface),
    rejectedSurfaceNames,
    roleIdentityDigest: `sha256:${digest(roleIdentityScope)}`,
    routeIdentityDigest: `sha256:${digest(routeIdentityScope)}`,
    surfaceDigest: `sha256:${digest(identitySurfaces)}`,
    policyDigest: `sha256:${digest(localOnlyPolicy)}`,
    scopeHash: `sha256:${digest(externalTopologyV3ScopeCore)}`,
    payloadsStored: false,
    rawUrlValuesStored: false,
    hostnameValuesStored: false,
    rejectedRawInputsStored: false,
    releasePolicy: 'support-only-no-release-movement',
  };
  const roleIdentityChecks = {
    requiredRoleCount: roleDefinitions.length,
    capturedRoleCount: externalTopologyV3.capturedRoleIdentityCount,
    validRoleCount: externalTopologyV3.validRoleIdentityCount,
    acceptedRoleCount: externalTopologyV3.acceptedRoleIdentityCount,
    distinctRoleIdentityCount,
    sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
    sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
    remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
    noUrlSecretParts: topologyProof.identityChecks.noUrlSecrets.ok,
    localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
    roleIdentityHashes: Object.fromEntries(roleIdentities.map((entry) => [entry.role, entry.identityHash])),
    routeSourceBindings,
    identitySurfaces,
  };
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    roleUrlsIdentityChecked: topologyOk
      && topologyProof.rppEvidence.identityChecked === true
      && roleIdentities.every((entry) => entry.accepted),
    sourceLocalChangedRoleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true
      && distinctRoleIdentityCount === 3,
    perRouteSourceIdentityBound: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true
      && routeSourceBindings.length === 5
      && routeSourceBindings.every((entry) => entry.sameSource === true),
    rejectsTunnelUrls: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    rejectsSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    loopbackIngressLimitedToSandbox8080: topologyProof.identityChecks.localLoopbackIngress.ok === true
      && localOnlyPolicy.sandboxIngressPort === 8080,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true
      && localOnlyPolicy.packagedFallbackAllowed === false,
    hashCountSurfaceOnly: externalTopologyV3.payloadsStored === false
      && externalTopologyV3.rawUrlValuesStored === false
      && externalTopologyV3.hostnameValuesStored === false
      && externalTopologyV3.rejectedRawInputsStored === false
      && externalTopologyV3.identitySurfaceCount === 10
      && sha256EvidencePattern.test(externalTopologyV3.scopeHash)
      && roleIdentities.every((entry) => sha256Pattern.test(entry.identityHash) && sha256Pattern.test(entry.originHash)),
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0843',
    proofId,
    variant: 3,
    checkedAt: now.toISOString(),
    status: passed ? 'passed' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      variant2Pattern: 'RPP-0823',
      validator: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        status: topologyProof.status,
      },
      contract: 'redacted source/local/changed URL identity proof',
    },
    topology: {
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured,
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
    externalTopologyV3,
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
    { surface: 'redacted-hash-count-surface-only', ok: true },
  ];
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

function assertRedactedTopologyProof(value) {
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
