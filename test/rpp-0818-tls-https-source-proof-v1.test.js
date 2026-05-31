import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectExternalWordPressTopologyProof,
  externalWordPressTopologyVariant,
} from '../scripts/playground/external-wordpress-topology-proof.mjs';
import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
} from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0818-tls-https-source-proof-v1.md',
);

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0818-tls-https-source-proof-v1';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;

const requiredRoleOrder = Object.freeze(['source', 'localEdited', 'remoteChanged']);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/tls-source',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test:443/tls-source/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/tls-source',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/tls-source',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/tls-source/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/tls-source',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/tls-source',
  REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL: 'https://source.example.test/tls-source',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/tls-source',
  REPRINT_PUSH_USERNAME: 'rpp-0818-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0818-application-password-must-not-leak',
});

const forbiddenProofNeedles = Object.freeze([
  'https://source.example.test',
  'https://local.example.test',
  'https://changed.example.test',
  'source.example.test',
  'local.example.test',
  'changed.example.test',
  'rpp-0818-admin',
  'rpp-0818-application-password-must-not-leak',
]);

test('RPP-0818 captures source/local/changed HTTPS URLs and identity-checks their roles', () => {
  const proof = buildTlsHttpsSourceProof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0818');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'passed-support-only');
  assert.equal(proof.failClosed, false);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.topologyContract.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.topologyContract.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.topologyContract.sourceLocalChangedUrlCapture, true);
  assert.equal(proof.builtOn.topologyContract.staticIdentityChecks, true);
  assert.equal(proof.builtOn.urlIdentityPattern.rppId, 'RPP-0808');
  assert.deepEqual(proof.builtOn.urlIdentityPattern.roleIdentities, [
    'source',
    'local-edited',
    'remote-changed',
  ]);
  assert.equal(proof.adjacentPatternReferences.some((entry) => entry.rppId === 'RPP-0813'), true);

  assert.equal(proof.tlsHttpsSource.scope, 'tls-https-source-proof-v1');
  assert.equal(proof.tlsHttpsSource.sourceRequirement, 'all-required-role-urls-use-https-scheme');
  assert.equal(proof.tlsHttpsSource.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.tlsHttpsSource.capturedRoleUrlCount, 3);
  assert.equal(proof.tlsHttpsSource.httpsRoleUrlCount, 3);
  assert.equal(proof.tlsHttpsSource.identityHashCount, 3);
  assert.equal(proof.tlsHttpsSource.roleIdentitiesDistinct, true);
  assert.equal(proof.tlsHttpsSource.sourceAliasMatchesSource, true);
  assert.equal(proof.tlsHttpsSource.sameSourceAcrossRoutes, true);
  assert.equal(proof.tlsHttpsSource.identityChecked, true);
  assert.equal(proof.tlsHttpsSource.noTunnelPolicyEnforced, true);
  assert.equal(proof.tlsHttpsSource.noSecretShapedUrlParts, true);
  assert.equal(proof.tlsHttpsSource.packagedFallbackDisabled, true);
  assert.equal(proof.tlsHttpsSource.networkProbePerformed, false);
  assert.equal(proof.tlsHttpsSource.tlsHandshakePerformed, false);
  assert.equal(proof.tlsHttpsSource.certificateChainCaptured, false);
  assert.equal(proof.tlsHttpsSource.releaseMovement, 'none');

  assert.deepEqual(
    proof.tlsHttpsSource.roleUrlEvidence.map((entry) => entry.role),
    requiredRoleOrder,
  );
  for (const roleEvidence of proof.tlsHttpsSource.roleUrlEvidence) {
    assert.equal(roleEvidence.captured, true);
    assert.equal(roleEvidence.valid, true);
    assert.equal(roleEvidence.scheme, 'https');
    assert.equal(roleEvidence.serviceKind, 'external-wordpress-https');
    assert.equal(roleEvidence.port, '443');
    assert.match(roleEvidence.identityHash, sha256Pattern);
    assert.match(roleEvidence.originHash, sha256Pattern);
    assert.equal(roleEvidence.rawUrlStored, false);
    assert.equal(roleEvidence.urlCharacterCount > 0, true);
  }
  assert.equal(new Set(proof.tlsHttpsSource.roleUrlEvidence.map((entry) => entry.identityHash)).size, 3);
  assert.equal(new Set(Object.values(proof.tlsHttpsSource.roleIdentityHashes)).size, 3);

  assert.equal(proof.invariants.sourceLocalChangedHttpsUrlsCaptured, true);
  assert.equal(proof.invariants.roleIdentitiesDistinct, true);
  assert.equal(proof.invariants.sourceAliasAndRouteSourceIdentitiesMatch, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.httpsRequiredForAllRoleUrls, true);
  assert.equal(proof.invariants.hashCountSurfaceOnlyEvidence, true);
  assert.equal(proof.invariants.releaseMovementNoGo, true);
  assert.match(proof.outputHash, sha256PrefixedPattern);

  assertNoNeedles(proof, forbiddenProofNeedles);
  assertNoRawUrls(proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0818 TLS HTTPS source proof' }));
});

test('RPP-0818 rejects tunnel URLs and secret-shaped HTTPS URL parts before accepting TLS source scope', () => {
  const proof = buildTlsHttpsSourceProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0818-secret@source.example.test/tls-source',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/tls-source?token=rpp0818-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/tls-source',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.tlsHttpsSource.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.tlsHttpsSource.httpsRoleUrlCount, 3);
  assert.equal(proof.tlsHttpsSource.identityChecked, false);
  assert.equal(proof.tlsHttpsSource.noTunnelPolicyEnforced, false);
  assert.equal(proof.tlsHttpsSource.noSecretShapedUrlParts, false);
  assert.equal(proof.tlsHttpsSource.packagedFallbackDisabled, false);
  assert.equal(proof.tlsHttpsSource.scopeAcceptedForReleaseTopology, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, [
    'admin:rpp0818-secret',
    'rpp0818-secret',
    'token=rpp0818-token',
    'rpp0818-token',
    'changed.ngrok-free.app',
  ]);
  assertNoRawUrls(proof);
});

test('RPP-0818 requires HTTPS for every source/local/changed role URL', () => {
  const proof = buildTlsHttpsSourceProof({
    env: {
      ...goodEnv,
      REPRINT_PUSH_SOURCE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_REMOTE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_APPLY_SOURCE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL: 'http://source.example.test/tls-source',
      REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'http://source.example.test/tls-source',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.tlsHttpsSource.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.tlsHttpsSource.httpsRoleUrlCount, 2);
  assert.equal(proof.tlsHttpsSource.allRequiredRoleUrlsHttps, false);
  assert.equal(proof.tlsHttpsSource.scopeAcceptedForReleaseTopology, false);
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'RPP_0818_REQUIRED_ROLE_URL_MUST_BE_HTTPS'
      && failure.role === 'source'));
  assertNoRawUrls(proof);
});

test('RPP-0818 TLS HTTPS source proof is deterministic and hash/count/surface-only', () => {
  const firstProof = buildTlsHttpsSourceProof({ env: goodEnv });
  const secondProof = buildTlsHttpsSourceProof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.deepEqual(firstProof.tlsHttpsSource.roleUrlEvidence, secondProof.tlsHttpsSource.roleUrlEvidence);
  assert.deepEqual(firstProof.tlsHttpsSource.roleIdentityHashes, secondProof.tlsHttpsSource.roleIdentityHashes);
  assert.deepEqual(firstProof.failures, secondProof.failures);
  assertNoNeedles(firstProof, forbiddenProofNeedles);
  assertNoNeedles(secondProof, forbiddenProofNeedles);
  assertNoRawUrls(firstProof);
  assertNoRawUrls(secondProof);
});

test('RPP-0818 evidence document records the same NO-GO hash/count/surface-only scope', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0818');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.tlsHttpsSourceScope.sourceLocalChangedHttpsUrlsCaptured, true);
  assert.equal(report.tlsHttpsSourceScope.capturedRoleUrlCount, 3);
  assert.equal(report.tlsHttpsSourceScope.httpsRoleUrlCount, 3);
  assert.equal(report.tlsHttpsSourceScope.roleIdentitiesDistinct, true);
  assert.equal(report.tlsHttpsSourceScope.identityChecked, true);
  assert.equal(report.tlsHttpsSourceScope.networkProbePerformed, false);
  assert.equal(report.tlsHttpsSourceScope.tlsHandshakePerformed, false);
  assert.equal(report.tlsHttpsSourceScope.releaseMovement, 'none');
  assert.equal(report.negativeControls.tunnelUrlRejected, true);
  assert.equal(report.negativeControls.secretShapedUrlRejected, true);
  assert.equal(report.negativeControls.httpRoleUrlRejectedBeforeTlsScopeAccepted, true);
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.match(report.scopeEvidenceHash, sha256Pattern);
  assert.equal(report.scopeEvidenceHash, digest(scopeEvidenceInput(report)));
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assertNoRawUrls(report);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /source\.example|local\.example|changed\.example|ngrok|token=|admin:/i);
});

function buildTlsHttpsSourceProof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now, scope: proofId });
  const roleUrlEvidence = requiredRoleOrder.map((role) =>
    summarizeRoleUrl(topologyProof.urlCapture[role]));
  const allRequiredRoleUrlsHttps = roleUrlEvidence.every((entry) => entry.scheme === 'https');
  const httpsRoleUrlCount = roleUrlEvidence.filter((entry) => entry.scheme === 'https').length;
  const roleIdentityHashes = Object.fromEntries(roleUrlEvidence.map((entry) => [
    entry.role,
    entry.identityHash,
  ]));
  const tlsFailures = roleUrlEvidence
    .filter((entry) => entry.captured && entry.valid && entry.scheme !== 'https')
    .map((entry) => ({
      code: 'RPP_0818_REQUIRED_ROLE_URL_MUST_BE_HTTPS',
      role: entry.role,
      envKey: entry.envKey,
    }));
  const sanitizedTopologyFailures = topologyProof.failures.map((failure) => ({
    code: failure.code,
    role: failure.role || '',
    route: failure.route || '',
    envKey: failure.envKey || '',
  }));
  const failures = [...sanitizedTopologyFailures, ...tlsFailures];
  const scopeAccepted = topologyProof.ok === true && allRequiredRoleUrlsHttps;
  const invariants = {
    sourceLocalChangedHttpsUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true
      && httpsRoleUrlCount === 3,
    roleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
    sourceAliasAndRouteSourceIdentitiesMatch: topologyProof.identityChecks.remoteAliasMatchesSource.ok === true
      && topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.identityChecks.noTunnelHosts.ok === true,
    noSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    httpsRequiredForAllRoleUrls: allRequiredRoleUrlsHttps,
    hashCountSurfaceOnlyEvidence: true,
    releaseMovementNoGo: true,
  };
  const passed = scopeAccepted && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0818',
    proofId,
    variant: 1,
    checkedAt: now.toISOString(),
    status: passed ? 'passed-support-only' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      topologyContract: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        sourceLocalChangedUrlCapture: true,
        staticIdentityChecks: true,
        tunnelAndSecretUrlRejection: true,
      },
      urlIdentityPattern: {
        rppId: 'RPP-0808',
        variant: 1,
        roleIdentities: ['source', 'local-edited', 'remote-changed'],
        identityHashOnly: true,
        sameSourceAcrossRoutesRequired: true,
      },
    },
    adjacentPatternReferences: [
      {
        rppId: 'RPP-0813',
        pattern: 'source/local/changed URL identities are captured and checked before release movement',
      },
    ],
    tlsHttpsSource: {
      scope: 'tls-https-source-proof-v1',
      sourceRequirement: 'all-required-role-urls-use-https-scheme',
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
      capturedRoleUrlCount: roleUrlEvidence.filter((entry) => entry.captured).length,
      validRoleUrlCount: roleUrlEvidence.filter((entry) => entry.valid).length,
      httpsRoleUrlCount,
      identityHashCount: roleUrlEvidence.filter((entry) => sha256Pattern.test(entry.identityHash)).length,
      roleUrlEvidence,
      roleIdentityHashes,
      roleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
      sourceAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true,
      identityChecked: scopeAccepted && topologyProof.rppEvidence.identityChecked === true,
      allRequiredRoleUrlsHttps,
      noTunnelPolicyEnforced: topologyProof.identityChecks.noTunnelHosts.ok === true,
      noSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
      localLoopbackIngressOnly8080: topologyProof.identityChecks.localLoopbackIngress.ok === true,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
      scopeAcceptedForReleaseTopology: scopeAccepted,
      networkProbePerformed: false,
      tlsHandshakePerformed: false,
      certificateChainCaptured: false,
      releaseMovement: 'none',
    },
    redaction: {
      format: 'hash-count-surface-only',
      rawUrlValuesIncluded: false,
      rawHostValuesIncluded: false,
      credentialMaterialIncluded: false,
      routeSourceRawValuesIncluded: false,
    },
    invariants,
    failures,
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function summarizeRoleUrl(captured) {
  return {
    role: captured.role,
    envKey: captured.envKey,
    captured: captured.provided === true,
    valid: captured.valid === true,
    scheme: captured.protocol || '',
    serviceKind: captured.serviceKind || 'missing',
    port: captured.port || '',
    loopback: captured.loopback === true,
    loopbackAllowed: captured.loopbackAllowed === true,
    identityHash: captured.identityHash || '',
    originHash: captured.originHash || '',
    urlCharacterCount: captured.normalizedUrl ? captured.normalizedUrl.length : 0,
    pathDepth: captured.pathname
      ? captured.pathname.split('/').filter(Boolean).length
      : 0,
    rawUrlStored: false,
  };
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0818 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function scopeEvidenceInput(report) {
  return {
    tlsHttpsSourceScope: report.tlsHttpsSourceScope,
    negativeControls: report.negativeControls,
    releaseScope: report.releaseScope,
    redaction: report.redaction,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}

function assertNoRawUrls(value) {
  assert.doesNotMatch(JSON.stringify(value), /https?:\/\//i);
}
