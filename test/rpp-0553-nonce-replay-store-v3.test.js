import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/dry-run`;
const authScope = 'reprint-push-lab:authenticated-http-push';
const credential = {
  username: 'rpp_0553_admin',
  password: 'rpp-0553-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0553_raw_session_id';
const idempotencyKey = 'idem-rpp-0553-raw-idempotency-key';
const signedTimestamp = '1780000553';
const signedNonce = 'rpp0553acceptednonce';
const proofCapturedAt = '2026-05-31T12:05:53Z';
const freshExpiresAt = '2026-05-31T12:10:53Z';
const hashPattern = /^[a-f0-9]{64}$/;

const readyPlan = {
  id: 'plan-rpp-0553-nonce-replay-v3',
  status: 'ready',
  summary: {
    creates: 0,
    updates: 1,
    deletes: 0,
    conflicts: 0,
    blockers: 0,
  },
  mutations: [
    {
      action: 'update',
      resourceType: 'wp_option',
      resourceKey: 'wp_option:blogdescription',
      beforeHash: `sha256:${sha256Hex('remote-tagline')}`,
      afterHash: `sha256:${sha256Hex('local-tagline')}`,
    },
  ],
  conflicts: [],
  blockers: [],
  generatedAt: proofCapturedAt,
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

function credentialHash(value = credential) {
  return sha256Hex(`${value.username}\n${value.password}`);
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

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
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

function signedDryRunHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
} = {}) {
  const signingKey = labSigningKey();
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency,
  });
  return {
    authorization: basicAuth(),
    'content-type': 'application/json',
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
    'X-Reprint-Push-Session': session,
    'X-Reprint-Push-Idempotency-Key': idempotency,
  };
}

function createGeneratedNonceReplayDryRunRoute({ disconnectFirstAccepted = false } = {}) {
  const state = {
    requests: [],
    nonceClaims: new Map(),
    acceptedNonceClaims: [],
    acceptedReceiptHashes: [],
    jsonParseAttempts: 0,
    dryRunWorkAttempts: 0,
    receiptMintAttempts: 0,
    replayRejectedCount: 0,
    mutationCapableWorkAttempts: 0,
    disconnected: false,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({ method, pathname: requestUrl.pathname, headers, rawBody });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    const response = handleDryRunRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
    if (disconnectFirstAccepted && !state.disconnected && response.status === 200) {
      state.disconnected = true;
      const error = new TypeError('fetch failed');
      error.code = 'ECONNRESET';
      throw error;
    }

    return response;
  }

  return { state, fetchHandler };
}

function handleDryRunRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateDryRunRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse(authFailureBody(authError.code, headers, rawBody), authError.status);
  }

  const contentHash = sha256Hex(rawBody);
  const nonceClaim = nonceClaimEnvelope({ method, pathname, headers, rawBody, contentHash });
  if (state.nonceClaims.has(nonceClaim.nonceHash)) {
    state.replayRejectedCount += 1;
    return jsonResponse(nonceReplayFailureBody({ headers, rawBody, nonceClaim }), 409);
  }

  state.nonceClaims.set(nonceClaim.nonceHash, nonceClaim);
  state.acceptedNonceClaims.push(nonceClaim);
  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  state.dryRunWorkAttempts += 1;
  state.receiptMintAttempts += 1;

  const body = dryRunBody({ payload, rawBody, headers, nonceClaim });
  state.acceptedReceiptHashes.push(body.receipt.receiptHash);
  return jsonResponse(body);
}

function authenticateDryRunRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
    'x-reprint-push-session',
    'x-reprint-push-idempotency-key',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { code: 'SIGNED_HEADER_REQUIRED', status: 401 };
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

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'dry-run',
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
      nonceHash: headers['x-auth-nonce'] ? sha256Hex(headers['x-auth-nonce']) : null,
      receiptMinted: false,
      mutationAttempted: false,
    },
  };
}

function nonceClaimEnvelope({ method, pathname, headers, rawBody, contentHash }) {
  const identity = authenticatedIdentity();
  const nonceHash = sha256Hex(headers['x-auth-nonce'] || '');
  const claim = {
    schemaVersion: 1,
    nonceHash,
    timestampHash: sha256Hex(headers['x-auth-timestamp'] || ''),
    sessionHash: sha256Hex(headers['x-reprint-push-session'] || ''),
    identityHash: digest(identity),
    scopeHash: sha256Hex(authScope),
    contentHash,
    bodyHash: sha256Hex(rawBody),
    requestHash: sha256Hex(pushCanonicalString({
      method,
      pathname,
      contentHash,
      session: headers['x-reprint-push-session'] || '',
      idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
    })),
    idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key'] || ''),
  };
  claim.claimHash = digest(claim);
  return claim;
}

function nonceReplayFailureBody({ headers, rawBody, nonceClaim }) {
  return {
    ok: false,
    code: 'SIGNED_NONCE_REPLAYED',
    mode: 'dry-run',
    evidence: {
      schemaVersion: 1,
      nonceHash: nonceClaim.nonceHash,
      nonceClaimHash: nonceClaim.claimHash,
      sessionIdHash: sha256Hex(headers['x-reprint-push-session'] || ''),
      identityHash: nonceClaim.identityHash,
      scopeHash: nonceClaim.scopeHash,
      bodyHash: sha256Hex(rawBody),
      contentHash: nonceClaim.contentHash,
      idempotencyKeyHash: nonceClaim.idempotencyKeyHash,
      replayed: true,
      receiptMinted: false,
      receiptValidated: false,
      mutationAttempted: false,
    },
  };
}

function dryRunBody({ payload, rawBody, headers, nonceClaim }) {
  const plan = payload.plan || {};
  const planHash = digest(plan);
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const identity = authenticatedIdentity();
  const authSession = authenticatedSession({ session });
  const signedRequest = signedRequestEvidence({ contentHash, headers, session, idempotencyKey: key });
  const receipt = {
    schemaVersion: 1,
    type: 'dry-run',
    ok: true,
    mode: 'dry-run',
    planHash,
    authBinding: authBinding({
      identity,
      authSession,
      signedRequest,
      planHash,
      payload,
      nonceClaim,
    }),
  };
  receipt.receiptHash = digest(receipt);

  return {
    ok: true,
    mode: 'dry-run',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    dryRunOnly: {
      readOnly: true,
      mutates: false,
    },
    planHash,
    auth: {
      identity,
      session: authSession,
    },
    signedRequest,
    nonceStore: {
      status: 'accepted',
      nonceHash: nonceClaim.nonceHash,
      nonceClaimHash: nonceClaim.claimHash,
    },
    receipt,
  };
}

function authenticatedIdentity() {
  return {
    userLogin: credential.username,
    userId: 553,
    capabilities: { manage_options: true },
  };
}

function authenticatedSession({ session = sessionId } = {}) {
  return {
    type: 'production-auth-session',
    status: 'active',
    id: session,
    applicationPasswordUuid: 'app-pass-rpp-0553',
    credentialHash: credentialHash(),
    revoked: false,
    cleanedUp: false,
    playgroundFallback: false,
    expiresAt: freshExpiresAt,
  };
}

function signedRequestEvidence({ contentHash, headers, session, idempotencyKey: key }) {
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: key,
  });

  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    timestampHash: sha256Hex(headers['x-auth-timestamp'] || signedTimestamp),
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: sha256Hex(session),
    signingKeyHash: sha256Hex(labSigningKey()),
    request: {
      method: 'POST',
      path: endpointPath,
      canonicalQuery: '',
      idempotencyKeyHash: sha256Hex(key),
      canonicalHash: sha256Hex(canonical),
    },
  };
}

function authBinding({ identity, authSession, signedRequest, planHash, payload, nonceClaim }) {
  const subject = subjectBinding({ identity, authSession, signedRequest, planHash });
  const binding = {
    schemaVersion: 1,
    scope: authScope,
    planHash,
    binding: subject,
    identity,
    session: authSession,
    pushSession: {
      sessionHash: signedRequest.sessionHash,
      signingKeyHash: signedRequest.signingKeyHash,
      dryRunNonceHash: signedRequest.nonceHash,
      dryRunContentHash: signedRequest.contentHash,
      dryRunCanonicalHash: signedRequest.request.canonicalHash,
      dryRunIdempotencyKeyHash: signedRequest.request.idempotencyKeyHash,
      nonceClaimHash: nonceClaim.claimHash,
    },
    source: {
      sourceUrlHash: sha256Hex(sourceUrl),
      restNamespace: 'reprint/v1',
      routeProfile: 'production-shaped',
      labBacked: true,
    },
    request: {
      restNamespace: 'reprint/v1',
      dryRunRoute: '/push/dry-run',
      routeProfile: 'production-shaped',
      labBacked: true,
      planHash,
      planPayloadHash: planHash,
      dryRunBodyHash: digest(payload),
      dryRunRawBodyHash: signedRequest.contentHash,
    },
    plan: {
      schemaVersion: 1,
      planHash,
      planPayloadHash: planHash,
    },
    issuedAt: proofCapturedAt,
    expiresAt: freshExpiresAt,
  };

  return binding;
}

function subjectBinding({ identity, authSession, signedRequest, planHash }) {
  const binding = {
    schemaVersion: 1,
    scopeHash: sha256Hex(authScope),
    identityHash: digest(identity),
    authSessionHash: digest(authSession),
    pushSessionHash: signedRequest.sessionHash,
    planHash,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function buildNonceReplaySupportEvidence({
  dryRun = null,
  replay = null,
  state,
  expectedPlan = readyPlan,
} = {}) {
  const body = dryRun?.body || {};
  const receipt = body.receipt || {};
  const binding = receipt.authBinding || {};
  const subject = binding.binding || {};
  const pushSession = binding.pushSession || {};
  const expectedPlanHash = digest(expectedPlan);
  const acceptedNonceHashes = state?.acceptedNonceClaims?.map((claim) => claim.nonceHash) || [];
  const finalNonceHash = acceptedNonceHashes.at(-1) || null;
  const bindingValidation = validateReceiptBinding({
    receipt,
    expectedPlanHash,
    expectedNonceHash: finalNonceHash,
  });
  const replayBody = replay?.body || {};
  const replayEvidence = replayBody.evidence || {};
  const replayRejected = replayBody.code === 'SIGNED_NONCE_REPLAYED';
  const replayReceiptValidation = replayRejected
    ? { ok: false }
    : validateReceiptBinding({
      receipt: replayBody.receipt,
      expectedPlanHash,
      expectedNonceHash: replayEvidence.nonceHash || null,
    });
  const acceptedOk = dryRun?.status === 200
    && body.ok === true
    && bindingValidation.ok
    && acceptedNonceHashes.length > 0;
  const replayOk = !replay || replayRejected;
  const ok = acceptedOk && replayOk;

  return {
    schemaVersion: 1,
    slice: 'RPP-0553',
    variant: 3,
    proofClass: 'generated-local-nonce-replay-store',
    evidenceScope: 'local-generated-support',
    releaseStatus: 'NO-GO',
    status: ok ? 'support_only' : 'blocked',
    ok,
    code: ok ? 'LOCAL_NONCE_REPLAY_STORE_SUPPORT_ONLY' : (replayBody.code || 'DRY_RUN_NONCE_BINDING_REQUIRED'),
    mutationAttempted: false,
    capturedAt: proofCapturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(sourceUrl),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: credentialHash(),
      scopeHash: subject.scopeHash || sha256Hex(authScope),
      identityHash: subject.identityHash || null,
      authSessionHash: subject.authSessionHash || null,
      sessionHash: subject.pushSessionHash || null,
      rawIdentityIncluded: false,
    },
    nonceStore: {
      boundary: 'generated-local-single-use-nonce-store',
      acceptedNonceCount: acceptedNonceHashes.length,
      replayRejectedCount: state?.replayRejectedCount || 0,
      firstAcceptedNonceHash: acceptedNonceHashes[0] || null,
      finalAcceptedNonceHash: finalNonceHash,
      acceptedNonceHashesDistinct: new Set(acceptedNonceHashes).size === acceptedNonceHashes.length,
      retryRegeneratedNonce: acceptedNonceHashes.length > 1 && acceptedNonceHashes[0] !== finalNonceHash,
      replayedNonceHash: replayEvidence.nonceHash || null,
      proofHash: digest({
        acceptedNonceHashes,
        replayRejectedCount: state?.replayRejectedCount || 0,
        finalNonceHash,
        replayedNonceHash: replayEvidence.nonceHash || null,
      }),
    },
    receiptBinding: {
      status: dryRun?.status ?? null,
      ok: body.ok === true,
      receiptHashLength: String(receipt.receiptHash || '').length,
      planHashMatchesExpected: receipt.planHash === expectedPlanHash,
      scopeHashMatchesExpected: subject.scopeHash === sha256Hex(authScope),
      identityHashMatchesExpected: subject.identityHash === digest(binding.identity || {}),
      authSessionHashMatchesExpected: subject.authSessionHash === digest(binding.session || {}),
      pushSessionHashMatchesExpected: subject.pushSessionHash === pushSession.sessionHash,
      bindingHashMatchesExpected: subject.bindingHash === digest(withoutKey(subject, 'bindingHash')),
      nonceBoundToReceipt: finalNonceHash ? pushSession.dryRunNonceHash === finalNonceHash : false,
      idempotencyKeyHashLength: String(pushSession.dryRunIdempotencyKeyHash || '').length,
      validated: bindingValidation.ok,
      proofHash: digest({
        receiptHash: receipt.receiptHash || null,
        planHashMatchesExpected: receipt.planHash === expectedPlanHash,
        scopeHashMatchesExpected: subject.scopeHash === sha256Hex(authScope),
        identityHashMatchesExpected: subject.identityHash === digest(binding.identity || {}),
        authSessionHashMatchesExpected: subject.authSessionHash === digest(binding.session || {}),
        pushSessionHashMatchesExpected: subject.pushSessionHash === pushSession.sessionHash,
        nonceBoundToReceipt: finalNonceHash ? pushSession.dryRunNonceHash === finalNonceHash : false,
      }),
    },
    replay: replay
      ? {
        status: replay.status,
        code: replayBody.code || null,
        nonceHash: replayEvidence.nonceHash || null,
        nonceClaimHash: replayEvidence.nonceClaimHash || null,
        replayRejected,
        receiptMinted: replayRejected ? false : Boolean(replayBody.receipt),
        receiptValidated: replayReceiptValidation.ok === true,
        mutationAttempted: replayEvidence.mutationAttempted === true,
        proofHash: digest({
          status: replay.status,
          code: replayBody.code || null,
          nonceHash: replayEvidence.nonceHash || null,
          receiptMinted: replayRejected ? false : Boolean(replayBody.receipt),
          receiptValidated: replayReceiptValidation.ok === true,
        }),
      }
      : null,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'generated local nonce replay proof is support-only until production-owned store evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'production-owned nonce replay store receipt binding proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function validateReceiptBinding({ receipt, expectedPlanHash, expectedNonceHash = null } = {}) {
  const binding = receipt?.authBinding || {};
  const subject = binding.binding || {};
  const identity = binding.identity || {};
  const session = binding.session || {};
  const pushSession = binding.pushSession || {};
  const request = binding.request || {};
  const plan = binding.plan || {};
  const subjectWithoutHash = withoutKey(subject, 'bindingHash');
  const receiptWithoutHash = receipt ? withoutKey(receipt, 'receiptHash') : {};
  const subjectOk = subject.schemaVersion === 1
    && subject.scopeHash === sha256Hex(binding.scope || '')
    && subject.identityHash === digest(identity)
    && subject.authSessionHash === digest(session)
    && subject.pushSessionHash === pushSession.sessionHash
    && subject.planHash === expectedPlanHash
    && subject.bindingHash === digest(subjectWithoutHash);
  const requestOk = request.restNamespace === 'reprint/v1'
    && request.dryRunRoute === '/push/dry-run'
    && request.routeProfile === 'production-shaped'
    && request.planHash === expectedPlanHash
    && request.planPayloadHash === expectedPlanHash;
  const planOk = plan.schemaVersion === 1
    && plan.planHash === expectedPlanHash
    && plan.planPayloadHash === expectedPlanHash;
  const sessionOk = pushSession.sessionHash === subject.pushSessionHash
    && pushSession.sessionHash === sha256Hex(session.id || '');
  const nonceOk = expectedNonceHash ? pushSession.dryRunNonceHash === expectedNonceHash : true;
  const receiptHashOk = typeof receipt?.receiptHash === 'string'
    && hashPattern.test(receipt.receiptHash)
    && receipt.receiptHash === digest(receiptWithoutHash);
  const topLevelOk = binding.scope === authScope
    && receipt?.planHash === expectedPlanHash
    && binding.planHash === expectedPlanHash;

  return {
    ok: subjectOk && requestOk && planOk && sessionOk && nonceOk && receiptHashOk && topLevelOk,
    subject: subjectOk,
    request: requestOk,
    plan: planOk,
    session: sessionOk,
    nonce: nonceOk,
    receiptHash: receiptHashOk,
    topLevel: topLevelOk,
  };
}

async function requestLocalRoute(route, headers, rawBody = JSON.stringify({ plan: readyPlan })) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

test('RPP-0553 v3 signed dry-run retry regenerates nonce and binds final receipt', async () => {
  const originalFetch = global.fetch;
  const route = createGeneratedNonceReplayDryRunRoute({ disconnectFirstAccepted: true });
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const evidence = buildNonceReplaySupportEvidence({ dryRun, state: route.state });
    const firstRequest = route.state.requests[0];
    const finalRequest = route.state.requests[1];
    const firstNonce = firstRequest.headers['x-auth-nonce'];
    const finalNonce = finalRequest.headers['x-auth-nonce'];
    const receipt = dryRun.body.receipt;
    const binding = receipt.authBinding;
    const subject = binding.binding;

    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.retryAttempts, 2);
    assert.equal(route.state.requests.length, 2);
    assert.equal(firstNonce, signedNonce);
    assert.match(finalNonce, /^rpp0553acceptednonce-retry-2-/);
    assert.notEqual(firstNonce, finalNonce);
    assert.equal(route.state.acceptedNonceClaims.length, 2);
    assert.notEqual(route.state.acceptedNonceClaims[0].nonceHash, route.state.acceptedNonceClaims[1].nonceHash);
    assert.equal(route.state.jsonParseAttempts, 2);
    assert.equal(route.state.dryRunWorkAttempts, 2);
    assert.equal(route.state.receiptMintAttempts, 2);
    assert.equal(route.state.replayRejectedCount, 0);
    assert.equal(route.state.mutationCapableWorkAttempts, 0);

    assert.equal(receipt.planHash, digest(readyPlan));
    assert.equal(receipt.receiptHash, digest(withoutKey(receipt, 'receiptHash')));
    assert.equal(binding.scope, authScope);
    assert.equal(binding.planHash, receipt.planHash);
    assert.equal(subject.scopeHash, sha256Hex(authScope));
    assert.equal(subject.identityHash, digest(binding.identity));
    assert.equal(subject.authSessionHash, digest(binding.session));
    assert.equal(subject.pushSessionHash, sha256Hex(sessionId));
    assert.equal(subject.planHash, receipt.planHash);
    assert.equal(subject.bindingHash, digest(withoutKey(subject, 'bindingHash')));
    assert.equal(binding.pushSession.dryRunNonceHash, sha256Hex(finalNonce));
    assert.equal(binding.pushSession.dryRunIdempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(validateReceiptBinding({
      receipt,
      expectedPlanHash: digest(readyPlan),
      expectedNonceHash: sha256Hex(finalNonce),
    }).ok, true);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.nonceStore.acceptedNonceCount, 2);
    assert.equal(evidence.nonceStore.acceptedNonceHashesDistinct, true);
    assert.equal(evidence.nonceStore.retryRegeneratedNonce, true);
    assert.equal(evidence.receiptBinding.validated, true);
    assert.equal(evidence.receiptBinding.planHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.scopeHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.identityHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.authSessionHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.pushSessionHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.nonceBoundToReceipt, true);
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'scopeHash',
      'identityHash',
      'authSessionHash',
      'sessionHash',
    ]);
    assertHashOnlyFields(evidence.nonceStore, [
      'firstAcceptedNonceHash',
      'finalAcceptedNonceHash',
      'proofHash',
    ]);
    assertHashOnlyFields(evidence.receiptBinding, ['proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      signedNonce,
      readyPlan.id,
      readyPlan.mutations[0].resourceKey,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0553 v3 replayed nonce evidence cannot mint or validate a dry-run receipt', async () => {
  const route = createGeneratedNonceReplayDryRunRoute();
  const rawBody = JSON.stringify({ plan: readyPlan });
  const headers = signedDryRunHeaders({ rawBody });

  const accepted = await requestLocalRoute(route, headers, rawBody);
  const replayed = await requestLocalRoute(route, headers, rawBody);
  const replayEvidence = buildNonceReplaySupportEvidence({
    dryRun: accepted,
    replay: replayed,
    state: route.state,
  });
  const forgedReplay = clone(replayed);
  forgedReplay.body.receipt = accepted.body.receipt;
  const forgedReplayEvidence = buildNonceReplaySupportEvidence({
    dryRun: accepted,
    replay: forgedReplay,
    state: route.state,
  });

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ok, true);
  assert.equal(replayed.status, 409);
  assert.equal(replayed.body.ok, false);
  assert.equal(replayed.body.code, 'SIGNED_NONCE_REPLAYED');
  assert.equal(replayed.body.receipt, undefined);
  assert.equal(route.state.acceptedNonceClaims.length, 1);
  assert.equal(route.state.replayRejectedCount, 1);
  assert.equal(route.state.jsonParseAttempts, 1);
  assert.equal(route.state.dryRunWorkAttempts, 1);
  assert.equal(route.state.receiptMintAttempts, 1);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);

  assert.equal(validateReceiptBinding({
    receipt: accepted.body.receipt,
    expectedPlanHash: digest(readyPlan),
    expectedNonceHash: sha256Hex(signedNonce),
  }).ok, true);
  assert.equal(validateReceiptBinding({
    receipt: replayed.body.receipt,
    expectedPlanHash: digest(readyPlan),
    expectedNonceHash: sha256Hex(signedNonce),
  }).ok, false);

  assert.equal(replayEvidence.ok, true);
  assert.equal(replayEvidence.status, 'support_only');
  assert.equal(replayEvidence.releaseStatus, 'NO-GO');
  assert.equal(replayEvidence.releaseMovement.allowed, false);
  assert.equal(replayEvidence.nonceStore.acceptedNonceCount, 1);
  assert.equal(replayEvidence.nonceStore.replayRejectedCount, 1);
  assert.equal(replayEvidence.nonceStore.acceptedNonceHashesDistinct, true);
  assert.equal(replayEvidence.nonceStore.replayedNonceHash, sha256Hex(signedNonce));
  assert.equal(replayEvidence.receiptBinding.validated, true);
  assert.equal(replayEvidence.replay.replayRejected, true);
  assert.equal(replayEvidence.replay.receiptMinted, false);
  assert.equal(replayEvidence.replay.receiptValidated, false);
  assert.equal(replayEvidence.replay.mutationAttempted, false);

  assert.equal(forgedReplayEvidence.ok, true);
  assert.equal(forgedReplayEvidence.replay.replayRejected, true);
  assert.equal(forgedReplayEvidence.replay.receiptMinted, false);
  assert.equal(forgedReplayEvidence.replay.receiptValidated, false);

  assertHashOnlyFields(replayEvidence.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(replayEvidence.authSummary, [
    'credentialHash',
    'scopeHash',
    'identityHash',
    'authSessionHash',
    'sessionHash',
  ]);
  assertHashOnlyFields(replayEvidence.nonceStore, [
    'firstAcceptedNonceHash',
    'finalAcceptedNonceHash',
    'replayedNonceHash',
    'proofHash',
  ]);
  assertHashOnlyFields(replayEvidence.receiptBinding, ['proofHash']);
  assertHashOnlyWhenPresent(replayEvidence.replay, [
    'nonceHash',
    'nonceClaimHash',
    'proofHash',
  ]);
  assertNoRawValues({
    replayEvidence,
    forgedReplayEvidence,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    signedNonce,
    rawBody,
    readyPlan.id,
    readyPlan.mutations[0].resourceKey,
  ]);
});
