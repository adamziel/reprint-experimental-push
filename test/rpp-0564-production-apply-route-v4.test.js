import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/apply`;
const credential = {
  username: 'rpp_0564_admin',
  password: 'rpp-0564-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0564_generated_session';
const idempotencyKey = 'idem-rpp-0564-apply-route-v4';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const resourcePath = 'wp-content/uploads/reprint-push/rpp-0564-apply-route.txt';
const resourceKey = `file:${resourcePath}`;
const baseContent = 'rpp-0564-live-source-before-apply';
const staleContent = 'rpp-0564-live-source-drifted-before-apply';
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

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function basicAuth(value = credential) {
  return `Basic ${Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')}`;
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

function sourceIdentity(label = 'same-live-source') {
  return {
    sourceHash: sha256Hex(`rpp-0564-live-source-binding:${label}`),
    sourceUrlHash: sha256Hex(`${sourceUrl}:${label}`),
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
  };
}

function authEnvelope(source = sourceIdentity()) {
  return {
    identity: {
      userId: 564,
      userLogin: credential.username,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: freshExpiresAt,
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      sourceHash: source.sourceHash,
      sourceUrlHash: source.sourceUrlHash,
      cleanedUp: false,
      playgroundFallback: true,
    },
  };
}

function buildReadyApplyPlan() {
  const mutationId = 'mut_rpp_0564_apply_route_live_source';
  const baseHash = sha256Hex(baseContent);
  const localHash = sha256Hex('rpp-0564-local-resource');
  const resource = { kind: 'file', path: resourcePath };

  return {
    id: 'plan-rpp-0564-production-apply-route-v4',
    status: 'ready',
    summary: {
      total: 1,
      create: 0,
      update: 1,
      delete: 0,
    },
    mutations: [
      {
        id: mutationId,
        action: 'update',
        changeKind: 'file-update',
        resource,
        resourceKey,
        baseHash,
        remoteBeforeHash: baseHash,
        localHash,
      },
    ],
    preconditions: [
      {
        mutationId,
        resource,
        resourceKey,
        expectedHash: baseHash,
      },
    ],
    conflicts: [],
    blockers: [],
  };
}

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];
  return {
    planHash: digest(plan),
    mutationSetHash: digest(mutations.map((mutation) => ({
      id: String(mutation?.id || ''),
      resourceKey: String(mutation?.resourceKey || ''),
      resource: mutation?.resource,
      action: mutation?.action ?? null,
      changeKind: mutation?.changeKind ?? null,
      baseHash: mutation?.baseHash ?? null,
      remoteBeforeHash: mutation?.remoteBeforeHash ?? null,
      localHash: mutation?.localHash ?? null,
    }))),
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
  };
}

function receiptForPlan(plan, { rawBody, headers, source = sourceIdentity() }) {
  const evidence = planEvidence(plan);
  const sessionHash = sha256Hex(sessionId);
  const dryRunContentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const receipt = {
    schemaVersion: 1,
    planHash: evidence.planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    authBinding: {
      schemaVersion: 1,
      source,
      pushSession: {
        sessionHash,
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
        dryRunContentHash,
        dryRunBodyHash: digest({ plan }),
      },
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: `${routePrefix}/dry-run`,
        routeProfile: 'production-shaped',
        labBacked: true,
        planHash: evidence.planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash: sha256Hex(rawBody),
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: plan.mutations.length,
      },
      issuedAt: proofCapturedAt,
      expiresAt: freshExpiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function signedRequestEvidence(pathname, contentHash, headers) {
  const request = {
    method: 'POST',
    pathHash: sha256Hex(pathname),
    canonicalHash: sha256Hex([
      pathname,
      contentHash,
      headers['x-reprint-push-session'] || '',
      headers['x-reprint-push-idempotency-key'] || '',
    ].join('\n')),
    idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
      ? sha256Hex(headers['x-reprint-push-idempotency-key'])
      : '',
  };
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    timestamp: headers['x-auth-timestamp'] || '',
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: headers['x-reprint-push-session']
      ? sha256Hex(headers['x-reprint-push-session'])
      : '',
    signingKeyHash: sha256Hex('rpp-0564-generated-signing-key'),
    request,
  };
}

function authenticateSignedRequest({ headers, rawBody, requireSession = false }) {
  if (headers.authorization !== basicAuth()) {
    return 'reprint_push_lab_auth_required';
  }

  const requiredHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredHeaders.some((header) => !headers[header])) {
    return 'SIGNED_HEADER_REQUIRED';
  }

  if (headers['x-auth-content-hash'] !== sha256Hex(rawBody)) {
    return 'SIGNED_CONTENT_HASH_MISMATCH';
  }

  if (!requireSession) {
    return null;
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return 'SIGNED_SESSION_INVALID';
  }
  if (headers['x-reprint-push-idempotency-key'] !== idempotencyKey) {
    return 'SIGNED_IDEMPOTENCY_KEY_REQUIRED';
  }

  return null;
}

function snapshotResourceHash(snapshot, resource) {
  if (resource?.kind !== 'file') {
    return sha256Hex('');
  }
  return sha256Hex(snapshot.files?.[resource.path] ?? '');
}

function buildApplyRevalidation({
  plan,
  receipt,
  currentSnapshot,
  currentSource,
  startedSequence,
}) {
  const evidence = planEvidence(plan);
  const receiptSource = receipt.authBinding.source;
  const sourceBindingHash = digest({
    receiptSourceHash: receiptSource.sourceHash,
    receiptSourceUrlHash: receiptSource.sourceUrlHash,
    currentSourceHash: currentSource.sourceHash,
    currentSourceUrlHash: currentSource.sourceUrlHash,
    phase: 'before-first-mutation',
  });
  const dbJournalCursor = `db-journal:${startedSequence}`;
  const base = {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || evidence.planHash,
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    verifiedCount: 0,
    verifiedResourceKeys: [],
    liveSource: {
      snapshotHash: null,
      sourceHash: currentSource.sourceHash,
      sourceUrlHash: currentSource.sourceUrlHash,
      receiptSourceHash: receiptSource.sourceHash,
      receiptSourceUrlHash: receiptSource.sourceUrlHash,
      sourceBindingHash,
      dbJournalCursor,
    },
    receiptBinding: {
      schemaVersion: 1,
      planHash: receipt.planHash,
      receiptHash: receipt.receiptHash,
      mutationSetHash: receipt.mutationSetHash,
      preconditionSetHash: receipt.preconditionSetHash,
      sourceHash: receiptSource.sourceHash,
      sourceUrlHash: receiptSource.sourceUrlHash,
      sessionHash: receipt.authBinding.pushSession.sessionHash,
      dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
      dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
    },
    claim: {
      activeClaimId: null,
      activeClaimKeyHash: sha256Hex(idempotencyKey),
      activeClaimSequence: startedSequence,
      staleClaimRetry: false,
    },
  };

  if (
    currentSource.sourceHash !== receiptSource.sourceHash
    || currentSource.sourceUrlHash !== receiptSource.sourceUrlHash
  ) {
    return {
      accepted: false,
      status: 409,
      code: 'AUTH_SOURCE_BINDING_MISMATCH',
      revalidation: base,
    };
  }

  const snapshotHash = digest(currentSnapshot);
  const verifiedResourceKeys = [];
  for (const precondition of plan.preconditions) {
    const actualHash = snapshotResourceHash(currentSnapshot, precondition.resource);
    if (actualHash !== precondition.expectedHash) {
      return {
        accepted: false,
        status: 412,
        code: 'PRECONDITION_FAILED',
        revalidation: {
          ...base,
          liveSource: {
            ...base.liveSource,
            snapshotHash,
          },
        },
        rejectedRemoteEvidence: {
          schemaVersion: 1,
          code: 'PRECONDITION_FAILED',
          mutationIdHash: sha256Hex(precondition.mutationId),
          resourceKeyHash: sha256Hex(precondition.resourceKey),
          expectedHash: precondition.expectedHash,
          actualHash,
          freshMutationWork: false,
        },
      };
    }
    verifiedResourceKeys.push(precondition.resourceKey);
  }

  return {
    accepted: true,
    revalidation: {
      ...base,
      verifiedCount: verifiedResourceKeys.length,
      verifiedResourceKeys,
      liveSource: {
        ...base.liveSource,
        snapshotHash,
      },
    },
  };
}

function appendEvent(state, event, payload = {}) {
  const entry = {
    sequence: state.events.length + 1,
    event,
    ...payload,
  };
  state.events.push(entry);
  return entry;
}

function createGeneratedApplyRoute({
  currentSnapshot = { files: { [resourcePath]: baseContent }, plugins: {}, db: {} },
  currentSource = sourceIdentity(),
} = {}) {
  const dryRunSource = sourceIdentity();
  const state = {
    events: [],
    requests: [],
    jsonParseAttempts: 0,
    liveSourceRevalidations: 0,
    mutationSetupEntries: 0,
    mutationExecutorEntries: 0,
    mutationApplications: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const pathname = requestUrl.pathname;
    const method = options.method || 'GET';
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const headers = headerEntries(options.headers || {});
    state.requests.push({ method, pathname, rawBodyHash: sha256Hex(rawBody) });

    if (pathname === `${routePrefix}/preflight`) {
      const authError = authenticateSignedRequest({ headers, rawBody });
      if (authError) {
        return jsonResponse({ ok: false, mode: 'preflight', code: authError }, 401);
      }
      return jsonResponse({
        ok: true,
        mode: 'preflight',
        routeProfile: {
          profile: 'production-shaped',
          restNamespace: 'reprint/v1',
          routePrefix: '/push',
          labBacked: true,
        },
        auth: authEnvelope(dryRunSource),
        session: {
          id: sessionId,
          type: 'production-auth-session',
          expiresAt: freshExpiresAt,
        },
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      const authError = authenticateSignedRequest({ headers, rawBody, requireSession: true });
      if (authError) {
        return jsonResponse({ ok: false, mode: 'dry-run', code: authError }, 401);
      }

      state.jsonParseAttempts += 1;
      const body = JSON.parse(rawBody);
      const receipt = receiptForPlan(body.plan, { rawBody, headers, source: dryRunSource });
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: authEnvelope(dryRunSource),
        receipt,
        signedRequest: signedRequestEvidence(pathname, headers['x-auth-content-hash'], headers),
      });
    }

    if (pathname === endpointPath) {
      const authError = authenticateSignedRequest({ headers, rawBody, requireSession: true });
      if (authError) {
        return jsonResponse({
          ok: false,
          mode: 'apply',
          code: authError,
          idempotency: {
            replayed: false,
            conflict: false,
            freshMutationWork: false,
            idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key'] || ''),
            requestHash: sha256Hex(rawBody),
          },
        }, 401);
      }

      state.jsonParseAttempts += 1;
      const body = JSON.parse(rawBody);
      const started = appendEvent(state, 'apply-started', {
        requestHash: headers['x-auth-content-hash'],
      });
      state.liveSourceRevalidations += 1;
      const revalidated = buildApplyRevalidation({
        plan: body.plan,
        receipt: body.receipt,
        currentSnapshot,
        currentSource,
        startedSequence: started.sequence,
      });

      if (!revalidated.accepted) {
        appendEvent(state, 'live-source-revalidation-rejected', {
          code: revalidated.code,
          phase: revalidated.revalidation.phase,
          checkedAgainst: revalidated.revalidation.checkedAgainst,
          sourceBindingHash: revalidated.revalidation.liveSource.sourceBindingHash,
          snapshotHash: revalidated.revalidation.liveSource.snapshotHash,
        });

        return jsonResponse({
          ok: false,
          mode: 'apply',
          code: revalidated.code,
          applied: 0,
          idempotency: {
            replayed: false,
            conflict: false,
            freshMutationWork: false,
            idempotencyKeyHash: sha256Hex(idempotencyKey),
            requestHash: headers['x-auth-content-hash'],
          },
          signedRequest: signedRequestEvidence(pathname, headers['x-auth-content-hash'], headers),
          applyRevalidation: revalidated.revalidation,
          rejectedRemoteEvidence: revalidated.rejectedRemoteEvidence || null,
        }, revalidated.status);
      }

      appendEvent(state, 'live-source-revalidated', {
        phase: revalidated.revalidation.phase,
        checkedAgainst: revalidated.revalidation.checkedAgainst,
        snapshotHash: revalidated.revalidation.liveSource.snapshotHash,
      });
      state.mutationSetupEntries += 1;
      appendEvent(state, 'mutation-setup-entered', {
        mutationSetHash: revalidated.revalidation.mutationSetHash,
      });
      state.mutationExecutorEntries += 1;
      appendEvent(state, 'mutation-executor-entered', {
        mutationSetHash: revalidated.revalidation.mutationSetHash,
      });
      for (const mutation of body.plan.mutations) {
        state.mutationApplications += 1;
        appendEvent(state, 'mutation-applied', {
          mutationIdHash: sha256Hex(mutation.id),
          resourceKeyHash: sha256Hex(mutation.resourceKey),
        });
      }
      appendEvent(state, 'apply-committed', {
        applied: body.plan.mutations.length,
      });

      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: body.plan.mutations.length,
        responseSchemaVersion: 1,
        auth: authEnvelope(currentSource),
        receipt: body.receipt,
        idempotency: {
          replayed: false,
          conflict: false,
          freshMutationWork: true,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: headers['x-auth-content-hash'],
        },
        signedRequest: signedRequestEvidence(pathname, headers['x-auth-content-hash'], headers),
        applyRevalidation: revalidated.revalidation,
      });
    }

    throw new Error(`unexpected RPP-0564 route request: ${method} ${pathname}`);
  }

  return { currentSnapshot, currentSource, dryRunSource, state, fetchHandler };
}

async function runGeneratedApply(route) {
  const originalFetch = global.fetch;
  const plan = buildReadyApplyPlan();

  global.fetch = route.fetchHandler;
  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight');
    const dryRun = await client.signedPost('/dry-run', { plan }, {
      session: preflight.body.session.id,
      idempotencyKey,
    });
    const apply = await client.signedPost('/apply', {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session: preflight.body.session.id,
      idempotencyKey,
    });
    return { preflight, dryRun, apply, plan };
  } finally {
    global.fetch = originalFetch;
  }
}

function firstEventSequence(events, event) {
  const entry = events.find((item) => item.event === event);
  return Number.isInteger(entry?.sequence) ? entry.sequence : null;
}

function firstAnyEventSequence(events, eventNames) {
  for (const eventName of eventNames) {
    const sequence = firstEventSequence(events, eventName);
    if (Number.isInteger(sequence)) {
      return sequence;
    }
  }
  return null;
}

function allHashFields(value, fields) {
  return fields.every((field) => hashPattern.test(String(value?.[field] || '')));
}

function resolveApplySupportCode({
  apply,
  validAcceptedRevalidation,
  validRejectedRevalidation,
  beforeMutationSetup,
  mutationCapableWorkStarted,
}) {
  if (!apply) {
    return 'APPLY_ROUTE_PROOF_REQUIRED';
  }
  if (validAcceptedRevalidation && beforeMutationSetup) {
    return 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY';
  }
  if (validRejectedRevalidation && !mutationCapableWorkStarted) {
    return apply.body?.code || 'APPLY_LIVE_SOURCE_REVALIDATION_REJECTED';
  }
  return 'APPLY_REVALIDATION_REQUIRED';
}

function buildApplyRouteSupportEvidence({ apply = null, events = [] } = {}) {
  const body = apply?.body || {};
  const revalidation = body.applyRevalidation || {};
  const liveSource = revalidation.liveSource || {};
  const receiptBinding = revalidation.receiptBinding || {};
  const claim = revalidation.claim || {};
  const rejectedRemoteEvidence = body.rejectedRemoteEvidence || {};
  const applyStartedSequence = firstEventSequence(events, 'apply-started');
  const liveRevalidationSequence = firstAnyEventSequence(events, [
    'live-source-revalidated',
    'live-source-revalidation-rejected',
  ]);
  const mutationSetupSequence = firstEventSequence(events, 'mutation-setup-entered');
  const mutationExecutorSequence = firstEventSequence(events, 'mutation-executor-entered');
  const firstMutationSequence = firstEventSequence(events, 'mutation-applied');
  const commitSequence = firstEventSequence(events, 'apply-committed');
  const mutationCapableWorkStarted = Number.isInteger(mutationSetupSequence)
    || Number.isInteger(mutationExecutorSequence)
    || Number.isInteger(firstMutationSequence);
  const revalidatedAfterClaim = Number.isInteger(applyStartedSequence)
    && Number.isInteger(liveRevalidationSequence)
    && applyStartedSequence < liveRevalidationSequence;
  const beforeMutationSetup = Number.isInteger(liveRevalidationSequence)
    && (!Number.isInteger(mutationSetupSequence) || liveRevalidationSequence < mutationSetupSequence);
  const beforeFirstMutation = Number.isInteger(liveRevalidationSequence)
    && (!Number.isInteger(firstMutationSequence) || liveRevalidationSequence < firstMutationSequence);
  const validCommonRevalidation = revalidation.required === 'fresh-live-hashes-before-first-mutation'
    && revalidation.phase === 'before-first-mutation'
    && revalidation.checkedAgainst === 'live-remote'
    && claim.activeClaimSequence === applyStartedSequence
    && allHashFields(revalidation, [
      'planHash',
      'receiptHash',
      'preconditionSetHash',
      'mutationSetHash',
    ])
    && allHashFields(liveSource, [
      'sourceHash',
      'sourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'sourceBindingHash',
    ])
    && allHashFields(receiptBinding, [
      'planHash',
      'receiptHash',
      'mutationSetHash',
      'preconditionSetHash',
      'sourceHash',
      'sourceUrlHash',
      'sessionHash',
      'dryRunIdempotencyKeyHash',
      'dryRunContentHash',
    ]);
  const validAcceptedRevalidation = apply?.status === 200
    && body.ok === true
    && body.mode === 'apply'
    && body.idempotency?.freshMutationWork === true
    && Number.isInteger(revalidation.mutationCount)
    && revalidation.mutationCount > 0
    && revalidation.verifiedCount === revalidation.mutationCount
    && body.applied === revalidation.mutationCount
    && allHashFields(liveSource, ['snapshotHash'])
    && validCommonRevalidation
    && revalidatedAfterClaim
    && beforeMutationSetup
    && beforeFirstMutation;
  const validRejectedRevalidation = apply?.status >= 400
    && body.ok === false
    && body.mode === 'apply'
    && body.applied === 0
    && body.idempotency?.freshMutationWork === false
    && validCommonRevalidation
    && revalidatedAfterClaim
    && beforeMutationSetup
    && beforeFirstMutation
    && !mutationCapableWorkStarted
    && (
      body.code === 'AUTH_SOURCE_BINDING_MISMATCH'
      || (
        body.code === 'PRECONDITION_FAILED'
        && allHashFields(liveSource, ['snapshotHash'])
        && allHashFields(rejectedRemoteEvidence, [
          'mutationIdHash',
          'resourceKeyHash',
          'expectedHash',
          'actualHash',
        ])
      )
    );
  const code = resolveApplySupportCode({
    apply,
    validAcceptedRevalidation,
    validRejectedRevalidation,
    beforeMutationSetup,
    mutationCapableWorkStarted,
  });

  return {
    schemaVersion: 1,
    slice: 'RPP-0564',
    proofClass: 'generated-apply-route-before-mutation-live-source-revalidation',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    ok: validAcceptedRevalidation,
    status: validAcceptedRevalidation ? 'support_only' : 'blocked',
    code,
    capturedAt: proofCapturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    routeEvidence: {
      methodHash: sha256Hex(apply?.request?.method || 'POST'),
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: sha256Hex(apply?.request?.pathname || ''),
      routeProfileHash: sha256Hex('production-shaped'),
      proofHash: digest({
        method: apply?.request?.method || 'POST',
        endpointPathHash: sha256Hex(endpointPath),
        requestPathHash: sha256Hex(apply?.request?.pathname || ''),
        status: apply?.status ?? null,
        code,
      }),
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: sha256Hex(sessionId),
      manageOptions: true,
    },
    applyReceipt: {
      status: apply?.status ?? null,
      ok: body.ok === true,
      mode: body.mode || null,
      applied: body.applied ?? null,
      freshMutationWork: body.idempotency?.freshMutationWork === true,
      idempotencyKeyHash: body.idempotency?.idempotencyKeyHash || null,
      requestHash: body.idempotency?.requestHash || null,
      signedRequestHash: digest(body.signedRequest?.request || null),
    },
    revalidation: {
      required: revalidation.required || null,
      phase: revalidation.phase || null,
      checkedAgainst: revalidation.checkedAgainst || null,
      rejectionCode: body.code || null,
      mutationCount: revalidation.mutationCount ?? null,
      verifiedCount: revalidation.verifiedCount ?? null,
      planHash: revalidation.planHash || null,
      receiptHash: revalidation.receiptHash || null,
      preconditionSetHash: revalidation.preconditionSetHash || null,
      mutationSetHash: revalidation.mutationSetHash || null,
      verifiedResourceKeysHash: digest(Array.isArray(revalidation.verifiedResourceKeys)
        ? revalidation.verifiedResourceKeys
        : []),
      snapshotHash: liveSource.snapshotHash || null,
      sourceHash: liveSource.sourceHash || null,
      sourceUrlHash: liveSource.sourceUrlHash || null,
      receiptSourceHash: liveSource.receiptSourceHash || null,
      receiptSourceUrlHash: liveSource.receiptSourceUrlHash || null,
      sourceBindingHash: liveSource.sourceBindingHash || null,
      dbJournalCursorHash: liveSource.dbJournalCursor ? sha256Hex(liveSource.dbJournalCursor) : null,
      activeClaimKeyHash: claim.activeClaimKeyHash || null,
      rejectedMutationIdHash: rejectedRemoteEvidence.mutationIdHash || null,
      rejectedResourceKeyHash: rejectedRemoteEvidence.resourceKeyHash || null,
      rejectedExpectedHash: rejectedRemoteEvidence.expectedHash || null,
      rejectedActualHash: rejectedRemoteEvidence.actualHash || null,
    },
    ordering: {
      applyStartedSequence,
      liveRevalidationSequence,
      mutationSetupSequence,
      mutationExecutorSequence,
      firstMutationSequence,
      commitSequence,
      revalidatedAfterClaim,
      beforeMutationSetup,
      beforeFirstMutation,
    },
    mutationCapableWork: {
      setupStarted: Number.isInteger(mutationSetupSequence),
      executorStarted: Number.isInteger(mutationExecutorSequence),
      mutationApplied: Number.isInteger(firstMutationSequence),
      started: mutationCapableWorkStarted,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/1',
      reason: 'generated local apply-route proof is support-only until checked against production-owned URL and credentials',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed apply route revalidation proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function assertHashFields(value, fields) {
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

test('RPP-0564 v4 pins production apply live-source revalidation before mutation setup', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/apply',
  );
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const liveRevalidation = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');

  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::CREATABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_authenticated_apply'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);
  assertBefore(
    authenticatedApply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    authenticatedApply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assertBefore(
    runDbJournalApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    '$options = reprint_push_lab_rest_lab_options($payload);',
  );
  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    runDbJournalApply,
    '$options = reprint_push_lab_rest_lab_options($payload);',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    liveRevalidation,
    '$current_source = reprint_push_lab_rest_apply_live_source_binding_evidence($request, $accepted);',
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    liveRevalidation,
    "reprint_push_lab_rest_auth_receipt_mismatch(\n            'Receipt source URL binding does not match the current live source before apply mutation.'",
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    liveRevalidation,
    '$current = reprint_push_export_snapshot();',
    'reprint_push_protocol_verify_preconditions(',
  );

  assert.match(liveRevalidation, /'phase'\s*=>\s*'before-first-mutation'/);
  assert.match(liveRevalidation, /'checkedAgainst'\s*=>\s*'live-remote'/);
  assert.match(liveRevalidation, /'snapshotHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$current\)\)/);
  assert.match(liveRevalidation, /'sourceBindingHash'\s*=>\s*\(string\) \(\$current_source\['sourceBindingHash'\]/);
  assert.match(liveRevalidation, /'dbJournalCursor'\s*=>\s*\$db_journal_cursor/);
  assert.match(liveRevalidation, /'AUTH_SOURCE_BINDING_MISMATCH'/);

  for (const forbiddenMutationCall of [
    'reprint_push_protocol_run_payload',
    'reprint_push_apply_resource',
    'wp_insert_post',
    'wp_update_post',
    'update_option',
    '$wpdb->insert',
    '$wpdb->update',
    '$wpdb->delete',
  ]) {
    assert.doesNotMatch(
      liveRevalidation,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('RPP-0564 v4 accepts hash-only support evidence when apply revalidates before mutation setup', async () => {
  const route = createGeneratedApplyRoute();
  const { preflight, dryRun, apply, plan } = await runGeneratedApply(route);
  const evidence = buildApplyRouteSupportEvidence({
    apply,
    events: route.state.events,
  });

  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.auth.session.type, 'production-auth-session');
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.receipt.planHash, digest(plan));
  assert.equal(apply.status, 200);
  assert.equal(apply.body.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
  assert.equal(apply.body.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(apply.body.applyRevalidation.checkedAgainst, 'live-remote');
  assert.equal(apply.body.applyRevalidation.planHash, dryRun.body.receipt.planHash);
  assert.equal(apply.body.applyRevalidation.receiptHash, dryRun.body.receipt.receiptHash);
  assert.equal(apply.body.applyRevalidation.mutationCount, plan.mutations.length);
  assert.equal(apply.body.applyRevalidation.verifiedCount, plan.mutations.length);
  assert.equal(route.state.liveSourceRevalidations, 1);
  assert.equal(route.state.mutationSetupEntries, 1);
  assert.equal(route.state.mutationExecutorEntries, 1);
  assert.equal(route.state.mutationApplications, 1);
  assert.deepEqual(
    route.state.events.map((entry) => entry.event),
    [
      'apply-started',
      'live-source-revalidated',
      'mutation-setup-entered',
      'mutation-executor-entered',
      'mutation-applied',
      'apply-committed',
    ],
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.code, 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY');
  assert.equal(evidence.releaseStatus, 'NO-GO');
  assert.equal(evidence.releaseMovement.allowed, false);
  assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(evidence.applyReceipt.freshMutationWork, true);
  assert.equal(evidence.revalidation.phase, 'before-first-mutation');
  assert.equal(evidence.revalidation.checkedAgainst, 'live-remote');
  assert.equal(evidence.ordering.revalidatedAfterClaim, true);
  assert.equal(evidence.ordering.beforeMutationSetup, true);
  assert.equal(evidence.ordering.beforeFirstMutation, true);
  assert.equal(evidence.mutationCapableWork.started, true);
  assert.equal(evidence.redaction.rawValuesIncluded, false);

  assertHashFields(evidence.routeEvidence, [
    'methodHash',
    'endpointPathHash',
    'requestPathHash',
    'routeProfileHash',
    'proofHash',
  ]);
  assertHashFields(evidence.authSummary, ['credentialHash', 'userLoginHash', 'sessionIdHash']);
  assertHashFields(evidence.applyReceipt, ['idempotencyKeyHash', 'requestHash', 'signedRequestHash']);
  assertHashFields(evidence.revalidation, [
    'planHash',
    'receiptHash',
    'preconditionSetHash',
    'mutationSetHash',
    'verifiedResourceKeysHash',
    'snapshotHash',
    'sourceHash',
    'sourceUrlHash',
    'receiptSourceHash',
    'receiptSourceUrlHash',
    'sourceBindingHash',
    'dbJournalCursorHash',
    'activeClaimKeyHash',
  ]);
  assertNoRawValues(evidence, [
    sourceUrl,
    endpointPath,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    resourcePath,
    resourceKey,
    baseContent,
  ]);
});

test('RPP-0564 v4 rejects drifted or stale live-source evidence before mutation-capable work', async () => {
  const sourceDriftRoute = createGeneratedApplyRoute({
    currentSource: sourceIdentity('drifted-live-source'),
  });
  const staleSnapshotRoute = createGeneratedApplyRoute({
    currentSnapshot: { files: { [resourcePath]: staleContent }, plugins: {}, db: {} },
  });
  const sourceDrift = await runGeneratedApply(sourceDriftRoute);
  const staleSnapshot = await runGeneratedApply(staleSnapshotRoute);
  const sourceDriftEvidence = buildApplyRouteSupportEvidence({
    apply: sourceDrift.apply,
    events: sourceDriftRoute.state.events,
  });
  const staleSnapshotEvidence = buildApplyRouteSupportEvidence({
    apply: staleSnapshot.apply,
    events: staleSnapshotRoute.state.events,
  });

  assert.equal(sourceDrift.apply.status, 409);
  assert.equal(sourceDrift.apply.body.code, 'AUTH_SOURCE_BINDING_MISMATCH');
  assert.equal(sourceDrift.apply.body.idempotency.freshMutationWork, false);
  assert.equal(sourceDrift.apply.body.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(sourceDrift.apply.body.applyRevalidation.checkedAgainst, 'live-remote');
  assert.equal(sourceDriftRoute.state.liveSourceRevalidations, 1);
  assert.equal(sourceDriftRoute.state.mutationSetupEntries, 0);
  assert.equal(sourceDriftRoute.state.mutationExecutorEntries, 0);
  assert.equal(sourceDriftRoute.state.mutationApplications, 0);
  assert.deepEqual(
    sourceDriftRoute.state.events.map((entry) => entry.event),
    ['apply-started', 'live-source-revalidation-rejected'],
  );

  assert.equal(staleSnapshot.apply.status, 412);
  assert.equal(staleSnapshot.apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(staleSnapshot.apply.body.idempotency.freshMutationWork, false);
  assert.equal(staleSnapshot.apply.body.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(staleSnapshot.apply.body.applyRevalidation.checkedAgainst, 'live-remote');
  assert.match(staleSnapshot.apply.body.applyRevalidation.liveSource.snapshotHash, hashPattern);
  assert.match(staleSnapshot.apply.body.rejectedRemoteEvidence.expectedHash, hashPattern);
  assert.match(staleSnapshot.apply.body.rejectedRemoteEvidence.actualHash, hashPattern);
  assert.equal(staleSnapshotRoute.state.liveSourceRevalidations, 1);
  assert.equal(staleSnapshotRoute.state.mutationSetupEntries, 0);
  assert.equal(staleSnapshotRoute.state.mutationExecutorEntries, 0);
  assert.equal(staleSnapshotRoute.state.mutationApplications, 0);
  assert.deepEqual(
    staleSnapshotRoute.state.events.map((entry) => entry.event),
    ['apply-started', 'live-source-revalidation-rejected'],
  );

  assert.equal(sourceDriftEvidence.ok, false);
  assert.equal(sourceDriftEvidence.status, 'blocked');
  assert.equal(sourceDriftEvidence.code, 'AUTH_SOURCE_BINDING_MISMATCH');
  assert.equal(sourceDriftEvidence.releaseStatus, 'NO-GO');
  assert.equal(sourceDriftEvidence.releaseMovement.allowed, false);
  assert.equal(sourceDriftEvidence.mutationCapableWork.started, false);
  assert.equal(sourceDriftEvidence.ordering.beforeMutationSetup, true);
  assert.equal(sourceDriftEvidence.ordering.beforeFirstMutation, true);

  assert.equal(staleSnapshotEvidence.ok, false);
  assert.equal(staleSnapshotEvidence.status, 'blocked');
  assert.equal(staleSnapshotEvidence.code, 'PRECONDITION_FAILED');
  assert.equal(staleSnapshotEvidence.releaseStatus, 'NO-GO');
  assert.equal(staleSnapshotEvidence.releaseMovement.allowed, false);
  assert.equal(staleSnapshotEvidence.mutationCapableWork.started, false);
  assert.equal(staleSnapshotEvidence.ordering.beforeMutationSetup, true);
  assert.equal(staleSnapshotEvidence.ordering.beforeFirstMutation, true);
  assertHashFields(staleSnapshotEvidence.revalidation, [
    'snapshotHash',
    'rejectedMutationIdHash',
    'rejectedResourceKeyHash',
    'rejectedExpectedHash',
    'rejectedActualHash',
  ]);

  for (const evidence of [sourceDriftEvidence, staleSnapshotEvidence]) {
    assert.equal(evidence.redaction.rawValuesIncluded, false);
    assertHashFields(evidence.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'proofHash',
    ]);
    assertHashFields(evidence.authSummary, ['credentialHash', 'userLoginHash', 'sessionIdHash']);
    assertHashFields(evidence.revalidation, [
      'planHash',
      'receiptHash',
      'preconditionSetHash',
      'mutationSetHash',
      'sourceHash',
      'sourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'sourceBindingHash',
      'dbJournalCursorHash',
      'activeClaimKeyHash',
    ]);
    assertNoRawValues(evidence, [
      sourceUrl,
      endpointPath,
      credential.username,
      credential.password,
      sessionId,
      idempotencyKey,
      resourcePath,
      resourceKey,
      baseContent,
      staleContent,
    ]);
  }
});
