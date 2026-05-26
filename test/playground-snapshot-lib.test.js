import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotLib = path.join(repoRoot, 'scripts/playground/snapshot-lib.php');
const hasPhp = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;

function assertSupported(resource) {
  const result = runSupportCheck(resource);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'supported');
}

function assertRejected(resource, pattern) {
  const result = runSupportCheck(resource);
  assert.notEqual(result.status, 0, 'resource should be rejected');
  assert.match(result.stderr, pattern);
}

function runSupportCheck(resource) {
  return spawnSync('php', [
    '-r',
    [
      'require $argv[1];',
      '$resource = json_decode($argv[2], true);',
      'try {',
      'reprint_push_assert_supported_apply_resource($resource);',
      'echo "supported";',
      '} catch (Throwable $error) {',
      'fwrite(STDERR, $error->getMessage());',
      'exit(2);',
      '}',
    ].join(' '),
    snapshotLib,
    JSON.stringify(resource),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runSupportCheckWithDrivers(resource, drivers) {
  return spawnSync('php', [
    '-r',
    [
      'function fixture_export_rows() {}',
      'function fixture_apply_row() {}',
      'function fixture_validate_mutation() {}',
      'function apply_filters($tag, $value) {',
      '  if ($tag === "reprint_push_plugin_owned_row_drivers") {',
      '    return json_decode($GLOBALS["argv"][3], true);',
      '  }',
      '  return $value;',
      '}',
      'require $argv[1];',
      '$resource = json_decode($argv[2], true);',
      'try {',
      'reprint_push_assert_supported_apply_resource($resource);',
      'echo "supported";',
      '} catch (Throwable $error) {',
      'fwrite(STDERR, $error->getMessage());',
      'exit(2);',
      '}',
    ].join(' '),
    snapshotLib,
    JSON.stringify(resource),
    JSON.stringify(drivers),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDriverRegistryCheck(drivers) {
  return spawnSync('php', [
    '-r',
    [
      'function fixture_export_rows() {}',
      'function fixture_apply_row() {}',
      'function fixture_validate_mutation() {}',
      'function apply_filters($tag, $value) {',
      '  if ($tag === "reprint_push_plugin_owned_row_drivers") {',
      '    return json_decode($GLOBALS["argv"][2], true);',
      '  }',
      '  return $value;',
      '}',
      'require $argv[1];',
      'try {',
      '  $drivers = reprint_push_plugin_owned_row_drivers();',
      '  fwrite(STDOUT, json_encode($drivers));',
      '} catch (Throwable $error) {',
      '  fwrite(STDERR, $error->getMessage());',
      '  exit(2);',
      '}',
    ].join(' '),
    snapshotLib,
    JSON.stringify(drivers),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runPluginOwnedPolicyCheck(snapshot, drivers) {
  return spawnSync('php', [
    '-r',
    [
      'function fixture_export_rows() {}',
      'function fixture_apply_row() {}',
      'function fixture_validate_mutation() {}',
      'function apply_filters($tag, $value) {',
      '  if ($tag === "reprint_push_plugin_owned_row_drivers") {',
      '    return json_decode($GLOBALS["argv"][3], true);',
      '  }',
      '  return $value;',
      '}',
      'function wp_json_encode($value, $flags = 0, $depth = 512) {',
      '  return json_encode($value, $flags, $depth);',
      '}',
      'require $argv[1];',
      '$snapshot = json_decode($argv[2], true);',
      'try {',
      '  reprint_push_add_plugin_owned_policy($snapshot);',
      '  fwrite(STDOUT, json_encode($snapshot["meta"]["pluginOwnedResources"]["allowedResources"] ?? []));',
      '} catch (Throwable $error) {',
      '  fwrite(STDERR, $error->getMessage());',
      '  exit(2);',
      '}',
    ].join(' '),
    snapshotLib,
    JSON.stringify(snapshot),
    JSON.stringify(drivers),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('snapshot apply gate allows only named lab plugin resources', { skip: !hasPhp }, () => {
  assertSupported({ type: 'plugin', name: 'reprint-push-forms-fixture' });
  assertSupported({ type: 'plugin', name: 'reprint-push-atomic-dependency-fixture' });

  assertRejected(
    { type: 'plugin', name: 'akismet' },
    /Unsupported fixture plugin: akismet/,
  );
});

test('snapshot apply gate allows only named lab plugin file paths', { skip: !hasPhp }, () => {
  assertSupported({
    type: 'file',
    path: 'wp-content/plugins/reprint-push-atomic-dependent-fixture/reprint-push-atomic-dependent-fixture.php',
  });
  assertSupported({
    type: 'file',
    path: 'wp-content/uploads/reprint-push/shared.txt',
  });

  assertRejected(
    { type: 'file', path: 'wp-content/plugins/akismet/akismet.php' },
    /outside fixture uploads or named lab plugins/,
  );
  assertRejected(
    { type: 'file', path: 'wp-content/plugins/reprint-push-atomic-dependent-fixture/includes/bootstrap.php' },
    /outside fixture uploads or named lab plugins/,
  );
  assertRejected(
    { type: 'file', path: 'wp-content/plugins/reprint-push-forms-fixture/../akismet.php' },
    /outside fixture uploads or named lab plugins/,
  );
});

test('snapshot apply gate allows only exact forms lab custom table rows', { skip: !hasPhp }, () => {
  assertSupported({
    type: 'row',
    table: 'wp_reprint_push_forms_lab',
    id: 'id:1',
  });

  assertRejected(
    { type: 'row', table: 'wp_reprint_push_forms_lab', id: 'id:0' },
    /Unsupported row id/,
  );
  assertRejected(
    { type: 'row', table: 'wp_reprint_push_forms_lab_extra', id: 'id:1' },
    /Unsupported apply table/,
  );
  assertRejected(
    { type: 'row', table: 'wp_forms_entries', id: 'entry_id:9' },
    /Unsupported apply table/,
  );
});

test('plugin-owned driver registry rejects whitespace-only driver names', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: '   ',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing driver name for table: wp_reprint_push_driver_fixture/,
  );
});

test('plugin-owned driver registry rejects whitespace-only table names', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: '   ',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing table for driver: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects whitespace-only plugin owners', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: '   ',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing pluginOwner for driver: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects missing export callback', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: null,
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing exportRowsCallback for driver: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects missing apply callback', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: null,
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing applyRowCallback for driver: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects missing validate callback', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: null,
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /missing validateMutationCallback for driver: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects duplicate driver names', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
    'fixture-driver-duplicate': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture_duplicate',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /duplicate driver name: fixture-driver/,
  );
});

test('plugin-owned driver registry rejects duplicate table mappings', { skip: !hasPhp }, () => {
  const result = runDriverRegistryCheck({
    'fixture-driver': {
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
    'fixture-driver-same-table': {
      driver: 'fixture-driver-same-table',
      table: 'wp_reprint_push_driver_fixture',
      pluginOwner: 'driver-fixture',
      exportRowsCallback: 'fixture_export_rows',
      applyRowCallback: 'fixture_apply_row',
      validateMutationCallback: 'fixture_validate_mutation',
    },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /duplicate table mapping for table: wp_reprint_push_driver_fixture/,
  );
});

test('snapshot apply gate allows arbitrary registered plugin driver rows', { skip: !hasPhp }, () => {
  const result = runSupportCheckWithDrivers(
    {
      type: 'row',
      table: 'wp_reprint_push_driver_fixture',
      id: 'entry_id:9',
    },
    {
      'fixture-driver': {
        driver: 'fixture-driver',
        table: 'wp_reprint_push_driver_fixture',
        pluginOwner: 'driver-fixture',
        exportRowsCallback: 'fixture_export_rows',
        applyRowCallback: 'fixture_apply_row',
        validateMutationCallback: 'fixture_validate_mutation',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'supported');
});

test('snapshot apply gate rejects empty arbitrary plugin driver row ids', { skip: !hasPhp }, () => {
  const result = runSupportCheckWithDrivers(
    {
      type: 'row',
      table: 'wp_reprint_push_driver_fixture',
      id: '',
    },
    {
      'fixture-driver': {
        driver: 'fixture-driver',
        table: 'wp_reprint_push_driver_fixture',
        pluginOwner: 'driver-fixture',
        exportRowsCallback: 'fixture_export_rows',
        applyRowCallback: 'fixture_apply_row',
        validateMutationCallback: 'fixture_validate_mutation',
      },
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /row id must not be empty/i);
});

test('snapshot plugin-owned policy exposes arbitrary registered driver rows', { skip: !hasPhp }, () => {
  const result = runPluginOwnedPolicyCheck(
    {
      meta: {},
      db: {
        wp_options: {},
        wp_postmeta: {},
        wp_reprint_push_driver_fixture: {
          'entry_id:9': {
            entry_id: 9,
            payload: { ok: true },
            __pluginOwner: 'driver-fixture',
          },
        },
      },
    },
    {
      'fixture-driver': {
        driver: 'fixture-driver',
        table: 'wp_reprint_push_driver_fixture',
        pluginOwner: 'driver-fixture',
        supportsDelete: true,
        exportRowsCallback: 'fixture_export_rows',
        applyRowCallback: 'fixture_apply_row',
        validateMutationCallback: 'fixture_validate_mutation',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:9"]',
      pluginOwner: 'driver-fixture',
      driver: 'fixture-driver',
      table: 'wp_reprint_push_driver_fixture',
      supportsDelete: true,
    },
  ]);
});

test('snapshot plugin-owned policy rejects malformed arbitrary driver row ids', { skip: !hasPhp }, () => {
  const result = runPluginOwnedPolicyCheck(
    {
      meta: {},
      db: {
        wp_options: {},
        wp_postmeta: {},
        wp_reprint_push_driver_fixture: {
          '': {
            payload: { ok: true },
            __pluginOwner: 'driver-fixture',
          },
        },
      },
    },
    {
      'fixture-driver': {
        driver: 'fixture-driver',
        table: 'wp_reprint_push_driver_fixture',
        pluginOwner: 'driver-fixture',
        exportRowsCallback: 'fixture_export_rows',
        applyRowCallback: 'fixture_apply_row',
        validateMutationCallback: 'fixture_validate_mutation',
      },
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /row id must not be empty/i);
});
