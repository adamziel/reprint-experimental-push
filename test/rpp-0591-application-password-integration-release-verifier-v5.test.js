import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const blueprintPath = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const releaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveVerifierSource = readFileSync(releaseVerifierPath, 'utf8');

const proofId = 'rpp-0591-application-password-release-verifier-v5';
const preflightEndpointPath = '/wp-json/reprint/v1/push/preflight';
const snapshotHashesEndpointPath = '/wp-json/reprint/v1/push/snapshot-hashes';
const preflightRouteIndexPath = '/reprint/v1/push/preflight';
const snapshotHashesRouteIndexPath = '/reprint/v1/push/snapshot-hashes';
const usersMeRouteIndexPath = '/wp/v2/users/me';
const authScope = 'reprint-push-lab:authenticated-http-push';
const checkedCommand = 'timeout 300s npm run verify:release';
const proofCapturedAt = '2026-06-01T00:00:00.000Z';
const idempotencyKey = 'idem-rpp-0591-live-snapshot-hashes-v5';
const startupTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0591_LIVE_TIMEOUT_MS || 120_000);
const requestTimeoutMs = Number(process.env.REPRINT_PUSH_RPP0591_REQUEST_TIMEOUT_MS || 30_000);
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9-]{36}$/;
const snapshotHashesPayload = {
  scope: {
    files: [],
    tables: [],
    plugins: true,
  },
  batch_size: 1000,
};
const scopedCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function credentialHash(credentials = scopedCredentials) {
  return sha256Hex(`${credentials.username}\n${credentials.password}`);
}

function sourceIdentityHash(sourceUrl) {
  return digest({
    sourceUrlHash: sha256Hex(sourceUrl),
    restNamespace: 'reprint/v1',
    routeProfile: 'production-shaped',
    routePrefix: '/push',
    labBacked: true,
  });
}

function sourceOrder(source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing source fragment: ${first}`);
  assert.notEqual(secondIndex, -1, `missing source fragment: ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function assertRoute(body, route, method) {
  const routeEntry = body?.routes?.[route];
  assert.ok(routeEntry, `REST index missing ${route}`);
  assert.ok(routeMethods(routeEntry).includes(method), `REST index route ${route} missing ${method}`);
}

function routeMethods(routeEntry) {
  return Array.isArray(routeEntry?.methods) ? routeEntry.methods.map(String) : [];
}

function authHeaders(credentials) {
  return {
    authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`,
  };
}

function supportCode({ coreUsersMe = null, preflight = null, snapshotHashes = null, sourceUrl = '' } = {}) {
  if (!coreUsersMe || !preflight || !snapshotHashes) {
    return 'APPLICATION_PASSWORD_LIVE_PROOF_REQUIRED';
  }

  const expectedCredentialHash = credentialHash();
  const authSession = preflight.body?.auth?.session || {};
  const session = preflight.body?.session || {};
  const snapshotAuthSession = snapshotHashes.body?.auth?.session || {};
  const sourceUrlHash = sourceUrl ? sha256Hex(sourceUrl) : '';
  const accepted = coreUsersMe.status === 200
    && coreUsersMe.body?.username === scopedCredentials.username
    && preflight.status === 200
    && preflight.request?.pathname === preflightEndpointPath
    && preflight.body?.ok === true
    && preflight.body?.mode === 'preflight'
    && preflight.body?.routeProfile?.profile === 'production-shaped'
    && preflight.body?.auth?.scope === authScope
    && preflight.body?.auth?.identity?.userLogin === scopedCredentials.username
    && preflight.body?.auth?.identity?.capabilities?.manage_options === true
    && authSession.type === 'production-auth-session'
    && authSession.status === 'active'
    && authSession.verifier === 'wordpress-core-application-password'
    && authSession.playgroundFallback === false
    && authSession.credentialScope === authScope
    && authSession.credentialType === 'push-application-password'
    && authSession.credentialHash === expectedCredentialHash
    && uuidPattern.test(String(authSession.applicationPasswordUuid || ''))
    && uuidPattern.test(String(authSession.applicationPasswordAppId || ''))
    && authSession.id === session.id
    && session.type === 'production-auth-session'
    && session.credentialHash === expectedCredentialHash
    && session.applicationPasswordUuid === authSession.applicationPasswordUuid
    && session.sourceUrlHash === sourceUrlHash
    && hashPattern.test(String(session.sessionHash || ''))
    && hashPattern.test(String(session.userIdentityHash || ''))
    && hashPattern.test(String(session.capabilityHash || ''))
    && hashPattern.test(String(session.sourceUrlHash || ''))
    && hashPattern.test(String(session.signingKeyHash || ''))
    && preflight.body?.sessionStore?.type === 'wp-options'
    && snapshotHashes.status === 200
    && snapshotHashes.request?.pathname === snapshotHashesEndpointPath
    && snapshotHashes.body?.ok === true
    && snapshotHashes.body?.mode === 'snapshot-hashes'
    && snapshotHashes.body?.planningOnly?.readOnly === true
    && snapshotHashes.body?.planningOnly?.mutates === false
    && snapshotAuthSession.id === session.id
    && snapshotAuthSession.type === 'production-auth-session'
    && snapshotAuthSession.status === 'active'
    && snapshotAuthSession.credentialHash === expectedCredentialHash
    && snapshotAuthSession.applicationPasswordUuid === authSession.applicationPasswordUuid
    && snapshotHashes.body?.receipt?.type === 'snapshot-hashes'
    && snapshotHashes.body?.receipt?.routeProfile === 'production-shaped'
    && snapshotHashes.body?.receipt?.restNamespace === 'reprint/v1'
    && snapshotHashes.body?.receipt?.route === '/push/snapshot-hashes'
    && snapshotHashes.body?.receipt?.authBinding?.sessionHash === snapshotHashes.body?.signedRequest?.sessionHash
    && snapshotHashes.body?.sessionStore?.type === 'wp-options';

  return accepted
    ? 'LIVE_APPLICATION_PASSWORD_RELEASE_VERIFIER_V5_SUPPORT_ONLY'
    : 'APPLICATION_PASSWORD_LIVE_PROOF_MALFORMED';
}

function buildApplicationPasswordReleaseVerifierReceipt({
  coreUsersMe = null,
  preflight = null,
  snapshotHashes = null,
  sourceUrl = '',
  port = 0,
  capturedAt = proofCapturedAt,
} = {}) {
  const code = supportCode({ coreUsersMe, preflight, snapshotHashes, sourceUrl });
  const ok = code === 'LIVE_APPLICATION_PASSWORD_RELEASE_VERIFIER_V5_SUPPORT_ONLY';
  const expectedCredentialHash = credentialHash();
  const preflightBody = preflight?.body || {};
  const snapshotBody = snapshotHashes?.body || {};
  const authIdentity = preflightBody.auth?.identity || {};
  const authSession = preflightBody.auth?.session || {};
  const session = preflightBody.session || {};
  const snapshotAuthSession = snapshotBody.auth?.session || {};
  const sourceUrlHash = sourceUrl ? sha256Hex(sourceUrl) : null;
  const liveEndpoint = {
    exercised: ok,
    liveUrlRequired: true,
    liveUrlChecked: ok,
    loopbackOnly: ok,
    sandboxIngressPort: 8080,
    transportHash: sha256Hex('http-loopback'),
    hostHash: sha256Hex('127.0.0.1'),
    loopbackPortHash: port ? sha256Hex(String(port)) : null,
    sourceUrlHash,
    preflightEndpointHash: sourceUrl ? sha256Hex(`${sourceUrl}${preflightEndpointPath}`) : null,
    snapshotHashesEndpointHash: sourceUrl ? sha256Hex(`${sourceUrl}${snapshotHashesEndpointPath}`) : null,
    exposure: 'sandbox-local-loopback-only',
    tunnel: 'none',
    rawUrlIncluded: false,
  };
  const credentialSessionEvidence = {
    status: ok ? 'bound' : 'blocked',
    verifierHash: authSession.verifier ? sha256Hex(authSession.verifier) : null,
    credentialScopeHash: authSession.credentialScope ? sha256Hex(authSession.credentialScope) : null,
    credentialTypeHash: authSession.credentialType ? sha256Hex(authSession.credentialType) : null,
    credentialHash: authSession.credentialHash || null,
    expectedCredentialHash,
    applicationPasswordUuidHash: authSession.applicationPasswordUuid
      ? sha256Hex(authSession.applicationPasswordUuid)
      : null,
    applicationPasswordAppIdHash: authSession.applicationPasswordAppId
      ? sha256Hex(authSession.applicationPasswordAppId)
      : null,
    userLoginHash: authIdentity.userLogin ? sha256Hex(authIdentity.userLogin) : null,
    identityHash: authIdentity.userLogin
      ? digest({
          userId: authIdentity.userId,
          userLogin: authIdentity.userLogin,
          manageOptions: authIdentity.capabilities?.manage_options === true,
        })
      : null,
    sessionIdHash: session.id ? sha256Hex(session.id) : null,
    preflightSessionHash: session.sessionHash || null,
    snapshotSignedSessionHash: snapshotBody.signedRequest?.sessionHash || null,
    snapshotSignedNestedSessionHash: snapshotBody.signedRequest?.session?.sessionHash || null,
    userIdentityHash: session.userIdentityHash || null,
    capabilityHash: session.capabilityHash || null,
    sourceHash: session.sourceHash || authSession.sourceHash || null,
    sourceIdentityShapeHash: sourceUrl ? sourceIdentityHash(sourceUrl) : null,
    sourceUrlHash: session.sourceUrlHash || sourceUrlHash,
    signingKeyHash: session.signingKeyHash || null,
    sessionTypeHash: session.type ? sha256Hex(session.type) : null,
    sessionStatusHash: authSession.status ? sha256Hex(authSession.status) : null,
    sameCredentialHashOnPreflight: authSession.credentialHash === expectedCredentialHash
      && session.credentialHash === expectedCredentialHash,
    sameCredentialHashOnSnapshot: snapshotAuthSession.credentialHash === expectedCredentialHash,
    sameApplicationPasswordUuid: Boolean(
      authSession.applicationPasswordUuid
      && snapshotAuthSession.applicationPasswordUuid === authSession.applicationPasswordUuid,
    ),
    sameSessionId: Boolean(session.id && snapshotAuthSession.id === session.id),
    sameSessionHashOnReceipt: Boolean(
      snapshotBody.receipt?.authBinding?.sessionHash
      && snapshotBody.receipt.authBinding.sessionHash === snapshotBody.signedRequest?.sessionHash,
    ),
    sourceUrlBound: Boolean(sourceUrlHash && session.sourceUrlHash === sourceUrlHash),
    manageOptions: authIdentity.capabilities?.manage_options === true,
    playgroundFallback: authSession.playgroundFallback === true,
    wpOptionsSessionStore: preflightBody.sessionStore?.type === 'wp-options'
      && snapshotBody.sessionStore?.type === 'wp-options',
  };
  const endpointEvidence = {
    coreUsersMeStatus: coreUsersMe?.status ?? null,
    preflightStatus: preflight?.status ?? null,
    snapshotHashesStatus: snapshotHashes?.status ?? null,
    preflightRequestPathHash: preflight?.request?.pathname ? sha256Hex(preflight.request.pathname) : null,
    snapshotHashesRequestPathHash: snapshotHashes?.request?.pathname
      ? sha256Hex(snapshotHashes.request.pathname)
      : null,
    routeProfileHash: preflightBody.routeProfile?.profile ? sha256Hex(preflightBody.routeProfile.profile) : null,
    restNamespaceHash: snapshotBody.receipt?.restNamespace ? sha256Hex(snapshotBody.receipt.restNamespace) : null,
    preflightModeHash: preflightBody.mode ? sha256Hex(preflightBody.mode) : null,
    snapshotHashesModeHash: snapshotBody.mode ? sha256Hex(snapshotBody.mode) : null,
    snapshotHashPresent: /^sha256:[a-f0-9]{64}$/.test(String(snapshotBody.snapshotHash || '')),
    snapshotHashSetHashPresent: /^sha256:[a-f0-9]{64}$/.test(String(snapshotBody.snapshotHashSetHash || '')),
    snapshotPlanningOnly: snapshotBody.planningOnly?.readOnly === true
      && snapshotBody.planningOnly?.mutates === false,
    signedSnapshotPost: Boolean(snapshotHashes?.request?.contentHash && snapshotHashes?.request?.canonicalHash),
    receiptRouteHash: snapshotBody.receipt?.route ? sha256Hex(snapshotBody.receipt.route) : null,
    idempotencyKeyHash: sha256Hex(idempotencyKey),
    proofHash: digest({
      code,
      coreUsersMeStatus: coreUsersMe?.status ?? null,
      preflightStatus: preflight?.status ?? null,
      snapshotHashesStatus: snapshotHashes?.status ?? null,
      preflightRequestPathHash: preflight?.request?.pathname ? sha256Hex(preflight.request.pathname) : null,
      snapshotHashesRequestPathHash: snapshotHashes?.request?.pathname
        ? sha256Hex(snapshotHashes.request.pathname)
        : null,
      sourceUrlHash,
      credentialHash: authSession.credentialHash || null,
      sessionHash: session.sessionHash || null,
      receiptAuthSessionHash: snapshotBody.receipt?.authBinding?.sessionHash || null,
      capturedAtHash: sha256Hex(capturedAt),
    }),
  };
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0591',
    proofIdHash: sha256Hex(proofId),
    proofClass: 'application-password-integration-release-verifier-v5',
    evidenceScope: 'release-verifier-live-endpoint-support',
    ok,
    releaseStatus: 'NO-GO',
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAtHash: sha256Hex(capturedAt),
    carriedThrough: {
      rpp0571LiveShapeHash: digest([
        'wordpress-core-application-password',
        'production-auth-session',
        'push-application-password',
        'wp-options session store',
        'snapshot-hashes receipt binding',
      ]),
      supportOnlyNoGo: true,
      releaseVerifierEnvelope: true,
    },
    redaction: {
      mode: 'hash-count-status-only',
      rawValuesIncluded: false,
      requestBodiesIncluded: false,
      rawCredentialsIncluded: false,
      rawSessionsIncluded: false,
      hashAlgorithm: 'sha256',
    },
    liveEndpoint,
    credentialSessionEvidence,
    endpointEvidence,
    counts: {
      coreUsersMeRequests: coreUsersMe ? 1 : 0,
      preflightRequests: preflight ? 1 : 0,
      snapshotHashesRequests: snapshotHashes ? 1 : 0,
      mutationCapableWorkAttempts: 0,
      rawValuesIncluded: 0,
      requestBodiesIncluded: 0,
    },
    mutationAttempted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('production-owned Application Password proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'production-owned Application Password integration proof on checked release verifier path',
      ),
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
    integrationRecommendation: {
      status: 'support-only',
      recommendationHash: sha256Hex(
        'carry as support evidence; do not move release until production-owned Application Password proof exists',
      ),
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(receipt) {
  const reason = receipt.ok === true ? 'PRODUCTION_EVIDENCE_REQUIRED' : receipt.code;
  const integrationSummary = {
    ok: receipt.ok === true,
    summaryPath: 'applicationPasswordIntegration',
    receiptHash: receipt.receiptHash,
    liveEndpoint: receipt.liveEndpoint,
    credentialSessionEvidence: receipt.credentialSessionEvidence,
    endpointEvidence: receipt.endpointEvidence,
    redaction: receipt.redaction,
    carriedThrough: receipt.carriedThrough,
    requiredHash: digest([
      'WordPress core Application Password authenticated on live URL',
      'production auth session issued by preflight',
      'snapshot-hashes route reuses the same session',
      'credential and session evidence are hashes/statuses only',
      'release movement remains blocked',
    ]),
    scopeHash: sha256Hex(receipt.evidenceScope),
  };
  const summaryCore = {
    schemaVersion: 1,
    slice: 'RPP-0591',
    proofIdHash: sha256Hex(proofId),
    evidenceSourceHash: sha256Hex('application-password-integration-release-verifier-v5'),
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarkerHash: sha256Hex(`[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`),
    mutationAttempted: false,
    applicationPasswordIntegration: integrationSummary,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex(receipt.ok === true
        ? 'production-owned Application Password proof required before release movement'
        : 'Application Password live proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'production-owned Application Password integration proof on checked release verifier path',
      ),
      status: 'blocked',
      verdict: reason,
    },
  };

  return {
    ...summaryCore,
    proofHash: digest(summaryCore),
  };
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} must be SHA-256-shaped`);
}

function assertHashOrNull(value, label) {
  if (value !== null && value !== undefined) {
    assertHash(value, label);
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(serialized.includes(rawValue), false, `RPP-0591 evidence leaked raw value: ${rawValue}`);
  }
}

function assertHashOnlyReleaseVerifierEvidence(value, rawValues) {
  assertEvidenceHasNoRawValues(value, { label: 'RPP-0591 release verifier Application Password proof' });
  assertNoRawValues(value, rawValues);
}

function assertNoCredentialLeak(...values) {
  const text = values
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
  assert.equal(text.includes(scopedCredentials.password), false, 'raw Application Password leaked');
  assert.equal(
    text.includes(Buffer.from(`${scopedCredentials.username}:${scopedCredentials.password}`, 'utf8').toString('base64')),
    false,
    'Basic token leaked',
  );
  assert.doesNotMatch(text, /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/);
}

test('RPP-0591 v5 keeps Application Password binding gates before live release verifier route work', () => {
  sourceOrder(
    liveVerifierSource,
    'const applicationPasswordBindingBlocker = resolveApplicationPasswordBindingBlocker(checkedExplicitAuthSessionSource);',
    'const liveBoundaryEnv = resolveCheckedLiveBoundaryEnv({',
  );
  sourceOrder(
    liveVerifierSource,
    'emitApplicationPasswordBindingGateAndExit(applicationPasswordBindingBlocker);',
    'const verify = runCheckedReleaseVerify(liveBoundaryEnv);',
  );
  assert.match(
    liveVerifierSource,
    /firstRemainingProductionBoundary: 'Application Password credential binding on the checked live release path'/,
  );
});

test('RPP-0591 v5 carries live Application Password endpoint proof through a release-verifier NO-GO envelope', { timeout: startupTimeoutMs + 75_000 }, async () => {
  await withPlaygroundServer(async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200, `REST index HTTP ${index.status}`);
    assertRoute(index.body, preflightRouteIndexPath, 'GET');
    assertRoute(index.body, snapshotHashesRouteIndexPath, 'POST');
    assertRoute(index.body, usersMeRouteIndexPath, 'GET');

    const coreUsersMe = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/wp/v2/users/me?context=edit',
      undefined,
      authHeaders(scopedCredentials),
    );
    assert.equal(coreUsersMe.status, 200, `core users/me HTTP ${coreUsersMe.status}`);
    assert.equal(coreUsersMe.body?.username, scopedCredentials.username);

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: scopedCredentials,
      routeProfile: 'production-shaped',
      requestTimeoutMs,
    });
    const preflight = await client.signedGet('/preflight');
    const session = preflight.body?.session?.id || '';
    const snapshotHashes = await client.signedPost('/snapshot-hashes', snapshotHashesPayload, {
      session,
      idempotencyKey,
    });
    const receipt = buildApplicationPasswordReleaseVerifierReceipt({
      coreUsersMe,
      preflight,
      snapshotHashes,
      sourceUrl: server.baseUrl,
      port: server.port,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);

    assert.equal(preflight.status, 200, `preflight HTTP ${preflight.status}`);
    assert.equal(preflight.request?.pathname, preflightEndpointPath);
    assert.equal(preflight.body?.auth?.session?.verifier, 'wordpress-core-application-password');
    assert.equal(preflight.body?.auth?.session?.credentialType, 'push-application-password');
    assert.equal(preflight.body?.auth?.session?.playgroundFallback, false);
    assert.equal(preflight.body?.auth?.session?.credentialHash, credentialHash());
    assert.equal(preflight.body?.session?.sourceUrlHash, sha256Hex(server.baseUrl));
    assert.match(preflight.body?.session?.sessionHash || '', hashPattern);
    assert.match(preflight.body?.session?.signingKeyHash || '', hashPattern);
    assert.equal(snapshotHashes.status, 200, `snapshot-hashes HTTP ${snapshotHashes.status}`);
    assert.equal(snapshotHashes.request?.pathname, snapshotHashesEndpointPath);
    assert.equal(snapshotHashes.body?.auth?.session?.id, session);
    assert.equal(snapshotHashes.body?.auth?.session?.credentialHash, credentialHash());
    assert.equal(snapshotHashes.body?.receipt?.authBinding?.sessionHash, snapshotHashes.body?.signedRequest?.sessionHash);
    assertNoCredentialLeak(preflight.body, snapshotHashes.body);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.code, 'LIVE_APPLICATION_PASSWORD_RELEASE_VERIFIER_V5_SUPPORT_ONLY');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.releaseMovement.gates, '0/4');
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.liveEndpoint.exercised, true);
    assert.equal(receipt.liveEndpoint.liveUrlChecked, true);
    assert.equal(receipt.liveEndpoint.loopbackOnly, true);
    assert.equal(receipt.liveEndpoint.sandboxIngressPort, 8080);
    assert.equal(receipt.liveEndpoint.exposure, 'sandbox-local-loopback-only');
    assert.equal(receipt.liveEndpoint.tunnel, 'none');
    assert.equal(receipt.redaction.mode, 'hash-count-status-only');
    assert.equal(receipt.redaction.rawValuesIncluded, false);
    assert.equal(receipt.redaction.rawCredentialsIncluded, false);
    assert.equal(receipt.redaction.rawSessionsIncluded, false);
    assert.equal(receipt.credentialSessionEvidence.status, 'bound');
    assert.equal(receipt.credentialSessionEvidence.credentialHash, credentialHash());
    assert.equal(receipt.credentialSessionEvidence.expectedCredentialHash, credentialHash());
    assert.equal(receipt.credentialSessionEvidence.sameCredentialHashOnPreflight, true);
    assert.equal(receipt.credentialSessionEvidence.sameCredentialHashOnSnapshot, true);
    assert.equal(receipt.credentialSessionEvidence.sameApplicationPasswordUuid, true);
    assert.equal(receipt.credentialSessionEvidence.sameSessionId, true);
    assert.equal(receipt.credentialSessionEvidence.sameSessionHashOnReceipt, true);
    assert.equal(receipt.credentialSessionEvidence.sourceUrlBound, true);
    assert.equal(receipt.credentialSessionEvidence.manageOptions, true);
    assert.equal(receipt.credentialSessionEvidence.playgroundFallback, false);
    assert.equal(receipt.credentialSessionEvidence.wpOptionsSessionStore, true);
    assert.equal(receipt.endpointEvidence.coreUsersMeStatus, 200);
    assert.equal(receipt.endpointEvidence.preflightStatus, 200);
    assert.equal(receipt.endpointEvidence.snapshotHashesStatus, 200);
    assert.equal(receipt.endpointEvidence.snapshotPlanningOnly, true);
    assert.equal(receipt.endpointEvidence.signedSnapshotPost, true);
    assert.deepEqual(receipt.counts, {
      coreUsersMeRequests: 1,
      preflightRequests: 1,
      snapshotHashesRequests: 1,
      mutationCapableWorkAttempts: 0,
      rawValuesIncluded: 0,
      requestBodiesIncluded: 0,
    });
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(receipt.integrationRecommendation.status, 'support-only');

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.releaseMovement.gates, '0/4');
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.applicationPasswordIntegration.ok, true);
    assert.equal(verifyReleaseSummary.applicationPasswordIntegration.receiptHash, receipt.receiptHash);
    assert.equal(
      verifyReleaseSummary.applicationPasswordIntegration.endpointEvidence.proofHash,
      receipt.endpointEvidence.proofHash,
    );

    assertHash(receipt.liveEndpoint.transportHash, 'transport hash');
    assertHash(receipt.liveEndpoint.hostHash, 'host hash');
    assertHash(receipt.liveEndpoint.loopbackPortHash, 'loopback port hash');
    assertHash(receipt.liveEndpoint.sourceUrlHash, 'source URL hash');
    assertHash(receipt.liveEndpoint.preflightEndpointHash, 'preflight endpoint hash');
    assertHash(receipt.liveEndpoint.snapshotHashesEndpointHash, 'snapshot-hashes endpoint hash');
    assertHash(receipt.credentialSessionEvidence.verifierHash, 'verifier hash');
    assertHash(receipt.credentialSessionEvidence.credentialScopeHash, 'credential scope hash');
    assertHash(receipt.credentialSessionEvidence.credentialTypeHash, 'credential type hash');
    assertHash(receipt.credentialSessionEvidence.credentialHash, 'credential hash');
    assertHash(receipt.credentialSessionEvidence.applicationPasswordUuidHash, 'Application Password UUID hash');
    assertHash(receipt.credentialSessionEvidence.applicationPasswordAppIdHash, 'Application Password app ID hash');
    assertHash(receipt.credentialSessionEvidence.userLoginHash, 'user login hash');
    assertHash(receipt.credentialSessionEvidence.identityHash, 'identity hash');
    assertHash(receipt.credentialSessionEvidence.sessionIdHash, 'session id hash');
    assertHash(receipt.credentialSessionEvidence.preflightSessionHash, 'preflight session hash');
    assertHash(receipt.credentialSessionEvidence.snapshotSignedSessionHash, 'snapshot signed session hash');
    assertHash(receipt.credentialSessionEvidence.snapshotSignedNestedSessionHash, 'snapshot signed nested session hash');
    assertHash(receipt.credentialSessionEvidence.userIdentityHash, 'user identity hash');
    assertHash(receipt.credentialSessionEvidence.capabilityHash, 'capability hash');
    assertHashOrNull(receipt.credentialSessionEvidence.sourceHash, 'source hash');
    assertHash(receipt.credentialSessionEvidence.sourceIdentityShapeHash, 'source identity shape hash');
    assertHash(receipt.credentialSessionEvidence.sourceUrlHash, 'credential session source URL hash');
    assertHash(receipt.credentialSessionEvidence.signingKeyHash, 'signing key hash');
    assertHash(receipt.endpointEvidence.preflightRequestPathHash, 'preflight request path hash');
    assertHash(receipt.endpointEvidence.snapshotHashesRequestPathHash, 'snapshot-hashes request path hash');
    assertHash(receipt.endpointEvidence.routeProfileHash, 'route profile hash');
    assertHash(receipt.endpointEvidence.restNamespaceHash, 'REST namespace hash');
    assertHash(receipt.endpointEvidence.preflightModeHash, 'preflight mode hash');
    assertHash(receipt.endpointEvidence.snapshotHashesModeHash, 'snapshot-hashes mode hash');
    assertHash(receipt.endpointEvidence.receiptRouteHash, 'receipt route hash');
    assertHash(receipt.endpointEvidence.idempotencyKeyHash, 'idempotency key hash');
    assertHash(receipt.endpointEvidence.proofHash, 'endpoint proof hash');
    assertHash(receipt.receiptHash, 'receipt hash');
    assertHash(verifyReleaseSummary.proofHash, 'verify release summary proof hash');
    assertHashOnlyReleaseVerifierEvidence(verifyReleaseSummary, [
      server.baseUrl,
      `${server.baseUrl}${preflightEndpointPath}`,
      `${server.baseUrl}${snapshotHashesEndpointPath}`,
      scopedCredentials.username,
      scopedCredentials.password,
      Buffer.from(`${scopedCredentials.username}:${scopedCredentials.password}`, 'utf8').toString('base64'),
      session,
      preflight.body?.auth?.session?.applicationPasswordUuid,
      preflight.body?.auth?.session?.applicationPasswordAppId,
      idempotencyKey,
    ]);
  });
});

test('RPP-0591 v5 blocks missing live Application Password evidence before release movement', () => {
  const receipt = buildApplicationPasswordReleaseVerifierReceipt();
  const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);

  assert.equal(receipt.ok, false);
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.code, 'APPLICATION_PASSWORD_LIVE_PROOF_REQUIRED');
  assert.equal(receipt.releaseStatus, 'NO-GO');
  assert.equal(receipt.releaseMovement.allowed, false);
  assert.equal(receipt.mutationAttempted, false);
  assert.equal(receipt.boundary.verdict, 'APPLICATION_PASSWORD_LIVE_PROOF_REQUIRED');
  assert.equal(verifyReleaseSummary.ok, false);
  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'APPLICATION_PASSWORD_LIVE_PROOF_REQUIRED');
  assertHashOnlyReleaseVerifierEvidence(verifyReleaseSummary, [
    scopedCredentials.username,
    scopedCredentials.password,
    Buffer.from(`${scopedCredentials.username}:${scopedCredentials.password}`, 'utf8').toString('base64'),
  ]);
});

async function withPlaygroundServer(run) {
  const server = await startPlaygroundServer();
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer() {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: scopedCredentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: scopedCredentials.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  try {
    await waitForServer(child, baseUrl, logs);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { port, baseUrl, child, logs };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve();
    }
    child.once('exit', onExit);
  });
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${redactLogs(logs)}`);
    }

    try {
      const index = await requestJson(baseUrl, 'GET', '/wp-json/', undefined, {}, { attempts: 1 });
      if (
        index.status === 200
        && index.body?.routes?.[preflightRouteIndexPath]
        && index.body?.routes?.[snapshotHashesRouteIndexPath]
      ) {
        return;
      }
      lastError = new Error(`REST index not ready; HTTP ${index.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at local loopback: ${lastError?.message || 'unknown'}\n${redactLogs(logs)}`);
}

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = 4 } = {}) {
  let lastError;
  const maxAttempts = method === 'GET' ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestJsonOnce(baseUrl, method, pathname, body, headers);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientFetchError(error)) {
        throw error;
      }
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function requestJsonOnce(baseUrl, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined
      ? { connection: 'close', ...headers }
      : { 'content-type': 'application/json', connection: 'close', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function isTransientFetchError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = error.cause?.code || error.code;
  return error.name === 'TypeError' && (
    code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
  );
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.join('').length > 20_000) {
    logs.splice(0, logs.length, logs.join('').slice(-20_000));
  }
}

function redactLogs(logs) {
  return logs.join('')
    .replaceAll(scopedCredentials.password, '<redacted>')
    .replaceAll(
      Buffer.from(`${scopedCredentials.username}:${scopedCredentials.password}`, 'utf8').toString('base64'),
      '<redacted-basic-token>',
    );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
