import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
      'if (!function_exists("apply_filters")) {',
      'function apply_filters($hook, $value) { return $value; }',
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
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Evidence(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function sha256String(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function assertSha256Evidence(value) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/);
}

function runDriverRegistrationProbe() {
  const result = spawnSync('php', [
    '-d',
    'display_errors=stderr',
    '-r',
    `
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) {
        if ($hook === 'reprint_push_plugin_owned_row_drivers'
            && isset($GLOBALS['reprint_push_driver_filter'])
            && is_callable($GLOBALS['reprint_push_driver_filter'])) {
            return ($GLOBALS['reprint_push_driver_filter'])($value);
        }
        return $value;
    }
}

require $argv[1];

function reprint_push_probe_export_rows(array &$snapshot, array $driver): void {}
function reprint_push_probe_apply_row(string $id, bool $is_delete, $value, array $driver): void {}
function reprint_push_probe_validate_mutation(array $mutation, array $snapshot, array $driver): bool { return true; }

function reprint_push_probe_sort_for_json($value) {
    if (is_object($value)) {
        $value = (array) $value;
    }
    if (is_array($value)) {
        if (array_keys($value) === range(0, count($value) - 1)) {
            return array_map('reprint_push_probe_sort_for_json', $value);
        }
        ksort($value);
        $sorted = [];
        foreach ($value as $key => $inner_value) {
            $sorted[(string) $key] = reprint_push_probe_sort_for_json($inner_value);
        }
        return $sorted;
    }
    return $value;
}

function reprint_push_probe_stable_json($value): string {
    return json_encode(
        reprint_push_probe_sort_for_json($value),
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
}

function reprint_push_probe_sha256($value): string {
    return 'sha256:' . hash('sha256', reprint_push_probe_stable_json($value));
}

function reprint_push_probe_string_sha256(string $value): string {
    return 'sha256:' . hash('sha256', $value);
}

function reprint_push_probe_driver(
    string $driver_name = 'rpp-proof-secondary-driver',
    string $table = 'wp_rpp_proof_driver_rows',
    string $owner = 'rpp-proof-plugin'
): array {
    return [
        'driver' => $driver_name,
        'table' => $table,
        'pluginOwner' => $owner,
        'supportsDelete' => true,
        'exportRowsCallback' => 'reprint_push_probe_export_rows',
        'applyRowCallback' => 'reprint_push_probe_apply_row',
        'validateMutationCallback' => 'reprint_push_probe_validate_mutation',
        'allowlist' => [
            'resourceKeys' => [
                'row:["' . $table . '","id:1"]',
            ],
            'rowIds' => [
                'id:1',
            ],
        ],
    ];
}

function reprint_push_probe_registration_summary(array $drivers): array {
    $summary = [];
    foreach ($drivers as $name => $driver) {
        $summary[$name] = [
            'driver' => (string) ($driver['driver'] ?? ''),
            'table' => (string) ($driver['table'] ?? ''),
            'pluginOwner' => (string) ($driver['pluginOwner'] ?? ''),
            'supportsDelete' => (bool) ($driver['supportsDelete'] ?? false),
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
    ksort($summary);
    return $summary;
}

function reprint_push_probe_capture(?callable $filter = null): array {
    if ($filter !== null) {
        $GLOBALS['reprint_push_driver_filter'] = $filter;
    } else {
        unset($GLOBALS['reprint_push_driver_filter']);
    }

    try {
        $drivers = reprint_push_registered_plugin_owned_row_drivers();
        $summary = reprint_push_probe_registration_summary($drivers);
        return [
            'ok' => true,
            'driverNames' => array_keys($summary),
            'drivers' => $summary,
            'error' => null,
        ];
    } catch (Throwable $error) {
        return [
            'ok' => false,
            'driverNames' => [],
            'drivers' => [],
            'error' => [
                'class' => get_class($error),
                'messageHash' => reprint_push_probe_string_sha256($error->getMessage()),
            ],
        ];
    } finally {
        unset($GLOBALS['reprint_push_driver_filter']);
    }
}

function reprint_push_probe_valid_filter(array $drivers): array {
    $drivers['proof-secondary-key'] = reprint_push_probe_driver();
    return $drivers;
}

$failure_filters = [
    'missing-driver-name' => static function (array $drivers): array {
        $drivers['rpp-invalid'] = reprint_push_probe_driver('', 'wp_rpp_invalid_rows');
        return $drivers;
    },
    'missing-table' => static function (array $drivers): array {
        $driver = reprint_push_probe_driver('rpp-invalid-driver', 'wp_rpp_invalid_rows');
        unset($driver['table']);
        $drivers['rpp-invalid-driver'] = $driver;
        return $drivers;
    },
    'missing-plugin-owner' => static function (array $drivers): array {
        $driver = reprint_push_probe_driver('rpp-invalid-driver', 'wp_rpp_invalid_rows');
        unset($driver['pluginOwner']);
        $drivers['rpp-invalid-driver'] = $driver;
        return $drivers;
    },
    'missing-export-callback' => static function (array $drivers): array {
        $driver = reprint_push_probe_driver('rpp-invalid-driver', 'wp_rpp_invalid_rows');
        unset($driver['exportRowsCallback']);
        $drivers['rpp-invalid-driver'] = $driver;
        return $drivers;
    },
    'missing-apply-callback' => static function (array $drivers): array {
        $driver = reprint_push_probe_driver('rpp-invalid-driver', 'wp_rpp_invalid_rows');
        unset($driver['applyRowCallback']);
        $drivers['rpp-invalid-driver'] = $driver;
        return $drivers;
    },
    'missing-validate-callback' => static function (array $drivers): array {
        $driver = reprint_push_probe_driver('rpp-invalid-driver', 'wp_rpp_invalid_rows');
        unset($driver['validateMutationCallback']);
        $drivers['rpp-invalid-driver'] = $driver;
        return $drivers;
    },
    'duplicate-driver-name' => static function (array $drivers): array {
        $drivers['rpp-duplicate-a'] = reprint_push_probe_driver('rpp-duplicate-driver', 'wp_rpp_duplicate_rows_a');
        $drivers['rpp-duplicate-b'] = reprint_push_probe_driver('rpp-duplicate-driver', 'wp_rpp_duplicate_rows_b');
        return $drivers;
    },
    'duplicate-table' => static function (array $drivers): array {
        $drivers['rpp-duplicate-table-a'] = reprint_push_probe_driver('rpp-duplicate-table-a', 'wp_rpp_duplicate_rows');
        $drivers['rpp-duplicate-table-b'] = reprint_push_probe_driver('rpp-duplicate-table-b', 'wp_rpp_duplicate_rows');
        return $drivers;
    },
];

$failure_closed = [];
foreach ($failure_filters as $name => $filter) {
    $failure_closed[$name] = reprint_push_probe_capture($filter);
}
ksort($failure_closed);

$valid_filter = 'reprint_push_probe_valid_filter';
$GLOBALS['reprint_push_driver_filter'] = $valid_filter;
$by_name = reprint_push_plugin_owned_row_driver_by_name('rpp-proof-secondary-driver');
$by_table = reprint_push_plugin_owned_row_driver_for_table('wp_rpp_proof_driver_rows');
unset($GLOBALS['reprint_push_driver_filter']);

$evidence = [
    'proof' => 'RPP-0421 driver registration API variant 2',
    'redaction' => [
        'errorMessages' => 'sha256-only',
        'rawErrorMessagesIncluded' => false,
    ],
    'defaultRegistration' => reprint_push_probe_capture(),
    'validExtension' => reprint_push_probe_capture($valid_filter),
    'lookupProof' => [
        'byName' => reprint_push_probe_registration_summary(['rpp-proof-secondary-driver' => $by_name])['rpp-proof-secondary-driver'],
        'byTable' => reprint_push_probe_registration_summary(['rpp-proof-secondary-driver' => $by_table])['rpp-proof-secondary-driver'],
    ],
    'filterNotArray' => reprint_push_probe_capture(static function (array $drivers) {
        return 'not-a-driver-list';
    }),
    'failureClosed' => $failure_closed,
];

$evidence['hashes'] = [
    'defaultRegistrationHash' => reprint_push_probe_sha256($evidence['defaultRegistration']),
    'validExtensionHash' => reprint_push_probe_sha256($evidence['validExtension']),
    'lookupProofHash' => reprint_push_probe_sha256($evidence['lookupProof']),
    'filterNotArrayHash' => reprint_push_probe_sha256($evidence['filterNotArray']),
    'failureClosedHash' => reprint_push_probe_sha256($evidence['failureClosed']),
];
$evidence['proofHash'] = reprint_push_probe_sha256([
    'proof' => $evidence['proof'],
    'hashes' => $evidence['hashes'],
]);

echo reprint_push_probe_stable_json($evidence);
`,
    snapshotLib,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('snapshot apply gate allows only named lab plugin resources', { skip: !hasPhp }, () => {
  assertSupported({ type: 'plugin', name: 'reprint-push-forms-fixture' });
  assertSupported({ type: 'plugin', name: 'reprint-push-atomic-dependency-fixture' });

  assertRejected(
    { type: 'plugin', name: 'akismet' },
    /Unsupported fixture plugin: akismet/,
  );
});

test('RPP-0461 driver registration API focused regression emits hash-only accepted and refusal evidence', { skip: !hasPhp }, () => {
  const evidence = runDriverRegistrationProbe();
  const defaultDriver = evidence.defaultRegistration.drivers['reprint-push-release-state'];
  const extensionDriver = evidence.validExtension.drivers['rpp-proof-secondary-driver'];
  const failureScenarios = [
    'missing-driver-name',
    'missing-table',
    'missing-plugin-owner',
    'missing-export-callback',
    'missing-apply-callback',
    'missing-validate-callback',
  ];
  const ambiguousScenarios = [
    'duplicate-driver-name',
    'duplicate-table',
  ];
  const expectedFailureMessages = {
    'duplicate-driver-name': 'duplicate driver name: rpp-duplicate-driver',
    'duplicate-table': 'duplicate table mapping for table: wp_rpp_duplicate_rows',
    'missing-apply-callback': 'missing applyRowCallback for driver: rpp-invalid-driver',
    'missing-driver-name': 'missing driver name for table: wp_rpp_invalid_rows',
    'missing-export-callback': 'missing exportRowsCallback for driver: rpp-invalid-driver',
    'missing-plugin-owner': 'missing pluginOwner for driver: rpp-invalid-driver',
    'missing-table': 'missing table for driver: rpp-invalid-driver',
    'missing-validate-callback': 'missing validateMutationCallback for driver: rpp-invalid-driver',
  };

  assert.equal(evidence.proof, 'RPP-0421 driver registration API variant 2');
  assert.equal(evidence.redaction.errorMessages, 'sha256-only');
  assert.equal(evidence.redaction.rawErrorMessagesIncluded, false);
  assert.equal(evidence.defaultRegistration.ok, true);
  assert.deepEqual(evidence.defaultRegistration.driverNames, ['reprint-push-release-state']);
  assert.deepEqual(defaultDriver, {
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
  assert.equal(evidence.validExtension.ok, true);
  assert.deepEqual(evidence.validExtension.driverNames, [
    'reprint-push-release-state',
    'rpp-proof-secondary-driver',
  ]);
  assert.deepEqual(extensionDriver, {
    driver: 'rpp-proof-secondary-driver',
    table: 'wp_rpp_proof_driver_rows',
    pluginOwner: 'rpp-proof-plugin',
    supportsDelete: true,
    callbacks: {
      exportRowsCallback: true,
      applyRowCallback: true,
      validateMutationCallback: true,
    },
    allowlist: {
      resourceKeys: ['row:["wp_rpp_proof_driver_rows","id:1"]'],
      rowIds: ['id:1'],
      payloadModes: [],
    },
  });
  assert.deepEqual(evidence.lookupProof.byName, extensionDriver);
  assert.deepEqual(evidence.lookupProof.byTable, extensionDriver);
  assert.equal(evidence.filterNotArray.ok, true);
  assert.deepEqual(evidence.filterNotArray.driverNames, []);
  assert.deepEqual(evidence.filterNotArray.drivers, []);

  for (const scenario of [...failureScenarios, ...ambiguousScenarios]) {
    const refusal = evidence.failureClosed[scenario];
    assert.equal(refusal.ok, false, `${scenario} should fail closed`);
    assert.equal(refusal.error.class, 'RuntimeException');
    assert.equal(refusal.error.messageHash, sha256String(expectedFailureMessages[scenario]));
    assert.deepEqual(refusal.driverNames, []);
    assert.deepEqual(refusal.drivers, []);
  }

  const focusedEvidence = {
    rpp: 'RPP-0461',
    evidenceSource: 'local-focused-plugin-driver-registration-test',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    accepted: {
      defaultDriverHash: sha256Evidence(defaultDriver),
      extensionDriverHash: sha256Evidence(extensionDriver),
      lookupProofHash: sha256Evidence(evidence.lookupProof),
      filterNotArrayHash: sha256Evidence(evidence.filterNotArray),
    },
    failureClosed: Object.fromEntries([...failureScenarios, ...ambiguousScenarios].map((scenario) => [
      scenario,
      {
        ok: evidence.failureClosed[scenario].ok,
        errorClass: evidence.failureClosed[scenario].error.class,
        errorMessageHash: evidence.failureClosed[scenario].error.messageHash,
        registrationHash: sha256Evidence(evidence.failureClosed[scenario]),
      },
    ])),
  };
  focusedEvidence.proofHash = sha256Evidence({
    accepted: focusedEvidence.accepted,
    failureClosed: focusedEvidence.failureClosed,
  });

  for (const value of Object.values(focusedEvidence.accepted)) {
    assertSha256Evidence(value);
  }
  for (const scenario of [...failureScenarios, ...ambiguousScenarios]) {
    assert.equal(focusedEvidence.failureClosed[scenario].ok, false);
    assert.equal(focusedEvidence.failureClosed[scenario].errorClass, 'RuntimeException');
    assertSha256Evidence(focusedEvidence.failureClosed[scenario].errorMessageHash);
    assertSha256Evidence(focusedEvidence.failureClosed[scenario].registrationHash);
  }
  assertSha256Evidence(focusedEvidence.proofHash);

  const serializedFocusedEvidence = JSON.stringify(focusedEvidence);
  const rawFailureMessages = Object.values(expectedFailureMessages);
  for (const message of rawFailureMessages) {
    assert.equal(serializedFocusedEvidence.includes(message), false, `focused evidence leaked ${message}`);
  }
  assert.doesNotMatch(serializedFocusedEvidence, /exportRowsCallback|applyRowCallback|validateMutationCallback/);
  assert.doesNotMatch(serializedFocusedEvidence, /wp_rpp_invalid_rows|wp_rpp_duplicate_rows/);
});

test('plugin-owned row driver registration API returns exact drivers and fails closed on malformed registrations', { skip: !hasPhp }, () => {
  const evidence = runDriverRegistrationProbe();
  const defaultDriver = evidence.defaultRegistration.drivers['reprint-push-release-state'];
  const extensionDriver = evidence.validExtension.drivers['rpp-proof-secondary-driver'];

  assert.equal(evidence.proof, 'RPP-0421 driver registration API variant 2');
  assert.equal(evidence.redaction.errorMessages, 'sha256-only');
  assert.equal(evidence.redaction.rawErrorMessagesIncluded, false);
  assert.equal(evidence.defaultRegistration.ok, true);
  assert.deepEqual(evidence.defaultRegistration.driverNames, ['reprint-push-release-state']);
  assert.deepEqual(defaultDriver, {
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

  assert.equal(evidence.validExtension.ok, true);
  assert.deepEqual(evidence.validExtension.driverNames, [
    'reprint-push-release-state',
    'rpp-proof-secondary-driver',
  ]);
  assert.deepEqual(extensionDriver, {
    driver: 'rpp-proof-secondary-driver',
    table: 'wp_rpp_proof_driver_rows',
    pluginOwner: 'rpp-proof-plugin',
    supportsDelete: true,
    callbacks: {
      exportRowsCallback: true,
      applyRowCallback: true,
      validateMutationCallback: true,
    },
    allowlist: {
      resourceKeys: ['row:["wp_rpp_proof_driver_rows","id:1"]'],
      rowIds: ['id:1'],
      payloadModes: [],
    },
  });
  assert.deepEqual(evidence.lookupProof.byName, extensionDriver);
  assert.deepEqual(evidence.lookupProof.byTable, extensionDriver);
  assert.equal(evidence.filterNotArray.ok, true);
  assert.deepEqual(evidence.filterNotArray.driverNames, []);
  assert.deepEqual(evidence.filterNotArray.drivers, []);

  const expectedFailureMessages = {
    'duplicate-driver-name': 'duplicate driver name: rpp-duplicate-driver',
    'duplicate-table': 'duplicate table mapping for table: wp_rpp_duplicate_rows',
    'missing-apply-callback': 'missing applyRowCallback for driver: rpp-invalid-driver',
    'missing-driver-name': 'missing driver name for table: wp_rpp_invalid_rows',
    'missing-export-callback': 'missing exportRowsCallback for driver: rpp-invalid-driver',
    'missing-plugin-owner': 'missing pluginOwner for driver: rpp-invalid-driver',
    'missing-table': 'missing table for driver: rpp-invalid-driver',
    'missing-validate-callback': 'missing validateMutationCallback for driver: rpp-invalid-driver',
  };
  assert.deepEqual(Object.keys(evidence.failureClosed), Object.keys(expectedFailureMessages).sort());

  for (const [scenario, message] of Object.entries(expectedFailureMessages)) {
    assert.equal(evidence.failureClosed[scenario].ok, false, `${scenario} should fail closed`);
    assert.equal(evidence.failureClosed[scenario].error.class, 'RuntimeException');
    assert.equal(evidence.failureClosed[scenario].error.messageHash, sha256String(message));
    assert.deepEqual(evidence.failureClosed[scenario].driverNames, []);
    assert.deepEqual(evidence.failureClosed[scenario].drivers, []);
  }

  assert.equal(evidence.hashes.defaultRegistrationHash, sha256Evidence(evidence.defaultRegistration));
  assert.equal(evidence.hashes.validExtensionHash, sha256Evidence(evidence.validExtension));
  assert.equal(evidence.hashes.lookupProofHash, sha256Evidence(evidence.lookupProof));
  assert.equal(evidence.hashes.filterNotArrayHash, sha256Evidence(evidence.filterNotArray));
  assert.equal(evidence.hashes.failureClosedHash, sha256Evidence(evidence.failureClosed));
  assert.equal(evidence.proofHash, sha256Evidence({
    proof: evidence.proof,
    hashes: evidence.hashes,
  }));
  assert.doesNotMatch(JSON.stringify(evidence), /missing (?:driver|table|pluginOwner|exportRowsCallback|applyRowCallback|validateMutationCallback)|duplicate (?:driver|table)/i);
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
