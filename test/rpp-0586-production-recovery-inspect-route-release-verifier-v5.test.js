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
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');

const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/recovery/inspect`;
const routeName = '/push/recovery/inspect';
const checkedCommand = 'timeout 300s npm run verify:release';
const credential = {
  username: 'rpp_0586_admin',
  password: 'rpp-0586-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0586-wrong-application-password',
};
const sessionId = 'psh_rpp_0586_live_recovery_inspect_session_000001';
const invalidSessionId = 'psh_rpp_0586_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0586-live-recovery-inspect-route-v5';
const signedTimestamp = '1780000586';
const signedNonce = 'rpp0586liverecoveryinspectnonce';
const proofCapturedAt = '2026-05-31T16:00:00Z';
const freshExpiresAt = '2026-05-31T16:04:00Z';
const rawPlanSecret = 'rpp-0586-private-plan-value';
const rawReceiptSecret = 'rpp-0586-private-receipt-value';
const hashPattern = /^[a-f0-9]{64}$/;

const recoveryInspectPayload = {
  plan: {
    id: 'plan-rpp-0586-live-recovery-inspect',
    status: 'ready',
    privatePlanHash: sha256Hex(rawPlanSecret),
    summary: { total: 2, create: 0, update: 2, delete: 0 },
    mutations: [
      {
        id: 'rpp-0586-option-update',
        resourceKeyHash: sha256Hex('wp_option:blogname'),
        action: 'inspect-before-repair',
      },
      {
        id: 'rpp-0586-post-update',
        resourceKeyHash: sha256Hex('wp_post:42'),
        action: 'inspect-before-repair',
      },
    ],
    conflicts: [],
    blockers: [],
  },
  receipt: {
    type: 'dry-run',
    receiptHash: `sha256:${sha256Hex(rawReceiptSecret)}`,
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

function pushCanonicalString({ method, pathname, contentHash, session = '', idempotency = '' }) {
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname,
    '',
    contentHash,
    session,
    idempotency,
  ].join('\n');
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function jsonResponse(response, body, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json',
    connection: 'close',
  });
  response.end(JSON.stringify(body));
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
}

function functionBody(source, name, { afterParameters = false } = {}) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const jsBodyStart = afterParameters ? source.indexOf(') {', start) : -1;
  const open = jsBodyStart === -1 ? source.indexOf('{', start) : jsBodyStart + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
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

function createRouteState() {
  return {
    requests: [],
    phaseLog: [],
    authAttempts: 0,
    jsonParseAttempts: 0,
    recoveryInspectReadAttempts: 0,
    writePathAttempts: 0,
    mutationSideEffects: 0,
    rowsBefore: 2,
    rowsAfter: 2,
    recoveryStateBefore: 'old-remote',
    recoveryStateAfter: 'old-remote',
  };
}

function authenticateRecoveryInspectRequest({ method, pathname, headers, rawBody, state }) {
  state.authAttempts += 1;
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

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  if (headers['x-reprint-push-idempotency-key'] !== idempotencyKey) {
    return { code: 'SIGNED_IDEMPOTENCY_KEY_INVALID', status: 401 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const signingKey = labSigningKey();
  const expectedAuthSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== expectedAuthSignature) {
    return { code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'],
    idempotency: headers['x-reprint-push-idempotency-key'],
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody, sourceUrl) {
  return {
    ok: false,
    code,
    mode: 'inspect',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      routePathHash: sha256Hex(endpointPath),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      jsonParsed: false,
      recoveryInspectReadAttempted: false,
      writePathAttempted: false,
      mutationAttempted: false,
    },
  };
}

function recoveryInspectBody({ payload, headers, rawBody, sourceUrl, state }) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const idempotency = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const signingKey = labSigningKey();
  const canonicalHash = sha256Hex(pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotency,
  }));
  const identity = {
    userLogin: credential.username,
    userId: 586,
    capabilities: { manage_options: true },
  };
  const counts = {
    old: Array.isArray(payload?.plan?.mutations) ? payload.plan.mutations.length : 0,
    new: 0,
    blockedUnknown: 0,
    total: Array.isArray(payload?.plan?.mutations) ? payload.plan.mutations.length : 0,
  };

  return {
    ok: true,
    mode: 'inspect',
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
        expiresAt: freshExpiresAt,
      },
    },
    recovery: {
      state: 'old-remote',
      planHash: sha256Hex(JSON.stringify(payload?.plan || {})),
      receiptHash: sha256Hex(JSON.stringify(payload?.receipt || {})),
      counts,
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          rowCount: state.rowsAfter,
        },
      },
    },
    recoveryInspect: {
      schemaVersion: 1,
      readOnly: true,
      classificationOnly: true,
      authSessionBound: true,
      idempotencyKeyPresent: true,
      rowsBefore: state.rowsBefore,
      rowsAfter: state.rowsAfter,
      rowsStableAcrossRead: state.rowsBefore === state.rowsAfter,
      stateBefore: state.recoveryStateBefore,
      stateAfter: state.recoveryStateAfter,
      stateStableAcrossRead: state.recoveryStateBefore === state.recoveryStateAfter,
      writePathAttempted: false,
      mutationAttempted: false,
    },
    signedRequest: {
      signed: true,
      schemaVersion: 1,
      contentHash,
      sourceUrlHash: sha256Hex(sourceUrl),
      nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
      sessionHash: sha256Hex(session),
      signingKeyHash: sha256Hex(signingKey),
      request: {
        canonicalHash,
        path: endpointPath,
        idempotencyKeyPresent: true,
        idempotencyKeyHash: sha256Hex(idempotency),
      },
    },
  };
}

async function withLiveRecoveryInspectEndpoint(run) {
  const state = createRouteState();
  let sourceUrl = '';
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const requestUrl = new URL(request.url || '/', sourceUrl);
      const method = request.method || 'GET';
      const headers = headerEntries(request.headers || {});
      state.requests.push({
        methodHash: sha256Hex(method),
        pathnameHash: sha256Hex(requestUrl.pathname),
        bodyHash: sha256Hex(rawBody),
        sessionHeaderPresent: Boolean(headers['x-reprint-push-session']),
        idempotencyKeyPresent: Boolean(headers['x-reprint-push-idempotency-key']),
      });
      state.phaseLog.push('request-received');

      if (requestUrl.pathname !== endpointPath) {
        state.phaseLog.push('route-miss');
        jsonResponse(response, { ok: false, code: 'ROUTE_NOT_FOUND' }, 404);
        return;
      }

      state.phaseLog.push('auth-start');
      const authError = authenticateRecoveryInspectRequest({
        method,
        pathname: requestUrl.pathname,
        headers,
        rawBody,
        state,
      });
      if (authError) {
        state.phaseLog.push(`auth-reject:${authError.code}`);
        jsonResponse(
          response,
          authFailureBody(authError.code, headers, rawBody, sourceUrl),
          authError.status,
        );
        return;
      }

      state.phaseLog.push('auth-accepted');
      state.jsonParseAttempts += 1;
      const payload = JSON.parse(rawBody);
      state.recoveryInspectReadAttempts += 1;
      state.phaseLog.push('recovery-inspect-read');

      jsonResponse(response, recoveryInspectBody({
        payload,
        headers,
        rawBody,
        sourceUrl,
        state,
      }));
    });
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
      `live recovery inspect endpoint still accepts connections on ${sourceUrl}`,
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

function routeProofCode({ recoveryInspect = null, state = null } = {}) {
  if (!recoveryInspect) {
    return 'RECOVERY_INSPECT_ROUTE_PROOF_REQUIRED';
  }

  const body = recoveryInspect.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const session = body.auth?.session || {};
  const inspect = body.recoveryInspect || {};
  const signedRequest = body.signedRequest || {};
  const accepted = recoveryInspect.status === 200
    && body.ok === true
    && body.mode === 'inspect'
    && recoveryInspect.request?.method === 'POST'
    && recoveryInspect.request?.pathname === endpointPath
    && routeProfile.profile === 'production-shaped'
    && routeProfile.restNamespace === 'reprint/v1'
    && routeProfile.routePrefix === '/push'
    && routeProfile.labBacked === true
    && identity.userLogin === credential.username
    && identity.capabilities?.manage_options === true
    && session.id === sessionId
    && session.type === 'production-auth-session'
    && session.status === 'active'
    && body.recovery?.state === 'old-remote'
    && body.recovery?.journal?.integrity?.status === 'ok'
    && body.recovery?.counts?.total === recoveryInspectPayload.plan.mutations.length
    && inspect.readOnly === true
    && inspect.classificationOnly === true
    && inspect.authSessionBound === true
    && inspect.idempotencyKeyPresent === true
    && inspect.rowsStableAcrossRead === true
    && inspect.stateStableAcrossRead === true
    && inspect.writePathAttempted === false
    && inspect.mutationAttempted === false
    && signedRequest.signed === true
    && signedRequest.sessionHash === sha256Hex(sessionId)
    && signedRequest.request?.idempotencyKeyHash === sha256Hex(idempotencyKey)
    && state?.requests.length === 1
    && state.requests[0]?.sessionHeaderPresent === true
    && state.requests[0]?.idempotencyKeyPresent === true
    && state.writePathAttempts === 0
    && state.mutationSideEffects === 0;

  return accepted
    ? 'LIVE_RECOVERY_INSPECT_ROUTE_V5_SUPPORT_ONLY'
    : 'RECOVERY_INSPECT_ROUTE_PROOF_MALFORMED';
}

function buildRecoveryInspectRouteReceipt({
  recoveryInspect = null,
  state = createRouteState(),
  sourceUrl = '',
  port = 0,
  capturedAt = proofCapturedAt,
} = {}) {
  const body = recoveryInspect?.body || {};
  const routeProfile = body.routeProfile || {};
  const identity = body.auth?.identity || {};
  const session = body.auth?.session || {};
  const inspect = body.recoveryInspect || {};
  const signedRequest = body.signedRequest || {};
  const recovery = body.recovery || {};
  const counts = recovery.counts || {};
  const code = routeProofCode({ recoveryInspect, state });
  const ok = code === 'LIVE_RECOVERY_INSPECT_ROUTE_V5_SUPPORT_ONLY';
  const requestPath = recoveryInspect?.request?.pathname || null;
  const routeEvidence = {
    schemaVersion: 1,
    methodHash: sha256Hex(recoveryInspect?.request?.method || 'POST'),
    endpointPathHash: sha256Hex(endpointPath),
    requestPathHash: requestPath ? sha256Hex(requestPath) : null,
    routeHash: sha256Hex(routeName),
    routeProfileHash: routeProfile.profile ? sha256Hex(routeProfile.profile) : null,
    restNamespaceHash: routeProfile.restNamespace ? sha256Hex(routeProfile.restNamespace) : null,
    routePrefixHash: routeProfile.routePrefix ? sha256Hex(routeProfile.routePrefix) : null,
    signedPost: signedRequest.signed === true,
    sessionBound: signedRequest.sessionHash === sha256Hex(sessionId),
    idempotencyKeyPresent: Boolean(signedRequest.request?.idempotencyKeyHash),
    idempotencyKeyHashLength: String(signedRequest.request?.idempotencyKeyHash || '').length,
    readOnlyClassification: inspect.readOnly === true && inspect.classificationOnly === true,
    liveEndpointChecked: ok,
    liveEndpointLoopbackOnly: ok,
    requestPathMatchesEndpoint: requestPath === endpointPath,
    proofHash: digest({
      methodHash: sha256Hex(recoveryInspect?.request?.method || 'POST'),
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: requestPath ? sha256Hex(requestPath) : null,
      routeHash: sha256Hex(routeName),
      status: recoveryInspect?.status ?? null,
      ok,
      routeProfileHash: routeProfile.profile ? sha256Hex(routeProfile.profile) : null,
      recoveryStateHash: recovery.state ? sha256Hex(recovery.state) : null,
      countsHash: recovery.counts ? digest(recovery.counts) : null,
      liveEndpointHash: sourceUrl ? sha256Hex(`${sourceUrl}${endpointPath}`) : null,
      capturedAtHash: sha256Hex(capturedAt),
    }),
  };
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0586',
    proofClass: 'release-verifier-production-recovery-inspect-route-v5',
    evidenceScope: 'release-verifier-live-endpoint-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code,
    capturedAtHash: sha256Hex(capturedAt),
    carriedThrough: {
      rpp0566ProofClassHash: sha256Hex('live-loopback-production-recovery-inspect-route'),
      rpp0546SupportShapeHash: digest([
        'signed production-shaped recovery inspect route',
        'session-bound recovery classification',
        'stable rows and state across inspect',
        'hash-only support evidence',
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
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: identity.userLogin ? sha256Hex(identity.userLogin) : null,
      userIdHash: identity.userId === undefined ? null : sha256Hex(String(identity.userId)),
      sessionIdHash: session.id ? sha256Hex(session.id) : null,
      sessionExpiresAtHash: session.expiresAt ? sha256Hex(session.expiresAt) : null,
      sessionTypeHash: session.type ? sha256Hex(session.type) : null,
      sessionStatusHash: session.status ? sha256Hex(session.status) : null,
      signedSessionHash: signedRequest.sessionHash || null,
      signingKeyHashLength: String(signedRequest.signingKeyHash || '').length,
      idempotencyKeyHash: signedRequest.request?.idempotencyKeyHash || null,
      identityBound: identity.userLogin === credential.username,
      sessionBound: session.id === sessionId && signedRequest.sessionHash === sha256Hex(sessionId),
      manageOptions: identity.capabilities?.manage_options === true,
    },
    routeEvidence,
    recoveryInspectSummary: {
      status: recoveryInspect?.status ?? null,
      ok: body.ok === true,
      modeHash: body.mode ? sha256Hex(body.mode) : null,
      recoveryStateHash: recovery.state ? sha256Hex(recovery.state) : null,
      oldCount: Number.isInteger(counts.old) ? counts.old : null,
      newCount: Number.isInteger(counts.new) ? counts.new : null,
      blockedUnknownCount: Number.isInteger(counts.blockedUnknown) ? counts.blockedUnknown : null,
      totalCount: Number.isInteger(counts.total) ? counts.total : null,
      countsHash: recovery.counts ? digest(recovery.counts) : null,
      journalIntegrityStatusHash: recovery.journal?.integrity?.status
        ? sha256Hex(recovery.journal.integrity.status)
        : null,
      planHash: recovery.planHash || null,
      receiptHash: recovery.receiptHash || null,
      signed: signedRequest.signed === true,
      authSessionBound: inspect.authSessionBound === true,
      rowsBefore: Number.isInteger(inspect.rowsBefore) ? inspect.rowsBefore : null,
      rowsAfter: Number.isInteger(inspect.rowsAfter) ? inspect.rowsAfter : null,
      rowsStableAcrossRead: inspect.rowsStableAcrossRead === true,
      stateStableAcrossRead: inspect.stateStableAcrossRead === true,
      classificationOnly: inspect.classificationOnly === true,
      idempotencyKeyPresent: inspect.idempotencyKeyPresent === true,
      canonicalHashLength: String(signedRequest.request?.canonicalHash || '').length,
      idempotencyKeyHashLength: String(signedRequest.request?.idempotencyKeyHash || '').length,
      sessionHashLength: String(signedRequest.sessionHash || '').length,
      writePathAttempts: state.writePathAttempts,
      mutationAttempted: inspect.mutationAttempted === true || state.mutationSideEffects > 0,
      proofHash: digest({
        status: recoveryInspect?.status ?? null,
        ok: body.ok === true,
        modeHash: body.mode ? sha256Hex(body.mode) : null,
        recoveryStateHash: recovery.state ? sha256Hex(recovery.state) : null,
        countsHash: recovery.counts ? digest(recovery.counts) : null,
        rowsBefore: inspect.rowsBefore ?? null,
        rowsAfter: inspect.rowsAfter ?? null,
        rowsStableAcrossRead: inspect.rowsStableAcrossRead === true,
        stateStableAcrossRead: inspect.stateStableAcrossRead === true,
        mutationAttempted: inspect.mutationAttempted === true || state.mutationSideEffects > 0,
      }),
    },
    execution: {
      requestCount: state.requests.length,
      authAttempts: state.authAttempts,
      jsonParseAttempts: state.jsonParseAttempts,
      recoveryInspectReadAttempts: state.recoveryInspectReadAttempts,
      writePathAttempts: state.writePathAttempts,
      mutationSideEffects: state.mutationSideEffects,
      phaseHash: sha256Hex(state.phaseLog.join('\n')),
    },
    mutationAttempted: false,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('production-owned recovery inspect route proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'production-owned recovery inspect route proof on checked release verifier path',
      ),
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : code,
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(recoveryInspectRouteReceipt) {
  const reason = recoveryInspectRouteReceipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : recoveryInspectRouteReceipt.code;
  const routeSummary = {
    ok: recoveryInspectRouteReceipt.ok === true,
    summaryPath: 'productionRecoveryInspectRoute',
    receiptHash: recoveryInspectRouteReceipt.receiptHash,
    liveEndpointSummary: recoveryInspectRouteReceipt.liveEndpointSummary,
    routeEvidence: recoveryInspectRouteReceipt.routeEvidence,
    recoveryInspectSummary: recoveryInspectRouteReceipt.recoveryInspectSummary,
    authSummary: recoveryInspectRouteReceipt.authSummary,
    execution: recoveryInspectRouteReceipt.execution,
    redaction: recoveryInspectRouteReceipt.redaction,
    carriedThrough: recoveryInspectRouteReceipt.carriedThrough,
    requiredHash: digest([
      'signed POST production recovery inspect route',
      'live endpoint checked through authenticated client',
      'old-remote recovery classification',
      'hash-count-status-only release verifier envelope',
      'support-only NO-GO release movement',
    ]),
    scopeHash: sha256Hex(recoveryInspectRouteReceipt.evidenceScope),
  };
  const summaryCore = {
    schemaVersion: 1,
    slice: 'RPP-0586',
    evidenceSourceHash: sha256Hex('release-verifier-production-recovery-inspect-route-v5'),
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarkerHash: sha256Hex(`[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`),
    mutationAttempted: false,
    productionRecoveryInspectRoute: routeSummary,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex(recoveryInspectRouteReceipt.ok === true
        ? 'production-owned recovery inspect route proof required before release movement'
        : 'recovery inspect route proof required before release movement'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'production-owned recovery inspect route proof on checked release verifier path',
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

function collectProductionRecoveryInspectSummaries(value) {
  const matches = [];
  visitEvidence(value, (candidate) => {
    if (
      candidate
      && typeof candidate === 'object'
      && candidate.summaryPath === 'productionRecoveryInspectRoute'
    ) {
      matches.push(candidate);
    }
  });
  return matches;
}

function collectRecoveryInspectRouteEvidenceBlocks(value) {
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

function assertHashCountStatusOnlyEvidence(value, rawValues) {
  assertEvidenceHasNoRawValues(value, {
    label: 'RPP-0586 release verifier recovery inspect proof',
  });
  assertNoRawValues(value, rawValues);
}

test('RPP-0586 v5 keeps the production recovery inspect route aligned with release verifier output', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/recovery/inspect',
  );
  const callback = functionBody(routeSource, 'reprint_push_lab_rest_authenticated_recovery_inspect');
  const liveCombinedProof = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof', {
    afterParameters: true,
  });
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence', {
    afterParameters: true,
  });

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_recovery_inspect'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assertBefore(
    callback,
    "reprint_push_lab_rest_require_signed_request($request, 'recovery-inspect')",
    'reprint_push_lab_rest_recovery_inspect($request)',
  );
  assert.match(releaseVerifierSource, /recoveryInspect:\s*proof\.recoveryInspect/);
  assert.match(liveReleaseVerifierSource, /checkedRoutes:\s*\[[^\]]*'recovery-inspect'/s);
  assert.match(liveCombinedProof, /\.\.\.verify,\s*gate2DurableRecoveryJournal:/s);
  assert.equal(
    (liveCombinedProof.match(/productionRecoveryInspectRoute/g) || []).length,
    0,
    'combined proof should carry recovery inspect route evidence through the release proof spread',
  );
  assert.equal(
    (topologyEvidence.match(/productionRecoveryInspectRoute/g) || []).length,
    0,
    'topology evidence must not duplicate the recovery inspect route summary',
  );
});

test('RPP-0586 v5 carries live recovery inspect endpoint proof through a release-verifier NO-GO envelope', async () => {
  await withLiveRecoveryInspectEndpoint(async ({ sourceUrl, port, state }) => {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 30_000,
    });
    const recoveryInspect = await client.signedPost('/recovery/inspect', recoveryInspectPayload, {
      session: sessionId,
      idempotencyKey,
      retryable: true,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });
    const receipt = buildRecoveryInspectRouteReceipt({
      recoveryInspect,
      state,
      sourceUrl,
      port,
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectRecoveryInspectRouteEvidenceBlocks(verifyReleaseSummary);
    const productionSummaries = collectProductionRecoveryInspectSummaries(verifyReleaseSummary);

    assert.equal(recoveryInspect.status, 200);
    assert.equal(recoveryInspect.request.method, 'POST');
    assert.equal(recoveryInspect.request.pathname, endpointPath);
    assert.match(recoveryInspect.request.contentHash, hashPattern);
    assert.equal(recoveryInspect.request.idempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.match(recoveryInspect.request.canonicalHash, hashPattern);
    assert.equal(recoveryInspect.body.ok, true);
    assert.equal(recoveryInspect.body.mode, 'inspect');
    assert.equal(recoveryInspect.body.routeProfile.profile, 'production-shaped');
    assert.equal(recoveryInspect.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(recoveryInspect.body.routeProfile.routePrefix, '/push');
    assert.equal(recoveryInspect.body.auth.identity.userLogin, credential.username);
    assert.equal(recoveryInspect.body.auth.identity.capabilities.manage_options, true);
    assert.equal(recoveryInspect.body.auth.session.type, 'production-auth-session');
    assert.equal(recoveryInspect.body.auth.session.status, 'active');
    assert.equal(recoveryInspect.body.auth.session.id, sessionId);
    assert.equal(recoveryInspect.body.recovery.state, 'old-remote');
    assert.equal(recoveryInspect.body.recovery.counts.total, recoveryInspectPayload.plan.mutations.length);
    assert.equal(recoveryInspect.body.recovery.counts.old, recoveryInspectPayload.plan.mutations.length);
    assert.equal(recoveryInspect.body.recovery.counts.new, 0);
    assert.equal(recoveryInspect.body.recovery.counts.blockedUnknown, 0);
    assert.equal(recoveryInspect.body.recovery.journal.integrity.status, 'ok');
    assert.equal(recoveryInspect.body.recoveryInspect.readOnly, true);
    assert.equal(recoveryInspect.body.recoveryInspect.classificationOnly, true);
    assert.equal(recoveryInspect.body.recoveryInspect.rowsStableAcrossRead, true);
    assert.equal(recoveryInspect.body.recoveryInspect.stateStableAcrossRead, true);
    assert.equal(recoveryInspect.body.recoveryInspect.writePathAttempted, false);
    assert.equal(recoveryInspect.body.recoveryInspect.mutationAttempted, false);
    assert.match(recoveryInspect.body.signedRequest.sessionHash, hashPattern);
    assert.match(recoveryInspect.body.signedRequest.signingKeyHash, hashPattern);
    assert.match(recoveryInspect.body.signedRequest.request.canonicalHash, hashPattern);
    assert.equal(recoveryInspect.body.signedRequest.request.idempotencyKeyHash, sha256Hex(idempotencyKey));

    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].sessionHeaderPresent, true);
    assert.equal(state.requests[0].idempotencyKeyPresent, true);
    assert.equal(state.authAttempts, 1);
    assert.equal(state.jsonParseAttempts, 1);
    assert.equal(state.recoveryInspectReadAttempts, 1);
    assert.equal(state.writePathAttempts, 0);
    assert.equal(state.mutationSideEffects, 0);

    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.code, 'LIVE_RECOVERY_INSPECT_ROUTE_V5_SUPPORT_ONLY');
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
    assert.equal(receipt.routeEvidence.signedPost, true);
    assert.equal(receipt.routeEvidence.sessionBound, true);
    assert.equal(receipt.routeEvidence.idempotencyKeyPresent, true);
    assert.equal(receipt.routeEvidence.idempotencyKeyHashLength, 64);
    assert.equal(receipt.routeEvidence.readOnlyClassification, true);
    assert.equal(receipt.authSummary.identityBound, true);
    assert.equal(receipt.authSummary.sessionBound, true);
    assert.equal(receipt.authSummary.manageOptions, true);
    assert.equal(receipt.recoveryInspectSummary.status, 200);
    assert.equal(receipt.recoveryInspectSummary.oldCount, 2);
    assert.equal(receipt.recoveryInspectSummary.newCount, 0);
    assert.equal(receipt.recoveryInspectSummary.blockedUnknownCount, 0);
    assert.equal(receipt.recoveryInspectSummary.totalCount, 2);
    assert.equal(receipt.recoveryInspectSummary.rowsStableAcrossRead, true);
    assert.equal(receipt.recoveryInspectSummary.stateStableAcrossRead, true);
    assert.equal(receipt.recoveryInspectSummary.classificationOnly, true);
    assert.equal(receipt.recoveryInspectSummary.idempotencyKeyPresent, true);
    assert.equal(receipt.recoveryInspectSummary.canonicalHashLength, 64);
    assert.equal(receipt.recoveryInspectSummary.idempotencyKeyHashLength, 64);
    assert.equal(receipt.recoveryInspectSummary.sessionHashLength, 64);
    assert.equal(receipt.recoveryInspectSummary.writePathAttempts, 0);
    assert.equal(receipt.recoveryInspectSummary.mutationAttempted, false);
    assert.equal(receipt.execution.requestCount, 1);
    assert.equal(receipt.execution.authAttempts, 1);
    assert.equal(receipt.execution.jsonParseAttempts, 1);
    assert.equal(receipt.execution.recoveryInspectReadAttempts, 1);
    assert.equal(receipt.execution.writePathAttempts, 0);
    assert.equal(receipt.execution.mutationSideEffects, 0);
    assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(receipt.redaction.rawValuesIncluded, false);
    assert.equal(receipt.carriedThrough.supportOnlyNoGo, true);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionRecoveryInspectRoute.ok, true);
    assert.equal(verifyReleaseSummary.productionRecoveryInspectRoute.receiptHash, receipt.receiptHash);
    assert.equal(
      verifyReleaseSummary.productionRecoveryInspectRoute.routeEvidence.proofHash,
      receipt.routeEvidence.proofHash,
    );
    assert.equal(productionSummaries.length, 1);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(productionSummaries[0], verifyReleaseSummary.productionRecoveryInspectRoute);
    assert.deepEqual(routeEvidenceBlocks[0], verifyReleaseSummary.productionRecoveryInspectRoute.routeEvidence);

    assertHashOnlyFields(receipt.liveEndpointSummary, [
      'transportHash',
      'hostHash',
      'portHash',
      'endpointUrlHash',
    ]);
    assertHashOnlyFields(receipt.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(receipt.authSummary, [
      'credentialHash',
      'userLoginHash',
      'userIdHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
      'sessionTypeHash',
      'sessionStatusHash',
      'signedSessionHash',
      'idempotencyKeyHash',
    ]);
    assertHashOnlyFields(receipt.routeEvidence, [
      'methodHash',
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashOnlyFields(receipt.recoveryInspectSummary, [
      'modeHash',
      'recoveryStateHash',
      'countsHash',
      'journalIntegrityStatusHash',
      'planHash',
      'receiptHash',
      'proofHash',
    ]);
    assertHashOnlyFields(receipt.execution, ['phaseHash']);
    assert.match(receipt.receiptHash, hashPattern);
    assert.match(verifyReleaseSummary.proofHash, hashPattern);
    assertHashCountStatusOnlyEvidence(verifyReleaseSummary, [
      sourceUrl,
      `${sourceUrl}${endpointPath}`,
      endpointPath,
      routeName,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      labSigningKey(),
      signedNonce,
      rawPlanSecret,
      rawReceiptSecret,
      JSON.stringify(recoveryInspectPayload),
    ]);
  });
});

test('RPP-0586 v5 blocks missing or malformed recovery inspect route evidence before release movement', () => {
  const state = createRouteState();
  const missing = buildRecoveryInspectRouteReceipt({
    recoveryInspect: null,
    state,
  });
  const malformed = buildRecoveryInspectRouteReceipt({
    recoveryInspect: {
      status: 200,
      request: {
        method: 'POST',
        pathname: `${routePrefix}/dry-run`,
        contentHash: sha256Hex(''),
        idempotencyKeyHash: sha256Hex(idempotencyKey),
        canonicalHash: sha256Hex('wrong-route'),
      },
      body: recoveryInspectBody({
        payload: recoveryInspectPayload,
        headers: {
          'x-auth-content-hash': sha256Hex(JSON.stringify(recoveryInspectPayload)),
          'x-auth-nonce': signedNonce,
          'x-reprint-push-session': sessionId,
          'x-reprint-push-idempotency-key': idempotencyKey,
        },
        rawBody: JSON.stringify(recoveryInspectPayload),
        sourceUrl: 'http://127.0.0.1:8080',
        state: {
          ...createRouteState(),
          recoveryInspectReadAttempts: 1,
        },
      }),
    },
    state: {
      ...createRouteState(),
      requests: [{
        sessionHeaderPresent: true,
        idempotencyKeyPresent: true,
      }],
      authAttempts: 1,
      jsonParseAttempts: 1,
      recoveryInspectReadAttempts: 1,
    },
    sourceUrl: 'http://127.0.0.1:8080',
    port: 8080,
  });
  const missingLiveCheck = buildRecoveryInspectRouteReceipt({
    recoveryInspect: {
      status: 200,
      request: {
        method: 'POST',
        pathname: endpointPath,
        contentHash: sha256Hex(JSON.stringify(recoveryInspectPayload)),
        idempotencyKeyHash: sha256Hex(idempotencyKey),
        canonicalHash: sha256Hex('not-from-live-endpoint'),
      },
      body: recoveryInspectBody({
        payload: recoveryInspectPayload,
        headers: {
          'x-auth-content-hash': sha256Hex(JSON.stringify(recoveryInspectPayload)),
          'x-auth-nonce': signedNonce,
          'x-reprint-push-session': sessionId,
          'x-reprint-push-idempotency-key': idempotencyKey,
        },
        rawBody: JSON.stringify(recoveryInspectPayload),
        sourceUrl: 'http://127.0.0.1:8080',
        state,
      }),
    },
    state,
    sourceUrl: 'http://127.0.0.1:8080',
    port: 8080,
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'RECOVERY_INSPECT_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'RECOVERY_INSPECT_ROUTE_PROOF_REQUIRED');

  for (const blocked of [malformed, missingLiveCheck]) {
    const summary = buildVerifyReleaseStyleSummary(blocked);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.code, 'RECOVERY_INSPECT_ROUTE_PROOF_MALFORMED');
    assert.equal(blocked.releaseStatus, 'NO-GO');
    assert.equal(blocked.releaseMovement.allowed, false);
    assert.equal(blocked.mutationAttempted, false);
    assert.equal(blocked.boundary.verdict, 'RECOVERY_INSPECT_ROUTE_PROOF_MALFORMED');
    assert.equal(summary.ok, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.productionRecoveryInspectRoute.ok, false);
    assert.equal(collectProductionRecoveryInspectSummaries(summary).length, 1);
    assert.equal(collectRecoveryInspectRouteEvidenceBlocks(summary).length, 1);
    assertHashOnlyWhenPresent(blocked.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyWhenPresent(blocked.routeEvidence, [
      'methodHash',
      'endpointPathHash',
      'requestPathHash',
      'routeHash',
      'routeProfileHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashCountStatusOnlyEvidence(summary, [
      'http://127.0.0.1:8080',
      endpointPath,
      routeName,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      labSigningKey(),
      signedNonce,
      rawPlanSecret,
      rawReceiptSecret,
      JSON.stringify(recoveryInspectPayload),
    ]);
  }
});
