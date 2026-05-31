import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authenticatedHttpClient,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'https://source.example.test/wp';
const unavailableLiveUrl = 'https://production-unavailable.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/preflight`;
const routeName = '/push/preflight';
const authScope = 'reprint-push-lab:authenticated-http-push';
const credential = {
  username: 'rpp_0561_admin',
  password: 'rpp-0561-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0561_raw_session_id';
const idempotencyKey = 'idem-rpp-0561-raw-idempotency-key';
const signedTimestamp = '1780000561';
const signedNonce = 'rpp0561acceptednonce';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const issuedAt = '2026-05-31T11:59:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const hashPattern = /^[a-f0-9]{64}$/;
const exactRouteEvidenceKeys = [
  'schemaVersion',
  'method',
  'endpointPath',
  'requestPath',
  'routeName',
  'routeProfile',
  'restNamespace',
  'routePrefix',
  'labBacked',
  'signed',
  'requiresLiveUrl',
  'requestPathMatchesEndpoint',
  'proofHash',
];

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function labSigningKey(value = credential) {
  return hmacHex(value.password, `reprint-push-lab-v1\n${value.username}`);
}

function basicAuth(value = credential) {
  return `Basic ${Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')}`;
}

function pushCanonicalString({ method, pathname, contentHash, session = '', idempotencyKey: key = '' }) {
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname,
    '',
    contentHash,
    session,
    key,
  ].join('\n');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sourceIdentity(url = sourceUrl) {
  const sourceUrlHash = sha256Hex(url);
  const identity = {
    sourceUrlHash,
    restNamespace: 'reprint/v1',
    routeProfile: 'production-shaped',
    routePrefix: '/push',
    labBacked: true,
  };
  return {
    ...identity,
    sourceHash: digest(identity),
  };
}

function authenticatedIdentity(overrides = {}) {
  const { capabilities, ...rest } = overrides;
  return {
    userId: 561,
    userLogin: credential.username,
    capabilities: {
      manage_options: true,
      ...(capabilities || {}),
    },
    ...rest,
  };
}

function preflightBody(overrides = {}) {
  const source = overrides.source || sourceIdentity();
  const identity = overrides.identity || authenticatedIdentity();
  const signingKeyHash = sha256Hex(labSigningKey());
  const credentialHash = sha256Hex(`${credential.username}\n${credential.password}`);
  const body = {
    ok: true,
    mode: 'preflight',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    auth: {
      schemaVersion: 1,
      scope: authScope,
      identity,
      session: {
        id: sessionId,
        type: 'production-auth-session',
        status: 'active',
        credentialHash,
        revoked: false,
        cleanedUp: false,
        expiresAt: freshExpiresAt,
      },
    },
    session: {
      type: 'production-auth-session',
      id: sessionId,
      sessionHash: sha256Hex(sessionId),
      userIdentityHash: digest({
        userId: identity.userId,
        userLogin: identity.userLogin,
      }),
      requiredCapability: 'manage_options',
      capabilityHash: sha256Hex('manage_options:true'),
      sourceHash: source.sourceHash,
      sourceUrlHash: source.sourceUrlHash,
      credentialHash,
      signingKeyHash,
      issuedAt,
      expiresAt: freshExpiresAt,
      receiptTtlSeconds: 300,
    },
    sessionStore: {
      type: 'wp-options',
      cleanup: [],
      retention: {
        sessionTtlSeconds: 300,
        nonceTtlSeconds: 300,
      },
    },
    snapshotHash: sha256Hex('rpp-0561-live-snapshot'),
  };

  return {
    ...body,
    ...overrides,
    auth: {
      ...body.auth,
      ...(overrides.auth || {}),
      identity: overrides.auth?.identity || body.auth.identity,
      session: {
        ...body.auth.session,
        ...(overrides.auth?.session || {}),
      },
    },
    session: {
      ...body.session,
      ...(overrides.session || {}),
    },
    routeProfile: {
      ...body.routeProfile,
      ...(overrides.routeProfile || {}),
    },
  };
}

function authenticatePreflightRequest({ method, pathname, headers, state }) {
  state.authAttempts += 1;
  if (headers.authorization !== basicAuth()) {
    return 'reprint_push_lab_auth_required';
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return 'SIGNED_HEADER_REQUIRED';
  }

  if (headers['x-reprint-push-session']) {
    return 'SIGNED_PREFLIGHT_SESSION_REJECTED';
  }

  if (headers['x-reprint-push-idempotency-key']) {
    return 'SIGNED_PREFLIGHT_IDEMPOTENCY_REJECTED';
  }

  const contentHash = sha256Hex('');
  if (headers['x-auth-content-hash'] !== contentHash) {
    return 'SIGNED_CONTENT_HASH_MISMATCH';
  }

  const signingKey = labSigningKey();
  const expectedAuthSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== expectedAuthSignature) {
    return 'SIGNED_AUTH_SIGNATURE_MISMATCH';
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return 'SIGNED_PUSH_SIGNATURE_MISMATCH';
  }

  return null;
}

function createLocalProductionPreflightRoute({ body = preflightBody(), status = 200 } = {}) {
  const state = {
    requests: [],
    phaseLog: [],
    authAttempts: 0,
    signedPreflightAttempts: 0,
    sessionMintAttempts: 0,
    snapshotHashAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    state.requests.push({
      method,
      pathname: requestUrl.pathname,
      headerNameHash: sha256Hex(Object.keys(headers).sort().join('\n')),
      contentHash: headers['x-auth-content-hash'] || null,
      idempotencyKeyPresent: Boolean(headers['x-reprint-push-idempotency-key']),
      sessionHeaderPresent: Boolean(headers['x-reprint-push-session']),
    });
    state.phaseLog.push('request-received');

    assert.equal(method, 'GET');
    assert.equal(requestUrl.pathname, endpointPath);

    state.signedPreflightAttempts += 1;
    state.phaseLog.push('auth-start');
    const authError = authenticatePreflightRequest({
      method,
      pathname: requestUrl.pathname,
      headers,
      state,
    });
    if (authError) {
      state.phaseLog.push(`auth-reject:${authError}`);
      return jsonResponse(preflightAuthFailureBody(authError, headers), authError === 'SIGNED_PREFLIGHT_IDEMPOTENCY_REJECTED' ? 400 : 401);
    }

    state.phaseLog.push('auth-accepted');
    state.sessionMintAttempts += 1;
    state.phaseLog.push('session-mint');
    state.snapshotHashAttempts += 1;
    state.phaseLog.push('snapshot-hash-read');

    return jsonResponse(body, status);
  }

  return { state, fetchHandler };
}

function preflightAuthFailureBody(code, headers) {
  return {
    ok: false,
    code,
    mode: 'preflight',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      nonceHash: headers['x-auth-nonce'] ? sha256Hex(headers['x-auth-nonce']) : null,
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      mutationAttempted: false,
    },
  };
}

function routeEvidenceFor({ preflight = null, unavailable = null } = {}) {
  const body = preflight?.body || {};
  const routeProfile = body.routeProfile || {};
  const method = preflight?.request?.method || unavailable?.request?.method || 'GET';
  const requestPath = preflight?.request?.pathname || unavailable?.request?.pathname || null;
  const routeEvidence = {
    schemaVersion: 1,
    method,
    endpointPath,
    requestPath,
    routeName,
    routeProfile: routeProfile.profile || 'production-shaped',
    restNamespace: routeProfile.restNamespace || 'reprint/v1',
    routePrefix: routeProfile.routePrefix || '/push',
    labBacked: routeProfile.labBacked === true,
    signed: Boolean(preflight?.request?.contentHash && preflight?.request?.canonicalHash),
    requiresLiveUrl: true,
    requestPathMatchesEndpoint: requestPath === endpointPath,
    proofHash: digest({
      method,
      endpointPath,
      requestPath,
      routeName,
      routeProfile: routeProfile.profile || 'production-shaped',
      restNamespace: routeProfile.restNamespace || 'reprint/v1',
      routePrefix: routeProfile.routePrefix || '/push',
      status: preflight?.status ?? unavailable?.status ?? null,
      transportFailure: unavailable?.transportFailure === true,
    }),
  };

  assert.deepEqual(Object.keys(routeEvidence), exactRouteEvidenceKeys);
  return routeEvidence;
}

function bindingStatus({ preflight = null, source = sourceUrl, evaluatedAt = proofCapturedAt } = {}) {
  const body = preflight?.body || {};
  const identity = body.auth?.identity || {};
  const authSession = body.auth?.session || {};
  const session = body.session || {};
  const routeProfile = body.routeProfile || {};
  const sourceHash = sourceIdentity(source);
  const routeOk = routeProfile.profile === 'production-shaped'
    && routeProfile.restNamespace === 'reprint/v1'
    && routeProfile.routePrefix === '/push';
  const identityOk = identity.userLogin === credential.username
    && identity.capabilities?.manage_options === true;
  const sessionOk = session.id === sessionId
    && authSession.id === session.id
    && session.type === 'production-auth-session'
    && authSession.type === 'production-auth-session'
    && authSession.status === 'active'
    && typeof authSession.expiresAt === 'string'
    && Date.parse(authSession.expiresAt) > Date.parse(evaluatedAt);
  const sourceOk = session.sourceHash === sourceHash.sourceHash
    && session.sourceUrlHash === sourceHash.sourceUrlHash;
  return {
    routeOk,
    identityOk,
    sessionOk,
    sourceOk,
    ok: routeOk && identityOk && sessionOk && sourceOk,
  };
}

function buildPreflightRouteSupportEvidence({
  preflight = null,
  unavailable = null,
  state = null,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
  productionUrlSupplied = false,
  productionCredentialsSupplied = false,
} = {}) {
  const body = preflight?.body || {};
  const identity = body.auth?.identity || {};
  const authSession = body.auth?.session || {};
  const session = body.session || {};
  const bindings = bindingStatus({ preflight, source, evaluatedAt });
  const accepted = preflight?.status === 200
    && body.ok === true
    && bindings.ok
    && state?.mutationCapableWorkAttempts === 0;
  const transportUnavailable = unavailable?.transportFailure === true;
  const status = accepted ? 'support_only' : 'blocked';
  const code = accepted
    ? 'LOCAL_PREFLIGHT_ROUTE_SUPPORT_ONLY'
    : (transportUnavailable ? 'LIVE_PREFLIGHT_ENDPOINT_UNAVAILABLE' : 'PREFLIGHT_AUTH_SESSION_SOURCE_BINDING_REQUIRED');
  const routeEvidence = routeEvidenceFor({ preflight, unavailable });
  const sourceHash = sourceIdentity(source);

  return {
    schemaVersion: 1,
    slice: 'RPP-0561',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status,
    ok: accepted,
    code,
    capturedAt,
    mutationAttempted: false,
    productionInputs: {
      liveEndpointRequired: true,
      productionUrlSupplied,
      productionCredentialsSupplied,
      liveEndpointChecked: accepted && productionUrlSupplied,
      liveEndpointAvailable: accepted && productionUrlSupplied,
      liveEndpointUrlHash: productionUrlSupplied ? sha256Hex(source) : null,
      rawUrlIncluded: false,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sourceHash.sourceUrlHash,
      sourceHash: session.sourceHash || sourceHash.sourceHash,
      restNamespaceHash: sha256Hex('reprint/v1'),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: identity.userLogin ? sha256Hex(identity.userLogin) : null,
      identityHash: identity.userLogin ? digest({
        userId: identity.userId,
        userLogin: identity.userLogin,
        manageOptions: identity.capabilities?.manage_options === true,
      }) : null,
      sessionIdHash: session.id ? sha256Hex(session.id) : null,
      sessionHash: session.sessionHash || null,
      sessionExpiresAtHash: authSession.expiresAt ? sha256Hex(authSession.expiresAt) : null,
      sourceHash: session.sourceHash || null,
      sourceUrlHash: session.sourceUrlHash || null,
      credentialBound: authSession.credentialHash === sha256Hex(`${credential.username}\n${credential.password}`),
      identityBound: bindings.identityOk,
      sessionBound: bindings.sessionOk,
      sourceBound: bindings.sourceOk,
      sessionType: authSession.type || null,
      sessionStatus: authSession.status || null,
      manageOptions: identity.capabilities?.manage_options === true,
      signingKeyHashLength: String(session.signingKeyHash || '').length,
    },
    routeEvidence,
    preflightSummary: {
      status: preflight?.status ?? unavailable?.status ?? null,
      ok: body.ok === true,
      mode: body.mode || null,
      sessionHashLength: String(session.sessionHash || '').length,
      sourceHashLength: String(session.sourceHash || '').length,
      sourceUrlHashLength: String(session.sourceUrlHash || '').length,
      signingKeyHashLength: String(session.signingKeyHash || '').length,
      snapshotHashLength: String(body.snapshotHash || '').length,
      noIdempotencyHeader: state ? state.requests.every((request) => request.idempotencyKeyPresent === false) : true,
      proofHash: digest({
        status: preflight?.status ?? unavailable?.status ?? null,
        ok: body.ok === true,
        mode: body.mode || null,
        sessionHash: session.sessionHash || null,
        sourceHash: session.sourceHash || null,
        sourceUrlHash: session.sourceUrlHash || null,
        snapshotHash: body.snapshotHash || null,
        code,
      }),
    },
    execution: {
      requestCount: state?.requests.length ?? 0,
      authAttempts: state?.authAttempts ?? 0,
      signedPreflightAttempts: state?.signedPreflightAttempts ?? 0,
      sessionMintAttempts: state?.sessionMintAttempts ?? 0,
      snapshotHashAttempts: state?.snapshotHashAttempts ?? 0,
      mutationCapableWorkAttempts: state?.mutationCapableWorkAttempts ?? 0,
      phaseHash: state ? sha256Hex(state.phaseLog.join('\n')) : null,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'production preflight route proof requires an available production-owned live URL and credentials',
    },
    boundary: {
      firstRemainingProductionBoundary: transportUnavailable
        ? 'available production-backed preflight route endpoint'
        : 'checked production-backed preflight route proof',
      status: 'blocked',
      verdict: accepted ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertHashOnlyWhenPresent(value, fields) {
  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined) {
      assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
    }
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

test('RPP-0561 v4 pins production preflight as a signed live-url-gated read-only route', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/preflight',
  );
  const callback = functionBody('reprint_push_lab_rest_authenticated_preflight');
  const routeProfile = functionBody('reprint_push_lab_rest_route_profile');
  const signedVerifier = functionBody('reprint_push_lab_rest_verify_signed_request');

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::READABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_preflight'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assert.match(routeProfile, /'profile'\s*=>\s*'production-shaped'/);
  assert.match(routeProfile, /'restNamespace'\s*=>\s*REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE/);
  assert.match(routeProfile, /'routePrefix'\s*=>\s*'\/push'/);

  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'preflight')",
    'reprint_push_lab_rest_auth_evidence($request)',
  );
  assertBefore(callback, 'return $signature_error;', 'reprint_push_lab_rest_auth_evidence($request)');
  assertBefore(callback, 'reprint_push_lab_rest_route_profile($request)', 'reprint_push_export_snapshot()');
  assert.match(signedVerifier, /if \(\$mode === 'preflight'\)/);
  assert.match(signedVerifier, /SIGNED_PREFLIGHT_SESSION_REJECTED/);
  assert.match(signedVerifier, /\$mode === 'preflight' \? '' : \$session_id/);
  assert.match(signedVerifier, /\$mode === 'preflight' \? '' : \$idempotency_key/);

  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_lab_rest_apply_with_db_journal',
    'reprint_push_protocol_validate_mutations_and_preconditions',
    'wp_insert_post',
    'wp_update_post',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(callback, new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.throws(
    () => authenticatedHttpClient({
      sourceUrl: 'http://non-loopback.example.test/wp',
      credential,
      routeProfile: 'production-shaped',
    }),
    /Unsupported production-shaped sourceUrl origin/,
  );
});

test('RPP-0561 v4 wraps accepted preflight evidence as support-only NO-GO with exact hash-only shape', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionPreflightRoute();

  global.fetch = route.fetchHandler;
  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight', {
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const evidence = buildPreflightRouteSupportEvidence({
      preflight,
      state: route.state,
    });

    assert.equal(preflight.status, 200);
    assert.equal(preflight.request.pathname, endpointPath);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.auth.session.id, preflight.body.session.id);
    assert.equal(preflight.body.session.sourceUrlHash, sha256Hex(sourceUrl));
    assert.equal(route.state.requests.length, 1);
    assert.equal(route.state.requests[0].sessionHeaderPresent, false);
    assert.equal(route.state.requests[0].idempotencyKeyPresent, false);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.code, 'LOCAL_PREFLIGHT_ROUTE_SUPPORT_ONLY');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.liveEndpointRequired, true);
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.productionInputs.liveEndpointChecked, false);
    assert.deepEqual(Object.keys(evidence.routeEvidence), exactRouteEvidenceKeys);
    assert.deepEqual(evidence.routeEvidence, {
      ...evidence.routeEvidence,
      schemaVersion: 1,
      method: 'GET',
      endpointPath,
      requestPath: endpointPath,
      routeName,
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
      signed: true,
      requiresLiveUrl: true,
      requestPathMatchesEndpoint: true,
    });
    assert.equal(evidence.authSummary.credentialBound, true);
    assert.equal(evidence.authSummary.identityBound, true);
    assert.equal(evidence.authSummary.sessionBound, true);
    assert.equal(evidence.authSummary.sourceBound, true);
    assert.equal(evidence.preflightSummary.noIdempotencyHeader, true);
    assert.equal(evidence.execution.mutationCapableWorkAttempts, 0);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

    assertHashOnlyFields(evidence.sourceSummary, [
      'sourceUrlHash',
      'sourceHash',
      'restNamespaceHash',
    ]);
    assertHashOnlyWhenPresent(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'identityHash',
      'sessionIdHash',
      'sessionHash',
      'sessionExpiresAtHash',
      'sourceHash',
      'sourceUrlHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.preflightSummary, ['proofHash']);
    assertHashOnlyFields(evidence.execution, ['phaseHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      labSigningKey(),
      idempotencyKey,
      signedNonce,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0561 v4 blocks auth session or source drift before release movement', async () => {
  const originalFetch = global.fetch;
  const negativeCases = [
    {
      name: 'auth-session-id-mismatch',
      body: preflightBody({
        auth: {
          session: {
            id: 'psh_rpp_0561_drifted_session_id',
          },
        },
      }),
    },
    {
      name: 'source-url-hash-mismatch',
      body: preflightBody({
        source: sourceIdentity('https://drifted-source.example.test/wp'),
      }),
    },
    {
      name: 'identity-mismatch',
      body: preflightBody({
        identity: authenticatedIdentity({
          userLogin: 'rpp_0561_drifted_admin',
        }),
      }),
    },
  ];

  try {
    for (const negativeCase of negativeCases) {
      const route = createLocalProductionPreflightRoute({ body: negativeCase.body });
      global.fetch = route.fetchHandler;
      const client = authenticatedHttpClient({
        sourceUrl,
        credential,
        routeProfile: 'production-shaped',
      });
      const preflight = await client.signedGet('/preflight', {
        timestamp: signedTimestamp,
        nonce: `${signedNonce}-${negativeCase.name}`,
      });
      const evidence = buildPreflightRouteSupportEvidence({
        preflight,
        state: route.state,
      });

      assert.equal(preflight.status, 200, negativeCase.name);
      assert.equal(evidence.ok, false, negativeCase.name);
      assert.equal(evidence.status, 'blocked', negativeCase.name);
      assert.equal(evidence.code, 'PREFLIGHT_AUTH_SESSION_SOURCE_BINDING_REQUIRED', negativeCase.name);
      assert.equal(evidence.releaseStatus, 'NO-GO', negativeCase.name);
      assert.equal(evidence.releaseMovement.allowed, false, negativeCase.name);
      assert.equal(evidence.mutationAttempted, false, negativeCase.name);
      assert.equal(evidence.execution.mutationCapableWorkAttempts, 0, negativeCase.name);
      assert.equal(evidence.boundary.verdict, 'PREFLIGHT_AUTH_SESSION_SOURCE_BINDING_REQUIRED', negativeCase.name);
      assert.equal(
        evidence.authSummary.identityBound
          && evidence.authSummary.sessionBound
          && evidence.authSummary.sourceBound,
        false,
        negativeCase.name,
      );
      assert.deepEqual(route.state.requests.map((request) => request.pathname), [endpointPath], negativeCase.name);
      assertNoRawValues(evidence, [
        sourceUrl,
        credential.username,
        credential.password,
        sessionId,
        labSigningKey(),
        idempotencyKey,
      ]);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0561 v4 fails closed when the required live preflight endpoint is unavailable', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    requests.push({
      method: options.method || 'GET',
      pathname: requestUrl.pathname,
      headers: headerEntries(options.headers || {}),
    });
    throw Object.assign(new TypeError('simulated unavailable live preflight endpoint'), {
      cause: { code: 'ECONNREFUSED' },
    });
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: unavailableLiveUrl,
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      dryRunOnly: true,
      now: new Date(proofCapturedAt),
    });
    const evidence = buildPreflightRouteSupportEvidence({
      unavailable: summary.preflight,
      source: unavailableLiveUrl,
      productionUrlSupplied: true,
      productionCredentialsSupplied: true,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'PREFLIGHT_FAILED');
    assert.equal(summary.preflight.transportFailure, true);
    assert.equal(summary.preflight.request.pathname, endpointPath);
    assert.equal(summary.dryRun, null);
    assert.equal(summary.apply, null);
    assert.equal('remoteSnapshot' in summary, false);
    assert.deepEqual(requests.map((request) => `${request.method} ${request.pathname}`), [
      `GET ${endpointPath}`,
    ]);

    assert.equal(evidence.ok, false);
    assert.equal(evidence.status, 'blocked');
    assert.equal(evidence.code, 'LIVE_PREFLIGHT_ENDPOINT_UNAVAILABLE');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.productionUrlSupplied, true);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, true);
    assert.equal(evidence.productionInputs.liveEndpointChecked, false);
    assert.equal(evidence.productionInputs.liveEndpointAvailable, false);
    assertHashOnlyFields(evidence.productionInputs, ['liveEndpointUrlHash']);
    assert.deepEqual(Object.keys(evidence.routeEvidence), exactRouteEvidenceKeys);
    assert.equal(evidence.routeEvidence.method, 'GET');
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPathMatchesEndpoint, true);
    assert.equal(evidence.boundary.verdict, 'LIVE_PREFLIGHT_ENDPOINT_UNAVAILABLE');
    assertNoRawValues(evidence, [
      unavailableLiveUrl,
      credential.username,
      credential.password,
      sessionId,
      labSigningKey(),
      idempotencyKey,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
