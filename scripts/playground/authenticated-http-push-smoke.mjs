#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const sessionHeader = 'X-Reprint-Push-Session';
const authContentHashHeader = 'X-Auth-Content-Hash';
const authTimestampHeader = 'X-Auth-Timestamp';
const authNonceHeader = 'X-Auth-Nonce';
const authSignatureHeader = 'X-Auth-Signature';
const pushSignatureHeader = 'X-Reprint-Push-Signature';
const authScope = 'reprint-push-lab:authenticated-http-push';

const credentials = {
  admin: {
    username: 'reprint_push_admin',
    password: 'reprint-push-admin-app-password',
  },
  altAdmin: {
    username: 'reprint_push_alt_admin',
    password: 'reprint-push-alt-admin-app-password',
  },
  limited: {
    username: 'reprint_push_limited',
    password: 'reprint-push-limited-app-password',
  },
};

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
  remoteChanged: 'fixtures/playground/remote-changed.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);
const readyLocalSnapshot = snapshots.local;

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: readyLocalSnapshot,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assertReadyPlanResources(readyPlan);
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'ready preconditions');

const forgedAuthContext = {
  type: 'application-password-basic',
  verifier: 'client-forged',
  userId: 1,
  userLogin: credentials.admin.username,
  applicationPasswordUuid: 'client-forged-application-password',
  credentialHash: digest('client-forged-credential'),
  playgroundFallback: true,
};

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  auth: {},
  routes: {},
  negative: {},
  dryRun: {},
  apply: {},
  replay: {},
  stale: {},
};

let readyReceipt;
let signedNonceCounter = 0;

await withPlaygroundServer('authenticated-ready-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const index = await routeIndex(server);
  assert.equal(index.status, 200);
  assertRouteNamespace(index.body);

  const coreMe = await requestJson(
    server,
    'GET',
    '/wp-json/wp/v2/users/me?context=edit',
    undefined,
    authHeaders(credentials.admin),
  );
  const coreApplicationPasswordAvailable = coreMe.status === 200;
  if (coreApplicationPasswordAvailable) {
    assert.equal(coreMe.body.username, credentials.admin.username);
  } else {
    assert.equal(coreMe.status, 401, 'unexpected core Application Password failure status');
    assert.equal(coreMe.body.code, 'rest_not_logged_in', 'unexpected core Application Password failure code');
  }

  const initial = await getSnapshot(server);
  assertSnapshotContentEqual(initial.body.snapshot, snapshots.base, 'ready initial HTTP snapshot');

  const forgedAuthHeaders = {
    reprint_push_lab_auth: JSON.stringify(forgedAuthContext),
  };

  const missingSnapshotAuth = await getAuthenticated(server, '/snapshot');
  await assertFailureNoMutation(server, missingSnapshotAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth snapshot',
  });

  const forgedSnapshotAuth = await getAuthenticated(server, forgedAuthQuery('/snapshot'), forgedAuthHeaders);
  await assertFailureNoMutation(server, forgedSnapshotAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'forged internal auth snapshot',
  });

  const forgedPreflightAuth = await getAuthenticated(server, forgedAuthQuery('/preflight'), forgedAuthHeaders);
  await assertFailureNoMutation(server, forgedPreflightAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'forged internal auth preflight',
  });

  const missingJournalAuth = await getAuthenticated(server, '/journal?limit=80');
  await assertFailureNoMutation(server, missingJournalAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth journal',
  });

  const missingDbJournalAuth = await getAuthenticated(server, '/db-journal?limit=80');
  await assertFailureNoMutation(server, missingDbJournalAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth db-journal',
  });

  const missingDbJournalSchemaAuth = await getAuthenticated(server, '/db-journal/schema');
  await assertFailureNoMutation(server, missingDbJournalSchemaAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth db-journal schema',
  });

  const missingRecoveryAuth = await postAuthenticated(server, '/recovery/inspect', { plan: readyPlan, receipt: {} });
  await assertFailureNoMutation(server, missingRecoveryAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth recovery inspect',
  });

  const missingAuth = await postAuthenticated(server, '/dry-run', { plan: readyPlan });
  await assertFailureNoMutation(server, missingAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'missing auth dry-run',
  });

  const forgedDryRunAuth = await postAuthenticated(
    server,
    '/dry-run',
    { plan: readyPlan, reprint_push_lab_auth: forgedAuthContext },
    forgedAuthHeaders,
  );
  await assertFailureNoMutation(server, forgedDryRunAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'forged internal auth dry-run',
  });
  assert.equal(forgedDryRunAuth.body.receipt, undefined, 'forged internal auth dry-run minted a receipt');

  const forgedApplyAuth = await postAuthenticated(
    server,
    '/apply',
    { plan: readyPlan, receipt: {}, reprint_push_lab_auth: forgedAuthContext },
    {
      ...forgedAuthHeaders,
      [idempotencyHeader]: 'auth-http-forged-internal-auth-apply',
    },
  );
  await assertFailureNoMutation(server, forgedApplyAuth, initial.body.snapshot, {
    status: 401,
    code: 'reprint_push_lab_auth_required',
    label: 'forged internal auth apply',
  });

  const badAuth = await postAuthenticated(server, '/dry-run', { plan: readyPlan }, {
    authorization: basicAuth(credentials.admin.username, 'wrong-password'),
  });
  await assertFailureNoMutation(server, badAuth, initial.body.snapshot, {
    status: 401,
    label: 'bad auth dry-run',
  });

  const malformedAuth = await postAuthenticated(server, '/dry-run', { plan: readyPlan }, {
    authorization: 'Basic not-valid-base64',
  });
  await assertFailureNoMutation(server, malformedAuth, initial.body.snapshot, {
    status: 401,
    label: 'malformed auth dry-run',
  });

  const insufficient = await postAuthenticated(
    server,
    '/dry-run',
    { plan: readyPlan },
    authHeaders(credentials.limited),
  );
  const insufficientCapabilityFeasible = insufficient.status === 403;
  await assertFailureNoMutation(server, insufficient, initial.body.snapshot, {
    status: insufficientCapabilityFeasible ? 403 : 401,
    code: insufficientCapabilityFeasible ? 'reprint_push_lab_forbidden' : 'reprint_push_lab_auth_required',
    label: 'insufficient capability dry-run',
  });

  const unsignedPreflight = await getAuthenticated(server, '/preflight', authHeaders(credentials.admin));
  await assertFailureNoMutation(server, unsignedPreflight, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_HEADER_REQUIRED',
    label: 'unsigned authenticated preflight',
  });

  const unsignedDryRun = await postAuthenticated(server, '/dry-run', { plan: readyPlan }, authHeaders(credentials.admin));
  await assertFailureNoMutation(server, unsignedDryRun, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_HEADER_REQUIRED',
    label: 'unsigned authenticated dry-run',
  });

  const unsignedApply = await postAuthenticated(server, '/apply', { plan: readyPlan, receipt: {} }, {
    ...authHeaders(credentials.admin),
    [idempotencyHeader]: 'auth-http-unsigned-apply',
  });
  await assertFailureNoMutation(server, unsignedApply, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_HEADER_REQUIRED',
    label: 'unsigned authenticated apply',
  });

  const malformedSignature = await signedGetAuthenticated(server, '/preflight', credentials.admin, {
    headerOverrides: {
      [authSignatureHeader]: 'not-a-valid-signature',
    },
  });
  await assertFailureNoMutation(server, malformedSignature, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
    label: 'malformed auth signature preflight',
  });

  const staleTimestamp = await signedGetAuthenticated(server, '/preflight', credentials.admin, {
    timestamp: String(Math.floor(Date.now() / 1000) - 601),
  });
  await assertFailureNoMutation(server, staleTimestamp, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_TIMESTAMP_INVALID',
    label: 'stale signed preflight',
  });

  const futureTimestamp = await signedGetAuthenticated(server, '/preflight', credentials.admin, {
    timestamp: String(Math.floor(Date.now() / 1000) + 601),
  });
  await assertFailureNoMutation(server, futureTimestamp, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_TIMESTAMP_INVALID',
    label: 'future signed preflight',
  });

  const wrongMethodSignature = await signedGetAuthenticated(server, '/preflight?z=2&a=1', credentials.admin, {
    signMethod: 'POST',
  });
  await assertFailureNoMutation(server, wrongMethodSignature, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
    label: 'wrong method signature preflight',
  });

  const wrongPathQuerySignature = await signedGetAuthenticated(server, '/preflight?z=2&a=1', credentials.admin, {
    signPathname: '/wp-json/reprint-push-lab/v1/authenticated/preflight?z=2&a=changed',
  });
  await assertFailureNoMutation(server, wrongPathQuerySignature, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
    label: 'wrong path query signature preflight',
  });

  const preflight = await signedGetAuthenticated(server, '/preflight', credentials.admin);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.ok, true);
  assert.equal(preflight.body.mode, 'preflight');
  assert.equal(preflight.body.auth.scope, authScope);
  assert.equal(preflight.body.auth.identity.userLogin, credentials.admin.username);
  assert.equal(preflight.body.auth.identity.capabilities.manage_options, true);
  assert.equal(preflight.body.auth.session.type, 'application-password-basic');
  assert.match(preflight.body.auth.session.verifier, /^playground-basic-/);
  assert.equal(preflight.body.auth.session.playgroundFallback, true);
  assert.match(preflight.body.auth.session.warning, /not production authentication/);
  assert.equal(preflight.body.session.type, 'lab-signed-push-session');
  assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
  assert.equal(preflight.body.session.receiptTtlSeconds, 300);
  assert.equal(preflight.body.limits.requiresIdempotencyKey, true);
  assert.equal(preflight.body.journal.dbJournal.available, true);
  const pushSession = preflight.body.session.id;
  summary.auth = {
    coreUsersMe: coreMe.status,
    coreApplicationPasswordAvailable,
    coreApplicationPasswordLimitation: coreApplicationPasswordAvailable
      ? null
      : 'Playground core REST did not establish Application Password auth for /wp-json/wp/v2/users/me; the lab route validates the stored Application Password and sets the WP user before capability checks.',
    preflight: preflight.status,
    user: preflight.body.auth.identity.userLogin,
    capability: 'manage_options',
    sessionType: preflight.body.auth.session.type,
    verifier: preflight.body.auth.session.verifier,
  };

  const authenticatedSnapshot = await getAuthenticated(server, '/snapshot', authHeaders(credentials.admin));
  assert.equal(authenticatedSnapshot.status, 200);
  assertSnapshotContentEqual(authenticatedSnapshot.body.snapshot, initial.body.snapshot, 'authenticated Basic snapshot');
  await assertNoMutation(server, initial.body.snapshot, 'authenticated Basic snapshot');

  const authenticatedJournal = await getAuthenticated(server, '/journal?limit=80', authHeaders(credentials.admin));
  assert.equal(authenticatedJournal.status, 200);
  await assertNoMutation(server, initial.body.snapshot, 'authenticated Basic journal');

  const authenticatedDbJournal = await getAuthenticated(server, '/db-journal?limit=80', authHeaders(credentials.admin));
  assert.equal(authenticatedDbJournal.status, 200);
  await assertNoMutation(server, initial.body.snapshot, 'authenticated Basic db-journal');

  const authenticatedDbJournalSchema = await getAuthenticated(server, '/db-journal/schema', authHeaders(credentials.admin));
  assert.equal(authenticatedDbJournalSchema.status, 200);
  await assertNoMutation(server, initial.body.snapshot, 'authenticated Basic db-journal schema');

  const authenticatedRecovery = await postAuthenticated(
    server,
    '/recovery/inspect',
    { plan: readyPlan, receipt: {} },
    authHeaders(credentials.admin),
  );
  assert.notEqual(authenticatedRecovery.status, 401);
  await assertNoMutation(server, initial.body.snapshot, 'authenticated Basic recovery inspect');

  const badBodyHash = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-bad-body-hash',
    contentHash: '0'.repeat(64),
  });
  await assertFailureNoMutation(server, badBodyHash, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_CONTENT_HASH_MISMATCH',
    label: 'bad body hash signed dry-run',
  });

  const signedBodyChanged = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-body-changed',
    signRawBody: JSON.stringify({ plan: readyPlan }),
    rawBody: JSON.stringify({ plan: readyPlan, changedAfterSigning: true }),
  });
  await assertFailureNoMutation(server, signedBodyChanged, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_CONTENT_HASH_MISMATCH',
    label: 'signed body changed after signing dry-run',
  });

  const wrongIdentitySession = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.altAdmin, {
    session: pushSession,
    idempotencyKey: 'auth-http-wrong-session-identity',
  });
  await assertFailureNoMutation(server, wrongIdentitySession, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_SESSION_BINDING_MISMATCH',
    label: 'wrong session identity dry-run',
  });

  const idempotencySignatureMismatch = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-idempotency-sent',
    signIdempotencyKey: 'auth-http-idempotency-signed',
  });
  await assertFailureNoMutation(server, idempotencySignatureMismatch, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
    label: 'signature idempotency key mismatch dry-run',
  });

  const publicRoutePathSignature = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-public-path-signed',
    signPathname: '/wp-json/reprint-push-lab/v1/dry-run',
  });
  await assertFailureNoMutation(server, publicRoutePathSignature, initial.body.snapshot, {
    status: 401,
    code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
    label: 'public route signed path on authenticated dry-run',
  });

  const dryRunBefore = await getSnapshot(server);
  const dryRun = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-ready-dry-run',
  });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.equal(dryRun.body.applied, 0);
  assert.ok(dryRun.body.receipt?.receiptHash, 'authenticated dry-run receipt hash missing');
  assertAuthenticatedReceipt(dryRun.body.receipt, dryRun.body.auth, readyPlan);
  await assertNoMutation(server, dryRunBefore.body.snapshot, 'authenticated dry-run');
  readyReceipt = dryRun.body.receipt;

  const missingKey = await postAuthenticated(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    signedRequestHeaders(
      credentials.admin,
      'POST',
      '/wp-json/reprint-push-lab/v1/authenticated/apply',
      JSON.stringify({ plan: readyPlan, receipt: readyReceipt }),
      { session: pushSession },
    ),
  );
  await assertFailureNoMutation(server, missingKey, dryRunBefore.body.snapshot, {
    status: 400,
    code: 'MISSING_IDEMPOTENCY_KEY',
    label: 'missing idempotency key apply',
  });

  const tamperedReceipt = await postAuthenticated(
    server,
    '/apply',
    {
      plan: readyPlan,
      receipt: mutateReceiptWithoutRehash(readyReceipt, (receipt) => {
        receipt.authBinding.scope = 'wrong-scope';
      }),
    },
    signedRequestHeaders(
      credentials.admin,
      'POST',
      '/wp-json/reprint-push-lab/v1/authenticated/apply',
      JSON.stringify({
        plan: readyPlan,
        receipt: mutateReceiptWithoutRehash(readyReceipt, (receipt) => {
          receipt.authBinding.scope = 'wrong-scope';
        }),
      }),
      { session: pushSession, idempotencyKey: 'auth-http-tampered-receipt' },
    ),
  );
  await assertFailureNoMutation(server, tamperedReceipt, dryRunBefore.body.snapshot, {
    status: 409,
    code: 'AUTH_RECEIPT_MISMATCH',
    label: 'tampered authenticated receipt apply',
    journalEvent: 'auth-receipt-mismatch',
  });

  const expiredReceipt = await postAuthenticated(
    server,
    '/apply',
    {
      plan: readyPlan,
      receipt: mutateReceipt(readyReceipt, (receipt) => {
        receipt.authBinding.expiresAt = '2000-01-01T00:00:00Z';
      }),
    },
    signedRequestHeaders(
      credentials.admin,
      'POST',
      '/wp-json/reprint-push-lab/v1/authenticated/apply',
      JSON.stringify({
        plan: readyPlan,
        receipt: mutateReceipt(readyReceipt, (receipt) => {
          receipt.authBinding.expiresAt = '2000-01-01T00:00:00Z';
        }),
      }),
      { session: pushSession, idempotencyKey: 'auth-http-expired-receipt' },
    ),
  );
  await assertFailureNoMutation(server, expiredReceipt, dryRunBefore.body.snapshot, {
    status: 409,
    code: 'AUTH_RECEIPT_EXPIRED',
    label: 'expired authenticated receipt apply',
    journalEvent: 'auth-receipt-mismatch',
  });

  const altPreflight = await signedGetAuthenticated(server, '/preflight', credentials.altAdmin);
  assert.equal(altPreflight.status, 200);
  assert.match(altPreflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
  const identityMismatch = await signedPostAuthenticated(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    credentials.altAdmin,
    {
      session: altPreflight.body.session.id,
      idempotencyKey: 'auth-http-identity-mismatch',
    },
  );
  await assertFailureNoMutation(server, identityMismatch, dryRunBefore.body.snapshot, {
    status: 409,
    code: 'AUTH_RECEIPT_MISMATCH',
    label: 'receipt identity mismatch apply',
    journalEvent: 'auth-receipt-mismatch',
  });

  const applyBody = { plan: readyPlan, receipt: readyReceipt };
  const applyBefore = await getSnapshot(server);
  assertSnapshotContentEqual(applyBefore.body.snapshot, snapshots.base, 'authenticated apply before HTTP snapshot');
  const applyNonce = nextSignedNonce('auth-http-ready-apply');
  const applyTimestamp = currentSignedTimestamp();
  const apply = await signedPostAuthenticated(server, '/apply', applyBody, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-ready-apply',
    nonce: applyNonce,
    timestamp: applyTimestamp,
  });
  assert.equal(apply.status, 200);
  assert.equal(apply.body.ok, true);
  assert.equal(apply.body.mode, 'apply');
  assert.equal(apply.body.applied, readyPlan.mutations.length);
  assert.equal(apply.body.idempotency?.freshMutationWork, true);
  assert.equal(apply.body.auth.identity.userLogin, credentials.admin.username);

  const applyAfter = await getAuthenticated(server, '/snapshot', authHeaders(credentials.admin));
  assert.equal(applyAfter.status, 200);
  assertVisibleSurfaceEqual(applyAfter.body.snapshot, readyLocalSnapshot, 'authenticated apply final HTTP snapshot');
  assertAppliedHashes(readyPlan, applyAfter.body.snapshot);
  assertAppliedFixtureValues(applyAfter.body.snapshot);

  const journalAfterApply = await getDbJournalEntries(server);
  const mutationEventsAfterApply = countJournalEvents(journalAfterApply, 'mutation-applied');
  assert.equal(mutationEventsAfterApply, readyPlan.mutations.length);
  assert.ok(journalAfterApply.some((entry) => entry.event === 'apply-committed'), 'DB journal missing apply-committed');

  const nonceReplay = await signedPostAuthenticated(server, '/apply', applyBody, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-ready-apply',
    nonce: applyNonce,
    timestamp: applyTimestamp,
  });
  assert.equal(nonceReplay.status, 409);
  assert.equal(nonceReplay.body.code, 'SIGNED_NONCE_REPLAYED');
  const journalAfterNonceReplay = await getDbJournalEntries(server);
  assert.equal(
    countJournalEvents(journalAfterNonceReplay, 'mutation-applied'),
    mutationEventsAfterApply,
    'signed nonce replay added mutation work',
  );

  const replay = await signedPostAuthenticated(server, '/apply', applyBody, credentials.admin, {
    session: pushSession,
    idempotencyKey: 'auth-http-ready-apply',
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  const replayAfter = await getSnapshot(server);
  assertVisibleSurfaceEqual(replayAfter.body.snapshot, readyLocalSnapshot, 'authenticated replay final HTTP snapshot');
  const journalAfterReplay = await getDbJournalEntries(server);
  assert.equal(
    countJournalEvents(journalAfterReplay, 'mutation-applied'),
    mutationEventsAfterApply,
    'authenticated idempotency replay added mutation work',
  );

  summary.routes = {
    index: 'GET /wp-json/',
    preflight: 'GET /wp-json/reprint-push-lab/v1/authenticated/preflight',
    dryRun: 'POST /wp-json/reprint-push-lab/v1/authenticated/dry-run',
    apply: 'POST /wp-json/reprint-push-lab/v1/authenticated/apply',
    snapshot: 'GET /wp-json/reprint-push-lab/v1/authenticated/snapshot',
    journal: 'GET /wp-json/reprint-push-lab/v1/authenticated/journal?limit=80',
    dbJournal: 'GET /wp-json/reprint-push-lab/v1/authenticated/db-journal?limit=80',
    dbJournalSchema: 'GET /wp-json/reprint-push-lab/v1/authenticated/db-journal/schema',
    recovery: 'POST /wp-json/reprint-push-lab/v1/authenticated/recovery/inspect',
  };
  summary.negative = {
    missingSnapshotAuth: { status: missingSnapshotAuth.status, code: missingSnapshotAuth.body.code },
    missingJournalAuth: { status: missingJournalAuth.status, code: missingJournalAuth.body.code },
    missingDbJournalAuth: { status: missingDbJournalAuth.status, code: missingDbJournalAuth.body.code },
    missingDbJournalSchemaAuth: { status: missingDbJournalSchemaAuth.status, code: missingDbJournalSchemaAuth.body.code },
    missingRecoveryAuth: { status: missingRecoveryAuth.status, code: missingRecoveryAuth.body.code },
    missingAuth: { status: missingAuth.status, code: missingAuth.body.code },
    forgedInternalAuth: {
      snapshot: { status: forgedSnapshotAuth.status, code: forgedSnapshotAuth.body.code },
      preflight: { status: forgedPreflightAuth.status, code: forgedPreflightAuth.body.code },
      dryRun: {
        status: forgedDryRunAuth.status,
        code: forgedDryRunAuth.body.code,
        receiptMinted: Boolean(forgedDryRunAuth.body.receipt),
      },
      apply: { status: forgedApplyAuth.status, code: forgedApplyAuth.body.code },
    },
    badAuth: { status: badAuth.status, code: badAuth.body.code },
    malformedAuth: { status: malformedAuth.status, code: malformedAuth.body.code },
    insufficientCapability: {
      status: insufficient.status,
      code: insufficient.body.code,
      feasible: insufficientCapabilityFeasible,
      limitation: insufficientCapabilityFeasible
        ? null
        : 'Playground did not establish the bootstrapped limited Application Password identity; request remained non-mutating at auth-required before capability checks.',
    },
    tamperedReceipt: { status: tamperedReceipt.status, code: tamperedReceipt.body.code },
    expiredReceipt: { status: expiredReceipt.status, code: expiredReceipt.body.code },
    identityMismatch: { status: identityMismatch.status, code: identityMismatch.body.code },
    missingIdempotencyKey: { status: missingKey.status, code: missingKey.body.code },
    unsignedSignedRoutes: {
      preflight: { status: unsignedPreflight.status, code: unsignedPreflight.body.code },
      dryRun: { status: unsignedDryRun.status, code: unsignedDryRun.body.code },
      apply: { status: unsignedApply.status, code: unsignedApply.body.code },
    },
    malformedSignature: { status: malformedSignature.status, code: malformedSignature.body.code },
    badBodyHash: { status: badBodyHash.status, code: badBodyHash.body.code },
    signedBodyChanged: { status: signedBodyChanged.status, code: signedBodyChanged.body.code },
    staleTimestamp: { status: staleTimestamp.status, code: staleTimestamp.body.code },
    futureTimestamp: { status: futureTimestamp.status, code: futureTimestamp.body.code },
    wrongMethodSignature: { status: wrongMethodSignature.status, code: wrongMethodSignature.body.code },
    wrongPathQuerySignature: { status: wrongPathQuerySignature.status, code: wrongPathQuerySignature.body.code },
    wrongIdentitySession: { status: wrongIdentitySession.status, code: wrongIdentitySession.body.code },
    idempotencySignatureMismatch: {
      status: idempotencySignatureMismatch.status,
      code: idempotencySignatureMismatch.body.code,
    },
    publicRoutePathSignature: { status: publicRoutePathSignature.status, code: publicRoutePathSignature.body.code },
    nonceReplayBeforeIdempotencyReplay: { status: nonceReplay.status, code: nonceReplay.body.code },
  };
  summary.dryRun = {
    status: dryRun.status,
    receiptHash: dryRun.body.receipt.receiptHash,
    authBound: true,
    nonMutating: true,
  };
  summary.apply = {
    status: apply.status,
    applied: apply.body.applied,
    freshMutationWork: apply.body.idempotency?.freshMutationWork,
    finalMatchesLocal: digest(visibleSurface(applyAfter.body.snapshot)) === digest(visibleSurface(readyLocalSnapshot)),
  };
  summary.replay = {
    status: replay.status,
    replayed: replay.body.idempotency?.replayed,
    freshMutationWork: replay.body.idempotency?.freshMutationWork,
    mutationEventsAfterApply,
    mutationEventsAfterReplay: countJournalEvents(journalAfterReplay, 'mutation-applied'),
  };
});

assert.ok(readyReceipt, 'authenticated ready dry-run receipt was not captured');

await withPlaygroundServer('authenticated-stale-remote', path.join(repoRoot, fixtures.remoteChanged), async (server) => {
  summary.transport.servers.push(server.summary);

  const staleBefore = await getSnapshot(server);
  assertSnapshotContentEqual(staleBefore.body.snapshot, snapshots.remoteChanged, 'stale before HTTP snapshot');
  const stalePreflight = await signedGetAuthenticated(server, '/preflight', credentials.admin);
  assert.equal(stalePreflight.status, 200);
  const staleDryRun = await signedPostAuthenticated(server, '/dry-run', { plan: readyPlan }, credentials.admin, {
    session: stalePreflight.body.session.id,
    idempotencyKey: 'auth-http-stale-dry-run',
  });
  assert.equal(staleDryRun.status, 412);
  assert.equal(staleDryRun.body.ok, false);
  assert.equal(staleDryRun.body.code, 'PRECONDITION_FAILED');
  const staleAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(staleAfter.body.snapshot, staleBefore.body.snapshot, 'authenticated stale failed dry-run target surface');
  assertVisibleSurfaceNotEqual(staleAfter.body.snapshot, readyLocalSnapshot, 'authenticated stale failure preserved drifted state');
  await assertNoIdempotencyClaim(server, 'authenticated stale failed dry-run');

  summary.stale = {
    route: 'POST /wp-json/reprint-push-lab/v1/authenticated/dry-run',
    status: staleDryRun.status,
    code: staleDryRun.body.code,
    preservedFixture: staleAfter.body.snapshot.meta.fixture,
    finalMatchesLocal: digest(visibleSurface(staleAfter.body.snapshot)) === digest(visibleSurface(readyLocalSnapshot)),
  };
});

console.log(JSON.stringify(summary, null, 2));

function exportSnapshot(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.admin.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.admin.password,
      REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_USER: credentials.altAdmin.username,
      REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_APP_PASSWORD: credentials.altAdmin.password,
      REPRINT_PUSH_LAB_AUTH_LIMITED_USER: credentials.limited.username,
      REPRINT_PUSH_LAB_AUTH_LIMITED_APP_PASSWORD: credentials.limited.password,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  let listenerCheck;
  try {
    await waitForServer(child, baseUrl, logs);
    listenerCheck = assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return {
    name,
    port,
    baseUrl,
    child,
    logs,
    summary: {
      name,
      baseUrl,
      port,
      listenerCheck,
      stopped: false,
    },
  };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
  server.summary.stopped = true;
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);

    function onExit() {
      clearTimeout(timer);
      resolve();
    }

    child.once('exit', onExit);
  });
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assertLocalhostListener(port) {
  const result = spawnSync('ss', ['-H', '-ltn', 'sport', '=', `:${port}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      tool: 'ss',
      status: 'skipped',
      reason: (result.stderr || result.stdout || 'ss command unavailable').trim(),
    };
  }

  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, `No listener found for Playground port ${port}`);

  for (const line of lines) {
    const fields = line.split(/\s+/);
    const localAddress = fields[3] || '';
    assert.ok(
      localAddress === `127.0.0.1:${port}` || localAddress === `[127.0.0.1]:${port}`,
      `Playground listener must be 127.0.0.1 only, got: ${line}`,
    );
  }

  return {
    tool: 'ss',
    status: 'checked',
    listeners: lines,
  };
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

async function isPortAccepting(port) {
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

async function routeIndex(server) {
  return requestJson(server, 'GET', '/wp-json/');
}

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getDbJournalEntries(server) {
  const response = await getLab(server, '/db-journal?limit=80');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  return response.body.dbJournal?.latestRows || [];
}

async function getLab(server, pathSuffix) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function getAuthenticated(server, pathSuffix, headers = {}) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1/authenticated${pathSuffix}`, undefined, headers);
}

async function postAuthenticated(server, pathSuffix, body, headers = {}) {
  return requestJson(server, 'POST', `/wp-json/reprint-push-lab/v1/authenticated${pathSuffix}`, body, headers);
}

async function signedGetAuthenticated(server, pathSuffix, credential, options = {}) {
  const pathname = `/wp-json/reprint-push-lab/v1/authenticated${pathSuffix}`;
  return requestJsonRaw(
    server,
    'GET',
    pathname,
    undefined,
    signedRequestHeaders(credential, 'GET', pathname, '', options),
  );
}

async function signedPostAuthenticated(server, pathSuffix, body, credential, options = {}) {
  const pathname = `/wp-json/reprint-push-lab/v1/authenticated${pathSuffix}`;
  const rawBody = options.rawBody ?? JSON.stringify(body);
  const signRawBody = options.signRawBody ?? rawBody;
  return requestJsonRaw(
    server,
    'POST',
    pathname,
    rawBody,
    signedRequestHeaders(credential, 'POST', pathname, signRawBody, options),
  );
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  return requestJsonRaw(
    server,
    method,
    pathname,
    body === undefined ? undefined : JSON.stringify(body),
    headers,
  );
}

async function requestJsonRaw(server, method, pathname, rawBody = undefined, headers = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: rawBody === undefined ? headers : {
      'content-type': 'application/json',
      ...headers,
    },
    body: rawBody,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

function signedRequestHeaders(credential, method, pathname, rawBody, options = {}) {
  const contentHash = options.contentHash ?? sha256Hex(rawBody);
  const timestamp = options.timestamp ?? currentSignedTimestamp();
  const nonce = options.nonce ?? nextSignedNonce('auth-http');
  const signingKey = labSigningKey(credential);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = pushCanonicalString({
    method: options.signMethod ?? method,
    pathname: options.signPathname ?? pathname,
    contentHash,
    session: options.signSession ?? options.session ?? '',
    idempotencyKey: options.signIdempotencyKey ?? options.idempotencyKey ?? '',
  });
  const headers = {
    ...authHeaders(credential),
    [authContentHashHeader]: contentHash,
    [authTimestampHeader]: timestamp,
    [authNonceHeader]: nonce,
    [authSignatureHeader]: options.authSignature ?? hmacHex(signingKey, authString),
    [pushSignatureHeader]: options.pushSignature ?? hmacHex(signingKey, canonical),
  };

  if (options.session !== undefined) {
    headers[sessionHeader] = options.session;
  }
  if (options.idempotencyKey !== undefined) {
    headers[idempotencyHeader] = options.idempotencyKey;
  }

  return {
    ...headers,
    ...(options.headerOverrides ?? {}),
  };
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    canonicalQuery(rawQuery),
    contentHash,
    session,
    idempotencyKey,
  ].join('\n');
}

function canonicalQuery(query) {
  if (query === '') {
    return '';
  }

  return query
    .split('&')
    .map((part, index) => {
      if (part === '') {
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
    .sort((a, b) => {
      if (a.key !== b.key) {
        return a.key < b.key ? -1 : 1;
      }
      if (a.value !== b.value) {
        return a.value < b.value ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((pair) => `${rawUrlEncode(pair.key)}=${rawUrlEncode(pair.value)}`)
    .join('&');
}

function rawUrlDecodeQueryPart(value) {
  return decodeURIComponent(value.replace(/\+/g, '%20'));
}

function rawUrlEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function labSigningKey(credential) {
  return hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function currentSignedTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function nextSignedNonce(prefix) {
  signedNonceCounter += 1;
  return `${prefix}-${Date.now()}-${signedNonceCounter}-${randomBytes(6).toString('hex')}`;
}

function authHeaders(credential) {
  return {
    authorization: basicAuth(credential.username, credential.password),
  };
}

function forgedAuthQuery(pathSuffix) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(forgedAuthContext)) {
    params.set(`reprint_push_lab_auth[${key}]`, String(value));
  }
  return `${pathSuffix}?${params.toString()}`;
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint-push-lab/v1') || routeKeys.some((route) => route.startsWith('/reprint-push-lab/v1')),
    'REST index does not expose reprint-push-lab/v1',
  );
}

async function assertFailureNoMutation(server, response, expectedSnapshot, { status, code, label, journalEvent }) {
  assert.equal(response.status, status, `${label} HTTP status: ${JSON.stringify(response.body)}`);
  if (code) {
    assert.equal(response.body.code, code, `${label} error code`);
  }
  if (journalEvent) {
    assertJournalEvent(response.body, journalEvent);
  }
  assert.notEqual(response.body.code, 'OK', `${label} must fail`);
  await assertNoIdempotencyClaim(server, label);
  await assertNoMutation(server, expectedSnapshot, label);
}

async function assertNoIdempotencyClaim(server, label) {
  const entries = await getDbJournalEntries(server);
  assert.equal(
    entries.some((entry) => entry.event === 'idempotency-opened'),
    false,
    `${label} created an idempotency claim`,
  );
}

async function assertNoMutation(server, expectedSnapshot, label) {
  const after = await getSnapshot(server);
  assertTargetSurfaceEqual(after.body.snapshot, expectedSnapshot, `${label} target surface`);
}

function assertAuthenticatedReceipt(receipt, auth, plan) {
  assert.equal(receipt.mode, 'dry-run');
  assert.equal(receipt.authBinding?.scope, authScope);
  assert.equal(receipt.authBinding.identity.userLogin, auth.identity.userLogin);
  assert.equal(receipt.authBinding.identity.userId, auth.identity.userId);
  assert.equal(receipt.authBinding.identity.capabilities.manage_options, true);
  assert.equal(receipt.authBinding.session.type, 'application-password-basic');
  assert.equal(receipt.authBinding.session.applicationPasswordUuid, auth.session.applicationPasswordUuid);
  assert.equal(receipt.authBinding.session.credentialHash, auth.session.credentialHash);
  assert.equal(receipt.authBinding.request.restNamespace, 'reprint-push-lab/v1');
  assert.equal(receipt.authBinding.request.dryRunRoute, '/authenticated/dry-run');
  assert.equal(receipt.authBinding.request.planPayloadHash, digest(plan));
  assert.equal(receipt.authBinding.preconditions.preconditionSetHash, receipt.preconditionSetHash);
  assert.equal(receipt.authBinding.preconditions.mutationSetHash, receipt.mutationSetHash);
  assert.equal(receipt.authBinding.preconditions.mutationCount, plan.mutations.length);
  assert.ok(Date.parse(receipt.authBinding.expiresAt) > Date.now(), 'auth receipt should not be expired');

  const withoutHash = JSON.parse(JSON.stringify(receipt));
  const receiptHash = withoutHash.receiptHash;
  delete withoutHash.receiptHash;
  assert.equal(digest(withoutHash), receiptHash, 'auth-bound receipt hash mismatch');
}

function mutateReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
}

function mutateReceiptWithoutRehash(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  return next;
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertSnapshotContentEqual(actual, expected, label) {
  assert.deepEqual(snapshotContent(actual), snapshotContent(expected), `${label} content mismatch`);
  assert.equal(digest(snapshotContent(actual)), digest(snapshotContent(expected)), `${label} content digest mismatch`);
}

function snapshotContent(snapshot) {
  return {
    meta: {
      source: snapshot.meta.source,
      fixture: snapshot.meta.fixture,
      table_prefix: snapshot.meta.table_prefix,
    },
    ...visibleSurface(snapshot),
  };
}

function assertTargetSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
}

function assertVisibleSurfaceNotEqual(actual, expected, label) {
  assert.notEqual(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function assertReadyPlanResources(plan) {
  const expectedReadyKeys = [
    'file:wp-content/uploads/reprint-push/local-only.txt',
    'file:wp-content/uploads/reprint-push/shared.txt',
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_posts","ID:1001"]',
    'row:["wp_posts","ID:2001"]',
  ];
  const readyKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  assert.deepEqual(readyKeys, [...expectedReadyKeys].sort(), 'ready mutations should match fixture-scoped resources');
}

function assertTargetHashes(plan, snapshot, preconditionHashField, label) {
  for (const precondition of plan.preconditions) {
    assert.equal(
      resourceHash(snapshot, precondition.resource),
      precondition[preconditionHashField],
      `${label}: ${precondition.resourceKey}`,
    );
  }
}

function assertAppliedHashes(plan, snapshot) {
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      mutation.localHash,
      `applied hash mismatch for ${mutation.resourceKey}`,
    );
  }
}

function assertAppliedFixtureValues(snapshot) {
  assert.equal(snapshot.meta.fixture, 'remote-base');

  const sharedPost = postByTitle(snapshot, 'Shared base post');
  assert.equal(sharedPost.post_content, 'Local edited content');
  assert.equal(sharedPost.post_status, 'publish');

  const localPost = postByTitle(snapshot, 'Local-only draft');
  assert.equal(localPost.post_content, 'Created locally after pull');
  assert.equal(localPost.post_status, 'draft');

  assert.equal(snapshot.files['wp-content/uploads/reprint-push/shared.txt'], 'local upload content');
  assert.equal(snapshot.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');
}

function postByTitle(snapshot, title) {
  const entry = Object.values(snapshot.db.wp_posts).find((row) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return entry;
}

function assertJournalEvent(result, event) {
  assert.equal(result.journal?.event, event, `expected current journal event ${event}`);
  assert.ok(Array.isArray(result.journal?.recent), 'missing bounded journal evidence');
  assert.ok(
    result.journal.recent.some((entry) => entry.event === event),
    `journal recent entries missing ${event}`,
  );
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => entry.event === event).length;
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  while (logs.join('').length > 20_000) {
    logs.shift();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
