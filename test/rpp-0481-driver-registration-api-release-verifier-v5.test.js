import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  arbitraryPluginFixturePackageBoundary,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
} from '../scripts/playground/production-plugin-package-scenarios.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotLibPath = path.join(repoRoot, 'scripts/playground/snapshot-lib.php');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageSmokePath = path.join(repoRoot, 'scripts/playground/production-plugin-package-smoke.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const registrationGuardCases = Object.freeze([
  {
    scenario: 'driver-missing-export-guard',
    summaryKey: 'driverExportGuard',
    summaryFlag: 'missingExportRowsCallback',
    message: `missing exportRowsCallback for driver: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-missing-apply-guard',
    summaryKey: 'driverApplyGuard',
    summaryFlag: 'missingApplyRowCallback',
    message: `missing applyRowCallback for driver: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-missing-validate-guard',
    summaryKey: 'driverValidateGuard',
    summaryFlag: 'missingValidateMutationCallback',
    message: `missing validateMutationCallback for driver: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-missing-name-guard',
    summaryKey: 'driverMissingNameGuard',
    summaryFlag: 'missingDriverName',
    message: `missing driver name for table: ${arbitraryPluginFixturePackageBoundary.table}`,
  },
  {
    scenario: 'driver-missing-plugin-owner-guard',
    summaryKey: 'driverPluginOwnerGuard',
    summaryFlag: 'missingPluginOwner',
    message: `missing pluginOwner for driver: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-missing-table-guard',
    summaryKey: 'driverMissingTableGuard',
    summaryFlag: 'missingTable',
    message: `missing table for driver: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-duplicate-name-guard',
    summaryKey: 'driverDuplicateNameGuard',
    summaryFlag: 'duplicateDriverName',
    message: `duplicate driver name: ${arbitraryPluginFixturePackageBoundary.driver}`,
  },
  {
    scenario: 'driver-duplicate-table-guard',
    summaryKey: 'driverDuplicateTableGuard',
    summaryFlag: 'duplicateTable',
    message: `duplicate table mapping for table: ${arbitraryPluginFixturePackageBoundary.table}`,
  },
]);

const expectedVerifierScenarios = Object.freeze([
  'driver-receipt-guards',
  ...registrationGuardCases.map((entry) => entry.scenario),
]);

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

function assertSha256Evidence(value, label = 'sha256 evidence') {
  assert.match(value, sha256EvidencePattern, label);
}

function runPhpDriverRegistrationProbe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0481-driver-registration-'));
  const file = path.join(dir, 'probe.php');
  fs.writeFileSync(file, `<?php
function apply_filters($hook_name, $value) {
    if ($hook_name === 'reprint_push_plugin_owned_row_drivers'
        && isset($GLOBALS['rpp_0481_driver_filter'])
        && is_callable($GLOBALS['rpp_0481_driver_filter'])) {
        return ($GLOBALS['rpp_0481_driver_filter'])($value);
    }
    return $value;
}
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
class Rpp0481WpdbStub {
    public string $prefix = 'wp_';
    public function prepare($query, ...$args) { return $query; }
    public function get_var($query) { return null; }
    public function get_results($query, $output = null) { return []; }
    public function query($query) { return true; }
    public function get_charset_collate() { return ''; }
}
$GLOBALS['wpdb'] = new Rpp0481WpdbStub();
require ${JSON.stringify(snapshotLibPath)};

function rpp_0481_driver(string $driver, string $table, string $owner, bool $supports_delete = false): array {
    return [
        'driver' => $driver,
        'table' => $table,
        'pluginOwner' => $owner,
        'supportsDelete' => $supports_delete,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'applyRowCallback' => 'rpp_0481_apply_row',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
}

function rpp_0481_export_rows(array &$snapshot, array $driver): void {
    $table = (string) $driver['table'];
    if (!isset($snapshot['db']) || !is_array($snapshot['db'])) {
        $snapshot['db'] = [];
    }
    if (!isset($snapshot['db'][$table]) || !is_array($snapshot['db'][$table])) {
        $snapshot['db'][$table] = [];
    }
    $snapshot['db'][$table]['entry_id:1'] = [
        'entry_id' => 1,
        'payload' => [
            'owner' => (string) $driver['pluginOwner'],
            'mode' => 'base',
            'version' => 1,
        ],
        'updated_marker' => 'base',
        '__pluginOwner' => (string) $driver['pluginOwner'],
    ];
    $GLOBALS['rpp_0481_export_log'][] = [
        'driver' => (string) $driver['driver'],
        'table' => $table,
        'pluginOwner' => (string) $driver['pluginOwner'],
        'supportsDelete' => !empty($driver['supportsDelete']),
        'rowId' => 'entry_id:1',
    ];
}

function rpp_0481_apply_row(string $id, bool $is_delete, $value, array $driver): void {
    $GLOBALS['rpp_0481_apply_log'][] = [
        'driver' => (string) $driver['driver'],
        'table' => (string) $driver['table'],
        'pluginOwner' => (string) $driver['pluginOwner'],
        'supportsDelete' => !empty($driver['supportsDelete']),
        'id' => $id,
        'isDelete' => $is_delete,
        'mode' => is_array($value) && is_array($value['payload'] ?? null) ? (string) ($value['payload']['mode'] ?? '') : '',
    ];
}

function rpp_0481_validate_mutation(array $mutation, array $snapshot, array $driver): bool {
    $resource = is_array($mutation['resource'] ?? null) ? $mutation['resource'] : [];
    $GLOBALS['rpp_0481_validate_log'][] = [
        'driver' => (string) $driver['driver'],
        'table' => (string) ($resource['table'] ?? ''),
        'resourceKey' => (string) ($mutation['resourceKey'] ?? ''),
        'isDelete' => !empty($mutation['value']['absent']),
    ];
    return (string) ($resource['table'] ?? '') === (string) $driver['table']
        && (string) ($driver['pluginOwner'] ?? '') === ${JSON.stringify(arbitraryPluginFixturePackageBoundary.pluginOwner)}
        && !empty($mutation['value'])
        && empty($mutation['value']['absent']);
}

function rpp_0481_summarize_driver($driver) {
    if (!is_array($driver)) {
        return null;
    }
    return [
        'driver' => (string) ($driver['driver'] ?? ''),
        'table' => (string) ($driver['table'] ?? ''),
        'pluginOwner' => (string) ($driver['pluginOwner'] ?? ''),
        'supportsDelete' => !empty($driver['supportsDelete']),
        'callbacks' => [
            'exportRowsCallback' => is_callable($driver['exportRowsCallback'] ?? null),
            'applyRowCallback' => is_callable($driver['applyRowCallback'] ?? null),
            'validateMutationCallback' => is_callable($driver['validateMutationCallback'] ?? null),
        ],
        'allowlist' => [
            'resourceKeys' => $driver['allowlist']['resourceKeys'] ?? [],
            'rowIds' => $driver['allowlist']['rowIds'] ?? [],
            'payloadModes' => $driver['allowlist']['payloadModes'] ?? [],
        ],
    ];
}

function rpp_0481_capture(callable $callback): array {
    try {
        return ['ok' => true, 'value' => $callback()];
    } catch (Throwable $error) {
        return [
            'ok' => false,
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    }
}

$driver_name = ${JSON.stringify(arbitraryPluginFixturePackageBoundary.driver)};
$driver_table = ${JSON.stringify(arbitraryPluginFixturePackageBoundary.table)};
$plugin_owner = ${JSON.stringify(arbitraryPluginFixturePackageBoundary.pluginOwner)};
$resource_key = ${JSON.stringify(arbitraryPluginFixturePackageBoundary.resourceKey)};

$registered = reprint_push_register_plugin_owned_row_driver(
    rpp_0481_driver($driver_name, $driver_table, $plugin_owner, false)
);
$drivers = reprint_push_registered_plugin_owned_row_drivers();
$by_name = reprint_push_plugin_owned_row_driver_by_name($driver_name);
$by_table = reprint_push_plugin_owned_row_driver_for_table($driver_table);

$GLOBALS['rpp_0481_export_log'] = [];
$export_snapshot = ['db' => []];
reprint_push_export_registered_plugin_owned_rows($export_snapshot);

$GLOBALS['rpp_0481_apply_log'] = [];
reprint_push_apply_row_resource($driver_table, 'entry_id:1', false, [
    'entry_id' => 1,
    'payload' => ['owner' => $plugin_owner, 'mode' => 'local-update', 'version' => 2],
    'updated_marker' => 'local-update',
    '__pluginOwner' => $plugin_owner,
]);

$GLOBALS['rpp_0481_validate_log'] = [];
$validation_snapshot = [
    'db' => [
        $driver_table => [
            'entry_id:1' => [
                'entry_id' => 1,
                'payload' => ['owner' => $plugin_owner, 'mode' => 'base', 'version' => 1],
                'updated_marker' => 'base',
                '__pluginOwner' => $plugin_owner,
            ],
        ],
    ],
];
$valid_mutation = [
    'resourceKey' => $resource_key,
    'resource' => ['type' => 'row', 'table' => $driver_table, 'id' => 'entry_id:1'],
    'value' => [
        'value' => [
            'entry_id' => 1,
            'payload' => ['owner' => $plugin_owner, 'mode' => 'local-update', 'version' => 2],
            'updated_marker' => 'local-update',
            '__pluginOwner' => $plugin_owner,
        ],
    ],
    'pluginOwnedResource' => ['driver' => $driver_name],
];
$delete_mutation = $valid_mutation;
$delete_mutation['value'] = ['absent' => true];
$validation = [
    'acceptedUpdate' => rpp_0481_capture(static function () use ($valid_mutation, $validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($valid_mutation, $validation_snapshot);
        return true;
    }),
    'unsupportedDelete' => rpp_0481_capture(static function () use ($delete_mutation, $validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($delete_mutation, $validation_snapshot);
        return true;
    }),
];

$scenarios = [];
$scenarios['driver-missing-export-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'applyRowCallback' => 'rpp_0481_apply_row',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-apply-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-validate-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'applyRowCallback' => 'rpp_0481_apply_row',
    ];
    return $drivers;
};
$scenarios['driver-missing-name-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => '',
        'table' => $driver_table,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'applyRowCallback' => 'rpp_0481_apply_row',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-plugin-owner-guard'] = static function (array $drivers) use ($driver_name, $driver_table): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'table' => $driver_table,
        'supportsDelete' => false,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'applyRowCallback' => 'rpp_0481_apply_row',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-missing-table-guard'] = static function (array $drivers) use ($driver_name, $plugin_owner): array {
    $drivers[$driver_name] = [
        'driver' => $driver_name,
        'pluginOwner' => $plugin_owner,
        'supportsDelete' => false,
        'exportRowsCallback' => 'rpp_0481_export_rows',
        'applyRowCallback' => 'rpp_0481_apply_row',
        'validateMutationCallback' => 'rpp_0481_validate_mutation',
    ];
    return $drivers;
};
$scenarios['driver-duplicate-name-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = rpp_0481_driver($driver_name, $driver_table, $plugin_owner, false);
    $drivers[$driver_name . '-duplicate'] = rpp_0481_driver($driver_name, $driver_table . '_duplicate', $plugin_owner, false);
    return $drivers;
};
$scenarios['driver-duplicate-table-guard'] = static function (array $drivers) use ($driver_name, $driver_table, $plugin_owner): array {
    $drivers[$driver_name] = rpp_0481_driver($driver_name, $driver_table, $plugin_owner, false);
    $drivers[$driver_name . '-same-table'] = rpp_0481_driver($driver_name . '-same-table', $driver_table, $plugin_owner, false);
    return $drivers;
};

$guard_results = [];
foreach ($scenarios as $scenario => $filter) {
    $GLOBALS['rpp_0481_driver_filter'] = $filter;
    $guard_results[$scenario] = rpp_0481_capture(static function (): array {
        return array_keys(reprint_push_registered_plugin_owned_row_drivers());
    });
}
unset($GLOBALS['rpp_0481_driver_filter']);

$driver_summary = [];
foreach ($drivers as $name => $driver) {
    $driver_summary[$name] = rpp_0481_summarize_driver($driver);
}

echo json_encode([
    'registered' => rpp_0481_summarize_driver($registered),
    'driverNames' => array_keys($drivers),
    'drivers' => $driver_summary,
    'byName' => rpp_0481_summarize_driver($by_name),
    'byTable' => rpp_0481_summarize_driver($by_table),
    'exportLog' => $GLOBALS['rpp_0481_export_log'],
    'exportedTables' => array_keys($export_snapshot['db']),
    'applyLog' => $GLOBALS['rpp_0481_apply_log'],
    'validation' => $validation,
    'validateLog' => $GLOBALS['rpp_0481_validate_log'],
    'guardResults' => $guard_results,
    'registryAfterGuards' => array_keys(reprint_push_registered_plugin_owned_row_drivers()),
]);
`, 'utf8');
  const result = spawnSync('php', [file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

test('RPP-0481 release verifier selects the driver registration API guard bundle', () => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const smokeSource = fs.readFileSync(packageSmokePath, 'utf8');
  const selectedFromEnv = parseProductionPluginPackageSelectedScenarios([], 'driver-verifier-guards');

  assert.equal(
    packageJson.scripts['verify:release'],
    'npm run test:playground:production-shaped-topology-proof && REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION=1 REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL=1 REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH=/snapshot npm run test:playground:production-shaped-live-release-verify && npm run test:playground:production-plugin-driver-verifier-guards && npm run test:recovery:file-journal',
  );
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-verifier-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
  assert.deepEqual(scenarioGroups['driver-registration-guards'], registrationGuardCases.map((entry) => entry.scenario));
  assert.deepEqual(scenarioGroups['driver-verifier-guards'], expectedVerifierScenarios);
  assert.deepEqual(Array.from(selectedFromEnv), expectedVerifierScenarios);

  for (const guard of registrationGuardCases) {
    assert.ok(smokeSource.includes(`runScenario('${guard.scenario}'`), `${guard.scenario} is not run by package smoke`);
    assert.ok(smokeSource.includes(`summary.${guard.summaryKey} = {`), `${guard.scenario} does not record ${guard.summaryKey}`);
    assert.ok(smokeSource.includes(guard.summaryFlag), `${guard.scenario} does not record ${guard.summaryFlag}`);
    assert.ok(smokeSource.includes(guard.message), `${guard.scenario} does not assert ${guard.message}`);
  }
});

test('RPP-0481 release verifier driver registration API proves exact accepted and fail-closed behavior', () => {
  const report = runPhpDriverRegistrationProbe();
  const fixtureDriver = {
    driver: arbitraryPluginFixturePackageBoundary.driver,
    table: arbitraryPluginFixturePackageBoundary.table,
    pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
    supportsDelete: false,
    callbacks: {
      exportRowsCallback: true,
      applyRowCallback: true,
      validateMutationCallback: true,
    },
    allowlist: {
      resourceKeys: [],
      rowIds: [],
      payloadModes: [],
    },
  };

  assert.deepEqual(report.driverNames, [
    'reprint-push-release-state',
    arbitraryPluginFixturePackageBoundary.driver,
  ]);
  assert.deepEqual(report.registered, fixtureDriver);
  assert.deepEqual(report.byName, fixtureDriver);
  assert.deepEqual(report.byTable, fixtureDriver);
  assert.deepEqual(report.drivers[arbitraryPluginFixturePackageBoundary.driver], fixtureDriver);
  assert.deepEqual(report.exportedTables, [arbitraryPluginFixturePackageBoundary.table]);
  assert.deepEqual(report.exportLog, [
    {
      driver: arbitraryPluginFixturePackageBoundary.driver,
      table: arbitraryPluginFixturePackageBoundary.table,
      pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
      supportsDelete: false,
      rowId: 'entry_id:1',
    },
  ]);
  assert.deepEqual(report.applyLog, [
    {
      driver: arbitraryPluginFixturePackageBoundary.driver,
      table: arbitraryPluginFixturePackageBoundary.table,
      pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
      supportsDelete: false,
      id: 'entry_id:1',
      isDelete: false,
      mode: 'local-update',
    },
  ]);
  assert.deepEqual(report.validation.acceptedUpdate, { ok: true, value: true });
  assert.equal(report.validation.unsupportedDelete.ok, false);
  assert.equal(report.validation.unsupportedDelete.error.class, 'RuntimeException');
  assert.equal(
    report.validation.unsupportedDelete.error.message,
    `Unsupported plugin-owned mutation delete for ${arbitraryPluginFixturePackageBoundary.resourceKey}`,
  );
  assert.deepEqual(report.validateLog, [
    {
      driver: arbitraryPluginFixturePackageBoundary.driver,
      table: arbitraryPluginFixturePackageBoundary.table,
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      isDelete: false,
    },
  ]);

  for (const guard of registrationGuardCases) {
    const result = report.guardResults[guard.scenario];
    assert.equal(result.ok, false, `${guard.scenario} should fail closed`);
    assert.equal(result.error.class, 'RuntimeException');
    assert.equal(result.error.message, guard.message);
  }
  assert.deepEqual(report.registryAfterGuards, report.driverNames);

  const releaseVerifierEvidence = {
    rpp: 'RPP-0481',
    evidenceSource: 'local-focused-release-verifier-driver-registration-api-v5',
    evidenceScope: 'release-verifier-driver-guard-bundle',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    verifierWiring: {
      selectedScenariosHash: sha256Evidence(expectedVerifierScenarios),
      registrationGuardScenariosHash: sha256Evidence(registrationGuardCases.map((entry) => entry.scenario)),
    },
    accepted: {
      registeredDriverHash: sha256Evidence(report.registered),
      lookupByNameHash: sha256Evidence(report.byName),
      lookupByTableHash: sha256Evidence(report.byTable),
      exportLogHash: sha256Evidence(report.exportLog),
      applyLogHash: sha256Evidence(report.applyLog),
      validationHash: sha256Evidence(report.validation),
    },
    failureClosed: Object.fromEntries(registrationGuardCases.map((guard) => [
      guard.scenario,
      {
        ok: report.guardResults[guard.scenario].ok,
        errorClass: report.guardResults[guard.scenario].error.class,
        errorMessageHash: sha256String(report.guardResults[guard.scenario].error.message),
      },
    ])),
  };
  releaseVerifierEvidence.proofHash = sha256Evidence({
    verifierWiring: releaseVerifierEvidence.verifierWiring,
    accepted: releaseVerifierEvidence.accepted,
    failureClosed: releaseVerifierEvidence.failureClosed,
  });

  for (const hash of Object.values(releaseVerifierEvidence.verifierWiring)) {
    assertSha256Evidence(hash);
  }
  for (const hash of Object.values(releaseVerifierEvidence.accepted)) {
    assertSha256Evidence(hash);
  }
  for (const guard of registrationGuardCases) {
    const refusal = releaseVerifierEvidence.failureClosed[guard.scenario];
    assert.equal(refusal.ok, false);
    assert.equal(refusal.errorClass, 'RuntimeException');
    assertSha256Evidence(refusal.errorMessageHash);
  }
  assertSha256Evidence(releaseVerifierEvidence.proofHash);

  const serializedEvidence = JSON.stringify(releaseVerifierEvidence);
  assert.equal(releaseVerifierEvidence.rawValuesIncluded, false);
  for (const rawValue of [
    arbitraryPluginFixturePackageBoundary.driver,
    arbitraryPluginFixturePackageBoundary.table,
    arbitraryPluginFixturePackageBoundary.pluginOwner,
    arbitraryPluginFixturePackageBoundary.resourceKey,
    'entry_id:1',
    'local-update',
    ...registrationGuardCases.map((entry) => entry.message),
  ]) {
    assert.equal(serializedEvidence.includes(rawValue), false, `release-verifier evidence leaked ${rawValue}`);
  }
  assert.doesNotMatch(serializedEvidence, /exportRowsCallback|applyRowCallback|validateMutationCallback/);
  assert.doesNotMatch(serializedEvidence, /rpp_0481_(?:export_rows|apply_row|validate_mutation)/);
});
