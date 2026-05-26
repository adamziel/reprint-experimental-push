import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginFile = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const hasPhp = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;

function runMerge(dbJournal, checkedSummary) {
  return spawnSync('php', [
    '-r',
    [
      'define("ABSPATH", dirname($argv[1]));',
      'function add_filter(...$args) {}',
      'function add_action(...$args) {}',
      'function register_rest_route(...$args) {}',
      'class WP_REST_Server { const CREATABLE = "POST"; const READABLE = "GET"; }',
      'class WP_REST_Response {',
      '  private $data;',
      '  public function __construct($data = null, $status = null) { $this->data = $data; }',
      '  public function get_data() { return $this->data; }',
      '  public function set_data($data) { $this->data = $data; }',
      '}',
      'class WP_REST_Request {}',
      'require $argv[1];',
      '$dbJournal = json_decode($argv[2], true);',
      '$checkedSummary = json_decode($argv[3], true);',
      'echo json_encode(reprint_push_lab_rest_merge_checked_db_journal_contract($dbJournal, $checkedSummary));',
    ].join(' '),
    pluginFile,
    JSON.stringify(dbJournal),
    JSON.stringify(checkedSummary),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('checked db journal merge fills nested ownership and lease fence gaps', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });
});

test('checked db journal merge preserves more specific inline values', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: false,
        productionAdapter: 'custom-inline-adapter',
      },
      leaseFence: {
        boundary: 'custom-inline-boundary',
        claimKeyUnique: false,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: false,
      productionAdapter: 'custom-inline-adapter',
    },
    leaseFence: {
      boundary: 'custom-inline-boundary',
      claimKeyUnique: false,
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge upgrades stale checked-boundary acceptance and fills empty nested values', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: false,
      ownership: {
        ownsJournal: true,
        restartReadable: null,
        productionAdapter: '',
      },
      leaseFence: {
        boundary: '',
        claimKeyUnique: true,
        monotonicSequence: null,
        restartReadable: '',
        staleClaimRejected: null,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge replaces stale nested checked-boundary booleans when the inline contract was not accepted yet', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: false,
      ownership: {
        ownsJournal: true,
        restartReadable: false,
        productionAdapter: 'stale-inline-adapter',
      },
      leaseFence: {
        boundary: 'stale-inline-boundary',
        claimKeyUnique: false,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge upgrades stale inline scope on checked boundaries', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge replaces stale nested checked-boundary values when the inline scope still claims a local fixture', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'local Playground fixture only; not production durability',
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: false,
        productionAdapter: 'stale-inline-adapter',
      },
      leaseFence: {
        boundary: 'stale-inline-boundary',
        claimKeyUnique: false,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge fills checked schema metadata without overriding inline values', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      ownership: {
        ownsJournal: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });
});

test('checked db journal merge fills empty top-level evidence arrays from the checked summary', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      latestRows: [],
      eventSummaries: [],
      idempotencyEvidence: [],
      ownership: {
        ownsJournal: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      latestRows: [
        { event: 'idempotency-opened' },
        { event: 'mutation-applied' },
        { event: 'apply-committed' },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
      ],
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    latestRows: [
      { event: 'idempotency-opened' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    eventSummaries: [
      { event: 'apply-committed', count: 1, latestId: 3 },
    ],
    idempotencyEvidence: [
      { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
    ],
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });
});

test('checked db journal merge upgrades partial top-level evidence arrays and zero row counts from the checked summary', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      rowCount: 0,
      latestRows: [
        { event: 'apply-committed' },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 1, requestHashes: 1, latestId: 3 },
      ],
      ownership: {
        ownsJournal: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      rowCount: 3,
      latestRows: [
        { event: 'idempotency-opened' },
        { event: 'mutation-applied' },
        { event: 'apply-committed' },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
        { event: 'mutation-applied', count: 1, latestId: 2 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
        { idempotencyKeyHash: 'idem-hash-02', events: 1, requestHashes: 1, latestId: 4 },
      ],
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    rowCount: 3,
    latestRows: [
      { event: 'idempotency-opened' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    eventSummaries: [
      { event: 'apply-committed', count: 1, latestId: 3 },
      { event: 'mutation-applied', count: 1, latestId: 2 },
    ],
    idempotencyEvidence: [
      { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
      { idempotencyKeyHash: 'idem-hash-02', events: 1, requestHashes: 1, latestId: 4 },
    ],
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });
});

test('checked storage guard merge fills partial inline values from the checked summary', { skip: !hasPhp }, () => {
  const result = spawnSync('php', [
    '-r',
    [
      'define("ABSPATH", dirname($argv[1]));',
      'function add_filter(...$args) {}',
      'function add_action(...$args) {}',
      'function register_rest_route(...$args) {}',
      'class WP_REST_Server { const CREATABLE = "POST"; const READABLE = "GET"; }',
      'class WP_REST_Response {',
      '  private $data;',
      '  public function __construct($data = null, $status = null) { $this->data = $data; }',
      '  public function get_data() { return $this->data; }',
      '  public function set_data($data) { $this->data = $data; }',
      '}',
      'class WP_REST_Request {}',
      'require $argv[1];',
      '$inline = json_decode($argv[2], true);',
      '$checked = json_decode($argv[3], true);',
      'echo json_encode(reprint_push_lab_rest_merge_checked_storage_guard($inline, $checked));',
    ].join(' '),
    pluginFile,
    JSON.stringify({
      boundary: 'wpdb-single-statement-cas',
    }),
    JSON.stringify({
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    }),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked storage guard merge preserves more specific inline values', { skip: !hasPhp }, () => {
  const result = spawnSync('php', [
    '-r',
    [
      'define("ABSPATH", dirname($argv[1]));',
      'function add_filter(...$args) {}',
      'function add_action(...$args) {}',
      'function register_rest_route(...$args) {}',
      'class WP_REST_Server { const CREATABLE = "POST"; const READABLE = "GET"; }',
      'class WP_REST_Response {',
      '  private $data;',
      '  public function __construct($data = null, $status = null) { $this->data = $data; }',
      '  public function get_data() { return $this->data; }',
      '  public function set_data($data) { $this->data = $data; }',
      '}',
      'class WP_REST_Request {}',
      'require $argv[1];',
      '$inline = json_decode($argv[2], true);',
      '$checked = json_decode($argv[3], true);',
      'echo json_encode(reprint_push_lab_rest_merge_checked_storage_guard($inline, $checked));',
    ].join(' '),
    pluginFile,
    JSON.stringify({
      boundary: 'custom-inline-boundary',
      operation: 'compare-and-swap',
      outcome: 'retained',
    }),
    JSON.stringify({
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    }),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'custom-inline-boundary',
    operation: 'compare-and-swap',
    outcome: 'retained',
  });
});
