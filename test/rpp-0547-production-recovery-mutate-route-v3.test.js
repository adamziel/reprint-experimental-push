import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/mutate`;
const credential = {
  username: 'rpp_0547_admin',
  password: 'rpp-0547-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0547-wrong-application-password',
};
const sessionId = 'psh_rpp_0547_raw_session_id';
const invalidSessionId = 'psh_rpp_0547_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0547-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const proofStaleCapturedAt = '2026-05-31T11:49:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const staleExpiresAt = '2026-05-31T11:59:00Z';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0547acceptednonce';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const proofFreshnessMs = 5 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/;
const recoveryMutatePayload = {
  plan: {
    id: 'plan-rpp-0547-recovery-mutate',
    status: 'ready',
    mutations: [
      {
        resourceKey: 'wp_option:blogname',
        action: 'update',
      },
    ],
    conflicts: [],
    blockers: [],
  },
  receipt: {
    type: 'dry-run',
    receiptHash: `sha256:${sha256Hex('rpp-0547-dry-run-receipt')}`,
  },
};

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: key }) {
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

function signedRecoveryMutateHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
  contentType = 'application/json',
  authSignature,
  pushSignature,
  value = credential,
} = {}) {
  const signingKey = labSigningKey(value);
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency,
  });
  return {
    authorization: basicAuth(value),
    'content-type': contentType,
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': authSignature || hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`),
    'X-Reprint-Push-Signature': pushSignature || hmacHex(signingKey, canonical),
    ...(session === undefined ? {} : { 'X-Reprint-Push-Session': session }),
    ...(idempotency === undefined ? {} : { 'X-Reprint-Push-Idempotency-Key': idempotency }),
  };
}

function withoutHeader(headers, header) {
  const copy = { ...headers };
  delete copy[header];
  delete copy[header.toLowerCase()];
  return copy;
}

function createLocalProductionRecoveryMutateRoute() {
  const state = {
    requests: [],
    jsonParseAttempts: 0,
    recoveryInspectAttempts: 0,
    recoveryMutationWorkAttempts: 0,
    mutationSideEffects: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({ method, pathname: requestUrl.pathname, headers, rawBody });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleRecoveryMutateRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleRecoveryMutateRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse(authFailureBody(authError.code, headers, rawBody), authError.status);
  }

  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  state.recoveryInspectAttempts += 1;

  return jsonResponse(recoveryMutateNotImplementedBody({ payload, rawBody, headers }), 501);
}

function authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { code: 'SIGNED_HEADER_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-session']) {
    return { code: 'SIGNED_SESSION_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-idempotency-key']) {
    return { code: 'MISSING_IDEMPOTENCY_KEY', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'recovery-mutate',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      jsonParsed: false,
      recoveryInspectAttempted: false,
      mutationAttempted: false,
    },
  };
}

function recoveryMutateNotImplementedBody({ payload, rawBody, headers, expiresAt = freshExpiresAt }) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const signingKey = labSigningKey();
  const identity = {
    userLogin: credential.username,
    userId: 547,
    capabilities: { manage_options: true },
  };
  const sessionHash = sha256Hex(session);
  const signingKeyHash = sha256Hex(signingKey);
  const canonicalHash = sha256Hex(pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: key,
  }));
  const recoveryState = 'old-remote';

  return {
    ok: false,
    code: 'RECOVERY_MUTATE_NOT_IMPLEMENTED',
    message: 'Recovery mutate is authenticated and inspect-first, but this generated fixture has no repair executor.',
    mode: 'recovery-mutate',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    auth: {
      identity,
      session: {
        type: 'production-auth-session',
        status: 'active',
        id: session,
        expiresAt,
      },
    },
    recovery: {
      state: recoveryState,
      planHash: sha256Hex(JSON.stringify(payload.plan || {})),
      receiptHash: sha256Hex(JSON.stringify(payload.receipt || {})),
    },
    recoveryMutation: {
      schemaVersion: 1,
      route: '/push/recovery/mutate',
      inspectFirst: true,
      inspectState: recoveryState,
      inspectSafe: true,
      mutationAttempted: false,
      reason: 'route-plumbing-only-no-repair-executor',
      authFloor: 'application-password-basic + signed production push request + manage_options',
    },
    signedRequest: {
      signed: true,
      schemaVersion: 1,
      contentHash,
      nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
      sessionHash,
      signingKeyHash,
      request: {
        canonicalHash,
        idempotencyKeyHash: sha256Hex(key),
      },
    },
  };
}

function buildRecoveryMutateRouteSupportEvidence({
  recoveryMutate = null,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
} = {}) {
  const body = recoveryMutate?.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const session = body.auth?.session || {};
  const recoveryMutation = body.recoveryMutation || {};
  const signedRequest = body.signedRequest || {};
  const requestPath = recoveryMutate?.request?.pathname || null;
  const requestMethod = recoveryMutate?.request?.method || 'POST';
  const base = {
    schemaVersion: 1,
    slice: 'RPP-0547',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
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
      signedSessionHashLength: String(signedRequest.sessionHash || '').length,
      signingKeyHashLength: String(signedRequest.signingKeyHash || '').length,
      idempotencyKeyHash: signedRequest.request?.idempotencyKeyHash || null,
    },
    routeEvidence: {
      method: requestMethod,
      endpointPath,
      requestPath,
      routeProfile: routeProfile.profile || null,
      restNamespace: routeProfile.restNamespace || null,
      routePrefix: routeProfile.routePrefix || null,
      labBacked: routeProfile.labBacked === true,
      proofHash: digest({
        method: requestMethod,
        endpointPath,
        requestPath,
        routeProfile: routeProfile.profile || null,
        restNamespace: routeProfile.restNamespace || null,
        routePrefix: routeProfile.routePrefix || null,
        status: recoveryMutate?.status ?? null,
        mode: body.mode || null,
        code: body.code || null,
        capturedAt,
      }),
    },
    recoveryMutateSummary: {
      status: recoveryMutate?.status ?? null,
      ok: body.ok === true,
      code: body.code || null,
      mode: body.mode || null,
      inspectFirst: recoveryMutation.inspectFirst === true,
      inspectSafe: recoveryMutation.inspectSafe === true,
      inspectState: recoveryMutation.inspectState || null,
      mutationAttempted: recoveryMutation.mutationAttempted === true,
      signed: signedRequest.signed === true,
      canonicalHashLength: String(signedRequest.request?.canonicalHash || '').length,
      idempotencyKeyHashLength: String(signedRequest.request?.idempotencyKeyHash || '').length,
      proofHash: digest({
        status: recoveryMutate?.status ?? null,
        ok: body.ok === true,
        code: body.code || null,
        mode: body.mode || null,
        inspectFirst: recoveryMutation.inspectFirst === true,
        inspectSafe: recoveryMutation.inspectSafe === true,
        inspectState: recoveryMutation.inspectState || null,
        mutationAttempted: recoveryMutation.mutationAttempted === true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local recovery mutate route proof is support-only until production URL and credential proof exists',
    },
  };

  const acceptedFailClosed = recoveryMutate?.status === 501
    && body.code === 'RECOVERY_MUTATE_NOT_IMPLEMENTED'
    && body.mode === 'recovery-mutate'
    && recoveryMutation.inspectFirst === true
    && recoveryMutation.mutationAttempted === false;
  if (!acceptedFailClosed) {
    return blockedRecoveryMutateEvidence(base, body.code || 'RECOVERY_MUTATE_ROUTE_PROOF_REQUIRED');
  }

  if (!routeEvidenceIsFresh(capturedAt, evaluatedAt)) {
    return blockedRecoveryMutateEvidence(base, 'RECOVERY_MUTATE_ROUTE_PROOF_STALE');
  }

  if (!isFreshProductionSession(session, evaluatedAt)) {
    return blockedRecoveryMutateEvidence(base, 'RECOVERY_MUTATE_AUTH_SESSION_STALE');
  }

  return {
    ...base,
    ok: true,
    status: 'support_only',
    code: 'LOCAL_RECOVERY_MUTATE_ROUTE_SUPPORT_ONLY',
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed recovery mutate route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function blockedRecoveryMutateEvidence(base, code) {
  return {
    ...base,
    ok: false,
    status: 'blocked',
    code,
    boundary: {
      firstRemainingProductionBoundary: 'fresh production recovery mutate route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function routeEvidenceIsFresh(capturedAt, evaluatedAt) {
  return Date.parse(evaluatedAt) - Date.parse(capturedAt) <= proofFreshnessMs;
}

function isFreshProductionSession(session, evaluatedAt) {
  return session?.type === 'production-auth-session'
    && session?.status === 'active'
    && typeof session.expiresAt === 'string'
    && Date.parse(session.expiresAt) > Date.parse(evaluatedAt);
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0547',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status: 'blocked',
    mutationAttempted: false,
    sourceSummary: {
      sourceUrlHash: evidence.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHeaderHash: evidence.credentialHeaderHash,
      sessionIdHash: evidence.sessionIdHash,
      idempotencyKeyHash: evidence.idempotencyKeyHash,
    },
    routeEvidence: {
      method: 'POST',
      endpointPath,
      proofHash: digest({
        method: 'POST',
        endpointPath,
        status: response.status,
        code: response.body?.code || null,
      }),
    },
    negativeAuth: {
      status: response.status,
      code: response.body?.code || null,
      mode: response.body?.mode || null,
      payloadWouldFailIfParsed: true,
      jsonParsed: evidence.jsonParsed === true,
      recoveryInspectStarted: evidence.recoveryInspectAttempted === true,
      mutationSideEffectStarted: evidence.mutationAttempted === true,
      recoveryMutateEvidence: hasRecoveryMutateEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'authenticated production recovery mutate route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated recovery mutate route proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasRecoveryMutateEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.recovery
    || body.recoveryMutation
    || body.signedRequest
    || body.receipt?.type === 'recovery-mutate'
  );
}

async function requestLocalRoute(route, headers) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: malformedJsonBody,
  });
  return {
    status: response.status,
    body: await response.json(),
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

test('RPP-0547 v3 accepts fail-closed recovery mutate route evidence as support-only', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionRecoveryMutateRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const recoveryMutate = await client.signedPost('/recovery/mutate', recoveryMutatePayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const evidence = buildRecoveryMutateRouteSupportEvidence({ recoveryMutate });

    assert.equal(recoveryMutate.status, 501);
    assert.equal(recoveryMutate.request.pathname, endpointPath);
    assert.equal(recoveryMutate.request.method, 'POST');
    assert.equal(recoveryMutate.body.mode, 'recovery-mutate');
    assert.equal(recoveryMutate.body.code, 'RECOVERY_MUTATE_NOT_IMPLEMENTED');
    assert.equal(recoveryMutate.body.routeProfile.profile, 'production-shaped');
    assert.equal(recoveryMutate.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(recoveryMutate.body.routeProfile.routePrefix, '/push');
    assert.equal(recoveryMutate.body.recoveryMutation.inspectFirst, true);
    assert.equal(recoveryMutate.body.recoveryMutation.inspectSafe, true);
    assert.equal(recoveryMutate.body.recoveryMutation.mutationAttempted, false);
    assert.equal(route.state.jsonParseAttempts, 1);
    assert.equal(route.state.recoveryInspectAttempts, 1);
    assert.equal(route.state.recoveryMutationWorkAttempts, 0);
    assert.equal(route.state.mutationSideEffects, 0);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(evidence.routeEvidence.labBacked, true);
    assert.equal(evidence.recoveryMutateSummary.inspectFirst, true);
    assert.equal(evidence.recoveryMutateSummary.inspectSafe, true);
    assert.equal(evidence.recoveryMutateSummary.mutationAttempted, false);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'idempotencyKeyHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.recoveryMutateSummary, ['proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0547 v3 negative auth cases fail before JSON parsing or mutation side effects', async () => {
  const route = createLocalProductionRecoveryMutateRoute();
  const negativeCases = [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': malformedJsonBodyContentType,
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': malformedJsonBodyContentType,
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': malformedJsonBodyContentType,
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedRecoveryMutateHeaders({
          rawBody: malformedJsonBody,
          session: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-missing-idempotency-malformed-json',
      expectedStatus: 400,
      expectedCode: 'MISSING_IDEMPOTENCY_KEY',
      headers: withoutHeader(
        signedRecoveryMutateHeaders({
          rawBody: malformedJsonBody,
          idempotency: '',
          contentType: malformedJsonBodyContentType,
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
        contentType: malformedJsonBodyContentType,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestLocalRoute(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasRecoveryMutateEvidence(result), false, `${negativeCase.name} emitted recovery mutate evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.recoveryInspectStarted, false);
    assert.equal(summary.negativeAuth.mutationSideEffectStarted, false);
    assert.equal(summary.negativeAuth.recoveryMutateEvidence, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, ['proofHash']);
    assertHashOnlyFields(summary.negativeAuth, ['bodyHash']);
    assertHashOnlyWhenPresent(summary.authSummary, [
      'credentialHeaderHash',
      'sessionIdHash',
      'idempotencyKeyHash',
    ]);
    assertNoRawValues({
      response: result.body,
      summary,
    }, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      malformedJsonBody,
    ]);
  }

  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.recoveryInspectAttempts, 0);
  assert.equal(route.state.recoveryMutationWorkAttempts, 0);
  assert.equal(route.state.mutationSideEffects, 0);
});

test('RPP-0547 v3 refuses missing and stale recovery mutate evidence before release movement', () => {
  const rawBody = JSON.stringify(recoveryMutatePayload);
  const headers = signedRecoveryMutateHeaders({ rawBody });
  const acceptedResponse = {
    status: 501,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: recoveryMutateNotImplementedBody({ payload: recoveryMutatePayload, rawBody, headers }),
  };
  const missing = buildRecoveryMutateRouteSupportEvidence({
    recoveryMutate: null,
    evaluatedAt: proofCapturedAt,
  });
  const staleRoute = buildRecoveryMutateRouteSupportEvidence({
    recoveryMutate: acceptedResponse,
    capturedAt: proofStaleCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const staleSession = buildRecoveryMutateRouteSupportEvidence({
    recoveryMutate: {
      ...acceptedResponse,
      body: recoveryMutateNotImplementedBody({
        payload: recoveryMutatePayload,
        rawBody,
        headers,
        expiresAt: staleExpiresAt,
      }),
    },
    capturedAt: proofCapturedAt,
    evaluatedAt: proofCapturedAt,
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'RECOVERY_MUTATE_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(staleRoute.ok, false);
  assert.equal(staleRoute.status, 'blocked');
  assert.equal(staleRoute.code, 'RECOVERY_MUTATE_ROUTE_PROOF_STALE');
  assert.equal(staleRoute.releaseStatus, 'NO-GO');
  assert.equal(staleRoute.releaseMovement.allowed, false);
  assert.equal(staleRoute.mutationAttempted, false);
  assert.equal(staleRoute.boundary.firstRemainingProductionBoundary, 'fresh production recovery mutate route proof');

  assert.equal(staleSession.ok, false);
  assert.equal(staleSession.status, 'blocked');
  assert.equal(staleSession.code, 'RECOVERY_MUTATE_AUTH_SESSION_STALE');
  assert.equal(staleSession.releaseStatus, 'NO-GO');
  assert.equal(staleSession.releaseMovement.allowed, false);
  assert.equal(staleSession.mutationAttempted, false);
  assert.equal(staleSession.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assertHashOnlyFields(staleRoute.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(staleRoute.authSummary, [
    'credentialHash',
    'userLoginHash',
    'sessionIdHash',
    'sessionExpiresAtHash',
    'idempotencyKeyHash',
  ]);
  assertHashOnlyFields(staleRoute.routeEvidence, ['proofHash']);
  assertHashOnlyFields(staleRoute.recoveryMutateSummary, ['proofHash']);
  assertNoRawValues({
    missing,
    staleRoute,
    staleSession,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    wrongCredential.password,
    sessionId,
    invalidSessionId,
    idempotencyKey,
  ]);
});
