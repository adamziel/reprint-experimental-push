import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { evaluateReleaseGates, RELEASE_GATE_DEFINITIONS } from '../src/release-gates.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0883-external-wordpress-topology-v5';
const topologyProofScope = 'external-wordpress-topology-v5';
const evidenceSource = 'external-wordpress-topology-release-verifier-v5';
const successCriterion = 'source/local/changed URLs are captured and identity-checked';
const validationCommand = 'node --test --test-name-pattern RPP-0883 test/rpp-0883-external-wordpress-topology-v5.test.js';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const routeOrder = Object.freeze(['preflight', 'dryRun', 'apply', 'journal', 'recovery']);
const topologyReleaseGateIds = Object.freeze([
  'source-url',
  'local-url',
  'remote-changed-url',
  'packaged-fallback',
  'remote-alias',
  'same-source-identity',
]);
const routeReleaseGateIds = Object.freeze([
  'preflight-route-identity',
  'dry-run-route-eligibility',
  'apply-route-pre-mutation',
  'journal-route-read-only',
  'recovery-inspect-read-only',
]);
const missingFinalReleaseGateIds = Object.freeze([
  'auth-source-readback',
  'application-password-binding',
  'manage-options-capability',
  'progress-release-timestamp',
  'agents-release-gates-row',
]);
const roleDefinitions = Object.freeze([
  Object.freeze({ role: 'source', topologyRole: 'source' }),
  Object.freeze({ role: 'localEdited', topologyRole: 'localEdited' }),
  Object.freeze({ role: 'remoteChanged', topologyRole: 'remoteChanged' }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/external-topology-v5',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/external-topology-v5/',
  REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8080/external-topology-v5-local',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/external-topology-v5',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/external-topology-v5/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/external-topology-v5',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/external-topology-v5',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/external-topology-v5',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/external-topology-v5',
  REPRINT_PUSH_USERNAME: 'topology-v5-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0883-application-password-must-not-leak',
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
  'admin:rpp0883-secret',
  'rpp0883-secret',
  'token=rpp0883-token',
  'rpp0883-token',
  'rpp0883-fragment',
  'rpp-0883-application-password-must-not-leak',
  '8081',
  '8082',
]);

test('RPP-0883 carries external WordPress topology variant 5 through the release verifier as hash/count/surface-only evidence', () => {
  const proof = buildExternalTopologyVariant5Proof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0883');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.variant4Pattern, 'RPP-0863');
  assert.equal(proof.builtOn.variant3Pattern, 'RPP-0843');
  assert.equal(proof.builtOn.variant2Pattern, 'RPP-0823');
  assert.equal(proof.builtOn.validator.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.validator.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.contract, 'release verifier carry-through for source/local/changed URL identity and route binding evidence');

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

  assert.equal(proof.externalTopologyV5.proofScope, topologyProofScope);
  assert.equal(proof.externalTopologyV5.variant, 5);
  assert.equal(proof.externalTopologyV5.successCriterion, successCriterion);
  assert.equal(proof.externalTopologyV5.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.externalTopologyV5.roleUrlsAccepted, true);
  assert.deepEqual(proof.externalTopologyV5.capturedIdentityRoles, ['source', 'localEdited', 'remoteChanged']);
  assert.equal(proof.externalTopologyV5.sourceLocalChangedIdentitiesCaptured, true);
  assert.equal(proof.externalTopologyV5.sourceLocalChangedIdentitiesIdentityChecked, true);
  assert.equal(proof.externalTopologyV5.routeSourceBindingsIdentityChecked, true);
  assert.equal(proof.externalTopologyV5.sourceLocalChangedIdentityCount, 3);
  assert.equal(proof.externalTopologyV5.roleIdentityCount, 3);
  assert.equal(proof.externalTopologyV5.distinctRoleIdentityCount, 3);
  assert.equal(proof.externalTopologyV5.routeSourceCount, 5);
  assert.equal(proof.externalTopologyV5.configuredRouteSourceCount, 5);
  assert.equal(proof.externalTopologyV5.identitySurfaceCount, 11);
  assert.equal(proof.externalTopologyV5.rejectedSurfaceCount, 0);
  assert.deepEqual(proof.externalTopologyV5.surfaceNames, [
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
    'redacted-hash-count-surface-only',
  ]);
  assert.match(proof.externalTopologyV5.roleIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV5.routeIdentityDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV5.surfaceDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV5.policyDigest, sha256EvidencePattern);
  assert.match(proof.externalTopologyV5.scopeHash, sha256EvidencePattern);
  assert.equal(proof.externalTopologyV5.payloadsStored, false);
  assert.equal(proof.externalTopologyV5.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV5.hostnameValuesStored, false);
  assert.equal(proof.externalTopologyV5.rejectedRawInputsStored, false);
  assert.equal(proof.externalTopologyV5.releasePolicy, 'support-only-no-release-movement');

  assert.equal(proof.releaseVerifier.schemaVersion, 1);
  assert.equal(proof.releaseVerifier.status, 'support-only-local-release-verifier');
  assert.equal(proof.releaseVerifier.command.invocationStored, false);
  assert.match(proof.releaseVerifier.command.invocationHash, sha256EvidencePattern);
  assert.equal(proof.releaseVerifier.command.reportsSourceLocalChangedUrlIdentities, true);
  assert.equal(proof.releaseVerifier.command.reportsRouteBindings, true);
  assert.equal(proof.releaseVerifier.command.reportsReleaseGateSummary, true);
  assert.equal(proof.releaseVerifier.command.rawCommandStored, false);
  assert.equal(proof.releaseVerifier.command.productionGateEvidence, 'not-present');
  assert.match(proof.releaseVerifier.command.reportHash, sha256EvidencePattern);
  assert.equal(proof.releaseVerifier.carryThrough.accepted, true);
  assert.equal(proof.releaseVerifier.carryThrough.status, 'support-only-local-release-verifier');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0863');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, 'rpp-0863-external-wordpress-topology-v4');
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(proof.releaseVerifier.carryThrough.targetRpp, 'RPP-0883');
  assert.equal(proof.releaseVerifier.carryThrough.targetVariant, 5);
  assert.equal(proof.releaseVerifier.carryThrough.sourceLocalChangedUrlIdentitiesCaptured, true);
  assert.equal(proof.releaseVerifier.carryThrough.sourceLocalChangedUrlIdentitiesIdentityChecked, true);
  assert.equal(proof.releaseVerifier.carryThrough.routeSourceBindingsIdentityChecked, true);
  assert.equal(proof.releaseVerifier.carryThrough.identitySurfaceCount, 11);
  assert.equal(proof.releaseVerifier.carryThrough.routeBindingCount, 5);
  assert.equal(proof.releaseVerifier.carryThrough.releaseMovementAllowed, false);
  assert.equal(proof.releaseVerifier.carryThrough.finalReleaseStatus, 'NO-GO');
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256EvidencePattern);

  assert.equal(proof.releaseVerifier.gateSummary.evaluator, 'reprint-push-release-gates');
  assert.equal(proof.releaseVerifier.gateSummary.scope, 'local-candidate');
  assert.equal(proof.releaseVerifier.gateSummary.gateState, 'held');
  assert.equal(proof.releaseVerifier.gateSummary.releaseMovementAllowed, false);
  assert.equal(proof.releaseVerifier.gateSummary.releaseMovementState, 'held');
  assert.equal(proof.releaseVerifier.gateSummary.finalGates, `0/${RELEASE_GATE_DEFINITIONS.length}`);
  assert.equal(proof.releaseVerifier.gateSummary.candidateGates, `15/${RELEASE_GATE_DEFINITIONS.length}`);
  assert.equal(proof.releaseVerifier.gateSummary.totalGateCount, RELEASE_GATE_DEFINITIONS.length);
  assert.equal(proof.releaseVerifier.gateSummary.passedCount, 0);
  assert.equal(proof.releaseVerifier.gateSummary.candidateCount, 15);
  assert.equal(proof.releaseVerifier.gateSummary.missingCount, 5);
  assert.equal(proof.releaseVerifier.gateSummary.failedCount, 0);
  assert.deepEqual(proof.releaseVerifier.gateSummary.topologyGateStatuses.map((entry) => [entry.id, entry.status]), [
    ['source-url', 'candidate'],
    ['local-url', 'candidate'],
    ['remote-changed-url', 'candidate'],
    ['packaged-fallback', 'candidate'],
    ['remote-alias', 'candidate'],
    ['same-source-identity', 'candidate'],
  ]);
  assert.deepEqual(proof.releaseVerifier.gateSummary.routeGateStatuses.map((entry) => [entry.id, entry.status]), [
    ['preflight-route-identity', 'candidate'],
    ['dry-run-route-eligibility', 'candidate'],
    ['apply-route-pre-mutation', 'candidate'],
    ['journal-route-read-only', 'candidate'],
    ['recovery-inspect-read-only', 'candidate'],
  ]);
  assert.deepEqual(proof.releaseVerifier.gateSummary.missingGateIds, missingFinalReleaseGateIds);
  assert.equal(proof.releaseVerifier.gateSummary.rawGateEvidenceStored, false);
  assert.equal(proof.releaseVerifier.gateSummary.rawUrlValuesStored, false);
  assert.equal(proof.releaseVerifier.gateSummary.hostnameValuesStored, false);
  assert.match(proof.releaseVerifier.gateSummary.gateSummaryHash, sha256EvidencePattern);
  assert.match(proof.releaseVerifier.releaseVerifierHash, sha256EvidencePattern);
  assert.equal(proof.releaseVerifier.rawGateEvidenceStored, false);
  assert.equal(proof.releaseVerifier.rawUrlValuesStored, false);
  assert.equal(proof.releaseVerifier.hostnameValuesStored, false);
  assert.equal(proof.releaseVerifier.rejectedRawInputsStored, false);

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.release.blockers, [
    'final-release-scope-evidence-not-present',
    'production-auth-source-readback-not-present',
    'application-password-binding-not-present',
    'manage-options-capability-not-present',
    'operator-progress-surfaces-not-updated',
  ]);

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
  assert.equal(proof.invariants.releaseVerifierCarryThroughRecorded, true);
  assert.equal(proof.invariants.releaseVerifierReportsTopologyGateStatuses, true);
  assert.equal(proof.invariants.releaseVerifierReportsRouteGateStatuses, true);
  assert.equal(proof.invariants.releaseVerifierFinalNoGo, true);
  assert.equal(proof.invariants.rejectsTunnelUrls, true);
  assert.equal(proof.invariants.rejectsSecretShapedUrlParts, true);
  assert.equal(proof.invariants.loopbackIngressLimitedToSandbox8080, true);
  assert.equal(proof.invariants.packagedFallbackDisabled, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.variant5ReleaseVerifierRecorded, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertRedactedTopologyProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0883 external topology variant 5 proof' }));
});

test('RPP-0883 rejects tunnel, secret-shaped, loopback, duplicate, and packaged fallback inputs without storing raw values', () => {
  const proof = buildExternalTopologyVariant5Proof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0883-secret@source.example.test/external-topology-v5',
      REPRINT_PUSH_LOCAL_URL: 'https://source.example.test/external-topology-v5?token=rpp0883-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/external-topology-v5#rpp0883-fragment',
      REPRINT_PUSH_APPLY_SOURCE_URL: 'http://localhost:8082/external-topology-v5',
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
  assert.equal(proof.topology.sameSourceAcrossRoutes, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecretParts, false);
  assert.equal(proof.topology.localLoopbackIngress, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.topology.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV5.scopeAcceptedForReleaseTopology, false);
  assert.equal(proof.externalTopologyV5.roleUrlsAccepted, false);
  assert.equal(proof.externalTopologyV5.rejectedSurfaceCount, 6);
  assert.equal(proof.externalTopologyV5.rawUrlValuesStored, false);
  assert.equal(proof.externalTopologyV5.hostnameValuesStored, false);
  assert.equal(proof.externalTopologyV5.rejectedRawInputsStored, false);
  assert.equal(proof.releaseVerifier.status, 'blocked-fail-closed');
  assert.equal(proof.releaseVerifier.carryThrough.accepted, false);
  assert.equal(proof.releaseVerifier.carryThrough.releaseMovementAllowed, false);
  assert.equal(proof.releaseVerifier.carryThrough.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.releaseVerifierCarryThrough, 'blocked-fail-closed');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, false);
  assert.equal(proof.localOnlyPolicy.packagedFallbackObserved, true);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_SOURCE_LOCAL_CHANGED_URLS_NOT_DISTINCT'));
  assert.ok(proof.failures.some((failure) => failure.code === 'SAME_SOURCE_IDENTITY_REQUIRED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assert.deepEqual(
    proof.externalTopologyV5.rejectedSurfaceNames,
    [
      'source-local-changed-url-identities-distinct',
      'route-source-identities-match-source',
      'no-forbidden-tunnel-hosts',
      'no-url-userinfo-query-or-fragment',
      'loopback-limited-to-sandbox-8080',
      'packaged-fallback-disabled',
    ],
  );
  assertRedactedTopologyProof(proof);
  assertNoNeedles(proof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0883 rejected topology variant 5 proof' }));
});

test('RPP-0883 external topology variant 5 release verifier proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildExternalTopologyVariant5Proof({ env: goodEnv });
  const secondProof = buildExternalTopologyVariant5Proof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.externalTopologyV5.scopeHash, secondProof.externalTopologyV5.scopeHash);
  assert.equal(firstProof.externalTopologyV5.roleIdentityDigest, secondProof.externalTopologyV5.roleIdentityDigest);
  assert.equal(firstProof.externalTopologyV5.routeIdentityDigest, secondProof.externalTopologyV5.routeIdentityDigest);
  assert.equal(firstProof.externalTopologyV5.surfaceDigest, secondProof.externalTopologyV5.surfaceDigest);
  assert.equal(firstProof.releaseVerifier.command.invocationHash, secondProof.releaseVerifier.command.invocationHash);
  assert.equal(firstProof.releaseVerifier.gateSummary.gateSummaryHash, secondProof.releaseVerifier.gateSummary.gateSummaryHash);
  assert.equal(firstProof.releaseVerifier.carryThrough.proofHash, secondProof.releaseVerifier.carryThrough.proofHash);
  assert.equal(firstProof.releaseVerifier.releaseVerifierHash, secondProof.releaseVerifier.releaseVerifierHash);
  assert.deepEqual(firstProof.roleIdentities, secondProof.roleIdentities);
  assert.deepEqual(firstProof.roleIdentityChecks.routeSourceBindings, secondProof.roleIdentityChecks.routeSourceBindings);
  assert.deepEqual(firstProof.roleIdentityChecks.identitySurfaces, secondProof.roleIdentityChecks.identitySurfaces);
  assert.deepEqual(firstProof.releaseVerifier.gateSummary.topologyGateStatuses, secondProof.releaseVerifier.gateSummary.topologyGateStatuses);
  assert.deepEqual(firstProof.releaseVerifier.gateSummary.routeGateStatuses, secondProof.releaseVerifier.gateSummary.routeGateStatuses);
  assert.equal(firstProof.externalTopologyV5.payloadsStored, false);
  assert.equal(firstProof.externalTopologyV5.rawUrlValuesStored, false);
  assert.equal(firstProof.externalTopologyV5.hostnameValuesStored, false);
  assert.equal(firstProof.externalTopologyV5.rejectedRawInputsStored, false);
  assert.equal(firstProof.releaseVerifier.rawGateEvidenceStored, false);
  assert.equal(firstProof.releaseVerifier.rawUrlValuesStored, false);
  assert.equal(firstProof.releaseVerifier.hostnameValuesStored, false);
  assert.equal(firstProof.releaseVerifier.rejectedRawInputsStored, false);
  assert.equal(firstProof.invariants.hashCountSurfaceOnly, true);
  assertRedactedTopologyProof(firstProof);
  assertRedactedTopologyProof(secondProof);
  assertNoNeedles(firstProof, forbiddenNeedles);
  assertNoNeedles(secondProof, forbiddenNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstProof, { label: 'RPP-0883 first external topology proof' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(secondProof, { label: 'RPP-0883 second external topology proof' }));
});

function buildExternalTopologyVariant5Proof({ env, now = fixedNow } = {}) {
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
  const identitySurfaces = buildIdentitySurfaces(topologyProof, { sourceLocalChangedUrlIdentitiesCaptured });
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
  const externalTopologyV5ScopeCore = {
    proofScope: topologyProofScope,
    successCriterion,
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
  const externalTopologyV5 = {
    proofScope: topologyProofScope,
    variant: 5,
    successCriterion,
    scopeAcceptedForReleaseTopology: topologyOk,
    roleUrlsAccepted: topologyOk && roleIdentities.every((entry) => entry.accepted),
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
    identitySurfaceCount: identitySurfaces.length,
    acceptedSurfaceCount: identitySurfaces.filter((entry) => entry.ok === true).length,
    rejectedSurfaceCount: rejectedSurfaceNames.length,
    surfaceNames: identitySurfaces.map((entry) => entry.surface),
    rejectedSurfaceNames,
    roleIdentityDigest: `sha256:${digest(roleIdentityScope)}`,
    routeIdentityDigest: `sha256:${digest(routeIdentityScope)}`,
    surfaceDigest: `sha256:${digest(identitySurfaces)}`,
    policyDigest: `sha256:${digest(localOnlyPolicy)}`,
    scopeHash: `sha256:${digest(externalTopologyV5ScopeCore)}`,
    payloadsStored: false,
    rawUrlValuesStored: false,
    hostnameValuesStored: false,
    rejectedRawInputsStored: false,
    releasePolicy: 'support-only-no-release-movement',
  };
  const releaseGateEvidence = buildReleaseGateEvidence({
    topologyOk,
    sourceLocalChangedUrlIdentitiesIdentityChecked,
    routeSourceBindingsIdentityChecked,
    routeSourceBindings,
    topologyProof,
  });
  const releaseGateEvaluation = evaluateReleaseGates({
    env,
    evidence: releaseGateEvidence,
    scope: 'local-candidate',
    now,
  });
  const releaseVerifier = buildReleaseVerifierCarryThrough({
    topologyOk,
    externalTopologyV5,
    roleIdentityScope,
    routeIdentityScope,
    identitySurfaces,
    sourceLocalChangedUrlIdentitiesCaptured,
    sourceLocalChangedUrlIdentitiesIdentityChecked,
    routeSourceBindingsIdentityChecked,
    releaseGateEvaluation,
  });
  const release = buildReleaseSummary(releaseVerifier);
  const roleIdentityChecks = {
    requiredRoleCount: roleDefinitions.length,
    capturedRoleCount: externalTopologyV5.capturedRoleIdentityCount,
    validRoleCount: externalTopologyV5.validRoleIdentityCount,
    acceptedRoleCount: externalTopologyV5.acceptedRoleIdentityCount,
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
    roleIdentityHashes: Object.fromEntries(roleIdentities.map((entry) => [entry.role, entry.identityHash])),
    routeSourceBindings,
    identitySurfaces,
  };
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    sourceLocalChangedUrlIdentitiesCaptured,
    roleUrlsIdentityChecked: topologyOk
      && topologyProof.rppEvidence.identityChecked === true
      && roleIdentities.every((entry) => entry.accepted),
    sourceLocalChangedRoleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true
      && distinctRoleIdentityCount === 3,
    perRouteSourceIdentityBound: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true
      && routeSourceBindings.length === 5
      && routeSourceBindings.every((entry) => entry.sameSource === true),
    releaseVerifierCarryThroughRecorded: releaseVerifier.carryThrough.accepted === true
      && releaseVerifier.carryThrough.sourceLocalChangedUrlIdentitiesCaptured === true
      && releaseVerifier.carryThrough.sourceLocalChangedUrlIdentitiesIdentityChecked === true,
    releaseVerifierReportsTopologyGateStatuses: releaseVerifier.gateSummary.topologyGateStatuses.length === topologyReleaseGateIds.length
      && releaseVerifier.gateSummary.topologyGateStatuses.every((entry) => entry.status === 'candidate'),
    releaseVerifierReportsRouteGateStatuses: releaseVerifier.gateSummary.routeGateStatuses.length === routeReleaseGateIds.length
      && releaseVerifier.gateSummary.routeGateStatuses.every((entry) => entry.status === 'candidate'),
    releaseVerifierFinalNoGo: releaseVerifier.releaseMovementAllowed === false
      && releaseVerifier.finalReleaseStatus === 'NO-GO'
      && release.finalReleaseStatus === 'NO-GO',
    rejectsTunnelUrls: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    rejectsSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    loopbackIngressLimitedToSandbox8080: topologyProof.identityChecks.localLoopbackIngress.ok === true
      && localOnlyPolicy.sandboxIngressPort === 8080,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true
      && localOnlyPolicy.packagedFallbackAllowed === false,
    hashCountSurfaceOnly: externalTopologyV5.payloadsStored === false
      && externalTopologyV5.rawUrlValuesStored === false
      && externalTopologyV5.hostnameValuesStored === false
      && externalTopologyV5.rejectedRawInputsStored === false
      && releaseVerifier.rawGateEvidenceStored === false
      && releaseVerifier.rawUrlValuesStored === false
      && releaseVerifier.hostnameValuesStored === false
      && releaseVerifier.rejectedRawInputsStored === false
      && externalTopologyV5.identitySurfaceCount === 11
      && sha256EvidencePattern.test(externalTopologyV5.scopeHash)
      && sha256EvidencePattern.test(releaseVerifier.releaseVerifierHash)
      && roleIdentities.every((entry) => sha256Pattern.test(entry.identityHash) && sha256Pattern.test(entry.originHash)),
    variant5ReleaseVerifierRecorded: externalTopologyV5.proofScope === topologyProofScope
      && externalTopologyV5.variant === 5
      && externalTopologyV5.successCriterion === successCriterion
      && releaseVerifier.carryThrough.targetRpp === 'RPP-0883'
      && releaseVerifier.carryThrough.targetVariant === 5,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0883',
    proofId,
    variant: 5,
    evidenceSource,
    checkedAt: now.toISOString(),
    status: passed ? 'passed' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      variant4Pattern: 'RPP-0863',
      variant3Pattern: 'RPP-0843',
      variant2Pattern: 'RPP-0823',
      validator: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        status: topologyProof.status,
      },
      contract: 'release verifier carry-through for source/local/changed URL identity and route binding evidence',
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
    externalTopologyV5,
    releaseVerifier,
    release,
    localOnlyPolicy,
    invariants,
    failures: sanitizeFailures(topologyProof.failures),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function buildReleaseGateEvidence({
  topologyOk,
  sourceLocalChangedUrlIdentitiesIdentityChecked,
  routeSourceBindingsIdentityChecked,
  routeSourceBindings,
  topologyProof,
}) {
  const routeEvidence = Object.fromEntries(routeReleaseGateIds.map((gateId) => {
    const route = routeForReleaseGate(gateId);
    const binding = routeSourceBindings.find((entry) => entry.route === route);
    const ok = topologyOk && binding?.sameSource === true;
    return [evidenceKeyForReleaseGate(gateId), {
      ok,
      ...booleanFieldForReleaseGate(gateId, ok),
      observed: ok ? 'redacted-route-source-identity-bound' : 'redacted-route-source-identity-blocked',
      identityHash: binding?.routeIdentityHash || '',
      scope: 'local-candidate',
    }];
  }));

  return {
    packagedFallback: {
      ok: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
      observed: topologyProof.identityChecks.packagedFallbackDisabled.ok !== true,
      source: 'rpp-0883-external-topology-v5',
      scope: 'local-candidate',
    },
    sourceIdentity: {
      ok: sourceLocalChangedUrlIdentitiesIdentityChecked && routeSourceBindingsIdentityChecked,
      same: sourceLocalChangedUrlIdentitiesIdentityChecked && routeSourceBindingsIdentityChecked,
      sameSource: sourceLocalChangedUrlIdentitiesIdentityChecked && routeSourceBindingsIdentityChecked,
      observed: 'redacted-source-local-changed-route-identity',
      scope: 'local-candidate',
    },
    tmuxStatusMarker: {
      ok: true,
      present: true,
      marker: '[RPP-0883-EXTERNAL-WORDPRESS:NO-GO]',
      scope: 'local-candidate',
    },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 2,
      reason: 'support-only-external-wordpress-topology-no-go',
      command: 'rpp-0883-focused-local-release-verifier',
      mutationAttempted: false,
      statusMarker: '[RPP-0883-EXTERNAL-WORDPRESS:NO-GO]',
      scope: 'local-candidate',
    },
    ...routeEvidence,
  };
}

function buildReleaseVerifierCarryThrough({
  topologyOk,
  externalTopologyV5,
  roleIdentityScope,
  routeIdentityScope,
  identitySurfaces,
  sourceLocalChangedUrlIdentitiesCaptured,
  sourceLocalChangedUrlIdentitiesIdentityChecked,
  routeSourceBindingsIdentityChecked,
  releaseGateEvaluation,
}) {
  const gateSummary = projectReleaseGateSummary(releaseGateEvaluation);
  const accepted = topologyOk
    && sourceLocalChangedUrlIdentitiesCaptured
    && sourceLocalChangedUrlIdentitiesIdentityChecked
    && routeSourceBindingsIdentityChecked;
  const commandCore = {
    invocationStored: false,
    invocationHash: `sha256:${digest(validationCommand)}`,
    reportsSourceLocalChangedUrlIdentities: true,
    reportsRouteBindings: true,
    reportsReleaseGateSummary: true,
    rawCommandStored: false,
    productionGateEvidence: 'not-present',
    gateSummaryHash: gateSummary.gateSummaryHash,
  };
  const command = {
    ...commandCore,
    reportHash: `sha256:${digest(commandCore)}`,
  };
  const carryCore = {
    status: accepted ? 'support-only-local-release-verifier' : 'blocked-fail-closed',
    fromRpp: 'RPP-0863',
    sourceProofId: 'rpp-0863-external-wordpress-topology-v4',
    sourceVariant: 4,
    targetRpp: 'RPP-0883',
    targetVariant: 5,
    successCriterion,
    sourceScopeHash: externalTopologyV5.scopeHash,
    sourceLocalChangedUrlIdentitiesCaptured,
    sourceLocalChangedUrlIdentitiesIdentityChecked,
    routeSourceBindingsIdentityChecked,
    identitySurfaceCount: identitySurfaces.length,
    routeBindingCount: routeIdentityScope.length,
    topologyGateIds: topologyReleaseGateIds,
    routeReleaseGateIds,
    releaseGateSummaryHash: gateSummary.gateSummaryHash,
    releaseMovementAllowed: gateSummary.releaseMovementAllowed,
    finalReleaseStatus: 'NO-GO',
    releasePolicy: 'support-only-no-release-movement',
  };
  const carryThrough = {
    ...carryCore,
    accepted,
    proofHash: `sha256:${digest(carryCore)}`,
  };
  const releaseVerifierCore = {
    schemaVersion: 1,
    status: carryThrough.status,
    command,
    carryThrough,
    gateSummary,
    roleIdentityDigest: `sha256:${digest(roleIdentityScope)}`,
    routeIdentityDigest: `sha256:${digest(routeIdentityScope)}`,
    surfaceDigest: `sha256:${digest(identitySurfaces)}`,
    releaseMovementAllowed: gateSummary.releaseMovementAllowed,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    payloadsStored: false,
    rawGateEvidenceStored: false,
    rawUrlValuesStored: false,
    hostnameValuesStored: false,
    rejectedRawInputsStored: false,
  };

  return {
    ...releaseVerifierCore,
    releaseVerifierHash: `sha256:${digest(releaseVerifierCore)}`,
  };
}

function projectReleaseGateSummary(evaluation) {
  const gateStatuses = evaluation.gates.map((gate) => ({
    id: gate.id,
    category: gate.category,
    status: gate.status,
    blocking: gate.blocking,
    code: gate.code,
  }));
  const summaryCore = {
    evaluator: evaluation.evaluator,
    scope: evaluation.scope,
    gateState: evaluation.gateState,
    releaseMovementAllowed: evaluation.releaseMovement.allowed,
    releaseMovementState: evaluation.releaseMovement.state,
    finalGates: evaluation.releaseMovement.finalGates,
    candidateGates: evaluation.releaseMovement.candidateGates,
    totalGateCount: evaluation.totals.gates,
    passedCount: evaluation.totals.passed,
    candidateCount: evaluation.totals.candidate,
    missingCount: evaluation.totals.missing,
    failedCount: evaluation.totals.failed,
    blockingCount: evaluation.totals.blocking,
    topologyGateStatuses: selectGateStatuses(gateStatuses, topologyReleaseGateIds),
    routeGateStatuses: selectGateStatuses(gateStatuses, routeReleaseGateIds),
    candidateGateIds: gateStatuses.filter((entry) => entry.status === 'candidate').map((entry) => entry.id),
    missingGateIds: gateStatuses.filter((entry) => entry.status === 'missing').map((entry) => entry.id),
    failedGateIds: gateStatuses.filter((entry) => entry.status === 'failed').map((entry) => entry.id),
    passedGateIds: gateStatuses.filter((entry) => entry.status === 'passed').map((entry) => entry.id),
    rawGateEvidenceStored: false,
    rawUrlValuesStored: false,
    hostnameValuesStored: false,
  };

  return {
    ...summaryCore,
    gateSummaryHash: `sha256:${digest(summaryCore)}`,
  };
}

function buildReleaseSummary(releaseVerifier) {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    releaseVerifierCarryThrough: releaseVerifier.carryThrough.status,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'final-release-scope-evidence-not-present',
      'production-auth-source-readback-not-present',
      'application-password-binding-not-present',
      'manage-options-capability-not-present',
      'operator-progress-surfaces-not-updated',
    ],
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

function buildIdentitySurfaces(topologyProof, { sourceLocalChangedUrlIdentitiesCaptured }) {
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
    { surface: 'redacted-hash-count-surface-only', ok: true },
  ];
}

function routeForReleaseGate(gateId) {
  if (gateId === 'dry-run-route-eligibility') {
    return 'dryRun';
  }
  if (gateId === 'apply-route-pre-mutation') {
    return 'apply';
  }
  if (gateId === 'journal-route-read-only') {
    return 'journal';
  }
  if (gateId === 'recovery-inspect-read-only') {
    return 'recovery';
  }
  return 'preflight';
}

function evidenceKeyForReleaseGate(gateId) {
  if (gateId === 'dry-run-route-eligibility') {
    return 'dryRunRouteEligibility';
  }
  if (gateId === 'apply-route-pre-mutation') {
    return 'applyRoutePreMutation';
  }
  if (gateId === 'journal-route-read-only') {
    return 'journalRouteReadOnly';
  }
  if (gateId === 'recovery-inspect-read-only') {
    return 'recoveryInspectReadOnly';
  }
  return 'preflightRouteIdentity';
}

function booleanFieldForReleaseGate(gateId, ok) {
  if (gateId === 'dry-run-route-eligibility') {
    return { eligible: ok };
  }
  if (gateId === 'apply-route-pre-mutation') {
    return { preMutation: ok };
  }
  if (gateId === 'journal-route-read-only' || gateId === 'recovery-inspect-read-only') {
    return { readOnly: ok };
  }
  return { sameRoute: ok };
}

function selectGateStatuses(gateStatuses, gateIds) {
  return gateIds.map((id) => {
    const gate = gateStatuses.find((entry) => entry.id === id);
    return {
      id,
      status: gate?.status || 'missing',
      code: gate?.code || 'GATE_NOT_EVALUATED',
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
