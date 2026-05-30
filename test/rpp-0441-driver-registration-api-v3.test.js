import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0441-driver-registration-'));
  const file = path.join(dir, 'probe.php');
  fs.writeFileSync(file, `<?php
function apply_filters($hook_name, $value) {
    if ($hook_name === 'reprint_push_plugin_owned_row_drivers'
        && isset($GLOBALS['rpp_0441_driver_filter'])
        && is_callable($GLOBALS['rpp_0441_driver_filter'])) {
        return ($GLOBALS['rpp_0441_driver_filter'])($value);
    }
    return $value;
}
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
class Rpp0441WpdbStub {
    public string $prefix = 'wp_';
    public function prepare($query, ...$args) { return $query; }
    public function get_var($query) { return null; }
    public function get_results($query, $output = null) { return []; }
    public function query($query) { return true; }
    public function get_charset_collate() { return ''; }
}
$GLOBALS['wpdb'] = new Rpp0441WpdbStub();
require ${JSON.stringify(snapshotLibPath)};

function rpp_0441_export_rows(array &$snapshot, array $driver): void {
    $table = (string) $driver['table'];
    if (!isset($snapshot['db']) || !is_array($snapshot['db'])) {
        $snapshot['db'] = [];
    }
    if (!isset($snapshot['db'][$table]) || !is_array($snapshot['db'][$table])) {
        $snapshot['db'][$table] = [];
    }
    $row_id = 'id:' . (count($snapshot['db'][$table]) + 1);
    $snapshot['db'][$table][$row_id] = [
        'id' => count($snapshot['db'][$table]) + 1,
        'marker' => 'exported-' . (string) $driver['driver'],
        '__pluginOwner' => (string) $driver['pluginOwner'],
    ];
    $GLOBALS['rpp_0441_export_log'][] = [
        'driver' => (string) $driver['driver'],
        'table' => $table,
        'pluginOwner' => (string) $driver['pluginOwner'],
        'supportsDelete' => !empty($driver['supportsDelete']),
        'rowId' => $row_id,
    ];
}

function rpp_0441_apply_row(string $id, bool $is_delete, $value, array $driver): void {
    $GLOBALS['rpp_0441_apply_log'][] = [
        'driver' => (string) $driver['driver'],
        'table' => (string) $driver['table'],
        'pluginOwner' => (string) $driver['pluginOwner'],
        'supportsDelete' => !empty($driver['supportsDelete']),
        'id' => $id,
        'isDelete' => $is_delete,
        'valueMarker' => is_array($value) ? (string) ($value['marker'] ?? '') : '',
    ];
}

function rpp_0441_validate_mutation(array $mutation, array $snapshot, array $driver): bool {
    $resource = is_array($mutation['resource'] ?? null) ? $mutation['resource'] : [];
    $policy = is_array($mutation['pluginOwnedResource'] ?? null) ? $mutation['pluginOwnedResource'] : [];
    $value = $mutation['value']['value'] ?? null;
    $is_delete = !empty($mutation['value']['absent']);
    $owner = is_array($value) ? (string) ($value['__pluginOwner'] ?? '') : '';
    $table = (string) $driver['table'];
    $id = (string) ($resource['id'] ?? '');
    if ($owner === '' && isset($snapshot['db'][$table][$id]) && is_array($snapshot['db'][$table][$id])) {
        $owner = (string) ($snapshot['db'][$table][$id]['__pluginOwner'] ?? '');
    }
    $accepted = (string) ($resource['table'] ?? '') === $table
        && (string) ($policy['driver'] ?? '') === (string) $driver['driver']
        && $owner === (string) $driver['pluginOwner']
        && ($is_delete || (is_array($value) && (string) ($value['marker'] ?? '') !== 'reject'));
    $GLOBALS['rpp_0441_validate_log'][] = [
        'driver' => (string) $driver['driver'],
        'resourceKey' => (string) ($mutation['resourceKey'] ?? ''),
        'isDelete' => $is_delete,
        'owner' => $owner,
        'accepted' => $accepted,
    ];
    return $accepted;
}

function rpp_0441_driver(string $driver, string $table, string $owner, bool $supports_delete): array {
    return [
        'driver' => $driver,
        'table' => $table,
        'pluginOwner' => $owner,
        'supportsDelete' => $supports_delete,
        'exportRowsCallback' => 'rpp_0441_export_rows',
        'applyRowCallback' => 'rpp_0441_apply_row',
        'validateMutationCallback' => 'rpp_0441_validate_mutation',
    ];
}

function rpp_0441_summarize_driver($driver) {
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

function rpp_0441_capture(callable $callback): array {
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

function rpp_0441_capture_with_filter(callable $filter, callable $callback): array {
    $had_filter = array_key_exists('rpp_0441_driver_filter', $GLOBALS);
    $previous_filter = $GLOBALS['rpp_0441_driver_filter'] ?? null;
    $GLOBALS['rpp_0441_driver_filter'] = $filter;
    try {
        return rpp_0441_capture($callback);
    } finally {
        if ($had_filter) {
            $GLOBALS['rpp_0441_driver_filter'] = $previous_filter;
        } else {
            unset($GLOBALS['rpp_0441_driver_filter']);
        }
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

test('RPP-0441 generated driver registration API v3 proves exact registered behavior', () => {
  const report = runPhpDriverProbe(`
$generated_drivers = [
    'api-alpha-supports-delete' => rpp_0441_driver(
        'rpp-0441-alpha-driver',
        'wp_rpp_0441_alpha_rows',
        'rpp-0441-alpha-plugin',
        true
    ),
    'api-beta-no-delete' => rpp_0441_driver(
        'rpp-0441-beta-driver',
        'wp_rpp_0441_beta_rows',
        'rpp-0441-beta-plugin',
        false
    ),
];
$registered = [];
foreach ($generated_drivers as $variant => $driver) {
    $registered[$variant] = rpp_0441_summarize_driver(
        reprint_push_register_plugin_owned_row_driver($driver)
    );
}

$valid_filter = static function (array $drivers): array {
    $drivers['rpp-0441-filter-key-driver'] = [
        'table' => 'wp_rpp_0441_filter_rows',
        'pluginOwner' => 'rpp-0441-filter-plugin',
        'supportsDelete' => true,
        'exportRowsCallback' => 'rpp_0441_export_rows',
        'applyRowCallback' => 'rpp_0441_apply_row',
        'validateMutationCallback' => 'rpp_0441_validate_mutation',
    ];
    return $drivers;
};
$GLOBALS['rpp_0441_driver_filter'] = $valid_filter;

$drivers = reprint_push_registered_plugin_owned_row_drivers();
$driver_summary = [];
foreach ($drivers as $name => $driver) {
    $driver_summary[$name] = rpp_0441_summarize_driver($driver);
}

$policy_snapshot = [
    'db' => [
        'wp_options' => [],
        'wp_postmeta' => [],
        'wp_reprint_push_forms_lab' => [],
        'wp_rpp_0441_alpha_rows' => [
            'id:7' => ['id' => 7, '__pluginOwner' => 'rpp-0441-alpha-plugin'],
        ],
        'wp_rpp_0441_beta_rows' => [
            'id:8' => ['id' => 8, '__pluginOwner' => 'rpp-0441-beta-plugin'],
        ],
        'wp_rpp_0441_filter_rows' => [
            'id:9' => ['id' => 9, '__pluginOwner' => 'rpp-0441-filter-plugin'],
        ],
    ],
    'meta' => [],
];
reprint_push_add_fixture_plugin_owned_policy($policy_snapshot);

$GLOBALS['rpp_0441_export_log'] = [];
$export_snapshot = ['db' => []];
reprint_push_export_registered_plugin_owned_rows($export_snapshot);

$GLOBALS['rpp_0441_apply_log'] = [];
reprint_push_apply_row_resource('wp_rpp_0441_alpha_rows', 'id:7', false, ['marker' => 'alpha-apply']);
reprint_push_apply_row_resource('wp_rpp_0441_filter_rows', 'id:9', true, ['marker' => 'filter-delete']);

$GLOBALS['rpp_0441_validate_log'] = [];
$validation_snapshot = [
    'db' => [
        'wp_rpp_0441_alpha_rows' => [
            'id:7' => ['id' => 7, '__pluginOwner' => 'rpp-0441-alpha-plugin'],
        ],
        'wp_rpp_0441_beta_rows' => [
            'id:8' => ['id' => 8, '__pluginOwner' => 'rpp-0441-beta-plugin'],
        ],
    ],
];
$validation = [
    'acceptedPut' => rpp_0441_capture(static function () use ($validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation([
            'resourceKey' => 'row:["wp_rpp_0441_alpha_rows","id:7"]',
            'resource' => ['type' => 'row', 'table' => 'wp_rpp_0441_alpha_rows', 'id' => 'id:7'],
            'value' => ['value' => ['id' => 7, 'marker' => 'accept', '__pluginOwner' => 'rpp-0441-alpha-plugin']],
            'pluginOwnedResource' => ['driver' => 'rpp-0441-alpha-driver'],
        ], $validation_snapshot);
        return true;
    }),
    'acceptedDelete' => rpp_0441_capture(static function () use ($validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation([
            'resourceKey' => 'row:["wp_rpp_0441_alpha_rows","id:7"]',
            'resource' => ['type' => 'row', 'table' => 'wp_rpp_0441_alpha_rows', 'id' => 'id:7'],
            'value' => ['absent' => true],
            'pluginOwnedResource' => ['driver' => 'rpp-0441-alpha-driver'],
        ], $validation_snapshot);
        return true;
    }),
    'unsupportedDelete' => rpp_0441_capture(static function () use ($validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation([
            'resourceKey' => 'row:["wp_rpp_0441_beta_rows","id:8"]',
            'resource' => ['type' => 'row', 'table' => 'wp_rpp_0441_beta_rows', 'id' => 'id:8'],
            'value' => ['absent' => true],
            'pluginOwnedResource' => ['driver' => 'rpp-0441-beta-driver'],
        ], $validation_snapshot);
        return true;
    }),
    'rejectedByCallback' => rpp_0441_capture(static function () use ($validation_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation([
            'resourceKey' => 'row:["wp_rpp_0441_alpha_rows","id:7"]',
            'resource' => ['type' => 'row', 'table' => 'wp_rpp_0441_alpha_rows', 'id' => 'id:7'],
            'value' => ['value' => ['id' => 7, 'marker' => 'reject', '__pluginOwner' => 'rpp-0441-alpha-plugin']],
            'pluginOwnedResource' => ['driver' => 'rpp-0441-alpha-driver'],
        ], $validation_snapshot);
        return true;
    }),
];

$refusals = [
    'missingApiDriverName' => rpp_0441_capture(static function (): array {
        return reprint_push_register_plugin_owned_row_driver([
            'table' => 'wp_rpp_0441_missing_name_rows',
            'pluginOwner' => 'rpp-0441-missing-name-plugin',
            'exportRowsCallback' => 'rpp_0441_export_rows',
            'applyRowCallback' => 'rpp_0441_apply_row',
            'validateMutationCallback' => 'rpp_0441_validate_mutation',
        ]);
    }),
    'duplicateRegistryDriverName' => rpp_0441_capture(static function (): array {
        return reprint_push_register_plugin_owned_row_driver(
            rpp_0441_driver(
                'rpp-0441-alpha-driver',
                'wp_rpp_0441_duplicate_name_rows',
                'rpp-0441-alpha-plugin',
                true
            )
        );
    }),
    'duplicateFilterTable' => rpp_0441_capture_with_filter(
        static function (array $drivers): array {
            $drivers['rpp-0441-filter-duplicate-table-driver'] = rpp_0441_driver(
                'rpp-0441-filter-duplicate-table-driver',
                'wp_rpp_0441_alpha_rows',
                'rpp-0441-filter-plugin',
                true
            );
            return $drivers;
        },
        static function (): array {
            return array_keys(reprint_push_registered_plugin_owned_row_drivers());
        }
    ),
    'nonArrayFilter' => rpp_0441_capture_with_filter(
        static function (array $drivers) {
            return 'not-a-driver-list';
        },
        static function (): array {
            return array_keys(reprint_push_registered_plugin_owned_row_drivers());
        }
    ),
];

$lookups = [
    'alphaByName' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_by_name('rpp-0441-alpha-driver')
    ),
    'alphaByTable' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_for_table('wp_rpp_0441_alpha_rows')
    ),
    'filterByName' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_by_name('rpp-0441-filter-key-driver')
    ),
    'filterByTable' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_for_table('wp_rpp_0441_filter_rows')
    ),
    'missingByName' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_by_name('rpp-0441-missing-driver')
    ),
    'missingByTable' => rpp_0441_summarize_driver(
        reprint_push_plugin_owned_row_driver_for_table('wp_rpp_0441_missing_rows')
    ),
];

$registry_after_refusals = array_keys(reprint_push_registered_plugin_owned_row_drivers());

echo json_encode([
    'generatedVariants' => array_keys($generated_drivers),
    'registered' => $registered,
    'driverNames' => array_keys($drivers),
    'drivers' => $driver_summary,
    'lookups' => $lookups,
    'policyAllowed' => $policy_snapshot['meta']['pluginOwnedResources']['allowedResources'],
    'exportLog' => $GLOBALS['rpp_0441_export_log'],
    'exportedTables' => array_keys($export_snapshot['db']),
    'applyLog' => $GLOBALS['rpp_0441_apply_log'],
    'validation' => $validation,
    'validateLog' => $GLOBALS['rpp_0441_validate_log'],
    'refusals' => $refusals,
    'registryAfterRefusals' => $registry_after_refusals,
]);
`);

  assert.deepEqual(report.generatedVariants, [
    'api-alpha-supports-delete',
    'api-beta-no-delete',
  ]);
  assert.deepEqual(report.driverNames, [
    'reprint-push-release-state',
    'rpp-0441-alpha-driver',
    'rpp-0441-beta-driver',
    'rpp-0441-filter-key-driver',
  ]);
  assert.deepEqual(report.drivers['reprint-push-release-state'], {
    driver: 'reprint-push-release-state',
    table: 'wp_reprint_push_release_state',
    pluginOwner: 'reprint-push',
    supportsDelete: false,
    callbacks: {
      exportRowsCallback: true,
      applyRowCallback: true,
      validateMutationCallback: true,
    },
    allowlist: {
      resourceKeys: ['row:["wp_reprint_push_release_state","state_id:1"]'],
      rowIds: ['state_id:1'],
      payloadModes: ['base', 'local-update', 'remote-changed'],
    },
  });

  const alphaDriver = {
    driver: 'rpp-0441-alpha-driver',
    table: 'wp_rpp_0441_alpha_rows',
    pluginOwner: 'rpp-0441-alpha-plugin',
    supportsDelete: true,
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
  const betaDriver = {
    driver: 'rpp-0441-beta-driver',
    table: 'wp_rpp_0441_beta_rows',
    pluginOwner: 'rpp-0441-beta-plugin',
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
  const filterDriver = {
    driver: 'rpp-0441-filter-key-driver',
    table: 'wp_rpp_0441_filter_rows',
    pluginOwner: 'rpp-0441-filter-plugin',
    supportsDelete: true,
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

  assert.deepEqual(report.registered['api-alpha-supports-delete'], alphaDriver);
  assert.deepEqual(report.registered['api-beta-no-delete'], betaDriver);
  assert.deepEqual(report.drivers['rpp-0441-alpha-driver'], alphaDriver);
  assert.deepEqual(report.drivers['rpp-0441-beta-driver'], betaDriver);
  assert.deepEqual(report.drivers['rpp-0441-filter-key-driver'], filterDriver);
  assert.deepEqual(report.lookups.alphaByName, alphaDriver);
  assert.deepEqual(report.lookups.alphaByTable, alphaDriver);
  assert.deepEqual(report.lookups.filterByName, filterDriver);
  assert.deepEqual(report.lookups.filterByTable, filterDriver);
  assert.equal(report.lookups.missingByName, null);
  assert.equal(report.lookups.missingByTable, null);

  assert.deepEqual(report.policyAllowed, [
    {
      resourceKey: 'row:["wp_rpp_0441_alpha_rows","id:7"]',
      pluginOwner: 'rpp-0441-alpha-plugin',
      driver: 'rpp-0441-alpha-driver',
      table: 'wp_rpp_0441_alpha_rows',
      supportsDelete: true,
    },
    {
      resourceKey: 'row:["wp_rpp_0441_beta_rows","id:8"]',
      pluginOwner: 'rpp-0441-beta-plugin',
      driver: 'rpp-0441-beta-driver',
      table: 'wp_rpp_0441_beta_rows',
      supportsDelete: false,
    },
    {
      resourceKey: 'row:["wp_rpp_0441_filter_rows","id:9"]',
      pluginOwner: 'rpp-0441-filter-plugin',
      driver: 'rpp-0441-filter-key-driver',
      table: 'wp_rpp_0441_filter_rows',
      supportsDelete: true,
    },
  ]);
  assert.deepEqual(report.exportLog, [
    {
      driver: 'rpp-0441-alpha-driver',
      table: 'wp_rpp_0441_alpha_rows',
      pluginOwner: 'rpp-0441-alpha-plugin',
      supportsDelete: true,
      rowId: 'id:1',
    },
    {
      driver: 'rpp-0441-beta-driver',
      table: 'wp_rpp_0441_beta_rows',
      pluginOwner: 'rpp-0441-beta-plugin',
      supportsDelete: false,
      rowId: 'id:1',
    },
    {
      driver: 'rpp-0441-filter-key-driver',
      table: 'wp_rpp_0441_filter_rows',
      pluginOwner: 'rpp-0441-filter-plugin',
      supportsDelete: true,
      rowId: 'id:1',
    },
  ]);
  assert.deepEqual(report.exportedTables, [
    'wp_rpp_0441_alpha_rows',
    'wp_rpp_0441_beta_rows',
    'wp_rpp_0441_filter_rows',
  ]);
  assert.deepEqual(report.applyLog, [
    {
      driver: 'rpp-0441-alpha-driver',
      table: 'wp_rpp_0441_alpha_rows',
      pluginOwner: 'rpp-0441-alpha-plugin',
      supportsDelete: true,
      id: 'id:7',
      isDelete: false,
      valueMarker: 'alpha-apply',
    },
    {
      driver: 'rpp-0441-filter-key-driver',
      table: 'wp_rpp_0441_filter_rows',
      pluginOwner: 'rpp-0441-filter-plugin',
      supportsDelete: true,
      id: 'id:9',
      isDelete: true,
      valueMarker: 'filter-delete',
    },
  ]);

  assert.deepEqual(report.validation.acceptedPut, { ok: true, value: true });
  assert.deepEqual(report.validation.acceptedDelete, { ok: true, value: true });
  assert.equal(report.validation.unsupportedDelete.ok, false);
  assert.equal(report.validation.unsupportedDelete.error.class, 'RuntimeException');
  assert.equal(
    report.validation.unsupportedDelete.error.message,
    'Unsupported plugin-owned mutation delete for row:["wp_rpp_0441_beta_rows","id:8"]',
  );
  assert.equal(report.validation.rejectedByCallback.ok, false);
  assert.equal(report.validation.rejectedByCallback.error.class, 'RuntimeException');
  assert.equal(
    report.validation.rejectedByCallback.error.message,
    'Unsupported plugin-owned mutation driver for row:["wp_rpp_0441_alpha_rows","id:7"]',
  );
  assert.deepEqual(report.validateLog, [
    {
      driver: 'rpp-0441-alpha-driver',
      resourceKey: 'row:["wp_rpp_0441_alpha_rows","id:7"]',
      isDelete: false,
      owner: 'rpp-0441-alpha-plugin',
      accepted: true,
    },
    {
      driver: 'rpp-0441-alpha-driver',
      resourceKey: 'row:["wp_rpp_0441_alpha_rows","id:7"]',
      isDelete: true,
      owner: 'rpp-0441-alpha-plugin',
      accepted: true,
    },
    {
      driver: 'rpp-0441-alpha-driver',
      resourceKey: 'row:["wp_rpp_0441_alpha_rows","id:7"]',
      isDelete: false,
      owner: 'rpp-0441-alpha-plugin',
      accepted: false,
    },
  ]);

  assert.equal(report.refusals.missingApiDriverName.ok, false);
  assert.equal(report.refusals.missingApiDriverName.error.class, 'RuntimeException');
  assert.equal(
    report.refusals.missingApiDriverName.error.message,
    'missing driver name for table: wp_rpp_0441_missing_name_rows',
  );
  assert.equal(report.refusals.duplicateRegistryDriverName.ok, false);
  assert.equal(report.refusals.duplicateRegistryDriverName.error.class, 'RuntimeException');
  assert.equal(
    report.refusals.duplicateRegistryDriverName.error.message,
    'duplicate driver name: rpp-0441-alpha-driver',
  );
  assert.equal(report.refusals.duplicateFilterTable.ok, false);
  assert.equal(report.refusals.duplicateFilterTable.error.class, 'RuntimeException');
  assert.equal(
    report.refusals.duplicateFilterTable.error.message,
    'duplicate table mapping for table: wp_rpp_0441_alpha_rows',
  );
  assert.deepEqual(report.refusals.nonArrayFilter, { ok: true, value: [] });
  assert.deepEqual(report.registryAfterRefusals, report.driverNames);

  const focusedEvidence = {
    rpp: 'RPP-0441',
    evidenceSource: 'local-generated-plugin-driver-registration-api-v3',
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    accepted: {
      generatedVariantsHash: sha256Evidence(report.generatedVariants),
      registeredDriversHash: sha256Evidence(report.drivers),
      lookupHash: sha256Evidence(report.lookups),
      policyAllowedHash: sha256Evidence(report.policyAllowed),
      exportLogHash: sha256Evidence(report.exportLog),
      applyLogHash: sha256Evidence(report.applyLog),
      validationHash: sha256Evidence(report.validation),
      registryAfterRefusalsHash: sha256Evidence(report.registryAfterRefusals),
    },
    refused: {
      missingApiDriverName: {
        ok: report.refusals.missingApiDriverName.ok,
        errorClass: report.refusals.missingApiDriverName.error.class,
        errorMessageHash: sha256String(report.refusals.missingApiDriverName.error.message),
      },
      duplicateRegistryDriverName: {
        ok: report.refusals.duplicateRegistryDriverName.ok,
        errorClass: report.refusals.duplicateRegistryDriverName.error.class,
        errorMessageHash: sha256String(report.refusals.duplicateRegistryDriverName.error.message),
      },
      duplicateFilterTable: {
        ok: report.refusals.duplicateFilterTable.ok,
        errorClass: report.refusals.duplicateFilterTable.error.class,
        errorMessageHash: sha256String(report.refusals.duplicateFilterTable.error.message),
      },
      nonArrayFilterHash: sha256Evidence(report.refusals.nonArrayFilter),
    },
  };
  focusedEvidence.proofHash = sha256Evidence({
    accepted: focusedEvidence.accepted,
    refused: focusedEvidence.refused,
  });

  for (const hash of Object.values(focusedEvidence.accepted)) {
    assertSha256Evidence(hash);
  }
  for (const [scenario, refusal] of Object.entries(focusedEvidence.refused)) {
    if (scenario === 'nonArrayFilterHash') {
      assertSha256Evidence(refusal);
      continue;
    }
    assert.equal(refusal.ok, false);
    assert.equal(refusal.errorClass, 'RuntimeException');
    assertSha256Evidence(refusal.errorMessageHash);
  }
  assertSha256Evidence(focusedEvidence.proofHash);

  const serializedFocusedEvidence = JSON.stringify(focusedEvidence);
  assert.equal(focusedEvidence.rawValuesIncluded, false);
  for (const rawValue of [
    'rpp-0441-alpha-driver',
    'rpp-0441-beta-driver',
    'rpp-0441-filter-key-driver',
    'wp_rpp_0441_alpha_rows',
    'wp_rpp_0441_beta_rows',
    'wp_rpp_0441_filter_rows',
    'wp_rpp_0441_missing_name_rows',
    'rpp-0441-alpha-plugin',
    'rpp-0441-beta-plugin',
    'rpp-0441-filter-plugin',
    'row:["wp_rpp_0441_alpha_rows","id:7"]',
    'Unsupported plugin-owned mutation delete for row:["wp_rpp_0441_beta_rows","id:8"]',
    'Unsupported plugin-owned mutation driver for row:["wp_rpp_0441_alpha_rows","id:7"]',
    'missing driver name for table: wp_rpp_0441_missing_name_rows',
    'duplicate driver name: rpp-0441-alpha-driver',
    'duplicate table mapping for table: wp_rpp_0441_alpha_rows',
  ]) {
    assert.equal(serializedFocusedEvidence.includes(rawValue), false, `focused evidence leaked ${rawValue}`);
  }
  assert.doesNotMatch(serializedFocusedEvidence, /exportRowsCallback|applyRowCallback|validateMutationCallback/);
  assert.doesNotMatch(serializedFocusedEvidence, /rpp_0441_(?:export_rows|apply_row|validate_mutation)/);
});
