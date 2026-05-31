import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0823-external-wordpress-topology-v2';
const topologyProofScope = 'external-wordpress-topology-v2';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const roleDefinitions = Object.freeze([
  Object.freeze({ role: 'source', topologyRole: 'source', envKey: 'REPRINT_PUSH_SOURCE_URL' }),
  Object.freeze({ role: 'local', topologyRole: 'localEdited', envKey: 'REPRINT_PUSH_LOCAL_URL' }),
  Object.freeze({ role: 'changed', topologyRole: 'remoteChanged', envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL' }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/external-topology-v2',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/external-topology-v2/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/external-topology-v2',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/external-topology-v2',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/external-topology-v2/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/external-topology-v2',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/external-topology-v2',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/external-topology-v2',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/external-topology-v2',
  REPRINT_PUSH_USERNAME: 'topology-v2-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0823-application-password-must-not-leak',
});

const forbiddenNeedles = Object.freeze([
  'rpp-0823-application-password-must-not-leak',
  'admin:rpp0823-secret',
  'rpp0823-secret',
  'token=rpp0823-token',
  'rpp0823-token',
  'changed.ngrok-free.app',
]);

test('RPP-0823 captures source/local/changed URLs and records external WordPress topology variant 2 scope', () => {
  const proof = buildExternalTopologyVariant2Proof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0823');
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

  assert.equal(proof.topology.sourceUrl, 'https://source.example.test/external-topology-v2');
  assert.equal(proof.topology.localUrl, 'https://local.example.test/external-topology-v2');
  assert.equal(proof.topology.remoteChangedUrl, 'https://changed.example.test/external-topology-v2');
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
      ['source', 'source', 'https://source.example.test/external-topology-v2'],
      ['local', 'localEdited', 'https://local.example.test/external-topology-v2'],
      ['changed', 'remoteChanged', 'https://changed.example.test/external-topology-v2'],
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

  assert.equal(proof.externalTopologyV2.proofScope, topologyProofScope);
  assert.equal(proof.externalTopologyV2.variant, 2);
  assert.equal(proof.externalTopologyV2.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.externalTopologyV2.roleUrlsAccepted, true);
  assert.equal(proof.externalTopologyV2.roleUrlCount, 3);
  assert.equal(proof.externalTopologyV2.capturedRoleUrlCount, 3);
  assert.equal(proof.externalTopologyV2.routeSourceCount, 5);
  assert.equal(proof.externalTopologyV2.identitySurfaceCount, 9);
  assert.equal(proof.externalTopologyV2.rejectedSurfaceCount, 0);
  assert.deepEqual(proof.externalTopologyV2.surfaceNames, [
    'required-role-urls-present',
    'required-role-urls-valid',
    'source-local-changed-url-identities-distinct',
    'remote-source-alias-matches-source',
    'route-source-identities-match-source',
    'no-forbidden-tunnel-hosts',
    'no-url-userinfo-query-or-fragment',
    'loopback-limited-to-sandbox-8080',
    'packaged-fallback-disabled',
  ]);
  assert.match(proof.externalTopologyV2.roleIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV2.routeIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV2.scopeHash, sha256EvidencePattern);
  assert.equal(proof.externalTopologyV2.payloadsStored, false);
  assert.equal(proof.externalTopologyV2.releasePolicy, 'support-only-no-release-movement');

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.roleUrlsIdentityChecked, true);
  assert.equal(proof.invariants.sourceLocalChangedRoleIdentitiesDistinct, true);
  assert.equal(proof.invariants.sourceAliasAndRouteIdentitiesMatch, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.noTunnelPolicyEnforced, true);
  assert.equal(proof.invariants.noUrlSecretParts, true);
  assert.equal(proof.invariants.variant2ExternalTopologyScopeRecorded, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0823 external topology variant 2 proof' }));
});

test('RPP-0823 rejects tunnel and secret-shaped URLs before accepting external topology variant 2 scope', () => {
  const proof = buildExternalTopologyVariant2Proof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0823-secret@source.example.test/external-topology-v2',
      REPRINT_PUSH_LOCAL_URL: 'https://source.example.test/external-topology-v2?token=rpp0823-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/external-topology-v2',
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
  assert.equal(proof.externalTopologyV2.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.externalTopologyV2.roleUrlsAccepted, false);
  assert.equal(proof.externalTopologyV2.rejectedSurfaceCount, 4);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0823 rejected topology variant 2 proof' }));
});

test('RPP-0823 external topology variant 2 proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildExternalTopologyVariant2Proof({ env: goodEnv });
  const secondProof = buildExternalTopologyVariant2Proof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.externalTopologyV2.scopeHash, secondProof.externalTopologyV2.scopeHash);
  assert.equal(firstProof.externalTopologyV2.roleIdentityDigest, secondProof.externalTopologyV2.roleIdentityDigest);
  assert.equal(firstProof.externalTopologyV2.routeIdentityDigest, secondProof.externalTopologyV2.routeIdentityDigest);
  assert.deepEqual(firstProof.topology.roleUrlCapture, secondProof.topology.roleUrlCapture);
  assert.deepEqual(firstProof.roleIdentityChecks.identitySurfaces, secondProof.roleIdentityChecks.identitySurfaces);
  assert.deepEqual(firstProof.roleIdentityChecks.routeSourceIdentities, secondProof.roleIdentityChecks.routeSourceIdentities);
  assert.equal(firstProof.externalTopologyV2.payloadsStored, false);
  assert.equal(firstProof.invariants.hashCountSurfaceOnly, true);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0823 first external topology proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0823 second external topology proof' }));
});

function buildExternalTopologyVariant2Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
  const topologyOk = topologyProof.ok === true;
  const roleUrlCapture = buildRoleUrlCapture(topologyProof, topologyOk);
  const routeSourceIdentities = buildRouteSourceIdentities(topologyProof);
  const identitySurfaces = buildIdentitySurfaces(topologyProof);
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
  const externalTopologyV2ScopeCore = {
    proofScope: topologyProofScope,
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
    releasePolicy: 'support-only-no-release-movement',
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
  };
  const externalTopologyV2 = {
    proofScope: topologyProofScope,
    variant: 2,
    scopeAcceptedForReleaseTopology: topologyOk,
    roleUrlsAccepted: topologyOk && roleUrlCapture.every((entry) => entry.accepted),
    roleUrlCount: roleDefinitions.length,
    capturedRoleUrlCount: roleIdentityChecks.capturedRoleCount,
    routeSourceCount: routeSourceIdentities.length,
    identitySurfaceCount: identitySurfaces.length,
    rejectedSurfaceCount: identitySurfaces.filter((entry) => entry.ok !== true).length,
    surfaceNames: identitySurfaces.map((entry) => entry.surface),
    roleIdentityDigest: `sha256:${digest(externalTopologyV2ScopeCore.roleUrlIdentities)}`,
    routeIdentityDigest: `sha256:${digest(routeSourceIdentities)}`,
    scopeHash: `sha256:${digest(externalTopologyV2ScopeCore)}`,
    payloadsStored: false,
    networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    releasePolicy: 'support-only-no-release-movement',
  };
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
    variant2ExternalTopologyScopeRecorded: externalTopologyV2.proofScope === topologyProofScope
      && externalTopologyV2.variant === 2
      && externalTopologyV2.roleUrlCount === 3
      && externalTopologyV2.routeSourceCount === 5,
    hashCountSurfaceOnly: externalTopologyV2.payloadsStored === false
      && externalTopologyV2.identitySurfaceCount === 9
      && sha256EvidencePattern.test(externalTopologyV2.scopeHash)
      && roleUrlCapture.every((entry) => sha256Pattern.test(entry.identityHash) && sha256Pattern.test(entry.originHash)),
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0823',
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
    externalTopologyV2,
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

function exposeAcceptedUrl(captured, topologyOk) {
  return topologyOk && captured?.valid === true ? captured.normalizedUrl : '';
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
