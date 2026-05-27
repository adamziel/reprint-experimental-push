#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { digest } from '../../src/stable-json.js';
import {
  loadAuthSessionSource,
  resolveAuthSessionSourceCredentials,
} from './auth-session-source.js';
import {
  packagedProductionPluginClassifyBoundedStartup,
  packagedProductionPluginClassifyTimeoutFallbackStartup,
  packagedProductionPluginMalformedTerminalIndexProbe,
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  packagedProductionPluginNextRouteNotReadyProbeCounts,
  packagedProductionPluginNextTimeoutProbeCount,
  packagedProductionPluginNotReadyProbeLimitReached,
  packagedProductionPluginPackagedRouteStartupLimitReached,
  packagedProductionPluginPreflightTerminalContext,
  packagedProductionPluginPreflightReady,
  packagedProductionPluginPreflightRetryable,
  packagedProductionPluginReadinessBodyRetryable,
  packagedProductionPluginReadinessErrorRetryable,
  packagedProductionPluginReadinessProbeTimedOut,
  packagedProductionPluginResetRouteNotReadyProbeCounts,
  packagedProductionPluginServerReady,
  packagedProductionPluginSnapshotRetryable,
} from './packaged-production-plugin-readiness.js';
import { loadBlueprintSnapshotFixture } from './blueprint-snapshot-fixture.js';
import { resolvePackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/reprint-push-lab.js');
// The packaged plugin route can stay startup-shaped longer than the earlier
// single-server smoke budget because it must boot WordPress, mount the packaged
// plugin, and clear signed preflight readiness. Keep the smoke aligned with the
// packaged release verifier so it does not fail early on the same bounded
// readiness path.
const serverStartupTimeoutMs = 45_000;
const readinessProbeIntervalMs = 200;
const readinessProbeFetchTimeoutMs = 3_000;
const readinessFailureBodyLimit = 500;
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const snapshotExportTimeoutMs = 45_000;
const maxPackagedStartupNotReadyProbeCount = Math.max(
  packagedProductionPluginMaxConsecutiveNotReadyProbes,
  Math.ceil(serverStartupTimeoutMs / readinessProbeIntervalMs),
);
const maxPackagedRouteStartupAfterGlobalReadyProbes = packagedProductionPluginMaxConsecutiveNotReadyProbes;
let signedRequestNonceSequence = 0;

const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
  applicationPassword: 'reprint-push-admin-app-password',
};
const authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const authSessionSource = authSessionSourceCommand ? loadAuthSessionSource(authSessionSourceCommand) : null;
const resolvedCredentials = resolveAuthSessionSourceCredentials(credentials, authSessionSource, {
  preferSource: true,
});
const packagedAuthSessionSourceCommand = resolvePackagedProductionPluginSourceCommand({
  sourceUrl: resolvedCredentials.liveSourceUrl || 'http://127.0.0.1:8080',
  username: resolvedCredentials.username,
  applicationPassword: resolvedCredentials.applicationPassword,
  authSessionSourceCommand,
});

const alternateCredentials = {
  username: 'reprint_push_alt_admin',
  password: 'reprint-push-alt-admin-app-password',
};

const unscopedCredentials = {
  username: 'reprint_push_unscoped_admin',
  password: 'reprint-push-unscoped-app-password',
};

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);
const packageLocalSnapshot = withoutUnmappedGraphPostmeta(snapshots.local);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-production-plugin-package-'));
const packageRoot = path.join(tmpDir, 'package');
const pluginDir = path.join(packageRoot, 'reprint-push');
const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');

try {
  writeStageProgress('building packaged plugin fixture');
  buildPluginPackage(pluginDir);
  writeStageProgress('writing packaged activation blueprint');
  writeActivationBlueprint(path.join(repoRoot, fixtures.base), blueprintPath);
  fs.writeFileSync(basePath, `${JSON.stringify(snapshots.base, null, 2)}\n`);
  fs.writeFileSync(localPath, `${JSON.stringify(packageLocalSnapshot, null, 2)}\n`);

  const summary = {
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      copiedFiles: fs.readdirSync(path.join(pluginDir, 'includes')).sort(),
    },
    routes: {},
    cli: {},
    final: {},
  };

  await withPlaygroundServer('production-plugin-package', blueprintPath, pluginDir, async (server) => {
    const index = await requestJson(server.baseUrl, 'GET', '/wp-json/');
    assert.equal(index.status, 200);
    assertRouteNamespace(index.body);

    const labRoute = await requestJson(server.baseUrl, 'GET', '/wp-json/reprint-push-lab/v1/snapshot');
    assert.equal(labRoute.status, 404);
    assert.equal(labRoute.body.code, 'rest_no_route');

    const unprovisionedAlternatePreflight = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/preflight',
      undefined,
      signedHeadersForPreflight(alternateCredentials),
    );
    assert.equal(unprovisionedAlternatePreflight.status, 401);
    assert.equal(unprovisionedAlternatePreflight.body.code, 'reprint_push_lab_auth_required');

    const unscopedPreflight = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/preflight',
      undefined,
      signedHeadersForPreflight(unscopedCredentials),
    );
    assert.equal(unscopedPreflight.status, 401);
    assert.equal(unscopedPreflight.body.code, 'reprint_push_lab_auth_required');

    const preflight = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/preflight',
      undefined,
      signedHeadersForPreflight(),
    );
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
    assert.equal(preflight.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(preflight.body.routeProfile.labBacked, false);
    assert.match(preflight.body.routeProfile.warning, /production deployment mode rather than the local Playground lab harness/i);
    assert.equal(preflight.body.auth.session.credentialScope, 'reprint-push-lab:authenticated-http-push');
    assert.equal(preflight.body.auth.session.credentialType, 'push-application-password');
    assert.equal(preflight.body.auth.session.type, 'production-auth-session');
    assert.equal(preflight.body.auth.session.warning, null);
    assertSignedStoreCleanup(preflight.body.sessionStore?.cleanup);

    const dbJournalSchema = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/db-journal/schema',
      undefined,
      authHeaders(),
    );
    assert.equal(dbJournalSchema.status, 200);
    assert.equal(dbJournalSchema.body.ok, true);
    assert.match(dbJournalSchema.body.dbJournalSchema.scope, /packaged production plugin journal surface/i);

    const dbJournal = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/db-journal?limit=1',
      undefined,
      signedHeadersForRequest('GET', '/wp-json/reprint/v1/push/db-journal?limit=1', {
        session: preflight.body.session.id,
        idempotencyKey: 'production-plugin-package-journal-inspect',
      }),
    );
    assert.equal(dbJournal.status, 200);
    assert.equal(dbJournal.body.ok, true);
    assert.match(
      dbJournal.body.dbJournal.scope,
      /(packaged production plugin journal surface|checked live production-shaped journal surface)/i,
    );

    const result = runCli([
      'push-authenticated',
      '--base',
      basePath,
      '--local',
      localPath,
      '--source-url',
      resolvedCredentials.liveSourceUrl || server.baseUrl,
      '--username',
      resolvedCredentials.username,
      '--application-password',
      resolvedCredentials.applicationPassword,
      '--idempotency-key',
      'production-plugin-package-apply',
      '--route-profile',
      'production-shaped',
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.source.namespace, 'reprint/v1');
    assert.equal(result.source.routePrefix, '/push');
    assert.equal(result.apply.status, 200);
    assert.equal(result.apply.applied, result.plan.mutations);
    assert.equal(result.apply.idempotency.freshMutationWork, true);
    assert.equal(result.dbJournal.applyCommitted, true);
    assert.equal(result.after.finalMatchesLocal, true);

    const after = await requestJson(
      server.baseUrl,
      'GET',
      '/wp-json/reprint/v1/push/snapshot',
      undefined,
      authHeaders(),
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.ok, true);
    assertVisibleSurfaceEqual(after.body.snapshot, packageLocalSnapshot, 'packaged plugin final source');

    summary.routes = {
      namespace: preflight.body.routeProfile.restNamespace,
      labNamespaceDisabled: labRoute.status === 404,
      profile: preflight.body.routeProfile.profile,
      authBootstrapDisabled: true,
      unprovisionedAlternateStatus: unprovisionedAlternatePreflight.status,
      unscopedApplicationPasswordStatus: unscopedPreflight.status,
      credentialScope: preflight.body.auth.session.credentialScope,
      signedStoreCleanup: {
        deletedExpiredTotal: preflight.body.sessionStore.cleanup.deletedExpiredTotal,
        sessionsDeleted: preflight.body.sessionStore.cleanup.sessionOptions.deletedExpired,
        noncesDeleted: preflight.body.sessionStore.cleanup.nonceOptions.deletedExpired,
      },
    };
    summary.cli = {
      ok: result.ok,
      namespace: result.source.namespace,
      applied: result.apply.applied,
      applyCommitted: result.dbJournal.applyCommitted,
      authSessionSource: {
        command: packagedAuthSessionSourceCommand,
        ok: Boolean(authSessionSource?.ok),
      },
    };
    summary.final = {
      finalMatchesLocal: result.after.finalMatchesLocal,
      visibleSurfaceHash: digest(visibleSurface(after.body.snapshot)),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function buildPluginPackage(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'plugins/reprint-push'), targetDir, { recursive: true });
  const includesDir = path.join(targetDir, 'includes');
  fs.mkdirSync(includesDir, { recursive: true });
  for (const file of [
    'push-remote-rest-plugin.php',
    'push-remote-lib.php',
    'push-db-journal-lib.php',
    'snapshot-lib.php',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts/playground', file),
      path.join(includesDir, file),
    );
  }
}

function withoutUnmappedGraphPostmeta(snapshot) {
  const next = JSON.parse(JSON.stringify(snapshot));
  delete next.db?.wp_postmeta?.['post_id:2001:meta_key:_reprint_push_forms_schema'];
  if (next.db?.wp_postmeta && Object.keys(next.db.wp_postmeta).length === 0) {
    delete next.db.wp_postmeta;
  }
  return next;
}

function writeActivationBlueprint(sourceBlueprintPath, targetBlueprintPath) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Production Plugin Package',
    description: 'Remote base fixture with the packaged Reprint Push plugin activated.',
  };
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$stable_uuid = static function (string $seed): string { $hex = md5($seed); return substr($hex, 0, 8) . \'-\' . substr($hex, 8, 4) . \'-\' . substr($hex, 12, 4) . \'-\' . substr($hex, 16, 4) . \'-\' . substr($hex, 20, 12); };',
      "$login = 'reprint_push_unscoped_admin';",
      "$app_password = 'reprint-push-unscoped-app-password';",
      "$slug = 'unscoped-admin';",
      '$user_id = wp_insert_user(array(\'user_login\' => $login, \'user_pass\' => wp_generate_password(32, true, true), \'user_email\' => sanitize_user($login, true) . \'@example.test\', \'display_name\' => $login, \'role\' => \'administrator\'));',
      'if (is_wp_error($user_id)) { throw new RuntimeException($user_id->get_error_message()); }',
      '$uuid = $stable_uuid(\'reprint-push-unscoped-\' . $slug);',
      '$app_id = $stable_uuid(\'reprint-push-unscoped-app-\' . $slug);',
      '$items = get_user_meta($user_id, \'_application_passwords\', true);',
      '$items = is_array($items) ? array_values($items) : array();',
      '$items[] = array(\'uuid\' => $uuid, \'app_id\' => $app_id, \'name\' => \'Unscoped Application Password\', \'password\' => wp_hash_password(preg_replace(\'/[^a-zA-Z0-9]/\', \'\', $app_password)), \'created\' => time(), \'last_used\' => null, \'last_ip\' => null);',
      'update_user_meta($user_id, \'_application_passwords\', $items);',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      "require_once ABSPATH . 'wp-admin/includes/plugin.php';",
      "$result = activate_plugin('reprint-push/reprint-push.php');",
      'if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$result = reprint_push_lab_rest_provision_push_application_password(array(\'login\' => \'reprint_push_admin\', \'appPassword\' => \'reprint-push-admin-app-password\', \'role\' => \'administrator\', \'slug\' => \'primary-admin\', \'name\' => \'Reprint Push Package Smoke\', \'createUser\' => true, \'updateRole\' => true));',
      'if (empty($result[\'ok\'])) { throw new RuntimeException((string) ($result[\'message\'] ?? \'push credential provisioning failed\')); }',
    ].join(' '),
  });
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$past = 1;',
      '$future = 2147483647;',
      '$expired_session_id = str_repeat(\'a\', 64);',
      '$cleanup_expired_session_id = str_repeat(\'e\', 64);',
      '$future_session_id = str_repeat(\'b\', 64);',
      '$expired_nonce = str_repeat(\'c\', 64);',
      '$future_nonce = str_repeat(\'d\', 64);',
      "add_option('reprint_push_lab_signed_session_' . hash('sha256', $expired_session_id), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_session_' . hash('sha256', $cleanup_expired_session_id), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'cleanup-expired-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_session_' . hash('sha256', $future_session_id), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . hash('sha256', $expired_nonce), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-nonce'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . hash('sha256', $future_nonce), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-nonce'), '', 'no');",
      '$expired_session = reprint_push_lab_rest_signed_session(str_repeat(\'a\', 64));',
      '$future_session = reprint_push_lab_rest_signed_session(str_repeat(\'b\', 64));',
      'if (!is_null($expired_session)) { throw new RuntimeException(\'expired signed session must not be reusable\'); }',
      'if (!is_array($future_session) || (string) ($future_session[\'fixture\'] ?? \'\') !== \'future-session\') { throw new RuntimeException(\'unexpired signed session must remain reusable\'); }',
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function runCli(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  assert.equal(
    result.status,
    expectStatus,
    `CLI status mismatch\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CLI did not return JSON\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${error.message}`);
  }
}

function exportSnapshot(name, blueprintPath) {
  const expectedFixture = path.basename(blueprintPath).replace(/\.blueprint\.json$/u, '');
  const trackedSnapshot = loadBlueprintSnapshotFixture(expectedFixture, blueprintPath);
  if (trackedSnapshot) {
    writeStageProgress(`using tracked snapshot fixture for ${name}`);
    return trackedSnapshot;
  }

  writeStageProgress(`exporting snapshot fixture for ${name}`);
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
    timeout: snapshotExportTimeoutMs,
    killSignal: 'SIGTERM',
  });

  if (result.error) {
    const timeoutNote = result.error.code === 'ETIMEDOUT'
      ? ` after ${snapshotExportTimeoutMs}ms`
      : '';
    throw new Error(
      `Playground snapshot export failed for ${name}${timeoutNote}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${result.error.message}`,
    );
  }

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

async function withPlaygroundServer(name, blueprintPath, mountedPluginDir, run) {
  writeStageProgress(`starting packaged Playground server ${name}`);
  const server = await startPlaygroundServer(name, blueprintPath, mountedPluginDir);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath, mountedPluginDir) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const logs = [];
    const child = spawn('npx', [
      '--yes',
      '@wp-playground/cli@latest',
      'server',
      '--blueprint',
      blueprintPath,
      '--mount',
      `${mountedPluginDir}:/wordpress/wp-content/plugins/reprint-push`,
      '--site-url',
      baseUrl,
      '--port',
      String(port),
      '--workers',
      '1',
      '--verbosity',
      'quiet',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
        REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
        REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.password,
        NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => pushLog(logs, chunk));
    child.stderr.on('data', (chunk) => pushLog(logs, chunk));

    try {
      await waitForServer(child, baseUrl, logs);
      return { name, port, baseUrl, child, logs };
    } catch (error) {
      await stopChildProcess(child);
      const combinedLogs = logs.join('');
      if (!/EADDRINUSE/i.test(combinedLogs) || attempt === 3) {
        throw error;
      }
    }
  }

  throw new Error(`Unable to start Playground server for ${name} after retrying port collisions`);
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  let lastProbe = null;
  const lastProbes = [];
  let lastTimeoutFallbackProbes = null;
  let notReadyProbeCounts = { snapshot: 0, preflight: 0 };
  let timeoutProbeCount = 0;
  const readinessPhases = new Set();
  const noteReadinessPhase = (phase, message) => {
    if (readinessPhases.has(phase)) {
      return;
    }
    readinessPhases.add(phase);
    writeStageProgress(message);
  };

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const exitLabel = child.exitCode !== null
        ? `exited early with ${child.exitCode}`
        : `terminated by ${child.signalCode}`;
      throw new Error(
        formatPackagedReadinessFailure(
          `Playground server ${exitLabel}`,
          lastError,
          lastProbes,
          logs,
          lastTimeoutFallbackProbes,
        ),
      );
    }

    try {
      noteReadinessPhase('snapshot', `probing packaged snapshot readiness at ${baseUrl}`);
      const { response: snapshotResponse, bodyText: snapshotText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/snapshot`, {
        method: 'GET',
        headers: {
          connection: 'close',
          ...authHeaders(),
        },
      }, readinessProbeFetchTimeoutMs, child);
      timeoutProbeCount = 0;
      // A successful snapshot fetch supersedes any older timeout-fallback
      // probes; later failures should describe the current readiness branch.
      lastTimeoutFallbackProbes = null;
      notReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'snapshot',
        snapshotResponse.status,
        snapshotText,
      );
      const snapshotNotReadyProbeCount = notReadyProbeCounts.snapshot;
      lastProbe = {
        route: '/wp-json/reprint/v1/push/snapshot',
        status: snapshotResponse.status,
        body: snapshotText.slice(0, readinessFailureBodyLimit),
      };
      lastProbes.push(lastProbe);
      let snapshotBody = null;
      try {
        snapshotBody = JSON.parse(snapshotText);
      } catch (error) {
        if (packagedProductionPluginReadinessBodyRetryable(snapshotResponse.status, snapshotText)) {
          lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshotResponse.status}`);
          noteReadinessPhase('preflight-fallback', `snapshot is still startup-shaped; probing signed preflight readiness at ${baseUrl}`);
          const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, {
            packagedStartup: true,
            snapshotProbe: {
              status: snapshotResponse.status,
              body: snapshotText,
            },
          });
          lastProbe = preflightProbe;
          lastProbes.push(preflightProbe);
          if (preflightProbe.ready) {
            return;
          }
          if (preflightProbe.terminal) {
            const malformedSnapshotFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            throw new Error(
              formatPackagedReadinessFailure(
                malformedSnapshotFallbackPreflightBody
                  ? `Packaged production plugin preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at ${baseUrl}`
                  : `Packaged production plugin preflight became terminal while snapshot still reported startup-shaped readiness at ${baseUrl}`,
                lastError,
                lastProbes,
                logs,
                packagedProductionPluginPreflightTerminalContext(
                  {},
                  { snapshotStartupFallback: true },
                ),
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child);
            lastProbe = indexProbe;
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshotResponse.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                throw new Error(
                  formatPackagedReadinessFailure(
                    `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                    lastError,
                    lastProbes,
                    logs,
                    {
                      packagedProductionPlugin: true,
                      packagedRouteStartup: true,
                      snapshotNotReadyProbeCount,
                    },
                    lastTimeoutFallbackProbes,
                  ),
                );
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                    : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  notReadyProbeCount: snapshotNotReadyProbeCount,
                  maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        lastError = error;
        throw new Error(
          formatPackagedReadinessFailure(
            `Packaged production plugin snapshot returned an invalid readiness body at ${baseUrl}`,
            lastError,
            lastProbes,
            logs,
            {
              packagedProductionPlugin: true,
            },
            lastTimeoutFallbackProbes,
          ),
        );
      }

      if (!packagedProductionPluginServerReady({ snapshot: { status: snapshotResponse.status, body: snapshotBody } })) {
        lastError = new Error(`Production plugin package snapshot readiness HTTP ${snapshotResponse.status}`);
        noteReadinessPhase('preflight-fallback', `snapshot is still startup-shaped; probing signed preflight readiness at ${baseUrl}`);
        const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, {
          packagedStartup: true,
          snapshotProbe: {
            status: snapshotResponse.status,
            body: snapshotText,
          },
        });
        lastProbe = preflightProbe;
        lastProbes.push(preflightProbe);
        if (preflightProbe.ready) {
          return;
        }
        if (packagedProductionPluginSnapshotRetryable({ status: snapshotResponse.status, body: snapshotBody })) {
          if (
            preflightProbe.retryable
            && packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child);
            lastProbe = indexProbe;
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshotResponse.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                throw new Error(
                  formatPackagedReadinessFailure(
                    `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                    lastError,
                    lastProbes,
                    logs,
                    {
                      packagedProductionPlugin: true,
                      packagedRouteStartup: true,
                      snapshotNotReadyProbeCount,
                    },
                    lastTimeoutFallbackProbes,
                  ),
                );
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                    : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  notReadyProbeCount: snapshotNotReadyProbeCount,
                  maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (preflightProbe.retryable) {
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          if (preflightProbe.terminal) {
            const malformedSnapshotFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            throw new Error(
              formatPackagedReadinessFailure(
                malformedSnapshotFallbackPreflightBody
                  ? `Packaged production plugin preflight returned an invalid readiness body while snapshot still reported startup-shaped readiness at ${baseUrl}`
                  : `Packaged production plugin preflight became terminal while snapshot still reported startup-shaped readiness at ${baseUrl}`,
                lastError,
                lastProbes,
                logs,
                packagedProductionPluginPreflightTerminalContext(
                  {},
                  { snapshotStartupFallback: true },
                ),
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              snapshotNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child);
            lastProbe = indexProbe;
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: snapshotResponse.status,
                body: snapshotText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  snapshotNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                throw new Error(
                  formatPackagedReadinessFailure(
                    `Packaged production plugin snapshot stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                    lastError,
                    lastProbes,
                    logs,
                    {
                      packagedProductionPlugin: true,
                      packagedRouteStartup: true,
                      snapshotNotReadyProbeCount,
                    },
                    lastTimeoutFallbackProbes,
                  ),
                );
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                    : `Packaged production plugin snapshot stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${snapshotNotReadyProbeCount} consecutive response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                    snapshotNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(snapshotNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin snapshot hit the bounded readiness failure after ${snapshotNotReadyProbeCount} consecutive startup-shaped response${snapshotNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  notReadyProbeCount: snapshotNotReadyProbeCount,
                  maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'snapshot',
        );
        throw new Error(
          formatPackagedReadinessFailure(
            `Packaged production plugin snapshot returned a terminal readiness failure at ${baseUrl}`,
            lastError,
            lastProbes,
            logs,
            {
              packagedProductionPlugin: true,
            },
            lastTimeoutFallbackProbes,
          ),
        );
      }

      notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'snapshot',
      );
      noteReadinessPhase('preflight', `snapshot responded; probing signed preflight readiness at ${baseUrl}`);
      const { response: preflightResponse, bodyText: preflightText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
        method: 'GET',
        headers: {
          connection: 'close',
          ...signedHeadersForPreflight(),
        },
      }, readinessProbeFetchTimeoutMs, child);
      timeoutProbeCount = 0;
      notReadyProbeCounts = packagedProductionPluginNextRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'preflight',
        preflightResponse.status,
        preflightText,
      );
      const preflightNotReadyProbeCount = notReadyProbeCounts.preflight;
      lastProbe = {
        route: '/wp-json/reprint/v1/push/preflight',
        status: preflightResponse.status,
        body: preflightText.slice(0, readinessFailureBodyLimit),
      };
      lastProbes.push(lastProbe);
      let preflightBody = null;
      try {
        preflightBody = JSON.parse(preflightText);
      } catch (error) {
        if (packagedProductionPluginReadinessBodyRetryable(preflightResponse.status, preflightText)) {
          lastError = new Error(`Production plugin package preflight readiness HTTP ${preflightResponse.status}`);
          if (
            packagedProductionPluginRouteStartupClassificationReady(
              preflightNotReadyProbeCount,
            )
          ) {
            const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child);
            lastProbe = indexProbe;
            lastProbes.push(indexProbe);
            const startupBranch = packagedProductionPluginClassifyBoundedStartup(
              {
                retryable: true,
                status: preflightResponse.status,
                body: preflightText,
              },
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
                await sleepUnlessChildExit(readinessProbeIntervalMs, child);
                continue;
              }
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                    preflightNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              if (
                packagedProductionPluginPackagedRouteStartupLimitReached(
                  preflightNotReadyProbeCount,
                  maxPackagedRouteStartupAfterGlobalReadyProbes,
                )
              ) {
                throw new Error(
                  formatPackagedReadinessFailure(
                    `Packaged production plugin preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                    lastError,
                    lastProbes,
                    logs,
                    {
                      packagedProductionPlugin: true,
                      packagedRouteStartup: true,
                      preflightNotReadyProbeCount,
                    },
                    lastTimeoutFallbackProbes,
                  ),
                );
              }
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                    : `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                    preflightNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin preflight hit the bounded readiness failure after ${preflightNotReadyProbeCount} consecutive startup-shaped response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  notReadyProbeCount: preflightNotReadyProbeCount,
                  maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
        lastError = error;
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'preflight',
        );
        throw new Error(
          formatPackagedReadinessFailure(
            `Packaged production plugin preflight returned an invalid readiness body at ${baseUrl}`,
            lastError,
            lastProbes,
            logs,
            packagedProductionPluginPreflightTerminalContext({}),
            lastTimeoutFallbackProbes,
          ),
        );
      }

      if (packagedProductionPluginPreflightReady({ status: preflightResponse.status, body: preflightBody })) {
        notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
          notReadyProbeCounts,
          'preflight',
        );
        return;
      }

      lastError = new Error(`Production plugin package preflight readiness HTTP ${preflightResponse.status}`);
      const packagedPreflightReadinessContext = { packagedStartup: true };
      if (packagedProductionPluginPreflightRetryable(
        { status: preflightResponse.status, body: preflightBody },
        packagedPreflightReadinessContext,
      )) {
        if (
          packagedProductionPluginRouteStartupClassificationReady(
            preflightNotReadyProbeCount,
          )
        ) {
          const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child);
          lastProbe = indexProbe;
          lastProbes.push(indexProbe);
          // Once /wp-json/ is available, re-evaluate retryability against the
          // current startup signal instead of the broad packaged-startup hint.
          const preflightRetryableWithIndex = packagedProductionPluginPreflightRetryable(
            { status: preflightResponse.status, body: preflightBody },
            { indexProbe },
          );
          if (!preflightRetryableWithIndex) {
            notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
              notReadyProbeCounts,
              'preflight',
            );
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin preflight returned a terminal readiness failure at ${baseUrl}`,
                lastError,
                lastProbes,
                logs,
                packagedProductionPluginPreflightTerminalContext({}),
                lastTimeoutFallbackProbes,
              ),
            );
          }
          const startupBranch = packagedProductionPluginClassifyBoundedStartup(
            {
              retryable: true,
              status: preflightResponse.status,
              body: preflightText,
            },
            indexProbe,
          );
          if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
            if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
              await sleepUnlessChildExit(readinessProbeIntervalMs, child);
              continue;
            }
            throw new Error(
              formatPackagedReadinessFailure(
                `Packaged production plugin preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  globalWordPressStartup: true,
                  preflightNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
            if (
              packagedProductionPluginPackagedRouteStartupLimitReached(
                preflightNotReadyProbeCount,
                maxPackagedRouteStartupAfterGlobalReadyProbes,
              )
            ) {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe.status} for ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedRouteStartupAfterGlobalReadyProbes})`,
                  lastError,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                    preflightNotReadyProbeCount,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
          }
          if (startupBranch?.kind === 'retryable-route-index-terminal') {
            const malformedIndexBody =
              packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
            throw new Error(
              formatPackagedReadinessFailure(
                malformedIndexBody
                  ? `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`
                  : `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after ${preflightNotReadyProbeCount} consecutive response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
                lastError,
                lastProbes,
                logs,
                {
                  packagedProductionPlugin: true,
                  ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                  indexTerminal: true,
                  preflightNotReadyProbeCount,
                },
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (packagedProductionPluginGlobalStartupStillWithinBudget(preflightNotReadyProbeCount)) {
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          throw new Error(
            formatPackagedReadinessFailure(
              `Packaged production plugin preflight hit the bounded readiness failure after ${preflightNotReadyProbeCount} consecutive startup-shaped response${preflightNotReadyProbeCount === 1 ? '' : 's'} (limit ${maxPackagedStartupNotReadyProbeCount})`,
              lastError,
              lastProbes,
              logs,
              {
                packagedProductionPlugin: true,
                notReadyProbeCount: preflightNotReadyProbeCount,
                maxNotReadyProbeCount: maxPackagedStartupNotReadyProbeCount,
              },
              lastTimeoutFallbackProbes,
            ),
          );
        }
        await sleepUnlessChildExit(readinessProbeIntervalMs, child);
        continue;
      }
      notReadyProbeCounts = packagedProductionPluginResetRouteNotReadyProbeCounts(
        notReadyProbeCounts,
        'preflight',
      );
      throw new Error(
        formatPackagedReadinessFailure(
          `Packaged production plugin preflight returned a terminal readiness failure at ${baseUrl}`,
          lastError,
          lastProbes,
          logs,
          packagedProductionPluginPreflightTerminalContext({}),
          lastTimeoutFallbackProbes,
        ),
      );
    } catch (error) {
      if (!packagedProductionPluginReadinessErrorRetryable(error)) {
        throw error;
      }
      if (packagedProductionPluginReadinessProbeTimedOut(error)) {
        noteReadinessPhase('timeout-fallback', `snapshot probe timed out; falling back to signed preflight and /wp-json/ readiness probes at ${baseUrl}`);
        const { preflightProbe, indexProbe } = await fetchPackagedTimeoutFallbackProbes(
          baseUrl,
          child,
          { packagedStartup: true },
        );
        lastTimeoutFallbackProbes = { preflightProbe, indexProbe };
        if (preflightProbe) {
          lastProbe = preflightProbe;
          lastProbes.push(preflightProbe);
          if (preflightProbe.ready) {
            return;
          }
          if (preflightProbe.retryable) {
            const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup(
              preflightProbe,
              indexProbe,
            );
            if (startupBranch?.kind === 'retryable-route-wordpress-starting') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight stayed startup-shaped while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe?.status ?? 0} after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-packaged-route-starting') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight stayed startup-shaped after global WordPress startup HTTP ${indexProbe?.status ?? 0} while the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-index-timeout') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight stayed startup-shaped while /wp-json/ timed out after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    indexProbeTimedOut: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'retryable-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned an invalid readiness body after the snapshot probe timed out at ${baseUrl}`
                    : `Packaged production plugin preflight stayed startup-shaped while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe?.status ?? 0} after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            lastError = error;
            timeoutProbeCount = 0;
            await sleepUnlessChildExit(readinessProbeIntervalMs, child);
            continue;
          }
          if (preflightProbe.terminal) {
            const malformedTimeoutFallbackPreflightBody =
              preflightProbe.parsedBody === null
              && !packagedProductionPluginReadinessBodyRetryable(
                preflightProbe.status,
                preflightProbe.body || '',
              );
            throw new Error(
              formatPackagedReadinessFailure(
                malformedTimeoutFallbackPreflightBody
                  ? `Packaged production plugin preflight returned an invalid readiness body while the snapshot probe timed out at ${baseUrl}`
                  : `Packaged production plugin preflight became terminal while the snapshot probe timed out at ${baseUrl}`,
                error,
                lastProbes,
                logs,
                packagedProductionPluginPreflightTerminalContext(
                  {},
                  { timeoutFallback: true },
                ),
                lastTimeoutFallbackProbes,
              ),
            );
          }
          if (indexProbe) {
            const startupBranch = packagedProductionPluginClassifyTimeoutFallbackStartup(
              preflightProbe,
              indexProbe,
            );
            if (startupBranch?.kind === 'timed-out-route-wordpress-starting') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight probe timed out while /wp-json/ kept reporting global WordPress startup HTTP ${indexProbe.status} after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    globalWordPressStartup: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'timed-out-route-index-timeout') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight probe timed out while /wp-json/ also timed out after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    indexProbeTimedOut: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'timed-out-route-packaged-route-starting') {
              throw new Error(
                formatPackagedReadinessFailure(
                  `Packaged production plugin preflight probe timed out after global WordPress startup HTTP ${indexProbe.status} while the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    packagedRouteStartup: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
            if (startupBranch?.kind === 'timed-out-route-index-terminal') {
              const malformedIndexBody =
                packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
              throw new Error(
                formatPackagedReadinessFailure(
                  malformedIndexBody
                    ? `Packaged production plugin preflight probe timed out while /wp-json/ returned an invalid readiness body after the snapshot probe timed out at ${baseUrl}`
                    : `Packaged production plugin preflight probe timed out while /wp-json/ returned a terminal readiness failure HTTP ${indexProbe.status} after the snapshot probe timed out at ${baseUrl}`,
                  error,
                  lastProbes,
                  logs,
                  {
                    packagedProductionPlugin: true,
                    ...(malformedIndexBody ? { invalidReadinessBody: true } : {}),
                    indexTerminal: true,
                  },
                  lastTimeoutFallbackProbes,
                ),
              );
            }
          }
        }
        if (indexProbe) {
          lastProbe = indexProbe;
          lastProbes.push(indexProbe);
        }
        if (packagedProductionPluginReadinessBodyRetryable(indexProbe?.status, indexProbe?.body || '')) {
          lastError = error;
          timeoutProbeCount = 0;
          await sleepUnlessChildExit(readinessProbeIntervalMs, child);
          continue;
        }
      }
      lastError = error;
      timeoutProbeCount = packagedProductionPluginNextTimeoutProbeCount(timeoutProbeCount, error);
      if (
        packagedProductionPluginReadinessProbeTimedOut(error)
        && packagedProductionPluginNotReadyProbeLimitReached(timeoutProbeCount)
      ) {
        throw new Error(
          formatPackagedReadinessFailure(
            `Packaged production plugin readiness hit ${timeoutProbeCount} consecutive probe timeout${timeoutProbeCount === 1 ? '' : 's'}`,
            lastError,
            lastProbes,
            logs,
            {
              packagedProductionPlugin: true,
              timeoutProbeCount,
              maxTimeoutProbeCount: packagedProductionPluginMaxConsecutiveNotReadyProbes,
            },
            lastTimeoutFallbackProbes,
          ),
        );
      }
    }

    await sleepUnlessChildExit(readinessProbeIntervalMs, child);
  }

  throw new Error(
    formatPackagedReadinessFailure(
      `Timed out waiting for Playground server at ${baseUrl}`,
      lastError,
      lastProbes,
      logs,
      lastTimeoutFallbackProbes,
    ),
  );
}

function packagedProductionPluginGlobalStartupStillWithinBudget(notReadyProbeCount) {
  return !packagedProductionPluginNotReadyProbeLimitReached(
    notReadyProbeCount,
    maxPackagedStartupNotReadyProbeCount,
  );
}

function packagedProductionPluginRouteStartupClassificationReady(notReadyProbeCount) {
  return packagedProductionPluginNotReadyProbeLimitReached(
    notReadyProbeCount,
    maxPackagedRouteStartupAfterGlobalReadyProbes,
  );
}

function formatPackagedReadinessFailure(
  prefix,
  lastError,
  lastProbes,
  logs,
  context = null,
  lastTimeoutFallbackProbes = null,
) {
  // Older readiness branches passed timeout fallback probes as the fifth
  // argument. Preserve those diagnostics instead of misreporting them as
  // generic context.
  if (
    lastTimeoutFallbackProbes === null
    && context
    && typeof context === 'object'
    && ('preflightProbe' in context || 'indexProbe' in context)
  ) {
    lastTimeoutFallbackProbes = context;
    context = null;
  }
  const details = describePackagedReadinessFailure(
    lastProbes.at(-1) ?? null,
    lastTimeoutFallbackProbes,
    lastProbes,
    context,
  );
  const lastErrorText = lastError?.message ? `\nLast readiness error: ${lastError.message}` : '';
  return `${prefix}${lastErrorText}${details}\n${logs.join('')}`;
}

function describePackagedReadinessFailure(
  lastProbe,
  lastTimeoutFallbackProbes = null,
  lastProbes = [],
  context = null,
) {
  const parts = [];
  if (lastProbes.length > 0) {
    parts.push(describePackagedReadinessProbes(lastProbes));
  } else if (lastProbe !== null) {
    parts.push(
      `Last readiness probe route: ${lastProbe.route}\n`
      + `Last readiness probe status: ${lastProbe.status}\n`
      + `Last readiness probe body: ${JSON.stringify(lastProbe.body, null, 2)}`,
    );
  }

  if (lastTimeoutFallbackProbes?.preflightProbe) {
    parts.push(
      `Last timeout fallback preflight route: ${lastTimeoutFallbackProbes.preflightProbe.route}\n`
      + `Last timeout fallback preflight status: ${lastTimeoutFallbackProbes.preflightProbe.status}\n`
      + `Last timeout fallback preflight body: ${JSON.stringify(lastTimeoutFallbackProbes.preflightProbe.body, null, 2)}`,
    );
  }

  if (lastTimeoutFallbackProbes?.indexProbe) {
    parts.push(
      `Last timeout fallback index route: ${lastTimeoutFallbackProbes.indexProbe.route}\n`
      + `Last timeout fallback index status: ${lastTimeoutFallbackProbes.indexProbe.status}\n`
      + `Last timeout fallback index body: ${JSON.stringify(lastTimeoutFallbackProbes.indexProbe.body, null, 2)}`,
    );
  }

  if (context && typeof context === 'object' && Object.keys(context).length > 0) {
    parts.push(`Readiness context: ${JSON.stringify(context, null, 2)}`);
  }

  return parts.length === 0 ? '' : `\n${parts.join('\n')}`;
}

function describePackagedReadinessProbes(lastProbes) {
  return lastProbes.map((probe, index) =>
    `Readiness probe ${index + 1} route: ${probe.route}\n`
    + `Readiness probe ${index + 1} status: ${probe.status}\n`
    + `Readiness probe ${index + 1} body: ${JSON.stringify(probe.body, null, 2)}`,
  ).join('\n');
}

async function fetchPackagedWordPressIndexProbe(baseUrl, child = null) {
  const { response, bodyText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/`, {
    method: 'GET',
    headers: {
      connection: 'close',
    },
  }, readinessProbeFetchTimeoutMs, child);
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {}
  return {
    route: '/wp-json/',
    status: response.status,
    body: bodyText.slice(0, readinessFailureBodyLimit),
    parsedBody,
  };
}

async function fetchPackagedPreflightProbe(baseUrl, child = null, readinessContext = {}) {
  const { response, bodyText } = await fetchTextWithTimeout(`${baseUrl}/wp-json/reprint/v1/push/preflight`, {
    method: 'GET',
    headers: {
      connection: 'close',
      ...signedHeadersForPreflight(),
    },
  }, readinessProbeFetchTimeoutMs, child);

  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {}

  const probe = {
    route: '/wp-json/reprint/v1/push/preflight',
    status: response.status,
    body: bodyText.slice(0, readinessFailureBodyLimit),
    parsedBody: null,
    ready: false,
    retryable: false,
    terminal: false,
  };

  if (body !== null) {
    probe.parsedBody = body;
    probe.ready = packagedProductionPluginPreflightReady({ status: response.status, body });
    probe.retryable = packagedProductionPluginPreflightRetryable(
      { status: response.status, body },
      readinessContext,
    );
    probe.terminal = !probe.ready && !probe.retryable;
    return probe;
  }

  probe.retryable = packagedProductionPluginReadinessBodyRetryable(response.status, bodyText);
  probe.terminal = !probe.retryable;
  return probe;
}

async function fetchPackagedTimeoutFallbackProbes(baseUrl, child = null, readinessContext = {}) {
  const preflightProbe = await fetchPackagedPreflightProbe(baseUrl, child, readinessContext).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/reprint/v1/push/preflight', error),
  );
  const indexProbe = await fetchPackagedWordPressIndexProbe(baseUrl, child).catch((error) =>
    buildPackagedTimeoutFallbackProbe('/wp-json/', error),
  );
  if (preflightProbe && preflightProbe.ready !== true) {
    preflightProbe.retryable = packagedProductionPluginPreflightRetryable(
      {
        status: preflightProbe.status,
        body: preflightProbe.parsedBody ?? preflightProbe.body,
      },
      { ...readinessContext, indexProbe },
    );
    preflightProbe.terminal = !preflightProbe.retryable;
  }
  return { preflightProbe, indexProbe };
}

function buildPackagedTimeoutFallbackProbe(route, error) {
  if (!packagedProductionPluginReadinessProbeTimedOut(error)) {
    throw error;
  }

  return {
    route,
    status: 0,
    body: String(error?.message || error).slice(0, readinessFailureBodyLimit),
    ready: false,
    retryable: false,
    terminal: false,
    timedOut: true,
  };
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = readinessProbeFetchTimeoutMs, child = null) {
  const response = await fetchWithTimeout(url, init, timeoutMs, child);
  const bodyTextPromise = response.text();
  const childExitWatcher = createChildExitPromise(child, url);
  try {
    const bodyText = childExitWatcher
      ? await Promise.race([bodyTextPromise, childExitWatcher.promise])
      : await bodyTextPromise;
    return { response, bodyText };
  } finally {
    childExitWatcher?.cleanup();
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = readinessProbeFetchTimeoutMs, child = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), timeoutMs);
  const childExitWatcher = createChildExitWatcher(child, url, controller);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    childExitWatcher?.cleanup();
  }
}

function createChildExitWatcher(child, url, controller) {
  const childExitError = buildChildExitFetchError(child, url);
  if (!child) {
    return null;
  }

  const failForExit = () => {
    controller.abort(childExitError());
  };

  if (child.exitCode !== null || child.signalCode !== null) {
    failForExit();
    return { cleanup() {} };
  }

  const onExit = () => failForExit();
  const cleanup = () => {
    child.off('exit', onExit);
    child.off('close', onExit);
  };
  child.once('exit', onExit);
  child.once('close', onExit);
  return { cleanup };
}

function createChildExitPromise(child, url) {
  if (!child) {
    return null;
  }

  const childExitError = buildChildExitFetchError(child, url);
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      promise: Promise.reject(childExitError()),
      cleanup() {},
    };
  }

  let cleanup = () => {};
  const promise = new Promise((_, reject) => {
    const onExit = () => {
      cleanup();
      reject(childExitError());
    };
    cleanup = () => {
      child.off('exit', onExit);
      child.off('close', onExit);
    };
    child.once('exit', onExit);
    child.once('close', onExit);
  });
  return { promise, cleanup };
}

function buildChildExitFetchError(child, url) {
  return () => {
    const exitLabel = child.exitCode !== null
      ? `exited with ${child.exitCode}`
      : child.signalCode !== null
        ? `terminated by ${child.signalCode}`
        : 'terminated unexpectedly';
    const error = new Error(`Playground child ${exitLabel} while fetching ${url}`);
    error.isPlaygroundReadinessFailure = true;
    return error;
  };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) {
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

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
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

async function requestJson(baseUrl, method, pathname, body = undefined, headers = {}, { attempts = transientFetchAttempts } = {}) {
  let lastError;
  const retryable = method === 'GET';
  const maxAttempts = retryable ? attempts : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestJsonOnce(baseUrl, method, pathname, body, headers);
    } catch (error) {
      lastError = error;
      if (!retryable || !isTransientFetchError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(transientFetchRetryDelayMs * attempt);
    }
  }
  throw lastError;
}

async function requestJsonOnce(baseUrl, method, pathname, body = undefined, headers = {}) {
  const requestHeaders = body === undefined ? {
    connection: 'close',
    ...headers,
  } : {
    'content-type': 'application/json',
    connection: 'close',
    ...headers,
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
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

function signedHeadersForPreflight(auth = credentials) {
  return signedHeadersForRequest('GET', '/wp-json/reprint/v1/push/preflight', { auth });
}

function signedHeadersForRequest(method, pathname, { auth = credentials, session = '', idempotencyKey = '' } = {}) {
  const contentHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = createSignedRequestNonce(auth.username);
  const signingKey = hmacHex(auth.password, `reprint-push-lab-v1\n${auth.username}`);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname.split('?', 2)[0] || '/',
    canonicalQuery(pathname.split('?', 2)[1] || ''),
    contentHash,
    session,
    idempotencyKey,
  ].join('\n');
  const headers = {
    ...authHeaders(auth),
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, authString),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
  };
  if (session !== '') {
    headers['X-Reprint-Push-Session'] = session;
  }
  if (idempotencyKey !== '') {
    headers['X-Reprint-Push-Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

function createSignedRequestNonce(username) {
  signedRequestNonceSequence += 1;
  return `production-plugin-package-${username}-${process.pid}-${Date.now()}-${signedRequestNonceSequence}`;
}

function canonicalQuery(rawQuery = '') {
  if (rawQuery === '') {
    return '';
  }

  const pairs = rawQuery.split('&').filter(Boolean).map((pair, index) => {
    const [rawKey, rawValue = ''] = pair.split('=', 2);
    return {
      key: decodeURIComponent(rawKey),
      value: decodeURIComponent(rawValue),
      index,
    };
  });

  pairs.sort((left, right) => {
    if (left.key < right.key) {
      return -1;
    }
    if (left.key > right.key) {
      return 1;
    }
    if (left.value < right.value) {
      return -1;
    }
    if (left.value > right.value) {
      return 1;
    }
    return left.index - right.index;
  });

  return pairs
    .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function authHeaders(auth = credentials) {
  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`,
  };
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint/v1') || routeKeys.some((route) => route.startsWith('/reprint/v1/push/')),
    'REST index does not expose reprint/v1 push routes',
  );
  assert.equal(
    namespaces.includes('reprint-push-lab/v1') || routeKeys.some((route) => route.startsWith('/reprint-push-lab/v1')),
    false,
    'packaged plugin must not expose public lab REST namespace',
  );
}

function assertSignedStoreCleanup(cleanup) {
  assert.equal(cleanup?.schemaVersion, 1);
  assert.equal(cleanup.store, 'wp-options');
  const cleanupSummary = JSON.stringify(cleanup);
  // Earlier signed preflight probes can legitimately clear the seeded expired
  // artifacts before the final successful packaged preflight runs, so the
  // runtime smoke only asserts that the cleanup surface is present and
  // internally consistent.
  assert.equal(
    cleanup.deletedExpiredTotal,
    cleanup.sessionOptions.deletedExpired + cleanup.nonceOptions.deletedExpired,
    `signed store cleanup totals were inconsistent: ${cleanupSummary}`,
  );
  assert.ok(cleanup.sessionOptions.retainedUnexpired >= 1, `unexpired signed session option was not retained: ${cleanupSummary}`);
  assert.ok(cleanup.nonceOptions.retainedUnexpired >= 1, `unexpired signed nonce option was not retained: ${cleanupSummary}`);
  assert.equal(cleanup.sessionOptions.limitReached, false);
  assert.equal(cleanup.nonceOptions.limitReached, false);
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

function isTransientFetchError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = error.cause?.code || error.code;
  return error.name === 'TypeError' && (
    code === 'UND_ERR_SOCKET'
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
  );
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
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

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.join('').length > 20_000) {
    logs.splice(0, logs.length, logs.join('').slice(-20_000));
  }
}

function writeStageProgress(message) {
  process.stderr.write(`[production-plugin-package-smoke] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUnlessChildExit(ms, child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onExit = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
    };

    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}
