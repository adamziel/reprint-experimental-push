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
const bareSha256Pattern = /^[a-f0-9]{64}$/;

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

test('registered plugin-owned row drivers export explicit row-driver contracts in snapshot policy', () => {
  const report = runPhpDriverProbe(`
reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-contract-driver',
    'table' => 'wp_fixture_contract_rows',
    'pluginOwner' => 'fixture-contract-plugin',
    'supportsDelete' => true,
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$snapshot = [
    'meta' => [],
    'db' => [
        'wp_options' => [],
        'wp_postmeta' => [],
        'wp_reprint_push_forms_lab' => [],
        'wp_fixture_contract_rows' => [
            'id:7' => [
                'id' => 7,
                '__pluginOwner' => 'fixture-contract-plugin',
                'payload' => 'super-secret-contract-payload',
            ],
        ],
        'wp_reprint_push_release_state' => [
            'state_id:1' => [
                'state_id' => 1,
                'owner' => 'reprint-push',
                'payload_json' => '{"secret":"release-state-private"}',
            ],
        ],
    ],
];
reprint_push_add_fixture_plugin_owned_policy($snapshot);
$by_resource = [];
foreach ($snapshot['meta']['pluginOwnedResources']['allowedResources'] as $entry) {
    $by_resource[$entry['resourceKey']] = $entry;
}
echo json_encode([
    'custom' => $by_resource['row:["wp_fixture_contract_rows","id:7"]'] ?? null,
    'releaseState' => $by_resource['row:["wp_reprint_push_release_state","state_id:1"]'] ?? null,
    'entryCount' => count($snapshot['meta']['pluginOwnedResources']['allowedResources']),
]);
`);

  assert.match(report.custom.contractHash, bareSha256Pattern);
  assert.match(report.releaseState.contractHash, bareSha256Pattern);
  const { contractHash: customContractHash, ...customContract } = report.custom;
  const { contractHash: releaseStateContractHash, ...releaseStateContract } = report.releaseState;
  assert.equal(customContractHash.length, 64);
  assert.equal(releaseStateContractHash.length, 64);
  assert.deepEqual(customContract, {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: 'row:["wp_fixture_contract_rows","id:7"]',
    pluginOwner: 'fixture-contract-plugin',
    driver: 'fixture-contract-driver',
    table: 'wp_fixture_contract_rows',
    supportsDelete: true,
  });
  assert.deepEqual(releaseStateContract, {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: 'row:["wp_reprint_push_release_state","state_id:1"]',
    pluginOwner: 'reprint-push',
    driver: 'reprint-push-release-state',
    table: 'wp_reprint_push_release_state',
    supportsDelete: false,
  });
  assert.equal(report.entryCount, 2);
  assert.equal(JSON.stringify(report).includes('super-secret-contract-payload'), false);
  assert.equal(JSON.stringify(report).includes('release-state-private'), false);
});

test('registered plugin-owned row driver PHP validation requires contract-bound evidence', () => {
  const report = runPhpDriverProbe(`
function rpp_contract_bound_policy(
    string $resource_key,
    string $table,
    string $owner,
    string $driver,
    bool $supports_delete,
    string $action,
    $value
): array {
    $contract_hash = reprint_push_plugin_owned_row_driver_contract_hash(
        $resource_key,
        $owner,
        $driver,
        $table,
        $supports_delete
    );
    $contract = [
        'schemaVersion' => 1,
        'operation' => 'plugin-driver-contract-validation',
        'contractKind' => 'plugin-owned-row-driver',
        'contractVersion' => 1,
        'outcome' => 'accepted',
        'reasonCode' => 'PLUGIN_DRIVER_CONTRACT_ACCEPTED',
        'issueCodes' => [],
        'issues' => [],
        'source' => 'plugin-driver-registration-api-test',
        'evidenceScope' => 'local-focused',
        'rawValuesIncluded' => false,
        'resourceKey' => $resource_key,
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
        'contractHash' => $contract_hash,
    ];
    return [
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
        'contractValidationEvidence' => $contract,
        'driverPayloadValidationEvidence' => [
            'schemaVersion' => 1,
            'operation' => 'plugin-driver-payload-validation',
            'validator' => 'contract-bound-row-driver',
            'reasonCode' => 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED',
            'outcome' => 'accepted',
            'issueCodes' => [],
            'issues' => [],
            'format' => 'hash-only',
            'rawValuesIncluded' => false,
            'resourceKey' => $resource_key,
            'pluginOwner' => $owner,
            'driver' => $driver,
            'table' => $table,
            'action' => $action,
            'supportsDelete' => $supports_delete,
            'contractSupportsDelete' => $supports_delete,
            'contractHash' => $contract_hash,
            'rowIdentity' => reprint_push_plugin_driver_payload_row_identity_evidence(
                $resource_key,
                $action,
                [
                    'exists' => $action !== 'delete',
                    'value' => $value,
                ]
            ),
            'value' => [
                'state' => $action === 'delete' ? 'absent' : 'present',
                'hash' => $action === 'delete'
                    ? hash('sha256', '"__REPRINT_PUSH_ABSENT__"')
                    : hash('sha256', reprint_push_stable_json($value)),
            ],
            'contractValidationHash' => hash('sha256', reprint_push_stable_json($contract)),
        ],
    ];
}
reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-contract-bound-driver',
    'table' => 'wp_fixture_contract_bound_rows',
    'pluginOwner' => 'fixture-contract-bound-plugin',
    'supportsDelete' => true,
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$resource_key = 'row:["wp_fixture_contract_bound_rows","id:7"]';
$value = [
    'id' => 7,
    'payload' => 'contract-bound-private-payload',
    '__pluginOwner' => 'fixture-contract-bound-plugin',
];
$snapshot = [
    'db' => [
        'wp_fixture_contract_bound_rows' => [
            'id:7' => [
                'id' => 7,
                '__pluginOwner' => 'fixture-contract-bound-plugin',
            ],
        ],
    ],
];
$base_mutation = [
    'id' => 'mutation-contract-bound',
    'resourceKey' => $resource_key,
    'resource' => ['type' => 'row', 'table' => 'wp_fixture_contract_bound_rows', 'id' => 'id:7'],
    'action' => 'put',
    'value' => ['value' => $value],
    'pluginOwnedResource' => rpp_contract_bound_policy(
        $resource_key,
        'wp_fixture_contract_bound_rows',
        'fixture-contract-bound-plugin',
        'fixture-contract-bound-driver',
        true,
        'put',
        $value
    ),
];
$missing_contract = $base_mutation;
unset($missing_contract['pluginOwnedResource']['contractValidationEvidence']);
$refused_contract = $base_mutation;
$refused_contract['pluginOwnedResource']['contractValidationEvidence']['outcome'] = 'refused-before-mutation';
$refused_contract['pluginOwnedResource']['contractValidationEvidence']['reasonCode'] = 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION';
$forged_payload = $base_mutation;
$forged_payload['pluginOwnedResource']['driverPayloadValidationEvidence']['value']['hash'] = str_repeat('0', 64);
$surplus_contract_evidence = $base_mutation;
$surplus_contract_evidence['pluginOwnedResource']['contractValidationEvidence']['unexpectedRawPayload'] = 'contract-bound-private-payload';
$surplus_payload_evidence = $base_mutation;
$surplus_payload_evidence['pluginOwnedResource']['driverPayloadValidationEvidence']['unexpectedRawPayload'] = 'contract-bound-private-payload';
$surplus_nested_payload_evidence = $base_mutation;
$surplus_nested_payload_evidence['pluginOwnedResource']['driverPayloadValidationEvidence']['value']['unexpectedRawPayload'] = 'contract-bound-private-payload';
$missing_owner_marker = $base_mutation;
unset($missing_owner_marker['value']['value']['__pluginOwner']);
$missing_owner_marker['pluginOwnedResource']['driverPayloadValidationEvidence']['value']['hash'] = hash(
    'sha256',
    reprint_push_stable_json($missing_owner_marker['value']['value'])
);
$ownerless_snapshot = $snapshot;
unset($ownerless_snapshot['db']['wp_fixture_contract_bound_rows']['id:7']['__pluginOwner']);
$forged_resource_key = $base_mutation;
$forged_resource_key['resourceKey'] = 'row:["wp_fixture_contract_bound_rows","id:8"]';
$forged_resource_key['pluginOwnedResource'] = rpp_contract_bound_policy(
    'row:["wp_fixture_contract_bound_rows","id:8"]',
    'wp_fixture_contract_bound_rows',
    'fixture-contract-bound-plugin',
    'fixture-contract-bound-driver',
    true,
    'put',
    $value
);

echo json_encode([
    'accepted' => rpp_driver_api_capture(static function () use ($base_mutation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($base_mutation, $snapshot);
        return true;
    }),
    'missingContract' => rpp_driver_api_capture(static function () use ($missing_contract, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($missing_contract, $snapshot);
        return true;
    }),
    'refusedContract' => rpp_driver_api_capture(static function () use ($refused_contract, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($refused_contract, $snapshot);
        return true;
    }),
    'forgedPayload' => rpp_driver_api_capture(static function () use ($forged_payload, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($forged_payload, $snapshot);
        return true;
    }),
    'surplusContractEvidence' => rpp_driver_api_capture(static function () use ($surplus_contract_evidence, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_contract_evidence, $snapshot);
        return true;
    }),
    'surplusPayloadEvidence' => rpp_driver_api_capture(static function () use ($surplus_payload_evidence, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_payload_evidence, $snapshot);
        return true;
    }),
    'surplusNestedPayloadEvidence' => rpp_driver_api_capture(static function () use ($surplus_nested_payload_evidence, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_nested_payload_evidence, $snapshot);
        return true;
    }),
    'missingOwnerMarker' => rpp_driver_api_capture(static function () use ($missing_owner_marker, $ownerless_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($missing_owner_marker, $ownerless_snapshot);
        return true;
    }),
    'forgedResourceKey' => rpp_driver_api_capture(static function () use ($forged_resource_key, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($forged_resource_key, $snapshot);
        return true;
    }),
]);
`);

  assert.deepEqual(report.accepted, { ok: true, value: true });
  assert.equal(report.missingContract.ok, false);
  assert.equal(report.missingContract.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.refusedContract.ok, false);
  assert.equal(report.refusedContract.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.forgedPayload.ok, false);
  assert.equal(report.forgedPayload.error.message, 'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.surplusContractEvidence.ok, false);
  assert.equal(report.surplusContractEvidence.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.surplusPayloadEvidence.ok, false);
  assert.equal(report.surplusPayloadEvidence.error.message, 'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.surplusNestedPayloadEvidence.ok, false);
  assert.equal(report.surplusNestedPayloadEvidence.error.message, 'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.missingOwnerMarker.ok, false);
  assert.equal(report.missingOwnerMarker.error.message, 'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.forgedResourceKey.ok, false);
  assert.equal(report.forgedResourceKey.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:8"]');
  assert.equal(JSON.stringify(report).includes('contract-bound-private-payload'), false);
});
