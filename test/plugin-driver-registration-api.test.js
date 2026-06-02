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

function digest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
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
$results['unsupportedReferenceTarget'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-driver-api-unsupported-reference-target',
        'table' => 'wp_fixture_driver_api_unsupported_reference_target',
        'pluginOwner' => 'fixture-plugin',
        'referenceFields' => [
            'fields' => [
                [
                    'path' => 'payload.private_id',
                    'targetTable' => 'wp_plugin_private_rows',
                    'targetIdField' => 'private_id',
                ],
            ],
        ],
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
    ]);
});
$results['unsupportedReferenceTargetId'] = rpp_driver_api_capture(static function (): array {
    return reprint_push_register_plugin_owned_row_driver([
        'driver' => 'fixture-driver-api-unsupported-reference-target-id',
        'table' => 'wp_fixture_driver_api_unsupported_reference_target_id',
        'pluginOwner' => 'fixture-plugin',
        'referenceFields' => [
            'fields' => [
                [
                    'path' => 'payload.post_id',
                    'targetTable' => 'wp_posts',
                    'targetIdField' => 'post_id',
                ],
            ],
        ],
        'exportRowsCallback' => 'rpp_driver_api_export_rows',
        'applyRowCallback' => 'rpp_driver_api_apply_row',
        'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
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
  assert.equal(report.unsupportedReferenceTarget.ok, false);
  assert.equal(report.unsupportedReferenceTarget.error.message, 'Unsupported plugin-owned row driver reference target.');
  assert.equal(report.unsupportedReferenceTargetId.ok, false);
  assert.equal(report.unsupportedReferenceTargetId.error.message, 'Unsupported plugin-owned row driver reference target.');
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
    'mergePolicy' => [
        'strategy' => 'refuse-on-conflict',
        'rawValuesIncluded' => false,
    ],
    'referenceFields' => [
        'rawValuesIncluded' => false,
        'fields' => [
            [
                'path' => 'payload.post_id',
                'targetTable' => 'wp_posts',
                'targetIdField' => 'ID',
                'required' => true,
            ],
        ],
    ],
    'rowSchema' => [
        'required' => ['id', 'payload', '__pluginOwner'],
        'fields' => [
            'id' => 'integer',
	        'payload' => [
	            'type' => 'object',
	            'required' => ['mode', 'priority', 'version'],
	            'additionalProperties' => false,
	            'properties' => [
	                'mode' => [
	                    'type' => 'string',
	                    'enum' => ['schema-bound-private-mode', 'schema-bound-private-alt-mode'],
	                ],
	                'priority' => [
	                    'type' => 'integer',
	                    'minimum' => 1,
	                    'maximum' => 5,
	                ],
	                'version' => [
	                    'type' => 'integer',
	                    'const' => 1,
	                ],
	            ],
	        ],
	        '__pluginOwner' => 'string',
        ],
    ],
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
    mergePolicy: {
      schemaVersion: 1,
      strategy: 'refuse-on-conflict',
      conflictResolution: 'preserve-remote-and-stop',
      rawValuesIncluded: false,
    },
    rowSchema: {
      schemaVersion: 1,
      fields: [
        { field: '__pluginOwner', type: 'string', required: true },
        { field: 'id', type: 'integer', required: true },
        {
          field: 'payload',
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: [
            {
              field: 'mode',
              type: 'string',
              required: true,
              enumHashes: [
                digest('schema-bound-private-alt-mode'),
                digest('schema-bound-private-mode'),
              ].sort(),
            },
            {
              field: 'priority',
              type: 'integer',
              required: true,
              minimum: 1,
              maximum: 5,
            },
            {
              field: 'version',
              type: 'integer',
              required: true,
              constHash: digest(1),
            },
          ],
        },
      ],
    },
    referenceFields: {
      schemaVersion: 1,
      fields: [
        {
          path: 'payload.post_id',
          targetTable: 'wp_posts',
          targetIdField: 'ID',
          scalarType: 'positive-integer',
          required: true,
        },
      ],
      rawValuesIncluded: false,
    },
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
$unbound_reference_target_evidence = $base_mutation;
$unbound_reference_target_evidence['pluginOwnedResource']['referenceTargetValidationEvidence'] = [
    'rawValuesIncluded' => false,
    'unexpectedRawPayload' => 'contract-bound-private-payload',
];
$missing_owner_marker = $base_mutation;
unset($missing_owner_marker['value']['value']['__pluginOwner']);
$missing_owner_marker['pluginOwnedResource']['driverPayloadValidationEvidence']['value']['hash'] = hash(
    'sha256',
    reprint_push_stable_json($missing_owner_marker['value']['value'])
);
$ownerless_snapshot = $snapshot;
unset($ownerless_snapshot['db']['wp_fixture_contract_bound_rows']['id:7']['__pluginOwner']);
$stripped_registered_table = $missing_owner_marker;
unset($stripped_registered_table['pluginOwnedResource']);
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
    'unboundReferenceTargetEvidence' => rpp_driver_api_capture(static function () use ($unbound_reference_target_evidence, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($unbound_reference_target_evidence, $snapshot);
        return true;
    }),
    'missingOwnerMarker' => rpp_driver_api_capture(static function () use ($missing_owner_marker, $ownerless_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($missing_owner_marker, $ownerless_snapshot);
        return true;
    }),
    'strippedRegisteredTable' => rpp_driver_api_capture(static function () use ($stripped_registered_table, $ownerless_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($stripped_registered_table, $ownerless_snapshot);
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
  assert.equal(report.unboundReferenceTargetEvidence.ok, false);
  assert.equal(report.unboundReferenceTargetEvidence.error.message, 'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.missingOwnerMarker.ok, false);
  assert.equal(report.missingOwnerMarker.error.message, 'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.strippedRegisteredTable.ok, false);
  assert.equal(report.strippedRegisteredTable.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:7"]');
  assert.equal(report.forgedResourceKey.ok, false);
  assert.equal(report.forgedResourceKey.error.message, 'Unsupported plugin-owned mutation contract for row:["wp_fixture_contract_bound_rows","id:8"]');
  assert.equal(JSON.stringify(report).includes('contract-bound-private-payload'), false);
});

test('registered plugin-owned row driver PHP validation accepts schema-bound evidence only when schema matches', () => {
  const report = runPhpDriverProbe(`
function rpp_schema_bound_policy(
    string $resource_key,
    string $table,
    string $owner,
    string $driver,
    bool $supports_delete,
    string $action,
    $value,
    array $row_schema
): array {
    $normalized_schema = reprint_push_normalize_plugin_owned_row_driver_row_schema($row_schema);
    $contract_hash = reprint_push_plugin_owned_row_driver_contract_hash(
        $resource_key,
        $owner,
        $driver,
        $table,
        $supports_delete,
        $normalized_schema
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
        'source' => 'plugin-driver-registration-api-schema-test',
        'evidenceScope' => 'local-focused',
        'rawValuesIncluded' => false,
        'resourceKey' => $resource_key,
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
        'rowSchema' => $normalized_schema,
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
                ['exists' => $action !== 'delete', 'value' => $value]
            ),
            'schemaValidation' => reprint_push_plugin_driver_payload_row_schema_evidence(
                $normalized_schema,
                $action,
                ['exists' => $action !== 'delete', 'value' => $value]
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
    'driver' => 'fixture-schema-bound-driver',
    'table' => 'wp_fixture_schema_bound_rows',
    'pluginOwner' => 'fixture-schema-bound-plugin',
    'supportsDelete' => false,
    'rowSchema' => [
        'required' => ['id', 'payload', '__pluginOwner'],
        'fields' => [
            'id' => 'integer',
            'payload' => 'string',
            '__pluginOwner' => 'string',
        ],
    ],
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$resource_key = 'row:["wp_fixture_schema_bound_rows","id:7"]';
$row_schema = [
    'additionalProperties' => false,
    'required' => ['id', 'payload', '__pluginOwner'],
    'fields' => [
        'id' => 'integer',
        'payload' => [
            'type' => 'object',
            'required' => ['mode', 'priority', 'version'],
            'additionalProperties' => false,
            'properties' => [
                'mode' => [
                    'type' => 'string',
                    'enum' => ['schema-bound-private-mode', 'schema-bound-private-alt-mode'],
                ],
                'priority' => [
                    'type' => 'integer',
                    'minimum' => 1,
                    'maximum' => 5,
                ],
                'version' => [
                    'type' => 'integer',
                    'const' => 1,
                ],
            ],
        ],
        '__pluginOwner' => 'string',
    ],
];
$value = [
    'id' => 7,
    'payload' => [
        'mode' => 'schema-bound-private-mode',
        'priority' => 3,
        'version' => 1,
    ],
    '__pluginOwner' => 'fixture-schema-bound-plugin',
];
$snapshot = [
    'db' => [
        'wp_fixture_schema_bound_rows' => [
            'id:7' => [
                'id' => 7,
                '__pluginOwner' => 'fixture-schema-bound-plugin',
            ],
        ],
    ],
];
$base_mutation = [
    'id' => 'mutation-schema-bound',
    'resourceKey' => $resource_key,
    'resource' => ['type' => 'row', 'table' => 'wp_fixture_schema_bound_rows', 'id' => 'id:7'],
    'action' => 'put',
    'value' => ['value' => $value],
    'pluginOwnedResource' => rpp_schema_bound_policy(
        $resource_key,
        'wp_fixture_schema_bound_rows',
        'fixture-schema-bound-plugin',
        'fixture-schema-bound-driver',
        false,
        'put',
        $value,
        $row_schema
    ),
];
$forged_schema_payload = $base_mutation;
$forged_schema_payload['value']['value']['payload']['private_note'] = 'schema-bound-private-payload';
	$forged_schema_payload['pluginOwnedResource'] = rpp_schema_bound_policy(
	    $resource_key,
    'wp_fixture_schema_bound_rows',
    'fixture-schema-bound-plugin',
	    'fixture-schema-bound-driver',
	    false,
	    'put',
	    $forged_schema_payload['value']['value'],
	    $row_schema
	);
	$forged_constraint_payload = $base_mutation;
	$forged_constraint_payload['value']['value']['payload']['mode'] = 'schema-bound-private-forged-mode';
	$forged_constraint_payload['pluginOwnedResource'] = rpp_schema_bound_policy(
	    $resource_key,
	    'wp_fixture_schema_bound_rows',
	    'fixture-schema-bound-plugin',
	    'fixture-schema-bound-driver',
	    false,
	    'put',
	    $forged_constraint_payload['value']['value'],
	    $row_schema
	);
	$forged_range_payload = $base_mutation;
	$forged_range_payload['value']['value']['payload']['priority'] = 9;
	$forged_range_payload['pluginOwnedResource'] = rpp_schema_bound_policy(
	    $resource_key,
	    'wp_fixture_schema_bound_rows',
	    'fixture-schema-bound-plugin',
	    'fixture-schema-bound-driver',
	    false,
	    'put',
	    $forged_range_payload['value']['value'],
	    $row_schema
	);
	$forged_root_payload = $base_mutation;
	$forged_root_payload['value']['value']['private_note'] = 'schema-bound-root-private-payload';
	$forged_root_payload['pluginOwnedResource'] = rpp_schema_bound_policy(
	    $resource_key,
	    'wp_fixture_schema_bound_rows',
	    'fixture-schema-bound-plugin',
	    'fixture-schema-bound-driver',
	    false,
	    'put',
	    $forged_root_payload['value']['value'],
	    $row_schema
	);

	echo json_encode([
	    'accepted' => rpp_driver_api_capture(static function () use ($base_mutation, $snapshot): bool {
	        reprint_push_assert_supported_plugin_owned_mutation($base_mutation, $snapshot);
	        return true;
    }),
	    'forgedSchemaPayload' => rpp_driver_api_capture(static function () use ($forged_schema_payload, $snapshot): bool {
	        reprint_push_assert_supported_plugin_owned_mutation($forged_schema_payload, $snapshot);
	        return true;
	    }),
	    'forgedConstraintPayload' => rpp_driver_api_capture(static function () use ($forged_constraint_payload, $snapshot): bool {
	        reprint_push_assert_supported_plugin_owned_mutation($forged_constraint_payload, $snapshot);
	        return true;
	    }),
	    'forgedRangePayload' => rpp_driver_api_capture(static function () use ($forged_range_payload, $snapshot): bool {
	        reprint_push_assert_supported_plugin_owned_mutation($forged_range_payload, $snapshot);
	        return true;
	    }),
	    'forgedRootPayload' => rpp_driver_api_capture(static function () use ($forged_root_payload, $snapshot): bool {
	        reprint_push_assert_supported_plugin_owned_mutation($forged_root_payload, $snapshot);
	        return true;
	    }),
	    'schemaValidation' => $forged_schema_payload['pluginOwnedResource']['driverPayloadValidationEvidence']['schemaValidation'],
	    'constraintValidation' => $forged_constraint_payload['pluginOwnedResource']['driverPayloadValidationEvidence']['schemaValidation'],
	    'rangeValidation' => $forged_range_payload['pluginOwnedResource']['driverPayloadValidationEvidence']['schemaValidation'],
	    'rootSchemaValidation' => $forged_root_payload['pluginOwnedResource']['driverPayloadValidationEvidence']['schemaValidation'],
	    'normalizedSchema' => $base_mutation['pluginOwnedResource']['contractValidationEvidence']['rowSchema'],
	]);
`);

  assert.deepEqual(report.accepted, { ok: true, value: true });
	  assert.equal(report.forgedSchemaPayload.ok, false);
	  assert.equal(report.forgedConstraintPayload.ok, false);
	  assert.equal(report.forgedRangePayload.ok, false);
	  assert.equal(report.forgedRootPayload.ok, false);
  assert.equal(
    report.forgedSchemaPayload.error.message,
    'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_schema_bound_rows","id:7"]',
  );
  assert.equal(report.schemaValidation.status, 'mismatch');
  assert.deepEqual(
    report.schemaValidation.fields.find((field) => field.path === 'payload' && field.state === 'unexpected'),
    {
      field: 'payload',
      path: 'payload',
      expectedType: 'object',
      required: true,
      state: 'unexpected',
      observedType: 'object',
      observedExtraPropertyCount: 1,
      matched: false,
    },
  );
  assert.equal(JSON.stringify(report.schemaValidation).includes('private_note'), false);
  assert.equal(report.normalizedSchema.additionalProperties, false);
  assert.deepEqual(
    report.rootSchemaValidation.fields.find((field) => field.field === 'row' && field.state === 'unexpected'),
    {
      field: 'row',
      expectedType: 'object',
      required: true,
      state: 'unexpected',
      observedType: 'object',
      observedExtraPropertyCount: 1,
      matched: false,
    },
  );
  assert.equal(JSON.stringify(report.rootSchemaValidation).includes('private_note'), false);
	  assert.deepEqual(
	    report.normalizedSchema.fields.find((field) => field.field === 'payload'),
	    {
	      field: 'payload',
	      type: 'object',
	      required: true,
	      additionalProperties: false,
	      properties: [
	        {
	          field: 'mode',
	          type: 'string',
	          required: true,
	          enumHashes: [
	            digest('schema-bound-private-alt-mode'),
	            digest('schema-bound-private-mode'),
	          ].sort(),
	        },
	        {
	          field: 'priority',
	          type: 'integer',
	          required: true,
	          minimum: 1,
	          maximum: 5,
	        },
	        {
	          field: 'version',
	          type: 'integer',
	          required: true,
	          constHash: digest(1),
	        },
	      ],
	    },
	  );
	  assert.deepEqual(
	    report.constraintValidation.fields.find((field) => field.path === 'payload.mode'),
	    {
	      field: 'mode',
	      path: 'payload.mode',
	      expectedType: 'string',
	      required: true,
	      state: 'constraint-mismatch',
	      observedType: 'string',
	      constraint: 'enum',
	      constraintHash: digest([
	        digest('schema-bound-private-alt-mode'),
	        digest('schema-bound-private-mode'),
	      ].sort()),
	      observedHash: digest('schema-bound-private-forged-mode'),
	      matched: false,
	    },
	  );
	  assert.deepEqual(
	    report.rangeValidation.fields.find((field) => field.path === 'payload.priority'),
	    {
	      field: 'priority',
	      path: 'payload.priority',
	      expectedType: 'integer',
	      required: true,
	      state: 'constraint-mismatch',
	      observedType: 'integer',
	      constraint: 'range',
	      constraintHash: digest({ minimum: 1, maximum: 5 }),
	      observedHash: digest(9),
	      matched: false,
	    },
	  );
	  assert.equal(JSON.stringify(report).includes('schema-bound-private-mode'), false);
	  assert.equal(JSON.stringify(report).includes('schema-bound-private-alt-mode'), false);
	  assert.equal(JSON.stringify(report).includes('schema-bound-private-forged-mode'), false);
	  assert.equal(JSON.stringify(report).includes('schema-bound-private-payload'), false);
	  assert.equal(JSON.stringify(report).includes('schema-bound-root-private-payload'), false);
	});

test('registered plugin-owned row driver PHP validation accepts reference-bound evidence only when references match', () => {
  const report = runPhpDriverProbe(`
function rpp_reference_bound_policy(
    string $resource_key,
    string $table,
    string $owner,
    string $driver,
    bool $supports_delete,
    string $action,
    $value,
    array $reference_fields,
    array $snapshot
): array {
    $normalized_references = reprint_push_normalize_plugin_owned_row_driver_reference_fields($reference_fields);
    $contract_hash = reprint_push_plugin_owned_row_driver_contract_hash(
        $resource_key,
        $owner,
        $driver,
        $table,
        $supports_delete,
        null,
        null,
        $normalized_references
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
        'source' => 'plugin-driver-registration-api-reference-test',
        'evidenceScope' => 'local-focused',
        'rawValuesIncluded' => false,
        'resourceKey' => $resource_key,
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
        'referenceFields' => $normalized_references,
        'contractHash' => $contract_hash,
    ];
    $payload_evidence = [
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
            ['exists' => $action !== 'delete', 'value' => $value]
        ),
        'referenceValidation' => reprint_push_plugin_driver_payload_reference_fields_evidence(
            $normalized_references,
            $action,
            ['exists' => $action !== 'delete', 'value' => $value]
        ),
        'value' => [
            'state' => $action === 'delete' ? 'absent' : 'present',
            'hash' => $action === 'delete'
                ? hash('sha256', '"__REPRINT_PUSH_ABSENT__"')
                : hash('sha256', reprint_push_stable_json($value)),
        ],
        'contractValidationHash' => hash('sha256', reprint_push_stable_json($contract)),
    ];
    return [
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
        'contractValidationEvidence' => $contract,
        'driverPayloadValidationEvidence' => $payload_evidence,
        'referenceTargetValidationEvidence' => rpp_reference_target_evidence(
            $resource_key,
            $table,
            $owner,
            $driver,
            $contract,
            $payload_evidence,
            $snapshot
        ),
    ];
}
function rpp_reference_target_evidence(
    string $resource_key,
    string $table,
    string $owner,
    string $driver,
    array $contract,
    array $payload_evidence,
    array $snapshot
): array {
    $reference_validation = $payload_evidence['referenceValidation'];
    $fields = [];
    foreach ($reference_validation['fields'] as $field) {
        $target_resource_key = $field['targetResourceKey'] ?? null;
        $target_field = [
            'path' => $field['path'] ?? null,
            'targetTable' => $field['targetTable'] ?? null,
            'targetIdField' => $field['targetIdField'] ?? null,
            'scalarType' => $field['scalarType'] ?? null,
            'required' => $field['required'] ?? null,
            'state' => $field['state'] ?? null,
            'observedType' => $field['observedType'] ?? null,
            'observedHash' => $field['observedHash'] ?? null,
            'targetResourceKey' => $target_resource_key,
        ];
        if ($target_resource_key === null) {
            $fields[] = array_merge($target_field, [
                'targetStable' => ($field['required'] ?? null) !== true && ($field['state'] ?? null) === 'missing',
                'reasonCode' => 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_NOT_REQUIRED',
            ]);
            continue;
        }
        [$target_table, $target_id] = reprint_push_parse_wordpress_graph_row_resource_key($target_resource_key);
        $target_resource = [
            'type' => 'row',
            'table' => $target_table,
            'id' => $target_id,
        ];
        $target_current = reprint_push_get_resource($snapshot, $target_resource);
        $target_hash = reprint_push_hash_resource($snapshot, $target_resource);
        $target_present = ($target_current['exists'] ?? false) === true;
        $target_id_field = $field['targetIdField'] ?? null;
        $target_primary_id = null;
        if (is_string($target_id_field)
            && preg_match('/^' . preg_quote($target_id_field, '/') . ':([1-9][0-9]*)$/', $target_id, $matches)) {
            $target_primary_id = (int) $matches[1];
        }
        $target_value = $target_current['value'] ?? null;
        $observed_exists = is_array($target_value)
            && !array_is_list($target_value)
            && is_string($target_id_field)
            && array_key_exists($target_id_field, $target_value);
        $observed = $observed_exists ? $target_value[$target_id_field] : null;
        $observed_primary_id = $observed_exists
            ? reprint_push_normalize_plugin_driver_reference_positive_integer($observed)
            : null;
        $target_primary_row = [
            'targetIdField' => is_string($target_id_field) ? $target_id_field : null,
            'expectedHash' => $target_primary_id === null
                ? null
                : hash('sha256', reprint_push_stable_json((string) $target_primary_id)),
            'observedType' => $observed_exists
                ? reprint_push_plugin_driver_payload_row_schema_value_type($observed)
                : null,
            'observedHash' => $observed_exists
                ? hash('sha256', reprint_push_stable_json((string) $observed))
                : null,
            'matched' => $target_primary_id !== null && $observed_primary_id === $target_primary_id,
        ];
        $target_stable = $target_present && $target_primary_row['matched'];
        $fields[] = array_merge($target_field, [
            'targetResource' => [
                'type' => 'row',
                'key' => $target_resource_key,
                'table' => $target_table,
                'id' => $target_id,
            ],
            'targetPrimaryRow' => $target_primary_row,
            'targetBaseHash' => $target_hash,
            'targetLocalHash' => $target_hash,
            'targetRemoteHash' => $target_hash,
            'targetRemotePresent' => $target_present,
            'targetStable' => $target_stable,
            'reasonCode' => $target_stable
                ? 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_ACCEPTED'
                : ($target_present
                    ? 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_ROW_ID_MISMATCH'
                    : 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_ABSENT'),
            'targetChange' => [
                'localChange' => 'unchanged',
                'remoteChange' => 'unchanged',
                'base' => ['state' => $target_present ? 'present' : 'absent', 'hash' => $target_hash],
                'local' => ['state' => $target_present ? 'present' : 'absent', 'hash' => $target_hash],
                'remote' => ['state' => $target_present ? 'present' : 'absent', 'hash' => $target_hash],
            ],
        ]);
    }
    $failed_fields = array_filter($fields, static function (array $field): bool {
        return ($field['targetStable'] ?? false) !== true;
    });
    $accepted = count($failed_fields) === 0;
    $first_failed_field = $accepted ? null : array_values($failed_fields)[0];
    return [
        'schemaVersion' => 1,
        'operation' => 'plugin-driver-reference-target-validation',
        'validator' => 'contract-bound-row-driver-reference-targets',
        'reasonCode' => $accepted
            ? 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED'
            : ($first_failed_field['reasonCode'] ?? 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_UNPROVEN'),
        'outcome' => $accepted ? 'accepted' : 'refused-before-mutation',
        'format' => 'hash-only',
        'rawValuesIncluded' => false,
        'resourceKey' => $resource_key,
        'pluginOwner' => $owner,
        'driver' => $driver,
        'table' => $table,
        'contractHash' => $contract['contractHash'],
        'contractValidationHash' => hash('sha256', reprint_push_stable_json($contract)),
        'payloadValidationHash' => hash('sha256', reprint_push_stable_json($payload_evidence)),
        'referenceValidationHash' => hash('sha256', reprint_push_stable_json($reference_validation)),
        'referenceFieldCount' => count($fields),
        'fields' => $fields,
    ];
}
reprint_push_register_plugin_owned_row_driver([
    'driver' => 'fixture-reference-bound-driver',
    'table' => 'wp_fixture_reference_bound_rows',
    'pluginOwner' => 'fixture-reference-bound-plugin',
    'supportsDelete' => false,
    'referenceFields' => [
        'fields' => [
            [
                'path' => 'payload.post_id',
                'targetTable' => 'wp_posts',
                'targetIdField' => 'ID',
                'required' => true,
            ],
        ],
    ],
    'exportRowsCallback' => 'rpp_driver_api_export_rows',
    'applyRowCallback' => 'rpp_driver_api_apply_row',
    'validateMutationCallback' => 'rpp_driver_api_validate_mutation',
]);
$resource_key = 'row:["wp_fixture_reference_bound_rows","id:7"]';
$reference_fields = [
    'fields' => [
        [
            'path' => 'payload.post_id',
            'targetTable' => 'wp_posts',
            'targetIdField' => 'ID',
            'required' => true,
        ],
    ],
];
$optional_reference_fields = [
    'fields' => [
        [
            'path' => 'payload.post_id',
            'targetTable' => 'wp_posts',
            'targetIdField' => 'ID',
            'required' => false,
        ],
    ],
];
$value = [
    'id' => 7,
    'payload' => [
        'post_id' => 2,
        'secret' => 'reference-bound-private-payload',
    ],
    '__pluginOwner' => 'fixture-reference-bound-plugin',
];
$optional_value = [
    'id' => 7,
    'payload' => [
        'secret' => 'optional-reference-bound-private-payload',
    ],
    '__pluginOwner' => 'fixture-reference-bound-plugin',
];
$snapshot = [
    'db' => [
        'wp_posts' => [
            'ID:2' => [
                'ID' => 2,
                'post_type' => 'post',
                'post_status' => 'publish',
                'post_title' => 'reference target',
            ],
        ],
        'wp_fixture_reference_bound_rows' => [
            'id:7' => [
                'id' => 7,
                '__pluginOwner' => 'fixture-reference-bound-plugin',
            ],
        ],
    ],
];
$base_mutation = [
    'id' => 'mutation-reference-bound',
    'resourceKey' => $resource_key,
    'resource' => ['type' => 'row', 'table' => 'wp_fixture_reference_bound_rows', 'id' => 'id:7'],
    'action' => 'put',
    'value' => ['value' => $value],
    'pluginOwnedResource' => rpp_reference_bound_policy(
        $resource_key,
        'wp_fixture_reference_bound_rows',
        'fixture-reference-bound-plugin',
        'fixture-reference-bound-driver',
        false,
        'put',
        $value,
        $reference_fields,
        $snapshot
    ),
];
$optional_missing_reference_mutation = [
    'id' => 'mutation-optional-reference-bound',
    'resourceKey' => $resource_key,
    'resource' => ['type' => 'row', 'table' => 'wp_fixture_reference_bound_rows', 'id' => 'id:7'],
    'action' => 'put',
    'value' => ['value' => $optional_value],
    'pluginOwnedResource' => rpp_reference_bound_policy(
        $resource_key,
        'wp_fixture_reference_bound_rows',
        'fixture-reference-bound-plugin',
        'fixture-reference-bound-driver',
        false,
        'put',
        $optional_value,
        $optional_reference_fields,
        $snapshot
    ),
];
$missing_reference_target_validation = $base_mutation;
unset($missing_reference_target_validation['pluginOwnedResource']['referenceTargetValidationEvidence']);
$forged_reference_target_validation = $base_mutation;
$forged_reference_target_validation['pluginOwnedResource']['referenceTargetValidationEvidence']['fields'][0]['targetRemoteHash'] = hash('sha256', reprint_push_stable_json(['forged' => true]));
$surplus_reference_target_validation = $base_mutation;
$surplus_reference_target_validation['pluginOwnedResource']['referenceTargetValidationEvidence']['unexpectedRawPayload'] = 'reference-bound-private-payload';
$surplus_reference_target_field = $base_mutation;
$surplus_reference_target_field['pluginOwnedResource']['referenceTargetValidationEvidence']['fields'][0]['unexpectedRawPayload'] = 'reference-bound-private-payload';
$surplus_reference_target_change = $base_mutation;
$surplus_reference_target_change['pluginOwnedResource']['referenceTargetValidationEvidence']['fields'][0]['targetChange']['remote']['unexpectedRawPayload'] = 'reference-bound-private-payload';
$drifted_reference_target_snapshot = $snapshot;
$drifted_reference_target_snapshot['db']['wp_posts']['ID:2']['post_title'] = 'reference target changed after dry run';
$malformed_reference_target_snapshot = $snapshot;
$malformed_reference_target_snapshot['db']['wp_posts']['ID:2']['ID'] = 999;
$malformed_reference_target_validation = $base_mutation;
$malformed_reference_target_validation['pluginOwnedResource'] = rpp_reference_bound_policy(
    $resource_key,
    'wp_fixture_reference_bound_rows',
    'fixture-reference-bound-plugin',
    'fixture-reference-bound-driver',
    false,
    'put',
    $value,
    $reference_fields,
    $malformed_reference_target_snapshot
);
$missing_reference_validation = $base_mutation;
unset($missing_reference_validation['pluginOwnedResource']['driverPayloadValidationEvidence']['referenceValidation']);
$forged_reference_validation = $base_mutation;
$forged_reference_validation['pluginOwnedResource']['driverPayloadValidationEvidence']['referenceValidation']['fields'][0]['targetResourceKey'] = 'row:["wp_posts","ID:3"]';
$forged_reference_value = $base_mutation;
$forged_reference_value['value']['value']['payload']['post_id'] = 0;
$forged_reference_value['pluginOwnedResource'] = rpp_reference_bound_policy(
    $resource_key,
    'wp_fixture_reference_bound_rows',
    'fixture-reference-bound-plugin',
    'fixture-reference-bound-driver',
    false,
    'put',
    $forged_reference_value['value']['value'],
    $reference_fields,
    $snapshot
);

echo json_encode([
    'accepted' => rpp_driver_api_capture(static function () use ($base_mutation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($base_mutation, $snapshot);
        return true;
    }),
    'acceptedOptionalMissingReference' => rpp_driver_api_capture(static function () use ($optional_missing_reference_mutation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($optional_missing_reference_mutation, $snapshot);
        return true;
    }),
    'missingReferenceTargetValidation' => rpp_driver_api_capture(static function () use ($missing_reference_target_validation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($missing_reference_target_validation, $snapshot);
        return true;
    }),
    'forgedReferenceTargetValidation' => rpp_driver_api_capture(static function () use ($forged_reference_target_validation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($forged_reference_target_validation, $snapshot);
        return true;
    }),
    'surplusReferenceTargetValidation' => rpp_driver_api_capture(static function () use ($surplus_reference_target_validation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_reference_target_validation, $snapshot);
        return true;
    }),
    'surplusReferenceTargetField' => rpp_driver_api_capture(static function () use ($surplus_reference_target_field, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_reference_target_field, $snapshot);
        return true;
    }),
    'surplusReferenceTargetChange' => rpp_driver_api_capture(static function () use ($surplus_reference_target_change, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($surplus_reference_target_change, $snapshot);
        return true;
    }),
    'driftedReferenceTargetValidation' => rpp_driver_api_capture(static function () use ($base_mutation, $drifted_reference_target_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($base_mutation, $drifted_reference_target_snapshot);
        return true;
    }),
    'malformedReferenceTargetValidation' => rpp_driver_api_capture(static function () use ($malformed_reference_target_validation, $malformed_reference_target_snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($malformed_reference_target_validation, $malformed_reference_target_snapshot);
        return true;
    }),
    'missingReferenceValidation' => rpp_driver_api_capture(static function () use ($missing_reference_validation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($missing_reference_validation, $snapshot);
        return true;
    }),
    'forgedReferenceValidation' => rpp_driver_api_capture(static function () use ($forged_reference_validation, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($forged_reference_validation, $snapshot);
        return true;
    }),
    'forgedReferenceValue' => rpp_driver_api_capture(static function () use ($forged_reference_value, $snapshot): bool {
        reprint_push_assert_supported_plugin_owned_mutation($forged_reference_value, $snapshot);
        return true;
    }),
    'referenceValidation' => $base_mutation['pluginOwnedResource']['driverPayloadValidationEvidence']['referenceValidation'],
    'referenceTargetValidation' => $base_mutation['pluginOwnedResource']['referenceTargetValidationEvidence'],
    'malformedReferenceTargetValidationEvidence' => $malformed_reference_target_validation['pluginOwnedResource']['referenceTargetValidationEvidence'],
    'optionalReferenceValidation' => $optional_missing_reference_mutation['pluginOwnedResource']['driverPayloadValidationEvidence']['referenceValidation'],
    'optionalReferenceTargetValidation' => $optional_missing_reference_mutation['pluginOwnedResource']['referenceTargetValidationEvidence'],
    'forgedValueReferenceValidation' => $forged_reference_value['pluginOwnedResource']['driverPayloadValidationEvidence']['referenceValidation'],
    'normalizedReferences' => $base_mutation['pluginOwnedResource']['contractValidationEvidence']['referenceFields'],
    'normalizedOptionalReferences' => $optional_missing_reference_mutation['pluginOwnedResource']['contractValidationEvidence']['referenceFields'],
]);
`);

  assert.deepEqual(report.accepted, { ok: true, value: true });
  assert.deepEqual(report.acceptedOptionalMissingReference, { ok: true, value: true });
  assert.equal(report.missingReferenceTargetValidation.ok, false);
  assert.equal(report.forgedReferenceTargetValidation.ok, false);
  assert.equal(report.surplusReferenceTargetValidation.ok, false);
  assert.equal(report.surplusReferenceTargetField.ok, false);
  assert.equal(report.surplusReferenceTargetChange.ok, false);
  assert.equal(report.driftedReferenceTargetValidation.ok, false);
  assert.equal(report.malformedReferenceTargetValidation.ok, false);
  assert.equal(report.missingReferenceValidation.ok, false);
  assert.equal(report.forgedReferenceValidation.ok, false);
  assert.equal(report.forgedReferenceValue.ok, false);
  assert.equal(
    report.missingReferenceTargetValidation.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.forgedReferenceTargetValidation.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.surplusReferenceTargetValidation.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.surplusReferenceTargetField.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.surplusReferenceTargetChange.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.driftedReferenceTargetValidation.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.malformedReferenceTargetValidation.error.message,
    'Unsupported plugin-owned mutation reference target evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.missingReferenceValidation.error.message,
    'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.forgedReferenceValidation.error.message,
    'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.equal(
    report.forgedReferenceValue.error.message,
    'Unsupported plugin-owned mutation payload evidence for row:["wp_fixture_reference_bound_rows","id:7"]',
  );
  assert.deepEqual(report.normalizedReferences, {
    schemaVersion: 1,
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'positive-integer',
        required: true,
      },
    ],
    rawValuesIncluded: false,
  });
  assert.deepEqual(report.normalizedOptionalReferences, {
    schemaVersion: 1,
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'positive-integer',
        required: false,
      },
    ],
    rawValuesIncluded: false,
  });
  assert.deepEqual(report.referenceValidation.fields[0], {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: true,
    state: 'present',
    observedType: 'integer',
    observedHash: digest('2'),
    matched: true,
    targetResourceKey: 'row:["wp_posts","ID:2"]',
  });
  assert.deepEqual(report.optionalReferenceValidation.fields[0], {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: false,
    state: 'missing',
    observedType: null,
    matched: true,
  });
  assert.equal(report.referenceTargetValidation.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED');
  assert.equal(report.referenceTargetValidation.outcome, 'accepted');
  assert.equal(report.referenceTargetValidation.rawValuesIncluded, false);
  assert.equal(report.referenceTargetValidation.fields[0].path, 'payload.post_id');
  assert.equal(report.referenceTargetValidation.fields[0].targetResourceKey, 'row:["wp_posts","ID:2"]');
  assert.equal(report.referenceTargetValidation.fields[0].targetRemotePresent, true);
  assert.equal(report.referenceTargetValidation.fields[0].targetStable, true);
  assert.deepEqual(report.referenceTargetValidation.fields[0].targetPrimaryRow, {
    targetIdField: 'ID',
    expectedHash: digest('2'),
    observedType: 'integer',
    observedHash: digest('2'),
    matched: true,
  });
  assert.equal(report.referenceTargetValidation.fields[0].targetRemoteHash, digest({
    ID: 2,
    post_status: 'publish',
    post_title: 'reference target',
    post_type: 'post',
  }));
  assert.deepEqual(report.referenceTargetValidation.fields[0].targetChange, {
    localChange: 'unchanged',
    remoteChange: 'unchanged',
    base: {
      state: 'present',
      hash: digest({
        ID: 2,
        post_status: 'publish',
        post_title: 'reference target',
        post_type: 'post',
      }),
    },
    local: {
      state: 'present',
      hash: digest({
        ID: 2,
        post_status: 'publish',
        post_title: 'reference target',
        post_type: 'post',
      }),
    },
    remote: {
      state: 'present',
      hash: digest({
        ID: 2,
        post_status: 'publish',
        post_title: 'reference target',
        post_type: 'post',
      }),
    },
  });
  assert.equal(
    report.malformedReferenceTargetValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_ROW_ID_MISMATCH',
  );
  assert.equal(report.malformedReferenceTargetValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(report.malformedReferenceTargetValidationEvidence.fields[0].targetStable, false);
  assert.deepEqual(report.malformedReferenceTargetValidationEvidence.fields[0].targetPrimaryRow, {
    targetIdField: 'ID',
    expectedHash: digest('2'),
    observedType: 'integer',
    observedHash: digest('999'),
    matched: false,
  });
  assert.equal(report.optionalReferenceTargetValidation.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED');
  assert.equal(report.optionalReferenceTargetValidation.outcome, 'accepted');
  assert.equal(report.optionalReferenceTargetValidation.rawValuesIncluded, false);
  assert.deepEqual(report.optionalReferenceTargetValidation.fields[0], {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: false,
    state: 'missing',
    observedType: null,
    observedHash: null,
    targetResourceKey: null,
    targetStable: true,
    reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_NOT_REQUIRED',
  });
  assert.deepEqual(report.forgedValueReferenceValidation.fields[0], {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: true,
    state: 'invalid',
    observedType: 'integer',
    observedHash: digest('0'),
    matched: false,
  });
  assert.equal(JSON.stringify(report).includes('reference-bound-private-payload'), false);
  assert.equal(JSON.stringify(report).includes('optional-reference-bound-private-payload'), false);
});
