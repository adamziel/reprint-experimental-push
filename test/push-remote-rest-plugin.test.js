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

function runAttachCheckedDbJournalContract(result, checkedSummary, injectIfMissing = false) {
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
      '$result = json_decode($argv[2], true);',
      '$checkedSummary = json_decode($argv[3], true);',
      '$injectIfMissing = ($argv[4] ?? "0") === "1";',
      'echo json_encode(reprint_push_lab_rest_attach_checked_db_journal_contract($result, $injectIfMissing, $checkedSummary));',
    ].join(' '),
    pluginFile,
    JSON.stringify(result),
    JSON.stringify(checkedSummary),
    injectIfMissing ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runFinalizeAuthenticatedApplyResult(result, authEvidence, signedRequestEvidence) {
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
      '$result = json_decode($argv[2], true);',
      '$authEvidence = json_decode($argv[3], true);',
      '$signedRequestEvidence = json_decode($argv[4], true);',
      '$checkedSummary = json_decode($argv[5], true);',
      'echo json_encode(reprint_push_lab_rest_finalize_authenticated_apply_result(',
      '  $result,',
      '  $authEvidence,',
      '  $signedRequestEvidence,',
      '  $checkedSummary',
      '));',
    ].join(' '),
    pluginFile,
    JSON.stringify(result),
    JSON.stringify(authEvidence),
    JSON.stringify(signedRequestEvidence),
    JSON.stringify({
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
        staleClaimRejected: false,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: false,
        },
      },
      latestRows: [
        {
          event: 'apply-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'compare-and-swap',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'apply-rejected', count: 1, latestId: 18 },
      ],
    }),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runFinalizeAuthenticatedJournalResult(result, authEvidence, signedRequestEvidence) {
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
      '$result = json_decode($argv[2], true);',
      '$authEvidence = json_decode($argv[3], true);',
      '$signedRequestEvidence = json_decode($argv[4], true);',
      '$checkedSummary = json_decode($argv[5], true);',
      'echo json_encode(reprint_push_lab_rest_finalize_authenticated_journal_result(',
      '  $result,',
      '  $authEvidence,',
      '  $signedRequestEvidence,',
      '  $checkedSummary',
      '));',
    ].join(' '),
    pluginFile,
    JSON.stringify(result),
    JSON.stringify(authEvidence),
    JSON.stringify(signedRequestEvidence),
    JSON.stringify({
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
        staleClaimRejected: false,
      },
    }),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runWriterLeaseContract({
  staleClaimRejected,
  claimKeyUnique = true,
  monotonicSequence = true,
  restartReadable = true,
}) {
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
      '$staleClaimRejected = ($argv[2] ?? "0") === "1";',
      '$claimKeyUnique = ($argv[3] ?? "1") === "1";',
      '$monotonicSequence = ($argv[4] ?? "1") === "1";',
      '$restartReadable = ($argv[5] ?? "1") === "1";',
      'echo json_encode(reprint_push_lab_db_journal_writer_lease_contract($staleClaimRejected, $claimKeyUnique, $monotonicSequence, $restartReadable));',
    ].join(' '),
    pluginFile,
    staleClaimRejected ? '1' : '0',
    claimKeyUnique ? '1' : '0',
    monotonicSequence ? '1' : '0',
    restartReadable ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runRecoveryJournalEvidence({ checkedSurface = false, packageMode = false } = {}) {
  return spawnSync('php', [
    '-r',
    [
      'define("ABSPATH", dirname($argv[1]));',
      'if (($argv[3] ?? "0") === "1") {',
      '  define("REPRINT_PUSH_DISABLE_LAB_ROUTES", true);',
      '  define("REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP", true);',
      '}',
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
      '$checkedSurface = ($argv[2] ?? "0") === "1";',
      'echo json_encode(reprint_push_lab_rest_recovery_journal_evidence($checkedSurface));',
    ].join(' '),
    pluginFile,
    checkedSurface ? '1' : '0',
    packageMode ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runAttachCheckedRecoveryJournalEvidence(
  result,
  checkedSurface = false,
  packageMode = false,
  checkedDbJournal = null,
) {
  return spawnSync('php', [
    '-r',
    [
      'define("ABSPATH", dirname($argv[1]));',
      'if (($argv[4] ?? "0") === "1") {',
      '  define("REPRINT_PUSH_DISABLE_LAB_ROUTES", true);',
      '  define("REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP", true);',
      '}',
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
      '$result = json_decode($argv[2], true);',
      '$checkedSurface = ($argv[3] ?? "0") === "1";',
      '$checkedDbJournal = json_decode($argv[5] ?? "null", true);',
      'echo json_encode(reprint_push_lab_rest_attach_checked_recovery_journal_evidence($result, $checkedSurface, $checkedDbJournal));',
    ].join(' '),
    pluginFile,
    JSON.stringify(result),
    checkedSurface ? '1' : '0',
    packageMode ? '1' : '0',
    JSON.stringify(checkedDbJournal),
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

test('recovery inspect journal evidence upgrades scope on checked and packaged boundaries', { skip: !hasPhp }, () => {
  const localResult = runRecoveryJournalEvidence();
  assert.equal(localResult.status, 0, localResult.stderr);
  assert.deepEqual(JSON.parse(localResult.stdout), {
    integrity: {
      schemaVersion: 1,
      status: 'ok',
      scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
    },
  });

  const checkedResult = runRecoveryJournalEvidence({ checkedSurface: true });
  assert.equal(checkedResult.status, 0, checkedResult.stderr);
  assert.deepEqual(JSON.parse(checkedResult.stdout), {
    integrity: {
      schemaVersion: 1,
      status: 'ok',
      scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
    },
  });

  const packagedResult = runRecoveryJournalEvidence({ checkedSurface: true, packageMode: true });
  assert.equal(packagedResult.status, 0, packagedResult.stderr);
  assert.deepEqual(JSON.parse(packagedResult.stdout), {
    integrity: {
      schemaVersion: 1,
      status: 'ok',
      scope: 'packaged production plugin recovery inspect journal evidence; not local Playground fixture only',
    },
  });
});

test('checked recovery inspect evidence upgrades an existing fixture-scoped journal on the checked boundary', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
        },
      },
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        acceptedOnCheckedBoundary: true,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
          staleClaimRejected: false,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
      },
    },
  });
});

test('checked recovery inspect evidence upgrades an existing fixture-scoped journal in packaged mode', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
        },
      },
    },
    true,
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'packaged production plugin recovery inspect journal evidence; not local Playground fixture only',
        },
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production plugin journal surface; not local Playground fixture only',
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
          staleClaimRejected: false,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
      },
    },
  });
});

test('checked recovery inspect evidence preserves a stronger existing non-fixture scope', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'production recovery inspect journal evidence from external durable adapter',
          },
        },
      },
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'production recovery inspect journal evidence from external durable adapter',
        },
        acceptedOnCheckedBoundary: true,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
          staleClaimRejected: false,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
      },
    },
  });
});

test('checked recovery inspect evidence preserves existing recovery journal storage and hashes while adding checked durable ownership fields', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
        },
      },
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
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
          staleClaimRejected: false,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
      },
    },
  });
});

test('checked recovery inspect evidence carries authoritative stale-claim fencing from the checked db journal summary', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
        },
      },
    },
    true,
    false,
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
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
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'wpdb-single-statement-cas',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
      },
    },
  });
});

test('checked recovery inspect evidence carries authoritative checked storage guard from the db journal summary', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
          storageGuard: {
            boundary: 'local-fixture-write',
            operation: 'append',
            outcome: 'fixture-only',
          },
        },
      },
    },
    true,
    false,
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
      latestRows: [
        {
          event: 'apply-committed',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'update',
              outcome: 'applied',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 14 },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
        latestRows: [
          {
            event: 'apply-committed',
            result: {
              storageGuard: {
                boundary: 'wpdb-single-statement-cas',
                operation: 'update',
                outcome: 'applied',
              },
            },
          },
        ],
        eventSummaries: [
          { event: 'apply-committed', count: 1, latestId: 14 },
        ],
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
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'wpdb-single-statement-cas',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
  });
});

test('checked recovery inspect evidence injects the full checked durable journal contract when inline recovery journal evidence is absent', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        status: 'blocked-recovery',
      },
    },
    true,
    false,
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
      latestRows: [
        {
          event: 'stale-claim-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'compare-and-swap',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    recovery: {
      status: 'blocked-recovery',
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        acceptedOnCheckedBoundary: true,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        latestRows: [
          {
            event: 'stale-claim-rejected',
            result: {
              storageGuard: {
                boundary: 'wpdb-single-statement-cas',
                operation: 'compare-and-swap',
                outcome: 'precondition-failed',
              },
            },
          },
        ],
        eventSummaries: [
          { event: 'stale-claim-rejected', count: 1, latestId: 33 },
        ],
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
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'wpdb-single-statement-cas',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'compare-and-swap',
          outcome: 'precondition-failed',
        },
      },
    },
  });
});

test('checked recovery inspect evidence fills nested checked counters and summary arrays from the authoritative db journal summary', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'fixture-scoped recovery inspect journal evidence; not production durability',
          },
          scope: 'local Playground fixture only; not production durability',
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
          acceptedOnCheckedBoundary: true,
          rowCount: 0,
          applyCommitted: false,
          mutationApplied: 0,
          idempotencyOpened: 0,
          latestRows: [
            { event: 'apply-committed', id: 3 },
          ],
          eventSummaries: [
            { event: 'apply-committed', count: 1, latestId: 3 },
          ],
          idempotencyEvidence: [
            { idempotencyKeyHash: 'idem-hash-01', events: 1, requestHashes: 1, latestId: 3 },
          ],
        },
      },
    },
    true,
    false,
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 3,
      applyCommitted: true,
      mutationApplied: 1,
      idempotencyOpened: 1,
      latestRows: [
        { event: 'idempotency-opened', id: 1 },
        { event: 'mutation-applied', id: 2 },
        { event: 'apply-committed', id: 3 },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 3 },
        { event: 'mutation-applied', count: 1, latestId: 2 },
        { event: 'idempotency-opened', count: 1, latestId: 1 },
      ],
      idempotencyEvidence: [
        { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
        { idempotencyKeyHash: 'idem-hash-02', events: 1, requestHashes: 1, latestId: 4 },
      ],
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 3,
        applyCommitted: true,
        mutationApplied: 1,
        idempotencyOpened: 1,
        latestRows: [
          { event: 'idempotency-opened', id: 1 },
          { event: 'mutation-applied', id: 2 },
          { event: 'apply-committed', id: 3 },
        ],
        eventSummaries: [
          { event: 'apply-committed', count: 1, latestId: 3 },
          { event: 'mutation-applied', count: 1, latestId: 2 },
          { event: 'idempotency-opened', count: 1, latestId: 1 },
        ],
        idempotencyEvidence: [
          { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
          { idempotencyKeyHash: 'idem-hash-02', events: 1, requestHashes: 1, latestId: 4 },
        ],
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
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
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'wpdb-single-statement-cas',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
      },
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

test('checked authenticated apply evidence is upgraded to the authoritative db journal contract', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production plugin journal surface; not local Playground fixture only',
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
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
    latestRows: [
      {
        event: 'apply-committed',
        result: {
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
        },
      },
    ],
    eventSummaries: [
      { event: 'apply-committed', count: 1, latestId: 14 },
    ],
  };
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        event: 'apply-replayed',
        sequence: 15,
        scope: 'local Playground fixture only',
      },
      storageGuard: {
        boundary: 'local-fixture-write',
        operation: 'append',
        outcome: 'fixture-only',
      },
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    dbJournal: {
      event: 'apply-replayed',
      sequence: 15,
      scope: 'packaged production plugin journal surface; not local Playground fixture only',
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
      latestRows: [
        {
          event: 'apply-committed',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'update',
              outcome: 'applied',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'apply-committed', count: 1, latestId: 14 },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
  });
});

test('authenticated apply finalization upgrades checked failure journal evidence and preserves signed auth metadata', { skip: !hasPhp }, () => {
  const result = runFinalizeAuthenticatedApplyResult(
    {
      ok: false,
      code: 'PRECONDITION_FAILED',
      message: 'Apply failed on a checked production-shaped boundary.',
      dbJournal: {
        event: 'apply-rejected',
        sequence: 18,
        scope: 'local Playground fixture only',
      },
      storageGuard: {
        boundary: 'local-fixture-write',
        operation: 'append',
        outcome: 'fixture-only',
      },
    },
    {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'POST',
        path: '/wp-json/reprint/v1/push/apply',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    code: 'PRECONDITION_FAILED',
    message: 'Apply failed on a checked production-shaped boundary.',
    dbJournal: {
      event: 'apply-rejected',
      sequence: 18,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
        staleClaimRejected: false,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: false,
        },
      },
      latestRows: [
        {
          event: 'apply-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'compare-and-swap',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'apply-rejected', count: 1, latestId: 18 },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'compare-and-swap',
        outcome: 'precondition-failed',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'compare-and-swap',
      outcome: 'precondition-failed',
    },
    responseSchemaVersion: 1,
    auth: {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    signedRequest: {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'POST',
        path: '/wp-json/reprint/v1/push/apply',
      },
    },
  });
});

test('authenticated apply finalization injects checked db journal contract when a checked failure had no inline journal evidence', { skip: !hasPhp }, () => {
  const result = runFinalizeAuthenticatedApplyResult(
    {
      ok: false,
      code: 'AUTH_RECEIPT_EXPIRED',
      message: 'Signed apply receipt expired before the checked apply could start.',
    },
    {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'POST',
        path: '/wp-json/reprint/v1/push/apply',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    code: 'AUTH_RECEIPT_EXPIRED',
    message: 'Signed apply receipt expired before the checked apply could start.',
    dbJournal: {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
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
        staleClaimRejected: false,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: false,
        },
      },
      latestRows: [
        {
          event: 'apply-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'compare-and-swap',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'apply-rejected', count: 1, latestId: 18 },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'compare-and-swap',
        outcome: 'precondition-failed',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'compare-and-swap',
      outcome: 'precondition-failed',
    },
    responseSchemaVersion: 1,
    auth: {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    signedRequest: {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'POST',
        path: '/wp-json/reprint/v1/push/apply',
      },
    },
  });
});

test('authenticated db journal finalization preserves checked journal evidence and adds signed auth metadata', { skip: !hasPhp }, () => {
  const result = runFinalizeAuthenticatedJournalResult(
    {
      ok: true,
      dbJournal: {
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
          staleClaimRejected: false,
        },
      },
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'compare-and-swap',
        outcome: 'committed',
      },
    },
    {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'GET',
        path: '/wp-json/reprint/v1/push/db-journal',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    dbJournal: {
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
        staleClaimRejected: false,
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'compare-and-swap',
      outcome: 'committed',
    },
    responseSchemaVersion: 1,
    auth: {
      schemaVersion: 1,
      scope: 'reprint-push-lab:authenticated-http-push',
      identity: {
        userId: 1,
        userLogin: 'push-admin',
        roles: ['administrator'],
        capabilities: {
          manage_options: true,
        },
      },
      session: {
        id: 'signed-session-token',
        type: 'production-auth-session',
        status: 'active',
        revoked: false,
        cleanedUp: false,
        expiresAt: '2026-05-26T20:00:00Z',
        playgroundFallback: false,
      },
    },
    signedRequest: {
      schemaVersion: 1,
      contentHash: 'abc123',
      timestamp: '2026-05-26T20:00:00Z',
      nonceHash: 'def456',
      sessionHash: 'ghi789',
      signingKeyHash: 'jkl012',
      cleanup: {
        deletedExpiredTotal: 0,
      },
      request: {
        method: 'GET',
        path: '/wp-json/reprint/v1/push/db-journal',
      },
    },
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

test('db journal stale-claim evidence accepts explicit stale-claim-rejected rows and aged summary entries', { skip: !hasPhp }, () => {
  const fromRows = runHasStaleClaimRejectionEvidence([
    { sequence: 41, event: 'stale-claim-rejected' },
  ]);
  assert.equal(fromRows.status, 0, fromRows.stderr);
  assert.equal(JSON.parse(fromRows.stdout), true);

  const fromEventSummaries = runHasStaleClaimRejectionEvidence(
    [
      { sequence: 61, event: 'apply-committed' },
    ],
    [
      { event: 'stale-claim-rejected', count: 1, latestId: 12 },
    ],
  );
  assert.equal(fromEventSummaries.status, 0, fromEventSummaries.stderr);
  assert.equal(JSON.parse(fromEventSummaries.stdout), true);
});

test('db journal writer lease contract preserves observed checked-boundary evidence instead of hard-coding stronger guarantees', { skip: !hasPhp }, () => {
  const result = runWriterLeaseContract({
    staleClaimRejected: true,
    claimKeyUnique: false,
    monotonicSequence: false,
    restartReadable: true,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: false,
    fsyncEvidence: true,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: false,
    restartReadable: true,
    staleClaimRejected: true,
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

test('checked db journal merge corrects stale optimistic booleans to authoritative checked false values when the accepted boundary matches', { skip: !hasPhp }, () => {
  const result = runMerge(
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
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: false,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: false,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
      },
      leaseFence: {
        boundary: 'wpdb-single-statement-cas',
        claimKeyUnique: false,
        fsyncEvidence: true,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: false,
          fsyncEvidence: true,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
        },
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: false,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: false,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: false,
      fsyncEvidence: true,
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: false,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: false,
      },
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
