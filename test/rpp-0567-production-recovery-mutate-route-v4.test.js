import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/mutate`;
const credential = {
  username: 'rpp_0567_admin',
  password: 'rpp-0567-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0567-wrong-application-password',
};
const sessionId = 'psh_rpp_0567_raw_session_id';
const expiredSessionId = 'psh_rpp_0567_expired_session_id';
const bindingMismatchSessionId = 'psh_rpp_0567_binding_mismatch_session_id';
const invalidSessionId = 'psh_rpp_0567_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0567-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T13:00:00Z';
const freshExpiresAt = '2026-05-31T13:04:00Z';
const expiredAt = '2026-05-31T12:59:00Z';
const verificationUnix = 1_780_000_000;
const signedTimestamp = String(verificationUnix);
const staleSignedTimestamp = String(verificationUnix - 600);
const signedNonce = 'rpp0567acceptednonce';
const invalidNonce = 'short';
const malformedJsonBody = '{"plan":';
const malformedJsonBodyContentType = 'text/plain';
const hashPattern = /^[a-f0-9]{64}$/;
const recoveryMutatePayload = {
  plan: {
    id: 'plan-rpp-0567-recovery-mutate',
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
    receiptHash: `sha256:${sha256Hex('rpp-0567-dry-run-receipt')}`,
  },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function credentialHash(value = credential) {
  return sha256Hex(`${value.username}\n${value.password}`);
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

function createLocalProductionRecoveryMutateAuthRoute() {
  const state = {
    requests: [],
    authorizationAccepted: 0,
    jsonParseAttempts: 0,
    recoveryMutationSetupAttempts: 0,
    journalMutationAttempts: 0,
    applyCapableWorkAttempts: 0,
    mutationSideEffects: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({
      method,
      pathnameHash: sha256Hex(requestUrl.pathname),
      headerCount: Object.keys(headers).length,
      bodyHash: sha256Hex(rawBody),
    });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleRecoveryMutateAuthRequest({
      method,
      pathname: requestUrl.pathname,
      headers,
      rawBody,
      state,
    });
  }

  return { state, fetchHandler };
}

function handleRecoveryMutateAuthRequest({ method, pathname, headers, rawBody, state }) {
  const authResult = authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody });
  if (!authResult.ok) {
    return jsonResponse(authFailureBody(authResult.code, headers, rawBody), authResult.status);
  }

  state.authorizationAccepted += 1;
  return jsonResponse(acceptedAuthOnlyBody({ auth: authResult.auth, headers, rawBody }), 202);
}

function authenticateRecoveryMutateRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { ok: false, code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { ok: false, code: 'SIGNED_HEADER_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-session']) {
    return { ok: false, code: 'SIGNED_SESSION_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-idempotency-key']) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', status: 400 };
  }

  if (!/^[a-f0-9]{64}$/.test(headers['x-auth-content-hash'])) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_INVALID', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { ok: false, code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const timestampSeconds = parseSignedTimestamp(headers['x-auth-timestamp']);
  if (timestampSeconds === null || Math.abs(verificationUnix - timestampSeconds) > 300) {
    return { ok: false, code: 'SIGNED_TIMESTAMP_INVALID', status: 401 };
  }

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(headers['x-auth-nonce'])) {
    return { ok: false, code: 'SIGNED_NONCE_INVALID', status: 400 };
  }

  const signingKey = labSigningKey();
  const signingKeyHash = sha256Hex(signingKey);
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { ok: false, code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  const session = recoveryAuthSession(headers['x-reprint-push-session']);
  if (!session) {
    return { ok: false, code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  if (Date.parse(session.expiresAt) <= Date.parse(proofCapturedAt)) {
    return { ok: false, code: 'SIGNED_SESSION_EXPIRED', status: 401 };
  }

  if (
    session.credentialHash !== credentialHash()
    || session.signingKeyHash !== signingKeyHash
    || session.sourceUrlHash !== sha256Hex(sourceUrl)
    || session.userLoginHash !== sha256Hex(credential.username)
  ) {
    return { ok: false, code: 'SIGNED_SESSION_BINDING_MISMATCH', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'],
    idempotencyKey: headers['x-reprint-push-idempotency-key'],
  });
  const expectedPushSignature = hmacHex(signingKey, canonical);
  if (headers['x-reprint-push-signature'] !== expectedPushSignature) {
    return { ok: false, code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return {
    ok: true,
    auth: {
      contentHash,
      timestampHash: sha256Hex(headers['x-auth-timestamp']),
      nonceHash: sha256Hex(headers['x-auth-nonce']),
      credentialHash: credentialHash(),
      userLoginHash: sha256Hex(credential.username),
      signingKeyHash,
      sourceUrlHash: sha256Hex(sourceUrl),
      sessionIdHash: sha256Hex(headers['x-reprint-push-session']),
      sessionExpiresAtHash: sha256Hex(session.expiresAt),
      idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key']),
      canonicalHash: sha256Hex(canonical),
      authSignatureHash: sha256Hex(authSignature),
      pushSignatureHash: sha256Hex(expectedPushSignature),
    },
  };
}

function parseSignedTimestamp(value) {
  return /^\d{10}$/.test(value) ? Number(value) : null;
}

function recoveryAuthSession(value) {
  const base = {
    credentialHash: credentialHash(),
    signingKeyHash: sha256Hex(labSigningKey()),
    sourceUrlHash: sha256Hex(sourceUrl),
    userLoginHash: sha256Hex(credential.username),
    expiresAt: freshExpiresAt,
  };

  if (value === sessionId) {
    return base;
  }

  if (value === expiredSessionId) {
    return {
      ...base,
      expiresAt: expiredAt,
    };
  }

  if (value === bindingMismatchSessionId) {
    return {
      ...base,
      credentialHash: credentialHash(wrongCredential),
    };
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
      routePathHash: sha256Hex(endpointPath),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      contentTypeHash: headers['content-type'] ? sha256Hex(headers['content-type']) : null,
      contentHashHeaderHash: headers['x-auth-content-hash']
        ? sha256Hex(headers['x-auth-content-hash'])
        : null,
      timestampHash: headers['x-auth-timestamp'] ? sha256Hex(headers['x-auth-timestamp']) : null,
      nonceHash: headers['x-auth-nonce'] ? sha256Hex(headers['x-auth-nonce']) : null,
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      jsonParsed: false,
      recoveryMutationSetupAttempted: false,
      journalMutationAttempted: false,
      applyCapableWorkAttempted: false,
      mutationAttempted: false,
    },
  };
}

function acceptedAuthOnlyBody({ auth, rawBody }) {
  return {
    ok: true,
    code: 'RECOVERY_MUTATE_AUTHORIZED_SUPPORT_ONLY',
    mode: 'recovery-mutate',
    releaseStatus: 'NO-GO',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefixHash: sha256Hex('/push'),
      routePathHash: sha256Hex(endpointPath),
      labBacked: true,
    },
    authorization: {
      schemaVersion: 1,
      status: 'accepted',
      capturedAtHash: sha256Hex(proofCapturedAt),
      bodyHash: sha256Hex(rawBody),
      ...auth,
    },
    recoveryMutationAuthorization: {
      authorizationOnly: true,
      jsonParsed: false,
      recoveryMutationSetupAttempted: false,
      journalMutationAttempted: false,
      applyCapableWorkAttempted: false,
      mutationAttempted: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local authorization-only recovery mutate route proof cannot move release gates',
    },
  };
}

function summarizeAcceptedAuthSupportEvidence(response) {
  const body = response.body || {};
  const authorization = body.authorization || {};
  const recoveryAuth = body.recoveryMutationAuthorization || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0567',
    proofClass: 'production-shaped-local-recovery-mutate-auth-floor',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status: body.ok === true ? 'support_only' : 'blocked',
    mutationAttempted: false,
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: authorization.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: authorization.credentialHash,
      userLoginHash: authorization.userLoginHash,
      sessionIdHash: authorization.sessionIdHash,
      sessionExpiresAtHash: authorization.sessionExpiresAtHash,
      signingKeyHash: authorization.signingKeyHash,
      nonceHash: authorization.nonceHash,
      idempotencyKeyHash: authorization.idempotencyKeyHash,
      canonicalHash: authorization.canonicalHash,
      bodyHash: authorization.bodyHash,
    },
    routeEvidence: {
      methodHash: sha256Hex(response.request?.method || 'POST'),
      routePathHash: body.routeProfile?.routePathHash || null,
      profileHash: sha256Hex(body.routeProfile?.profile || ''),
      proofHash: digest({
        method: response.request?.method || 'POST',
        routePathHash: body.routeProfile?.routePathHash || null,
        status: response.status,
        code: body.code || null,
        authStatus: authorization.status || null,
      }),
    },
    recoveryMutationAuthorization: {
      authorized: authorization.status === 'accepted',
      authorizationOnly: recoveryAuth.authorizationOnly === true,
      jsonParsed: recoveryAuth.jsonParsed === true,
      recoveryMutationSetupStarted: recoveryAuth.recoveryMutationSetupAttempted === true,
      journalMutationStarted: recoveryAuth.journalMutationAttempted === true,
      applyCapableWorkStarted: recoveryAuth.applyCapableWorkAttempted === true,
      mutationAttempted: recoveryAuth.mutationAttempted === true,
      proofHash: digest({
        authorized: authorization.status === 'accepted',
        authorizationOnly: recoveryAuth.authorizationOnly === true,
        jsonParsed: recoveryAuth.jsonParsed === true,
        recoveryMutationSetupStarted: recoveryAuth.recoveryMutationSetupAttempted === true,
        journalMutationStarted: recoveryAuth.journalMutationAttempted === true,
        applyCapableWorkStarted: recoveryAuth.applyCapableWorkAttempted === true,
        mutationAttempted: recoveryAuth.mutationAttempted === true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'production-backed recovery mutate authorization proof is still required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0567',
    proofClass: 'production-shaped-local-recovery-mutate-auth-floor',
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
      nonceHash: evidence.nonceHash,
      timestampHash: evidence.timestampHash,
      contentHashHeaderHash: evidence.contentHashHeaderHash,
    },
    routeEvidence: {
      methodHash: sha256Hex('POST'),
      routePathHash: evidence.routePathHash,
      proofHash: digest({
        method: 'POST',
        routePathHash: evidence.routePathHash,
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
      recoveryMutationSetupStarted: evidence.recoveryMutationSetupAttempted === true,
      journalMutationStarted: evidence.journalMutationAttempted === true,
      applyCapableWorkStarted: evidence.applyCapableWorkAttempted === true,
      mutationSideEffectStarted: evidence.mutationAttempted === true,
      recoveryMutationEvidence: hasRecoveryMutationEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'negative recovery mutate auth proof cannot move release gates',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production-backed recovery mutate authorization and executor proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasRecoveryMutationEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.recovery
    || body.recoveryMutation
    || body.recoveryMutationAuthorization
    || body.dbJournal
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

function assertNoRecoveryMutationBoundaryWork(state) {
  assert.equal(state.jsonParseAttempts, 0);
  assert.equal(state.recoveryMutationSetupAttempts, 0);
  assert.equal(state.journalMutationAttempts, 0);
  assert.equal(state.applyCapableWorkAttempts, 0);
  assert.equal(state.mutationSideEffects, 0);
}

test('RPP-0567 v4 accepts local recovery mutate authorization as support-only hash evidence', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionRecoveryMutateAuthRoute();
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
    const evidence = summarizeAcceptedAuthSupportEvidence(recoveryMutate);

    assert.equal(recoveryMutate.status, 202);
    assert.equal(recoveryMutate.request.pathname, endpointPath);
    assert.equal(recoveryMutate.request.method, 'POST');
    assert.equal(recoveryMutate.body.ok, true);
    assert.equal(recoveryMutate.body.code, 'RECOVERY_MUTATE_AUTHORIZED_SUPPORT_ONLY');
    assert.equal(recoveryMutate.body.mode, 'recovery-mutate');
    assert.equal(recoveryMutate.body.routeProfile.profile, 'production-shaped');
    assert.equal(recoveryMutate.body.releaseStatus, 'NO-GO');
    assert.equal(recoveryMutate.body.releaseMovement.allowed, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.authorizationOnly, true);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.jsonParsed, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.recoveryMutationSetupAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.journalMutationAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.applyCapableWorkAttempted, false);
    assert.equal(recoveryMutate.body.recoveryMutationAuthorization.mutationAttempted, false);
    assert.equal(route.state.authorizationAccepted, 1);
    assertNoRecoveryMutationBoundaryWork(route.state);

    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.redaction.format, 'hash-only');
    assert.equal(evidence.redaction.rawValuesIncluded, false);
    assert.equal(evidence.recoveryMutationAuthorization.authorized, true);
    assert.equal(evidence.recoveryMutationAuthorization.authorizationOnly, true);
    assert.equal(evidence.recoveryMutationAuthorization.jsonParsed, false);
    assert.equal(evidence.recoveryMutationAuthorization.recoveryMutationSetupStarted, false);
    assert.equal(evidence.recoveryMutationAuthorization.journalMutationStarted, false);
    assert.equal(evidence.recoveryMutationAuthorization.applyCapableWorkStarted, false);
    assert.equal(evidence.recoveryMutationAuthorization.mutationAttempted, false);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'signingKeyHash',
      'nonceHash',
      'idempotencyKeyHash',
      'canonicalHash',
      'bodyHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, [
      'methodHash',
      'routePathHash',
      'profileHash',
      'proofHash',
    ]);
    assertHashOnlyFields(evidence.recoveryMutationAuthorization, ['proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      endpointPath,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      expiredSessionId,
      bindingMismatchSessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0567 v4 negative recovery mutate auth fails before parse setup journal or apply work', async () => {
  const route = createLocalProductionRecoveryMutateAuthRoute();
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
      name: 'valid-auth-content-hash-invalid-malformed-json',
      expectedStatus: 400,
      expectedCode: 'SIGNED_CONTENT_HASH_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        contentHash: 'not-a-sha256-hash',
        contentType: malformedJsonBodyContentType,
      }),
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
      name: 'valid-auth-timestamp-invalid-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_TIMESTAMP_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        timestamp: staleSignedTimestamp,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-nonce-invalid-malformed-json',
      expectedStatus: 400,
      expectedCode: 'SIGNED_NONCE_INVALID',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        nonce: invalidNonce,
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
      name: 'valid-auth-expired-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_EXPIRED',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: expiredSessionId,
        contentType: malformedJsonBodyContentType,
      }),
    },
    {
      name: 'valid-auth-session-binding-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_BINDING_MISMATCH',
      headers: signedRecoveryMutateHeaders({
        rawBody: malformedJsonBody,
        session: bindingMismatchSessionId,
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
    assert.equal(hasRecoveryMutationEvidence(result), false, `${negativeCase.name} emitted mutation evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.recoveryMutationSetupStarted, false);
    assert.equal(summary.negativeAuth.journalMutationStarted, false);
    assert.equal(summary.negativeAuth.applyCapableWorkStarted, false);
    assert.equal(summary.negativeAuth.mutationSideEffectStarted, false);
    assert.equal(summary.negativeAuth.recoveryMutationEvidence, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, [
      'methodHash',
      'routePathHash',
      'proofHash',
    ]);
    assertHashOnlyFields(summary.negativeAuth, ['bodyHash']);
    assertHashOnlyWhenPresent(summary.authSummary, [
      'credentialHeaderHash',
      'sessionIdHash',
      'idempotencyKeyHash',
      'nonceHash',
      'timestampHash',
      'contentHashHeaderHash',
    ]);
    assertNoRawValues({
      response: result.body,
      summary,
    }, [
      sourceUrl,
      endpointPath,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      expiredSessionId,
      bindingMismatchSessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
      invalidNonce,
      staleSignedTimestamp,
      malformedJsonBody,
    ]);
  }

  assert.equal(route.state.authorizationAccepted, 0);
  assertNoRecoveryMutationBoundaryWork(route.state);
});
