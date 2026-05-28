import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotLibPath = path.join(repoRoot, 'scripts/playground/snapshot-lib.php');

function runPhpDriverProbe(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-plugin-driver-api-'));
  const file = path.join(dir, 'probe.php');
  fs.writeFileSync(file, `<?php
function apply_filters($hook_name, $value) { return $value; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
require ${JSON.stringify(snapshotLibPath)};
function rpp_driver_api_export_rows(array &$snapshot, array $driver): void {}
function rpp_driver_api_apply_row(string $id, bool $is_delete, $value, array $driver): void {}
function rpp_driver_api_validate_mutation(array $mutation, array $snapshot, array $driver): bool { return true; }
function rpp_driver_api_capture(callable $callback): array {
    try {
        return ['ok' => true, 'value' => $callback()];
    } catch (Throwable $error) {
        return ['ok' => false, 'error' => ['class' => get_class($error), 'message' => $error->getMessage()]];
    }
}
${body}
`, 'utf8');
  const result = spawnSync('php', [file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

test('plugin-owned row driver registration API normalizes and exposes exact registered behavior', () => {
  const report = runPhpDriverProbe(`
$registered = reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-driver-api',
    'table' => 'wp_fixture_driver_api',
    'pluginOwner' => 'fixture-plugin',
    'supportsDelete' => true,
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$drivers = reprint_push_registered_plugin_owned_row_drivers();
$by_name = reprint_push_plugin_owned_row_driver_by_name('fixture-driver-api');
$by_table = reprint_push_plugin_owned_row_driver_for_table('wp_fixture_driver_api');
$missing = reprint_push_plugin_owned_row_driver_by_name('missing-driver');
echo json_encode([
    'registered' => [
        'driver' => $registered['driver'],
        'table' => $registered['table'],
        'pluginOwner' => $registered['pluginOwner'],
        'supportsDelete' => $registered['supportsDelete'],
        'callbacks' => [
            'export' => $registered['exportRowsCallback'],
            'apply' => $registered['applyRowCallback'],
            'validate' => $registered['validateMutationCallback'],
        ],
    ],
    'driverNames' => array_keys($drivers),
    'byName' => [
        'driver' => $by_name['driver'],
        'table' => $by_name['table'],
        'pluginOwner' => $by_name['pluginOwner'],
        'supportsDelete' => $by_name['supportsDelete'],
    ],
    'byTable' => [
        'driver' => $by_table['driver'],
        'table' => $by_table['table'],
        'pluginOwner' => $by_table['pluginOwner'],
        'supportsDelete' => $by_table['supportsDelete'],
    ],
    'missingDriver' => $missing,
]);
`);

  assert.deepEqual(report.registered, {
    driver: 'fixture-driver-api',
    table: 'wp_fixture_driver_api',
    pluginOwner: 'fixture-plugin',
    supportsDelete: true,
    callbacks: {
      export: 'rpp_driver_api_export_rows',
      apply: 'rpp_driver_api_apply_row',
      validate: 'rpp_driver_api_validate_mutation',
    },
  });
  assert.deepEqual(report.byName, {
    driver: 'fixture-driver-api',
    table: 'wp_fixture_driver_api',
    pluginOwner: 'fixture-plugin',
    supportsDelete: true,
  });
  assert.deepEqual(report.byTable, report.byName);
  assert.equal(report.missingDriver, null);
  assert.deepEqual(report.driverNames, [
    'reprint-push-release-state',
    'fixture-driver-api',
  ]);
});

test('plugin-owned row driver registration API fails closed on duplicate and malformed registrations', () => {
  const report = runPhpDriverProbe(`
reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-driver-api',
    'table' => 'wp_fixture_driver_api',
    'pluginOwner' => 'fixture-plugin',
    'supportsDelete' => false,
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$results = [];
$results['duplicateName'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-driver-api',
        'table' => 'wp_fixture_driver_api_other',
        'pluginOwner' => 'fixture-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$results['duplicateTable'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-driver-api-other',
        'table' => 'wp_fixture_driver_api',
        'pluginOwner' => 'fixture-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$results['duplicateBuiltinTable'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-release-state-shadow',
        'table' => 'wp_reprint_push_release_state',
        'pluginOwner' => 'fixture-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$results['missingValidateCallback'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-driver-api-missing-validate',
        'table' => 'wp_fixture_driver_api_missing_validate',
        'pluginOwner' => 'fixture-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
    ]);
});
$results['registeredNamesAfterFailures'] = array_keys(reprint_push_registered_plugin_owned_row_drivers());
echo json_encode($results);
`);

  assert.equal(report.duplicateName.ok, false);
  assert.match(report.duplicateName.error.message, /^duplicate driver name: fixture-driver-api$/);
  assert.equal(report.duplicateTable.ok, false);
  assert.match(report.duplicateTable.error.message, /^duplicate table mapping for table: wp_fixture_driver_api$/);
  assert.equal(report.duplicateBuiltinTable.ok, false);
  assert.match(report.duplicateBuiltinTable.error.message, /^duplicate table mapping for table: wp_reprint_push_release_state$/);
  assert.equal(report.missingValidateCallback.ok, false);
  assert.match(report.missingValidateCallback.error.message, /^missing validateMutationCallback for driver: fixture-driver-api-missing-validate$/);
  assert.deepEqual(report.registeredNamesAfterFailures, [
    'reprint-push-release-state',
    'fixture-driver-api',
  ]);
});
