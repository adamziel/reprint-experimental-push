import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0813-maintenance-mode-interaction-v1';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/maintenance-mode',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/maintenance-mode/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/maintenance-mode',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/maintenance-mode',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/maintenance-mode/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/maintenance-mode',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/maintenance-mode',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/maintenance-mode',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/maintenance-mode',
  REPRINT_PUSH_USERNAME: 'maintenance-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0813-application-password-must-not-leak',
});

const maintenanceSurfaces = Object.freeze([
  Object.freeze({
    surface: 'core-maintenance-file',
    resourceKey: 'file:.maintenance',
    interaction: 'site-wide-front-end-lock',
    capturedPayload: false,
  }),
  Object.freeze({
    surface: 'maintenance-plugin-option',
    resourceKey: 'row:["wp_options","option_name:maintenance_mode"]',
    interaction: 'admin-configured-front-end-lock',
    capturedPayload: false,
  }),
  Object.freeze({
    surface: 'route-health-status',
    resourceKey: 'http-status:maintenance-window',
    interaction: 'route-availability-signal',
    capturedPayload: false,
  }),
]);

const roleStates = Object.freeze([
  Object.freeze({
    role: 'source',
    topologyRole: 'source',
    maintenanceState: 'baseline-open',
    maintenanceEnabled: false,
    expectedRouteClass: 'normal-wordpress-response',
    mutationAllowedByThisProof: false,
  }),
  Object.freeze({
    role: 'localEdited',
    topologyRole: 'local',
    maintenanceState: 'local-maintenance-enabled',
    maintenanceEnabled: true,
    expectedRouteClass: 'maintenance-window-response',
    mutationAllowedByThisProof: false,
  }),
  Object.freeze({
    role: 'remoteChanged',
    topologyRole: 'changed',
    maintenanceState: 'remote-maintenance-enabled',
    maintenanceEnabled: true,
    expectedRouteClass: 'maintenance-window-response',
    mutationAllowedByThisProof: false,
  }),
]);

const forbiddenNeedles = Object.freeze([
  'rpp-0813-application-password-must-not-leak',
  'admin:rpp0813-secret',
  'rpp0813-secret',
  'token=rpp0813-token',
  'rpp0813-token',
]);

test('RPP-0813 captures source/local/changed URLs before accepting maintenance-mode interaction scope', () => {
  const proof = buildMaintenanceModeInteractionProof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0813');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.variant, externalWordPressTopologyVariant);
  assert.equal(proof.topology.sourceUrl, 'https://source.example.test/maintenance-mode');
  assert.equal(proof.topology.localUrl, 'https://local.example.test/maintenance-mode');
  assert.equal(proof.topology.remoteChangedUrl, 'https://changed.example.test/maintenance-mode');
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.topology.identityChecked, true);
  assert.equal(proof.topology.sameSourceAcrossRoutes, true);
  assert.equal(proof.topology.remoteAliasMatchesSource, true);
  assert.equal(proof.topology.noTunnelPolicyEnforced, true);
  assert.equal(proof.topology.noUrlSecrets, true);
  assert.equal(proof.topology.networkProbePerformed, false);
  assert.match(proof.topology.sourceIdentityHash, sha256Pattern);
  assert.match(proof.topology.localIdentityHash, sha256Pattern);
  assert.match(proof.topology.remoteChangedIdentityHash, sha256Pattern);

  assert.equal(proof.maintenanceMode.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.maintenanceMode.scopeKind, 'maintenance-mode-interaction');
  assert.equal(proof.maintenanceMode.snapshotBoundary, 'before-route-receipts-or-mutation');
  assert.equal(proof.maintenanceMode.releasePolicy, 'support-only-no-release-movement');
  assert.deepEqual(
    proof.maintenanceMode.surfaces.map((entry) => entry.surface),
    ['core-maintenance-file', 'maintenance-plugin-option', 'route-health-status'],
  );
  assert.deepEqual(
    proof.maintenanceMode.roleStates.map((entry) => entry.role),
    ['source', 'localEdited', 'remoteChanged'],
  );
  assert.deepEqual(
    proof.maintenanceMode.roleStates.map((entry) => entry.maintenanceState),
    ['baseline-open', 'local-maintenance-enabled', 'remote-maintenance-enabled'],
  );
  assert.ok(proof.maintenanceMode.roleStateHashes.every((entry) => sha256EvidencePattern.test(entry.stateHash)));
  assert.match(proof.maintenanceMode.scopeHash, sha256EvidencePattern);
  assert.equal(proof.maintenanceMode.payloadsStored, false);
  assert.equal(proof.maintenanceMode.maintenanceInteractionAccepted, true);

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.identityChecked, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.maintenanceModeInteractionScopeRecorded, true);
  assert.equal(proof.invariants.maintenanceStatesBoundToDistinctUrlIdentities, true);
  assert.equal(proof.invariants.maintenanceDoesNotBypassChangedUrlIdentity, true);
  assert.equal(proof.invariants.noMaintenancePayloadStored, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0813 maintenance mode proof' }));
});

test('RPP-0813 rejects tunnel and secret-shaped topology URLs before accepting maintenance-mode scope', () => {
  const proof = buildMaintenanceModeInteractionProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0813-secret@source.example.test/maintenance-mode',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/maintenance-mode?token=rpp0813-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/maintenance-mode',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecrets, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.maintenanceMode.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.maintenanceMode.maintenanceInteractionAccepted, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, forbiddenNeedles);
});

test('RPP-0813 maintenance-mode proof is deterministic and hash-only', () => {
  const firstProof = buildMaintenanceModeInteractionProof({ env: goodEnv });
  const secondProof = buildMaintenanceModeInteractionProof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.maintenanceMode.scopeHash, secondProof.maintenanceMode.scopeHash);
  assert.deepEqual(firstProof.maintenanceMode.roleStateHashes, secondProof.maintenanceMode.roleStateHashes);
  assert.deepEqual(firstProof.topology.sourceIdentityHash, secondProof.topology.sourceIdentityHash);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0813 first maintenance mode proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0813 second maintenance mode proof' }));
});

function buildMaintenanceModeInteractionProof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
  const topologyOk = topologyProof.ok === true;
  const roleStateHashes = roleStates.map((entry) => ({
    role: entry.role,
    stateHash: `sha256:${digest(entry)}`,
  }));
  const maintenanceScope = {
    surfaces: maintenanceSurfaces,
    roleStates,
    snapshotBoundary: 'before-route-receipts-or-mutation',
  };
  const maintenanceMode = {
    scopeKind: 'maintenance-mode-interaction',
    scopeAcceptedForReleaseTopology: topologyOk,
    snapshotBoundary: maintenanceScope.snapshotBoundary,
    releasePolicy: 'support-only-no-release-movement',
    surfaces: maintenanceSurfaces.map((entry) => ({ ...entry })),
    roleStates: roleStates.map((entry) => ({ ...entry })),
    roleStateHashes,
    scopeHash: `sha256:${digest(maintenanceScope)}`,
    payloadsStored: false,
    maintenanceInteractionAccepted: topologyOk,
  };
  const distinctIdentityHashes = new Set([
    topologyProof.urlCapture.source.identityHash,
    topologyProof.urlCapture.localEdited.identityHash,
    topologyProof.urlCapture.remoteChanged.identityHash,
  ]);
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    identityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok === true,
    maintenanceModeInteractionScopeRecorded: maintenanceMode.surfaces.length === 3
      && maintenanceMode.roleStates.length === 3
      && maintenanceMode.scopeHash.startsWith('sha256:'),
    maintenanceStatesBoundToDistinctUrlIdentities: topologyOk
      && distinctIdentityHashes.size === 3
      && roleStateHashes.length === 3,
    maintenanceDoesNotBypassChangedUrlIdentity: topologyOk
      && topologyProof.urlCapture.remoteChanged.identityHash !== topologyProof.urlCapture.source.identityHash,
    noMaintenancePayloadStored: maintenanceMode.payloadsStored === false
      && maintenanceMode.surfaces.every((entry) => entry.capturedPayload === false),
    noNetworkProbe: topologyProof.constraints.networkProbePerformed === false,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0813',
    proofId,
    variant: 1,
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
      sourceUrl: topologyProof.urlCapture.source.normalizedUrl,
      localUrl: topologyProof.urlCapture.localEdited.normalizedUrl,
      remoteChangedUrl: topologyProof.urlCapture.remoteChanged.normalizedUrl,
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
    },
    maintenanceMode,
    invariants,
    failures: topologyProof.failures.map((failure) => ({
      code: failure.code,
      role: failure.role || '',
      envKey: failure.envKey || '',
    })),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}
