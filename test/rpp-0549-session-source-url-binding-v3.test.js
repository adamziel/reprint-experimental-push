import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const sourceUrl = 'http://127.0.0.1:8080';
const driftedSourceUrl = 'http://127.0.0.1:8080/rpp-0549-drifted-source';
const routePrefix = '/wp-json/reprint/v1/push';
const authScope = 'reprint-push-lab:authenticated-http-push';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000549';
const futureExpiry = '2030-01-01T00:00:00Z';
const sha256Pattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'reprint_push_admin',
  password: 'rpp-0549-application-password',
};

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function credentialHash() {
  return sha256Hex(`${credential.username}\n${credential.password}`);
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0549:${label}`);
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
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function signedRequest(pathname, contentHash, headers) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: fixtureHash('push-session'),
    signingKeyHash: fixtureHash('signing-key'),
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

function authEnvelope() {
  return {
    identity: {
      userId: 549,
      userLogin: credential.username,
      capabilities: { manage_options: true },
    },
    session: {
      type: 'production-auth-session',
      status: 'active',
      id: sessionId,
      expiresAt: futureExpiry,
      applicationPasswordUuid: 'app-pass-rpp-0549',
      credentialHash: credentialHash(),
      revoked: false,
      cleanedUp: false,
      playgroundFallback: false,
    },
  };
}

function normalizeSourceUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function sourceIdentity(value = sourceUrl) {
  const normalized = normalizeSourceUrl(value);
  const identity = {
    sourceUrl: normalized,
    sourceUrlHash: sha256Hex(normalized),
    siteUrl: normalized,
    homeUrl: normalized,
    restNamespace: 'reprint/v1',
    routeProfile: 'production-shaped',
    labBacked: false,
  };
  return {
    ...identity,
    sourceHash: digest(identity),
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

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
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

function receiptForPlan(plan, idempotencyKey, dryRunRawBodyHash) {
  const auth = authEnvelope();
  const source = sourceIdentity();
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(auth.identity);
  const authSessionHash = digest(auth.session);
  const pushSessionHash = fixtureHash('push-session');
  const signingKeyHash = fixtureHash('signing-key');
  const scopeHash = sha256Hex(authScope);
  const subjectBinding = withBindingHash({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash,
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
    issuedAt: '2026-05-31T00:00:00Z',
    expiresAt: auth.session.expiresAt,
    ttlSeconds: 300,
  });
  const receipt = {
    planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      scope: authScope,
      planHash,
      binding: subjectBinding,
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash,
        issue,
        dryRunNonceHash: fixtureHash('dry-run-nonce'),
        dryRunContentHash: dryRunRawBodyHash,
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
        planHash,
        planPayloadHash: planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash,
      },
      plan: {
        schemaVersion: 1,
        planHash,
        planPayloadHash: planHash,
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
      },
      snapshotHashes: {
        schemaVersion: 1,
        required: 'dry-run receipt binds snapshot hash preconditions as planning evidence only',
        planningOnly: true,
        snapshotIdHash: fixtureHash('snapshot-id'),
        coverageHash: fixtureHash('coverage'),
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
        planHash,
      },
      issuedAt: '2026-05-31T00:00:00Z',
      expiresAt: auth.session.expiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function sourceMismatchApplyRevalidation({ plan, receipt, currentSource }) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const evidence = planEvidence(plan);
  const receiptSource = receipt.authBinding.source;
  const liveSource = {
    snapshotHash: '',
    sourceHash: currentSource.sourceHash,
    sourceUrlHash: currentSource.sourceUrlHash,
    receiptSourceHash: receiptSource.sourceHash,
    receiptSourceUrlHash: receiptSource.sourceUrlHash,
    sourceBindingHash: digest({
      receiptSourceHash: receiptSource.sourceHash,
      receiptSourceUrlHash: receiptSource.sourceUrlHash,
      currentSourceHash: currentSource.sourceHash,
      currentSourceUrlHash: currentSource.sourceUrlHash,
      phase: 'before-first-mutation',
    }),
    dbJournalCursor: 'db-journal:1',
  };

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || digest(plan),
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: mutations.length,
    verifiedCount: 0,
    verifiedResourceKeys: [],
    liveSource,
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
      activeClaimKeyHash: fixtureHash('active-claim-key'),
      activeClaimSequence: 1,
      staleClaimRetry: false,
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

test('RPP-0549 v3 route binds short-lived session and receipt source before apply mutation', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const mintSession = functionBody('reprint_push_lab_rest_mint_signed_session');
  const signedRequestEvidence = functionBody('reprint_push_lab_rest_signed_request_evidence');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const sourceIdentityBody = functionBody('reprint_push_lab_rest_source_identity');
  const sourceBindingMatches = functionBody('reprint_push_lab_rest_source_binding_matches');
  const authenticatedApply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const runApply = functionBody('reprint_push_lab_rest_run_db_journal_apply');
  const revalidateLiveSource = functionBody('reprint_push_lab_rest_revalidate_apply_live_source_before_mutation');
  const sourceBindingEvidence = functionBody('reprint_push_lab_rest_apply_live_source_binding_evidence');
  const applyRevalidationEvidence = functionBody('reprint_push_lab_rest_apply_revalidation_evidence');

  assertBefore(
    verifySignedRequest,
    '$current_source = reprint_push_lab_rest_source_identity($request);',
    '$session = reprint_push_lab_rest_signed_session($session_id);',
  );
  assertBefore(
    verifySignedRequest,
    "|| !hash_equals((string) ($session['sourceHash'] ?? ''), (string) ($current_source['sourceHash'] ?? ''))",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "|| !hash_equals((string) ($session['sourceUrlHash'] ?? ''), (string) ($current_source['sourceUrlHash'] ?? ''))",
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    "'SIGNED_SESSION_BINDING_MISMATCH'",
    'reprint_push_lab_rest_claim_signed_nonce',
  );
  assert.match(
    verifySignedRequest,
    /reprint_push_lab_rest_mint_signed_session\(\$auth,\s*\$signing_key_hash,\s*\$current_source\)/,
  );

  assert.match(sourceIdentityBody, /'sourceUrl'\s*=>\s*\$source_url/);
  assert.match(sourceIdentityBody, /'sourceUrlHash'\s*=>\s*hash\('sha256',\s*\$source_url\)/);
  assert.match(sourceIdentityBody, /\$identity\['sourceHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(sourceBindingMatches, /\['sourceHash', 'sourceUrlHash', 'sourceUrl', 'siteUrl', 'homeUrl', 'restNamespace', 'routeProfile'\]/);

  assert.match(mintSession, /'sourceHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceHash'\] \?\? ''\)/);
  assert.match(mintSession, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$source_identity\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(signedRequestEvidence, /'sourceHash'\s*=>\s*\(string\)\s*\(\$session\['sourceHash'\] \?\? ''\)/);
  assert.match(signedRequestEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$session\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'sourceHash'\s*=>\s*\(string\)\s*\(\$session\['sourceHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$session\['sourceUrlHash'\] \?\? ''\)/);
  assert.match(bindReceipt, /'source'\s*=>\s*reprint_push_lab_rest_source_identity\(\$request\)/);

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
  assertBefore(
    validateReceipt,
    '$current_source = reprint_push_lab_rest_source_identity($request);',
    '$signed_request = reprint_push_lab_rest_signed_request_evidence($request);',
  );
  assert.match(validateReceipt, /reprint_push_lab_rest_source_binding_matches\(\$source_binding,\s*\$current_source\)/);
  assert.match(validateReceipt, /Receipt source binding does not match the current live source\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);

  assertBefore(
    runApply,
    "reprint_push_lab_db_journal_append_event('apply-started'",
    '$accepted = reprint_push_lab_rest_revalidate_apply_live_source_before_mutation(',
  );
  assertBefore(
    runApply,
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
    "'AUTH_SOURCE_BINDING_MISMATCH'",
    '$current = reprint_push_export_snapshot();',
  );

  assert.match(sourceBindingEvidence, /\$current_source\s*=\s*reprint_push_lab_rest_source_identity\(\$request\)/);
  assert.match(sourceBindingEvidence, /reprint_push_lab_rest_source_binding_matches\(\$receipt_source,\s*\$current_source\)/);
  assert.match(sourceBindingEvidence, /'checkedAgainst'\s*=>\s*'live-source-url'/);
  assert.match(sourceBindingEvidence, /'sourceHash'\s*=>\s*\(string\)\s*\(\$current_source\['sourceHash'\]/);
  assert.match(sourceBindingEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$current_source\['sourceUrlHash'\]/);
  assert.match(sourceBindingEvidence, /'receiptSourceHash'\s*=>\s*\(string\)\s*\(\$receipt_source\['sourceHash'\]/);
  assert.match(sourceBindingEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$receipt_source\['sourceUrlHash'\]/);
  assert.match(sourceBindingEvidence, /'sourceBindingHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json/);
  assert.match(applyRevalidationEvidence, /'liveSource'\s*=>\s*\[/);
  assert.match(applyRevalidationEvidence, /'sourceHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['sourceHash'\]/);
  assert.match(applyRevalidationEvidence, /'sourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['sourceUrlHash'\]/);
  assert.match(applyRevalidationEvidence, /'receiptSourceHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['receiptSourceHash'\]/);
  assert.match(applyRevalidationEvidence, /'receiptSourceUrlHash'\s*=>\s*\(string\)\s*\(\$live_revalidation\['receiptSourceUrlHash'\]/);

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

test('RPP-0549 v3 mocked apply rejects drifted live source before mutation setup', async () => {
  const originalFetch = global.fetch;
  const idempotencyKey = 'idem-rpp-0549-session-source-url-binding-v3';
  const filePath = 'wp-content/uploads/reprint-push/rpp-0549-session-source-url-binding.txt';
  const base = {
    files: { [filePath]: 'rpp-0549-private-base-source-state' },
    plugins: {},
    db: {},
  };
  const local = {
    files: { [filePath]: 'rpp-0549-private-local-source-state' },
    plugins: {},
    db: {},
  };
  const seen = [];
  let dryRunPlan = null;
  let dryRunReceipt = null;
  let applyRejection = null;
  let liveRevalidationCount = 0;
  let mutationSetupCount = 0;
  let mutationWorkCount = 0;

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex('');
    seen.push({ pathname, rawBody, body, headers });

    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: authEnvelope(),
        session: { id: sessionId, expiresAt: futureExpiry },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: cloneJson(base),
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(body.plan, idempotencyKey, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: authEnvelope(),
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash, headers),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(contentHash, sha256Hex(rawBody));
      liveRevalidationCount += 1;
      const currentSource = sourceIdentity(driftedSourceUrl);
      const applyRevalidation = sourceMismatchApplyRevalidation({
        plan: body.plan,
        receipt: body.receipt,
        currentSource,
      });
      applyRejection = {
        schemaVersion: 1,
        code: 'AUTH_SOURCE_BINDING_MISMATCH',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-source-url',
        sourceHash: currentSource.sourceHash,
        sourceUrlHash: currentSource.sourceUrlHash,
        receiptSourceHash: dryRunReceipt.authBinding.source.sourceHash,
        receiptSourceUrlHash: dryRunReceipt.authBinding.source.sourceUrlHash,
        sourceBindingHash: applyRevalidation.liveSource.sourceBindingHash,
        requestHash: contentHash,
        mutationSetupCount,
        mutationWorkCount,
      };
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: applyRejection.code,
        message: 'Receipt source URL binding does not match the current live source before apply mutation.',
        applied: 0,
        responseSchemaVersion: 1,
        auth: authEnvelope(),
        receipt: body.receipt,
        idempotency: {
          replayed: false,
          conflict: false,
          freshMutationWork: false,
          status: 'source-binding-mismatch',
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash, headers),
        applyRevalidation,
      }, 500);
    }

    mutationSetupCount += 1;
    mutationWorkCount += 1;
    throw new Error(`unexpected mutation setup path for RPP-0549: ${pathname}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      requireProductionAuthSession: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'AUTH_SOURCE_BINDING_MISMATCH');
    assert.equal(summary.apply.status, 500);
    assert.equal(summary.apply.applied, 0);
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.equal(summary.apply.idempotency.replayed, false);
    assert.equal(summary.apply.applyRevalidation.phase, 'before-first-mutation');
    assert.equal(summary.apply.applyRevalidation.checkedAgainst, 'live-remote');
    assert.equal(summary.apply.applyRevalidation.planHash, dryRunReceipt.planHash);
    assert.equal(summary.apply.applyRevalidation.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(summary.apply.applyRevalidation.mutationCount, dryRunPlan.mutations.length);
    assert.equal(summary.apply.applyRevalidation.verifiedCount, 0);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.replay, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameUser, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameSession, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sessionUserBindingPresent, true);
    assert.equal(liveRevalidationCount, 1);
    assert.equal(mutationSetupCount, 0);
    assert.equal(mutationWorkCount, 0);

    assert.equal(dryRunReceipt.authBinding.source.sourceHash, sourceIdentity().sourceHash);
    assert.equal(dryRunReceipt.authBinding.source.sourceUrlHash, sourceIdentity().sourceUrlHash);
    assert.equal(dryRunReceipt.authBinding.pushSession.issue.sourceHash, sourceIdentity().sourceHash);
    assert.equal(dryRunReceipt.authBinding.pushSession.issue.sourceUrlHash, sourceIdentity().sourceUrlHash);
    assert.equal(applyRejection.sourceHash, sourceIdentity(driftedSourceUrl).sourceHash);
    assert.equal(applyRejection.sourceUrlHash, sourceIdentity(driftedSourceUrl).sourceUrlHash);
    assert.equal(applyRejection.receiptSourceHash, sourceIdentity().sourceHash);
    assert.equal(applyRejection.receiptSourceUrlHash, sourceIdentity().sourceUrlHash);
    assert.notEqual(applyRejection.sourceHash, applyRejection.receiptSourceHash);
    assert.notEqual(applyRejection.sourceUrlHash, applyRejection.receiptSourceUrlHash);
    assert.deepEqual(
      seen.map((entry) => entry.pathname),
      [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
        `${routePrefix}/apply`,
      ],
    );

    const supportEvidence = {
      schemaVersion: 1,
      sourceBoundSessionAndReceipt: {
        receiptHash: dryRunReceipt.receiptHash,
        planHash: dryRunReceipt.planHash,
        sessionHash: dryRunReceipt.authBinding.pushSession.sessionHash,
        issueHash: dryRunReceipt.authBinding.pushSession.issue.issueHash,
        issueSourceHash: dryRunReceipt.authBinding.pushSession.issue.sourceHash,
        issueSourceUrlHash: dryRunReceipt.authBinding.pushSession.issue.sourceUrlHash,
        receiptSourceHash: dryRunReceipt.authBinding.source.sourceHash,
        receiptSourceUrlHash: dryRunReceipt.authBinding.source.sourceUrlHash,
        dryRunContentHash: dryRunReceipt.authBinding.pushSession.dryRunContentHash,
        dryRunIdempotencyKeyHash: dryRunReceipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
      },
      applySourceRevalidation: {
        code: applyRejection.code,
        phase: applyRejection.phase,
        checkedAgainst: applyRejection.checkedAgainst,
        requestHash: applyRejection.requestHash,
        currentSourceHash: applyRejection.sourceHash,
        currentSourceUrlHash: applyRejection.sourceUrlHash,
        receiptSourceHash: applyRejection.receiptSourceHash,
        receiptSourceUrlHash: applyRejection.receiptSourceUrlHash,
        sourceBindingHash: applyRejection.sourceBindingHash,
        liveRevalidationCount,
        mutationSetupCount,
        mutationWorkCount,
      },
    };

    assertHashFields(supportEvidence.sourceBoundSessionAndReceipt, [
      'receiptHash',
      'planHash',
      'sessionHash',
      'issueHash',
      'issueSourceHash',
      'issueSourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'dryRunContentHash',
      'dryRunIdempotencyKeyHash',
    ]);
    assertHashFields(supportEvidence.applySourceRevalidation, [
      'requestHash',
      'currentSourceHash',
      'currentSourceUrlHash',
      'receiptSourceHash',
      'receiptSourceUrlHash',
      'sourceBindingHash',
    ]);
    assertNoRawValues(supportEvidence, [
      credential.username,
      credential.password,
      idempotencyKey,
      sessionId,
      authScope,
      sourceUrl,
      driftedSourceUrl,
      filePath,
      base.files[filePath],
      local.files[filePath],
      dryRunReceipt.authBinding.session.applicationPasswordUuid,
    ]);
    assertNoRawValues(applyRejection, [
      credential.username,
      credential.password,
      idempotencyKey,
      sessionId,
      authScope,
      sourceUrl,
      driftedSourceUrl,
      filePath,
      base.files[filePath],
      local.files[filePath],
      dryRunReceipt.authBinding.session.applicationPasswordUuid,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
