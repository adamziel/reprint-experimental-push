#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedNow = new Date('2026-05-26T18:00:00.000Z');
const syncChildTimeoutMs = 120_000;
const syncChildKillSignal = 'SIGKILL';
const driverName = 'fixture-arbitrary-plugin-table';
const driverTable = 'wp_reprint_push_driver_fixture';
const pluginOwner = 'driver-fixture';
const resourceKey = `row:["${driverTable}","entry_id:1"]`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-plugin-driver-registry-'));
const baseBlueprintPath = path.join(tmpDir, 'base.blueprint.json');
const localBlueprintPath = path.join(tmpDir, 'local.blueprint.json');
const missingExportBlueprintPath = path.join(tmpDir, 'missing-export.blueprint.json');
const missingApplyBlueprintPath = path.join(tmpDir, 'missing-apply.blueprint.json');
const malformedValidateBlueprintPath = path.join(tmpDir, 'missing-validate.blueprint.json');
const missingDriverNameBlueprintPath = path.join(tmpDir, 'missing-driver-name.blueprint.json');
const missingPluginOwnerBlueprintPath = path.join(tmpDir, 'missing-plugin-owner.blueprint.json');
const missingTableBlueprintPath = path.join(tmpDir, 'missing-table.blueprint.json');
const duplicateDriverNameBlueprintPath = path.join(tmpDir, 'duplicate-driver-name.blueprint.json');
const duplicateTableBlueprintPath = path.join(tmpDir, 'duplicate-driver-table.blueprint.json');
const repoTmpDir = path.join(repoRoot, '.tmp');
const planPath = path.join(repoTmpDir, `plugin-driver-registry-plan-${process.pid}.json`);
const deletePlanPath = path.join(repoTmpDir, `plugin-driver-registry-delete-plan-${process.pid}.json`);

try {
  fs.mkdirSync(repoTmpDir, { recursive: true });
  writeBlueprint(baseBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
  });
  writeBlueprint(localBlueprintPath, {
    payloadMode: 'local-edited',
    updatedMarker: 'local',
  });
  writeBlueprint(missingExportBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    omitExportRowsCallback: true,
  });
  writeBlueprint(missingApplyBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    omitApplyRowCallback: true,
  });
  writeBlueprint(malformedValidateBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    omitValidateMutationCallback: true,
  });
  writeBlueprint(missingDriverNameBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    blankDriverName: true,
  });
  writeBlueprint(missingPluginOwnerBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    omitPluginOwner: true,
  });
  writeBlueprint(missingTableBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    omitTable: true,
  });
  writeBlueprint(duplicateDriverNameBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    duplicateDriverName: true,
  });
  writeBlueprint(duplicateTableBlueprintPath, {
    payloadMode: 'base',
    updatedMarker: 'base',
    duplicateTable: true,
  });

  const base = exportSnapshot('base', baseBlueprintPath);
  const local = exportSnapshot('local', localBlueprintPath);
  const remote = JSON.parse(JSON.stringify(base));

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
  assert.equal(plan.mutations[0].pluginOwnedResource.driver, driverName);
  assert.equal(plan.mutations[0].pluginOwnedResource.table, driverTable);
  assert.equal(plan.mutations[0].pluginOwnedResource.pluginOwner, pluginOwner);

  const modelApply = applyPlan(JSON.parse(JSON.stringify(base)), plan);
  assert.equal(modelApply.appliedMutations, 1);
  assert.equal(modelApply.site.db[driverTable]['entry_id:1'].payload.mode, 'local-edited');

  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const protocolApply = applyPlanToBase(baseBlueprintPath, planPath);
  assert.equal(protocolApply.ok, true);
  assert.equal(protocolApply.applied, 1);
  assert.deepEqual(protocolApply.verified, [resourceKey]);
  assert.equal(protocolApply.after.db[driverTable]['entry_id:1'].payload.mode, 'local-edited');

  const missingExportRowsExport = exportSnapshotFailure('missing-export', missingExportBlueprintPath);
  assert.equal(missingExportRowsExport.ok, false);
  assert.equal(missingExportRowsExport.error?.class, 'RuntimeException');
  assert.match(
    missingExportRowsExport.error?.message || '',
    /missing exportRowsCallback for driver: fixture-arbitrary-plugin-table/i,
  );

  const missingApplyRowExport = exportSnapshotFailure('missing-apply', missingApplyBlueprintPath);
  assert.equal(missingApplyRowExport.ok, false);
  assert.equal(missingApplyRowExport.error?.class, 'RuntimeException');
  assert.match(
    missingApplyRowExport.error?.message || '',
    /missing applyRowCallback for driver: fixture-arbitrary-plugin-table/i,
  );

  const malformedValidateExport = exportSnapshotFailure('missing-validate', malformedValidateBlueprintPath);
  assert.equal(malformedValidateExport.ok, false);
  assert.equal(malformedValidateExport.error?.class, 'RuntimeException');
  assert.match(
    malformedValidateExport.error?.message || '',
    /missing validateMutationCallback for driver: fixture-arbitrary-plugin-table/i,
  );

  const duplicateDriverNameExport = exportSnapshotFailure('duplicate-driver-name', duplicateDriverNameBlueprintPath);
  assert.equal(duplicateDriverNameExport.ok, false);
  assert.equal(duplicateDriverNameExport.error?.class, 'RuntimeException');
  assert.match(
    duplicateDriverNameExport.error?.message || '',
    /duplicate driver name: fixture-arbitrary-plugin-table/i,
  );

  const duplicateTableExport = exportSnapshotFailure('duplicate-table', duplicateTableBlueprintPath);
  assert.equal(duplicateTableExport.ok, false);
  assert.equal(duplicateTableExport.error?.class, 'RuntimeException');
  assert.match(
    duplicateTableExport.error?.message || '',
    /duplicate table mapping for table: wp_reprint_push_driver_fixture/i,
  );

  const missingPluginOwnerExport = exportSnapshotFailure('missing-plugin-owner', missingPluginOwnerBlueprintPath);
  assert.equal(missingPluginOwnerExport.ok, false);
  assert.equal(missingPluginOwnerExport.error?.class, 'RuntimeException');
  assert.match(
    missingPluginOwnerExport.error?.message || '',
    /missing pluginOwner for driver: fixture-arbitrary-plugin-table/i,
  );

  const missingDriverNameExport = exportSnapshotFailure('missing-driver-name', missingDriverNameBlueprintPath);
  assert.equal(missingDriverNameExport.ok, false);
  assert.equal(missingDriverNameExport.error?.class, 'RuntimeException');
  assert.match(
    missingDriverNameExport.error?.message || '',
    /missing driver name for table: wp_reprint_push_driver_fixture/i,
  );

  const missingTableExport = exportSnapshotFailure('missing-table', missingTableBlueprintPath);
  assert.equal(missingTableExport.ok, false);
  assert.equal(missingTableExport.error?.class, 'RuntimeException');
  assert.match(
    missingTableExport.error?.message || '',
    /missing table for driver: fixture-arbitrary-plugin-table/i,
  );

  const deleteBase = protocolApply.after;
  const deleteLocal = JSON.parse(JSON.stringify(deleteBase));
  delete deleteLocal.db[driverTable]['entry_id:1'];
  const deleteRemote = JSON.parse(JSON.stringify(deleteBase));
  const deletePlan = createPushPlan({
    base: deleteBase,
    local: deleteLocal,
    remote: deleteRemote,
    now: new Date('2026-05-26T18:05:00.000Z'),
  });

  assert.equal(deletePlan.status, 'ready');
  assert.deepEqual(deletePlan.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
  assert.equal(deletePlan.mutations[0].action, 'delete');
  assert.equal(deletePlan.mutations[0].pluginOwnedResource.driver, driverName);
  assert.equal(deletePlan.mutations[0].pluginOwnedResource.table, driverTable);
  assert.equal(deletePlan.mutations[0].pluginOwnedResource.supportsDelete, true);

  const modelDelete = applyPlan(JSON.parse(JSON.stringify(deleteRemote)), deletePlan);
  assert.equal(modelDelete.appliedMutations, 1);
  assert.equal(modelDelete.site.db[driverTable]['entry_id:1'], undefined);

  fs.writeFileSync(deletePlanPath, `${JSON.stringify(deletePlan, null, 2)}\n`);
  const protocolDelete = applyPlanToBase(localBlueprintPath, deletePlanPath);
  assert.equal(protocolDelete.ok, true);
  assert.equal(protocolDelete.applied, 1);
  assert.deepEqual(protocolDelete.verified, [resourceKey]);
  assert.equal(protocolDelete.after.db[driverTable]['entry_id:1'], undefined);

  console.log(JSON.stringify({
    status: plan.status,
    driver: plan.mutations[0].pluginOwnedResource.driver,
    table: plan.mutations[0].pluginOwnedResource.table,
    applied: protocolApply.applied + protocolDelete.applied,
    updateVerified: protocolApply.verified,
    deleteVerified: protocolDelete.verified,
    missingExportRowsGuard: missingExportRowsExport.error?.class,
    missingApplyRowGuard: missingApplyRowExport.error?.class,
    malformedValidateGuard: malformedValidateExport.error?.class,
    missingDriverNameGuard: missingDriverNameExport.error?.class,
    missingPluginOwnerGuard: missingPluginOwnerExport.error?.class,
    missingTableGuard: missingTableExport.error?.class,
    duplicateDriverNameGuard: duplicateDriverNameExport.error?.class,
    duplicateTableGuard: duplicateTableExport.error?.class,
  }, null, 2));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(planPath, { force: true });
  fs.rmSync(deletePlanPath, { force: true });
}

function writeBlueprint(
  targetPath,
  {
    payloadMode,
    updatedMarker,
    omitExportRowsCallback = false,
    omitApplyRowCallback = false,
    omitValidateMutationCallback = false,
    blankDriverName = false,
    omitPluginOwner = false,
    omitTable = false,
    duplicateDriverName = false,
    duplicateTable = false,
  },
) {
  const blueprint = JSON.parse(fs.readFileSync(path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json'), 'utf8'));
  const pluginCode = `<?php
/*
Plugin Name: Reprint Push Driver Fixture
Description: Fixture plugin for plugin-owned row driver registry coverage.
Version: 0.0.1
*/

add_filter('reprint_push_plugin_owned_row_drivers', static function (array $drivers): array {
    $drivers['${driverName}'] = [
        'driver' => '${blankDriverName ? '' : driverName}',
${omitTable ? '' : `        'table' => '${driverTable}',`}
${omitPluginOwner ? '' : `        'pluginOwner' => '${pluginOwner}',`}
        'supportsDelete' => true,
${omitExportRowsCallback ? '' : "        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',"}
${omitApplyRowCallback ? '' : "        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',"}
${omitValidateMutationCallback ? '' : "        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',"}
    ];
${duplicateDriverName ? `    $drivers['${driverName}-duplicate'] = [
        'driver' => '${driverName}',
        'table' => 'wp_reprint_push_driver_fixture_duplicate',
        'pluginOwner' => '${pluginOwner}',
        'supportsDelete' => true,
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
` : ''}${duplicateTable ? `    $drivers['${driverName}-same-table'] = [
        'driver' => '${driverName}-same-table',
        'table' => '${driverTable}',
        'pluginOwner' => '${pluginOwner}',
        'supportsDelete' => true,
        'exportRowsCallback' => 'reprint_push_driver_fixture_export_rows',
        'applyRowCallback' => 'reprint_push_driver_fixture_apply_row',
        'validateMutationCallback' => 'reprint_push_driver_fixture_validate_mutation',
    ];
` : ''}    return $drivers;
});

function reprint_push_driver_fixture_table_name(): string {
    global $wpdb;
    return $wpdb->prefix . '${driverTable.slice(3)}';
}

function reprint_push_driver_fixture_export_rows(array &$snapshot, array $driver): void {
    global $wpdb;
    $table_name = reprint_push_driver_fixture_table_name();
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
            '__pluginOwner' => '${pluginOwner}',
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
    $wpdb->query('CREATE TABLE IF NOT EXISTS ' . $table_name . ' (entry_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (entry_id)) ' . $wpdb->get_charset_collate());
    if ($is_delete) {
        $wpdb->delete($table_name, ['entry_id' => $entry_id], ['%d']);
        return;
    }
    if (!is_array($value) || (int) ($value['entry_id'] ?? 0) !== $entry_id) {
        throw new RuntimeException('Driver fixture payload does not match row id: ' . $id);
    }
    if ((string) ($value['__pluginOwner'] ?? '') !== '${pluginOwner}') {
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
    if (($resource['table'] ?? '') !== '${driverTable}' || ($driver['pluginOwner'] ?? '') !== '${pluginOwner}') {
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
    if ((string) ($value['__pluginOwner'] ?? '') !== '${pluginOwner}') {
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
  const pluginCodeBase64 = Buffer.from(pluginCode, 'utf8').toString('base64');
  blueprint.meta = {
    ...blueprint.meta,
    title: `Plugin Driver Registry ${payloadMode}`,
    description: 'Fixture blueprint for arbitrary plugin-owned row driver coverage.',
  };
  blueprint.steps.push({
    step: 'runPHP',
    code: [
      '<?php',
      "require_once '/wordpress/wp-load.php';",
      '$plugin_dir = WP_PLUGIN_DIR . \'/driver-fixture\';',
      'wp_mkdir_p($plugin_dir);',
      '$plugin_file = $plugin_dir . \'/driver-fixture.php\';',
      `file_put_contents($plugin_file, base64_decode('${pluginCodeBase64}'));`,
      'require_once ABSPATH . \'wp-admin/includes/plugin.php\';',
      '$result = activate_plugin(\'driver-fixture/driver-fixture.php\');',
      'if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }',
      'global $wpdb;',
      '$table = $wpdb->prefix . \'reprint_push_driver_fixture\';',
      '$wpdb->query(\'CREATE TABLE \' . $table . \' (entry_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (entry_id)) \' . $wpdb->get_charset_collate());',
      '$payload = wp_json_encode([',
      `    'owner' => '${pluginOwner}',`,
      `    'mode' => '${payloadMode}',`,
      '    \'version\' => 1,',
      ']);',
      '$wpdb->replace($table, [',
      '    \'entry_id\' => 1,',
      '    \'payload_json\' => $payload,',
      `    'updated_marker' => '${updatedMarker}',`,
      '], [\'%d\', \'%s\', \'%s\']);',
    ].join(' '),
  });

  fs.writeFileSync(targetPath, `${JSON.stringify(blueprint, null, 2)}\n`);
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

function exportSnapshotFailure(name, blueprintPath) {
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

  assertSyncChildCompleted(result, `Playground snapshot export failure probe for ${name}`);
  if (result.status === 0) {
    throw new Error(`Expected Playground snapshot export to fail for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  const markedError = tryParseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_ERROR_JSON_BEGIN',
    'REPRINT_PUSH_ERROR_JSON_END',
  );
  if (markedError !== null) {
    return markedError;
  }

  const fatalMatch = result.stdout.match(/Fatal error: Uncaught ([A-Za-z0-9_\\\\]+): ([\s\S]*?) in /);
  if (fatalMatch) {
    return {
      ok: false,
      error: {
        class: fatalMatch[1].split('\\').pop(),
        message: fatalMatch[2].trim(),
      },
    };
  }

  throw new Error(`Error markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function applyPlanToBase(blueprintPath, planFilePath, { expectStatus = 0 } = {}) {
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
    '/workspace/scripts/playground/apply-plan-to-site.php',
    `/workspace/${path.relative(repoRoot, planFilePath)}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: syncChildTimeoutMs,
    killSignal: syncChildKillSignal,
  });

  assertSyncChildCompleted(result, `Playground apply for ${path.basename(planFilePath)}`);
  const payload = parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_APPLY_JSON_BEGIN',
    'REPRINT_PUSH_APPLY_JSON_END',
    `Apply markers missing\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  if (result.status !== expectStatus) {
    throw new Error(`Playground apply failed\n${JSON.stringify(payload, null, 2)}\nSTDERR:\n${result.stderr}`);
  }

  return payload;
}

function assertSyncChildCompleted(result, label) {
  if (result.error) {
    throw new Error(
      `${label} failed before completion: ${result.error.message}\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${label} did not complete before timeout (${syncChildTimeoutMs}ms, signal ${result.signal})\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`,
    );
  }
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const parsed = tryParseMarkedJson(stdout, begin, end);
  if (parsed === null) {
    throw new Error(missingMessage);
  }
  return parsed;
}

function tryParseMarkedJson(stdout, begin, end) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*)\\n${end}`));
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}
