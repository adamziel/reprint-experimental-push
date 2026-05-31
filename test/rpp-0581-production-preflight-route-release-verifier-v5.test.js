import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const releaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const releaseVerifierSource = readFileSync(releaseVerifierPath, 'utf8');

const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/preflight`;
const routeName = '/push/preflight';
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0581_admin',
  password: 'rpp-0581-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0581_live_preflight_session_000001';
const signedTimestamp = '1780000581';
const signedNonce = 'rpp0581livepreflightnonce';
const proofCapturedAt = '2026-05-31T14:00:00Z';
const issuedAt = '2026-05-31T13:59:00Z';
const freshExpiresAt = '2026-05-31T14:04:00Z';
const hashPattern = /^[a-f0-9]{64}$/;

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

function pushCanonicalString({ method, pathname, contentHash, session = '', idempotencyKey = '' }) {
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname,
    '',
    contentHash,
    session,
    idempotencyKey,
  ].join('\n');
}

function jsonResponse(response, body, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json',
    connection: 'close',
  });
  response.end(JSON.stringify(body));
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
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

function assertBefore(source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sourceIdentity(sourceUrl) {
  const identity = {
    sourceUrlHash: sha256Hex(sourceUrl),
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

function authenticatedIdentity() {
  return {
    userId: 581,
    userLogin: credential.username,
    capabilities: {
      manage_options: true,
    },
  };
}

function preflightBody(sourceUrl) {
  const source = sourceIdentity(sourceUrl);
  const identity = authenticatedIdentity();
  const credentialHash = sha256Hex(`${credential.username}\n${credential.password}`);
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
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity,
      session: {
        id: sessionId,
        type: 'production-auth-session',
        status: 'active',
        credentialHash,
        sourceHash: source.sourceHash,
        sourceUrlHash: source.sourceUrlHash,
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
      signingKeyHash: sha256Hex(labSigningKey()),
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
    snapshotHash: sha256Hex('rpp-0581-live-preflight-snapshot'),
  };
}

function createRouteState() {
  return {
    requests: [],
    phaseLog: [],
    authAttempts: 0,
    signedPreflightAttempts: 0,
    sessionMintAttempts: 0,
    snapshotHashAttempts: 0,
    mutationCapableWorkAttempts: 0,
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

function preflightAuthFailureBody(code, headers, sourceUrl) {
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

async function withLivePreflightEndpoint(run) {
  const state = createRouteState();
  let sourceUrl = '';
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', sourceUrl);
    const method = request.method || 'GET';
    const headers = headerEntries(request.headers || {});
    state.requests.push({
      method,
      pathnameHash: sha256Hex(requestUrl.pathname),
      headerNameHash: sha256Hex(Object.keys(headers).sort().join('\n')),
      contentHash: headers['x-auth-content-hash'] || null,
      sessionHeaderPresent: Boolean(headers['x-reprint-push-session']),
      idempotencyKeyPresent: Boolean(headers['x-reprint-push-idempotency-key']),
    });
    state.phaseLog.push('request-received');

    if (requestUrl.pathname !== endpointPath) {
      state.phaseLog.push('route-miss');
      jsonResponse(response, { ok: false, code: 'ROUTE_NOT_FOUND' }, 404);
      return;
    }

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
      jsonResponse(
        response,
        preflightAuthFailureBody(authError, headers, sourceUrl),
        authError === 'SIGNED_PREFLIGHT_IDEMPOTENCY_REJECTED' ? 400 : 401,
      );
      return;
    }

    state.phaseLog.push('auth-accepted');
    state.sessionMintAttempts += 1;
    state.phaseLog.push('session-mint');
    state.snapshotHashAttempts += 1;
    state.phaseLog.push('snapshot-hash-read');

    jsonResponse(response, preflightBody(sourceUrl));
  });

  await listen(server);
  const address = server.address();
  assert.equal(typeof address, 'object');
  sourceUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run({
      sourceUrl,
      port: address.port,
      state,
    });
  } finally {
    await closeServer(server);
    assert.equal(
      await isPortAccepting(address.port),
      false,
      `live preflight endpoint still accepts connections on ${sourceUrl}`,
    );
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isPortAccepting(port) {
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

function routeProofCode({ preflight = null, state = null, sourceUrl = '' } = {}) {
  if (!preflight) {
    return 'PREFLIGHT_ROUTE_PROOF_REQUIRED';
  }

  const body = preflight.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const authSession = body.auth?.session || {};
  const session = body.session || {};
  const source = sourceIdentity(sourceUrl);
  const accepted = preflight.status === 200
    && body.ok === true
    && body.mode === 'preflight'
    && preflight.request?.method === 'GET'
    && preflight.request?.pathname === endpointPath
    && preflight.request?.contentHash === sha256Hex('')
    && Boolean(preflight.request?.canonicalHash)
    && routeProfile.profile === 'production-shaped'
    && routeProfile.restNamespace === 'reprint/v1'
    && routeProfile.routePrefix === '/push'
    && routeProfile.labBacked === true
    && identity.userLogin === credential.username
    && identity.capabilities?.manage_options === true
    && authSession.id === session.id
    && authSession.type === 'production-auth-session'
    && authSession.status === 'active'
    && authSession.expiresAt === freshExpiresAt
    && session.sourceHash === source.sourceHash
    && session.sourceUrlHash === source.sourceUrlHash
    && state?.requests.length === 1
    && state.requests.every((request) => request.sessionHeaderPresent === false)
    && state.requests.every((request) => request.idempotencyKeyPresent === false)
    && state.mutationCapableWorkAttempts === 0;

  return accepted
    ? 'LIVE_PREFLIGHT_ROUTE_V5_SUPPORT_ONLY'
    : 'PREFLIGHT_ROUTE_PROOF_MALFORMED';
}

function buildPreflightRouteReceipt({
  preflight = null,
  state = createRouteState(),
  sourceUrl = '',
  port = 0,
  capturedAt = proofCapturedAt,
} = {}) {
  const body = preflight?.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const authSession = body.auth?.session || {};
  const session = body.session || {};
  const code = routeProofCode({ preflight, state, sourceUrl });
  const ok = code === 'LIVE_PREFLIGHT_ROUTE_V5_SUPPORT_ONLY';
  const requestPath = preflight?.request?.pathname || null;
  const source = sourceUrl ? sourceIdentity(sourceUrl) : null;
  const routeEvidence = {
    schemaVersion: 1,
    method: preflight?.request?.method || 'GET',
    endpointPathHash: sha256Hex(endpointPath),
    requestPathHash: requestPath ? sha256Hex(requestPath) : null,
    routeHash: sha256Hex(routeName),
    routeProfileHash: routeProfile.profile ? sha256Hex(routeProfile.profile) : null,
    restNamespaceHash: routeProfile.restNamespace ? sha256Hex(routeProfile.restNamespace) : null,
    routePrefixHash: routeProfile.routePrefix ? sha256Hex(routeProfile.routePrefix) : null,
    labBacked: routeProfile.labBacked === true,
    signedGet: Boolean(preflight?.request?.contentHash && preflight?.request?.canonicalHash),
    requiresLiveUrl: true,
    liveEndpointChecked: ok,
    liveEndpointLoopbackOnly: ok,
    requestPathMatchesEndpoint: requestPath === endpointPath,
    proofHash: digest({
      method: preflight?.request?.method || 'GET',
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: requestPath ? sha256Hex(requestPath) : null,
      routeHash: sha256Hex(routeName),
      status: preflight?.status ?? null,
      ok,
      routeProfileHash: routeProfile.profile ? sha256Hex(routeProfile.profile) : null,
      liveEndpointHash: sourceUrl ? sha256Hex(`${sourceUrl}${endpointPath}`) : null,
      capturedAtHash: sha256Hex(capturedAt),
    }),
  };
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0581',
    proofClass: 'release-verifier-production-preflight-route-v5',
    evidenceScope: 'release-verifier-live-endpoint-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAtHash: sha256Hex(capturedAt),
    carriedThrough: {
      rpp0541ProofClassHash: sha256Hex('real-endpoint-shaped-local-route'),
      rpp0561RouteEvidenceShapeHash: digest([
        'signed GET production preflight route',
        'live URL required',
        'source-bound production auth session',
        'zero mutation-capable work',
      ]),
      supportOnlyNoGo: true,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    productionInputs: {
      liveEndpointRequired: true,
      liveEndpointChecked: ok,
      liveEndpointAvailable: ok,
      productionOwnedUrlSupplied: false,
      productionCredentialsSupplied: false,
      rawUrlIncluded: false,
    },
    liveEndpointSummary: {
      transportHash: sha256Hex('http-loopback'),
      hostHash: sha256Hex('127.0.0.1'),
      portHash: port ? sha256Hex(String(port)) : null,
      endpointUrlHash: sourceUrl ? sha256Hex(`${sourceUrl}${endpointPath}`) : null,
      sandboxIngressPort: 8080,
      exposure: 'sandbox-local-loopback-only',
      tunnel: 'none',
      rawUrlIncluded: false,
    },
    sourceSummary: {
      sourceUrlHash: sourceUrl ? sha256Hex(sourceUrl) : null,
      sourceHash: source?.sourceHash || null,
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
      identityBound: identity.userLogin === credential.username,
      sessionBound: authSession.id === session.id && session.id === sessionId,
      sourceBound: Boolean(source && session.sourceHash === source.sourceHash && session.sourceUrlHash === source.sourceUrlHash),
      sessionTypeHash: authSession.type ? sha256Hex(authSession.type) : null,
      sessionStatusHash: authSession.status ? sha256Hex(authSession.status) : null,
      manageOptions: identity.capabilities?.manage_options === true,
      signingKeyHashLength: String(session.signingKeyHash || '').length,
    },
    routeEvidence,
    preflightSummary: {
      status: preflight?.status ?? null,
      ok: body.ok === true,
      modeHash: body.mode ? sha256Hex(body.mode) : null,
      sessionHashLength: String(session.sessionHash || '').length,
      sourceHashLength: String(session.sourceHash || '').length,
      sourceUrlHashLength: String(session.sourceUrlHash || '').length,
      signingKeyHashLength: String(session.signingKeyHash || '').length,
      snapshotHashLength: String(body.snapshotHash || '').length,
      noSessionHeader: state.requests.every((request) => request.sessionHeaderPresent === false),
      noIdempotencyHeader: state.requests.every((request) => request.idempotencyKeyPresent === false),
      proofHash: digest({
        status: preflight?.status ?? null,
        ok: body.ok === true,
        modeHash: body.mode ? sha256Hex(body.mode) : null,
        sessionHash: session.sessionHash || null,
        sourceHash: session.sourceHash || null,
        sourceUrlHash: session.sourceUrlHash || null,
        snapshotHash: body.snapshotHash || null,
        code,
      }),
    },
    execution: {
      requestCount: state.requests.length,
      authAttempts: state.authAttempts,
      signedPreflightAttempts: state.signedPreflightAttempts,
      sessionMintAttempts: state.sessionMintAttempts,
      snapshotHashAttempts: state.snapshotHashAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      phaseHash: sha256Hex(state.phaseLog.join('\n')),
    },
    mutationAttempted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('production-owned preflight route proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('production-owned preflight route proof on checked release verifier path'),
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(preflightRouteReceipt) {
  const reason = preflightRouteReceipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : preflightRouteReceipt.code;
  const routeSummary = {
    ok: preflightRouteReceipt.ok === true,
    summaryPath: 'productionPreflightRoute',
    receiptHash: preflightRouteReceipt.receiptHash,
    liveEndpointSummary: preflightRouteReceipt.liveEndpointSummary,
    routeEvidence: preflightRouteReceipt.routeEvidence,
    preflightSummary: preflightRouteReceipt.preflightSummary,
    authSummary: preflightRouteReceipt.authSummary,
    execution: preflightRouteReceipt.execution,
    redaction: preflightRouteReceipt.redaction,
    carriedThrough: preflightRouteReceipt.carriedThrough,
    requiredHash: digest([
      'signed GET production preflight route',
      'live endpoint checked through authenticated client',
      'source-bound production auth session',
      'hash-only release verifier envelope',
      'support-only NO-GO release movement',
    ]),
    scopeHash: sha256Hex(preflightRouteReceipt.evidenceScope),
  };
  const summaryCore = {
    schemaVersion: 1,
    slice: 'RPP-0581',
    evidenceSourceHash: sha256Hex('release-verifier-production-preflight-route-v5'),
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarkerHash: sha256Hex(`[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`),
    mutationAttempted: false,
    productionPreflightRoute: routeSummary,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex(preflightRouteReceipt.ok === true
        ? 'production-owned preflight route proof required before release movement'
        : 'preflight route proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('production-owned preflight route proof on checked release verifier path'),
      status: 'blocked',
      verdict: reason,
    },
  };

  return {
    ...summaryCore,
    proofHash: digest(summaryCore),
  };
}

function collectProductionPreflightSummaries(value) {
  const matches = [];
  visitEvidence(value, (candidate) => {
    if (
      candidate
      && typeof candidate === 'object'
      && candidate.summaryPath === 'productionPreflightRoute'
    ) {
      matches.push(candidate);
    }
  });
  return matches;
}

function collectPreflightRouteEvidenceBlocks(value) {
  const matches = [];
  visitEvidence(value, (candidate) => {
    if (
      candidate
      && typeof candidate === 'object'
      && candidate.routeHash === sha256Hex(routeName)
      && candidate.endpointPathHash === sha256Hex(endpointPath)
      && candidate.proofHash
    ) {
      matches.push(candidate);
    }
  });
  return matches;
}

function visitEvidence(value, visitor, seen = new WeakSet()) {
  visitor(value);
  if (!value || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    visitEvidence(child, visitor, seen);
  }
  seen.delete(value);
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
      `release-verifier evidence leaked raw value ${rawValue}`,
    );
  }
}

function assertHashOnlyReleaseVerifierEvidence(value, rawValues) {
  assertEvidenceHasNoRawValues(value, { label: 'RPP-0581 release verifier preflight proof' });
  assertNoRawValues(value, rawValues);
}

test('RPP-0581 v5 keeps the production preflight route aligned with the release verifier preflight branch', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/preflight',
  );
  const callback = functionBody('reprint_push_lab_rest_authenticated_preflight');

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::READABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_preflight'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'preflight')",
    'reprint_push_lab_rest_auth_evidence($request)',
  );
  assertBefore(callback, 'reprint_push_lab_rest_route_profile($request)', 'reprint_push_export_snapshot()');
  assertBefore(
    releaseVerifierSource,
    "const preflight = await client.signedGet('/preflight', { retryable: true });",
    'const proof = await runAuthenticatedHttpPush({',
  );
  assert.match(
    releaseVerifierSource,
    /assert\.equal\(preflight\.status, 200, `production-shaped release verify preflight HTTP \$\{preflight\.status\}`\)/,
  );
});

test('RPP-0581 v5 carries live preflight endpoint proof through a release-verifier NO-GO envelope', async () => {
  await withLivePreflightEndpoint(async ({ sourceUrl, port, state }) => {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });
    const preflight = await client.signedGet('/preflight', {
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const receipt = buildPreflightRouteReceipt({
      preflight,
      state,
      sourceUrl,
      port,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectPreflightRouteEvidenceBlocks(verifyReleaseSummary);
    const productionSummaries = collectProductionPreflightSummaries(verifyReleaseSummary);

    assert.equal(preflight.status, 200);
    assert.equal(preflight.request.method, 'GET');
    assert.equal(preflight.request.pathname, endpointPath);
    assert.equal(preflight.request.contentHash, sha256Hex(''));
    assert.match(preflight.request.canonicalHash, hashPattern);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.mode, 'preflight');
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.routePrefix, '/push');
    assert.equal(preflight.body.auth.identity.userLogin, credential.username);
    assert.equal(preflight.body.auth.identity.capabilities.manage_options, true);
    assert.equal(preflight.body.auth.session.type, 'production-auth-session');
    assert.equal(preflight.body.auth.session.status, 'active');
    assert.equal(preflight.body.auth.session.id, preflight.body.session.id);
    assert.equal(preflight.body.session.type, 'production-auth-session');
    assert.equal(preflight.body.session.sourceUrlHash, sha256Hex(sourceUrl));
    assert.match(preflight.body.session.sessionHash, hashPattern);
    assert.match(preflight.body.session.signingKeyHash, hashPattern);
    assert.match(preflight.body.snapshotHash, hashPattern);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].sessionHeaderPresent, false);
    assert.equal(state.requests[0].idempotencyKeyPresent, false);
    assert.equal(state.mutationCapableWorkAttempts, 0);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.code, 'LIVE_PREFLIGHT_ROUTE_V5_SUPPORT_ONLY');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.productionInputs.liveEndpointChecked, true);
    assert.equal(receipt.productionInputs.liveEndpointAvailable, true);
    assert.equal(receipt.productionInputs.productionOwnedUrlSupplied, false);
    assert.equal(receipt.productionInputs.productionCredentialsSupplied, false);
    assert.equal(receipt.liveEndpointSummary.exposure, 'sandbox-local-loopback-only');
    assert.equal(receipt.liveEndpointSummary.tunnel, 'none');
    assert.equal(receipt.routeEvidence.liveEndpointChecked, true);
    assert.equal(receipt.routeEvidence.liveEndpointLoopbackOnly, true);
    assert.equal(receipt.routeEvidence.requestPathMatchesEndpoint, true);
    assert.equal(receipt.routeEvidence.signedGet, true);
    assert.equal(receipt.authSummary.credentialBound, true);
    assert.equal(receipt.authSummary.identityBound, true);
    assert.equal(receipt.authSummary.sessionBound, true);
    assert.equal(receipt.authSummary.sourceBound, true);
    assert.equal(receipt.preflightSummary.noSessionHeader, true);
    assert.equal(receipt.preflightSummary.noIdempotencyHeader, true);
    assert.equal(receipt.execution.requestCount, 1);
    assert.equal(receipt.execution.authAttempts, 1);
    assert.equal(receipt.execution.signedPreflightAttempts, 1);
    assert.equal(receipt.execution.sessionMintAttempts, 1);
    assert.equal(receipt.execution.snapshotHashAttempts, 1);
    assert.equal(receipt.execution.mutationCapableWorkAttempts, 0);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(receipt.redaction.rawValuesIncluded, false);
    assert.equal(receipt.carriedThrough.supportOnlyNoGo, true);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionPreflightRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionPreflightRoute.receiptHash, receipt.receiptHash);
    assert.equal(
      verifyReleaseSummary.productionPreflightRoute.routeEvidence.proofHash,
      receipt.routeEvidence.proofHash,
    );
    assert.equal(productionSummaries.length, 1);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(productionSummaries[0], verifyReleaseSummary.productionPreflightRoute);
    assert.deepEqual(routeEvidenceBlocks[0], verifyReleaseSummary.productionPreflightRoute.routeEvidence);

    assertHashOnlyFields(receipt.liveEndpointSummary, [
      'transportHash',
      'hostHash',
      'portHash',
      'endpointUrlHash',
    ]);
    assertHashOnlyFields(receipt.sourceSummary, ['sourceUrlHash', 'sourceHash']);
    assertHashOnlyFields(receipt.authSummary, [
      'credentialHash',
      'userLoginHash',
      'identityHash',
      'sessionIdHash',
      'sessionHash',
      'sessionExpiresAtHash',
      'sourceHash',
      'sourceUrlHash',
      'sessionTypeHash',
      'sessionStatusHash',
    ]);
    assertHashOnlyFields(receipt.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashOnlyFields(receipt.preflightSummary, ['modeHash', 'proofHash']);
    assertHashOnlyFields(receipt.execution, ['phaseHash']);
    assert.match(receipt.receiptHash, hashPattern);
    assert.match(verifyReleaseSummary.proofHash, hashPattern);
    assertHashOnlyReleaseVerifierEvidence(verifyReleaseSummary, [
      sourceUrl,
      `${sourceUrl}${endpointPath}`,
      credential.username,
      credential.password,
      sessionId,
      labSigningKey(),
      signedNonce,
    ]);
  });
});

test('RPP-0581 v5 blocks missing or malformed preflight route evidence before release movement', () => {
  const state = createRouteState();
  const acceptedBody = preflightBody('http://127.0.0.1:8080');
  const missing = buildPreflightRouteReceipt({
    preflight: null,
    state,
  });
  const wrongRoute = buildPreflightRouteReceipt({
    preflight: {
      status: 200,
      request: {
        method: 'GET',
        pathname: `${routePrefix}/dry-run`,
        contentHash: sha256Hex(''),
        canonicalHash: sha256Hex('wrong-route'),
      },
      body: acceptedBody,
    },
    state: {
      ...createRouteState(),
      requests: [{ sessionHeaderPresent: false, idempotencyKeyPresent: false }],
    },
    sourceUrl: 'http://127.0.0.1:8080',
    port: 8080,
  });
  const missingLiveCheck = buildPreflightRouteReceipt({
    preflight: {
      status: 200,
      request: {
        method: 'GET',
        pathname: endpointPath,
        contentHash: sha256Hex(''),
        canonicalHash: sha256Hex('not-from-live-endpoint'),
      },
      body: acceptedBody,
    },
    state: createRouteState(),
    sourceUrl: 'http://127.0.0.1:8080',
    port: 8080,
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'PREFLIGHT_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'PREFLIGHT_ROUTE_PROOF_REQUIRED');

  for (const malformed of [wrongRoute, missingLiveCheck]) {
    const summary = buildVerifyReleaseStyleSummary(malformed);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.status, 'blocked');
    assert.equal(malformed.code, 'PREFLIGHT_ROUTE_PROOF_MALFORMED');
    assert.equal(malformed.releaseStatus, 'NO-GO');
    assert.equal(malformed.releaseMovement.allowed, false);
    assert.equal(malformed.mutationAttempted, false);
    assert.equal(malformed.boundary.verdict, 'PREFLIGHT_ROUTE_PROOF_MALFORMED');
    assert.equal(summary.ok, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.productionPreflightRoute.ok, false);
    assert.equal(collectProductionPreflightSummaries(summary).length, 1);
    assert.equal(collectPreflightRouteEvidenceBlocks(summary).length, 1);
    assertHashOnlyWhenPresent(malformed.sourceSummary, ['sourceUrlHash', 'sourceHash']);
    assertHashOnlyWhenPresent(malformed.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashOnlyReleaseVerifierEvidence(summary, [
      'http://127.0.0.1:8080',
      credential.username,
      credential.password,
      sessionId,
      labSigningKey(),
    ]);
  }
});
