import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/snapshot-hashes`;
const credential = {
  username: 'rpp_0542_admin',
  password: 'rpp-0542-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0542-wrong-application-password',
};
const sessionId = 'psh_rpp_0542_raw_session_id';
const invalidSessionId = 'psh_rpp_0542_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0542-raw-idempotency-key';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const proofStaleCapturedAt = '2026-05-31T11:49:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const staleExpiresAt = '2026-05-31T11:59:00Z';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0542acceptednonce';
const malformedJsonBody = '{"scope":';
const proofFreshnessMs = 5 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/;
const prefixedHashPattern = /^sha256:[a-f0-9]{64}$/;
const snapshotHashesPayload = {
  scope: {
    files: [],
    tables: [],
    plugins: true,
  },
  batch_size: 1000,
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

function signedSnapshotHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
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
    'content-type': 'application/json',
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

function createLocalProductionSnapshotHashesRoute() {
  const state = {
    requests: [],
    jsonParseAttempts: 0,
    snapshotHashWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({ method, pathname: requestUrl.pathname, headers, rawBody });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleSnapshotHashesRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleSnapshotHashesRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateSnapshotHashesRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse(authFailureBody(authError, headers, rawBody), 401);
  }

  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  state.snapshotHashWorkAttempts += 1;

  return jsonResponse(snapshotHashesBody({ payload, rawBody, headers }));
}

function authenticateSnapshotHashesRequest({ method, pathname, headers, rawBody }) {
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

  if (!headers['x-reprint-push-session']) {
    return 'SIGNED_SESSION_REQUIRED';
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return 'SIGNED_CONTENT_HASH_MISMATCH';
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return 'SIGNED_AUTH_SIGNATURE_MISMATCH';
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return 'SIGNED_REQUEST_SIGNATURE_MISMATCH';
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return 'SIGNED_SESSION_INVALID';
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'snapshot-hashes',
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
      mutationAttempted: false,
    },
  };
}

function snapshotHashesBody({ payload, rawBody, headers, expiresAt = freshExpiresAt }) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const signingKey = labSigningKey();
  const identity = {
    userLogin: credential.username,
    userId: 542,
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
  const snapshotHash = `sha256:${digest({ payload, salt: 'rpp-0542-snapshot' })}`;
  const snapshotHashSetHash = `sha256:${digest({
    scope: payload.scope,
    resources: ['wp_option:home', 'wp_post:42'],
  })}`;
  const coverageHash = `sha256:${digest({
    scope: payload.scope,
    resourceCount: 2,
    route: '/push/snapshot-hashes',
  })}`;
  const pageHash = `sha256:${sha256Hex('rpp-0542-page')}`;

  return {
    ok: true,
    mode: 'snapshot-hashes',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    planningOnly: {
      readOnly: true,
      mutates: false,
    },
    snapshotId: `snap_${sha256Hex('rpp-0542-snapshot-id').slice(0, 32)}`,
    snapshotHash,
    snapshotHashSetHash,
    coverage: {
      coverage_hash: coverageHash,
      resource_count: 2,
    },
    pageHash,
    resources: [
      {
        resourceKeyHash: sha256Hex('wp_option:home'),
        beforeHash: `sha256:${sha256Hex('remote-home')}`,
        afterHash: `sha256:${sha256Hex('local-home')}`,
      },
      {
        resourceKeyHash: sha256Hex('wp_post:42'),
        beforeHash: `sha256:${sha256Hex('remote-post')}`,
        afterHash: `sha256:${sha256Hex('local-post')}`,
      },
    ],
    auth: {
      identity,
      session: {
        type: 'production-auth-session',
        status: 'active',
        id: session,
        expiresAt,
      },
    },
    sessionStore: {
      type: 'wp-options',
      retention: {
        sessionTtlSeconds: 300,
        nonceTtlSeconds: 300,
      },
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
    receipt: {
      type: 'snapshot-hashes',
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      route: '/push/snapshot-hashes',
      receiptHash: `sha256:${digest({
        type: 'snapshot-hashes',
        snapshotHashSetHash,
        canonicalHash,
      })}`,
      snapshotHashSetHash,
      planningOnly: {
        readOnly: true,
        mutates: false,
      },
      authBinding: {
        identityHash: digest(identity),
        sessionHash,
        signingKeyHash,
      },
      request: {
        canonicalHash,
        idempotencyKeyHash: sha256Hex(key),
      },
    },
  };
}

function buildSnapshotHashesRouteSupportEvidence({
  snapshotHashes = null,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
} = {}) {
  const body = snapshotHashes?.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const session = body.auth?.session || {};
  const receipt = body.receipt || {};
  const signedRequest = body.signedRequest || {};
  const requestPath = snapshotHashes?.request?.pathname || null;
  const requestMethod = snapshotHashes?.request?.method || 'POST';
  const routeEvidence = {
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
      status: snapshotHashes?.status ?? null,
      mode: body.mode || null,
      capturedAt,
    }),
  };
  const base = {
    schemaVersion: 1,
    slice: 'RPP-0542',
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
      idempotencyKeyHash: signedRequest.request?.idempotencyKeyHash
        || receipt.request?.idempotencyKeyHash
        || null,
    },
    routeEvidence,
    snapshotHashesSummary: {
      status: snapshotHashes?.status ?? null,
      ok: body.ok === true,
      code: body.code || null,
      mode: body.mode || null,
      snapshotHashLength: String(body.snapshotHash || '').length,
      snapshotHashSetHashLength: String(body.snapshotHashSetHash || '').length,
      coverageHashLength: String(body.coverage?.coverage_hash || '').length,
      pageHashLength: String(body.pageHash || '').length,
      resourceCount: body.coverage?.resource_count ?? null,
      receiptHashLength: String(receipt.receiptHash || '').length,
      identityHashLength: String(receipt.authBinding?.identityHash || '').length,
      sessionHashLength: String(receipt.authBinding?.sessionHash || '').length,
      signingKeyHashLength: String(receipt.authBinding?.signingKeyHash || '').length,
      idempotencyKeyHashLength: String(receipt.request?.idempotencyKeyHash || '').length,
      planningOnly: {
        readOnly: body.planningOnly?.readOnly === true,
        mutates: body.planningOnly?.mutates === true,
      },
      proofHash: digest({
        status: snapshotHashes?.status ?? null,
        ok: body.ok === true,
        mode: body.mode || null,
        route: receipt.route || null,
        snapshotHash: body.snapshotHash || null,
        snapshotHashSetHash: body.snapshotHashSetHash || null,
        coverageHash: body.coverage?.coverage_hash || null,
        pageHash: body.pageHash || null,
        receiptHash: receipt.receiptHash || null,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local snapshot-hashes route proof is support-only until production URL and credential proof exists',
    },
  };

  if (!snapshotHashes || snapshotHashes.status !== 200 || body.ok !== true || body.mode !== 'snapshot-hashes') {
    return blockedSnapshotHashesEvidence(base, body.code || 'SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED');
  }

  if (!routeEvidenceIsFresh(capturedAt, evaluatedAt)) {
    return blockedSnapshotHashesEvidence(base, 'SNAPSHOT_HASH_ROUTE_PROOF_STALE');
  }

  if (!isFreshProductionSession(session, evaluatedAt)) {
    return blockedSnapshotHashesEvidence(base, 'SNAPSHOT_HASH_AUTH_SESSION_STALE');
  }

  return {
    ...base,
    ok: true,
    status: 'support_only',
    code: 'LOCAL_SNAPSHOT_HASH_ROUTE_SUPPORT_ONLY',
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed snapshot-hashes route proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function blockedSnapshotHashesEvidence(base, code) {
  return {
    ...base,
    ok: false,
    status: 'blocked',
    code,
    boundary: {
      firstRemainingProductionBoundary: 'fresh production snapshot-hashes route proof',
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
    slice: 'RPP-0542',
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
      jsonParsed: false,
      mutationCapableWorkStarted: false,
      snapshotHashEvidence: hasSnapshotHashEvidence(response),
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'authenticated production snapshot-hashes route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated snapshot-hashes route proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasSnapshotHashEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.snapshotHash
    || body.snapshotHashSetHash
    || body.pageHash
    || body.coverage
    || body.receipt?.type === 'snapshot-hashes'
    || Array.isArray(body.resources)
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

test('RPP-0542 v3 accepts production-shaped local snapshot-hashes route evidence as support-only', async () => {
  const originalFetch = global.fetch;
  const route = createLocalProductionSnapshotHashesRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const snapshotHashes = await client.signedPost('/snapshot-hashes', snapshotHashesPayload, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const evidence = buildSnapshotHashesRouteSupportEvidence({ snapshotHashes });

    assert.equal(snapshotHashes.status, 200);
    assert.equal(snapshotHashes.request.pathname, endpointPath);
    assert.equal(snapshotHashes.request.method, 'POST');
    assert.equal(snapshotHashes.body.mode, 'snapshot-hashes');
    assert.equal(snapshotHashes.body.routeProfile.profile, 'production-shaped');
    assert.equal(snapshotHashes.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(snapshotHashes.body.routeProfile.routePrefix, '/push');
    assert.equal(snapshotHashes.body.planningOnly.readOnly, true);
    assert.equal(snapshotHashes.body.planningOnly.mutates, false);
    assert.match(snapshotHashes.body.snapshotHash, prefixedHashPattern);
    assert.match(snapshotHashes.body.snapshotHashSetHash, prefixedHashPattern);
    assert.match(snapshotHashes.body.coverage.coverage_hash, prefixedHashPattern);
    assert.match(snapshotHashes.body.pageHash, prefixedHashPattern);
    assert.equal(snapshotHashes.body.resources.length, 2);
    assert.equal(snapshotHashes.body.receipt.type, 'snapshot-hashes');
    assert.equal(snapshotHashes.body.receipt.route, '/push/snapshot-hashes');
    assert.equal(snapshotHashes.body.receipt.planningOnly.mutates, false);
    assert.equal(route.state.jsonParseAttempts, 1);
    assert.equal(route.state.snapshotHashWorkAttempts, 1);
    assert.equal(route.state.mutationCapableWorkAttempts, 0);

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
    assert.equal(evidence.snapshotHashesSummary.planningOnly.readOnly, true);
    assert.equal(evidence.snapshotHashesSummary.planningOnly.mutates, false);
    assert.equal(evidence.snapshotHashesSummary.resourceCount, 2);
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
    assertHashOnlyFields(evidence.snapshotHashesSummary, ['proofHash']);
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

test('RPP-0542 v3 negative auth cases fail before JSON parsing or mutation-capable work', async () => {
  const route = createLocalProductionSnapshotHashesRoute();
  const negativeCases = [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedSnapshotHeaders({
          rawBody: malformedJsonBody,
          session: '',
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedSnapshotHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestLocalRoute(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, 401, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasSnapshotHashEvidence(result), false, `${negativeCase.name} emitted snapshot hash evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.mutationCapableWorkStarted, false);
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
  assert.equal(route.state.snapshotHashWorkAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
});

test('RPP-0542 v3 refuses missing and stale route evidence before release movement', () => {
  const rawBody = JSON.stringify(snapshotHashesPayload);
  const headers = signedSnapshotHeaders({ rawBody });
  const acceptedResponse = {
    status: 200,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: snapshotHashesBody({ payload: snapshotHashesPayload, rawBody, headers }),
  };
  const missing = buildSnapshotHashesRouteSupportEvidence({
    snapshotHashes: null,
    evaluatedAt: proofCapturedAt,
  });
  const staleRoute = buildSnapshotHashesRouteSupportEvidence({
    snapshotHashes: acceptedResponse,
    capturedAt: proofStaleCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const staleSession = buildSnapshotHashesRouteSupportEvidence({
    snapshotHashes: {
      ...acceptedResponse,
      body: snapshotHashesBody({
        payload: snapshotHashesPayload,
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
  assert.equal(missing.code, 'SNAPSHOT_HASH_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(staleRoute.ok, false);
  assert.equal(staleRoute.status, 'blocked');
  assert.equal(staleRoute.code, 'SNAPSHOT_HASH_ROUTE_PROOF_STALE');
  assert.equal(staleRoute.releaseStatus, 'NO-GO');
  assert.equal(staleRoute.releaseMovement.allowed, false);
  assert.equal(staleRoute.mutationAttempted, false);
  assert.equal(staleRoute.boundary.firstRemainingProductionBoundary, 'fresh production snapshot-hashes route proof');

  assert.equal(staleSession.ok, false);
  assert.equal(staleSession.status, 'blocked');
  assert.equal(staleSession.code, 'SNAPSHOT_HASH_AUTH_SESSION_STALE');
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
  assertHashOnlyFields(staleRoute.snapshotHashesSummary, ['proofHash']);
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
