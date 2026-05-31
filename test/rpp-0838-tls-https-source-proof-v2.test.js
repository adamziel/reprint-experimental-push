import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectExternalWordPressTopologyProof,
  externalTopologyRouteSourceEnv,
  externalWordPressTopologyVariant,
  optionalExternalTopologyUrlRoles,
  requiredExternalTopologyUrlRoles,
} from '../scripts/playground/external-wordpress-topology-proof.mjs';
import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
} from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0838-tls-https-source-proof-v2.md',
);

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0838-tls-https-source-proof-v2';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;
const secretShapedPartPattern = /(?:api[-_]?key|authorization|bearer|cookie|password|passwd|pwd|secret|session|token)/i;

const requiredRoleOrder = Object.freeze(['source', 'localEdited', 'remoteChanged']);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source-v2.example.test/variant-two-source',
  REPRINT_PUSH_REMOTE_URL: 'https://source-v2.example.test:443/variant-two-source/',
  REPRINT_PUSH_LOCAL_URL: 'https://local-v2.example.test/variant-two-local',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed-v2.example.test/variant-two-changed',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source-v2.example.test/variant-two-source/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source-v2.example.test:443/variant-two-source',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source-v2.example.test/variant-two-source',
  REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL: 'https://source-v2.example.test/variant-two-source',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source-v2.example.test/variant-two-source',
  REPRINT_PUSH_USERNAME: 'rpp-0838-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0838-application-password-must-not-leak',
});

const forbiddenProofNeedles = Object.freeze([
  'https://source-v2.example.test',
  'https://local-v2.example.test',
  'https://changed-v2.example.test',
  'source-v2.example.test',
  'local-v2.example.test',
  'changed-v2.example.test',
  'variant-two-source',
  'variant-two-local',
  'variant-two-changed',
  'rpp-0838-admin',
  'rpp-0838-application-password-must-not-leak',
]);

test('RPP-0838 captures source/local/changed HTTPS URLs and identity-checks variant 2 roles', () => {
  const proof = buildTlsHttpsSourceProof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0838');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
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
  assert.equal(proof.patternLineage.patternOnlyReference.rppId, 'RPP-0818');
  assert.equal(proof.patternLineage.patternOnlyReference.reusesProofArtifact, false);

  assert.equal(proof.tlsHttpsSource.scope, 'tls-https-source-proof-v2');
  assert.equal(proof.tlsHttpsSource.sourceRequirement, 'all-required-role-urls-use-https-scheme');
  assert.equal(proof.tlsHttpsSource.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.tlsHttpsSource.capturedRoleUrlCount, 3);
  assert.equal(proof.tlsHttpsSource.httpsRoleUrlCount, 3);
  assert.equal(proof.tlsHttpsSource.identityHashCount, 3);
  assert.equal(proof.tlsHttpsSource.roleIdentitiesDistinct, true);
  assert.equal(proof.tlsHttpsSource.sourceAliasMatchesSource, true);
  assert.equal(proof.tlsHttpsSource.sameSourceAcrossRoutes, true);
  assert.equal(proof.tlsHttpsSource.identityChecked, true);
  assert.equal(proof.tlsHttpsSource.allRequiredRoleUrlsHttps, true);
  assert.equal(proof.tlsHttpsSource.noTunnelPolicyEnforced, true);
  assert.equal(proof.tlsHttpsSource.noSecretShapedUrlParts, true);
  assert.equal(proof.tlsHttpsSource.secretShapedUrlPartFailureCount, 0);
  assert.equal(proof.tlsHttpsSource.localLoopbackIngressOnly8080, true);
  assert.equal(proof.tlsHttpsSource.packagedFallbackDisabled, true);
  assert.equal(proof.tlsHttpsSource.scopeAcceptedForReleaseTopology, true);
  assert.equal(proof.tlsHttpsSource.networkProbePerformed, false);
  assert.equal(proof.tlsHttpsSource.tlsHandshakePerformed, false);
  assert.equal(proof.tlsHttpsSource.certificateChainCaptured, false);
  assert.equal(proof.tlsHttpsSource.wordpressRouteCallsPerformed, false);
  assert.equal(proof.tlsHttpsSource.liveImportExportPerformed, false);
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
    assert.equal(roleEvidence.pathDepth, 1);
  }
  assert.equal(new Set(proof.tlsHttpsSource.roleUrlEvidence.map((entry) => entry.identityHash)).size, 3);
  assert.equal(new Set(Object.values(proof.tlsHttpsSource.roleIdentityHashes)).size, 3);

  assert.equal(proof.invariants.sourceLocalChangedHttpsUrlsCaptured, true);
  assert.equal(proof.invariants.roleIdentitiesDistinct, true);
  assert.equal(proof.invariants.sourceAliasAndRouteSourceIdentitiesMatch, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.httpsRequiredForAllRoleUrls, true);
  assert.equal(proof.invariants.hashCountSurfaceOnlyEvidence, true);
  assert.equal(proof.invariants.noLiveNetworkOrTlsCapture, true);
  assert.equal(proof.invariants.releaseMovementNoGo, true);
  assert.match(proof.outputHash, sha256PrefixedPattern);

  assertNoNeedles(proof, forbiddenProofNeedles);
  assertNoRawUrls(proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0838 TLS HTTPS source proof v2' }));
});

test('RPP-0838 rejects tunnel URLs and secret-shaped URL parts before accepting TLS source scope', () => {
  const proof = buildTlsHttpsSourceProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0838-secret@source-v2.example.test/variant-two-source',
      REPRINT_PUSH_LOCAL_URL: 'https://local-v2.example.test/secret/rpp0838-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed-v2.ngrok-free.app/variant-two-changed',
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
  assert.equal(proof.tlsHttpsSource.secretShapedUrlPartFailureCount, 2);
  assert.equal(proof.tlsHttpsSource.packagedFallbackDisabled, false);
  assert.equal(proof.tlsHttpsSource.scopeAcceptedForReleaseTopology, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'RPP_0838_SECRET_SHAPED_URL_PART_REJECTED'
    && failure.role === 'source'
    && failure.partSurface === 'userinfo'));
  assert.ok(proof.failures.some((failure) => failure.code === 'RPP_0838_SECRET_SHAPED_URL_PART_REJECTED'
    && failure.role === 'localEdited'
    && failure.partSurface === 'path-segment'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, [
    'admin:rpp0838-secret',
    'rpp0838-secret',
    'secret/rpp0838-token',
    'rpp0838-token',
    'changed-v2.ngrok-free.app',
  ]);
  assertNoRawUrls(proof);
});

test('RPP-0838 rejects non-HTTPS role URLs before TLS scope acceptance', () => {
  const proof = buildTlsHttpsSourceProof({
    env: {
      ...goodEnv,
      REPRINT_PUSH_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_REMOTE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_APPLY_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
      REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'http://source-v2.example.test/variant-two-source',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.tlsHttpsSource.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.tlsHttpsSource.httpsRoleUrlCount, 2);
  assert.equal(proof.tlsHttpsSource.allRequiredRoleUrlsHttps, false);
  assert.equal(proof.tlsHttpsSource.scopeAcceptedForReleaseTopology, false);
  assert.ok(proof.failures.some((failure) =>
    failure.code === 'RPP_0838_REQUIRED_ROLE_URL_MUST_BE_HTTPS'
      && failure.role === 'source'));
  assertNoRawUrls(proof);
});

test('RPP-0838 TLS HTTPS source proof v2 is deterministic and hash/count/surface-only', () => {
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

test('RPP-0838 evidence document records the same NO-GO hash/count/surface-only scope', () => {
  const { report, text } = loadEvidenceReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0838');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 2);
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
  assert.equal(report.tlsHttpsSourceScope.certificateChainCaptured, false);
  assert.equal(report.tlsHttpsSourceScope.wordpressRouteCallsPerformed, false);
  assert.equal(report.tlsHttpsSourceScope.liveImportExportPerformed, false);
  assert.equal(report.tlsHttpsSourceScope.releaseMovement, 'none');
  assert.equal(report.negativeControls.tunnelUrlRejected, true);
  assert.equal(report.negativeControls.secretShapedUrlRejected, true);
  assert.equal(report.negativeControls.secretShapedPathPartRejected, true);
  assert.equal(report.negativeControls.httpRoleUrlRejectedBeforeTlsScopeAccepted, true);
  assert.equal(report.negativeControls.packagedFallbackRejected, true);
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rejectedInputValuesIncluded, false);
  assert.match(report.scopeEvidenceHash, sha256Pattern);
  assert.equal(report.scopeEvidenceHash, digest(scopeEvidenceInput(report)));
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assertNoRawUrls(report);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /source-v2\.example|local-v2\.example|changed-v2\.example|ngrok|token=|admin:/i);
});

function buildTlsHttpsSourceProof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now, scope: proofId });
  const roleUrlEvidence = requiredRoleOrder.map((role) =>
    summarizeRoleUrl(topologyProof.urlCapture[role]));
  const secretShapedUrlPartFailures = findSecretShapedUrlPartFailures(env);
  const allRequiredRoleUrlsHttps = roleUrlEvidence.every((entry) => entry.scheme === 'https');
  const httpsRoleUrlCount = roleUrlEvidence.filter((entry) => entry.scheme === 'https').length;
  const roleIdentityHashes = Object.fromEntries(roleUrlEvidence.map((entry) => [
    entry.role,
    entry.identityHash,
  ]));
  const tlsFailures = roleUrlEvidence
    .filter((entry) => entry.captured && entry.valid && entry.scheme !== 'https')
    .map((entry) => ({
      code: 'RPP_0838_REQUIRED_ROLE_URL_MUST_BE_HTTPS',
      role: entry.role,
      envKey: entry.envKey,
    }));
  const sanitizedTopologyFailures = topologyProof.failures.map((failure) => ({
    code: failure.code,
    role: failure.role || '',
    route: failure.route || '',
    envKey: failure.envKey || '',
  }));
  const failures = [...sanitizedTopologyFailures, ...secretShapedUrlPartFailures, ...tlsFailures];
  const noSecretShapedUrlParts = topologyProof.identityChecks.noUrlSecrets.ok === true
    && secretShapedUrlPartFailures.length === 0;
  const scopeAccepted = topologyProof.ok === true && allRequiredRoleUrlsHttps && noSecretShapedUrlParts;
  const invariants = {
    sourceLocalChangedHttpsUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true
      && httpsRoleUrlCount === 3,
    roleIdentitiesDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
    sourceAliasAndRouteSourceIdentitiesMatch: topologyProof.identityChecks.remoteAliasMatchesSource.ok === true
      && topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true,
    rejectsTunnelAndSecretShapedUrls: topologyProof.identityChecks.noTunnelHosts.ok === true
      && noSecretShapedUrlParts,
    noTunnelPolicyEnforced: topologyProof.identityChecks.noTunnelHosts.ok === true,
    noSecretShapedUrlParts,
    httpsRequiredForAllRoleUrls: allRequiredRoleUrlsHttps,
    hashCountSurfaceOnlyEvidence: true,
    noLiveNetworkOrTlsCapture: true,
    releaseMovementNoGo: true,
  };
  const passed = scopeAccepted && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0838',
    proofId,
    variant: 2,
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
    patternLineage: {
      patternOnlyReference: {
        rppId: 'RPP-0818',
        variant: 1,
        reusesProofArtifact: false,
        independentVariant: true,
      },
    },
    tlsHttpsSource: {
      scope: 'tls-https-source-proof-v2',
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
      noSecretShapedUrlParts,
      secretShapedUrlPartFailureCount: secretShapedUrlPartFailures.length,
      localLoopbackIngressOnly8080: topologyProof.identityChecks.localLoopbackIngress.ok === true,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
      scopeAcceptedForReleaseTopology: scopeAccepted,
      networkProbePerformed: false,
      tlsHandshakePerformed: false,
      certificateChainCaptured: false,
      wordpressRouteCallsPerformed: false,
      liveImportExportPerformed: false,
      releaseMovement: 'none',
    },
    redaction: {
      format: 'hash-count-surface-only',
      rawUrlValuesIncluded: false,
      rawHostValuesIncluded: false,
      credentialMaterialIncluded: false,
      routeSourceRawValuesIncluded: false,
      rejectedInputValuesIncluded: false,
      secretShapedPartValuesIncluded: false,
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

function findSecretShapedUrlPartFailures(env = {}) {
  const failures = [];
  for (const definition of urlDefinitionsForSecretPartScan(env)) {
    const raw = String(env[definition.envKey] || '').trim();
    if (!raw) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }

    const partSurfaces = [];
    if (parsed.username !== '' || parsed.password !== '') {
      partSurfaces.push('userinfo');
    }
    if (parsed.search !== '') {
      partSurfaces.push('query-string');
    }
    if (parsed.hash !== '') {
      partSurfaces.push('fragment');
    }
    if (parsed.pathname.split('/').filter(Boolean).some((segment) =>
      secretShapedPartPattern.test(safeDecodeUrlPart(segment)))) {
      partSurfaces.push('path-segment');
    }

    for (const partSurface of partSurfaces) {
      failures.push({
        code: 'RPP_0838_SECRET_SHAPED_URL_PART_REJECTED',
        role: definition.role,
        envKey: definition.envKey,
        partSurface,
      });
    }
  }
  return failures;
}

function urlDefinitionsForSecretPartScan(env) {
  const routeDefinitions = Object.entries(externalTopologyRouteSourceEnv).map(([route, envKeys]) => {
    const envKey = envKeys.find((key) => String(env[key] || '').trim()) || envKeys[0];
    return { role: `${route}Source`, envKey };
  });
  return [
    ...requiredExternalTopologyUrlRoles,
    ...optionalExternalTopologyUrlRoles,
    ...routeDefinitions,
  ];
}

function safeDecodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0838 evidence must contain one JSON report block');
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
