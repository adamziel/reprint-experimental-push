#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { createPushPlan } from '../../src/planner.js';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';
import { deepClone, digest } from '../../src/stable-json.js';
import { attachProductionPluginPackagePluginDriverProof } from './production-plugin-package-proof-summary.js';
import {
  receiptGuardScenarioNames,
  resolveProductionPluginPackageScenarios,
} from './production-plugin-package-scenarios.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'bin/reprint-push-lab.js');
const serverStartupTimeoutMs = 120_000;
const syncChildTimeoutMs = 120_000;
const syncChildKillSignal = 'SIGKILL';
const transientFetchRetryDelayMs = 250;
const transientFetchAttempts = 4;
const { requestedScenarios, selectedScenarios, resolvedMode, canonicalMode } = resolveProductionPluginPackageScenarios(
  process.argv.slice(2),
  process.env.REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO,
  process.env.REPRINT_PUSH_PACKAGE_SMOKE_MODE,
);

const credentials = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};

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
const driverFixture = {
  driver: 'fixture-arbitrary-plugin-table',
  table: 'wp_reprint_push_driver_fixture',
  pluginOwner: 'driver-fixture',
  resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
};
const deleteDriverFixture = {
  driver: 'fixture-arbitrary-plugin-table-delete',
  table: 'wp_reprint_push_driver_fixture_delete',
  pluginOwner: 'driver-fixture',
  resourceKey: 'row:["wp_reprint_push_driver_fixture_delete","entry_id:1"]',
};
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-production-plugin-package-'));
const packageRoot = path.join(tmpDir, 'package');
const pluginDir = path.join(packageRoot, 'reprint-push');
const blueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin.blueprint.json');
const registryGuardBlueprintPath = path.join(tmpDir, 'remote-base-with-reprint-push-plugin-registry-guards.blueprint.json');
const driverGuardServerBlueprintPath = path.join(tmpDir, 'remote-base-with-driver-fixture-guard-server.blueprint.json');
const driverDeleteSnapshotBlueprintPath = path.join(tmpDir, 'remote-base-with-driver-fixture-delete-snapshot.blueprint.json');
const driverDeleteServerBlueprintPath = path.join(tmpDir, 'remote-base-with-driver-fixture-delete-server.blueprint.json');
const packagedDriverRegistryGuardScriptPath = path.join(tmpDir, 'packaged-driver-registry-guards.php');
const basePath = path.join(tmpDir, 'base.json');
const localPath = path.join(tmpDir, 'local.json');
let packagedDriverRegistryGuardResults = null;
const activePlaygroundChildren = new Set();
let cleanupInFlight = null;
let signalCleanupInstalled = false;
const packagedDriverRegistryGuardScenarioNames = new Set([
  'driver-missing-export-guard',
  'driver-missing-apply-guard',
  'driver-missing-validate-guard',
  'driver-missing-name-guard',
  'driver-missing-plugin-owner-guard',
  'driver-missing-table-guard',
  'driver-duplicate-name-guard',
  'driver-duplicate-table-guard',
]);

logSmokeStage('start', formatSelectedScenarioNames(selectedScenarios));
installSignalCleanup();

try {
  fs.writeFileSync(packagedDriverRegistryGuardScriptPath, `<?php
if (!defined('ABSPATH')) {
    require_once '/wordpress/wp-load.php';
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
        reprint_push_plugin_owned_row_drivers(true);
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

$selected = array_values(array_filter(array_map(
    static fn ($value): string => trim((string) $value),
    array_slice($argv, 1),
), static fn (string $value): bool => $value !== ''));
$results = [];
if ($selected !== []) {
    foreach ($selected as $selected_name) {
        if (!array_key_exists($selected_name, $scenarios)) {
            fwrite(STDERR, 'Unknown packaged driver registry guard scenario: ' . $selected_name . PHP_EOL);
            exit(1);
        }
        $results[$selected_name] = reprint_push_packaged_driver_guard_capture($scenarios[$selected_name]);
    }
} else {
    foreach ($scenarios as $name => $scenario) {
        $results[$name] = reprint_push_packaged_driver_guard_capture($scenario);
    }
}

echo "REPRINT_PUSH_DRIVER_GUARD_JSON_BEGIN\\n";
echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\\n";
echo "REPRINT_PUSH_DRIVER_GUARD_JSON_END\\n";
`);
  logSmokeStage('build-plugin-package', pluginDir);
  buildPluginPackage(pluginDir);
  logSmokeStage('write-blueprints');
  writeActivationBlueprint(path.join(repoRoot, fixtures.base), blueprintPath);
  if (shouldRunAnyScenario(Array.from(packagedDriverRegistryGuardScenarioNames))) {
    writePackagedPluginOnlyBlueprint(path.join(repoRoot, fixtures.base), registryGuardBlueprintPath);
  }
  const reuseGuardServerForDelete = shouldRunAnyScenario(['driver-receipt-guards', ...receiptGuardScenarioNames])
    && shouldRunAnyScenario(['driver-delete-apply']);
  if (shouldRunAnyScenario(['driver-receipt-guards', ...receiptGuardScenarioNames])) {
    writeDriverFixtureBlueprint(path.join(repoRoot, fixtures.base), driverGuardServerBlueprintPath, {
      activatePackagedPlugin: true,
      provisionAuth: true,
      enableCredentialRevocationRoute: true,
      includeDeleteDriver: shouldRunAnyScenario(['driver-delete-apply']),
    });
  }
  if (shouldRunAnyScenario(['driver-delete-apply']) && !reuseGuardServerForDelete) {
    writeDriverFixtureBlueprint(path.join(repoRoot, fixtures.base), driverDeleteSnapshotBlueprintPath, {
      supportsDelete: true,
    });
  }
  if (shouldRunAnyScenario(['driver-delete-apply']) && !reuseGuardServerForDelete) {
    writeDriverFixtureBlueprint(path.join(repoRoot, fixtures.base), driverDeleteServerBlueprintPath, {
      activatePackagedPlugin: true,
      provisionAuth: true,
      supportsDelete: true,
    });
  }
  const packageSnapshots = shouldRunAnyScenario(['core-package-routes'])
    ? preparePackageSnapshots()
    : null;
  if (packageSnapshots) {
    logSmokeStage('export-base-snapshots');
    fs.writeFileSync(basePath, `${JSON.stringify(packageSnapshots.base, null, 2)}\n`);
    fs.writeFileSync(localPath, `${JSON.stringify(packageSnapshots.local, null, 2)}\n`);
  }
  const activeDeleteFixture = reuseGuardServerForDelete ? deleteDriverFixture : driverFixture;
  const driverDeleteBaseSnapshot = shouldRunAnyScenario(['driver-delete-apply'])
    ? (reuseGuardServerForDelete
        ? null
        : exportSnapshotWithStage('driver-fixture-delete-base', driverDeleteSnapshotBlueprintPath))
    : null;
  const driverLocalDeleteSnapshot = driverDeleteBaseSnapshot ? deepClone(driverDeleteBaseSnapshot) : null;
  if (driverLocalDeleteSnapshot) {
    delete driverLocalDeleteSnapshot.db?.[activeDeleteFixture.table]?.['entry_id:1'];
  }

  const summary = {
    mode: resolvedMode,
    canonicalMode,
    requestedScenarios: requestedScenarios === null ? 'all' : requestedScenarios.slice(),
    selectedScenarios: selectedScenarios === null ? 'all' : Array.from(selectedScenarios).sort(),
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      copiedFiles: fs.readdirSync(path.join(pluginDir, 'includes')).sort(),
    },
    routes: {},
    cli: {},
    driverUpdateApply: {},
    driverDeleteApply: {},
    driverDeleteGuard: {},
    driverUpdateValidationGuard: {},
    driverReceiptIdentityGuard: {},
    driverReceiptExpiryGuard: {},
    driverReceiptPlanBindingGuard: {},
    driverReceiptRotatedCredentialGuard: {},
    driverReceiptRevokedCredentialGuard: {},
    driverExportGuard: {},
    driverApplyGuard: {},
    driverValidateGuard: {},
    driverMissingNameGuard: {},
    driverPluginOwnerGuard: {},
    driverMissingTableGuard: {},
    driverDuplicateNameGuard: {},
    driverDuplicateTableGuard: {},
    final: {},
  };

  async function executeDriverDeleteApplyScenario(server, fixture, credential = credentials) {
    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const preflight = await client.signedGet('/preflight');
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body?.ok, true);
    const session = preflight.body?.session?.id;
    assert.equal(typeof session, 'string');
    assert.ok(session.length > 0, 'signed preflight did not return a session id for delete apply');

    const remoteSnapshot = await client.get('/snapshot');
    assert.equal(remoteSnapshot.status, 200);
    assert.equal(remoteSnapshot.body?.ok, true);
    const allowedEntry = remoteSnapshot.body.snapshot?.meta?.pluginOwnedResources?.allowedResources?.find?.(
      (entry) => entry?.resourceKey === fixture.resourceKey,
    );
    assert.ok(allowedEntry, 'packaged snapshot did not expose the delete-enabled arbitrary plugin-owned driver policy');
    assert.equal(allowedEntry.driver, fixture.driver);
    assert.equal(allowedEntry.table, fixture.table);
    assert.equal(allowedEntry.pluginOwner, fixture.pluginOwner);
    assert.equal(allowedEntry.supportsDelete, true);

    const deleteBaseSnapshot = driverDeleteBaseSnapshot
      ? deepClone(driverDeleteBaseSnapshot)
      : deepClone(remoteSnapshot.body.snapshot);
    const deleteLocalSnapshot = driverLocalDeleteSnapshot
      ? deepClone(driverLocalDeleteSnapshot)
      : deepClone(deleteBaseSnapshot);
    if (!driverLocalDeleteSnapshot) {
      delete deleteLocalSnapshot.db?.[fixture.table]?.['entry_id:1'];
    }

    const deletePlan = createPushPlan({
      base: deleteBaseSnapshot,
      local: deleteLocalSnapshot,
      remote: remoteSnapshot.body.snapshot,
      now: new Date('2026-05-26T18:12:00.000Z'),
    });
    assert.equal(deletePlan.status, 'ready');
    assert.equal(deletePlan.mutations.length, 1);
    assert.equal(deletePlan.mutations[0].resourceKey, fixture.resourceKey);
    assert.equal(deletePlan.mutations[0].action, 'delete');
    assert.equal(deletePlan.mutations[0].pluginOwnedResource?.driver, fixture.driver);
    assert.equal(deletePlan.mutations[0].pluginOwnedResource?.table, fixture.table);
    assert.equal(deletePlan.mutations[0].pluginOwnedResource?.supportsDelete, true);

    const deleteDryRun = await client.signedPost(
      '/dry-run',
      { plan: deletePlan },
      {
        session,
        idempotencyKey: 'production-plugin-driver-delete-allowed-dry-run',
      },
    );
    assert.equal(deleteDryRun.status, 200);
    assert.equal(deleteDryRun.body?.ok, true);
    assert.ok(deleteDryRun.body?.receipt?.receiptHash, 'delete-enabled driver dry-run did not produce a receipt');

    const deleteApply = await client.signedPost(
      '/apply',
      {
        plan: deletePlan,
        receipt: deleteDryRun.body.receipt,
      },
      {
        session,
        idempotencyKey: 'production-plugin-driver-delete-allowed-apply',
      },
    );
    assert.equal(deleteApply.status, 200);
    assert.equal(deleteApply.body?.ok, true);
    assert.equal(deleteApply.body?.applied, 1);

    const afterDeleteApply = await client.get('/snapshot');
    assert.equal(afterDeleteApply.status, 200);
    assert.equal(afterDeleteApply.body?.ok, true);
    assert.equal(
      afterDeleteApply.body.snapshot?.db?.[fixture.table]?.['entry_id:1'],
      undefined,
      'packaged apply route did not delete the arbitrary driver row when the driver allowed deletes',
    );

    summary.driverDeleteApply = {
      resourceKey: fixture.resourceKey,
      remoteSupportsDelete: allowedEntry.supportsDelete,
      dryRunReceiptHash: deleteDryRun.body?.receipt?.receiptHash,
      applied: deleteApply.body?.applied,
      deletedAfterApply: afterDeleteApply.body.snapshot?.db?.[fixture.table]?.['entry_id:1'] === undefined,
    };
  }

  await runScenario('core-package-routes', async () => {
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
    assert.equal(preflight.body.auth.session.credentialScope, 'reprint-push-lab:authenticated-http-push');
    assert.equal(preflight.body.auth.session.credentialType, 'push-application-password');
    assertSignedStoreCleanup(preflight.body.sessionStore?.cleanup);

    const result = runCli([
      'push-authenticated',
      '--base',
      basePath,
      '--local',
      localPath,
      '--source-url',
      server.baseUrl,
      '--username',
      credentials.username,
      '--application-password',
      credentials.password,
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
    assertVisibleSurfaceEqual(after.body.snapshot, packageSnapshots.local, 'packaged plugin final source');

    summary.routes = {
      namespace: preflight.body.routeProfile.restNamespace,
      labNamespaceDisabled: labRoute.status === 404,
      profile: preflight.body.routeProfile.profile,
      labBacked: preflight.body.routeProfile.labBacked,
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
    };
    summary.final = {
      finalMatchesLocal: result.after.finalMatchesLocal,
      visibleSurfaceHash: digest(visibleSurface(after.body.snapshot)),
    };
    });
  });

  if (shouldRunAnyScenario(['driver-receipt-guards', ...receiptGuardScenarioNames])) {
    await withPlaygroundServer(
      'production-plugin-driver-delete-guard',
      driverGuardServerBlueprintPath,
      pluginDir,
      { authBootstrap: false },
      async (server) => {
        const runBundledReceiptGuards = shouldRunScenario('driver-receipt-guards');
        const runDeleteGuard = runBundledReceiptGuards || shouldRunScenario('driver-delete-guard');
        const runUpdateValidationGuard = runBundledReceiptGuards || shouldRunScenario('driver-update-validation-guard');
        const runPlanBindingGuard = runBundledReceiptGuards || shouldRunScenario('driver-receipt-plan-binding-guard');
        const runExpiryGuard = runBundledReceiptGuards || shouldRunScenario('driver-receipt-expiry-guard');
        const runIdentityGuard = runBundledReceiptGuards || shouldRunScenario('driver-receipt-identity-guard');
        const runRotatedCredentialGuard = runBundledReceiptGuards || shouldRunScenario('driver-receipt-rotated-credential-guard');
        const runRevokedCredentialGuard = runBundledReceiptGuards || shouldRunScenario('driver-receipt-revoked-credential-guard');

    const client = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: credentials,
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
    const driverGuardBaseSnapshot = deepClone(remoteSnapshot.body.snapshot);
    const driverLocalUpdateSnapshot = deepClone(driverGuardBaseSnapshot);
    driverLocalUpdateSnapshot.db[driverFixture.table]['entry_id:1'].payload.mode = 'local-update';
    driverLocalUpdateSnapshot.db[driverFixture.table]['entry_id:1'].payload.version = 2;
    driverLocalUpdateSnapshot.db[driverFixture.table]['entry_id:1'].updated_marker = 'local-update';
    const driverLocalInvalidUpdateSnapshot = deepClone(driverGuardBaseSnapshot);
    driverLocalInvalidUpdateSnapshot.db[driverFixture.table]['entry_id:1'].payload.mode = 'invalid-update';
    driverLocalInvalidUpdateSnapshot.db[driverFixture.table]['entry_id:1'].payload.version = 3;
    driverLocalInvalidUpdateSnapshot.db[driverFixture.table]['entry_id:1'].updated_marker = 'INVALID marker!';
    const allowedEntry = remoteSnapshot.body.snapshot?.meta?.pluginOwnedResources?.allowedResources?.find?.(
      (entry) => entry?.resourceKey === driverFixture.resourceKey,
    );
    assert.ok(allowedEntry, 'packaged snapshot did not expose the arbitrary plugin-owned driver policy');
    assert.equal(allowedEntry.driver, driverFixture.driver);
    assert.equal(allowedEntry.table, driverFixture.table);
    assert.equal(allowedEntry.pluginOwner, driverFixture.pluginOwner);
    assert.equal(allowedEntry.supportsDelete, false);

    const updatePlan = createPushPlan({
      base: driverGuardBaseSnapshot,
      local: driverLocalUpdateSnapshot,
      remote: remoteSnapshot.body.snapshot,
      now: new Date('2026-05-26T18:05:00.000Z'),
    });
    assert.equal(updatePlan.status, 'ready');
    assert.equal(updatePlan.mutations.length, 1);
    assert.equal(updatePlan.mutations[0].resourceKey, driverFixture.resourceKey);
    assert.equal(updatePlan.mutations[0].action, 'put');
    assert.equal(updatePlan.mutations[0].pluginOwnedResource?.driver, driverFixture.driver);
    assert.equal(updatePlan.mutations[0].pluginOwnedResource?.table, driverFixture.table);

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

    const updateApply = await client.signedPost(
      '/apply',
      {
        plan: updatePlan,
        receipt: updateDryRun.body.receipt,
      },
      {
        session,
        idempotencyKey: 'production-plugin-driver-update-apply',
      },
    );
    assert.equal(updateApply.status, 200);
    assert.equal(updateApply.body?.ok, true);
    assert.equal(updateApply.body?.applied, 1);

    const tamperedPlan = deepClone(updatePlan);
    tamperedPlan.mutations[0].value.value.payload.mode = 'forged-update';
    tamperedPlan.mutations[0].value.value.payload.version = 999;
    tamperedPlan.mutations[0].value.value.updated_marker = 'forged-update';

    const tamperedPlanApply = await client.signedPost(
      '/apply',
      {
        plan: tamperedPlan,
        receipt: updateDryRun.body.receipt,
      },
      {
        session,
        idempotencyKey: 'production-plugin-driver-plan-mismatch-apply',
      },
    );
    assert.equal(tamperedPlanApply.status, 409);
    assert.equal(tamperedPlanApply.body?.ok, false);
    assert.equal(tamperedPlanApply.body?.code, 'AUTH_RECEIPT_MISMATCH');
    assert.match(
      tamperedPlanApply.body?.message || '',
      /request binding|supplied apply plan|receipt/i,
      'packaged apply did not reject the tampered arbitrary driver plan',
    );

    const afterUpdateApply = await client.get('/snapshot');
    assert.equal(afterUpdateApply.status, 200);
    assert.equal(afterUpdateApply.body?.ok, true);
    assert.deepEqual(
      afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'packaged apply route did not persist the arbitrary driver payload update',
    );
    assert.equal(
      afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'packaged apply route did not persist the arbitrary driver updated_marker',
    );

    const forgedDeleteBase = enableForgedDeletePolicy(
      deepClone(driverGuardBaseSnapshot),
      driverFixture.resourceKey,
    );
    const forgedDeleteLocal = deepClone(forgedDeleteBase);
    delete forgedDeleteLocal.db?.[driverFixture.table]?.['entry_id:1'];
    enableForgedDeletePolicy(forgedDeleteLocal, driverFixture.resourceKey);
    const forgedRemote = enableForgedDeletePolicy(
      deepClone(remoteSnapshot.body.snapshot),
      driverFixture.resourceKey,
    );
    const forgedAllowedEntry = forgedRemote.meta.pluginOwnedResources.allowedResources.find(
      (entry) => entry?.resourceKey === driverFixture.resourceKey,
    );

    const forgedDeletePlan = createPushPlan({
      base: forgedDeleteBase,
      local: forgedDeleteLocal,
      remote: forgedRemote,
      now: new Date('2026-05-26T18:10:00.000Z'),
    });
    assert.equal(forgedDeletePlan.status, 'ready');
    assert.equal(forgedDeletePlan.mutations.length, 1);
    assert.equal(forgedDeletePlan.mutations[0].resourceKey, driverFixture.resourceKey);
    assert.equal(forgedDeletePlan.mutations[0].action, 'delete');
    assert.equal(forgedDeletePlan.mutations[0].pluginOwnedResource?.supportsDelete, true);

    const dryRun = await client.signedPost(
      '/dry-run',
      { plan: forgedDeletePlan },
      {
        session,
        idempotencyKey: 'production-plugin-driver-delete-dry-run',
      },
    );
    assert.equal(dryRun.status, 400);
    assert.equal(dryRun.body?.ok, false);
    assert.ok(
      dryRun.body?.code === 'INVALID_PLAN' || dryRun.body?.code === 'PUSH_PROTOCOL_ERROR',
      `unexpected forged delete dry-run code: ${dryRun.body?.code}`,
    );
    assert.match(
      dryRun.body?.message || '',
      /does not support deletes|blocked plan|plan not ready/i,
      'packaged dry-run route did not reject the forged driver delete',
    );

    const afterRejectedApply = await client.get('/snapshot');
    assert.equal(afterRejectedApply.status, 200);
    assert.equal(afterRejectedApply.body?.ok, true);
    assert.equal(
      afterRejectedApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'rejected packaged driver delete still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterRejectedApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'rejected packaged driver delete changed the updated arbitrary driver payload',
    );

    summary.driverUpdateApply = {
      resourceKey: driverFixture.resourceKey,
      remoteSupportsDelete: allowedEntry.supportsDelete,
      dryRunReceiptHash: updateDryRun.body?.receipt?.receiptHash,
      applied: updateApply.body?.applied,
      updatedMarkerAfterApply: afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      payloadModeAfterApply: afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
    };
    if (runPlanBindingGuard) {
      await runScenario('driver-receipt-plan-binding-guard', async () => {
        summary.driverReceiptPlanBindingGuard = {
          resourceKey: driverFixture.resourceKey,
          tamperedMode: tamperedPlan.mutations[0].value.value.payload.mode,
          tamperedVersion: tamperedPlan.mutations[0].value.value.payload.version,
          applyRejectedCode: tamperedPlanApply.body?.code,
          applyRejectedMessage: tamperedPlanApply.body?.message,
          rowRetainedAfterReject: afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterUpdateApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }
    if (runDeleteGuard) {
      await runScenario('driver-delete-guard', async () => {
        summary.driverDeleteGuard = {
          resourceKey: driverFixture.resourceKey,
          remoteSupportsDelete: allowedEntry.supportsDelete,
          forgedPlanAcceptedByDryRun: dryRun.body?.ok === true,
          dryRunRejectedCode: dryRun.body?.code,
          dryRunRejectedMessage: dryRun.body?.message,
          rowRetainedAfterReject: afterRejectedApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterRejectedApply.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
        };
      });
    }

    const invalidUpdatePlan = createPushPlan({
      base: driverGuardBaseSnapshot,
      local: driverLocalInvalidUpdateSnapshot,
      remote: remoteSnapshot.body.snapshot,
      now: new Date('2026-05-26T18:11:00.000Z'),
    });
    assert.equal(invalidUpdatePlan.status, 'ready');
    assert.equal(invalidUpdatePlan.mutations.length, 1);
    assert.equal(invalidUpdatePlan.mutations[0].resourceKey, driverFixture.resourceKey);
    assert.equal(invalidUpdatePlan.mutations[0].action, 'put');
    assert.equal(invalidUpdatePlan.mutations[0].pluginOwnedResource?.driver, driverFixture.driver);
    assert.equal(invalidUpdatePlan.mutations[0].pluginOwnedResource?.table, driverFixture.table);

    const invalidUpdateDryRun = await client.signedPost(
      '/dry-run',
      { plan: invalidUpdatePlan },
      {
        session,
        idempotencyKey: 'production-plugin-driver-invalid-update-dry-run',
      },
    );
    assert.equal(invalidUpdateDryRun.status, 400);
    assert.equal(invalidUpdateDryRun.body?.ok, false);
    assert.ok(
      invalidUpdateDryRun.body?.code === 'INVALID_PLAN' || invalidUpdateDryRun.body?.code === 'PUSH_PROTOCOL_ERROR',
      `unexpected invalid driver update dry-run code: ${invalidUpdateDryRun.body?.code}`,
    );
    assert.match(
      invalidUpdateDryRun.body?.message || '',
      /updated_marker|unsupported plugin-owned mutation driver|invalid/i,
      'packaged dry-run route did not reject the invalid arbitrary driver update',
    );

    const afterInvalidUpdateReject = await client.get('/snapshot');
    assert.equal(afterInvalidUpdateReject.status, 200);
    assert.equal(afterInvalidUpdateReject.body?.ok, true);
    assert.equal(
      afterInvalidUpdateReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'rejected packaged driver update still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterInvalidUpdateReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'rejected packaged driver update changed the arbitrary driver payload',
    );

    if (runUpdateValidationGuard) {
      await runScenario('driver-update-validation-guard', async () => {
        summary.driverUpdateValidationGuard = {
          resourceKey: driverFixture.resourceKey,
          invalidUpdatedMarker: driverLocalInvalidUpdateSnapshot.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
          dryRunRejectedCode: invalidUpdateDryRun.body?.code,
          dryRunRejectedMessage: invalidUpdateDryRun.body?.message,
          rowRetainedAfterReject: afterInvalidUpdateReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterInvalidUpdateReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterInvalidUpdateReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }

    const expiredReceiptApply = await client.signedPost(
      '/apply',
      {
        plan: updatePlan,
        receipt: mutateReceipt(updateDryRun.body.receipt, (receipt) => {
          receipt.authBinding.expiresAt = '2000-01-01T00:00:00Z';
        }),
      },
      {
        session,
        idempotencyKey: 'production-plugin-driver-expired-receipt-apply',
      },
    );
    assert.equal(expiredReceiptApply.status, 409);
    assert.equal(expiredReceiptApply.body?.ok, false);
    assert.equal(expiredReceiptApply.body?.code, 'AUTH_RECEIPT_EXPIRED');

    const afterExpiredReceiptReject = await client.get('/snapshot');
    assert.equal(afterExpiredReceiptReject.status, 200);
    assert.equal(afterExpiredReceiptReject.body?.ok, true);
    assert.equal(
      afterExpiredReceiptReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'expired packaged driver receipt still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterExpiredReceiptReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'expired packaged driver receipt changed the arbitrary driver payload',
    );

    if (runExpiryGuard) {
      await runScenario('driver-receipt-expiry-guard', async () => {
        summary.driverReceiptExpiryGuard = {
          resourceKey: driverFixture.resourceKey,
          applyRejectedCode: expiredReceiptApply.body?.code,
          applyRejectedMessage: expiredReceiptApply.body?.message,
          rowRetainedAfterReject: afterExpiredReceiptReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterExpiredReceiptReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterExpiredReceiptReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }

    const alternateClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: alternateCredentials,
      routeProfile: 'production-shaped',
    });
    const alternatePreflight = await alternateClient.signedGet('/preflight');
    assert.equal(alternatePreflight.status, 200);
    assert.equal(alternatePreflight.body?.ok, true);
    const alternateSession = alternatePreflight.body?.session?.id;
    assert.equal(typeof alternateSession, 'string');
    assert.ok(alternateSession.length > 0, 'alternate packaged signed preflight did not return a session id');

    const identityMismatchApply = await alternateClient.signedPost(
      '/apply',
      {
        plan: updatePlan,
        receipt: updateDryRun.body.receipt,
      },
      {
        session: alternateSession,
        idempotencyKey: 'production-plugin-driver-identity-mismatch-apply',
      },
    );
    assert.equal(identityMismatchApply.status, 409);
    assert.equal(identityMismatchApply.body?.ok, false);
    assert.equal(identityMismatchApply.body?.code, 'AUTH_RECEIPT_MISMATCH');

    const afterIdentityMismatchReject = await client.get('/snapshot');
    assert.equal(afterIdentityMismatchReject.status, 200);
    assert.equal(afterIdentityMismatchReject.body?.ok, true);
    assert.equal(
      afterIdentityMismatchReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'identity-mismatched packaged apply still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterIdentityMismatchReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'identity-mismatched packaged apply changed the arbitrary driver payload',
    );

    if (runIdentityGuard) {
      await runScenario('driver-receipt-identity-guard', async () => {
        summary.driverReceiptIdentityGuard = {
          resourceKey: driverFixture.resourceKey,
          mismatchedUser: alternateCredentials.username,
          applyRejectedCode: identityMismatchApply.body?.code,
          applyRejectedMessage: identityMismatchApply.body?.message,
          rowRetainedAfterReject: afterIdentityMismatchReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterIdentityMismatchReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterIdentityMismatchReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }

    const rotatedClient = authenticatedHttpClient({
      sourceUrl: server.baseUrl,
      credential: rotatedCredentials,
      routeProfile: 'production-shaped',
    });
    const rotatedPreflight = await rotatedClient.signedGet('/preflight');
    assert.equal(rotatedPreflight.status, 200);
    assert.equal(rotatedPreflight.body?.ok, true);
    assert.equal(rotatedPreflight.body?.auth?.identity?.userLogin, credentials.username);
    assert.notEqual(
      rotatedPreflight.body?.auth?.session?.applicationPasswordUuid,
      preflight.body?.auth?.session?.applicationPasswordUuid,
      'rotated packaged signed preflight should mint a distinct application password uuid for the same user',
    );
    const rotatedSession = rotatedPreflight.body?.session?.id;
    assert.equal(typeof rotatedSession, 'string');
    assert.ok(rotatedSession.length > 0, 'rotated packaged signed preflight did not return a session id');

    const rotatedCredentialApply = await rotatedClient.signedPost(
      '/apply',
      {
        plan: updatePlan,
        receipt: updateDryRun.body.receipt,
      },
      {
        session: rotatedSession,
        idempotencyKey: 'production-plugin-driver-rotated-credential-apply',
      },
    );
    assert.equal(rotatedCredentialApply.status, 409);
    assert.equal(rotatedCredentialApply.body?.ok, false);
    assert.equal(rotatedCredentialApply.body?.code, 'AUTH_RECEIPT_MISMATCH');

    const afterRotatedCredentialReject = await client.get('/snapshot');
    assert.equal(afterRotatedCredentialReject.status, 200);
    assert.equal(afterRotatedCredentialReject.body?.ok, true);
    assert.equal(
      afterRotatedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'rotated-credential packaged apply still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterRotatedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'rotated-credential packaged apply changed the arbitrary driver payload',
    );

    if (runRotatedCredentialGuard) {
      await runScenario('driver-receipt-rotated-credential-guard', async () => {
        summary.driverReceiptRotatedCredentialGuard = {
          resourceKey: driverFixture.resourceKey,
          rotatedUser: rotatedCredentials.username,
          rotatedCredentialRejectedCode: rotatedCredentialApply.body?.code,
          rotatedCredentialRejectedMessage: rotatedCredentialApply.body?.message,
          originalApplicationPasswordUuid: preflight.body?.auth?.session?.applicationPasswordUuid,
          rotatedApplicationPasswordUuid: rotatedPreflight.body?.auth?.session?.applicationPasswordUuid,
          rowRetainedAfterReject: afterRotatedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterRotatedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterRotatedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }

    const revokedCredentialUuid = preflight.body?.auth?.session?.applicationPasswordUuid;
    assert.equal(typeof revokedCredentialUuid, 'string');
    assert.ok(revokedCredentialUuid.length > 0, 'packaged signed preflight did not return an application password uuid to revoke');
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
      afterRevokedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
      'local-update',
      'revoked-credential packaged apply still mutated the remote snapshot',
    );
    assert.deepEqual(
      afterRevokedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload,
      {
        owner: driverFixture.pluginOwner,
        mode: 'local-update',
        version: 2,
      },
      'revoked-credential packaged apply changed the arbitrary driver payload',
    );

    if (runRevokedCredentialGuard) {
      await runScenario('driver-receipt-revoked-credential-guard', async () => {
        summary.driverReceiptRevokedCredentialGuard = {
          resourceKey: driverFixture.resourceKey,
          revokedCredentialUuid,
          rotatedCredentialUsedForRevocation: rotatedPreflight.body?.auth?.session?.applicationPasswordUuid,
          revokeDeleted: revokeResponse.body?.deleted === true,
          applyRejectedCode: revokedCredentialApply.body?.code,
          applyRejectedMessage: revokedCredentialApply.body?.message,
          rowRetainedAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1'] !== undefined,
          payloadModeAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.payload?.mode,
          updatedMarkerAfterReject: afterRevokedCredentialReject.body.snapshot?.db?.[driverFixture.table]?.['entry_id:1']?.updated_marker,
        };
      });
    }

        if (reuseGuardServerForDelete) {
          await runScenario('driver-delete-apply', async () => {
            await executeDriverDeleteApplyScenario(server, activeDeleteFixture, alternateCredentials);
          });
        }
      },
    );
  }

  if (shouldRunAnyScenario(['driver-delete-apply']) && !reuseGuardServerForDelete) {
    await runScenario('driver-delete-apply', async () => {
      await withPlaygroundServer('production-plugin-driver-delete-apply', driverDeleteServerBlueprintPath, pluginDir, async (server) => {
        await executeDriverDeleteApplyScenario(server, activeDeleteFixture);
      });
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
      resourceKey: driverFixture.resourceKey,
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
      resourceKey: driverFixture.resourceKey,
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
      resourceKey: driverFixture.resourceKey,
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

  attachProductionPluginPackagePluginDriverProof(summary, {
    requestedScenarios,
    selectedScenarios,
    resolvedMode,
    canonicalMode,
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await cleanupSmokeArtifacts();
}

function preparePackageSnapshots() {
  logSmokeStage('prepare-base-snapshots', formatSelectedScenarioNames(selectedScenarios));
  const snapshots = Object.fromEntries(
    Object.entries(fixtures).map(([name, fixture]) => [
      name,
      exportSnapshotWithStage(name, path.join(repoRoot, fixture)),
    ]),
  );

  return {
    base: snapshots.base,
    local: withoutUnmappedGraphPostmeta(snapshots.local),
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

function shouldRunAnyScenario(names) {
  return selectedScenarios === null || names.some((name) => selectedScenarios.has(name));
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

function assertSyncChildCompleted(result, label) {
  if (!result.error && result.signal === null) {
    return;
  }

  const errorMessage = result.error instanceof Error
    ? result.error.stack ?? result.error.message
    : String(result.error ?? 'unknown error');
  throw new Error(
    `${label} did not complete cleanly`
    + `\nSTATUS: ${result.status}`
    + `\nSIGNAL: ${result.signal}`
    + `\nERROR: ${errorMessage}`
    + `\nSTDOUT:\n${result.stdout}`
    + `\nSTDERR:\n${result.stderr}`,
  );
}

function exportSnapshotWithStage(name, blueprintPath) {
  logSmokeStage('export-snapshot:start', name);
  const snapshot = exportSnapshot(name, blueprintPath);
  logSmokeStage('export-snapshot:ok', name);
  return snapshot;
}

function enableForgedDeletePolicy(snapshot, resourceKey) {
  const allowedResources = snapshot?.meta?.pluginOwnedResources?.allowedResources;
  if (!Array.isArray(allowedResources)) {
    return snapshot;
  }
  const entry = allowedResources.find((candidate) => candidate?.resourceKey === resourceKey);
  if (!entry || typeof entry !== 'object') {
    return snapshot;
  }
  entry.supportsDelete = true;
  entry.allowDelete = true;
  return snapshot;
}

function runPackagedDriverRegistryGuard(scenarioName, mountedPluginDir) {
  if (packagedDriverRegistryGuardResults === null) {
    packagedDriverRegistryGuardResults = selectedScenarios === null
      ? runPackagedDriverRegistryGuards(mountedPluginDir)
      : {};
  }
  if (!Object.hasOwn(packagedDriverRegistryGuardResults, scenarioName)) {
    const pendingScenarioNames = getPendingPackagedDriverRegistryGuardScenarios(scenarioName);
    const guardResults = runPackagedDriverRegistryGuards(mountedPluginDir, pendingScenarioNames);
    Object.assign(packagedDriverRegistryGuardResults, guardResults);
  }
  return packagedDriverRegistryGuardResults[scenarioName];
}

function getPendingPackagedDriverRegistryGuardScenarios(scenarioName) {
  if (selectedScenarios === null) {
    return [scenarioName];
  }

  const pendingScenarioNames = Array.from(selectedScenarios).filter(
    (name) =>
      packagedDriverRegistryGuardScenarioNames.has(name)
      && !Object.hasOwn(packagedDriverRegistryGuardResults, name),
  );
  if (pendingScenarioNames.length > 0) {
    return pendingScenarioNames.sort();
  }

  return [scenarioName];
}

function runPackagedDriverRegistryGuards(mountedPluginDir, scenarioNames = null) {
  const scenarioArgs = Array.isArray(scenarioNames)
    ? scenarioNames
    : scenarioNames === null
      ? []
      : [scenarioNames];
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    registryGuardBlueprintPath,
    '--mount',
    `${mountedPluginDir}:/wordpress/wp-content/plugins/reprint-push`,
    '--mount',
    `${tmpDir}:/tmp/reprint-production-plugin-package`,
    '--verbosity',
    'quiet',
    '--',
    '/tmp/reprint-production-plugin-package/packaged-driver-registry-guards.php',
    ...scenarioArgs,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: syncChildTimeoutMs,
    killSignal: syncChildKillSignal,
  });

  assertSyncChildCompleted(result, 'Packaged driver registry guard export');
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
      '$past = time() - 60;',
      '$future = time() + 3600;',
      "add_option('reprint_push_lab_signed_session_' . str_repeat('a', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_session_' . str_repeat('b', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-session'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . str_repeat('c', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$past,'fixture'=>'expired-nonce'), '', 'no');",
      "add_option('reprint_push_lab_signed_nonce_' . str_repeat('d', 64), array('schemaVersion'=>1,'expiresAtUnix'=>$future,'fixture'=>'future-nonce'), '', 'no');",
    ].join(' '),
  });
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function writePackagedPluginOnlyBlueprint(sourceBlueprintPath, targetBlueprintPath) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Production Plugin Registry Guards',
    description: 'Remote base fixture with only the packaged Reprint Push plugin activated for registry-guard checks.',
  };
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
  fs.writeFileSync(targetBlueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
}

function writeDriverFixtureBlueprint(
  sourceBlueprintPath,
  targetBlueprintPath,
  {
    activatePackagedPlugin = false,
    provisionAuth = false,
    enableCredentialRevocationRoute = false,
    supportsDelete = false,
    includeDeleteDriver = false,
    omitExportRowsCallback = false,
    omitApplyRowCallback = false,
    omitValidateMutationCallback = false,
    blankDriverName = false,
    omitPluginOwner = false,
    omitTable = false,
    duplicateDriverName = false,
    duplicateTable = false,
  } = {},
) {
  const blueprint = JSON.parse(fs.readFileSync(sourceBlueprintPath, 'utf8'));
  blueprint.meta = {
    ...blueprint.meta,
    title: 'Reprint Push Driver Fixture Package Guard',
    description: 'Remote base fixture with packaged Reprint Push plus an arbitrary plugin-owned row driver fixture.',
  };
  const pluginCodeBase64 = Buffer.from(driverFixturePluginPhp({
    enableCredentialRevocationRoute,
    supportsDelete,
    includeDeleteDriver,
    omitExportRowsCallback,
    omitApplyRowCallback,
    omitValidateMutationCallback,
    blankDriverName,
    omitPluginOwner,
    omitTable,
    duplicateDriverName,
    duplicateTable,
  }), 'utf8').toString('base64');
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
      ...(includeDeleteDriver ? [
        '$delete_table = $wpdb->prefix . \'reprint_push_driver_fixture_delete\';',
        '$wpdb->query(\'CREATE TABLE \' . $delete_table . \' (entry_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (entry_id)) \' . $wpdb->get_charset_collate());',
        '$delete_payload = wp_json_encode(array(\'owner\' => \'driver-fixture\', \'mode\' => \'delete-base\', \'version\' => 1));',
        '$wpdb->replace($delete_table, array(\'entry_id\' => 1, \'payload_json\' => $delete_payload, \'updated_marker\' => \'delete-base\'), array(\'%d\', \'%s\', \'%s\'));',
      ] : []),
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
        '$result = reprint_push_lab_rest_provision_push_application_password(array(\'login\' => \'reprint_push_alt_admin\', \'appPassword\' => \'reprint-push-alt-admin-app-password\', \'role\' => \'administrator\', \'slug\' => \'alternate-admin\', \'name\' => \'Reprint Push Package Smoke Alt\', \'createUser\' => true, \'updateRole\' => true));',
        'if (empty($result[\'ok\'])) { throw new RuntimeException((string) ($result[\'message\'] ?? \'alternate push credential provisioning failed\')); }',
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

function driverFixturePluginPhp({
  enableCredentialRevocationRoute = false,
  supportsDelete,
  includeDeleteDriver = false,
  omitExportRowsCallback = false,
  omitApplyRowCallback = false,
  omitValidateMutationCallback = false,
  blankDriverName = false,
  omitPluginOwner = false,
  omitTable = false,
  duplicateDriverName = false,
  duplicateTable = false,
}) {
  const exportRowsCallback = omitExportRowsCallback
    ? ''
    : "        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',\n";
  const applyRowCallback = omitApplyRowCallback
    ? ''
    : "        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',\n";
  const validateMutationCallback = omitValidateMutationCallback
    ? ''
    : "        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',\n";
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
        'driver' => '${blankDriverName ? '' : driverFixture.driver}',
${omitTable ? '' : `        'table' => '${driverFixture.table}',`}
${omitPluginOwner ? '' : `        'pluginOwner' => '${driverFixture.pluginOwner}',`}
        'supportsDelete' => ${supportsDelete ? 'true' : 'false'},
${exportRowsCallback}${applyRowCallback}${validateMutationCallback}
    ];
${duplicateDriverName ? `    $drivers['${driverFixture.driver}-duplicate'] = [
        'driver' => '${driverFixture.driver}',
        'table' => '${driverFixture.table}_duplicate',
        'pluginOwner' => '${driverFixture.pluginOwner}',
        'supportsDelete' => ${supportsDelete ? 'true' : 'false'},
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
` : ''}${duplicateTable ? `    $drivers['${driverFixture.driver}-same-table'] = [
        'driver' => '${driverFixture.driver}-same-table',
        'table' => '${driverFixture.table}',
        'pluginOwner' => '${driverFixture.pluginOwner}',
        'supportsDelete' => ${supportsDelete ? 'true' : 'false'},
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
` : ''}${includeDeleteDriver ? `    $drivers['${deleteDriverFixture.driver}'] = [
        'driver' => '${deleteDriverFixture.driver}',
        'table' => '${deleteDriverFixture.table}',
        'pluginOwner' => '${deleteDriverFixture.pluginOwner}',
        'supportsDelete' => true,
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
` : ''}    return $drivers;
});

function reprint_push_driver_fixture_table_name_for_driver(array $driver): string {
    $table_name = (string) ($driver['table'] ?? '');
    if ($table_name === '' || !preg_match('/^[A-Za-z0-9_]+$/', $table_name)) {
        throw new RuntimeException('Unsupported driver fixture table: ' . $table_name);
    }
    return $table_name;
}

${enableCredentialRevocationRoute ? `function reprint_push_driver_fixture_revoke_application_password(WP_REST_Request $request): WP_REST_Response {
    $uuid = (string) $request['uuid'];
    $user = wp_get_current_user();
    $user_id = (int) ($user->ID ?? 0);
    if ($user_id < 1) {
        return new WP_REST_Response([
            'deleted' => false,
            'code' => 'reprint_push_driver_fixture_user_missing',
        ], 401);
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
    $table_name = reprint_push_driver_fixture_table_name_for_driver($driver);
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists !== $table_name) {
        return;
    }
    $table = (string) ($driver['table'] ?? '');
    if ($table === '') {
        return;
    }
    if (!isset($snapshot['db'][$table]) || !is_array($snapshot['db'][$table])) {
        $snapshot['db'][$table] = [];
    }
    $rows = $wpdb->get_results("SELECT entry_id, payload_json, updated_marker FROM {$table_name} ORDER BY entry_id ASC", ARRAY_A);
    foreach ($rows as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        $snapshot['db'][$table]['entry_id:' . (int) $row['entry_id']] = [
            'entry_id' => (int) $row['entry_id'],
            'payload' => json_last_error() === JSON_ERROR_NONE ? reprint_push_normalize_snapshot_value($payload) : (string) $row['payload_json'],
            'updated_marker' => (string) $row['updated_marker'],
            '__pluginOwner' => (string) ($driver['pluginOwner'] ?? ''),
        ];
    }
}

function reprint_push_driver_fixture_apply_row(string $id, bool $is_delete, $value, array $driver): void {
    global $wpdb;
    if (!preg_match('/^entry_id:([1-9]\\d*)$/', $id, $matches)) {
        throw new RuntimeException('Unsupported driver fixture row id: ' . $id);
    }
    $entry_id = (int) $matches[1];
    $table_name = reprint_push_driver_fixture_table_name_for_driver($driver);
    $wpdb->query('CREATE TABLE IF NOT EXISTS ' . $table_name . ' (entry_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (entry_id)) ' . $wpdb->get_charset_collate());
    if ($is_delete) {
        $wpdb->delete($table_name, ['entry_id' => $entry_id], ['%d']);
        return;
    }
    if (!is_array($value) || (int) ($value['entry_id'] ?? 0) !== $entry_id) {
        throw new RuntimeException('Driver fixture payload does not match row id: ' . $id);
    }
    if ((string) ($value['__pluginOwner'] ?? '') !== (string) ($driver['pluginOwner'] ?? '')) {
        throw new RuntimeException('Driver fixture payload owner does not match registered driver: ' . $id);
    }
    if (!is_array($value['payload'] ?? null) || array_is_list($value['payload'])) {
        throw new RuntimeException('Driver fixture payload must include an object payload: ' . $id);
    }
    $payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($value['payload']));
    if (!is_string($payload_json)) {
        throw new RuntimeException('Could not encode driver fixture payload: ' . $id);
    }
    $updated_marker = (string) ($value['updated_marker'] ?? '');
    if (!preg_match('/^[a-z0-9_-]{1,32}$/', $updated_marker)) {
        throw new RuntimeException('Unsupported driver fixture updated_marker: ' . $updated_marker);
    }
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
    $value = is_array($mutation['value']['value'] ?? null) ? $mutation['value']['value'] : null;
    if (($resource['table'] ?? '') !== ($driver['table'] ?? '') || ($driver['pluginOwner'] ?? '') === '') {
        return false;
    }
    if (!preg_match('/^entry_id:([1-9]\\d*)$/', (string) ($resource['id'] ?? ''))) {
        throw new RuntimeException('Unsupported driver fixture row id: ' . (string) ($resource['id'] ?? ''));
    }
    if (!empty($mutation['value']['absent'])) {
        return !empty($driver['supportsDelete']);
    }
    if (!is_array($value) || array_is_list($value)) {
        throw new RuntimeException('Driver fixture mutation payload must be an object.');
    }
    if ((int) ($value['entry_id'] ?? 0) < 1) {
        throw new RuntimeException('Driver fixture mutation payload is missing a valid entry_id.');
    }
    if ((string) ($value['__pluginOwner'] ?? '') !== (string) ($driver['pluginOwner'] ?? '')) {
        throw new RuntimeException('Driver fixture mutation payload owner does not match the registered plugin owner.');
    }
    if (!is_array($value['payload'] ?? null) || array_is_list($value['payload'])) {
        throw new RuntimeException('Driver fixture mutation payload must include an object payload.');
    }
    $updated_marker = (string) ($value['updated_marker'] ?? '');
    if (!preg_match('/^[a-z0-9_-]{1,32}$/', $updated_marker)) {
        throw new RuntimeException('Driver fixture updated_marker must match /^[a-z0-9_-]{1,32}$/.');
    }
    return true;
}
`;
}

function runCli(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: syncChildTimeoutMs,
    killSignal: syncChildKillSignal,
  });

  assertSyncChildCompleted(result, `CLI command ${args.join(' ')}`);
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
    timeout: syncChildTimeoutMs,
    killSignal: syncChildKillSignal,
  });

  assertSyncChildCompleted(result, `Playground snapshot export for ${name}`);
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

async function startPlaygroundServer(
  name,
  blueprintPath,
  mountedPluginDir,
  {
    authBootstrap = true,
    readyPath = '/wp-json/reprint/v1/push/snapshot',
    readyHeaders = null,
    readyOk = null,
  } = {},
) {
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
  activePlaygroundChildren.add(child);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  try {
    await waitForServer(child, baseUrl, logs, {
      readyPath,
      readyHeaders: readyHeaders ?? authHeaders(),
      readyOk: readyOk ?? ((response) => response.status === 200 && response.body?.ok === true),
    });
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { name, port, baseUrl, child, logs };
}

async function waitForServer(child, baseUrl, logs, { readyPath, readyHeaders, readyOk }) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await requestJson(
        baseUrl,
        'GET',
        readyPath,
        undefined,
        readyHeaders,
        { attempts: 2 },
      );
      if (readyOk(response)) {
        return;
      }
      lastError = new Error(`Playground readiness probe ${readyPath} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message || 'unknown'}\n${logs.join('')}`);
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    activePlaygroundChildren.delete(child);
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  } finally {
    activePlaygroundChildren.delete(child);
  }
}

function installSignalCleanup() {
  if (signalCleanupInstalled) {
    return;
  }
  signalCleanupInstalled = true;
  process.on('exit', removeTmpDirSync);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void cleanupSmokeArtifacts().finally(() => {
        process.exit(1);
      });
    });
  }
}

function removeTmpDirSync() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function cleanupSmokeArtifacts() {
  if (cleanupInFlight) {
    return cleanupInFlight;
  }
  cleanupInFlight = (async () => {
    await Promise.allSettled(
      Array.from(activePlaygroundChildren, (child) => stopChildProcess(child)),
    );
    removeTmpDirSync();
  })();
  return cleanupInFlight;
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
  assert.equal(result?.error?.class, 'RuntimeException');
  assert.match(result?.error?.message || '', expectedPattern, message);
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

function mutateReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
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
