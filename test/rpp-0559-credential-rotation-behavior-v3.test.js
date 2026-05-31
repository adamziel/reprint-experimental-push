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
const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const authScope = 'reprint-push-lab:authenticated-http-push';
const fixedNow = '2026-05-31T00:00:00Z';
const futureExpiry = '2030-01-01T00:00:00Z';
const sessionId = 'psh_01j00000000000000000559';
const rotatedSessionId = 'psh_01j0000000000000000559r';
const idempotencyKey = 'idem-rpp-0559-credential-rotation-v3';
const resourcePath = 'wp-content/uploads/reprint-push/rpp-0559-credential-rotation.txt';
const resourceKey = `file:${resourcePath}`;
const sha256Pattern = /^[a-f0-9]{64}$/;

const credentials = {
  bound: {
    username: 'reprint_push_admin',
    password: 'rpp-0559-bound-application-password',
  },
  rotated: {
    username: 'reprint_push_admin',
    password: 'rpp-0559-rotated-application-password',
  },
  invalidated: {
    username: 'reprint_push_admin',
    password: 'rpp-0559-invalidated-application-password',
  },
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function credentialHash(credential) {
  return sha256Hex(`${credential.username}\n${credential.password}`);
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0559:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function credentialKind(headers) {
  const authorization = String(headers.authorization || '');
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return 'missing';
  }

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  for (const [kind, credential] of Object.entries(credentials)) {
    if (decoded === `${credential.username}:${credential.password}`) {
      return kind;
    }
  }

  return 'unknown';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sourceIdentity() {
  return {
    sourceHash: fixtureHash('live-source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    restNamespace: 'reprint/v1',
    routeProfile: 'production-shaped',
    labBacked: false,
  };
}

function authEnvelope(kind = 'bound') {
  const credential = credentials[kind] || credentials.bound;
  const session = kind === 'rotated' ? rotatedSessionId : sessionId;

  return {
    identity: {
      userId: 559,
      userLogin: credential.username,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: session,
      expiresAt: futureExpiry,
      applicationPasswordUuid: `app-pass-rpp-0559-${kind}`,
      credentialHash: credentialHash(credential),
      sourceHash: sourceIdentity().sourceHash,
      sourceUrlHash: sourceIdentity().sourceUrlHash,
      revoked: false,
      cleanedUp: false,
      playgroundFallback: false,
    },
  };
}

function withBindingHash(binding) {
  return {
    ...binding,
    bindingHash: digest(binding),
  };
}

function withIssueHash(issue) {
  return {
    ...issue,
    issueHash: digest(issue),
  };
}

function buildReadyPlan() {
  const resource = { kind: 'file', path: resourcePath };
  const mutationId = 'mut_rpp_0559_apply_revalidates_live_source';
  const baseHash = fixtureHash('resource-base');
  const localHash = fixtureHash('resource-local');

  return {
    id: 'plan-rpp-0559-credential-rotation-behavior-v3',
    status: 'ready',
    summary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
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
    decisions: [],
    atomicGroups: [],
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

function receiptForPlan(plan, rawBodyHash) {
  const auth = authEnvelope('bound');
  const source = sourceIdentity();
  const evidence = planEvidence(plan);
  const identityHash = digest(auth.identity);
  const authSessionHash = digest(auth.session);
  const pushSessionHash = fixtureHash('push-session');
  const signingKeyHash = fixtureHash('bound-signing-key');
  const scopeHash = sha256Hex(authScope);
  const subjectBinding = withBindingHash({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash: evidence.planHash,
  });
  const sessionUser = withBindingHash({
    schemaVersion: 1,
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: auth.identity.userId,
    userLoginHash: sha256Hex(auth.identity.userLogin),
    identityHash,
    authSessionHash,
    pushSessionHash,
    manageOptions: true,
  });
  const issue = withIssueHash({
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: pushSessionHash,
    signingKeyHash,
    scopeHash,
    identityHash,
    userIdentityHash: fixtureHash('user-identity'),
    requiredCapability: 'manage_options',
    capabilityHash: fixtureHash('capability-granted'),
    sourceHash: source.sourceHash,
    sourceUrlHash: source.sourceUrlHash,
    credentialHash: auth.session.credentialHash,
    issuedAt: fixedNow,
    expiresAt: auth.session.expiresAt,
    ttlSeconds: 300,
  });
  const receipt = {
    schemaVersion: 1,
    planHash: evidence.planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    authBinding: {
      schemaVersion: 1,
      scope: authScope,
      planHash: evidence.planHash,
      binding: subjectBinding,
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash,
        issue,
        dryRunNonceHash: fixtureHash('dry-run-nonce'),
        dryRunContentHash: rawBodyHash,
        dryRunCanonicalHash: fixtureHash('dry-run-canonical'),
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
      },
      sessionUser,
      source,
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: `${routePrefix}/dry-run`,
        routeProfile: 'production-shaped',
        labBacked: false,
        planHash: evidence.planHash,
        planPayloadHash: evidence.planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash: rawBodyHash,
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: plan.mutations.length,
      },
      issuedAt: fixedNow,
      expiresAt: auth.session.expiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function signedRequest(pathname, contentHash, headers) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: headers['x-reprint-push-session']
      ? sha256Hex(headers['x-reprint-push-session'])
      : '',
    signingKeyHash: fixtureHash('bound-signing-key'),
    request: {
      method: 'POST',
      path: pathname,
      canonicalHash: sha256Hex([
        pathname,
        contentHash,
        headers['x-reprint-push-session'] || '',
        headers['x-reprint-push-idempotency-key'] || '',
      ].join('\n')),
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : '',
    },
  };
}

function applyRevalidationEvidence({ plan, receipt, currentSnapshot, startedSequence }) {
  const evidence = planEvidence(plan);
  const source = sourceIdentity();
  const receiptSource = receipt.authBinding.source;
  const verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || evidence.planHash,
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: plan.mutations.length,
    verifiedCount: plan.mutations.length,
    verifiedResourceKeys,
    liveSource: {
      snapshotHash: digest(currentSnapshot),
      sourceHash: source.sourceHash,
      sourceUrlHash: source.sourceUrlHash,
      receiptSourceHash: receiptSource.sourceHash,
      receiptSourceUrlHash: receiptSource.sourceUrlHash,
      sourceBindingHash: digest({
        receiptSourceHash: receiptSource.sourceHash,
        receiptSourceUrlHash: receiptSource.sourceUrlHash,
        currentSourceHash: source.sourceHash,
        currentSourceUrlHash: source.sourceUrlHash,
        phase: 'before-first-mutation',
      }),
      dbJournalCursor: `db-journal:${startedSequence}`,
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
}

function rejectionEnvelope({ kind, code, status, contentHash, state }) {
  const observedCredential = credentials[kind] || credentials.invalidated;
  return {
    ok: false,
    mode: 'apply',
    code,
    credentialRotation: {
      schemaVersion: 1,
      phase: kind === 'rotated' ? 'apply-signed-session-binding' : 'apply-authentication',
      observedCredentialHash: credentialHash(observedCredential),
      expectedCredentialHash: credentialHash(credentials.bound),
      requestHash: contentHash,
      mutationExecutorEntriesAtReject: state.mutationExecutorEntries,
      mutationApplicationsAtReject: state.mutationApplications,
    },
    idempotency: {
      replayed: false,
      conflict: false,
      freshMutationWork: false,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestHash: contentHash,
    },
  };
}

function createGeneratedCredentialRotationRoute() {
  const currentSnapshot = {
    files: { [resourcePath]: 'rpp-0559-live-source-before-accepted-apply' },
    plugins: {},
    db: {},
  };
  const state = {
    events: [],
    requests: [],
    invalidatedApplyRejections: 0,
    rotatedApplyRejections: 0,
    dryRunPayloadParses: 0,
    applyPayloadParses: 0,
    liveSourceRevalidations: 0,
    mutationExecutorEntries: 0,
    mutationApplications: 0,
  };

  function appendEvent(event, payload = {}) {
    const entry = {
      sequence: state.events.length + 1,
      event,
      ...payload,
    };
    state.events.push(entry);
    return entry;
  }

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const pathname = requestUrl.pathname;
    const method = options.method || 'GET';
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const headers = headerEntries(options.headers || {});
    const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
    const kind = credentialKind(headers);
    state.requests.push({ method, pathname, headers, rawBody, credentialKind: kind });

    if (pathname === `${routePrefix}/preflight`) {
      if (kind === 'invalidated' || kind === 'missing' || kind === 'unknown') {
        return jsonResponse({
          ok: false,
          mode: 'preflight',
          code: 'reprint_push_lab_auth_required',
        }, 401);
      }

      return jsonResponse({
        ok: true,
        mode: 'preflight',
        auth: authEnvelope(kind),
        session: {
          id: kind === 'rotated' ? rotatedSessionId : sessionId,
          type: 'production-auth-session',
          expiresAt: futureExpiry,
        },
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      assert.equal(kind, 'bound');
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));
      state.dryRunPayloadParses += 1;
      const body = JSON.parse(rawBody);
      const receipt = receiptForPlan(body.plan, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: authEnvelope('bound'),
        receipt,
        signedRequest: signedRequest(pathname, contentHash, headers),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));

      if (kind === 'invalidated') {
        state.invalidatedApplyRejections += 1;
        return jsonResponse(rejectionEnvelope({
          kind,
          code: 'reprint_push_lab_auth_required',
          status: 401,
          contentHash,
          state,
        }), 401);
      }

      if (kind === 'rotated') {
        state.rotatedApplyRejections += 1;
        return jsonResponse(rejectionEnvelope({
          kind,
          code: 'SIGNED_SESSION_BINDING_MISMATCH',
          status: 401,
          contentHash,
          state,
        }), 401);
      }

      assert.equal(kind, 'bound');
      state.applyPayloadParses += 1;
      const body = JSON.parse(rawBody);
      const started = appendEvent('apply-started', {
        requestHash: contentHash,
      });
      state.liveSourceRevalidations += 1;
      const applyRevalidation = applyRevalidationEvidence({
        plan: body.plan,
        receipt: body.receipt,
        currentSnapshot,
        startedSequence: started.sequence,
      });
      appendEvent('live-source-revalidated', {
        phase: applyRevalidation.phase,
        checkedAgainst: applyRevalidation.checkedAgainst,
        snapshotHash: applyRevalidation.liveSource.snapshotHash,
      });
      state.mutationExecutorEntries += 1;
      appendEvent('mutation-executor-entered', {
        mutationSetHash: applyRevalidation.mutationSetHash,
      });
      for (const mutation of body.plan.mutations) {
        state.mutationApplications += 1;
        appendEvent('mutation-applied', {
          mutationIdHash: sha256Hex(mutation.id),
          resourceKeyHash: sha256Hex(mutation.resourceKey),
        });
      }
      appendEvent('apply-committed', {
        applied: body.plan.mutations.length,
      });

      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: body.plan.mutations.length,
        responseSchemaVersion: 1,
        auth: authEnvelope('bound'),
        receipt: body.receipt,
        idempotency: {
          replayed: false,
          conflict: false,
          freshMutationWork: true,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash, headers),
        applyRevalidation,
      });
    }

    throw new Error(`unexpected RPP-0559 route request: ${method} ${pathname}`);
  }

  return { currentSnapshot, state, fetchHandler };
}

function firstEventSequence(events, event) {
  const entry = events.find((item) => item.event === event);
  return Number.isInteger(entry?.sequence) ? entry.sequence : null;
}

function supportCode({ accepted, rotatedRejected, invalidatedRejected }) {
  if (!invalidatedRejected) {
    return 'INVALIDATED_CREDENTIAL_REJECTION_REQUIRED';
  }
  if (!rotatedRejected) {
    return 'ROTATED_CREDENTIAL_REJECTION_REQUIRED';
  }
  if (!accepted) {
    return 'APPLY_LIVE_SOURCE_REVALIDATION_REQUIRED';
  }
  return 'LOCAL_CREDENTIAL_ROTATION_REVALIDATION_SUPPORT_ONLY';
}

function buildCredentialRotationSupportEvidence({
  dryRun,
  invalidatedApply,
  rotatedApply,
  acceptedApply,
  events,
}) {
  const receipt = dryRun.body.receipt;
  const revalidation = acceptedApply.body.applyRevalidation;
  const liveSource = revalidation.liveSource;
  const receiptBinding = revalidation.receiptBinding;
  const claim = revalidation.claim;
  const applyStartedSequence = firstEventSequence(events, 'apply-started');
  const liveRevalidationSequence = firstEventSequence(events, 'live-source-revalidated');
  const firstMutationSequence = firstEventSequence(events, 'mutation-applied');
  const commitSequence = firstEventSequence(events, 'apply-committed');
  const revalidatedAfterApplyStarted = Number.isInteger(applyStartedSequence)
    && Number.isInteger(liveRevalidationSequence)
    && applyStartedSequence < liveRevalidationSequence;
  const beforeFirstMutation = Number.isInteger(liveRevalidationSequence)
    && Number.isInteger(firstMutationSequence)
    && liveRevalidationSequence < firstMutationSequence;
  const invalidatedRejected = invalidatedApply.status === 401
    && invalidatedApply.body.code === 'reprint_push_lab_auth_required'
    && invalidatedApply.body.idempotency?.freshMutationWork === false
    && invalidatedApply.body.credentialRotation?.mutationExecutorEntriesAtReject === 0
    && invalidatedApply.body.credentialRotation?.mutationApplicationsAtReject === 0;
  const rotatedRejected = rotatedApply.status === 401
    && rotatedApply.body.code === 'SIGNED_SESSION_BINDING_MISMATCH'
    && rotatedApply.body.idempotency?.freshMutationWork === false
    && rotatedApply.body.credentialRotation?.mutationExecutorEntriesAtReject === 0
    && rotatedApply.body.credentialRotation?.mutationApplicationsAtReject === 0;
  const accepted = acceptedApply.status === 200
    && acceptedApply.body.ok === true
    && acceptedApply.body.idempotency?.freshMutationWork === true
    && revalidation.required === 'fresh-live-hashes-before-first-mutation'
    && revalidation.phase === 'before-first-mutation'
    && revalidation.checkedAgainst === 'live-remote'
    && revalidation.verifiedCount === revalidation.mutationCount
    && revalidatedAfterApplyStarted
    && beforeFirstMutation;
  const ok = invalidatedRejected && rotatedRejected && accepted;

  return {
    schemaVersion: 1,
    slice: 'RPP-0559',
    proofClass: 'generated-credential-rotation-live-source-revalidation',
    evidenceScope: 'local-generated-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code: supportCode({ accepted, rotatedRejected, invalidatedRejected }),
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    credentialBinding: {
      boundCredentialHash: credentialHash(credentials.bound),
      rotatedCredentialHash: credentialHash(credentials.rotated),
      invalidatedCredentialHash: credentialHash(credentials.invalidated),
      userLoginHash: sha256Hex(credentials.bound.username),
      receiptCredentialHash: receipt.authBinding.session.credentialHash,
      applicationPasswordUuidHash: sha256Hex(receipt.authBinding.session.applicationPasswordUuid),
      sessionHash: sha256Hex(sessionId),
      receiptHash: receipt.receiptHash,
      planHash: receipt.planHash,
    },
    rejectedCredentialBinding: {
      invalidated: {
        status: invalidatedApply.status,
        code: invalidatedApply.body.code,
        phase: invalidatedApply.body.credentialRotation.phase,
        observedCredentialHash: invalidatedApply.body.credentialRotation.observedCredentialHash,
        expectedCredentialHash: invalidatedApply.body.credentialRotation.expectedCredentialHash,
        requestHash: invalidatedApply.body.credentialRotation.requestHash,
        freshMutationWork: invalidatedApply.body.idempotency.freshMutationWork,
        mutationExecutorEntriesAtReject: invalidatedApply.body.credentialRotation.mutationExecutorEntriesAtReject,
        mutationApplicationsAtReject: invalidatedApply.body.credentialRotation.mutationApplicationsAtReject,
      },
      rotated: {
        status: rotatedApply.status,
        code: rotatedApply.body.code,
        phase: rotatedApply.body.credentialRotation.phase,
        observedCredentialHash: rotatedApply.body.credentialRotation.observedCredentialHash,
        expectedCredentialHash: rotatedApply.body.credentialRotation.expectedCredentialHash,
        requestHash: rotatedApply.body.credentialRotation.requestHash,
        freshMutationWork: rotatedApply.body.idempotency.freshMutationWork,
        mutationExecutorEntriesAtReject: rotatedApply.body.credentialRotation.mutationExecutorEntriesAtReject,
        mutationApplicationsAtReject: rotatedApply.body.credentialRotation.mutationApplicationsAtReject,
      },
    },
    acceptedApply: {
      status: acceptedApply.status,
      ok: acceptedApply.body.ok === true,
      applied: acceptedApply.body.applied,
      freshMutationWork: acceptedApply.body.idempotency.freshMutationWork,
      idempotencyKeyHash: acceptedApply.body.idempotency.idempotencyKeyHash,
      requestHash: acceptedApply.body.idempotency.requestHash,
      signedRequestHash: digest(acceptedApply.body.signedRequest.request),
    },
    revalidation: {
      required: revalidation.required,
      phase: revalidation.phase,
      checkedAgainst: revalidation.checkedAgainst,
      mutationCount: revalidation.mutationCount,
      verifiedCount: revalidation.verifiedCount,
      planHash: revalidation.planHash,
      receiptHash: revalidation.receiptHash,
      preconditionSetHash: revalidation.preconditionSetHash,
      mutationSetHash: revalidation.mutationSetHash,
      verifiedResourceKeysHash: digest(revalidation.verifiedResourceKeys),
      snapshotHash: liveSource.snapshotHash,
      sourceHash: liveSource.sourceHash,
      sourceUrlHash: liveSource.sourceUrlHash,
      receiptSourceHash: liveSource.receiptSourceHash,
      receiptSourceUrlHash: liveSource.receiptSourceUrlHash,
      sourceBindingHash: liveSource.sourceBindingHash,
      dbJournalCursorHash: sha256Hex(liveSource.dbJournalCursor),
      receiptSessionHash: receiptBinding.sessionHash,
      activeClaimKeyHash: claim.activeClaimKeyHash,
    },
    ordering: {
      applyStartedSequence,
      liveRevalidationSequence,
      firstMutationSequence,
      commitSequence,
      revalidatedAfterApplyStarted,
      beforeFirstMutation,
    },
    mutationAttempted: Number.isInteger(firstMutationSequence),
    releaseMovement: {
      allowed: false,
      gates: '0/1',
      reason: 'local generated credential-rotation evidence is support-only until checked against production-owned URL and credentials',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production executor-auth credential rotation revalidation proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function assertBareSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} must be a bare sha256 digest`);
}

function assertHashFields(value, fields) {
  for (const field of fields) {
    assertBareSha256(value[field], field);
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

test('RPP-0559 v3 keeps credential checks and live-source revalidation before mutation', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const runDbJournalApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const revalidateLiveSource = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');

  assertBefore(
    authenticatedApply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    '$payload = reprint_push_lab_rest_json_payload($request);',
  );
  assertBefore(
    authenticatedApply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload);',
    'reprint_push_lab_rest_apply_with_db_journal($request, true);',
  );
  assert.match(validateReceipt, /\$session\['credentialHash'\]/);
  assert.match(validateReceipt, /\$session\['applicationPasswordUuid'\]/);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assert.match(validateReceipt, /Receipt source binding does not match the current live source\./);

  assert.match(verifySignedRequest, /'SIGNED_SESSION_BINDING_MISMATCH'/);
  assertBefore(
    verifySignedRequest,
    "$session['credentialHash']",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "$session['sourceUrlHash']",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "'SIGNED_SESSION_BINDING_MISMATCH'",
    'reprint_push_lab_rest_claim_signed_nonce',
  );

  assertBefore(
    runDbJournalApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runDbJournalApply,
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
    "$result = reprint_push_protocol_run_payload('apply'",
  );
  assertBefore(
    revalidateLiveSource,
    '$current_source = reprint_push_lab_rest_apply_live_source_binding_evidence($request, $accepted);',
    '$current = reprint_push_export_snapshot();',
  );
  assertBefore(
    revalidateLiveSource,
    '$current = reprint_push_export_snapshot();',
    'reprint_push_protocol_verify_preconditions(',
  );

  assert.match(revalidateLiveSource, /'phase'\s*=>\s*'before-first-mutation'/);
  assert.match(revalidateLiveSource, /'checkedAgainst'\s*=>\s*'live-remote'/);
  assert.match(revalidateLiveSource, /'AUTH_SOURCE_BINDING_MISMATCH'/);

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
      revalidateLiveSource,
      new RegExp(forbiddenMutationCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
});

test('RPP-0559 v3 rejects rotated or invalidated apply credentials before accepted revalidation mutation', async () => {
  const originalFetch = global.fetch;
  const route = createGeneratedCredentialRotationRoute();
  const plan = buildReadyPlan();

  global.fetch = route.fetchHandler;

  try {
    const boundClient = authenticatedHttpClient({
      sourceUrl,
      credential: credentials.bound,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1,
    });
    const rotatedClient = authenticatedHttpClient({
      sourceUrl,
      credential: credentials.rotated,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1,
    });
    const invalidatedClient = authenticatedHttpClient({
      sourceUrl,
      credential: credentials.invalidated,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1,
    });

    const boundPreflight = await boundClient.signedGet('/preflight');
    assert.equal(boundPreflight.status, 200);
    assert.equal(boundPreflight.body.auth.session.credentialHash, credentialHash(credentials.bound));
    assert.equal(boundPreflight.body.session.id, sessionId);

    const rotatedPreflight = await rotatedClient.signedGet('/preflight');
    assert.equal(rotatedPreflight.status, 200);
    assert.equal(rotatedPreflight.body.auth.session.credentialHash, credentialHash(credentials.rotated));
    assert.notEqual(
      rotatedPreflight.body.auth.session.credentialHash,
      boundPreflight.body.auth.session.credentialHash,
    );

    const invalidatedPreflight = await invalidatedClient.signedGet('/preflight');
    assert.equal(invalidatedPreflight.status, 401);
    assert.equal(invalidatedPreflight.body.code, 'reprint_push_lab_auth_required');

    const dryRun = await boundClient.signedPost('/dry-run', { plan }, {
      session: sessionId,
      idempotencyKey,
    });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.receipt.authBinding.session.credentialHash, credentialHash(credentials.bound));
    assert.equal(dryRun.body.receipt.authBinding.pushSession.dryRunIdempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(route.state.mutationExecutorEntries, 0);
    assert.equal(route.state.mutationApplications, 0);

    const invalidatedApply = await invalidatedClient.signedPost('/apply', {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session: sessionId,
      idempotencyKey,
    });
    assert.equal(invalidatedApply.status, 401);
    assert.equal(invalidatedApply.body.code, 'reprint_push_lab_auth_required');
    assert.equal(invalidatedApply.body.idempotency.freshMutationWork, false);
    assert.equal(invalidatedApply.body.credentialRotation.mutationExecutorEntriesAtReject, 0);
    assert.equal(invalidatedApply.body.credentialRotation.mutationApplicationsAtReject, 0);
    assert.equal(route.state.mutationExecutorEntries, 0);
    assert.equal(route.state.mutationApplications, 0);

    const rotatedApply = await rotatedClient.signedPost('/apply', {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session: sessionId,
      idempotencyKey,
    });
    assert.equal(rotatedApply.status, 401);
    assert.equal(rotatedApply.body.code, 'SIGNED_SESSION_BINDING_MISMATCH');
    assert.equal(rotatedApply.body.idempotency.freshMutationWork, false);
    assert.equal(rotatedApply.body.credentialRotation.mutationExecutorEntriesAtReject, 0);
    assert.equal(rotatedApply.body.credentialRotation.mutationApplicationsAtReject, 0);
    assert.equal(route.state.mutationExecutorEntries, 0);
    assert.equal(route.state.mutationApplications, 0);

    const acceptedApply = await boundClient.signedPost('/apply', {
      plan,
      receipt: dryRun.body.receipt,
    }, {
      session: sessionId,
      idempotencyKey,
    });
    assert.equal(acceptedApply.status, 200);
    assert.equal(acceptedApply.body.ok, true);
    assert.equal(acceptedApply.body.idempotency.freshMutationWork, true);
    assert.equal(acceptedApply.body.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
    assert.equal(acceptedApply.body.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(acceptedApply.body.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(acceptedApply.body.applyRevalidation.planHash, dryRun.body.receipt.planHash);
    assert.equal(acceptedApply.body.applyRevalidation.receiptHash, dryRun.body.receipt.receiptHash);
    assert.equal(acceptedApply.body.applyRevalidation.mutationCount, plan.mutations.length);
    assert.equal(acceptedApply.body.applyRevalidation.verifiedCount, plan.mutations.length);
    assert.deepEqual(
      acceptedApply.body.applyRevalidation.verifiedResourceKeys,
      plan.mutations.map((mutation) => mutation.resourceKey),
    );
    assert.deepEqual(
      route.state.events.map((entry) => entry.event),
      [
        'apply-started',
        'live-source-revalidated',
        'mutation-executor-entered',
        'mutation-applied',
        'apply-committed',
      ],
    );
    assert.equal(route.state.liveSourceRevalidations, 1);
    assert.equal(route.state.mutationExecutorEntries, 1);
    assert.equal(route.state.mutationApplications, 1);
    assert.equal(route.state.invalidatedApplyRejections, 1);
    assert.equal(route.state.rotatedApplyRejections, 1);
    assert.equal(route.state.applyPayloadParses, 1);

    const evidence = buildCredentialRotationSupportEvidence({
      dryRun,
      invalidatedApply,
      rotatedApply,
      acceptedApply,
      events: route.state.events,
    });

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.code, 'LOCAL_CREDENTIAL_ROTATION_REVALIDATION_SUPPORT_ONLY');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.rejectedCredentialBinding.invalidated.freshMutationWork, false);
    assert.equal(evidence.rejectedCredentialBinding.rotated.freshMutationWork, false);
    assert.equal(evidence.acceptedApply.freshMutationWork, true);
    assert.equal(evidence.revalidation.phase, 'before-first-mutation');
    assert.equal(evidence.revalidation.checkedAgainst, 'live-remote');
    assert.equal(evidence.ordering.revalidatedAfterApplyStarted, true);
    assert.equal(evidence.ordering.beforeFirstMutation, true);
    assert.equal(evidence.mutationAttempted, true);
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashFields(evidence.credentialBinding, [
      'boundCredentialHash',
      'rotatedCredentialHash',
      'invalidatedCredentialHash',
      'userLoginHash',
      'receiptCredentialHash',
      'applicationPasswordUuidHash',
      'sessionHash',
      'receiptHash',
      'planHash',
    ]);
    for (const rejection of Object.values(evidence.rejectedCredentialBinding)) {
      assertHashFields(rejection, [
        'observedCredentialHash',
        'expectedCredentialHash',
        'requestHash',
      ]);
    }
    assertHashFields(evidence.acceptedApply, [
      'idempotencyKeyHash',
      'requestHash',
      'signedRequestHash',
    ]);
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
      'receiptSessionHash',
      'activeClaimKeyHash',
    ]);
    assertNoRawValues(evidence, [
      sourceUrl,
      authScope,
      credentials.bound.username,
      credentials.bound.password,
      credentials.rotated.password,
      credentials.invalidated.password,
      sessionId,
      rotatedSessionId,
      idempotencyKey,
      resourcePath,
      resourceKey,
      route.currentSnapshot.files[resourcePath],
      dryRun.body.receipt.authBinding.session.applicationPasswordUuid,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
