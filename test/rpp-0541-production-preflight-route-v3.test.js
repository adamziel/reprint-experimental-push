import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  authenticatedHttpClient,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/preflight`;
const credential = {
  username: 'rpp_0541_admin',
  password: 'rpp-0541-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0541_raw_session_id';
const signingKey = 'rpp-0541-raw-signing-key';
const idempotencyKey = 'idem-rpp-0541-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const staleExpiresAt = '2026-05-31T11:59:00Z';
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function basePreflightBody(overrides = {}) {
  return {
    ok: true,
    mode: 'preflight',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    auth: {
      identity: {
        userLogin: credential.username,
        userId: 541,
        capabilities: { manage_options: true },
      },
      session: {
        type: 'production-auth-session',
        status: 'active',
        id: sessionId,
        expiresAt: freshExpiresAt,
      },
    },
    session: {
      id: sessionId,
      type: 'production-auth-session',
      sessionHash: sha256Hex(sessionId),
      signingKeyHash: sha256Hex(signingKey),
    },
    sessionStore: {
      type: 'wp-options',
      retention: {
        sessionTtlSeconds: 300,
        nonceTtlSeconds: 300,
      },
    },
    snapshotHash: sha256Hex('rpp-0541-snapshot'),
    ...overrides,
  };
}

function buildPreflightRouteSupportEvidence({
  preflight = null,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
} = {}) {
  const body = preflight?.body || {};
  const session = body.auth?.session || {};
  const identity = body.auth?.identity || {};
  const routeProfile = body.routeProfile || {};
  const requestPath = preflight?.request?.pathname || null;
  const base = {
    schemaVersion: 1,
    slice: 'RPP-0541',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    mutationAttempted: false,
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(source),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: identity.userLogin ? sha256Hex(identity.userLogin) : null,
      sessionIdHash: session.id ? sha256Hex(session.id) : null,
      sessionExpiresAtHash: session.expiresAt ? sha256Hex(session.expiresAt) : null,
      sessionType: session.type || null,
      sessionStatus: session.status || null,
      manageOptions: identity.capabilities?.manage_options === true,
    },
    routeEvidence: {
      method: preflight?.request?.method || 'GET',
      endpointPath,
      requestPath,
      routeProfile: routeProfile.profile || null,
      restNamespace: routeProfile.restNamespace || null,
      routePrefix: routeProfile.routePrefix || null,
      labBacked: routeProfile.labBacked === true,
      proofHash: digest({
        method: preflight?.request?.method || 'GET',
        endpointPath,
        requestPath,
        routeProfile: routeProfile.profile || null,
        restNamespace: routeProfile.restNamespace || null,
        routePrefix: routeProfile.routePrefix || null,
        status: preflight?.status ?? null,
      }),
    },
    preflightSummary: {
      status: preflight?.status ?? null,
      ok: body.ok === true,
      code: body.code || null,
      mode: body.mode || null,
      sessionIdHash: body.session?.id ? sha256Hex(body.session.id) : null,
      sessionHashLength: String(body.session?.sessionHash || '').length,
      signingKeyHashLength: String(body.session?.signingKeyHash || '').length,
      snapshotHashLength: String(body.snapshotHash || '').length,
      proofHash: digest({
        status: preflight?.status ?? null,
        ok: body.ok === true,
        mode: body.mode || null,
        sessionType: session.type || null,
        sessionStatus: session.status || null,
        sessionIdHash: body.session?.id ? sha256Hex(body.session.id) : null,
        snapshotHash: body.snapshotHash || null,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local preflight route proof is support-only until production URL and credential proof exists',
    },
  };

  if (!preflight || preflight.status !== 200 || body.ok !== true || !body.session?.id) {
    return {
      ...base,
      ok: false,
      status: 'blocked',
      code: body.code || 'PREFLIGHT_PROOF_REQUIRED',
      boundary: {
        firstRemainingProductionBoundary: 'checked production-backed preflight route proof',
        status: 'blocked',
        verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
      },
    };
  }

  if (!isFreshProductionSession(session, evaluatedAt)) {
    return {
      ...base,
      ok: false,
      status: 'blocked',
      code: 'PREFLIGHT_PROOF_STALE',
      boundary: {
        firstRemainingProductionBoundary: 'fresh production preflight route proof',
        status: 'blocked',
        verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
      },
    };
  }

  return {
    ...base,
    ok: true,
    status: 'support_only',
    code: 'LOCAL_PREFLIGHT_ROUTE_SUPPORT_ONLY',
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed preflight route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function isFreshProductionSession(session, evaluatedAt) {
  return session?.type === 'production-auth-session'
    && session?.status === 'active'
    && typeof session.expiresAt === 'string'
    && Date.parse(session.expiresAt) > Date.parse(evaluatedAt);
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `support evidence leaked raw value ${rawValue}`,
    );
  }
}

test('RPP-0541 v3 accepts production-shaped local preflight route evidence as support-only', async () => {
  const originalFetch = global.fetch;
  const seen = [];

  global.fetch = async (url, options = {}) => {
    const request = {
      method: options.method || 'GET',
      pathname: new URL(String(url)).pathname,
      headers: Object.fromEntries(new Headers(options.headers || {}).entries()),
    };
    seen.push(request);
    assert.equal(request.method, 'GET');
    assert.equal(request.pathname, endpointPath);
    assert.ok(request.headers['x-auth-signature'], 'signed preflight must include signature evidence');
    assert.ok(request.headers['x-auth-nonce'], 'signed preflight must include nonce evidence');
    return jsonResponse(basePreflightBody());
  };

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight');
    const evidence = buildPreflightRouteSupportEvidence({ preflight });

    assert.equal(preflight.request.pathname, endpointPath);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.routePrefix, '/push');
    assert.equal(preflight.body.auth.session.type, 'production-auth-session');
    assert.equal(preflight.body.session.sessionHash.length, 64);
    assert.equal(preflight.body.session.signingKeyHash.length, 64);
    assert.equal(seen.length, 1);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(evidence.routeEvidence.labBacked, true);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.preflightSummary, ['sessionIdHash', 'proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      signingKey,
      idempotencyKey,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0541 v3 refuses missing and stale preflight proof before follow-up routes', async () => {
  const originalFetch = global.fetch;
  const staleSeen = [];
  const missingSeen = [];
  const emptySnapshot = { resources: [] };

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    missingSeen.push({ method: options.method || 'GET', pathname });
    assert.equal(pathname, endpointPath);
    return jsonResponse(basePreflightBody({ session: undefined }));
  };

  try {
    const missing = await runAuthenticatedHttpPush({
      sourceUrl,
      base: emptySnapshot,
      local: emptySnapshot,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      dryRunOnly: true,
      now: new Date(proofCapturedAt),
    });
    const missingEvidence = buildPreflightRouteSupportEvidence({
      preflight: null,
      evaluatedAt: proofCapturedAt,
    });

    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'PREFLIGHT_SESSION_MISSING');
    assert.equal('remoteSnapshot' in missing, false);
    assert.equal('dryRun' in missing, true);
    assert.equal(missing.dryRun, null);
    assert.deepEqual(missingSeen.map((entry) => entry.pathname), [endpointPath]);
    assert.equal(missingEvidence.ok, false);
    assert.equal(missingEvidence.status, 'blocked');
    assert.equal(missingEvidence.code, 'PREFLIGHT_PROOF_REQUIRED');
    assert.equal(missingEvidence.releaseStatus, 'NO-GO');
    assert.equal(missingEvidence.releaseMovement.allowed, false);
    assert.equal(missingEvidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

    global.fetch = async (url, options = {}) => {
      const pathname = new URL(String(url)).pathname;
      staleSeen.push({ method: options.method || 'GET', pathname });
      assert.equal(pathname, endpointPath);
      return jsonResponse(basePreflightBody({
        auth: {
          identity: {
            userLogin: credential.username,
            userId: 541,
            capabilities: { manage_options: true },
          },
          session: {
            type: 'production-auth-session',
            status: 'active',
            id: sessionId,
            expiresAt: staleExpiresAt,
          },
        },
      }));
    };

    const stale = await runAuthenticatedHttpPush({
      sourceUrl,
      base: emptySnapshot,
      local: emptySnapshot,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      dryRunOnly: true,
      now: new Date(proofCapturedAt),
    });

    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.equal(stale.authSession.required, 'unexpired');
    assert.equal(stale.boundary.verdict, 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED');
    assert.equal('remoteSnapshot' in stale, false);
    assert.equal('dryRun' in stale, true);
    assert.equal(stale.dryRun, null);
    assert.deepEqual(staleSeen.map((entry) => entry.pathname), [endpointPath]);

    const staleClient = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const stalePreflight = await staleClient.signedGet('/preflight');
    const staleEvidence = buildPreflightRouteSupportEvidence({
      preflight: stalePreflight,
      evaluatedAt: proofCapturedAt,
    });
    assert.equal(staleEvidence.ok, false);
    assert.equal(staleEvidence.status, 'blocked');
    assert.equal(staleEvidence.code, 'PREFLIGHT_PROOF_STALE');
    assert.equal(staleEvidence.releaseStatus, 'NO-GO');
    assert.equal(staleEvidence.releaseMovement.allowed, false);
    assert.equal(staleEvidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0541 v3 auth failure summaries remain hash-only and cannot move release', async () => {
  const originalFetch = global.fetch;
  const authFailure = {
    ok: false,
    code: 'SIGNED_HEADER_REQUIRED',
    evidence: {
      schemaVersion: 1,
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      sourceUrlHash: sha256Hex(sourceUrl),
      sessionHash: sha256Hex(sessionId),
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      mutationAttempted: false,
    },
  };

  global.fetch = async (url, options = {}) => {
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(new URL(String(url)).pathname, endpointPath);
    return jsonResponse(authFailure, 401);
  };

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight');
    const evidence = buildPreflightRouteSupportEvidence({ preflight });

    assert.equal(preflight.status, 401);
    assert.equal(evidence.ok, false);
    assert.equal(evidence.status, 'blocked');
    assert.equal(evidence.code, 'SIGNED_HEADER_REQUIRED');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.preflightSummary.status, 401);
    assert.equal(evidence.preflightSummary.ok, false);
    assertHashOnlyFields(authFailure.evidence, [
      'credentialHash',
      'sourceUrlHash',
      'sessionHash',
      'idempotencyKeyHash',
    ]);
    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, ['credentialHash']);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.preflightSummary, ['proofHash']);
    assertNoRawValues({
      evidence,
      authFailureEvidence: authFailure.evidence,
    }, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      signingKey,
      idempotencyKey,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
