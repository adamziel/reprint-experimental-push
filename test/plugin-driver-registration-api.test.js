import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotLibPath = path.join(repoRoot, 'scripts/playground/snapshot-lib.php');
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256String(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256Evidence(value) {
  return sha256String(stableStringify(value));
}

function assertSha256Evidence(value) {
  assert.match(value, sha256Pattern);
}

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

test('RPP-0401 plugin-owned row driver registration API normalizes and exposes exact registered behavior', () => {
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

test('RPP-0401 plugin-owned row driver registration API fails closed on duplicate and malformed registrations', () => {
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

test('RPP-0401 plugin-owned row driver registration API emits redacted audit-safe output', () => {
  const report = runPhpDriverProbe(`
$registered = reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-rpp0401-audit-driver',
    'table' => 'wp_fixture_rpp0401_audit_rows',
    'pluginOwner' => 'fixture-rpp0401-plugin',
    'supportsDelete' => true,
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$duplicate = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-rpp0401-audit-driver',
        'table' => 'wp_fixture_rpp0401_duplicate_rows',
        'pluginOwner' => 'fixture-rpp0401-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$invalid = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-rpp0401-invalid-driver',
        'table' => 'wp_fixture_rpp0401_invalid_rows',
        'pluginOwner' => 'fixture-rpp0401-plugin',
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$by_name = reprint_push_plugin_owned_row_driver_by_name('fixture-rpp0401-audit-driver');
$by_table = reprint_push_plugin_owned_row_driver_for_table('wp_fixture_rpp0401_audit_rows');
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
    'duplicate' => $duplicate,
    'invalid' => $invalid,
    'registeredNamesAfterRefusals' => array_keys(reprint_push_registered_plugin_owned_row_drivers()),
]);
`);

  assert.deepEqual(report.registered, {
    driver: 'fixture-rpp0401-audit-driver',
    table: 'wp_fixture_rpp0401_audit_rows',
    pluginOwner: 'fixture-rpp0401-plugin',
    supportsDelete: true,
    callbacks: {
      export: 'rpp_driver_api_export_rows',
      apply: 'rpp_driver_api_apply_row',
      validate: 'rpp_driver_api_validate_mutation',
    },
  });
  assert.deepEqual(report.byName, {
    driver: 'fixture-rpp0401-audit-driver',
    table: 'wp_fixture_rpp0401_audit_rows',
    pluginOwner: 'fixture-rpp0401-plugin',
    supportsDelete: true,
  });
  assert.deepEqual(report.byTable, report.byName);
  assert.equal(report.duplicate.ok, false);
  assert.equal(report.duplicate.error.class, 'RuntimeException');
  assert.equal(report.duplicate.error.message, 'duplicate driver name: fixture-rpp0401-audit-driver');
  assert.equal(report.invalid.ok, false);
  assert.equal(report.invalid.error.class, 'RuntimeException');
  assert.equal(report.invalid.error.message, 'missing applyRowCallback for driver: fixture-rpp0401-invalid-driver');
  assert.deepEqual(report.registeredNamesAfterRefusals, [
    'reprint-push-release-state',
    'fixture-rpp0401-audit-driver',
  ]);

  const auditSafeEvidence = {
    rpp: 'RPP-0401',
    schemaVersion: 1,
    evidenceSource: 'local-focused-plugin-driver-registration-api',
    releaseGate: 'NO-GO',
    output: 'audit-safe-redacted',
    rawValuesIncluded: false,
    accepted: {
      registeredHash: sha256Evidence(report.registered),
      lookupByNameHash: sha256Evidence(report.byName),
      lookupByTableHash: sha256Evidence(report.byTable),
      registeredNamesHash: sha256Evidence(report.registeredNamesAfterRefusals),
    },
    refused: {
      duplicateDriver: {
        ok: report.duplicate.ok,
        errorClass: report.duplicate.error.class,
        errorMessageHash: sha256String(report.duplicate.error.message),
      },
      invalidDriver: {
        ok: report.invalid.ok,
        errorClass: report.invalid.error.class,
        errorMessageHash: sha256String(report.invalid.error.message),
      },
    },
  };
  auditSafeEvidence.proofHash = sha256Evidence({
    accepted: auditSafeEvidence.accepted,
    refused: auditSafeEvidence.refused,
  });

  for (const hash of Object.values(auditSafeEvidence.accepted)) {
    assertSha256Evidence(hash);
  }
  assert.equal(auditSafeEvidence.refused.duplicateDriver.ok, false);
  assert.equal(auditSafeEvidence.refused.invalidDriver.ok, false);
  assertSha256Evidence(auditSafeEvidence.refused.duplicateDriver.errorMessageHash);
  assertSha256Evidence(auditSafeEvidence.refused.invalidDriver.errorMessageHash);
  assertSha256Evidence(auditSafeEvidence.proofHash);

  const serializedEvidence = JSON.stringify(auditSafeEvidence);
  assert.equal(auditSafeEvidence.rawValuesIncluded, false);
  for (const rawValue of [
    'fixture-rpp0401-audit-driver',
    'fixture-rpp0401-invalid-driver',
    'wp_fixture_rpp0401_audit_rows',
    'wp_fixture_rpp0401_duplicate_rows',
    'wp_fixture_rpp0401_invalid_rows',
    'fixture-rpp0401-plugin',
    'duplicate driver name: fixture-rpp0401-audit-driver',
    'missing applyRowCallback for driver: fixture-rpp0401-invalid-driver',
  ]) {
    assert.equal(serializedEvidence.includes(rawValue), false, `audit-safe evidence leaked ${rawValue}`);
  }
  assert.doesNotMatch(serializedEvidence, /exportRowsCallback|applyRowCallback|validateMutationCallback/);
  assert.doesNotMatch(serializedEvidence, /rpp_driver_api_(?:export_rows|apply_row|validate_mutation)/);
});
