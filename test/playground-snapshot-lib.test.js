import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES,
  WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
  WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES,
  WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
  WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS,
  WORDPRESS_GRAPH_UNSUPPORTED_SURFACE_CONTRACTS,
  wordpressGraphIdentityMapContractHash,
} from '../src/wordpress-graph-contracts.js';

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

function runMultisiteGraphExportProbe() {
  const result = spawnSync('php', [
    '-d',
    'display_errors=stderr',
    '-r',
    `
if (!defined('ARRAY_A')) {
    define('ARRAY_A', 'ARRAY_A');
}
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) { return $value; }
}
if (!function_exists('is_multisite')) {
    function is_multisite() { return true; }
}
if (!function_exists('maybe_unserialize')) {
    function maybe_unserialize($value) { return $value; }
}
if (!function_exists('wp_json_encode')) {
    function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
}

class ReprintPushFakeWpdb {
    public string $prefix = 'wp_';
    public string $base_prefix = 'wp_';
    public string $last_error = '';
    private array $tables = ['wp_site', 'wp_blogs', 'wp_blogmeta'];

    public function prepare($query, ...$args) {
        return ['query' => $query, 'args' => $args];
    }

    public function get_var($query) {
        if (is_array($query) && str_contains($query['query'], 'SHOW TABLES LIKE')) {
            $table = (string) ($query['args'][0] ?? '');
            return in_array($table, $this->tables, true) ? $table : null;
        }
        return null;
    }

    public function get_results($query, $format = null) {
        $sql = is_array($query) ? $query['query'] : (string) $query;
        $args = is_array($query) ? $query['args'] : [];
        if (str_contains($sql, 'SELECT DISTINCT b.blog_id')) {
            return [
                [
                    'blog_id' => '101',
                    'site_id' => '1',
                    'domain' => 'mapped.example.test',
                    'path' => '/mapped/',
                    'registered' => '2026-06-02 00:00:00',
                    'last_updated' => '2026-06-02 00:01:00',
                    'public' => '1',
                    'archived' => '0',
                    'mature' => '0',
                    'spam' => '0',
                    'deleted' => '0',
                ],
            ];
        }
        if (str_contains($sql, 'SELECT id, domain, path')) {
            return [
                ['id' => '1', 'domain' => 'network.example.test', 'path' => '/'],
            ];
        }
        if (str_contains($sql, 'SELECT blog_id, meta_key, meta_value')) {
            $allowedKeys = array_slice($args, 1);
            $rows = [
                ['blog_id' => '101', 'meta_key' => 'reprint_push_blog_fixture', 'meta_value' => 'shared'],
                ['blog_id' => '101', 'meta_key' => '_rpp0901_blog_id_reference_v6', 'meta_value' => 'portable-blog-payload'],
                ['blog_id' => '101', 'meta_key' => '_private_unexported_blogmeta', 'meta_value' => 'do-not-export'],
            ];
            return array_values(array_filter($rows, static function ($row) use ($allowedKeys) {
                return in_array($row['meta_key'], $allowedKeys, true);
            }));
        }
        return [];
    }
}

$GLOBALS['wpdb'] = new ReprintPushFakeWpdb();
require $argv[1];
$snapshot = [
    'db' => [
        'wp_site' => [],
        'wp_blogs' => [],
        'wp_blogmeta' => [],
    ],
];
reprint_push_export_fixture_multisite_graph($snapshot);
echo json_encode($snapshot, JSON_UNESCAPED_SLASHES);
    `,
    snapshotLib,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
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

function runWordPressGraphContractProbe() {
  const result = spawnSync('php', [
    '-d',
    'display_errors=stderr',
    '-r',
    `
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) { return $value; }
}
if (!function_exists('wp_json_encode')) {
    function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
}
require $argv[1];
$snapshot = ['meta' => []];
reprint_push_add_wordpress_graph_contracts($snapshot);
echo json_encode([
    'metadata' => reprint_push_wordpress_graph_contract_metadata(),
    'snapshotMeta' => $snapshot['meta']['wordpressGraphContracts'],
]);
`,
    snapshotLib,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runWordPressGraphIdentityMapProbe() {
  const result = spawnSync('php', [
    '-d',
    'display_errors=stderr',
    '-r',
    `
if (!function_exists('apply_filters')) {
    function apply_filters($hook, $value) {
        if ($hook === 'reprint_push_wordpress_graph_identity_map_rows'
            && array_key_exists('rpp_graph_identity_rows', $GLOBALS)) {
            return $GLOBALS['rpp_graph_identity_rows'];
        }
        return $value;
    }
}
if (!function_exists('wp_json_encode')) {
    function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
}
require $argv[1];

function rpp_graph_identity_capture($rows): array {
    $GLOBALS['rpp_graph_identity_rows'] = $rows;
    $snapshot = ['meta' => []];
    try {
        reprint_push_add_wordpress_graph_identity_maps($snapshot);
        return [
            'ok' => true,
            'snapshotMeta' => $snapshot['meta']['wordpressGraphIdentityMap'] ?? null,
            'normalizedRows' => reprint_push_wordpress_graph_identity_map_rows(),
        ];
    } catch (Throwable $error) {
        return [
            'ok' => false,
            'snapshotMeta' => $snapshot['meta']['wordpressGraphIdentityMap'] ?? null,
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    } finally {
        unset($GLOBALS['rpp_graph_identity_rows']);
    }
}

echo json_encode([
    'empty' => rpp_graph_identity_capture([]),
    'accepted' => rpp_graph_identity_capture([
        [
            'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
            'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
        ],
        [
            'table' => 'wp_users',
            'localId' => 'ID:41',
            'remoteId' => 'ID:82',
            'contractVersion' => 1,
            'contractKind' => 'wordpress-graph-identity-map',
            'rawValuesIncluded' => false,
        ],
    ]),
    'wrappedRows' => rpp_graph_identity_capture([
        'rows' => [
            [
                'sourceResourceKey' => 'row:["wp_comments","comment_ID:10"]',
                'targetResourceKey' => 'row:["wp_comments","comment_ID:20"]',
            ],
        ],
    ]),
    'failures' => [
        'unsupportedVersion' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
                'contractVersion' => 2,
            ],
        ]),
        'unsupportedKind' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
                'contractKind' => 'wrong-contract',
            ],
        ]),
        'missingKind' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
                'contractVersion' => 1,
            ],
        ]),
        'rawValues' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
                'rawValuesIncluded' => true,
            ],
        ]),
        'selfMap' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:2001"]',
            ],
        ]),
        'crossSurface' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_users","ID:3001"]',
            ],
        ]),
        'malformedResource' => rpp_graph_identity_capture([
            [
                'sourceResourceKey' => 'post:2001',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
            ],
        ]),
        'contractHashMismatch' => rpp_graph_identity_capture([
            [
                'contractVersion' => 1,
                'contractKind' => 'wordpress-graph-identity-map',
                'sourceResourceKey' => 'row:["wp_posts","ID:2001"]',
                'targetResourceKey' => 'row:["wp_posts","ID:3001"]',
                'contractHash' => str_repeat('0', 64),
            ],
        ]),
    ],
]);
`,
    snapshotLib,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function summarizeJsRelationshipContract(contract) {
  return {
    schemaVersion: contract.schemaVersion,
    contractKind: contract.contractKind,
    relationshipType: contract.relationshipType,
    sourceSuffix: contract.sourceSuffix,
    sourceFields: [...contract.sourceFields],
    ...(contract.sourceCondition ? { sourceCondition: contract.sourceCondition } : {}),
    targetSuffix: contract.targetSuffix,
    scalarRewriteSupported: contract.scalarRewriteSupported === true,
    targetValidation: contract.targetValidation,
    samePlanSupported: contract.samePlanSupported === true,
    resolutionPolicy: contract.resolutionPolicy,
    rawValuesIncluded: contract.rawValuesIncluded === true,
  };
}

function summarizeJsUnsupportedSurfaceContract(contract) {
  return {
    surface: contract.surface,
    ...(contract.unsupportedValues ? { unsupportedValues: [...contract.unsupportedValues] } : {}),
    ...(contract.supportedValues ? { supportedValues: [...contract.supportedValues] } : {}),
    reasonCode: contract.reasonCode,
    resolutionPolicy: contract.resolutionPolicy,
  };
}

test('snapshot apply gate allows only named lab plugin resources', { skip: !hasPhp }, () => {
  assertSupported({ type: 'plugin', name: 'reprint-push-forms-fixture' });
  assertSupported({ type: 'plugin', name: 'reprint-push-atomic-dependency-fixture' });

  assertRejected(
    { type: 'plugin', name: 'akismet' },
    /Unsupported fixture plugin: akismet/,
  );
});

test('snapshot library exports fixture-scoped multisite graph identity rows', { skip: !hasPhp }, () => {
  const snapshot = runMultisiteGraphExportProbe();

  assert.deepEqual(snapshot.db.wp_site, {
    'id:1': {
      id: 1,
      domain: 'network.example.test',
      path: '/',
    },
  });
  assert.deepEqual(snapshot.db.wp_blogs, {
    'blog_id:101': {
      blog_id: 101,
      site_id: 1,
      domain: 'mapped.example.test',
      path: '/mapped/',
      registered: '2026-06-02 00:00:00',
      last_updated: '2026-06-02 00:01:00',
      public: 1,
      archived: 0,
      mature: 0,
      spam: 0,
      deleted: 0,
    },
  });
  assert.deepEqual(snapshot.db.wp_blogmeta, {
    'blog_id:101:meta_key:_rpp0901_blog_id_reference_v6': {
      blog_id: 101,
      meta_key: '_rpp0901_blog_id_reference_v6',
      meta_value: 'portable-blog-payload',
    },
    'blog_id:101:meta_key:reprint_push_blog_fixture': {
      blog_id: 101,
      meta_key: 'reprint_push_blog_fixture',
      meta_value: 'shared',
    },
  });
  assert.equal(JSON.stringify(snapshot).includes('_private_unexported_blogmeta'), false);
  assert.equal(JSON.stringify(snapshot).includes('do-not-export'), false);
});

test('snapshot library exports WordPress graph contracts that match the JS planner contract', { skip: !hasPhp }, () => {
  const { metadata, snapshotMeta } = runWordPressGraphContractProbe();

  assert.deepEqual(snapshotMeta, metadata);
  assert.equal(metadata.schemaVersion, WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION);
  assert.equal(metadata.rawValuesIncluded, false);
  assert.deepEqual(
    metadata.relationshipContracts,
    WORDPRESS_GRAPH_RELATIONSHIP_CONTRACTS.map(summarizeJsRelationshipContract),
  );
  assert.deepEqual(
    metadata.unsupportedSurfaceContracts,
    WORDPRESS_GRAPH_UNSUPPORTED_SURFACE_CONTRACTS.map(summarizeJsUnsupportedSurfaceContract),
  );
  assert.deepEqual(metadata.identityMapContract, {
    schemaVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
    contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
    explicitMapTableSuffixes: [...SUPPORTED_WORDPRESS_GRAPH_IDENTITY_MAP_TABLE_SUFFIXES],
    failClosedCollisionSurfaces: [...WORDPRESS_GRAPH_IDENTITY_FAIL_CLOSED_COLLISION_SURFACES],
    rewritesRequireEquivalentRemoteTarget: true,
    explicitContractsFailClosed: true,
    rewritesRecordHashOnlyEvidence: true,
    identityMapRowsRecordContractHash: true,
    rawValuesIncluded: false,
  });
  assert.equal(
    metadata.relationshipContracts.find((contract) =>
      contract.relationshipType === 'serialized-block-attachment')?.scalarRewriteSupported,
    false,
  );
  assert.equal(
    metadata.relationshipContracts.find((contract) =>
      contract.relationshipType === 'featured-image-attachment')?.sourceCondition,
    'meta_key:_thumbnail_id',
  );

  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /Private|example\.test|Brewcommerce|fixture-private/);
});

test('snapshot library exports only explicit WordPress graph identity-map contract rows', { skip: !hasPhp }, () => {
  const report = runWordPressGraphIdentityMapProbe();

  assert.equal(report.empty.ok, true);
  assert.equal(report.empty.snapshotMeta, null);
  assert.deepEqual(report.empty.normalizedRows, []);

  assert.equal(report.accepted.ok, true);
  assert.deepEqual(report.accepted.snapshotMeta, {
    contractVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
    contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
    rows: [
      {
        contractVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
        sourceResourceKey: 'row:["wp_posts","ID:2001"]',
        targetResourceKey: 'row:["wp_posts","ID:3001"]',
        contractHash: wordpressGraphIdentityMapContractHash({
          sourceResourceKey: 'row:["wp_posts","ID:2001"]',
          targetResourceKey: 'row:["wp_posts","ID:3001"]',
        }),
        rawValuesIncluded: false,
      },
      {
        contractVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
        sourceResourceKey: 'row:["wp_users","ID:41"]',
        targetResourceKey: 'row:["wp_users","ID:82"]',
        contractHash: wordpressGraphIdentityMapContractHash({
          sourceResourceKey: 'row:["wp_users","ID:41"]',
          targetResourceKey: 'row:["wp_users","ID:82"]',
        }),
        rawValuesIncluded: false,
      },
    ],
    rawValuesIncluded: false,
  });
  assert.deepEqual(report.accepted.normalizedRows, report.accepted.snapshotMeta.rows);
  assert.equal(report.wrappedRows.ok, true);
  assert.deepEqual(report.wrappedRows.snapshotMeta.rows, [
    {
      contractVersion: WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
      contractKind: WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
      sourceResourceKey: 'row:["wp_comments","comment_ID:10"]',
      targetResourceKey: 'row:["wp_comments","comment_ID:20"]',
      contractHash: wordpressGraphIdentityMapContractHash({
        sourceResourceKey: 'row:["wp_comments","comment_ID:10"]',
        targetResourceKey: 'row:["wp_comments","comment_ID:20"]',
      }),
      rawValuesIncluded: false,
    },
  ]);

  assert.deepEqual(
    Object.fromEntries(Object.entries(report.failures).map(([name, failure]) => [name, failure.ok])),
    {
      unsupportedVersion: false,
      unsupportedKind: false,
      missingKind: false,
      rawValues: false,
      selfMap: false,
      crossSurface: false,
      malformedResource: false,
      contractHashMismatch: false,
    },
  );
  for (const failure of Object.values(report.failures)) {
    assert.equal(failure.error.class, 'RuntimeException');
    assert.equal(failure.snapshotMeta, null);
  }
  assert.equal(
    report.failures.contractHashMismatch.error.message,
    'WordPress graph identity map contract hash mismatch.',
  );

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /Private|example\.test|Brewcommerce|fixture-private/);
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

test('snapshot apply gate supports only composite fixture blogmeta rows', { skip: !hasPhp }, () => {
  assertSupported({
    type: 'row',
    table: 'wp_blogmeta',
    id: 'blog_id:101:meta_key:_rpp0901_blog_id_reference_v6',
  });
  assertSupported({
    type: 'row',
    table: 'wp_blogmeta',
    id: 'blog_id:101:meta_key:reprint_push_blog_fixture',
  });

  assertRejected(
    { type: 'row', table: 'wp_blogs', id: 'blog_id:101' },
    /Unsupported apply table: wp_blogs/,
  );
  assertRejected(
    { type: 'row', table: 'wp_blogmeta', id: 'meta_id:44' },
    /Unsupported blogmeta id/,
  );
  assertRejected(
    { type: 'row', table: 'wp_blogmeta', id: 'blog_id:0:meta_key:_rpp0901_blog_id_reference_v6' },
    /Unsupported blogmeta id/,
  );
  assertRejected(
    { type: 'row', table: 'wp_blogmeta', id: 'blog_id:101:meta_key:_private_unexported_blogmeta' },
    /Unsupported blogmeta id/,
  );
});
