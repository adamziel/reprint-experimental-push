import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/apply`;
const credential = {
  username: 'rpp_0584_admin',
  password: 'rpp-0584-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0584_generated_session';
const idempotencyKey = 'idem-rpp-0584-apply-route-v5';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const resourcePath = 'wp-content/uploads/reprint-push/rpp-0584-apply-route.txt';
const resourceKey = `file:${resourcePath}`;
const baseContent = 'rpp-0584-live-source-before-apply';
const staleContent = 'rpp-0584-live-source-drifted-before-apply';
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
    sourceHash: sha256Hex(`rpp-0584-live-source-binding:${label}`),
    sourceUrlHash: sha256Hex(`${sourceUrl}:${label}`),
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
  };
}

function authEnvelope(source = sourceIdentity()) {
  return {
    identity: {
      userId: 584,
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
  const mutationId = 'mut_rpp_0584_apply_route_live_source';
  const baseHash = sha256Hex(baseContent);
  const localHash = sha256Hex('rpp-0584-local-resource');
  const resource = { kind: 'file', path: resourcePath };

  return {
    id: 'plan-rpp-0584-production-apply-route-v5',
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
        sessionHash: sha256Hex(sessionId),
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
    timestampHash: sha256Hex(headers['x-auth-timestamp'] || ''),
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: headers['x-reprint-push-session']
      ? sha256Hex(headers['x-reprint-push-session'])
      : '',
    signingKeyHash: sha256Hex('rpp-0584-generated-signing-key'),
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
    state.requests.push({ method, pathnameHash: sha256Hex(pathname), rawBodyHash: sha256Hex(rawBody) });

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

    throw new Error(`unexpected RPP-0584 route request: ${method} ${pathname}`);
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

function sameDigest(left, right) {
  return digest(left) === digest(right);
}

function resolveCaseCode({
  apply,
  revalidationPresent,
  commonValid,
  acceptedValid,
  rejectedValid,
}) {
  if (!apply) {
    return 'APPLY_ROUTE_PROOF_REQUIRED';
  }
  if (acceptedValid) {
    return 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY';
  }
  if (rejectedValid) {
    return apply.body?.code || 'APPLY_LIVE_SOURCE_REVALIDATION_REJECTED';
  }
  if (!revalidationPresent) {
    return 'APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED';
  }
  if (!commonValid) {
    return 'APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED';
  }
  return 'APPLY_REVALIDATION_ORDER_REQUIRED';
}

function summarizeApplyRouteCase({
  label,
  apply = null,
  events = [],
  plan,
  receipt = apply?.body?.receipt || null,
}) {
  const body = apply?.body || {};
  const revalidation = body.applyRevalidation || null;
  const liveSource = revalidation?.liveSource || {};
  const receiptBinding = revalidation?.receiptBinding || {};
  const claim = revalidation?.claim || {};
  const rejectedRemoteEvidence = body.rejectedRemoteEvidence || {};
  const evidence = planEvidence(plan);
  const expectedResourceKeys = Array.isArray(plan?.mutations)
    ? plan.mutations.map((mutation) => mutation.resourceKey)
    : [];
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
  const revalidationPresent = Boolean(revalidation && typeof revalidation === 'object');
  const commonValid = revalidationPresent
    && revalidation.schemaVersion === 1
    && revalidation.required === 'fresh-live-hashes-before-first-mutation'
    && revalidation.phase === 'before-first-mutation'
    && revalidation.checkedAgainst === 'live-remote'
    && revalidation.planHash === (receipt?.planHash || evidence.planHash)
    && revalidation.receiptHash === receipt?.receiptHash
    && revalidation.preconditionSetHash === (receipt?.preconditionSetHash || evidence.preconditionSetHash)
    && revalidation.mutationSetHash === (receipt?.mutationSetHash || evidence.mutationSetHash)
    && revalidation.mutationCount === expectedResourceKeys.length
    && Number.isInteger(claim.activeClaimSequence)
    && claim.activeClaimSequence === applyStartedSequence
    && claim.activeClaimSequence > 0
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
    && typeof liveSource.dbJournalCursor === 'string'
    && liveSource.dbJournalCursor.length > 0
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
  const acceptedValid = apply?.status === 200
    && body.ok === true
    && body.mode === 'apply'
    && body.idempotency?.freshMutationWork === true
    && body.applied === expectedResourceKeys.length
    && revalidation?.verifiedCount === expectedResourceKeys.length
    && sameDigest(revalidation?.verifiedResourceKeys || [], expectedResourceKeys)
    && allHashFields(liveSource, ['snapshotHash'])
    && commonValid
    && revalidatedAfterClaim
    && beforeMutationSetup
    && beforeFirstMutation
    && mutationCapableWorkStarted;
  const rejectedValid = apply?.status >= 400
    && body.ok === false
    && body.mode === 'apply'
    && body.applied === 0
    && body.idempotency?.freshMutationWork === false
    && commonValid
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
  const code = resolveCaseCode({
    apply,
    revalidationPresent,
    commonValid,
    acceptedValid,
    rejectedValid,
  });

  const summary = {
    labelHash: sha256Hex(label),
    ok: acceptedValid,
    validRejected: rejectedValid,
    status: acceptedValid ? 'support_only' : 'blocked',
    code,
    httpStatus: apply?.status ?? null,
    routeEvidence: {
      methodHash: sha256Hex(apply?.request?.method || 'POST'),
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: sha256Hex(apply?.request?.pathname || ''),
      routeProfileHash: sha256Hex('production-shaped'),
    },
    applyReceipt: {
      ok: body.ok === true,
      modeHash: sha256Hex(body.mode || ''),
      applied: body.applied ?? null,
      freshMutationWork: body.idempotency?.freshMutationWork === true,
      idempotencyKeyHash: body.idempotency?.idempotencyKeyHash || null,
      requestHash: body.idempotency?.requestHash || null,
      signedRequestHash: digest(body.signedRequest?.request || null),
    },
    revalidation: {
      present: revalidationPresent,
      commonValid,
      requiredHash: sha256Hex(revalidation?.required || ''),
      phaseHash: sha256Hex(revalidation?.phase || ''),
      checkedAgainstHash: sha256Hex(revalidation?.checkedAgainst || ''),
      mutationCount: revalidation?.mutationCount ?? null,
      verifiedCount: revalidation?.verifiedCount ?? null,
      planHash: revalidation?.planHash || null,
      receiptHash: revalidation?.receiptHash || null,
      preconditionSetHash: revalidation?.preconditionSetHash || null,
      mutationSetHash: revalidation?.mutationSetHash || null,
      verifiedResourceKeysHash: digest(Array.isArray(revalidation?.verifiedResourceKeys)
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
      activeClaimSequence: Number.isInteger(claim.activeClaimSequence)
        ? claim.activeClaimSequence
        : null,
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
      reasonHash: sha256Hex('production apply route evidence is support-only until checked against production-owned inputs'),
    },
  };
  summary.caseHash = digest(summary);
  return summary;
}

function buildReleaseVerifierApplyRouteSummary({ acceptedCase, negativeCases = [] }) {
  const allNegativeCasesBlocked = negativeCases.every((entry) =>
    entry.ok === false
      && entry.status === 'blocked'
      && entry.releaseMovement.allowed === false);
  const acceptedCarried = acceptedCase?.ok === true
    && acceptedCase?.status === 'support_only'
    && acceptedCase?.ordering?.revalidatedAfterClaim === true
    && acceptedCase?.ordering?.beforeMutationSetup === true
    && acceptedCase?.ordering?.beforeFirstMutation === true;
  const ok = Boolean(acceptedCarried && allNegativeCasesBlocked);
  const summary = {
    schemaVersion: 1,
    rpp: 'RPP-0584',
    variant: 5,
    evidenceSource: 'release-verifier-production-apply-route-v5',
    proofClass: 'production-apply-route-live-source-revalidation-carry-through',
    evidenceScope: 'local-lab-support',
    capturedAtHash: sha256Hex(proofCapturedAt),
    status: ok ? 'support_only' : 'blocked',
    ok,
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    releaseVerifier: {
      carriesThroughOneSummary: true,
      summaryCount: 1,
      acceptedCaseHash: acceptedCase?.caseHash || null,
      negativeCaseHashes: negativeCases.map((entry) => entry.caseHash),
      allNegativeCasesBlocked,
      beforeMutationCapableWork: acceptedCase?.ordering?.beforeMutationSetup === true
        && acceptedCase?.ordering?.beforeFirstMutation === true,
      expectedNegativeCaseCount: negativeCases.length,
    },
    evidence: {
      productionApplyRoute: {
        accepted: acceptedCase,
        negativeCases,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/1',
      reasonHash: sha256Hex('support-only production apply route proof requires production-owned live source verification'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex('checked production-owned apply route live-source revalidation proof'),
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
  summary.summaryHash = digest({
    rpp: summary.rpp,
    variant: summary.variant,
    acceptedCaseHash: summary.releaseVerifier.acceptedCaseHash,
    negativeCaseHashes: summary.releaseVerifier.negativeCaseHashes,
    status: summary.status,
  });
  return summary;
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

function assertSupportEvidenceIsHashOnly(value) {
  assert.equal(value.redaction.rawValuesIncluded, false);
  assert.match(value.summaryHash, hashPattern);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0584 production apply route verifier summary' }));
  assertNoRawValues(value, [
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

test('RPP-0584 v5 pins production apply live-source revalidation before mutation-capable work', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/apply',
  );
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const liveRevalidation = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const revalidationEvidence = functionBody('reprint_push_lab_rest_apply_revalidation_evidence');

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
  assert.match(revalidationEvidence, /\$live_revalidation\s*=\s*isset\(\$accepted\['liveSourceRevalidation'\]/);
  assert.match(revalidationEvidence, /'liveSource'\s*=>\s*\[/);

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

test('RPP-0584 v5 carries accepted production apply route evidence through one hash-only verifier summary', async () => {
  const route = createGeneratedApplyRoute();
  const { preflight, dryRun, apply, plan } = await runGeneratedApply(route);
  const acceptedCase = summarizeApplyRouteCase({
    label: 'accepted-live-source-revalidation',
    apply,
    events: route.state.events,
    plan,
    receipt: dryRun.body.receipt,
  });
  const summary = buildReleaseVerifierApplyRouteSummary({ acceptedCase });

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
  assert.equal(route.state.liveSourceRevalidations, 1);
  assert.equal(route.state.mutationSetupEntries, 1);
  assert.equal(route.state.mutationExecutorEntries, 1);
  assert.equal(route.state.mutationApplications, 1);

  assert.equal(acceptedCase.ok, true);
  assert.equal(acceptedCase.status, 'support_only');
  assert.equal(acceptedCase.code, 'LOCAL_APPLY_ROUTE_REVALIDATION_SUPPORT_ONLY');
  assert.equal(acceptedCase.ordering.revalidatedAfterClaim, true);
  assert.equal(acceptedCase.ordering.beforeMutationSetup, true);
  assert.equal(acceptedCase.ordering.beforeFirstMutation, true);
  assert.equal(acceptedCase.releaseMovement.allowed, false);
  assertHashFields(acceptedCase.routeEvidence, [
    'methodHash',
    'endpointPathHash',
    'requestPathHash',
    'routeProfileHash',
  ]);
  assertHashFields(acceptedCase.applyReceipt, [
    'idempotencyKeyHash',
    'requestHash',
    'signedRequestHash',
  ]);
  assertHashFields(acceptedCase.revalidation, [
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

  assert.equal(summary.rpp, 'RPP-0584');
  assert.equal(summary.variant, 5);
  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseEligible, false);
  assert.equal(summary.releaseGate, 'NO-GO');
  assert.equal(summary.releaseVerifier.carriesThroughOneSummary, true);
  assert.equal(summary.releaseVerifier.summaryCount, 1);
  assert.equal(summary.releaseVerifier.acceptedCaseHash, acceptedCase.caseHash);
  assert.deepEqual(summary.releaseVerifier.negativeCaseHashes, []);
  assert.equal(summary.releaseVerifier.beforeMutationCapableWork, true);
  assert.deepEqual(Object.keys(summary.evidence), ['productionApplyRoute']);
  assert.equal(summary.evidence.productionApplyRoute.accepted.caseHash, acceptedCase.caseHash);
  assert.equal(summary.releaseMovement.allowed, false);
  assert.equal(summary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assertSupportEvidenceIsHashOnly(summary);
});

test('RPP-0584 v5 blocks missing malformed stale or drifted live-source revalidation evidence', async () => {
  const acceptedRoute = createGeneratedApplyRoute();
  const acceptedRun = await runGeneratedApply(acceptedRoute);
  const missingRevalidationApply = cloneJson(acceptedRun.apply);
  delete missingRevalidationApply.body.applyRevalidation;
  const malformedRevalidationApply = cloneJson(acceptedRun.apply);
  malformedRevalidationApply.body.applyRevalidation.phase = 'after-first-mutation';
  malformedRevalidationApply.body.applyRevalidation.checkedAgainst = 'cached-dry-run-receipt';
  malformedRevalidationApply.body.applyRevalidation.verifiedCount = 0;

  const staleSnapshotRoute = createGeneratedApplyRoute({
    currentSnapshot: { files: { [resourcePath]: staleContent }, plugins: {}, db: {} },
  });
  const driftedSourceRoute = createGeneratedApplyRoute({
    currentSource: sourceIdentity('drifted-live-source'),
  });
  const staleSnapshotRun = await runGeneratedApply(staleSnapshotRoute);
  const driftedSourceRun = await runGeneratedApply(driftedSourceRoute);
  const acceptedCase = summarizeApplyRouteCase({
    label: 'accepted-live-source-revalidation',
    apply: acceptedRun.apply,
    events: acceptedRoute.state.events,
    plan: acceptedRun.plan,
    receipt: acceptedRun.dryRun.body.receipt,
  });
  const negativeCases = [
    summarizeApplyRouteCase({
      label: 'missing-live-source-revalidation',
      apply: missingRevalidationApply,
      events: acceptedRoute.state.events,
      plan: acceptedRun.plan,
      receipt: acceptedRun.dryRun.body.receipt,
    }),
    summarizeApplyRouteCase({
      label: 'malformed-live-source-revalidation',
      apply: malformedRevalidationApply,
      events: acceptedRoute.state.events,
      plan: acceptedRun.plan,
      receipt: acceptedRun.dryRun.body.receipt,
    }),
    summarizeApplyRouteCase({
      label: 'stale-live-source-revalidation',
      apply: staleSnapshotRun.apply,
      events: staleSnapshotRoute.state.events,
      plan: staleSnapshotRun.plan,
      receipt: staleSnapshotRun.dryRun.body.receipt,
    }),
    summarizeApplyRouteCase({
      label: 'drifted-live-source-revalidation',
      apply: driftedSourceRun.apply,
      events: driftedSourceRoute.state.events,
      plan: driftedSourceRun.plan,
      receipt: driftedSourceRun.dryRun.body.receipt,
    }),
  ];
  const summary = buildReleaseVerifierApplyRouteSummary({ acceptedCase, negativeCases });
  const casesByCode = Object.fromEntries(negativeCases.map((entry) => [entry.code, entry]));

  assert.equal(staleSnapshotRun.apply.status, 412);
  assert.equal(staleSnapshotRun.apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(staleSnapshotRun.apply.body.idempotency.freshMutationWork, false);
  assert.equal(staleSnapshotRoute.state.liveSourceRevalidations, 1);
  assert.equal(staleSnapshotRoute.state.mutationSetupEntries, 0);
  assert.equal(staleSnapshotRoute.state.mutationExecutorEntries, 0);
  assert.equal(staleSnapshotRoute.state.mutationApplications, 0);
  assert.deepEqual(
    staleSnapshotRoute.state.events.map((entry) => entry.event),
    ['apply-started', 'live-source-revalidation-rejected'],
  );

  assert.equal(driftedSourceRun.apply.status, 409);
  assert.equal(driftedSourceRun.apply.body.code, 'AUTH_SOURCE_BINDING_MISMATCH');
  assert.equal(driftedSourceRun.apply.body.idempotency.freshMutationWork, false);
  assert.equal(driftedSourceRoute.state.liveSourceRevalidations, 1);
  assert.equal(driftedSourceRoute.state.mutationSetupEntries, 0);
  assert.equal(driftedSourceRoute.state.mutationExecutorEntries, 0);
  assert.equal(driftedSourceRoute.state.mutationApplications, 0);
  assert.deepEqual(
    driftedSourceRoute.state.events.map((entry) => entry.event),
    ['apply-started', 'live-source-revalidation-rejected'],
  );

  assert.deepEqual(negativeCases.map((entry) => entry.code), [
    'APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED',
    'APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED',
    'PRECONDITION_FAILED',
    'AUTH_SOURCE_BINDING_MISMATCH',
  ]);
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED.revalidation.present, false);
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED.status, 'blocked');
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED.mutationCapableWork.started, true);
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED.revalidation.present, true);
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED.revalidation.commonValid, false);
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED.status, 'blocked');
  assert.equal(casesByCode.APPLY_LIVE_SOURCE_REVALIDATION_MALFORMED.mutationCapableWork.started, true);
  assert.equal(casesByCode.PRECONDITION_FAILED.validRejected, true);
  assert.equal(casesByCode.PRECONDITION_FAILED.mutationCapableWork.started, false);
  assert.equal(casesByCode.PRECONDITION_FAILED.ordering.beforeMutationSetup, true);
  assert.equal(casesByCode.PRECONDITION_FAILED.ordering.beforeFirstMutation, true);
  assertHashFields(casesByCode.PRECONDITION_FAILED.revalidation, [
    'snapshotHash',
    'rejectedMutationIdHash',
    'rejectedResourceKeyHash',
    'rejectedExpectedHash',
    'rejectedActualHash',
  ]);
  assert.equal(casesByCode.AUTH_SOURCE_BINDING_MISMATCH.validRejected, true);
  assert.equal(casesByCode.AUTH_SOURCE_BINDING_MISMATCH.mutationCapableWork.started, false);
  assert.equal(casesByCode.AUTH_SOURCE_BINDING_MISMATCH.ordering.beforeMutationSetup, true);
  assert.equal(casesByCode.AUTH_SOURCE_BINDING_MISMATCH.ordering.beforeFirstMutation, true);

  for (const negativeCase of negativeCases) {
    assert.equal(negativeCase.ok, false);
    assert.equal(negativeCase.status, 'blocked');
    assert.equal(negativeCase.releaseMovement.allowed, false);
    assertHashFields(negativeCase.routeEvidence, [
      'endpointPathHash',
      'requestPathHash',
      'routeProfileHash',
    ]);
  }

  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.releaseVerifier.carriesThroughOneSummary, true);
  assert.equal(summary.releaseVerifier.summaryCount, 1);
  assert.equal(summary.releaseVerifier.expectedNegativeCaseCount, 4);
  assert.equal(summary.releaseVerifier.allNegativeCasesBlocked, true);
  assert.deepEqual(
    summary.releaseVerifier.negativeCaseHashes,
    negativeCases.map((entry) => entry.caseHash),
  );
  assert.equal(summary.releaseMovement.allowed, false);
  assert.equal(summary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assertSupportEvidenceIsHashOnly(summary);
});
