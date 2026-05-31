import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sha256Pattern = /^[a-f0-9]{64}$/;
const skewSeconds = 300;
const fixedNowSeconds = 1_716_500_060;
const fixedTimestamp = '1716500000';
const sessionId = 'psh_01j00000000000000000552';
const idempotencyKey = 'idem-rpp-0552-canonicalization';
const validRawBody = '{"plan":{"id":"rpp-0552-plan","mutations":[]}}';
const malformedRawBody = '{"plan":';
const credential = {
  username: 'rpp_0552_user',
  password: 'rpp-0552-application-password',
};
const credentialHash = sha256Hex(`${credential.username}\n${credential.password}`);
const signingKey = hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
const signingKeyHash = sha256Hex(signingKey);
const sourceHash = fixtureHash('source');
const sourceUrlHash = fixtureHash('source-url');
const identityHash = fixtureHash('identity');
const validSession = {
  id: sessionId,
  sessionHash: sha256Hex(sessionId),
  credentialHash,
  signingKeyHash,
  identityHash,
  capabilityGranted: true,
  requiredCapability: 'manage_options',
  capabilityHash: fixtureHash('capability-granted'),
  sourceHash,
  sourceUrlHash,
  expiresAtUnix: fixedNowSeconds + 120,
};

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

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0552:${label}`);
}

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function authHeader() {
  return `Basic ${base64(`${credential.username}:${credential.password}`)}`;
}

function rawUrlDecodeQueryPart(value) {
  return decodeURIComponent(String(value).replace(/\+/g, '%20'));
}

function rawUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query) {
  if (!query) {
    return '';
  }

  return query
    .split('&')
    .map((part, index) => {
      if (!part) {
        return null;
      }
      const [key, value = ''] = part.split('=', 2);
      return {
        key: rawUrlDecodeQueryPart(key),
        value: rawUrlDecodeQueryPart(value),
        index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.key !== right.key) {
        return left.key < right.key ? -1 : 1;
      }
      if (left.value !== right.value) {
        return left.value < right.value ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((pair) => `${rawUrlEncode(pair.key)}=${rawUrlEncode(pair.value)}`)
    .join('&');
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: requestIdempotencyKey }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    canonicalQuery(rawQuery),
    contentHash,
    session,
    requestIdempotencyKey,
  ].join('\n');
}

function lowerCaseHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function signatureHeader(hex, format = 'hex') {
  if (format === 'prefixed') {
    return `sha256=${hex}`;
  }
  if (format === 'base64') {
    return Buffer.from(hex, 'hex').toString('base64');
  }
  return hex;
}

function signatureMatches(supplied, expectedHex) {
  let normalized = String(supplied || '').trim().toLowerCase();
  if (normalized.startsWith('sha256=')) {
    normalized = normalized.slice('sha256='.length);
  }
  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return normalized === expectedHex;
  }

  const decoded = Buffer.from(String(supplied || ''), 'base64');
  return decoded.length > 0 && decoded.equals(Buffer.from(expectedHex, 'hex'));
}

function buildSignedRequest({
  method = 'POST',
  pathname = '/wp-json/reprint/v1/push/apply',
  rawBody = validRawBody,
  session = sessionId,
  requestIdempotencyKey = idempotencyKey,
  nonce = 'rpp-0552-nonce-0001',
  timestamp = fixedTimestamp,
  pushSignatureFormat = 'hex',
  authSignatureFormat = 'hex',
} = {}) {
  const contentHash = sha256Hex(rawBody);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const pushCanonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session,
    idempotencyKey: requestIdempotencyKey,
  });

  return {
    method,
    pathname,
    rawBody,
    headers: lowerCaseHeaders({
      authorization: authHeader(),
      'X-Auth-Content-Hash': contentHash,
      'X-Auth-Timestamp': timestamp,
      'X-Auth-Nonce': nonce,
      'X-Auth-Signature': signatureHeader(hmacHex(signingKey, authString), authSignatureFormat),
      'X-Reprint-Push-Signature': signatureHeader(hmacHex(signingKey, pushCanonical), pushSignatureFormat),
      'X-Reprint-Push-Session': session,
      'X-Reprint-Push-Idempotency-Key': requestIdempotencyKey,
    }),
  };
}

function newVerifierState() {
  return {
    nonceClaims: new Set(),
    sessions: new Map([[sessionId, { ...validSession }]]),
    counters: {
      jsonParse: 0,
      nonceClaim: 0,
      receiptMint: 0,
      mutation: 0,
    },
  };
}

function signatureFailure(code, status, extra = {}) {
  return {
    ok: false,
    code,
    status,
    signature: {
      required: true,
      status,
    },
    ...extra,
  };
}

function parseSignedTimestamp(timestamp) {
  if (/^\d{10}$/.test(timestamp)) {
    return Number(timestamp);
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function verifySignedRequest(request, mode, state) {
  const headers = lowerCaseHeaders(request.headers);
  if (headers.authorization !== authHeader()) {
    return signatureFailure('SIGNED_AUTH_UNAVAILABLE', 401);
  }

  const contentHash = String(headers['x-auth-content-hash'] || '').trim().toLowerCase();
  const timestamp = String(headers['x-auth-timestamp'] || '').trim();
  const nonce = String(headers['x-auth-nonce'] || '').trim();
  const authSignature = String(headers['x-auth-signature'] || '').trim();
  const pushSignature = String(headers['x-reprint-push-signature'] || '').trim();
  const session = String(headers['x-reprint-push-session'] || '').trim();
  const requestIdempotencyKey = String(headers['x-reprint-push-idempotency-key'] || '').trim();

  for (const [header, value] of [
    ['X-Auth-Content-Hash', contentHash],
    ['X-Auth-Timestamp', timestamp],
    ['X-Auth-Nonce', nonce],
    ['X-Auth-Signature', authSignature],
    ['X-Reprint-Push-Signature', pushSignature],
  ]) {
    if (value === '') {
      return signatureFailure('SIGNED_HEADER_REQUIRED', 401, { header });
    }
  }

  if (mode !== 'preflight') {
    if (session === '') {
      return signatureFailure('SIGNED_SESSION_REQUIRED', 401);
    }
    if (requestIdempotencyKey === '') {
      return signatureFailure('MISSING_IDEMPOTENCY_KEY', 400);
    }
  }

  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    return signatureFailure('SIGNED_CONTENT_HASH_INVALID', 400);
  }
  if (sha256Hex(request.rawBody) !== contentHash) {
    return signatureFailure('SIGNED_CONTENT_HASH_MISMATCH', 401);
  }

  const timestampSeconds = parseSignedTimestamp(timestamp);
  if (timestampSeconds === null || Math.abs(fixedNowSeconds - timestampSeconds) > skewSeconds) {
    return signatureFailure('SIGNED_TIMESTAMP_INVALID', 401);
  }

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    return signatureFailure('SIGNED_NONCE_INVALID', 400);
  }

  const expectedAuthSignature = hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`);
  if (!signatureMatches(authSignature, expectedAuthSignature)) {
    return signatureFailure('SIGNED_AUTH_SIGNATURE_MISMATCH', 401);
  }

  let signedSession = null;
  if (mode !== 'preflight') {
    signedSession = state.sessions.get(session);
    if (!signedSession) {
      return signatureFailure('SIGNED_SESSION_INVALID', 401);
    }
    if (signedSession.expiresAtUnix < fixedNowSeconds) {
      return signatureFailure('SIGNED_SESSION_EXPIRED', 401);
    }
    if (signedSession.capabilityGranted !== true) {
      return signatureFailure('SIGNED_SESSION_CAPABILITY_DOWNGRADED', 403);
    }
    if (
      signedSession.credentialHash !== credentialHash
      || signedSession.signingKeyHash !== signingKeyHash
      || signedSession.identityHash !== identityHash
      || signedSession.sourceHash !== sourceHash
      || signedSession.sourceUrlHash !== sourceUrlHash
    ) {
      return signatureFailure('SIGNED_SESSION_BINDING_MISMATCH', 401);
    }
  }

  const canonical = pushCanonicalString({
    method: request.method,
    pathname: request.pathname,
    contentHash,
    session: mode === 'preflight' ? '' : session,
    idempotencyKey: mode === 'preflight' ? '' : requestIdempotencyKey,
  });
  const expectedPushSignature = hmacHex(signingKey, canonical);
  if (!signatureMatches(pushSignature, expectedPushSignature)) {
    return signatureFailure('SIGNED_PUSH_SIGNATURE_MISMATCH', 401, {
      canonicalHash: sha256Hex(canonical),
    });
  }

  const nonceHash = sha256Hex(nonce);
  state.counters.nonceClaim += 1;
  if (state.nonceClaims.has(nonceHash)) {
    return signatureFailure('SIGNED_NONCE_REPLAYED', 409);
  }
  state.nonceClaims.add(nonceHash);

  return {
    ok: true,
    status: 200,
    signature: {
      schemaVersion: 1,
      contentHash,
      nonceHash,
      sessionHash: signedSession?.sessionHash || '',
      signingKeyHash,
      request: {
        method: request.method.toUpperCase(),
        path: request.pathname.split('?', 2)[0] || '/',
        canonicalQuery: canonicalQuery(request.pathname.split('?', 2)[1] || ''),
        idempotencyKeyHash: requestIdempotencyKey ? sha256Hex(requestIdempotencyKey) : '',
        canonicalHash: sha256Hex(canonical),
      },
    },
  };
}

function runAuthenticatedRoute(request, mode, state) {
  const verification = verifySignedRequest(request, mode, state);
  if (verification.ok !== true) {
    return {
      ...verification,
      counters: { ...state.counters },
    };
  }

  state.counters.jsonParse += 1;
  let payload;
  try {
    payload = JSON.parse(request.rawBody);
  } catch {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      status: 400,
      counters: { ...state.counters },
    };
  }

  if (mode === 'dry-run') {
    state.counters.receiptMint += 1;
  }
  if (mode === 'apply') {
    state.counters.mutation += 1;
  }

  return {
    ok: true,
    status: 200,
    payloadHash: digest(payload),
    signature: verification.signature,
    counters: { ...state.counters },
  };
}

function hashOnlyEnvelope({ canonicalResults, negativeResults }) {
  return {
    schemaVersion: 1,
    slice: 'RPP-0552',
    status: 'support_only',
    generatedAt: '2026-05-31T00:00:00.000Z',
    canonicalGroups: canonicalResults.map((result) => ({
      caseHash: fixtureHash(`canonical:${result.name}`),
      methodHash: sha256Hex(result.method),
      leftRequestHash: digest({
        canonicalHash: result.left.signature.request.canonicalHash,
        canonicalQueryHash: sha256Hex(result.left.signature.request.canonicalQuery),
      }),
      rightRequestHash: digest({
        canonicalHash: result.right.signature.request.canonicalHash,
        canonicalQueryHash: sha256Hex(result.right.signature.request.canonicalQuery),
      }),
      normalizedCanonicalHash: result.left.signature.request.canonicalHash,
      normalizedQueryHash: sha256Hex(result.left.signature.request.canonicalQuery),
      pushSignatureHash: sha256Hex(result.leftPushSignature),
      rawValuesIncluded: false,
    })),
    negativeCases: negativeResults.map((result) => ({
      caseHash: fixtureHash(`negative:${result.name}`),
      code: result.code,
      status: result.status,
      requestHash: digest({
        bodyHash: sha256Hex(result.request.rawBody),
        pathHash: sha256Hex(result.request.pathname),
        methodHash: sha256Hex(result.request.method),
      }),
      parsedJson: result.counters.jsonParse > 0,
      nonceClaimed: result.counters.nonceClaim > 0,
      receiptMinted: result.counters.receiptMint > 0,
      mutated: result.counters.mutation > 0,
      rawValuesIncluded: false,
    })),
  };
}

test('RPP-0552 generated canonical signed requests normalize equivalent query variants', () => {
  const canonicalCases = [
    {
      name: 'sorts-query-keys-and-drops-empty-segments',
      method: 'GET',
      leftPath: '/wp-json/reprint/v1/push/db-journal?z=1&a=2&&',
      rightPath: '/wp-json/reprint/v1/push/db-journal?a=2&z=1',
      expectedQuery: 'a=2&z=1',
      rawBody: '',
    },
    {
      name: 'normalizes-plus-percent-and-rfc3986-encoding',
      method: 'GET',
      leftPath: '/wp-json/reprint/v1/push/db-journal?q=hello+world&mark=%7E%21',
      rightPath: '/wp-json/reprint/v1/push/db-journal?mark=~%21&q=hello%20world',
      expectedQuery: 'mark=~%21&q=hello%20world',
      rawBody: '',
    },
    {
      name: 'sorts-duplicate-values-as-a-multiset',
      method: 'GET',
      leftPath: '/wp-json/reprint/v1/push/db-journal?scope=write&scope=read&limit=080',
      rightPath: '/wp-json/reprint/v1/push/db-journal?limit=080&scope=read&scope=write',
      expectedQuery: 'limit=080&scope=read&scope=write',
      rawBody: '',
    },
    {
      name: 'normalizes-empty-values-and-encoded-slashes',
      method: 'POST',
      leftPath: '/wp-json/reprint/v1/push/apply?empty=&weird=a%2Fb&space=a+b',
      rightPath: '/wp-json/reprint/v1/push/apply?space=a%20b&weird=a%2Fb&empty',
      expectedQuery: 'empty=&space=a%20b&weird=a%2Fb',
      rawBody: validRawBody,
    },
  ];

  const results = canonicalCases.map((canonicalCase, index) => {
    const nonce = `rpp-0552-canon-${String(index).padStart(2, '0')}`;
    const leftRequest = buildSignedRequest({
      method: canonicalCase.method,
      pathname: canonicalCase.leftPath,
      rawBody: canonicalCase.rawBody,
      nonce,
      pushSignatureFormat: index % 2 === 0 ? 'hex' : 'prefixed',
    });
    const rightRequest = buildSignedRequest({
      method: canonicalCase.method,
      pathname: canonicalCase.rightPath,
      rawBody: canonicalCase.rawBody,
      nonce: `${nonce}-right`,
      pushSignatureFormat: index % 2 === 0 ? 'hex' : 'prefixed',
    });
    const leftPushSignature = leftRequest.headers['x-reprint-push-signature'];
    const rightPushSignature = rightRequest.headers['x-reprint-push-signature'];

    assert.equal(leftPushSignature, rightPushSignature, canonicalCase.name);

    const left = verifySignedRequest(leftRequest, 'journal-inspect', newVerifierState());
    const right = verifySignedRequest(rightRequest, 'journal-inspect', newVerifierState());
    assert.equal(left.ok, true, canonicalCase.name);
    assert.equal(right.ok, true, canonicalCase.name);
    assert.equal(left.signature.request.canonicalQuery, canonicalCase.expectedQuery);
    assert.equal(right.signature.request.canonicalQuery, canonicalCase.expectedQuery);
    assert.equal(left.signature.request.canonicalHash, right.signature.request.canonicalHash);
    assert.match(left.signature.request.canonicalHash, sha256Pattern);

    return {
      name: canonicalCase.name,
      method: canonicalCase.method,
      left,
      right,
      leftPushSignature,
    };
  });

  const envelope = hashOnlyEnvelope({ canonicalResults: results, negativeResults: [] });
  for (const group of envelope.canonicalGroups) {
    assert.match(group.normalizedCanonicalHash, sha256Pattern);
    assert.match(group.normalizedQueryHash, sha256Pattern);
    assert.match(group.pushSignatureHash, sha256Pattern);
    assert.equal(group.rawValuesIncluded, false);
  }
});

test('RPP-0552 generated malformed and tampered signed requests fail before parsing or mutation', () => {
  const negativeCases = [
    {
      name: 'missing-basic-auth',
      code: 'SIGNED_AUTH_UNAVAILABLE',
      mutate(request) {
        delete request.headers.authorization;
      },
    },
    {
      name: 'wrong-basic-auth',
      code: 'SIGNED_AUTH_UNAVAILABLE',
      mutate(request) {
        request.headers.authorization = `Basic ${base64('wrong:credential')}`;
      },
    },
    {
      name: 'missing-content-hash-header',
      code: 'SIGNED_HEADER_REQUIRED',
      mutate(request) {
        delete request.headers['x-auth-content-hash'];
      },
    },
    {
      name: 'missing-session',
      code: 'SIGNED_SESSION_REQUIRED',
      mutate(request) {
        delete request.headers['x-reprint-push-session'];
      },
    },
    {
      name: 'missing-idempotency-key',
      code: 'MISSING_IDEMPOTENCY_KEY',
      mutate(request) {
        delete request.headers['x-reprint-push-idempotency-key'];
      },
    },
    {
      name: 'invalid-content-hash-format',
      code: 'SIGNED_CONTENT_HASH_INVALID',
      mutate(request) {
        request.headers['x-auth-content-hash'] = 'not-a-sha256';
      },
    },
    {
      name: 'content-hash-mismatch',
      code: 'SIGNED_CONTENT_HASH_MISMATCH',
      mutate(request) {
        request.rawBody = `${request.rawBody}}`;
      },
    },
    {
      name: 'timestamp-invalid',
      code: 'SIGNED_TIMESTAMP_INVALID',
      mutate(request) {
        request.headers['x-auth-timestamp'] = 'not-a-timestamp';
      },
    },
    {
      name: 'nonce-invalid',
      code: 'SIGNED_NONCE_INVALID',
      mutate(request) {
        request.headers['x-auth-nonce'] = 'short';
      },
    },
    {
      name: 'auth-signature-tampered',
      code: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-auth-signature'] = fixtureHash('wrong-auth-signature');
      },
    },
    {
      name: 'session-invalid',
      code: 'SIGNED_SESSION_INVALID',
      mutate(request) {
        request.headers['x-reprint-push-session'] = 'psh_01j0000000000000000missing';
      },
    },
    {
      name: 'session-expired',
      code: 'SIGNED_SESSION_EXPIRED',
      prepare(state) {
        state.sessions.set('psh_01j0000000000000000expired', {
          ...validSession,
          id: 'psh_01j0000000000000000expired',
          sessionHash: fixtureHash('expired-session'),
          expiresAtUnix: fixedNowSeconds - 1,
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = 'psh_01j0000000000000000expired';
      },
    },
    {
      name: 'session-capability-downgraded',
      code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
      prepare(state) {
        state.sessions.set('psh_01j0000000000000000denied', {
          ...validSession,
          id: 'psh_01j0000000000000000denied',
          sessionHash: fixtureHash('denied-session'),
          capabilityGranted: false,
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = 'psh_01j0000000000000000denied';
      },
    },
    {
      name: 'session-binding-mismatch',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set('psh_01j000000000000000mismatch', {
          ...validSession,
          id: 'psh_01j000000000000000mismatch',
          sessionHash: fixtureHash('mismatch-session'),
          sourceHash: fixtureHash('other-source'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = 'psh_01j000000000000000mismatch';
      },
    },
    {
      name: 'push-signature-tampered',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-signature'] = fixtureHash('wrong-push-signature');
      },
    },
    {
      name: 'query-tampered-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.pathname = '/wp-json/reprint/v1/push/apply?a=1&z=tampered';
      },
    },
    {
      name: 'idempotency-header-tampered-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-idempotency-key'] = 'idem-rpp-0552-tampered';
      },
    },
    {
      name: 'malformed-push-signature',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-signature'] = 'sha256=not-hex';
      },
    },
  ];

  const results = negativeCases.map((negativeCase, index) => {
    const state = newVerifierState();
    negativeCase.prepare?.(state);
    const request = buildSignedRequest({
      pathname: '/wp-json/reprint/v1/push/apply?a=1&z=2',
      rawBody: malformedRawBody,
      nonce: `rpp-0552-negative-${String(index).padStart(2, '0')}`,
    });
    negativeCase.mutate(request);

    const result = runAuthenticatedRoute(request, 'apply', state);
    assert.equal(result.ok, false, negativeCase.name);
    assert.equal(result.code, negativeCase.code, negativeCase.name);
    assert.equal(result.counters.jsonParse, 0, `${negativeCase.name} parsed JSON`);
    assert.equal(result.counters.nonceClaim, 0, `${negativeCase.name} claimed nonce`);
    assert.equal(result.counters.receiptMint, 0, `${negativeCase.name} minted receipt`);
    assert.equal(result.counters.mutation, 0, `${negativeCase.name} mutated`);
    return {
      name: negativeCase.name,
      request,
      code: result.code,
      status: result.status,
      counters: result.counters,
    };
  });

  const envelope = hashOnlyEnvelope({ canonicalResults: [], negativeResults: results });
  const serializedEnvelope = JSON.stringify(envelope);
  for (const rawValue of [
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    validRawBody,
    malformedRawBody,
    '/wp-json/reprint/v1/push/apply?a=1&z=2',
  ]) {
    assert.equal(serializedEnvelope.includes(rawValue), false, `evidence leaked ${rawValue}`);
  }
  for (const negativeCase of envelope.negativeCases) {
    assert.match(negativeCase.requestHash, sha256Pattern);
    assert.equal(negativeCase.parsedJson, false);
    assert.equal(negativeCase.nonceClaimed, false);
    assert.equal(negativeCase.receiptMinted, false);
    assert.equal(negativeCase.mutated, false);
    assert.equal(negativeCase.rawValuesIncluded, false);
  }
});

test('RPP-0552 authenticated route source orders canonical signature verification before JSON and mutation', () => {
  const verifier = functionBody('reprint_push_lab_rest_verify_signed_request');
  const canonicalQueryBody = functionBody('reprint_push_lab_rest_canonical_query');
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');

  assertBefore(
    verifier,
    '$expected_auth_signature = hash_hmac',
    "$session = reprint_push_lab_rest_signed_session($session_id)",
  );
  assertBefore(
    verifier,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifier,
    '$canonical = reprint_push_lab_rest_push_canonical_string',
    '$expected_push_signature = hash_hmac',
  );
  assertBefore(
    verifier,
    'SIGNED_PUSH_SIGNATURE_MISMATCH',
    '$claim_nonce = !array_key_exists',
  );
  assertBefore(
    verifier,
    '$claim_nonce = !array_key_exists',
    'reprint_push_lab_rest_claim_signed_nonce($nonce',
  );
  assert.doesNotMatch(verifier, /reprint_push_lab_rest_json_payload|get_json_params|reprint_push_lab_rest_apply_with_db_journal|reprint_push_protocol_run_payload/);

  assert.match(canonicalQueryBody, /rawurldecode\(str_replace\('\+', '%20'/);
  assert.match(canonicalQueryBody, /\['key'\], \$a\['value'\], \$a\['index'\]/);
  assert.match(canonicalQueryBody, /rawurlencode\(\(string\) \$pair\['key'\]\) \. '=' \. rawurlencode\(\(string\) \$pair\['value'\]\)/);

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(dryRun, 'return $signature_error;', 'reprint_push_lab_rest_protocol_response');
  assertBefore(dryRun, 'reprint_push_lab_rest_protocol_response', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(dryRun, 'reprint_push_lab_rest_json_payload($request)', 'reprint_push_lab_rest_bind_authenticated_receipt');

  assertBefore(
    apply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(apply, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
});
