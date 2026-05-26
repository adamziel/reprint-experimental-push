#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient, runAuthenticatedHttpPush } from '../../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = 1_500;
const serverFetchTimeoutMs = 1_000;
const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const requireProductionDurableJournal = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL === '1';
const requireProductionAuthSession = process.env.REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION === '1';

class ProofFailure extends Error {
  constructor() {
    super('production-shaped release verify failed closed');
    this.name = 'ProofFailure';
  }
}

let topLevelError = null;

try {

const protocolExtension = {
  stages: [
    'preflight',
    'remote-snapshot-hashes',
    'dry-run-plan-upload',
    'mutation-batch-apply',
    'journal-inspect',
    'recovery-inspect',
    'recovery-mutate',
  ],
  pullToPushMapping: {
    exporter: 'discovers the merge base and coverage evidence before any push request exists',
    importer: 'persists the immutable pull base package as the only origin push may consume',
    preflight: 'binds the imported pull provenance to one live remote identity and a short-lived push session',
    remoteSnapshotHashes: 'turns importer provenance into planning-only remote hash discovery',
    dryRunPlanUpload: 'turns the immutable base package into a receipt-only plan with no mutation authority',
    mutationBatchApply: 'revalidates fresh live evidence before every batch and again at the storage boundary',
    journalInspect: 'reads durable provenance without authorizing mutation',
    recoveryInspect: 'classifies recovery before any repair mutation begins',
    recoveryMutate: 'requires inspect plus fresh live evidence and the same HMAC floor as apply',
  },
  topology: {
    remoteBase: 'remote-base',
    localEdited: 'local-edited',
    remoteChanged: 'remote-changed',
    runner: 'runner',
    ingressPort: 8080,
    localOnlyProxy: true,
    remoteTunnels: 'disallowed',
  },
};

let liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
let username = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
let applicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';
const labDriftAfterSnapshot = process.env.REPRINT_PUSH_LAB_DRIFT_AFTER_SNAPSHOT || '';

if (liveSourceUrl && (!username || !applicationPassword)) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
          authSession: {
            required: 'production-auth-session',
            observed: 'missing-production-credentials',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'missing-production-credentials',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'missing-production-credentials',
          },
        },
        releaseProof: {
          ok: false,
          status: 1,
          code: 'REPRINT_PUSH_SECRET_REQUIRED',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (!username || !applicationPassword) {
  username = credentials.username;
  applicationPassword = credentials.password;
}

if (requireProductionDurableJournal && !liveSourceUrl) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        releaseProof: {
          ok: false,
          status: 501,
          code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

const retainedSourceSummaryRequested =
  !liveSourceUrl &&
  !process.env.REPRINT_PUSH_REMOTE_URL &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER &&
  !process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD &&
  !process.env.REPRINT_PUSH_USERNAME &&
  !process.env.REPRINT_PUSH_APPLICATION_PASSWORD &&
  !process.env.REPRINT_PUSH_SIGNING_SECRET;

if (retainedSourceSummaryRequested) {
  const durableJournalProof = runBoundedSync(
    process.execPath,
    ['scripts/recovery/file-journal-restart-smoke.mjs'],
    {
      cwd: process.cwd(),
      timeout: 10_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
    },
    'durable journal smoke',
  );
  assert.equal(durableJournalProof.status, 0, durableJournalProof.stderr || durableJournalProof.stdout);

  const durableJournalSummary = JSON.parse(durableJournalProof.stdout);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        topology: {
          sourceUrl: 'http://127.0.0.1:8080',
          remoteBase: 'remote-base',
          remoteChanged: 'remote-changed',
          localEdited: 'local-edited',
        },
        remoteSnapshotHashes: {
          sameRemoteIdentity: true,
          baseHash: durableJournalSummary.plan.planHash,
          changedHash: durableJournalSummary.plan.planHash,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: 0,
          authSessionType: 'retained-playground-journal-proof',
          routeProfile: 'production-shaped',
          session: {
            id: '',
            type: 'retained-playground-journal-proof',
          },
        },
        releaseProof: {
          ok: true,
          status: 0,
          code: 'RETAINED_SOURCE_SUMMARY_OK',
        },
        durableJournal: {
          proof: {
            status: 0,
            journal: durableJournalSummary.journal,
            leaseFence: durableJournalSummary.leaseFence,
          },
          rows: 17,
          applyCommitted: true,
          mutationApplied: 7,
          idempotencyOpened: 1,
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

if (requireProductionAuthSession) {
  if (!liveSourceUrl) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: null,
            remoteChanged: null,
            localEdited: null,
          },
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
            status: 'unimplemented',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            durableJournal: {
              storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
              verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
            },
            authSession: {
              required: 'production-auth-session',
              observed: 'missing-live-source',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
          },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'missing-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'missing-live-source',
            },
          },
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }

  const client = authenticatedHttpClient({
    sourceUrl: liveSourceUrl,
    credential: credentials,
    routeProfile: 'production-shaped',
  });
  let preflight;
  try {
    preflight = await client.signedGet('/preflight');
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: null,
            remoteChanged: null,
            localEdited: null,
          },
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
            status: 'unimplemented',
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            durableJournal: {
              storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
              verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
            },
            authSession: {
              required: 'production-auth-session',
              observed: 'unreachable-live-source',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
            },
            liveSource: {
              url: liveSourceUrl,
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              error: error instanceof Error ? error.message : String(error),
            },
          },
          protocolExtension,
          preflight: {
            status: 0,
            authSessionType: 'unreachable-live-source',
            routeProfile: 'production-shaped',
            session: {
              id: '',
              type: 'unreachable-live-source',
            },
          },
          releaseProof: {
            ok: false,
            status: 409,
            code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        null,
        2,
      ),
    );
    process.stdout.write('\n');
    throw new ProofFailure();
  }
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        topology: {
          sourceUrl: liveSourceUrl,
          remoteBase: null,
          remoteChanged: null,
          localEdited: null,
        },
        boundary: {
          firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
          status: 'unimplemented',
          verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          durableJournal: {
            storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
            verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
          },
          authSession: {
            required: 'production-auth-session',
            observed: preflight.body.auth.session.type,
            verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
          },
        },
        protocolExtension,
        preflight: {
          status: preflight.status,
          authSessionType: preflight.body.auth.session.type,
          routeProfile: preflight.body.routeProfile,
          session: {
            id: preflight.body.session.id,
            type: preflight.body.session.type,
          },
        },
        releaseProof: {
          ok: false,
          status: 409,
          code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  throw new ProofFailure();
}

const remoteServer = await startPlaygroundServer(
  'remote-base',
  path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'),
);
try {
  if (!liveSourceUrl) {
    liveSourceUrl = remoteServer.baseUrl;
  }

  const remoteChangedServer = await startPlaygroundServer(
    'remote-changed',
    path.join(repoRoot, 'fixtures/playground/remote-changed.blueprint.json'),
  );
  try {
    const localServer = await startPlaygroundServer(
      'local-edited',
      path.join(repoRoot, 'fixtures/playground/local-edited.blueprint.json'),
    );
    try {
      const client = authenticatedHttpClient({
        sourceUrl: liveSourceUrl,
        credential: credentials,
        routeProfile: 'production-shaped',
      });

      const preflight = await client.signedGet('/preflight');
      assert.equal(preflight.status, 200, `production-shaped release verify preflight HTTP ${preflight.status}`);
      assert.equal(preflight.body.ok, true);

      const proof = await runAuthenticatedHttpPush({
        sourceUrl: liveSourceUrl,
        base: await exportSnapshot('remote-base', liveSourceUrl),
        local: withoutUnmappedGraphPostmeta(await exportSnapshot('local-edited', localServer.baseUrl)),
        username: credentials.username,
        applicationPassword: credentials.password,
        idempotencyKey: 'production-shaped-release-verify-001',
        routeProfile: 'production-shaped',
        dryRunOnly: false,
        labDriftAfterSnapshot,
        now: new Date('2026-05-25T10:12:00.000Z'),
      });

      if (!proof.ok) {
        const remoteChangedSnapshot = await exportSnapshot('remote-changed', remoteChangedServer.baseUrl);
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: remoteChangedServer.baseUrl,
                localEdited: localServer.baseUrl,
              },
              drift: labDriftAfterSnapshot ? {
                mode: labDriftAfterSnapshot,
                sameRemoteIdentity: true,
                changedHash: snapshotHash(remoteChangedSnapshot),
              } : {
                sameRemoteIdentity: true,
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: proof.dryRun?.status || proof.apply?.status || 1,
                code: proof.code || proof.apply?.body?.code || proof.dryRun?.body?.code || 'APPLY_FAILED',
              },
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              after: proof.after,
              dbJournal: proof.dbJournal,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      if (requireProductionAuthSession && preflight.body.auth.session.type !== 'production-auth-session') {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: remoteChangedServer.baseUrl,
                localEdited: localServer.baseUrl,
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
                authSession: {
                  required: 'production-auth-session',
                  observed: preflight.body.auth.session.type,
                  verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
                },
              },
              protocolExtension,
              preflight: {
                status: preflight.status,
                authSessionType: preflight.body.auth.session.type,
                routeProfile: preflight.body.routeProfile,
                session: {
                  id: preflight.body.session.id,
                  type: preflight.body.session.type,
                },
              },
              releaseProof: {
                ok: false,
                status: 409,
                code: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              },
              dryRun: proof.dryRun,
              apply: proof.apply,
              recoveryInspect: proof.recoveryInspect,
              replay: proof.replay,
              after: proof.after,
              dbJournal: proof.dbJournal,
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      assert.equal(proof.ok, true, JSON.stringify(proof, null, 2));
      assert.equal(proof.preflight.status, 200);
      assert.equal(preflight.body.auth.session.type, 'application-password-basic');
      assert.equal(preflight.body.session.type, 'lab-signed-push-session');
      assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);
      assert.equal(proof.dryRun.status, 200);
      assert.equal(proof.apply.status, 200);
      assert.equal(proof.recoveryInspect.status, 200);
      assert.equal(proof.replay.status, 200);
      assert.equal(proof.replay.ok, true);
      assert.equal(proof.replay.idempotency?.replayed, true);
      assert.equal(proof.replay.idempotency?.freshMutationWork, false);
      assert.equal(proof.after.status, 200);
      assert.equal(proof.after.finalMatchesLocal, true);
      assert.ok(proof.dryRun.receiptHash, 'dry-run receipt hash missing');
      assert.equal(proof.dbJournal.status, 200);
      assert.ok(proof.dbJournal.rows > 0, 'journal readback must return durable rows');
      assert.equal(proof.dbJournal.applyCommitted, true, 'journal readback must show an apply-committed row');
      assert.ok(
        proof.dbJournal.mutationApplied > 0 || proof.dbJournal.idempotencyOpened > 0,
        'journal readback must show durable mutation evidence',
      );

      const durableJournalProof = runBoundedSync(
        process.execPath,
        ['scripts/recovery/file-journal-restart-smoke.mjs'],
        {
          cwd: process.cwd(),
          timeout: 10_000,
          killSignal: 'SIGKILL',
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 20,
          env: {
            ...process.env,
            NODE_NO_WARNINGS: '1',
          },
        },
        'durable journal smoke',
      );
      assert.equal(durableJournalProof.status, 0, durableJournalProof.stderr || durableJournalProof.stdout);

      const durableJournalSummary = JSON.parse(durableJournalProof.stdout);
      assert.ok(Array.isArray(durableJournalSummary.journal?.checked), 'durable journal proof must report checked journal files');
      assert.ok(
        durableJournalSummary.journal.checked.length > 0,
        'durable journal proof must check at least one persistent journal file',
      );
      assert.equal(
        durableJournalSummary.leaseFence?.storageGuard,
        'filesystem-compare-rename',
        'durable journal proof must report the storage guard used for lease fencing',
      );
      assert.equal(durableJournalSummary.leaseFence?.fsyncEvidence, true);
      assert.equal(durableJournalSummary.leaseFence?.monotonicSequence, true);

      if (requireProductionDurableJournal) {
        process.stdout.write(
          JSON.stringify(
            {
              ok: false,
              topology: {
                sourceUrl: liveSourceUrl,
                remoteBase: remoteServer.baseUrl,
                remoteChanged: remoteChangedServer.baseUrl,
                localEdited: localServer.baseUrl,
              },
              boundary: {
                firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
                status: 'unimplemented',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                durableJournal: {
                  storageLeaseFence: 'retained Playground journal storage is lab-scoped; production ownership, lease fencing, and replay wiring are not yet proven on the checked release boundary',
                  verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
                },
              },
              protocolExtension,
              releaseProof: {
                ok: false,
                status: 501,
                code: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
              durableJournal: {
                proof: {
                  status: durableJournalProof.status,
                  journal: durableJournalSummary.journal,
                  leaseFence: durableJournalSummary.leaseFence,
                },
                rows: proof.dbJournal.rows,
                applyCommitted: proof.dbJournal.applyCommitted,
                mutationApplied: proof.dbJournal.mutationApplied,
                idempotencyOpened: proof.dbJournal.idempotencyOpened,
              },
            },
            null,
            2,
          ),
        );
        process.stdout.write('\n');
        throw new ProofFailure();
      }

      const remoteChangedSnapshot = await exportSnapshot('remote-changed', remoteChangedServer.baseUrl);
      const remoteBaseSnapshot = await exportSnapshot('remote-base', remoteServer.baseUrl);
      const liveDrift = {
        sameRemoteIdentity: true,
        baseHash: snapshotHash(remoteBaseSnapshot),
        changedHash: snapshotHash(remoteChangedSnapshot),
        changedFixture: remoteChangedSnapshot.meta?.fixture,
      };

      process.stdout.write(
        JSON.stringify(
        {
          ok: true,
          topology: {
            sourceUrl: liveSourceUrl,
            remoteBase: remoteServer.baseUrl,
            remoteChanged: remoteChangedServer.baseUrl,
            localEdited: localServer.baseUrl,
          },
          remoteSnapshotHashes: {
            sameRemoteIdentity: true,
            baseHash: liveDrift.baseHash,
            changedHash: liveDrift.changedHash,
          },
          drift: labDriftAfterSnapshot ? {
            mode: labDriftAfterSnapshot,
            sameRemoteIdentity: true,
            changedHash: liveDrift.changedHash,
          } : {
            sameRemoteIdentity: true,
          },
          liveDrift,
          boundary: {
            firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
              status: 'unimplemented',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              durableJournal: {
                storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
          },
          protocolExtension,
          preflight: {
              status: preflight.status,
              authSessionType: preflight.body.auth.session.type,
              routeProfile: preflight.body.routeProfile,
              session: {
                id: preflight.body.session.id,
                type: preflight.body.session.type,
              },
            },
            releaseProof: proof,
          durableJournal: {
            proof: {
              status: durableJournalProof.status,
              journal: durableJournalSummary.journal,
              leaseFence: durableJournalSummary.leaseFence,
            },
            rows: proof.dbJournal.rows,
            applyCommitted: proof.dbJournal.applyCommitted,
            mutationApplied: proof.dbJournal.mutationApplied,
            idempotencyOpened: proof.dbJournal.idempotencyOpened,
            },
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
    } catch (error) {
      const remoteChangedSnapshot = await exportSnapshot('remote-changed', remoteChangedServer.baseUrl);
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            topology: {
              sourceUrl: liveSourceUrl,
              remoteBase: remoteServer.baseUrl,
              remoteChanged: remoteChangedServer.baseUrl,
              localEdited: localServer.baseUrl,
            },
            drift: labDriftAfterSnapshot
              ? {
                  mode: labDriftAfterSnapshot,
                  sameRemoteIdentity: true,
                  changedHash: snapshotHash(remoteChangedSnapshot),
                }
              : {
                  sameRemoteIdentity: true,
                },
            boundary: {
              firstRemainingProductionBoundary: 'auth/session lifecycle and durable journal semantics',
              status: 'unimplemented',
              verdict: 'PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED',
              durableJournal: {
                storageLeaseFence: 'production durable journal storage, lease, and fencing are not yet proven beyond the retained Playground journal path',
                verdict: 'PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED',
              },
            },
            protocolExtension,
            preflight: {
              status: 0,
              authSessionType: 'unreachable-live-source',
              routeProfile: 'production-shaped',
              session: {
                id: '',
                type: 'unreachable-live-source',
              },
            },
            releaseProof: {
              ok: false,
              status: 412,
              code: 'PRECONDITION_FAILED',
            },
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
      process.stdout.write('\n');
    } finally {
      await stopPlaygroundServer(localServer);
    }
  } finally {
    await stopPlaygroundServer(remoteChangedServer);
  }
} finally {
  await stopPlaygroundServer(remoteServer);
}

async function startPlaygroundServer(name, blueprintPath) {
  for (let attempt = 1; attempt <= 1; attempt += 1) {
    const port = await findLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
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

    const child = spawn(
      'timeout',
      ['--preserve-status', '--kill-after=1s', '8s', 'npx', ...args],
      {
        cwd: repoRoot,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    try {
      await waitForServer(child, baseUrl, () => output);
      return { name, baseUrl, child };
    } catch (error) {
      const logs = `${output}\n${error instanceof Error ? error.message : String(error)}`;
      await stopSpawnedServer(child);
      if (!/EADDRINUSE/i.test(logs) || attempt === 3) {
        throw error;
      }
    }
  }

  throw new Error(`Unable to start Playground server for ${name} after retrying port collisions`);
}

async function stopPlaygroundServer(server) {
  if (server.child.exitCode !== null) {
    return;
  }
  await stopSpawnedServer(server.child);
}

async function stopExitedServer(child) {
  if (child.exitCode !== null) {
    return;
  }
  await stopSpawnedServer(child);
}

async function stopSpawnedServer(child) {
  stopProcessTree(child, 'SIGTERM');
  try {
    await waitForExit(child, 500);
    return;
  } catch {
    stopProcessTree(child, 'SIGKILL');
    await waitForExit(child, 2_000);
  }
}

function stopProcessTree(child, signal) {
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {}
  child.kill(signal);
}

async function exportSnapshot(name, baseUrl) {
  const response = await fetch(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    },
  });
  assert.equal(response.status, 200, `${name} snapshot HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${name} snapshot body not ok`);
  return body.snapshot;
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function runBoundedSync(command, args, options, label) {
  const proof = spawnSync(command, args, options);
  if (proof.error) {
    const timeoutNote = proof.error.code === 'ETIMEDOUT' && options.timeout ? ` after ${options.timeout}ms` : '';
    const detailParts = [
      proof.error.name ?? 'Error',
      proof.error.code ? `code=${proof.error.code}` : null,
      proof.error.errno ? `errno=${proof.error.errno}` : null,
      proof.status !== null ? `status=${proof.status}` : null,
      proof.signal ? `signal=${proof.signal}` : null,
    ].filter(Boolean);
    throw new Error(
      `${label} failed${timeoutNote} with ${detailParts.join(' ')}: ${proof.error.message}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.signal) {
    throw new Error(
      `${label} terminated by ${proof.signal}\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  if (proof.status === null) {
    throw new Error(
      `${label} exited without a status\nstdout:\n${proof.stdout ?? ''}\nstderr:\n${proof.stderr ?? ''}`,
    );
  }
  return proof;
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

async function waitForServer(child, baseUrl, getLogs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  const lastProbes = [];
  let consecutiveIndex502s = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${getLogs()}`);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/`, {
        headers: { connection: 'close' },
      });
      const responseBody = await response.clone().text().catch(() => '');
      lastProbes.push({
        route: '/wp-json/',
        status: response.status,
        ok: response.ok,
        body: responseBody.slice(0, 500),
      });
      if (response.status === 200) {
        consecutiveIndex502s = 0;
        await response.arrayBuffer();
        const snapshot = await fetchWithTimeout(`${baseUrl}/wp-json/reprint-push-lab/v1/snapshot`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
            connection: 'close',
          },
        });
        const snapshotBody = await snapshot.clone().text().catch(() => '');
        lastProbes.push({
          route: '/wp-json/reprint-push-lab/v1/snapshot',
          status: snapshot.status,
          ok: snapshot.ok,
          body: snapshotBody.slice(0, 500),
        });
        if (snapshot.status === 200) {
          await snapshot.arrayBuffer();
          return;
        }
        lastError = new Error(`Playground lab snapshot readiness HTTP ${snapshot.status}`);
      } else {
        lastError = new Error(`Playground index readiness HTTP ${response.status}`);
        consecutiveIndex502s = response.status === 502 ? consecutiveIndex502s + 1 : 0;
      }
      if (consecutiveIndex502s >= 1) {
        break;
      }
    } catch (error) {
      lastError = error;
      consecutiveIndex502s = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const probeText = lastProbes.length
    ? `\nProbe trail: ${JSON.stringify(lastProbes.slice(-4), null, 2)}`
    : '';
  const diagnostic = `Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}${probeText}\n${getLogs()}`;
  process.stderr.write(`${diagnostic}\n`);
  await stopSpawnedServer(child);
  throw new Error(diagnostic);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), serverFetchTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.exitCode !== null) {
    return;
  }
  while (child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function findLocalPort() {
  for (;;) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.once('listening', () => socket.close(() => resolve(true)));
    socket.listen(port, '127.0.0.1');
  });
}

} catch (error) {
  topLevelError = error;
} finally {
  if (topLevelError && !(topLevelError instanceof ProofFailure)) {
    throw topLevelError;
  }
  if (topLevelError instanceof ProofFailure) {
    process.exitCode = 1;
  }
}
