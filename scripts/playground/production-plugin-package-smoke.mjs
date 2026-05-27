#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { createPushPlan } from '../../src/planner.js';
import { deepClone, digest } from '../../src/stable-json.js';
import {
  loadAuthSessionSource,
  resolveAuthSessionSourceCredentials,
} from './auth-session-source.js';
import { resolvePackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';
import { parseProductionPluginPackageSelectedScenarios } from './production-plugin-package-scenarios.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/reprint-push-lab.js');
const serverStartupTimeoutMs = 20_000;
const packagedDriverGuardStartupTimeoutMs = 45_000;
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;

const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const authSessionSourceCommand = process.env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND || '';
const smokeMode = process.env.REPRINT_PUSH_PACKAGE_SMOKE_MODE || 'full';
const runDriverGuardOnly = smokeMode === 'driver-guard-only';
const selectedScenarios = parseProductionPluginPackageSelectedScenarios(
  process.argv.slice(2),
  process.env.REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO,
);
const authSessionSource = authSessionSourceCommand ? loadAuthSessionSource(authSessionSourceCommand) : null;
const resolvedCredentials = resolveAuthSessionSourceCredentials(credentials, authSessionSource, {
  preferSource: true,
});
const packagedAuthSessionSourceCommand = resolvedCredentials.liveSourceUrl
  ? resolvePackagedProductionPluginSourceCommand({
      sourceUrl: resolvedCredentials.liveSourceUrl,
      username: resolvedCredentials.username,
      applicationPassword: resolvedCredentials.applicationPassword,
      authSessionSourceCommand,
    })
  : '';

const alternateCredentials = {
  username: 'reprint_push_alt_admin',
  password: 'reprint-push-alt-admin-app-password',
};

const rotatedCredentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-rotated-app-password',
};

const unscopedCredentials = {
  username: 'reprint_push_unscoped_admin',
  password: 'reprint-push-unscoped-app-password',
};

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};

const snapshots = runDriverGuardOnly
  ? null
  : Object.fromEntries(
      Object.entries(fixtures).map(([name, fixture]) => [
        name,
        exportSnapshot(name, path.join(repoRoot, fixture)),
      ]),
    );
const packageLocalSnapshot = snapshots ? snapshots.local : null;
const packagePlan = snapshots
  ? createPushPlan({
      base: snapshots.base,
      local: packageLocalSnapshot,
      remote: snapshots.base,
    })
  : null;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-production-plugin-package-'));
const packageRoot = path.join(tmpDir, 'package');
const pluginDir = path.join(packageRoot, 'reprint-push');
const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
const driverGuardSnapshotBlueprintPath = path.join(tmpDir, 'remote-base-with-driver-fixture-guard-snapshot.blueprint.json');
const driverGuardServerBlueprintPath = path.join(tmpDir, 'remote-base-with-driver-fixture-guard-server.blueprint.json');
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');
const driverFixture = {
  driver: 'fixture-arbitrary-plugin-table',
  table: 'wp_reprint_push_driver_fixture',
  pluginOwner: 'driver-fixture',
  resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
};
const packagedDriverRegistryGuardScriptPath = path.join(tmpDir, 'packaged-driver-registry-guards.php');
let packagedDriverRegistryGuardResults = null;

try {
  logSmokeStage('start', formatSelectedScenarioNames(selectedScenarios));
  buildPluginPackage(pluginDir);
  fs.writeFileSync(packagedDriverRegistryGuardScriptPath, `<?php
if (!defined('ABSPATH')) {
    require_once '/wordpress/wp-load.php';
}

if (!function_exists('reprint_push_registered_plugin_owned_row_drivers')) {
    require_once '/wordpress/wp-content/plugins/reprint-push/includes/snapshot-lib.php';
}

if (!function_exists('reprint_push_export_snapshot')) {
    require_once '/wordpress/wp-content/plugins/reprint-push/includes/snapshot-lib.php';
}

function reprint_push_packaged_driver_guard_export_rows(array &$snapshot, array $driver): void {}
function reprint_push_packaged_driver_guard_apply_row(string $id, bool $is_delete, $value, array $driver): void {}
function reprint_push_packaged_driver_guard_validate_mutation(array $mutation, array $snapshot, array $driver): bool { return true; }

function reprint_push_packaged_driver_guard_capture(callable $builder): array {
    remove_all_filters('reprint_push_plugin_owned_row_drivers');
    add_filter('reprint_push_plugin_owned_row_drivers', $builder);
    try {
        reprint_push_registered_plugin_owned_row_drivers();
        return [
            'ok' => true,
            'error' => null,
        ];
    } catch (Throwable $error) {
        return [
            'ok' => false,
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    } finally {
        remove_all_filters('reprint_push_plugin_owned_row_drivers');
    }
}

$driver_name = '${driverFixture.driver}';
$driver_table = '${driverFixture.table}';
$plugin_owner = '${driverFixture.pluginOwner}';

$scenarios = [];
$scenarios['driver-missing-export-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-apply-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-validate-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
    ];
    return $drivers;
};
$scenarios['driver-missing-name-guard'] = static function (array $drivers) use ($driver_table, $plugin_owner): array {
    $drivers['${driverFixture.driver}'] = [
        'driver' => '',
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-plugin-owner-guard'] = static function (array $drivers) use ($driver_name, $driver_table): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-table-guard'] = static function (array $drivers) use ($driver_name, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-duplicate-name-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    $drivers[$driver_name . '-duplicate'] = [
        'driver' => $driver_name,
        'table' => $driver_table . '_duplicate',
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-duplicate-table-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    $drivers[$driver_name . '-same-table'] = [
        'driver' => $driver_name . '-same-table',
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_packaged_driver_guard_export_rows',
        'applyRowCallback' => 'reprint_push_packaged_driver_guard_apply_row',
        'validateMutationCallback' => 'reprint_push_packaged_driver_guard_validate_mutation',
    ];
    return $drivers;
};

$selected = isset($argv[1]) ? trim((string) $argv[1]) : '';
$results = [];
if ($selected !== '') {
    if (!array_key_exists($selected, $scenarios)) {
        fwrite(STDERR, 'Unknown packaged driver registry guard scenario: ' . $selected . PHP_EOL);
        exit(1);
    }
    $results[$selected] = reprint_push_packaged_driver_guard_capture($scenarios[$selected]);
} else {
    foreach ($scenarios as $name => $scenario) {
        $results[$name] = reprint_push_packaged_driver_guard_capture($scenario);
    }
}

echo "REPRINT_PUSH_DRIVER_GUARD_JSON_BEGIN\n";
echo wp_json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
echo "\nREPRINT_PUSH_DRIVER_GUARD_JSON_END\n";
`);
  writeActivationBlueprint(path.join(repoRoot, fixtures.base), blueprintPath);
  if (runDriverGuardOnly || shouldRunScenario('driver-receipt-guards')) {
    writeDriverFixtureBlueprint(path.join(repoRoot, fixtures.base), driverGuardSnapshotBlueprintPath);
    writeDriverFixtureBlueprint(path.join(repoRoot, fixtures.base), driverGuardServerBlueprintPath, {
      activatePackagedPlugin: true,
      provisionAuth: true,
      enableCredentialRevocationRoute: true,
    });
  }
  if (!runDriverGuardOnly && shouldRunScenario('core-package-routes')) {
    fs.writeFileSync(basePath, `${JSON.stringify(snapshots.base, null, 2)}\n`);
    fs.writeFileSync(localPath, `${JSON.stringify(packageLocalSnapshot, null, 2)}\n`);
  }
  const summary = {
    mode: smokeMode,
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      copiedFiles: fs.readdirSync(path.join(pluginDir, 'includes')).sort(),
    },
    routes: {},
    cli: {},
    driverReceiptRevokedCredentialGuard: {},
    final: {},
  };
  const packagePlanFailure = packagePlan
    && !runDriverGuardOnly
    && shouldRunScenario('core-package-routes')
    && packagePlan.status !== 'ready'
    ? buildPlanNotReadyProof(summary, packagePlan)
    : null;

  if (packagePlanFailure) {
    console.log(JSON.stringify(packagePlanFailure, null, 2));
    process.exitCode = 1;
  } else {
  if (!runDriverGuardOnly && shouldRunScenario('core-package-routes')) {
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
    assert.match(preflight.body.routeProfile.warning, /packaged production deployment mode/i);
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
      authHeaders(),
    );
    assert.equal(dbJournal.status, 200);
    assert.equal(dbJournal.body.ok, true);
    assert.match(dbJournal.body.dbJournal.scope, /packaged production plugin journal surface/i);

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
  }

  if (runDriverGuardOnly || shouldRunScenario('driver-receipt-guards')) {
    await runScenario('driver-receipt-guards', async () => {
      await withPlaygroundServer(
        'production-plugin-driver-revoked-credential-guard',
        driverGuardServerBlueprintPath,
        pluginDir,
        { authBootstrap: false, startupTimeoutMs: packagedDriverGuardStartupTimeoutMs },
        async (server) => {
      const client = authenticatedHttpClient({
        sourceUrl: server.baseUrl,
        credential: credentials,
        routeProfile: 'production-shaped',
      });
      const rotatedClient = authenticatedHttpClient({
        sourceUrl: server.baseUrl,
        credential: rotatedCredentials,
        routeProfile: 'production-shaped',
      });

      const preflight = await client.signedGet('/preflight');
      assert.equal(preflight.status, 200);
      assert.equal(preflight.body?.ok, true);
      const session = preflight.body?.session?.id;
      assert.equal(typeof session, 'string');
      assert.ok(session.length > 0, 'signed preflight did not return a session id');

      const remoteSnapshot = await client.get('/snapshot');
      assert.equal(remoteSnapshot.status, 200);
      assert.equal(remoteSnapshot.body?.ok, true);
      const driverFixtureTableKey = Object.keys(remoteSnapshot.body.snapshot?.db || {}).find((key) => key.endsWith('reprint_push_driver_fixture'));
      assert.ok(driverFixtureTableKey, 'packaged snapshot did not expose the arbitrary plugin-owned driver table');
      const driverFixtureResourceKey = `row:[${JSON.stringify(driverFixtureTableKey)},"entry_id:1"]`;
      const allowedEntry = remoteSnapshot.body.snapshot?.meta?.pluginOwnedResources?.allowedResources?.find?.(
        (entry) => entry?.resourceKey === driverFixtureResourceKey,
      );
      assert.ok(allowedEntry, 'packaged snapshot did not expose the arbitrary plugin-owned driver policy');
      assert.equal(allowedEntry.driver, driverFixture.driver);
      assert.equal(allowedEntry.table, driverFixture.table);
      assert.equal(allowedEntry.pluginOwner, driverFixture.pluginOwner);
      const driverLocalUpdateSnapshot = deepClone(remoteSnapshot.body.snapshot);
      driverLocalUpdateSnapshot.db[driverFixtureTableKey]['entry_id:1'].payload.mode = 'local-update';
      driverLocalUpdateSnapshot.db[driverFixtureTableKey]['entry_id:1'].payload.version = 2;
      driverLocalUpdateSnapshot.db[driverFixtureTableKey]['entry_id:1'].updated_marker = 'local-update';

      const updatePlan = createPushPlan({
        base: remoteSnapshot.body.snapshot,
        local: driverLocalUpdateSnapshot,
        remote: remoteSnapshot.body.snapshot,
        now: new Date('2026-05-26T18:05:00.000Z'),
      });
      assert.equal(updatePlan.status, 'ready');
      assert.equal(updatePlan.mutations.length, 1);
      assert.equal(updatePlan.mutations[0].resourceKey, driverFixtureResourceKey);
      assert.equal(updatePlan.mutations[0].action, 'put');

      const updateDryRun = await client.signedPost(
        '/dry-run',
        { plan: updatePlan },
        {
          session,
          idempotencyKey: 'production-plugin-driver-update-dry-run',
        },
      );
      assert.equal(updateDryRun.status, 200);
      assert.equal(updateDryRun.body?.ok, true);
      assert.ok(updateDryRun.body?.receipt?.receiptHash, 'driver update dry-run did not produce a receipt');

      const revokedCredentialUuid = preflight.body?.auth?.session?.applicationPasswordUuid;
      assert.equal(typeof revokedCredentialUuid, 'string');
      assert.ok(revokedCredentialUuid.length > 0, 'signed preflight did not return an application password uuid to revoke');

      const rotatedPreflight = await rotatedClient.signedGet('/preflight');
      assert.equal(rotatedPreflight.status, 200);
      assert.equal(rotatedPreflight.body?.ok, true);

      const revokeResponse = await requestJson(
        server.baseUrl,
        'DELETE',
        `/wp-json/reprint-push-driver-fixture/v1/revoke-application-password/${encodeURIComponent(revokedCredentialUuid)}`,
        undefined,
        authHeaders(rotatedCredentials),
      );
      assert.equal(revokeResponse.status, 200);
      assert.equal(revokeResponse.body?.deleted, true);
      assert.equal(revokeResponse.body?.previous?.uuid, revokedCredentialUuid);

      const revokedCredentialApply = await client.signedPost(
        '/apply',
        {
          plan: updatePlan,
          receipt: updateDryRun.body.receipt,
        },
        {
          session,
          idempotencyKey: 'production-plugin-driver-revoked-credential-apply',
        },
      );
      assert.equal(revokedCredentialApply.status, 401);
      assert.equal(revokedCredentialApply.body?.code, 'reprint_push_lab_auth_required');

      const afterRevokedCredentialReject = await rotatedClient.get('/snapshot');
      assert.equal(afterRevokedCredentialReject.status, 200);
      assert.equal(afterRevokedCredentialReject.body?.ok, true);
      assert.equal(
        afterRevokedCredentialReject.body.snapshot?.db?.[driverFixtureTableKey]?.['entry_id:1']?.updated_marker,
        'base',
        'revoked-credential packaged apply still mutated the remote snapshot',
      );
      assert.deepEqual(
        afterRevokedCredentialReject.body.snapshot?.db?.[driverFixtureTableKey]?.['entry_id:1']?.payload,
        {
          owner: driverFixture.pluginOwner,
          mode: 'base',
          version: 1,
        },
        'revoked-credential packaged apply changed the arbitrary driver payload',
      );

      summary.driverReceiptRevokedCredentialGuard = {
        resourceKey: driverFixtureResourceKey,
        revokedCredentialUuid,
        rotatedCredentialUsedForRevocation: rotatedPreflight.body?.auth?.session?.applicationPasswordUuid,
        revokeDeleted: revokeResponse.body?.deleted === true,
        applyRejectedCode: revokedCredentialApply.body?.code,
        applyRejectedMessage: revokedCredentialApply.body?.message,
        rowRetainedAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixtureTableKey]?.['entry_id:1'] !== undefined,
        updatedMarkerAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixtureTableKey]?.['entry_id:1']?.updated_marker,
        payloadModeAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixtureTableKey]?.['entry_id:1']?.payload?.mode,
      };
        },
      );
    });
  }

  await runScenario('driver-missing-export-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-export-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing exportRowsCallback for driver: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on a malformed arbitrary plugin-owned driver export registration',
    );

    summary.driverExportGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingExportRowsCallback: /missing exportRowsCallback for driver: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-missing-apply-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-apply-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing applyRowCallback for driver: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on a malformed arbitrary plugin-owned driver apply registration',
    );

    summary.driverApplyGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingApplyRowCallback: /missing applyRowCallback for driver: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-missing-validate-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-validate-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing validateMutationCallback for driver: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on a malformed arbitrary plugin-owned driver validate registration',
    );

    summary.driverValidateGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingValidateMutationCallback: /missing validateMutationCallback for driver: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-missing-name-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-name-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing driver name for table: wp_reprint_push_driver_fixture/i,
      'packaged snapshot did not fail closed on a plugin-owned driver registration without a driver name',
    );

    summary.driverMissingNameGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingDriverName: /missing driver name for table: wp_reprint_push_driver_fixture/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-missing-plugin-owner-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-plugin-owner-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing pluginOwner for driver: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on a plugin-owned driver registration without pluginOwner',
    );

    summary.driverPluginOwnerGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingPluginOwner: /missing pluginOwner for driver: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-missing-table-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-missing-table-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /missing table for driver: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on a plugin-owned driver registration without table',
    );

    summary.driverMissingTableGuard = {
      exportFailed: malformedSnapshot.ok === false,
      missingTable: /missing table for driver: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-duplicate-name-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-duplicate-name-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /duplicate driver name: fixture-arbitrary-plugin-table/i,
      'packaged snapshot did not fail closed on duplicate plugin-owned driver names',
    );

    summary.driverDuplicateNameGuard = {
      exportFailed: malformedSnapshot.ok === false,
      duplicateDriverName: /duplicate driver name: fixture-arbitrary-plugin-table/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  await runScenario('driver-duplicate-table-guard', async () => {
    const malformedSnapshot = runPackagedDriverRegistryGuard('driver-duplicate-table-guard', pluginDir);
    assertPackagedDriverFatalExport(
      malformedSnapshot,
      /duplicate table mapping for table: wp_reprint_push_driver_fixture/i,
      'packaged snapshot did not fail closed on duplicate plugin-owned driver table mappings',
    );

    summary.driverDuplicateTableGuard = {
      exportFailed: malformedSnapshot.ok === false,
      duplicateTable: /duplicate table mapping for table: wp_reprint_push_driver_fixture/i.test(malformedSnapshot.error?.message || ''),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function buildPlanNotReadyProof(summary, plan) {
  const graphIdentityBlockers = plan.blockers.filter((blocker) =>
    (blocker.class || blocker.className) === 'stale-wordpress-graph-identity');
  return {
    ok: false,
    code: 'PLAN_NOT_READY_LOCALLY',
    mode: summary.mode,
    package: summary.package,
    graphFilter: {
      removed: true,
      formerFilter: 'withoutUnmappedGraphPostmeta',
      blockerClass: graphIdentityBlockers.length > 0 ? 'stale-wordpress-graph-identity' : null,
      blockerCount: graphIdentityBlockers.length,
    },
    plan: summarizePlan(plan),
    boundary: {
      firstRemainingProductionBoundary: 'WordPress graph identity mapping on the packaged release smoke path',
      verdict: graphIdentityBlockers.length > 0
        ? 'STALE_WORDPRESS_GRAPH_IDENTITY_REQUIRED'
        : 'PLAN_NOT_READY_LOCALLY',
    },
  };
}

function summarizePlan(plan) {
  return {
    id: plan.id,
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.length,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey),
    conflicts: plan.conflicts.map((conflict) => ({
      resourceKey: conflict.resourceKey,
      reason: conflict.reason,
      className: conflict.className || conflict.class || null,
      resolutionPolicy: conflict.resolutionPolicy,
    })),
    blockers: plan.blockers.map((blocker) => ({
      resourceKey: blocker.resourceKey,
      reason: blocker.reason,
      className: blocker.className || blocker.class || null,
      resolutionPolicy: blocker.resolutionPolicy,
    })),
  };
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

function shouldRunScenario(name) {
  return selectedScenarios === null || selectedScenarios.has(name);
}

async function runScenario(name, run) {
  if (!shouldRunScenario(name)) {
    return;
  }

  const startedAt = Date.now();
  console.error(`[plugin-driver-scenario:start] ${name}`);
  try {
    await run();
    console.error(
      `[plugin-driver-scenario:ok] ${name} ${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    console.error(
      `[plugin-driver-scenario:fail] ${name} ${Date.now() - startedAt}ms ${formatScenarioError(error)}`,
    );
    throw error;
  }
}

function formatScenarioError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function logSmokeStage(stage, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  console.error(`[plugin-driver-smoke:${stage}]${suffix}`);
}

function runPackagedDriverRegistryGuard(scenarioName, mountedPluginDir) {
  if (packagedDriverRegistryGuardResults === null) {
    packagedDriverRegistryGuardResults = runPackagedDriverRegistryGuards(mountedPluginDir);
  }
  return packagedDriverRegistryGuardResults[scenarioName];
}

function runPackagedDriverRegistryGuards(mountedPluginDir) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${mountedPluginDir}:/wordpress/wp-content/plugins/reprint-push`,
    '--mount',
    `${tmpDir}:/tmp/reprint-production-plugin-package`,
    '--verbosity',
    'quiet',
    '--',
    '/tmp/reprint-production-plugin-package/packaged-driver-registry-guards.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Packaged driver registry guard export failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_DRIVER_GUARD_JSON_BEGIN',
    'REPRINT_PUSH_DRIVER_GUARD_JSON_END',
    `Packaged driver guard markers missing\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function formatSelectedScenarioNames(selected) {
  if (selected === null) {
    return 'all-scenarios';
  }
  return Array.from(selected).sort().join(',');
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
      '$past = time() - 60;',
      '$future = time() + 3600;',
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

function writeDriverFixtureBlueprint(
  sourceBlueprintPath,
  targetBlueprintPath,
  {
    activatePackagedPlugin = false,
    provisionAuth = false,
    enableCredentialRevocationRoute = false,
  } = {},
) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Driver Fixture Package Guard',
    description: 'Remote base fixture with packaged Reprint Push plus an arbitrary plugin-owned row driver fixture.',
  };
  const pluginCodeBase64 = Buffer.from(driverFixturePluginPhp({ enableCredentialRevocationRoute }), 'utf8').toString('base64');
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$plugin_dir = WP_PLUGIN_DIR . \'/driver-fixture\';',
      'wp_mkdir_p($plugin_dir);',
      '$plugin_file = $plugin_dir . \'/driver-fixture.php\';',
      `file_put_contents($plugin_file, base64_decode('${pluginCodeBase64}'));`,
      "require_once ABSPATH . 'wp-admin/includes/plugin.php';",
      "$result = activate_plugin('driver-fixture/driver-fixture.php');",
      'if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }',
      'global $wpdb;',
      '$table = $wpdb->prefix . \'reprint_push_driver_fixture\';',
      '$wpdb->query(\'CREATE TABLE \' . $table . \' (entry_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (entry_id)) \' . $wpdb->get_charset_collate());',
      '$payload = wp_json_encode(array(\'owner\' => \'driver-fixture\', \'mode\' => \'base\', \'version\' => 1));',
      '$wpdb->replace($table, array(\'entry_id\' => 1, \'payload_json\' => $payload, \'updated_marker\' => \'base\'), array(\'%d\', \'%s\', \'%s\'));',
    ].join(' '),
  });
  if (activatePackagedPlugin) {
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
  }
  if (provisionAuth) {
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
        '$result = reprint_push_lab_rest_provision_push_application_password(array(\'login\' => \'reprint_push_admin\', \'appPassword\' => \'reprint-push-admin-rotated-app-password\', \'role\' => \'administrator\', \'slug\' => \'primary-admin-rotated\', \'name\' => \'Reprint Push Package Smoke Rotated\', \'createUser\' => true, \'updateRole\' => true));',
        'if (empty($result[\'ok\'])) { throw new RuntimeException((string) ($result[\'message\'] ?? \'rotated push credential provisioning failed\')); }',
      ].join(' '),
    });
  }
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function driverFixturePluginPhp({ enableCredentialRevocationRoute = false } = {}) {
  return `<?php
/*
Plugin Name: Reprint Push Driver Fixture
Description: Fixture plugin for packaged plugin-owned row driver guard coverage.
Version: 0.0.1
*/

${enableCredentialRevocationRoute ? `add_action('rest_api_init', static function (): void {
    register_rest_route('reprint-push-driver-fixture/v1', '/revoke-application-password/(?P<uuid>[A-Za-z0-9-]+)', [
        'methods' => WP_REST_Server::DELETABLE,
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        'callback' => 'reprint_push_driver_fixture_revoke_application_password',
    ]);
});
` : ''}

add_filter('reprint_push_plugin_owned_row_drivers', static function (array $drivers): array {
    $drivers['${driverFixture.driver}'] = [
        'driver' => '${driverFixture.driver}',
        'table' => '${driverFixture.table}',
        'pluginOwner' => '${driverFixture.pluginOwner}',
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
    return $drivers;
});

function reprint_push_driver_fixture_table_name(): string {
    global $wpdb;
    return $wpdb->prefix . 'reprint_push_driver_fixture';
}

${enableCredentialRevocationRoute ? `function reprint_push_driver_fixture_revoke_application_password(WP_REST_Request $request): WP_REST_Response {
    $uuid = (string) $request['uuid'];
    $user = wp_get_current_user();
    $user_id = (int) ($user->ID ?? 0);
    if ($user_id < 1) {
        return new WP_REST_Response(['deleted' => false, 'code' => 'reprint_push_driver_fixture_user_missing'], 401);
    }
    $items = get_user_meta($user_id, '_application_passwords', true);
    $items = is_array($items) ? array_values($items) : [];
    $previous = null;
    $remaining = [];
    foreach ($items as $item) {
        if (is_array($item) && (string) ($item['uuid'] ?? '') === $uuid) {
            $previous = $item;
            continue;
        }
        $remaining[] = $item;
    }
    update_user_meta($user_id, '_application_passwords', $remaining);
    return new WP_REST_Response([
        'deleted' => is_array($previous),
        'previous' => is_array($previous) ? [
            'uuid' => (string) ($previous['uuid'] ?? ''),
            'app_id' => (string) ($previous['app_id'] ?? ''),
            'name' => (string) ($previous['name'] ?? ''),
        ] : null,
    ], is_array($previous) ? 200 : 404);
}
` : ''}

function reprint_push_driver_fixture_export_rows(array &$snapshot, array $driver): void {
    global $wpdb;
    $table_name = reprint_push_driver_fixture_table_name();
    $rows = $wpdb->get_results("SELECT entry_id, payload_json, updated_marker FROM {$table_name} ORDER BY entry_id ASC", ARRAY_A);
    if (!isset($snapshot['db']['${driverFixture.table}']) || !is_array($snapshot['db']['${driverFixture.table}'])) {
        $snapshot['db']['${driverFixture.table}'] = [];
    }
    foreach ($rows as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        $snapshot['db']['${driverFixture.table}']['entry_id:' . (int) $row['entry_id']] = [
            'entry_id' => (int) $row['entry_id'],
            'payload' => is_array($payload) ? $payload : [],
            'updated_marker' => (string) $row['updated_marker'],
            '__pluginOwner' => '${driverFixture.pluginOwner}',
        ];
    }
}

function reprint_push_driver_fixture_apply_row(string $id, bool $is_delete, $value, array $driver): void {
    global $wpdb;
    if (!preg_match('/^entry_id:([1-9]\\d*)$/', $id, $matches)) {
        throw new RuntimeException('Unsupported driver fixture row id: ' . $id);
    }
    $entry_id = (int) $matches[1];
    $table_name = reprint_push_driver_fixture_table_name();
    if ($is_delete) {
        $wpdb->delete($table_name, ['entry_id' => $entry_id], ['%d']);
        return;
    }
    $payload_json = wp_json_encode($value['payload'] ?? []);
    $updated_marker = (string) ($value['updated_marker'] ?? '');
    $sql = $wpdb->prepare(
        'INSERT INTO ' . $table_name . ' (entry_id, payload_json, updated_marker) VALUES (%d, %s, %s) ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), updated_marker = VALUES(updated_marker)',
        $entry_id,
        $payload_json,
        $updated_marker
    );
    if ($wpdb->query($sql) === false) {
        throw new RuntimeException('Could not apply driver fixture row: ' . $wpdb->last_error);
    }
}

function reprint_push_driver_fixture_validate_mutation(array $mutation, array $snapshot, array $driver): bool {
    $resource = is_array($mutation['resource'] ?? null) ? $mutation['resource'] : [];
    if (($resource['table'] ?? '') !== '${driverFixture.table}' || ($driver['pluginOwner'] ?? '') !== '${driverFixture.pluginOwner}') {
        return false;
    }
    return !empty($mutation['value']) && empty($mutation['value']['absent']);
}
`;
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

async function withPlaygroundServer(name, blueprintPath, mountedPluginDir, optionsOrRun, maybeRun) {
  const options = typeof optionsOrRun === 'function' ? {} : (optionsOrRun ?? {});
  const run = typeof optionsOrRun === 'function' ? optionsOrRun : maybeRun;
  const server = await startPlaygroundServer(name, blueprintPath, mountedPluginDir, options);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath, mountedPluginDir, { authBootstrap = true, startupTimeoutMs = serverStartupTimeoutMs } = {}) {
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
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: authBootstrap ? '1' : '0',
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
    await waitForServer(child, baseUrl, logs, startupTimeoutMs);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { name, port, baseUrl, child, logs };
}

async function waitForServer(child, baseUrl, logs, startupTimeoutMs = serverStartupTimeoutMs) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;
  let lastStatus = null;
  let lastBody = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await requestJson(
        baseUrl,
        'GET',
        '/wp-json/reprint/v1/push/snapshot',
        undefined,
        authHeaders(),
        { attempts: 2 },
      );
      if (response.status === 200 && response.body?.ok === true) {
        return;
      }
      lastError = new Error(`Production plugin package snapshot readiness HTTP ${response.status}`);
      lastStatus = response.status;
      lastBody = response.body;
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  const lastResponse = lastStatus === null
    ? ''
    : `\nLast snapshot probe status: ${lastStatus}\nLast snapshot probe body: ${JSON.stringify(lastBody, null, 2)}`;
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}${lastResponse}\n${logs.join('')}`);
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
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

function assertPackagedDriverFatalExport(result, expectedPattern, message) {
  assert.equal(result?.ok, false, 'expected packaged snapshot export to fail closed');
  const combinedErrorText = [result?.error?.class || '', result?.error?.message || ''].join('\n');
  assert.match(combinedErrorText, expectedPattern, message);
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
  const contentHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `production-plugin-package-${auth.username}-${Date.now()}`;
  const signingKey = hmacHex(auth.password, `reprint-push-lab-v1\n${auth.username}`);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const canonical = [
    'REPRINT-PUSH-LAB-V1',
    'GET',
    '/wp-json/reprint/v1/push/preflight',
    '',
    contentHash,
    '',
    '',
  ].join('\n');
  return {
    ...authHeaders(auth),
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, authString),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
  };
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
  assert.ok(cleanup.deletedExpiredTotal >= 2, 'signed store cleanup must delete seeded expired artifacts');
  assert.ok(cleanup.sessionOptions.deletedExpired >= 1, 'expired signed session option was not deleted');
  assert.ok(cleanup.nonceOptions.deletedExpired >= 1, 'expired signed nonce option was not deleted');
  assert.ok(cleanup.sessionOptions.retainedUnexpired >= 1, 'unexpired signed session option was not retained');
  assert.ok(cleanup.nonceOptions.retainedUnexpired >= 1, 'unexpired signed nonce option was not retained');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
