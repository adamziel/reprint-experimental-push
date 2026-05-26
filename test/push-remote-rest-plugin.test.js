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

function runStorageGuardMerge(storageGuard, checkedStorageGuard, preferChecked = false) {
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
      '$storageGuard = json_decode($argv[2], true);',
      '$checkedStorageGuard = json_decode($argv[3], true);',
      '$preferChecked = ($argv[4] ?? "0") === "1";',
      'echo json_encode(reprint_push_lab_rest_merge_checked_storage_guard($storageGuard, $checkedStorageGuard, $preferChecked));',
    ].join(' '),
    pluginFile,
    JSON.stringify(storageGuard),
    JSON.stringify(checkedStorageGuard),
    preferChecked ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runHasStaleClaimRejectionEvidence(rows, eventSummaries = []) {
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
      '$rows = json_decode($argv[2], true);',
      '$eventSummaries = json_decode($argv[3], true);',
      'echo json_encode(reprint_push_lab_db_journal_has_stale_claim_rejection_evidence($rows, $eventSummaries));',
    ].join(' '),
    pluginFile,
    JSON.stringify(rows),
    JSON.stringify(eventSummaries),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDbJournalStorageGuard(summary) {
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
      '$summary = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_rest_db_journal_storage_guard($summary));',
    ].join(' '),
    pluginFile,
    JSON.stringify(summary),
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
      writerLease: {
        strategy: 'claim-fenced-single-writer',
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
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: false,
        },
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
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
      staleClaimRejected: false,
    },
  });
});

test('db journal stale-claim evidence stays visible when only event summaries retain the retry rows', { skip: !hasPhp }, () => {
  const result = runHasStaleClaimRejectionEvidence(
    [
      { event: 'idempotency-opened' },
      { event: 'apply-started' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    [
      { event: 'apply-committed', count: 3, latestId: 24 },
      { event: 'stale-claim-retry-started', count: 1, latestId: 20 },
    ],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), true);
});

test('db journal stale-claim evidence stays visible when only event summaries retain the abandoned row', { skip: !hasPhp }, () => {
  const result = runHasStaleClaimRejectionEvidence(
    [
      { event: 'idempotency-opened' },
      { event: 'apply-started' },
      { event: 'mutation-applied' },
      { event: 'apply-committed' },
    ],
    [
      { event: 'apply-committed', count: 3, latestId: 24 },
      { event: 'stale-claim-abandoned', count: 1, latestId: 18 },
    ],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), true);
});

test('db journal storage guard stays visible when only checked event summaries retain the committed row', { skip: !hasPhp }, () => {
  const result = runDbJournalStorageGuard({
    acceptedOnCheckedBoundary: true,
    latestRows: [
      {
        sequence: 24,
        event: 'apply-replayed',
        result: {
          ok: true,
        },
      },
      {
        sequence: 25,
        event: 'idempotency-in-progress',
        result: {
          ok: false,
        },
      },
    ],
    eventSummaries: [
      { event: 'idempotency-in-progress', count: 1, latestId: 25 },
      { event: 'apply-replayed', count: 1, latestId: 24 },
      { event: 'apply-committed', count: 1, latestId: 20 },
    ],
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  });
});

test('db journal storage guard stays visible when only the checked top-level committed proof survives the trimmed summary', { skip: !hasPhp }, () => {
  const result = runDbJournalStorageGuard({
    acceptedOnCheckedBoundary: true,
    applyCommitted: true,
    latestRows: [
      {
        sequence: 24,
        event: 'apply-replayed',
        result: {
          ok: true,
        },
      },
      {
        sequence: 25,
        event: 'idempotency-in-progress',
        result: {
          ok: false,
        },
      },
    ],
    eventSummaries: [],
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
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
      applyCommitted: false,
      mutationApplied: 0,
      idempotencyOpened: 0,
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
      applyCommitted: true,
      mutationApplied: 1,
      idempotencyOpened: 1,
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
    applyCommitted: true,
    mutationApplied: 1,
    idempotencyOpened: 1,
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

test('checked db journal merge keeps durable proof counters visible when checked event summaries outlive the trimmed latest row window', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      applyCommitted: false,
      mutationApplied: 0,
      idempotencyOpened: 0,
      latestRows: [
        { event: 'apply-replayed', id: 24 },
        { event: 'idempotency-in-progress', id: 25 },
      ],
      eventSummaries: [
        { event: 'idempotency-in-progress', count: 1, latestId: 25 },
        { event: 'apply-replayed', count: 1, latestId: 24 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 2, requestHashes: 1, latestId: 25 },
      ],
      ownership: {
        ownsJournal: true,
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      applyCommitted: true,
      mutationApplied: 1,
      idempotencyOpened: 1,
      latestRows: [
        { event: 'apply-replayed', id: 24 },
        { event: 'idempotency-in-progress', id: 25 },
      ],
      eventSummaries: [
        { event: 'idempotency-in-progress', count: 1, latestId: 25 },
        { event: 'apply-replayed', count: 1, latestId: 24 },
        { event: 'apply-committed', count: 1, latestId: 20 },
        { event: 'mutation-applied', count: 1, latestId: 19 },
        { event: 'idempotency-opened', count: 1, latestId: 18 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 5, requestHashes: 1, latestId: 25 },
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
    applyCommitted: true,
    mutationApplied: 1,
    idempotencyOpened: 1,
    latestRows: [
      { event: 'apply-replayed', id: 24 },
      { event: 'idempotency-in-progress', id: 25 },
    ],
    eventSummaries: [
      { event: 'idempotency-in-progress', count: 1, latestId: 25 },
      { event: 'apply-replayed', count: 1, latestId: 24 },
      { event: 'apply-committed', count: 1, latestId: 20 },
      { event: 'mutation-applied', count: 1, latestId: 19 },
      { event: 'idempotency-opened', count: 1, latestId: 18 },
    ],
    idempotencyEvidence: [
      { idempotencyKeyHash: 'idem-hash-01', events: 5, requestHashes: 1, latestId: 25 },
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

test('checked db journal merge replaces stale top-level checked evidence when the inline scope still claims a local fixture', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'local Playground fixture only; not production durability',
      acceptedOnCheckedBoundary: true,
      schemaVersion: 0,
      table: 'wp_stale_fixture_journal',
      rowCount: 1,
      latestRows: [
        { event: 'apply-committed', id: 3 },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 1, requestHashes: 1, latestId: 3 },
      ],
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
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      rowCount: 3,
      latestRows: [
        { event: 'idempotency-opened', id: 1 },
        { event: 'mutation-applied', id: 2 },
        { event: 'apply-committed', id: 3 },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
        { event: 'mutation-applied', count: 1, latestId: 2 },
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
        staleClaimRejected: true,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 3,
    latestRows: [
      { event: 'idempotency-opened', id: 1 },
      { event: 'mutation-applied', id: 2 },
      { event: 'apply-committed', id: 3 },
    ],
    eventSummaries: [
      { event: 'apply-committed', count: 1, latestId: 3 },
      { event: 'mutation-applied', count: 1, latestId: 2 },
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
      staleClaimRejected: true,
    },
  });
});

test('checked db journal merge prefers authoritative checked top-level evidence even when the inline contract is already accepted', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 2,
      latestRows: [
        { event: 'idempotency-opened', id: 1 },
        { event: 'mutation-applied', id: 2 },
      ],
      eventSummaries: [
        { event: 'mutation-applied', count: 1, latestId: 2 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 2, requestHashes: 1, latestId: 2 },
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
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 3,
      latestRows: [
        { event: 'idempotency-opened', id: 1 },
        { event: 'mutation-applied', id: 2 },
        { event: 'apply-committed', id: 3 },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
        { event: 'mutation-applied', count: 1, latestId: 2 },
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
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 3,
    latestRows: [
      { event: 'idempotency-opened', id: 1 },
      { event: 'mutation-applied', id: 2 },
      { event: 'apply-committed', id: 3 },
    ],
    eventSummaries: [
      { event: 'apply-committed', count: 1, latestId: 3 },
      { event: 'mutation-applied', count: 1, latestId: 2 },
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

test('checked db journal merge upgrades stale nested checked-boundary booleans even when top-level acceptance is already true', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: false,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: false,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
      },
    },
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
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
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
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

test('checked db journal merge upgrades nested writer lease evidence when the authoritative checked contract is already accepted', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: false,
          storageGuard: 'local-playground-fence',
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
        },
        staleClaimRejected: false,
      },
    },
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: false,
        },
        staleClaimRejected: false,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
      staleClaimRejected: false,
    },
  });
});

test('checked db journal merge upgrades stale fixture-style nested checked-boundary strings without overriding custom inline adapters', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'local-fixture-adapter',
      },
      leaseFence: {
        boundary: 'local-playground-fence',
        claimKeyUnique: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
    {
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
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
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
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

test('checked storage guard merge replaces stale checked-boundary values when the inline contract was not accepted yet', { skip: !hasPhp }, () => {
  const result = runStorageGuardMerge(
    {
      boundary: 'local-fixture-write',
      operation: 'option-update',
      outcome: 'fixture-only',
    },
    {
      boundary: 'wpdb-single-statement-cas',
      operation: 'insert-or-update',
      outcome: 'claim-fenced',
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'wpdb-single-statement-cas',
    operation: 'insert-or-update',
    outcome: 'claim-fenced',
  });
});

test('checked storage guard merge preserves more specific inline values when checked replacement is not required', { skip: !hasPhp }, () => {
  const result = runStorageGuardMerge(
    {
      boundary: 'custom-inline-boundary',
      operation: 'compare-and-swap',
      outcome: 'custom-proof',
    },
    {
      boundary: 'wpdb-single-statement-cas',
      operation: 'insert-or-update',
      outcome: 'claim-fenced',
    },
    false,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    boundary: 'custom-inline-boundary',
    operation: 'compare-and-swap',
    outcome: 'custom-proof',
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

test('authoritative checked storage guard preference upgrades stale fixture-style values on accepted checked boundaries', { skip: !hasPhp }, () => {
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
      '$dbJournal = json_decode($argv[4], true);',
      'echo json_encode([',
      '  "prefer" => reprint_push_lab_rest_should_prefer_authoritative_checked_storage_guard($inline, $checked, $dbJournal),',
      '  "merged" => reprint_push_lab_rest_merge_checked_storage_guard(',
      '    $inline,',
      '    $checked,',
      '    reprint_push_lab_rest_should_prefer_authoritative_checked_storage_guard($inline, $checked, $dbJournal)',
      '  ),',
      ']);',
    ].join(' '),
    pluginFile,
    JSON.stringify({
      boundary: 'local-fixture-write',
      operation: 'playground-append',
      outcome: 'fixture-only',
    }),
    JSON.stringify({
      boundary: 'wpdb-single-statement-cas',
      operation: 'insert-or-update',
      outcome: 'claim-fenced',
    }),
    JSON.stringify({
      acceptedOnCheckedBoundary: true,
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
    }),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    prefer: true,
    merged: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'insert-or-update',
      outcome: 'claim-fenced',
    },
  });
});
