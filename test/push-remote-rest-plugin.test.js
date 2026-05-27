import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginFile = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const hasPhp = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
const checkedClaimContractOmissionCases = [
  ['claim status', 'claim.status'],
  ['claim active identity', 'claim.activeClaimId'],
  ['claim active claim-key hash', 'claim.activeClaimKeyHash'],
  ['claim active sequence', 'claim.activeClaimSequence'],
  ['claim active event', 'claim.activeClaimEvent'],
  ['claim idempotency-key hash', 'claim.idempotencyKeyHash'],
  ['claim request hash', 'claim.requestHash'],
  ['claim stale-claim rejection flag', 'claim.staleClaimRejected'],
  ['claim previous identity', 'claim.previousClaimId'],
  ['claim previous claim-key hash', 'claim.previousClaimKeyHash'],
  ['claim previous sequence', 'claim.previousClaimSequence'],
  ['claim previous event', 'claim.previousClaimEvent'],
  ['claim previous-started sequence', 'claim.previousStartedSequence'],
  ['claim abandoned sequence', 'claim.abandonedSequence'],
  ['claim abandoned event', 'claim.abandonedEvent'],
];

function deleteNestedProperty(object, propertyPath) {
  const pathSegments = propertyPath.split('.');
  const finalKey = pathSegments.pop();
  let current = object;

  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return;
    }
    current = current[segment];
  }

  if (!current || typeof current !== 'object' || finalKey === undefined) {
    return;
  }

  delete current[finalKey];
}

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

function runClaimScopedStaleClaimRejectionEvidence(summary, claim) {
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
      '$claim = json_decode($argv[3], true);',
      'echo json_encode(reprint_push_lab_db_journal_claim_scoped_stale_claim_rejection_evidence_matches($summary, $claim));',
    ].join(' '),
    pluginFile,
    JSON.stringify(summary),
    JSON.stringify(claim),
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

function runDbJournalClaimSummary(latestClaimRow, latestAbandonedRow = null, previousClaimRow = null, staleClaimRejected = false) {
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
      '$latestClaimRow = json_decode($argv[2], true);',
      '$latestAbandonedRow = json_decode($argv[3], true);',
      '$previousClaimRow = json_decode($argv[4], true);',
      '$staleClaimRejected = ($argv[5] ?? "0") === "1";',
      'echo json_encode(reprint_push_lab_db_journal_claim_summary($latestClaimRow, $latestAbandonedRow, $previousClaimRow, $staleClaimRejected));',
    ].join(' '),
    pluginFile,
    JSON.stringify(latestClaimRow),
    JSON.stringify(latestAbandonedRow),
    JSON.stringify(previousClaimRow),
    staleClaimRejected ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDbJournalClaimEvidenceRow(row) {
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
      '$row = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_db_journal_claim_evidence_row($row));',
    ].join(' '),
    pluginFile,
    JSON.stringify(row),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDbJournalPublicRow(row) {
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
      '$row = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_db_journal_public_row($row));',
    ].join(' '),
    pluginFile,
    JSON.stringify(row),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDbJournalScopeKey(context = {}, packageMode = false, checkedSurface = false) {
  return spawnSync('php', [
    '-r',
    [
      packageMode ? 'define("REPRINT_PUSH_DISABLE_LAB_ROUTES", true); define("REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP", true);' : '',
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
      '$context = json_decode($argv[2], true);',
      '$checkedSurface = ($argv[3] ?? "0") === "1";',
      'echo json_encode(reprint_push_lab_db_journal_scope_key($context, $checkedSurface));',
    ].join(' '),
    pluginFile,
    JSON.stringify(context),
    checkedSurface ? '1' : '0',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runDbJournalEvidence(entry, packageMode = false) {
  return spawnSync('php', [
    '-r',
    [
      packageMode ? 'define("REPRINT_PUSH_DISABLE_LAB_ROUTES", true); define("REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP", true);' : '',
      'define("ABSPATH", dirname($argv[1]));',
      '$GLOBALS["wpdb"] = (object) ["prefix" => "wp_"];',
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
      '$entry = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_rest_db_journal_evidence($entry));',
    ].join(' '),
    pluginFile,
    JSON.stringify(entry),
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
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 18,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
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
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 18,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
      },
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
  claimKeyHash = null,
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
      '$claimKeyHash = ($argv[6] ?? "") !== "" ? $argv[6] : null;',
      'echo json_encode(reprint_push_lab_db_journal_writer_lease_contract($staleClaimRejected, $claimKeyUnique, $monotonicSequence, $restartReadable, null, $claimKeyHash));',
    ].join(' '),
    pluginFile,
    staleClaimRejected ? '1' : '0',
    claimKeyUnique ? '1' : '0',
    monotonicSequence ? '1' : '0',
    restartReadable ? '1' : '0',
    claimKeyHash ?? '',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runCheckedBoundaryContract({
  checkedSurface = true,
  staleClaimRejected = false,
  claimKeyUnique = true,
  monotonicSequence = true,
  restartReadable = true,
  claimId = null,
  claimKeyHash = null,
} = {}) {
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
      '$checkedSurface = ($argv[2] ?? "1") === "1";',
      '$staleClaimRejected = ($argv[3] ?? "0") === "1";',
      '$claimKeyUnique = ($argv[4] ?? "1") === "1";',
      '$monotonicSequence = ($argv[5] ?? "1") === "1";',
      '$restartReadable = ($argv[6] ?? "1") === "1";',
      '$claimId = ($argv[7] ?? "") !== "" ? $argv[7] : null;',
      '$claimKeyHash = ($argv[8] ?? "") !== "" ? $argv[8] : null;',
      'echo json_encode(reprint_push_lab_db_journal_checked_boundary_contract(',
      '  $checkedSurface,',
      '  $staleClaimRejected,',
      '  $claimKeyUnique,',
      '  $monotonicSequence,',
      '  $restartReadable,',
      '  $claimId,',
      '  $claimKeyHash',
      '));',
    ].join(' '),
    pluginFile,
    checkedSurface ? '1' : '0',
    staleClaimRejected ? '1' : '0',
    claimKeyUnique ? '1' : '0',
    monotonicSequence ? '1' : '0',
    restartReadable ? '1' : '0',
    claimId ?? '',
    claimKeyHash ?? '',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runCheckedBoundaryContractMatches(journal) {
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
      '$journal = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_db_journal_checked_boundary_contract_matches($journal));',
    ].join(' '),
    pluginFile,
    JSON.stringify(journal),
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

function runMirrorCheckedRecoveryContract(recovery) {
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
      '$recovery = json_decode($argv[2], true);',
      'echo json_encode(reprint_push_lab_rest_mirror_checked_recovery_contract($recovery));',
    ].join(' '),
    pluginFile,
    JSON.stringify(recovery),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function buildAcceptedInlineRecoveryJournal() {
  return {
    integrity: {
      schemaVersion: 1,
      status: 'ok',
      scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
    },
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    applyCommitted: 0,
    mutationApplied: 0,
    idempotencyOpened: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: 'retry-claim-hash-02',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimId: 'retry-claim-hash-01',
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 33,
        claimId: 'retry-claim-hash-02',
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 24,
        claimId: 'retry-claim-hash-01',
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:19',
        claimCursor: 'db-journal:18',
      },
      previousRow: {
        sequence: 18,
        claimId: 'retry-claim-hash-01',
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: 'retry-claim-hash-02',
      claimKeyHash: 'retry-claim-hash-02',
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
        claimId: 'retry-claim-hash-02',
        claimKeyHash: 'retry-claim-hash-02',
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
    latestRows: [
      {
        id: 33,
        event: 'stale-claim-rejected',
        claimId: 'retry-claim-hash-02',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
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
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idem-hash-01',
        events: 1,
        requestHashes: 1,
        latestId: 33,
      },
    ],
  };
}

function buildCheckedRecoveryJournalSummary() {
  return {
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    applyCommitted: 0,
    mutationApplied: 0,
    idempotencyOpened: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: 'retry-claim-hash-02',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimId: 'retry-claim-hash-01',
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 33,
        claimId: 'retry-claim-hash-02',
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 24,
        claimId: 'retry-claim-hash-01',
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:19',
        claimCursor: 'db-journal:18',
      },
      previousRow: {
        sequence: 18,
        claimId: 'retry-claim-hash-01',
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: 'retry-claim-hash-02',
      claimKeyHash: 'retry-claim-hash-02',
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
        claimId: 'retry-claim-hash-02',
        claimKeyHash: 'retry-claim-hash-02',
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
    latestRows: [
      {
        id: 33,
        event: 'stale-claim-rejected',
        claimId: 'retry-claim-hash-02',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
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
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idem-hash-01',
        events: 1,
        requestHashes: 1,
        latestId: 33,
      },
    ],
  };
}

function buildAcceptedInlineDbJournal() {
  return {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: 'authoritative-claim-hash-02',
      activeClaimKeyHash: 'authoritative-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimId: 'retry-claim-hash-01',
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 33,
        claimId: 'authoritative-claim-hash-02',
        event: 'stale-claim-rejected',
        claimKeyHash: 'authoritative-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 24,
        claimId: 'retry-claim-hash-01',
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:19',
        claimCursor: 'db-journal:18',
      },
      previousRow: {
        sequence: 18,
        claimId: 'retry-claim-hash-01',
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: 'authoritative-claim-hash-02',
      claimKeyHash: 'authoritative-claim-hash-02',
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
        claimId: 'authoritative-claim-hash-02',
        claimKeyHash: 'authoritative-claim-hash-02',
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
    latestRows: [
      {
        sequence: 33,
        event: 'stale-claim-rejected',
        claimId: 'authoritative-claim-hash-02',
        claimKeyHash: 'authoritative-claim-hash-02',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 33,
      },
    ],
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idem-hash-01',
        events: 1,
        requestHashes: 1,
        latestId: 33,
      },
    ],
  };
}

function buildCheckedDbJournalSummary() {
  return structuredClone(buildAcceptedInlineDbJournal());
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
        supportedSurface: 'claim-fenced-restart-readable',
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
      supportedSurface: 'claim-fenced-restart-readable',
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

test('checked db journal merge fails closed when the authoritative summary omits explicit claim identity', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
        supportedSurface: 'claim-fenced-restart-readable',
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'wpdb-single-statement-cas',
      },
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 20,
        activeClaimEvent: 'stale-claim-retry-started',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 18,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 12,
        previousClaimSequence: 11,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimEvent: 'idempotency-opened',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: false,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
  });
});

test('checked recovery inspect evidence fails closed when the authoritative checked summary omits explicit claim identity', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.claim.activeClaimId;
  delete checkedSummary.claim.previousClaimId;
  delete checkedSummary.claimEvidence.activeRow.claimId;
  delete checkedSummary.claimEvidence.abandonedRow.claimId;
  delete checkedSummary.claimEvidence.previousRow.claimId;
  delete checkedSummary.writerLease.claimId;
  delete checkedSummary.leaseFence.writerLease.claimId;
  delete checkedSummary.latestRows[0].claimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim.activeClaimId, undefined);
  assert.equal(parsed.recovery.journal.claimEvidence.activeRow.claimId, undefined);
  assert.equal(parsed.recovery.journal.latestRows[0].claimId, undefined);
  assert.equal(parsed.recovery.journal.writerLease.claimId, 'retry-claim-hash-02');
  assert.equal(parsed.recovery.journal.leaseFence.writerLease.claimId, 'retry-claim-hash-02');
});

test('checked db journal attachment fails closed when authoritative claim evidence omits previously accepted claim lineage', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.claimEvidence.abandonedRow.claimId;
  delete checkedSummary.claimEvidence.previousRow.claimId;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimId, undefined);
  assert.equal(parsed.dbJournal.claimEvidence.previousRow.claimId, undefined);
});

test('checked db journal attachment fails closed when authoritative claim evidence omits the abandoned-row claim-key lineage', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.claimEvidence.abandonedRow.claimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimKeyHash, undefined);
});

test('checked db journal attachment fails closed when authoritative claim evidence drifts the abandoned-row claim-key lineage', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.claimEvidence.abandonedRow.claimKeyHash = 'wrong-previous-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimKeyHash, 'wrong-previous-claim-key-hash');
});

test('checked db journal attachment fails closed when authoritative latest rows omit previously accepted stale-claim lineage', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.latestRows = [
    ...inlineJournal.latestRows,
    {
      sequence: 24,
      event: 'stale-claim-abandoned',
      claimId: 'retry-claim-hash-01',
      claimKeyHash: 'retry-claim-hash-01',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  ];

  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.latestRows = [
    ...checkedSummary.latestRows,
    {
      sequence: 24,
      event: 'stale-claim-abandoned',
      claimKeyHash: 'retry-claim-hash-01',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  ];

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.latestRows[1].claimId, 'retry-claim-hash-01');
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
        schemaVersion: 1,
        acceptedOnCheckedBoundary: false,
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
        schemaVersion: 1,
        acceptedOnCheckedBoundary: false,
        scope: 'packaged production journal scope',
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
        schemaVersion: 1,
        acceptedOnCheckedBoundary: false,
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
        schemaVersion: 1,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
        acceptedOnCheckedBoundary: false,
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
      schemaVersion: 1,
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
        schemaVersion: 1,
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
        acceptedOnCheckedBoundary: false,
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

test('checked recovery inspect evidence mirrors the accepted checked contract onto top-level recovery fields when wrappers are missing or invalid', { skip: !hasPhp }, () => {
  const acceptedJournal = buildAcceptedInlineRecoveryJournal();
  const result = runMirrorCheckedRecoveryContract({
    journal: acceptedJournal,
    claim: {},
    leaseFence: {},
    writerLease: {},
    ownership: {},
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.journal.acceptedOnCheckedBoundary, true);
  assert.deepEqual(parsed.ownership, acceptedJournal.ownership);
  assert.deepEqual(parsed.writerLease, acceptedJournal.writerLease);
  assert.deepEqual(parsed.claim, acceptedJournal.claim);
  assert.deepEqual(parsed.leaseFence, acceptedJournal.leaseFence);
});

test('checked recovery inspect evidence replaces structurally valid top-level recovery wrappers when they diverge from the accepted checked claim identity', { skip: !hasPhp }, () => {
  const acceptedJournal = buildAcceptedInlineRecoveryJournal();
  const result = runMirrorCheckedRecoveryContract({
    journal: acceptedJournal,
    claim: {
      ...acceptedJournal.claim,
      activeClaimId: 'stale-claim-id',
      activeClaimKeyHash: 'stale-claim-key-hash',
      previousClaimId: 'stale-previous-claim-id',
      previousClaimKeyHash: 'stale-previous-claim-key-hash',
    },
    writerLease: {
      ...acceptedJournal.writerLease,
      claimId: 'stale-claim-id',
      claimKeyHash: 'stale-claim-key-hash',
    },
    leaseFence: {
      ...acceptedJournal.leaseFence,
      writerLease: {
        ...acceptedJournal.leaseFence.writerLease,
        claimId: 'stale-claim-id',
        claimKeyHash: 'stale-claim-key-hash',
      },
    },
    ownership: {
      ...acceptedJournal.ownership,
      productionAdapter: 'fixture-storage-guard',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.ownership, acceptedJournal.ownership);
  assert.deepEqual(parsed.claim, acceptedJournal.claim);
  assert.deepEqual(parsed.writerLease, acceptedJournal.writerLease);
  assert.deepEqual(parsed.leaseFence, acceptedJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when checked storage-guard evidence omits a coherent claim-scoped checked journal contract', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.latestRows = [
    {
      id: 14,
      event: 'apply-committed',
      result: {
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
  ];
  checkedSummary.eventSummaries = [
    { event: 'apply-committed', count: 1, latestId: 14 },
  ];

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
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.storage, 'wp-options+journal-evidence');
  assert.equal(parsed.recovery.journal.planHash, 'plan-hash-123');
  assert.equal(parsed.recovery.journal.receiptHash, 'receipt-hash-456');
  assert.deepEqual(parsed.recovery.journal.latestRows, checkedSummary.latestRows);
  assert.deepEqual(parsed.recovery.journal.eventSummaries, checkedSummary.eventSummaries);
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
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
      schemaVersion: 1,
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
          id: 33,
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
        schemaVersion: 1,
        acceptedOnCheckedBoundary: false,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        latestRows: [
          {
            id: 33,
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

test('checked recovery inspect evidence preserves a stronger existing checked scope with negated fixture wording', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'production recovery inspect journal evidence from external durable adapter; not local Playground fixture only',
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
          scope: 'production recovery inspect journal evidence from external durable adapter; not local Playground fixture only',
        },
        schemaVersion: 1,
        acceptedOnCheckedBoundary: false,
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
    },
  });
});

test('checked recovery inspect evidence still merges the checked durable journal contract when inline recovery journal integrity is missing but keeps rejected retry lineage closed', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        status: 'blocked-recovery',
        journal: {
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
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    recovery: {
      status: 'blocked-recovery',
      journal: {
        integrity: {
          schemaVersion: 1,
          status: 'ok',
          scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
        },
        storage: 'wp-options+journal-evidence',
        planHash: 'plan-hash-123',
        receiptHash: 'receipt-hash-456',
        acceptedOnCheckedBoundary: false,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        latestRows: [
          {
            id: 33,
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

test('checked recovery inspect evidence fails closed on partial checked journal claim contracts', { skip: !hasPhp }, () => {
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
        },
      },
    },
    true,
    false,
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
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
      latestRows: [
        {
          id: 33,
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
        acceptedOnCheckedBoundary: false,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
        },
        latestRows: [
          {
            id: 33,
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

test('checked recovery inspect evidence fails closed when accepted checked journals omit restart artifact references', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
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
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          claimEvidence: {
            activeRow: {
              sequence: 33,
              event: 'stale-claim-rejected',
              claimKeyHash: 'retry-claim-hash-02',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
            },
            abandonedRow: {
              sequence: 24,
              event: 'stale-claim-abandoned',
              claimKeyHash: 'retry-claim-hash-01',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
              startedCursor: 'db-journal:19',
              claimCursor: 'db-journal:18',
            },
            previousRow: {
              sequence: 18,
              event: 'idempotency-opened',
              claimKeyHash: 'retry-claim-hash-01',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
            },
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
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 2,
          latestRows: [
            { event: 'apply-committed', id: 24 },
            { event: 'stale-claim-rejected', id: 33 },
          ],
          eventSummaries: [
            { event: 'apply-committed', count: 1, latestId: 24 },
            { event: 'stale-claim-rejected', count: 1, latestId: 33 },
          ],
        },
      },
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.ownership.restartReadable, true);
  assert.equal(parsed.recovery.journal.storage, undefined);
  assert.equal(parsed.recovery.journal.planHash, undefined);
  assert.equal(parsed.recovery.journal.receiptHash, undefined);
});

test('checked recovery inspect evidence fails closed when accepted checked journals preserve non-ok integrity status', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'corrupt',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          claimEvidence: {
            activeRow: {
              sequence: 33,
              event: 'stale-claim-rejected',
              claimKeyHash: 'retry-claim-hash-02',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
            },
            abandonedRow: {
              sequence: 24,
              event: 'stale-claim-abandoned',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
              startedCursor: 'db-journal:19',
              claimCursor: 'db-journal:18',
            },
            previousRow: {
              sequence: 18,
              event: 'idempotency-opened',
              claimKeyHash: 'retry-claim-hash-01',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
            },
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
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 2,
          latestRows: [
            { event: 'apply-committed', id: 24 },
            { event: 'stale-claim-rejected', id: 33 },
          ],
          eventSummaries: [
            { event: 'apply-committed', count: 1, latestId: 24 },
            { event: 'stale-claim-rejected', count: 1, latestId: 33 },
          ],
        },
      },
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.integrity.status, 'corrupt');
  assert.equal(parsed.recovery.journal.storage, 'wp-options+journal-evidence');
  assert.equal(parsed.recovery.journal.planHash, 'plan-hash-123');
  assert.equal(parsed.recovery.journal.receiptHash, 'receipt-hash-456');
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline restart artifact refs', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.storage = 'inline-restart-storage';
  inlineJournal.planHash = 'inline-plan-hash';
  inlineJournal.receiptHash = 'inline-receipt-hash';

  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.storage = 'checked-restart-storage';
  checkedSummary.planHash = 'checked-plan-hash';
  checkedSummary.receiptHash = 'checked-receipt-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.storage, 'inline-restart-storage');
  assert.equal(parsed.recovery.journal.planHash, 'inline-plan-hash');
  assert.equal(parsed.recovery.journal.receiptHash, 'inline-receipt-hash');
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted restart artifact refs', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.storage = 'inline-restart-storage';
  inlineJournal.planHash = 'inline-plan-hash';
  inlineJournal.receiptHash = 'inline-receipt-hash';

  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.storage;
  delete checkedSummary.planHash;
  delete checkedSummary.receiptHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.storage, 'inline-restart-storage');
  assert.equal(parsed.recovery.journal.planHash, 'inline-plan-hash');
  assert.equal(parsed.recovery.journal.receiptHash, 'inline-receipt-hash');
});

test('checked recovery inspect evidence fails closed when accepted checked summaries omit the checked-boundary marker', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
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
          storage: 'wp-options+journal-evidence',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
        },
      },
    },
    true,
    false,
    {
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed on partial checked writer-lease contracts', { skip: !hasPhp }, () => {
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
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.writerLease.storageGuard, undefined);
  assert.equal(parsed.recovery.journal.leaseFence.writerLease.storageGuard, 'wpdb-single-statement-cas');
});

test('checked recovery inspect evidence fails closed when accepted checked summaries still claim fixture scope', { skip: !hasPhp }, () => {
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
      scope: 'local Playground fixture only; not production durability',
      schemaVersion: 1,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.scope, 'local Playground fixture only; not production durability');
});

test('checked recovery inspect evidence fails closed when accepted checked summaries still omit claim identity entirely', { skip: !hasPhp }, () => {
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
      latestRows: [
        {
          event: 'stale-claim-rejected',
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
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim, undefined);
});

test('checked recovery inspect evidence fails closed when accepted inline writer-lease claim identity diverges from the checked claim', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.writerLease.claimId = 'different-active-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed on conflicting checked writer-lease storage guards', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'active',
            activeClaimKeyHash: 'claim-hash-01',
            activeClaimSequence: 18,
            activeClaimEvent: 'idempotency-opened',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: false,
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
              storageGuard: 'mysql-advisory-lock-lease',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: false,
            },
          },
        },
      },
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.writerLease.storageGuard, 'wpdb-single-statement-cas');
  assert.equal(parsed.recovery.journal.leaseFence.writerLease.storageGuard, 'mysql-advisory-lock-lease');
});

test('checked recovery inspect evidence fails closed on conflicting checked journal claim lineage', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'inline-claim-hash-01',
            activeClaimSequence: 28,
            activeClaimEvent: 'stale-claim-retry-started',
            idempotencyKeyHash: 'idem-hash-inline',
            requestHash: 'request-hash-inline',
            staleClaimRejected: true,
            previousClaimKeyHash: 'inline-prev-claim-hash-00',
            previousClaimSequence: 19,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
          },
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.claim, {
    status: 'stale-claim-rejected',
    activeClaimKeyHash: 'authoritative-claim-hash-02',
    activeClaimSequence: 33,
    activeClaimEvent: 'stale-claim-rejected',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    staleClaimRejected: true,
    abandonedSequence: 24,
    abandonedEvent: 'stale-claim-abandoned',
    previousStartedSequence: 19,
    previousClaimKeyHash: 'retry-claim-hash-01',
    previousClaimSequence: 18,
    previousClaimEvent: 'idempotency-opened',
  });
});

test('checked recovery inspect evidence fails closed on stale-claim drift between claim and lease contracts', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'claim-hash-01',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            previousClaimKeyHash: 'claim-hash-00',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim.staleClaimRejected, true);
  assert.equal(parsed.recovery.journal.writerLease.staleClaimRejected, false);
  assert.equal(parsed.recovery.journal.leaseFence.staleClaimRejected, false);
});

test('checked recovery inspect evidence fails closed on conflicting accepted ownership restart-readable drift', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'claim-hash-01',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            previousClaimKeyHash: 'claim-hash-00',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
            previousStartedSequence: 19,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: false,
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
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          latestRows: [
            {
              event: 'stale-claim-rejected',
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
            { event: 'stale-claim-rejected', count: 1, latestId: 33 },
          ],
        },
      },
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.ownership.restartReadable, false);
  assert.equal(parsed.recovery.journal.writerLease.restartReadable, true);
  assert.equal(parsed.recovery.journal.leaseFence.restartReadable, true);
});

test('checked recovery inspect evidence fails closed on conflicting checked claim event state', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'active',
            activeClaimKeyHash: 'claim-hash-01',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: false,
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
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim.status, 'active');
  assert.equal(parsed.recovery.journal.claim.activeClaimEvent, 'stale-claim-rejected');
});

test('checked recovery inspect evidence fails closed on unsupported checked claim events', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'active',
            activeClaimKeyHash: 'claim-hash-01',
            activeClaimSequence: 33,
            activeClaimEvent: 'unsupported-claim-event',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: false,
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
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim.activeClaimEvent, 'unsupported-claim-event');
});

test('checked recovery inspect evidence fails closed on missing consumed stale-retry claim identities', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'claim-hash-02',
            activeClaimSequence: 34,
            activeClaimEvent: 'stale-claim-retry-started',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            previousClaimKeyHash: 'claim-hash-01',
            previousClaimSequence: 21,
            previousClaimEvent: 'idempotency-opened',
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
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claim.activeClaimEvent, 'stale-claim-retry-started');
  assert.equal(parsed.recovery.journal.claim.previousStartedSequence, undefined);
});

test('checked recovery inspect evidence fails closed when checked counters and summary arrays arrive without a coherent accepted claim contract', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.rowCount = 3;
  checkedSummary.applyCommitted = true;
  checkedSummary.mutationApplied = 1;
  checkedSummary.idempotencyOpened = 1;
  checkedSummary.latestRows = [
    { event: 'idempotency-opened', id: 1 },
    { event: 'mutation-applied', id: 2 },
    { event: 'apply-committed', id: 3 },
  ];
  checkedSummary.eventSummaries = [
    { event: 'apply-committed', count: 1, latestId: 3 },
    { event: 'mutation-applied', count: 1, latestId: 2 },
    { event: 'idempotency-opened', count: 1, latestId: 1 },
  ];
  checkedSummary.idempotencyEvidence = [
    { idempotencyKeyHash: 'idem-hash-01', events: 3, requestHashes: 1, latestId: 3 },
    { idempotencyKeyHash: 'idem-hash-02', events: 1, requestHashes: 1, latestId: 4 },
  ];

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
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.scope, 'local Playground fixture only; not production durability');
  assert.equal(parsed.recovery.journal.rowCount, 0);
  assert.equal(parsed.recovery.journal.applyCommitted, false);
  assert.equal(parsed.recovery.journal.mutationApplied, 0);
  assert.equal(parsed.recovery.journal.idempotencyOpened, 0);
  assert.deepEqual(parsed.recovery.journal.latestRows, checkedSummary.latestRows);
  assert.deepEqual(parsed.recovery.journal.eventSummaries, checkedSummary.eventSummaries);
  assert.deepEqual(parsed.recovery.journal.idempotencyEvidence, [
    { idempotencyKeyHash: 'idem-hash-01', events: 1, requestHashes: 1, latestId: 3 },
  ]);
});

test('checked recovery inspect evidence fails closed when accepted checked summaries still omit meaningful persisted event evidence', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
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
        sequence: 20,
      },
    ],
    eventSummaries: [
      {
        count: 1,
        latestId: 20,
      },
    ],
  };
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          claim: checkedSummary.claim,
          ownership: checkedSummary.ownership,
          writerLease: checkedSummary.writerLease,
          leaseFence: checkedSummary.leaseFence,
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          latestRows: checkedSummary.latestRows,
          eventSummaries: checkedSummary.eventSummaries,
        },
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when accepted checked summaries still omit meaningful idempotency evidence', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
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
        id: 20,
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
    idempotencyEvidence: [],
  };
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          claim: checkedSummary.claim,
          claimEvidence: checkedSummary.claimEvidence,
          ownership: checkedSummary.ownership,
          writerLease: checkedSummary.writerLease,
          leaseFence: checkedSummary.leaseFence,
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          latestRows: checkedSummary.latestRows,
          eventSummaries: checkedSummary.eventSummaries,
          idempotencyEvidence: checkedSummary.idempotencyEvidence,
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
        },
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit claim-scoped idempotency evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.idempotencyEvidence = [
    {
      idempotencyKeyHash: 'other-idempotency-hash-99',
      events: 1,
      requestHashes: 1,
      latestId: 40,
    },
  ];

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'other-idempotency-hash-99',
      events: 1,
      requestHashes: 1,
      latestId: 40,
    },
  ]);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted event and idempotency counters', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.eventSummaries[0].latestId;
  delete checkedSummary.idempotencyEvidence[0].requestHashes;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted top-level counters', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.rowCount;
  delete checkedSummary.applyCommitted;
  delete checkedSummary.mutationApplied;
  delete checkedSummary.idempotencyOpened;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted top-level identity anchors', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.schemaVersion;
  delete checkedSummary.table;
  delete checkedSummary.scope;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.schemaVersion, inlineJournal.schemaVersion);
  assert.equal(parsed.recovery.journal.table, inlineJournal.table);
  assert.equal(parsed.recovery.journal.scope, inlineJournal.scope);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries conflict on accepted top-level identity fields', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.schemaVersion = 2;
  checkedSummary.table = 'wp_conflicting_push_journal';
  checkedSummary.scope = 'conflicting checked journal scope';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.schemaVersion, 1);
  assert.equal(parsed.recovery.journal.table, 'wp_reprint_push_lab_push_journal');
  assert.equal(parsed.recovery.journal.scope, 'checked live production-shaped journal surface; not local Playground fixture only');
});

for (const [label, propertyPath] of checkedClaimContractOmissionCases) {
  test(`checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted ${label}`, { skip: !hasPhp }, () => {
    const checkedSummary = buildCheckedRecoveryJournalSummary();
    deleteNestedProperty(checkedSummary, propertyPath);

    const result = runAttachCheckedRecoveryJournalEvidence(
      {
        recovery: {
          journal: buildAcceptedInlineRecoveryJournal(),
        },
      },
      true,
      false,
      checkedSummary,
    );

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  });
}

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.claimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.claimKeyHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.writerLease.claimKeyHash, 'retry-claim-hash-02');
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease storage guard', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.storageGuard;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease strategy', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.strategy;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease claim-key uniqueness', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease fsync evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease monotonic sequencing', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted writer-lease stale-claim rejection flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimKeyHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.leaseFence.writerLease.claimKeyHash, 'retry-claim-hash-02');
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries conflict on accepted writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.writerLease.claimId = 'conflicting-authoritative-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries conflict on accepted writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.writerLease.claimKeyHash = 'conflicting-authoritative-claim-key-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries conflict on accepted nested writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.leaseFence.writerLease.claimId = 'conflicting-authoritative-nested-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries conflict on accepted nested writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.leaseFence.writerLease.claimKeyHash = 'conflicting-authoritative-nested-claim-key-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted ownership supported surface', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.supportedSurface;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted ownership restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted ownership production adapter', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.productionAdapter;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted ownership owns-journal flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.ownsJournal;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence claim-key uniqueness', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence fsync evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence monotonic sequencing', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: buildAcceptedInlineRecoveryJournal() } },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence stale-claim rejection flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted lease-fence boundary', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.boundary;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease storage guard', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.storageGuard;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease strategy', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.strategy;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease claim-key uniqueness', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease fsync evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease monotonic sequencing', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease stale-claim rejection flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: buildAcceptedInlineRecoveryJournal(),
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
});

test('checked recovery inspect evidence fails closed when accepted checked summaries preserve mismatched idempotency lineage', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    schemaVersion: 1,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
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
    latestRows: [
      {
        event: 'stale-claim-rejected',
        id: 20,
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-other',
        events: 2,
        requestHashes: 1,
        latestId: 20,
      },
    ],
  };
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          claim: checkedSummary.claim,
          claimEvidence: checkedSummary.claimEvidence,
          ownership: checkedSummary.ownership,
          writerLease: checkedSummary.writerLease,
          leaseFence: checkedSummary.leaseFence,
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'update',
            outcome: 'applied',
          },
          latestRows: checkedSummary.latestRows,
          eventSummaries: checkedSummary.eventSummaries,
          idempotencyEvidence: checkedSummary.idempotencyEvidence,
          storage: 'wp-options+journal-evidence',
          planHash: 'plan-hash-123',
          receiptHash: 'receipt-hash-456',
        },
      },
    },
    true,
    false,
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
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

test('db journal scope key follows the checked route profile and packaged mode', { skip: !hasPhp }, () => {
  const checkedRoute = runDbJournalScopeKey({ routeProfile: 'production-shaped' });
  assert.equal(checkedRoute.status, 0, checkedRoute.stderr);
  assert.equal(JSON.parse(checkedRoute.stdout), 'checked-live-production-shaped');

  const checkedSurface = runDbJournalScopeKey({}, false, true);
  assert.equal(checkedSurface.status, 0, checkedSurface.stderr);
  assert.equal(JSON.parse(checkedSurface.stdout), 'checked-live-production-shaped');

  const packaged = runDbJournalScopeKey({ routeProfile: 'production-shaped' }, true);
  assert.equal(packaged.status, 0, packaged.stderr);
  assert.equal(JSON.parse(packaged.stdout), 'packaged-production-plugin');
});

test('db journal evidence exposes checked and packaged scope labels instead of collapsing to fixture-only', { skip: !hasPhp }, () => {
  const checked = runDbJournalEvidence({
    event: 'apply-committed',
    sequence: 8,
    labScope: 'checked-live-production-shaped',
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout), {
    table: 'wp_reprint_push_lab_push_journal',
    cursor: 'db-journal:8',
    event: 'apply-committed',
    sequence: 8,
    idempotencyKeyHash: '',
    requestHash: '',
    resultHash: '',
    scope: 'checked live production-shaped journal evidence; not local Playground fixture only',
  });

  const packaged = runDbJournalEvidence({
    event: 'apply-committed',
    sequence: 9,
    labScope: 'packaged-production-plugin',
  }, true);
  assert.equal(packaged.status, 0, packaged.stderr);
  assert.deepEqual(JSON.parse(packaged.stdout), {
    table: 'wp_reprint_push_lab_push_journal',
    cursor: 'db-journal:9',
    event: 'apply-committed',
    sequence: 9,
    idempotencyKeyHash: '',
    requestHash: '',
    resultHash: '',
    scope: 'packaged production journal evidence; not local Playground fixture only',
  });
});

test('db journal claim summary preserves active and previous claim identity for stale retries', { skip: !hasPhp }, () => {
  const result = runDbJournalClaimSummary(
    {
      claimId: 'retry-claim-id-02',
      sequence: 20,
      event: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      claimKeyHash: 'retry-claim-hash-02',
    },
    {
      sequence: 18,
      event: 'stale-claim-abandoned',
      resourceHashEvidence: {
        claimCursor: 'db-journal:11',
        startedCursor: 'db-journal:12',
      },
    },
    {
      claimId: 'retry-claim-id-01',
      sequence: 11,
      event: 'idempotency-opened',
      claimKeyHash: 'retry-claim-hash-01',
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'stale-claim-rejected',
    activeClaimId: 'retry-claim-id-02',
    activeClaimKeyHash: 'retry-claim-hash-02',
    activeClaimSequence: 20,
    activeClaimEvent: 'stale-claim-retry-started',
    idempotencyKeyHash: 'idempotency-hash-01',
    requestHash: 'request-hash-01',
    staleClaimRejected: true,
    abandonedSequence: 18,
    abandonedEvent: 'stale-claim-abandoned',
    previousStartedSequence: 12,
    previousClaimId: 'retry-claim-id-01',
    previousClaimSequence: 11,
    previousClaimKeyHash: 'retry-claim-hash-01',
    previousClaimEvent: 'idempotency-opened',
  });
});

test('db journal claim summary omits synthesized checked-surface claim ids when persisted claim_id is missing', { skip: !hasPhp }, () => {
  const result = runDbJournalClaimSummary(
    {
      sequence: 20,
      event: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      claimKeyHash: 'retry-claim-hash-02',
      labScope: 'checked-live-production-shaped',
    },
    {
      sequence: 18,
      event: 'stale-claim-abandoned',
      resourceHashEvidence: {
        claimCursor: 'db-journal:11',
        startedCursor: 'db-journal:12',
      },
      labScope: 'checked-live-production-shaped',
    },
    {
      sequence: 11,
      event: 'idempotency-opened',
      claimKeyHash: 'retry-claim-hash-01',
      labScope: 'checked-live-production-shaped',
    },
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'stale-claim-rejected',
    activeClaimId: null,
    activeClaimKeyHash: 'retry-claim-hash-02',
    activeClaimSequence: 20,
    activeClaimEvent: 'stale-claim-retry-started',
    idempotencyKeyHash: 'idempotency-hash-01',
    requestHash: 'request-hash-01',
    staleClaimRejected: true,
    abandonedSequence: 18,
    abandonedEvent: 'stale-claim-abandoned',
    previousStartedSequence: 12,
    previousClaimId: null,
    previousClaimSequence: 11,
    previousClaimKeyHash: 'retry-claim-hash-01',
    previousClaimEvent: 'idempotency-opened',
  });
});

test('db journal claim evidence preserves distinct claim ids from checked rows', { skip: !hasPhp }, () => {
  const result = runDbJournalClaimEvidenceRow({
    sequence: 24,
    claimId: 'retry-claim-id-01',
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    resourceHashEvidence: {
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sequence: 24,
    claimId: 'retry-claim-id-01',
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    startedCursor: 'db-journal:19',
    claimCursor: 'db-journal:18',
  });
});

test('db journal claim evidence row omits synthesized checked-surface claim ids when persisted claim_id is missing', { skip: !hasPhp }, () => {
  const result = runDbJournalClaimEvidenceRow({
    sequence: 24,
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    labScope: 'packaged-production-plugin',
    resourceHashEvidence: {
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sequence: 24,
    claimId: null,
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    startedCursor: 'db-journal:19',
    claimCursor: 'db-journal:18',
  });
});

test('db journal public row preserves distinct persisted claim ids', { skip: !hasPhp }, () => {
  const result = runDbJournalPublicRow({
    id: 33,
    event: 'stale-claim-rejected',
    claim_id: 'authoritative-claim-id-02',
    claim_key_hash: 'authoritative-claim-hash-02',
    idempotency_key_hash: 'idem-hash-01',
    request_hash: 'request-hash-01',
    plan_hash: '',
    receipt_hash: '',
    plan_fingerprint: '',
    mutation_count: 0,
    applied_count: 0,
    result_hash: '',
    result_json: null,
    resource_hash_evidence_json: null,
    error_code: '',
    lab_scope: 'packaged-production-plugin',
    created_at: '2026-05-27 04:00:00',
    updated_at: '2026-05-27 04:00:00',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sequence: 33,
    event: 'stale-claim-rejected',
    claimId: 'authoritative-claim-id-02',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    planHash: '',
    receiptHash: '',
    planFingerprint: '',
    mutationCount: 0,
    appliedCount: 0,
    resultHash: '',
    result: null,
    resourceHashEvidence: null,
    errorCode: '',
    claimKeyHash: 'authoritative-claim-hash-02',
    labScope: 'packaged-production-plugin',
    createdAt: '2026-05-27 04:00:00',
    updatedAt: '2026-05-27 04:00:00',
  });
});

test('db journal public row omits synthesized checked-surface claim ids when persisted claim_id is missing', { skip: !hasPhp }, () => {
  const result = runDbJournalPublicRow({
    id: 33,
    event: 'stale-claim-rejected',
    claim_key_hash: 'authoritative-claim-hash-02',
    idempotency_key_hash: 'idem-hash-01',
    request_hash: 'request-hash-01',
    plan_hash: '',
    receipt_hash: '',
    plan_fingerprint: '',
    mutation_count: 0,
    applied_count: 0,
    result_hash: '',
    result_json: null,
    resource_hash_evidence_json: null,
    error_code: '',
    lab_scope: 'checked-live-production-shaped',
    created_at: '2026-05-27 04:00:00',
    updated_at: '2026-05-27 04:00:00',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sequence: 33,
    event: 'stale-claim-rejected',
    claimId: null,
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    planHash: '',
    receiptHash: '',
    planFingerprint: '',
    mutationCount: 0,
    appliedCount: 0,
    resultHash: '',
    result: null,
    resourceHashEvidence: null,
    errorCode: '',
    claimKeyHash: 'authoritative-claim-hash-02',
    labScope: 'checked-live-production-shaped',
    createdAt: '2026-05-27 04:00:00',
    updatedAt: '2026-05-27 04:00:00',
  });
});

test('db journal claim summary ignores unrelated journal-wide stale evidence without stale claim lineage', { skip: !hasPhp }, () => {
  const result = runDbJournalClaimSummary(
    {
      sequence: 20,
      event: 'idempotency-opened',
      idempotencyKeyHash: 'idempotency-hash-02',
      requestHash: 'request-hash-02',
      claimKeyHash: 'retry-claim-hash-02',
    },
    null,
    null,
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'active',
    activeClaimKeyHash: 'retry-claim-hash-02',
    activeClaimSequence: 20,
    activeClaimEvent: 'idempotency-opened',
    idempotencyKeyHash: 'idempotency-hash-02',
    requestHash: 'request-hash-02',
    staleClaimRejected: false,
  });
});

test('db journal claim-scoped stale evidence rejects contradictory latest rows from another claim lineage', { skip: !hasPhp }, () => {
  const result = runClaimScopedStaleClaimRejectionEvidence(
    {
      latestRows: [
        {
          sequence: 22,
          event: 'stale-claim-rejected',
          claimKeyHash: 'other-claim-hash-03',
          idempotencyKeyHash: 'other-idempotency-hash-03',
          requestHash: 'other-request-hash-03',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 22,
        },
      ],
    },
    {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked authenticated apply evidence is upgraded to the authoritative db journal contract', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production journal scope',
    claim: {
      status: 'active',
      activeClaimKeyHash: 'claim-hash-01',
      activeClaimSequence: 14,
      activeClaimEvent: 'idempotency-opened',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: false,
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
      scope: 'packaged production journal scope',
      acceptedOnCheckedBoundary: true,
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 14,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
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

test('checked authenticated apply evidence fails closed on accepted checked journal summaries that still omit claim identity', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
      acceptedOnCheckedBoundary: false,
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

test('checked authenticated apply evidence fails closed on accepted checked journal summaries that still omit the checked-boundary marker', { skip: !hasPhp }, () => {
  const checkedSummary = {
    scope: 'packaged production journal scope',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'authoritative-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
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
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
  };
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        event: 'apply-replayed',
        sequence: 15,
        scope: 'packaged production journal scope',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
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
  assert.equal(JSON.parse(result.stdout).dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked authenticated apply evidence fails closed on accepted checked journal summaries that still omit writer-lease storage evidence', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production journal scope',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'authoritative-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
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
  };
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        event: 'apply-replayed',
        sequence: 15,
        scope: 'local Playground fixture only',
      },
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.writerLease.storageGuard, undefined);
  assert.equal(parsed.dbJournal.leaseFence.writerLease.storageGuard, 'wpdb-single-statement-cas');
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease storage guard', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.storageGuard;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease strategy', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.strategy;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease claim-key uniqueness', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease fsync evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease monotonic sequencing', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease restart readability', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease stale-claim rejection flag', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.writerLease.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    { dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked authenticated apply evidence fails closed on accepted checked journal summaries that still omit persisted journal evidence', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production journal scope',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'authoritative-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
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
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
  };
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'local Playground fixture only',
      },
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.table, undefined);
  assert.equal(parsed.dbJournal.rowCount, undefined);
  assert.equal(parsed.dbJournal.latestRows, undefined);
  assert.equal(parsed.dbJournal.eventSummaries, undefined);
});

test('checked authenticated apply evidence fails closed on accepted checked journal summaries that still omit schema version evidence', { skip: !hasPhp }, () => {
  const checkedSummary = {
    acceptedOnCheckedBoundary: true,
    scope: 'packaged production journal scope',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'authoritative-claim-hash-02',
      activeClaimSequence: 33,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 24,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 19,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimSequence: 18,
      previousClaimEvent: 'idempotency-opened',
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
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
  };
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        event: 'apply-replayed',
        sequence: 15,
        scope: 'local Playground fixture only',
      },
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.schemaVersion, undefined);
  assert.equal(parsed.dbJournal.storageGuard, undefined);
});

test('checked authenticated apply evidence fails closed when accepted checked journal summaries still claim fixture scope', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'local Playground fixture only; not production durability',
        schemaVersion: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.scope, 'local Playground fixture only; not production durability');
});

test('checked authenticated apply evidence fails closed on conflicting checked writer-lease storage guards', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'active',
          activeClaimKeyHash: 'claim-hash-01',
          activeClaimSequence: 18,
          activeClaimEvent: 'idempotency-opened',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
            storageGuard: 'mysql-advisory-lock-lease',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.writerLease.storageGuard, 'wpdb-single-statement-cas');
  assert.equal(parsed.dbJournal.leaseFence.writerLease.storageGuard, 'mysql-advisory-lock-lease');
});

test('checked authenticated apply evidence fails closed on stale-claim drift between claim and lease contracts', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'claim-hash-01',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          previousClaimKeyHash: 'claim-hash-00',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
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
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claim.staleClaimRejected, true);
  assert.equal(parsed.dbJournal.writerLease.staleClaimRejected, false);
  assert.equal(parsed.dbJournal.leaseFence.staleClaimRejected, false);
});

test('checked authenticated apply evidence fails closed on conflicting checked claim event state', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'active',
          activeClaimKeyHash: 'claim-hash-01',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claim.status, 'active');
  assert.equal(parsed.dbJournal.claim.activeClaimEvent, 'stale-claim-rejected');
});

test('checked authenticated apply evidence fails closed on missing consumed stale-retry claim identities', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'claim-hash-02',
          activeClaimSequence: 34,
          activeClaimEvent: 'stale-claim-retry-started',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          previousClaimKeyHash: 'claim-hash-01',
          previousClaimSequence: 21,
          previousClaimEvent: 'idempotency-opened',
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
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claim.activeClaimEvent, 'stale-claim-retry-started');
  assert.equal(parsed.dbJournal.claim.previousStartedSequence, undefined);
});

test('checked authenticated apply evidence fails closed on conflicting accepted ownership restart-readable drift', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'claim-hash-01',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          previousClaimKeyHash: 'claim-hash-00',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
          previousStartedSequence: 19,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
        },
        ownership: {
          ownsJournal: true,
          restartReadable: false,
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
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        latestRows: [
          {
            event: 'stale-claim-rejected',
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
          { event: 'stale-claim-rejected', count: 1, latestId: 33 },
        ],
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.ownership.restartReadable, false);
  assert.equal(parsed.dbJournal.writerLease.restartReadable, true);
  assert.equal(parsed.dbJournal.leaseFence.restartReadable, true);
});

test('checked authenticated apply evidence fails closed on checked storage guard operation drift', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'active',
          activeClaimKeyHash: 'claim-hash-01',
          activeClaimSequence: 33,
          activeClaimEvent: 'idempotency-opened',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'compare-and-swap',
          outcome: 'applied',
        },
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'compare-and-swap',
    outcome: 'applied',
  });
});

test('checked authenticated apply evidence preserves accepted checked durable ownership after historical stale-claim rejection proof', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        scope: 'packaged production journal scope',
        claim: {
          status: 'active',
          activeClaimKeyHash: 'claim-hash-03',
          activeClaimSequence: 44,
          activeClaimEvent: 'idempotency-opened',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, true);
  assert.equal(parsed.dbJournal.claim.staleClaimRejected, false);
  assert.equal(parsed.dbJournal.writerLease.staleClaimRejected, true);
  assert.equal(parsed.dbJournal.leaseFence.staleClaimRejected, true);
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
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 18,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
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
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 18,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
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
      claim: {
        status: 'active',
        activeClaimKeyHash: 'claim-hash-01',
        activeClaimSequence: 18,
        activeClaimEvent: 'idempotency-opened',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: false,
      },
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

test('checked recovery inspect evidence fails closed on conflicting accepted inline storage-guard anchors instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'custom-inline-adapter',
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
            boundary: 'custom-inline-boundary',
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
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.table, undefined);
  assert.equal(parsed.recovery.journal.rowCount, 1);
  assert.equal(parsed.recovery.journal.scope, 'checked live production-shaped journal surface; not local Playground fixture only');
  assert.equal(parsed.recovery.journal.ownership.productionAdapter, 'custom-inline-adapter');
  assert.equal(parsed.recovery.journal.leaseFence.boundary, 'custom-inline-boundary');
  assert.deepEqual(parsed.recovery.journal.latestRows, [
    {
      id: 33,
      event: 'stale-claim-rejected',
      result: {
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'compare-and-swap',
          outcome: 'precondition-failed',
        },
      },
    },
  ]);
  assert.deepEqual(parsed.recovery.journal.eventSummaries, [
    { event: 'stale-claim-rejected', count: 1, latestId: 33 },
  ]);
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'compare-and-swap',
    outcome: 'precondition-failed',
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline nested contract anchors instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'custom-inline-adapter',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'custom-inline-adapter',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'custom-inline-boundary',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'custom-inline-adapter',
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
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'custom-inline-adapter',
  });
  assert.deepEqual(parsed.recovery.journal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'custom-inline-adapter',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  });
  assert.deepEqual(parsed.recovery.journal.leaseFence, {
    boundary: 'custom-inline-boundary',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'custom-inline-adapter',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested contract anchors instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimKeyUnique: true,
              fsyncEvidence: true,
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
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
  });
  assert.deepEqual(parsed.recovery.journal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  });
  assert.deepEqual(parsed.recovery.journal.leaseFence, {
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked recovery inspect evidence fails closed on unsupported accepted inline production adapters', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'custom-inline-adapter',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'custom-inline-adapter',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
          leaseFence: {
            boundary: 'custom-inline-adapter',
            claimKeyUnique: true,
            fsyncEvidence: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
            writerLease: {
              strategy: 'claim-fenced-single-writer',
              claimKeyUnique: true,
              fsyncEvidence: true,
              storageGuard: 'custom-inline-adapter',
              monotonicSequence: true,
              restartReadable: true,
              staleClaimRejected: true,
            },
          },
          storageGuard: {
            boundary: 'custom-inline-adapter',
            operation: 'update',
            outcome: 'applied',
          },
        },
      },
    },
    true,
    false,
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.ownership.productionAdapter, 'custom-inline-adapter');
  assert.equal(parsed.recovery.journal.writerLease.storageGuard, 'custom-inline-adapter');
  assert.equal(parsed.recovery.journal.leaseFence.boundary, 'custom-inline-adapter');
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    boundary: 'custom-inline-adapter',
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline ownership restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.ownership.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    productionAdapter: 'wpdb-single-statement-cas',
    supportedSurface: 'claim-fenced-restart-readable',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline ownership production adapter instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.ownership.productionAdapter;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    supportedSurface: 'claim-fenced-restart-readable',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline ownership supported surface instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.ownership.supportedSurface;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline ownership supported surface', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.ownership.supportedSurface = 'weakened-inline-surface';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
    supportedSurface: 'weakened-inline-surface',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline ownership journal-ownership flag instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.ownership.ownsJournal;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline schema version instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.schemaVersion;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.schemaVersion, undefined);
});

test('checked recovery inspect evidence fails closed on missing accepted inline table instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.table;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.table, undefined);
});

test('checked recovery inspect evidence fails closed on missing accepted inline scope instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.scope;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.scope, undefined);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease claim identity instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.claimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease claim-key hash instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.claimKeyHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline writer-lease claim identity instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.writerLease.claimId = 'conflicting-inline-active-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline writer-lease claim-key hash instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.writerLease.claimKeyHash = 'conflicting-inline-active-claim-key-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline nested writer-lease claim identity instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.leaseFence.writerLease.claimId = 'conflicting-nested-active-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline nested writer-lease claim-key hash instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.leaseFence.writerLease.claimKeyHash = 'conflicting-nested-active-claim-key-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease storage guard instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.storageGuard;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease claim identity instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.claimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease claim-key hash instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.claimKeyHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      ok: true,
      recovery: {
        journal: inlineJournal,
      },
    },
    true,
    false,
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease strategy instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.strategy;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline writer-lease stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.writerLease.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, inlineJournal.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested writer-lease restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence boundary instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.boundary;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.staleClaimRejected;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.claimKeyUnique;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.fsyncEvidence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.monotonicSequence;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline lease-fence restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.restartReadable;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, inlineJournal.leaseFence);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested lease-fence writer-lease storage guard instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.storageGuard;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline nested lease-fence writer-lease strategy instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.strategy;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked recovery inspect evidence fails closed on missing accepted inline top-level storage guard instead of backfilling it from checked journal evidence', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
          event: 'stale-claim-rejected',
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
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.storageGuard, undefined);
});

test('checked recovery inspect evidence fails closed on missing accepted inline top-level storage-guard boundary instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.storageGuard.boundary;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    operation: 'compare-and-swap',
    outcome: 'precondition-failed',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline top-level storage-guard operation instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.storageGuard.operation;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    outcome: 'precondition-failed',
  });
});

test('checked recovery inspect evidence fails closed on missing accepted inline top-level storage-guard outcome instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.storageGuard.outcome;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'compare-and-swap',
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level counters instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 9,
          applyCommitted: 2,
          mutationApplied: 2,
          idempotencyOpened: 2,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'compare-and-swap',
            outcome: 'precondition-failed',
          },
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      applyCommitted: 0,
      mutationApplied: 0,
      idempotencyOpened: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.rowCount, 9);
  assert.equal(parsed.recovery.journal.applyCommitted, 2);
  assert.equal(parsed.recovery.journal.mutationApplied, 2);
  assert.equal(parsed.recovery.journal.idempotencyOpened, 2);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level identity fields instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 7,
          acceptedOnCheckedBoundary: true,
          table: 'wp_custom_inline_push_journal',
          rowCount: 1,
          scope: 'custom-inline-checked-journal-scope',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
          storageGuard: {
            boundary: 'wpdb-single-statement-cas',
            operation: 'compare-and-swap',
            outcome: 'precondition-failed',
          },
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.schemaVersion, 7);
  assert.equal(parsed.recovery.journal.table, 'wp_custom_inline_push_journal');
  assert.equal(parsed.recovery.journal.scope, 'custom-inline-checked-journal-scope');
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level claim id instead of silently retaining it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimId = 'drifted-active-claim-id';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimId, 'drifted-active-claim-id');
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level claim-key hash instead of silently retaining it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimKeyHash = 'drifted-top-level-claim-key-hash';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimKeyHash, 'drifted-top-level-claim-key-hash');
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline claim contract instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claim = {
    ...inlineJournal.claim,
    activeClaimId: 'inline-claim-id-02',
    activeClaimKeyHash: 'inline-claim-key-hash-02',
  };

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.claim, inlineJournal.claim);
});

test('checked recovery inspect evidence fails closed on accepted inline top-level claim id without a matching top-level claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimId = inlineJournal.claim.activeClaimId;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimId, inlineJournal.claim.activeClaimId);
  assert.equal('claimKeyHash' in parsed.recovery.journal, false);
});

test('checked recovery inspect evidence fails closed on accepted inline top-level claim-key hash without a matching top-level claim id', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimKeyHash = inlineJournal.claim.activeClaimKeyHash;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimKeyHash, inlineJournal.claim.activeClaimKeyHash);
  assert.equal('claimId' in parsed.recovery.journal, false);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline ownership contract flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          applyCommitted: 0,
          mutationApplied: 0,
          idempotencyOpened: 1,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: false,
            restartReadable: false,
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
          latestRows: [
            {
              id: 33,
              event: 'stale-claim-rejected',
              claimKeyHash: 'retry-claim-hash-02',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
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
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      applyCommitted: 0,
      mutationApplied: 0,
      idempotencyOpened: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.ownership, {
    ownsJournal: false,
    restartReadable: false,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level writer-lease flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          applyCommitted: 0,
          mutationApplied: 0,
          idempotencyOpened: 1,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
          },
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'wpdb-single-statement-cas',
          },
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: false,
            fsyncEvidence: false,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: false,
            restartReadable: false,
            staleClaimRejected: false,
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
          latestRows: [
            {
              id: 33,
              event: 'stale-claim-rejected',
              claimKeyHash: 'retry-claim-hash-02',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
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
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      applyCommitted: 0,
      mutationApplied: 0,
      idempotencyOpened: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: false,
    fsyncEvidence: false,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline top-level lease-fence flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedRecoveryJournalEvidence(
    {
      recovery: {
        journal: {
          integrity: {
            schemaVersion: 1,
            status: 'ok',
            scope: 'checked live production-shaped recovery inspect journal evidence; not local Playground fixture only',
          },
          schemaVersion: 1,
          acceptedOnCheckedBoundary: true,
          table: 'wp_reprint_push_lab_push_journal',
          rowCount: 1,
          applyCommitted: 0,
          mutationApplied: 0,
          idempotencyOpened: 1,
          scope: 'checked live production-shaped journal surface; not local Playground fixture only',
          claim: {
            status: 'stale-claim-rejected',
            activeClaimKeyHash: 'retry-claim-hash-02',
            activeClaimSequence: 33,
            activeClaimEvent: 'stale-claim-rejected',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            staleClaimRejected: true,
            abandonedSequence: 24,
            abandonedEvent: 'stale-claim-abandoned',
            previousStartedSequence: 19,
            previousClaimKeyHash: 'retry-claim-hash-01',
            previousClaimSequence: 18,
            previousClaimEvent: 'idempotency-opened',
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
            claimKeyUnique: false,
            fsyncEvidence: false,
            monotonicSequence: false,
            restartReadable: false,
            staleClaimRejected: false,
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
          latestRows: [
            {
              id: 33,
              event: 'stale-claim-rejected',
              claimKeyHash: 'retry-claim-hash-02',
              idempotencyKeyHash: 'idem-hash-01',
              requestHash: 'request-hash-01',
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
        },
      },
    },
    true,
    false,
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      applyCommitted: 0,
      mutationApplied: 0,
      idempotencyOpened: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.leaseFence, {
    boundary: 'wpdb-single-statement-cas',
    claimKeyUnique: false,
    fsyncEvidence: false,
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline stale-claim latest rows instead of silently normalizing them', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.latestRows[0].claimKeyHash = 'inline-claim-hash-02';
  inlineJournal.claimEvidence.activeRow.claimKeyHash = 'inline-claim-hash-02';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.latestRows, inlineJournal.latestRows);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline claim evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimEvidence.activeRow.claimKeyHash = 'inline-claim-hash-02';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.claimEvidence, inlineJournal.claimEvidence);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline started cursor evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimEvidence.abandonedRow.startedCursor = 'db-journal:99';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.startedCursor, 'db-journal:99');
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.claimCursor, 'db-journal:18');
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline claim cursor evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimEvidence.abandonedRow.claimCursor = 'db-journal:77';

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.startedCursor, 'db-journal:19');
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.claimCursor, 'db-journal:77');
});

test('checked recovery inspect evidence fails closed on missing accepted inline claim cursor evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.claimEvidence.abandonedRow.claimCursor;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.startedCursor, 'db-journal:19');
  assert.equal(parsed.recovery.journal.claimEvidence.abandonedRow.claimCursor, undefined);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline event summaries instead of silently normalizing them', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.eventSummaries[0].count = 2;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.eventSummaries, [
    {
      event: 'stale-claim-rejected',
      count: 2,
      latestId: 33,
    },
  ]);
});

test('checked recovery inspect evidence fails closed on conflicting accepted inline idempotency evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.idempotencyEvidence[0].events = 2;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'idem-hash-01',
      events: 2,
      requestHashes: 1,
      latestId: 33,
    },
  ]);
});

test('checked recovery inspect evidence fails closed on missing accepted inline idempotency evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.idempotencyEvidence[0].requestHashes;

  const result = runAttachCheckedRecoveryJournalEvidence(
    { recovery: { journal: inlineJournal } },
    true,
    false,
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recovery.journal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.recovery.journal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'idem-hash-01',
      events: 1,
      latestId: 33,
    },
  ]);
});

test('checked db journal attachment fails closed on conflicting accepted inline storage-guard evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: false,
      dbJournal: {
        event: 'apply-rejected',
        sequence: 18,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'custom-inline-adapter',
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
          boundary: 'custom-inline-boundary',
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
          boundary: 'custom-inline-boundary',
          operation: 'compare-and-swap',
          outcome: 'precondition-failed',
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    dbJournal: {
      event: 'apply-rejected',
      sequence: 18,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: false,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'custom-inline-adapter',
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
        boundary: 'custom-inline-boundary',
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
      storageGuard: {
        boundary: 'custom-inline-boundary',
        operation: 'compare-and-swap',
        outcome: 'precondition-failed',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'compare-and-swap',
      outcome: 'precondition-failed',
    },
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline storage-guard operation instead of silently normalizing it', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: false,
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
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          event: 'stale-claim-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'update',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    dbJournal: {
      event: 'apply-rejected',
      sequence: 18,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: false,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          event: 'stale-claim-rejected',
          result: {
            storageGuard: {
              boundary: 'wpdb-single-statement-cas',
              operation: 'update',
              outcome: 'precondition-failed',
            },
          },
        },
      ],
      eventSummaries: [
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'compare-and-swap',
        outcome: 'precondition-failed',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'precondition-failed',
    },
  });
});

test('checked db journal attachment fails closed on missing accepted inline storage-guard outcome instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: false,
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
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    dbJournal: {
      event: 'apply-rejected',
      sequence: 18,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      acceptedOnCheckedBoundary: false,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'compare-and-swap',
      },
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'compare-and-swap',
      outcome: 'precondition-failed',
    },
  });
});

test('checked db journal attachment fails closed on unsupported accepted inline production adapters', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'custom-inline-adapter',
        },
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'custom-inline-adapter',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'custom-inline-adapter',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'custom-inline-adapter',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
        storageGuard: {
          boundary: 'custom-inline-adapter',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
    {},
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.ownership.productionAdapter, 'custom-inline-adapter');
  assert.equal(parsed.dbJournal.writerLease.storageGuard, 'custom-inline-adapter');
  assert.equal(parsed.dbJournal.leaseFence.boundary, 'custom-inline-adapter');
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'custom-inline-adapter',
    operation: 'update',
    outcome: 'applied',
  });
  assert.equal(parsed.storageGuard, undefined);
});

test('checked db journal attachment fails closed on missing accepted inline ownership restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.ownership.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    productionAdapter: 'wpdb-single-statement-cas',
    supportedSurface: 'claim-fenced-restart-readable',
  });
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.leaseFence.writerLease.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline top-level storage guard instead of backfilling it from checked journal evidence', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        schemaVersion: 1,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
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
    {
      schemaVersion: 1,
      acceptedOnCheckedBoundary: true,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 33,
          event: 'stale-claim-rejected',
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
        { event: 'stale-claim-rejected', count: 1, latestId: 33 },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.storageGuard, undefined);
  assert.deepEqual(parsed.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked db journal attachment fails closed on conflicting checked claim lineage', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'inline-claim-hash-01',
          activeClaimSequence: 28,
          activeClaimEvent: 'stale-claim-retry-started',
          idempotencyKeyHash: 'idem-hash-inline',
          requestHash: 'request-hash-inline',
          staleClaimRejected: true,
          abandonedSequence: 23,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 17,
          previousClaimKeyHash: 'inline-prev-claim-hash-00',
          previousClaimSequence: 19,
          previousClaimEvent: 'idempotency-opened',
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'wpdb-single-statement-cas',
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
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
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.claim, {
    status: 'stale-claim-rejected',
    activeClaimKeyHash: 'authoritative-claim-hash-02',
    activeClaimSequence: 33,
    activeClaimEvent: 'stale-claim-rejected',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    staleClaimRejected: true,
    abandonedSequence: 24,
    abandonedEvent: 'stale-claim-abandoned',
    previousStartedSequence: 19,
    previousClaimKeyHash: 'retry-claim-hash-01',
    previousClaimSequence: 18,
    previousClaimEvent: 'idempotency-opened',
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline stale-claim latest rows instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'inline-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'inline-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.latestRows, [
    {
      sequence: 33,
      event: 'stale-claim-rejected',
      claimKeyHash: 'inline-claim-hash-02',
      idempotencyKeyHash: 'idem-hash-01',
      requestHash: 'request-hash-01',
    },
  ]);
});

test('checked db journal attachment fails closed on conflicting accepted inline claim evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'inline-prev-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.claimEvidence.previousRow, {
    sequence: 18,
    event: 'idempotency-opened',
    claimKeyHash: 'inline-prev-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline started cursor evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimEvidence.abandonedRow.startedCursor = 'db-journal:99';

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.startedCursor, 'db-journal:99');
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimCursor, 'db-journal:18');
});

test('checked db journal attachment fails closed on conflicting accepted inline claim cursor evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  inlineJournal.claimEvidence.abandonedRow.claimCursor = 'db-journal:77';

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.startedCursor, 'db-journal:19');
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimCursor, 'db-journal:77');
});

test('checked db journal attachment fails closed on missing accepted inline started cursor evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.claimEvidence.abandonedRow.startedCursor;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.startedCursor, undefined);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimCursor, 'db-journal:18');
});

test('checked db journal attachment fails closed on missing accepted inline claim cursor evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.claimEvidence.abandonedRow.claimCursor;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
    true,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.startedCursor, 'db-journal:19');
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow.claimCursor, undefined);
});

test('checked db journal attachment fails closed on conflicting accepted inline event summaries instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 2,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.eventSummaries, [
    {
      event: 'stale-claim-rejected',
      count: 2,
      latestId: 33,
    },
  ]);
});

test('checked db journal attachment fails closed on conflicting accepted inline idempotency evidence instead of silently normalizing it', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 2,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'idem-hash-01',
      events: 2,
      requestHashes: 1,
      latestId: 33,
    },
  ]);
});

test('checked db journal attachment fails closed on missing accepted inline idempotency evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  delete inlineJournal.idempotencyEvidence[0].requestHashes;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    buildCheckedRecoveryJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'idem-hash-01',
      events: 1,
      latestId: 33,
    },
  ]);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit claim-scoped idempotency evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.idempotencyEvidence = [
    {
      idempotencyKeyHash: 'other-idempotency-hash-99',
      events: 1,
      requestHashes: 1,
      latestId: 40,
    },
  ];

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.idempotencyEvidence, [
    {
      idempotencyKeyHash: 'other-idempotency-hash-99',
      events: 1,
      requestHashes: 1,
      latestId: 40,
    },
  ]);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted event and idempotency counters', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.eventSummaries[0].latestId;
  delete checkedSummary.idempotencyEvidence[0].requestHashes;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted top-level counters', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.rowCount;
  delete checkedSummary.applyCommitted;
  delete checkedSummary.mutationApplied;
  delete checkedSummary.idempotencyOpened;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted top-level identity anchors', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.schemaVersion;
  delete checkedSummary.table;
  delete checkedSummary.scope;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed on conflicting accepted inline restart artifact refs', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.storage = 'inline-restart-storage';
  inlineJournal.planHash = 'inline-plan-hash';
  inlineJournal.receiptHash = 'inline-receipt-hash';

  const checkedSummary = buildCheckedDbJournalSummary();
  checkedSummary.storage = 'checked-restart-storage';
  checkedSummary.planHash = 'checked-plan-hash';
  checkedSummary.receiptHash = 'checked-receipt-hash';

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.storage, 'inline-restart-storage');
  assert.equal(parsed.dbJournal.planHash, 'inline-plan-hash');
  assert.equal(parsed.dbJournal.receiptHash, 'inline-receipt-hash');
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted restart artifact refs', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.storage = 'inline-restart-storage';
  inlineJournal.planHash = 'inline-plan-hash';
  inlineJournal.receiptHash = 'inline-receipt-hash';

  const checkedSummary = buildCheckedDbJournalSummary();
  delete checkedSummary.storage;
  delete checkedSummary.planHash;
  delete checkedSummary.receiptHash;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: inlineJournal,
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.storage, 'inline-restart-storage');
  assert.equal(parsed.dbJournal.planHash, 'inline-plan-hash');
  assert.equal(parsed.dbJournal.receiptHash, 'inline-receipt-hash');
});

for (const [label, propertyPath] of checkedClaimContractOmissionCases) {
  test(`checked db journal attachment fails closed when authoritative checked summaries omit accepted ${label}`, { skip: !hasPhp }, () => {
    const checkedSummary = buildCheckedRecoveryJournalSummary();
    deleteNestedProperty(checkedSummary, propertyPath);

    const result = runAttachCheckedDbJournalContract(
      {
        ok: true,
        dbJournal: buildAcceptedInlineRecoveryJournal(),
      },
      checkedSummary,
    );

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  });
}

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease claim identity', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.claimId;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.writerLease.claimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested writer-lease claim identity', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimId;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.writerLease.claimId = 'conflicting-authoritative-claim-id';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.writerLease.claimKeyHash = 'conflicting-authoritative-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted nested writer-lease claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.leaseFence.writerLease.claimId = 'conflicting-authoritative-nested-claim-id';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted nested writer-lease claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineRecoveryJournal();
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  checkedSummary.leaseFence.writerLease.claimKeyHash = 'conflicting-authoritative-nested-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted ownership supported surface', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.supportedSurface;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted ownership restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted ownership production adapter', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.productionAdapter;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted ownership owns-journal flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.ownership.ownsJournal;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence claim-key uniqueness', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence fsync evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence monotonic sequencing', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence stale-claim rejection flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted lease-fence boundary', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.boundary;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease storage guard', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.storageGuard;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease strategy', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.strategy;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease claim-key uniqueness', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease fsync evidence', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease monotonic sequencing', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease restart readability', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted nested lease-fence writer-lease stale-claim rejection flag', { skip: !hasPhp }, () => {
  const checkedSummary = buildCheckedRecoveryJournalSummary();
  delete checkedSummary.leaseFence.writerLease.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: buildAcceptedInlineRecoveryJournal(),
    },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level counters instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 2,
        applyCommitted: false,
        mutationApplied: 0,
        idempotencyOpened: 0,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 3,
      applyCommitted: true,
      mutationApplied: 1,
      idempotencyOpened: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.rowCount, 3);
  assert.equal(parsed.dbJournal.applyCommitted, true);
  assert.equal(parsed.dbJournal.mutationApplied, 1);
  assert.equal(parsed.dbJournal.idempotencyOpened, 1);
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level identity fields instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'fixture-scoped stale inline checked journal contract',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 0,
        table: 'wp_stale_inline_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.schemaVersion, 1);
  assert.equal(parsed.dbJournal.table, 'wp_reprint_push_lab_push_journal');
  assert.equal(parsed.dbJournal.scope, 'checked live production-shaped journal surface; not local Playground fixture only');
});

test('checked db journal attachment fails closed on conflicting accepted inline ownership contract flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        },
        ownership: {
          ownsJournal: false,
          restartReadable: false,
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
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: false,
    restartReadable: false,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline nested contract anchors instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'custom-inline-adapter',
        },
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'custom-inline-adapter',
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
        leaseFence: {
          boundary: 'custom-inline-adapter',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
            storageGuard: 'custom-inline-adapter',
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: true,
          },
        },
        storageGuard: {
          boundary: 'custom-inline-adapter',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'custom-inline-adapter',
  });
  assert.deepEqual(parsed.dbJournal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'custom-inline-adapter',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  });
  assert.deepEqual(parsed.dbJournal.leaseFence, {
    boundary: 'custom-inline-adapter',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'custom-inline-adapter',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'custom-inline-adapter',
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked db journal attachment fails closed on missing accepted inline nested contract anchors instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
        },
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
        },
        leaseFence: {
          claimKeyUnique: true,
          fsyncEvidence: true,
          monotonicSequence: true,
          restartReadable: true,
          staleClaimRejected: true,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: true,
            fsyncEvidence: true,
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
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    restartReadable: true,
  });
  assert.deepEqual(parsed.dbJournal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  });
  assert.deepEqual(parsed.dbJournal.leaseFence, {
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level writer-lease flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'wpdb-single-statement-cas',
        },
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: false,
          fsyncEvidence: false,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
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
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: false,
    fsyncEvidence: false,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline writer-lease claim identity instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.writerLease.claimId = 'conflicting-active-claim-id';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on conflicting accepted inline writer-lease claim-key hash instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.writerLease.claimKeyHash = 'conflicting-active-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level lease-fence flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
          claimKeyUnique: false,
          fsyncEvidence: false,
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
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
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, {
    boundary: 'wpdb-single-statement-cas',
    claimKeyUnique: false,
    fsyncEvidence: false,
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline lease-fence writer-lease flags instead of silently normalizing them', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        },
        ownership: {
          ownsJournal: true,
          restartReadable: true,
          productionAdapter: 'wpdb-single-statement-cas',
        },
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: false,
          storageGuard: 'wpdb-single-statement-cas',
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
        },
        leaseFence: {
          boundary: 'wpdb-single-statement-cas',
          claimKeyUnique: false,
          fsyncEvidence: false,
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: false,
          writerLease: {
            strategy: 'claim-fenced-single-writer',
            claimKeyUnique: false,
            fsyncEvidence: false,
            storageGuard: 'wpdb-single-statement-cas',
            monotonicSequence: false,
            restartReadable: false,
            staleClaimRejected: false,
          },
        },
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimKeyUnique: true,
    fsyncEvidence: false,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
  });
  assert.deepEqual(parsed.dbJournal.leaseFence, {
    boundary: 'wpdb-single-statement-cas',
    claimKeyUnique: false,
    fsyncEvidence: false,
    monotonicSequence: false,
    restartReadable: false,
    staleClaimRejected: false,
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: false,
      fsyncEvidence: false,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: false,
    },
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline nested writer-lease claim identity instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.leaseFence.writerLease.claimId = 'conflicting-nested-active-claim-id';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on conflicting accepted inline nested writer-lease claim-key hash instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.leaseFence.writerLease.claimKeyHash = 'conflicting-nested-active-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline ownership restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.ownership.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked db journal attachment fails closed on missing accepted inline ownership production adapter instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.ownership.productionAdapter;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    restartReadable: true,
  });
});

test('checked db journal attachment fails closed on missing accepted inline ownership supported surface instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.ownership.supportedSurface;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked db journal attachment fails closed on conflicting accepted inline ownership supported surface', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.ownership.supportedSurface = 'weakened-inline-surface';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
    supportedSurface: 'weakened-inline-surface',
  });
});

test('checked db journal attachment fails closed on missing accepted inline ownership journal-ownership flag instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.ownership.ownsJournal;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.ownership, {
    restartReadable: true,
    productionAdapter: 'wpdb-single-statement-cas',
  });
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease claim identity instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.claimId;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease claim-key hash instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.claimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease claim identity instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.claimId;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease claim-key hash instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.claimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline schema version instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.schemaVersion;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.schemaVersion, undefined);
});

test('checked db journal attachment fails closed on missing accepted inline table instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.table;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.table, undefined);
});

test('checked db journal attachment fails closed on missing accepted inline scope instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.scope;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.scope, undefined);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted top-level counters', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.rowCount = 3;
  inlineJournal.applyCommitted = true;
  inlineJournal.mutationApplied = 1;
  inlineJournal.idempotencyOpened = 1;

  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.rowCount = 4;
  checkedSummary.applyCommitted = false;
  checkedSummary.mutationApplied = 2;
  checkedSummary.idempotencyOpened = 2;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.rowCount, 3);
  assert.equal(parsed.dbJournal.applyCommitted, true);
  assert.equal(parsed.dbJournal.mutationApplied, 1);
  assert.equal(parsed.dbJournal.idempotencyOpened, 1);
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted top-level counters', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.rowCount = 3;
  inlineJournal.applyCommitted = true;
  inlineJournal.mutationApplied = 1;
  inlineJournal.idempotencyOpened = 1;

  const checkedSummary = structuredClone(inlineJournal);
  delete checkedSummary.rowCount;
  delete checkedSummary.applyCommitted;
  delete checkedSummary.mutationApplied;
  delete checkedSummary.idempotencyOpened;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.rowCount, 3);
  assert.equal(parsed.dbJournal.applyCommitted, true);
  assert.equal(parsed.dbJournal.mutationApplied, 1);
  assert.equal(parsed.dbJournal.idempotencyOpened, 1);
});

test('checked db journal attachment fails closed when authoritative checked summaries conflict on accepted top-level identity fields', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.schemaVersion = 2;
  checkedSummary.table = 'wp_conflicting_push_journal';
  checkedSummary.scope = 'conflicting checked journal scope';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.schemaVersion, 1);
  assert.equal(parsed.dbJournal.table, 'wp_reprint_push_lab_push_journal');
  assert.equal(parsed.dbJournal.scope, 'checked live production-shaped journal surface; not local Playground fixture only');
});

test('checked db journal attachment fails closed when authoritative checked summaries omit accepted top-level identity fields', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = structuredClone(inlineJournal);
  delete checkedSummary.schemaVersion;
  delete checkedSummary.table;
  delete checkedSummary.scope;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.schemaVersion, 1);
  assert.equal(parsed.dbJournal.table, 'wp_reprint_push_lab_push_journal');
  assert.equal(parsed.dbJournal.scope, 'checked live production-shaped journal surface; not local Playground fixture only');
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level claim id', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claimId = 'different-active-claim-id';
  inlineJournal.claimKeyHash = inlineJournal.claim.activeClaimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimId, 'different-active-claim-id');
  assert.equal(parsed.dbJournal.claimKeyHash, inlineJournal.claim.activeClaimKeyHash);
});

test('checked db journal attachment fails closed on conflicting accepted inline top-level claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claimId = inlineJournal.claim.activeClaimId;
  inlineJournal.claimKeyHash = 'different-active-claim-key-hash';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimId, inlineJournal.claim.activeClaimId);
  assert.equal(parsed.dbJournal.claimKeyHash, 'different-active-claim-key-hash');
});

test('checked db journal attachment fails closed on conflicting accepted inline claim contract instead of silently normalizing it', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claim = {
    ...inlineJournal.claim,
    activeClaimId: 'inline-claim-id-02',
    activeClaimKeyHash: 'inline-claim-key-hash-02',
  };

  const checkedSummary = buildCheckedDbJournalSummary();

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.claim, inlineJournal.claim);
});

test('checked db journal attachment fails closed on accepted inline top-level claim id without a matching top-level claim-key hash', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claimId = inlineJournal.claim.activeClaimId;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimId, inlineJournal.claim.activeClaimId);
  assert.equal(parsed.dbJournal.claimKeyHash, undefined);
});

test('checked db journal attachment fails closed on accepted inline top-level claim-key hash without a matching top-level claim id', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claimKeyHash = inlineJournal.claim.activeClaimKeyHash;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimId, undefined);
  assert.equal(parsed.dbJournal.claimKeyHash, inlineJournal.claim.activeClaimKeyHash);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease storage guard instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.storageGuard;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease strategy instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.strategy;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline writer-lease stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.writerLease.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.writerLease, inlineJournal.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested writer-lease restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence boundary instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.boundary;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence stale-claim evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.staleClaimRejected;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence claim-key uniqueness instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.claimKeyUnique;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence fsync evidence instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.fsyncEvidence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence monotonic sequencing instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.monotonicSequence;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline lease-fence restart readability instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.restartReadable;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence, inlineJournal.leaseFence);
});

test('checked db journal attachment fails closed on missing accepted inline nested lease-fence writer-lease storage guard instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.storageGuard;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline nested lease-fence writer-lease strategy instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.leaseFence.writerLease.strategy;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.leaseFence.writerLease, inlineJournal.leaseFence.writerLease);
});

test('checked db journal attachment fails closed on missing accepted inline top-level storage-guard boundary instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.storageGuard.boundary;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    operation: 'update',
    outcome: 'applied',
  });
});

test('checked db journal attachment fails closed on missing accepted inline top-level storage-guard operation instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.storageGuard.operation;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    outcome: 'applied',
  });
});

test('checked db journal attachment fails closed on missing accepted inline top-level storage-guard outcome instead of backfilling it from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.storageGuard.outcome;

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    buildCheckedDbJournalSummary(),
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.storageGuard, {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
  });
});

test('checked db journal attachment fails closed when accepted checked summaries claim stale-claim rejection without persisted stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 20,
          activeClaimEvent: 'stale-claim-retry-started',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 18,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 12,
          previousClaimSequence: 11,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimEvent: 'idempotency-opened',
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 20,
            event: 'apply-committed',
          },
        ],
        eventSummaries: [
          {
            event: 'apply-committed',
            count: 1,
            latestId: 20,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 20,
        activeClaimEvent: 'stale-claim-retry-started',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 18,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 12,
        previousClaimSequence: 11,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          sequence: 20,
          event: 'apply-committed',
        },
      ],
      eventSummaries: [
        {
          event: 'apply-committed',
          count: 1,
          latestId: 20,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment accepts authoritative checked latestRows that retain public row claim lineage', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  const checkedSummary = structuredClone(inlineJournal);

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, true);
  assert.equal(parsed.dbJournal.claim.activeClaimId, 'authoritative-claim-hash-02');
  assert.equal(parsed.dbJournal.writerLease.claimId, 'authoritative-claim-hash-02');
  assert.deepEqual(parsed.dbJournal.latestRows, checkedSummary.latestRows);
});

test('checked db journal attachment keeps distinct accepted inline claim ids when claim-key hashes stay coherent', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claim.activeClaimId = 'authoritative-claim-id-02';
  inlineJournal.claim.previousClaimId = 'retry-claim-id-01';
  inlineJournal.claimEvidence.activeRow.claimId = 'authoritative-claim-id-02';
  inlineJournal.claimEvidence.abandonedRow.claimId = 'retry-claim-id-01';
  inlineJournal.claimEvidence.previousRow.claimId = 'retry-claim-id-01';
  inlineJournal.writerLease.claimId = 'authoritative-claim-id-02';
  inlineJournal.leaseFence.writerLease.claimId = 'authoritative-claim-id-02';
  inlineJournal.latestRows[0].claimId = 'authoritative-claim-id-02';
  const checkedSummary = structuredClone(inlineJournal);

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, true);
  assert.equal(parsed.dbJournal.claim.activeClaimId, 'authoritative-claim-id-02');
  assert.equal(parsed.dbJournal.claim.activeClaimKeyHash, 'authoritative-claim-hash-02');
  assert.equal(parsed.dbJournal.claim.previousClaimId, 'retry-claim-id-01');
  assert.equal(parsed.dbJournal.claim.previousClaimKeyHash, 'retry-claim-hash-01');
  assert.equal(parsed.dbJournal.writerLease.claimId, 'authoritative-claim-id-02');
  assert.equal(parsed.dbJournal.writerLease.claimKeyHash, 'authoritative-claim-hash-02');
  assert.equal(parsed.dbJournal.leaseFence.writerLease.claimId, 'authoritative-claim-id-02');
  assert.equal(parsed.dbJournal.leaseFence.writerLease.claimKeyHash, 'authoritative-claim-hash-02');
  assert.equal(parsed.dbJournal.latestRows[0].claimId, 'authoritative-claim-id-02');
  assert.equal(parsed.dbJournal.latestRows[0].claimKeyHash, 'authoritative-claim-hash-02');
});

test('checked db journal attachment fails closed when stale-claim row omits request hash', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      rowCount: 1,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when stale-claim rejected latest row omits accepted claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.latestRows[0] = {
    ...inlineJournal.latestRows[0],
  };
  delete inlineJournal.latestRows[0].claimId;

  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.latestRows[0].claimId = 'authoritative-claim-hash-02';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when stale-claim rejected latest row omits a distinct accepted active claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claim.activeClaimId = 'authoritative-claim-id-02';
  inlineJournal.claimEvidence.activeRow.claimId = 'authoritative-claim-id-02';
  inlineJournal.writerLease.claimId = 'authoritative-claim-id-02';
  inlineJournal.leaseFence.writerLease.claimId = 'authoritative-claim-id-02';
  inlineJournal.latestRows[0] = {
    ...inlineJournal.latestRows[0],
  };
  delete inlineJournal.latestRows[0].claimId;

  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.latestRows[0].claimId = 'authoritative-claim-id-02';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when accepted inline stale-claim latest row is omitted instead of backfilled from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.latestRows = [];

  const checkedSummary = structuredClone(buildAcceptedInlineDbJournal());

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.deepEqual(parsed.dbJournal.latestRows, []);
});

test('checked db journal attachment fails closed when stale-claim abandoned latest row diverges from accepted previous claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.latestRows.push({
    id: 34,
    event: 'stale-claim-abandoned',
    claimId: 'wrong-previous-claim-id',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    resourceHashEvidence: {
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  });
  inlineJournal.eventSummaries = [
    { event: 'stale-claim-rejected', count: 1, latestId: 33 },
    { event: 'stale-claim-abandoned', count: 1, latestId: 34 },
  ];

  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.latestRows[1].claimId = 'retry-claim-hash-01';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when stale-claim abandoned latest row omits a distinct accepted previous claim identity', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  inlineJournal.claim.previousClaimId = 'retry-claim-id-01';
  inlineJournal.claimEvidence.abandonedRow.claimId = 'retry-claim-id-01';
  inlineJournal.claimEvidence.previousRow.claimId = 'retry-claim-id-01';
  inlineJournal.latestRows.push({
    id: 34,
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    resourceHashEvidence: {
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  });
  inlineJournal.eventSummaries = [
    { event: 'stale-claim-rejected', count: 1, latestId: 33 },
    { event: 'stale-claim-abandoned', count: 1, latestId: 34 },
  ];

  const checkedSummary = structuredClone(inlineJournal);
  checkedSummary.latestRows[1].claimId = 'retry-claim-id-01';

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when accepted inline claim evidence row is omitted instead of backfilled from checked evidence', { skip: !hasPhp }, () => {
  const inlineJournal = buildAcceptedInlineDbJournal();
  delete inlineJournal.claimEvidence.abandonedRow;

  const checkedSummary = structuredClone(buildAcceptedInlineDbJournal());

  const result = runAttachCheckedDbJournalContract(
    { ok: true, dbJournal: inlineJournal },
    checkedSummary,
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
  assert.equal(parsed.dbJournal.claimEvidence.abandonedRow, undefined);
});

test('checked db journal attachment fails closed when stale-claim row omits idempotency hash', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'authoritative-claim-hash-02',
          activeClaimSequence: 33,
          activeClaimEvent: 'stale-claim-rejected',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 24,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 19,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimSequence: 18,
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 24,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:19',
            claimCursor: 'db-journal:18',
          },
          previousRow: {
            sequence: 18,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idem-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 33,
            event: 'stale-claim-rejected',
            claimKeyHash: 'authoritative-claim-hash-02',
            requestHash: 'request-hash-01',
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 33,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idem-hash-01',
            events: 1,
            requestHashes: 1,
            latestId: 33,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'authoritative-claim-hash-02',
        activeClaimSequence: 33,
        activeClaimEvent: 'stale-claim-rejected',
        idempotencyKeyHash: 'idem-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 24,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 19,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimSequence: 18,
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 24,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:19',
          claimCursor: 'db-journal:18',
        },
        previousRow: {
          sequence: 18,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
        },
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
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      latestRows: [
        {
          sequence: 33,
          event: 'stale-claim-rejected',
          claimKeyHash: 'authoritative-claim-hash-02',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 33,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idem-hash-01',
          events: 1,
          requestHashes: 1,
          latestId: 33,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when stale-claim evidence omits the rejected latest row', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 1,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 20,
          activeClaimEvent: 'stale-claim-retry-started',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 18,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 12,
          previousClaimSequence: 11,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimEvent: 'idempotency-opened',
        },
        claimEvidence: {
          activeRow: {
            sequence: 20,
            event: 'stale-claim-retry-started',
            claimKeyHash: 'retry-claim-hash-02',
            idempotencyKeyHash: 'idempotency-hash-01',
            requestHash: 'request-hash-01',
          },
          abandonedRow: {
            sequence: 18,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idempotency-hash-01',
            requestHash: 'request-hash-01',
            startedCursor: 'db-journal:12',
            claimCursor: 'db-journal:11',
          },
          previousRow: {
            sequence: 11,
            event: 'idempotency-opened',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idempotency-hash-01',
            requestHash: 'request-hash-01',
          },
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            sequence: 18,
            event: 'stale-claim-abandoned',
            claimKeyHash: 'retry-claim-hash-01',
            idempotencyKeyHash: 'idempotency-hash-01',
            requestHash: 'request-hash-01',
            resourceHashEvidence: {
              startedCursor: 'db-journal:12',
              claimCursor: 'db-journal:11',
            },
          },
        ],
        eventSummaries: [
          {
            event: 'stale-claim-abandoned',
            count: 1,
            latestId: 18,
          },
          {
            event: 'stale-claim-rejected',
            count: 1,
            latestId: 20,
          },
        ],
        idempotencyEvidence: [
          {
            idempotencyKeyHash: 'idempotency-hash-01',
            events: 3,
            requestHashes: 1,
            latestId: 20,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      schemaVersion: 1,
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 1,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 20,
        activeClaimEvent: 'stale-claim-retry-started',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 18,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 12,
        previousClaimSequence: 11,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimEvent: 'idempotency-opened',
      },
      claimEvidence: {
        activeRow: {
          sequence: 20,
          event: 'stale-claim-retry-started',
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
        },
        abandonedRow: {
          sequence: 18,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          startedCursor: 'db-journal:12',
          claimCursor: 'db-journal:11',
        },
        previousRow: {
          sequence: 11,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
        },
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
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      latestRows: [
        {
          sequence: 18,
          event: 'stale-claim-abandoned',
          claimKeyHash: 'retry-claim-hash-01',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          resourceHashEvidence: {
            startedCursor: 'db-journal:12',
            claimCursor: 'db-journal:11',
          },
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-abandoned',
          count: 1,
          latestId: 18,
        },
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 20,
        },
      ],
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idempotency-hash-01',
          events: 3,
          requestHashes: 1,
          latestId: 20,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
});

test('checked db journal attachment fails closed when stale-claim evidence omits positive row lineage', { skip: !hasPhp }, () => {
  const result = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        acceptedOnCheckedBoundary: true,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 2,
        claim: {
          status: 'stale-claim-rejected',
          activeClaimKeyHash: 'retry-claim-hash-02',
          activeClaimSequence: 20,
          activeClaimEvent: 'stale-claim-retry-started',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: true,
          abandonedSequence: 18,
          abandonedEvent: 'stale-claim-abandoned',
          previousStartedSequence: 12,
          previousClaimSequence: 11,
          previousClaimKeyHash: 'retry-claim-hash-01',
          previousClaimEvent: 'idempotency-opened',
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
        latestRows: [
          {
            id: 20,
            event: 'apply-committed',
          },
          {
            event: 'stale-claim-rejected',
          },
        ],
        eventSummaries: [
          {
            event: 'apply-committed',
            count: 1,
            latestId: 20,
          },
          {
            event: 'stale-claim-rejected',
            count: 1,
          },
        ],
      },
    },
    {
      acceptedOnCheckedBoundary: true,
      scope: 'checked live production-shaped journal surface; not local Playground fixture only',
      table: 'wp_reprint_push_lab_push_journal',
      rowCount: 2,
      claim: {
        status: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-02',
        activeClaimSequence: 20,
        activeClaimEvent: 'stale-claim-retry-started',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        staleClaimRejected: true,
        abandonedSequence: 18,
        abandonedEvent: 'stale-claim-abandoned',
        previousStartedSequence: 12,
        previousClaimSequence: 11,
        previousClaimKeyHash: 'retry-claim-hash-01',
        previousClaimEvent: 'idempotency-opened',
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
      latestRows: [
        {
          id: 20,
          event: 'apply-committed',
        },
        {
          event: 'stale-claim-rejected',
        },
      ],
      eventSummaries: [
        {
          event: 'apply-committed',
          count: 1,
          latestId: 20,
        },
        {
          event: 'stale-claim-rejected',
          count: 1,
        },
      ],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.dbJournal.acceptedOnCheckedBoundary, false);
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

test('db journal stale-claim evidence rejects retry-started markers without an actual rejection or abandonment record', { skip: !hasPhp }, () => {
  const fromRows = runHasStaleClaimRejectionEvidence([
    { sequence: 41, event: 'stale-claim-retry-started' },
  ]);
  assert.equal(fromRows.status, 0, fromRows.stderr);
  assert.equal(JSON.parse(fromRows.stdout), false);

  const fromEventSummaries = runHasStaleClaimRejectionEvidence(
    [
      { sequence: 61, event: 'apply-committed' },
    ],
    [
      { event: 'stale-claim-retry-in-progress', count: 1, latestId: 62 },
    ],
  );
  assert.equal(fromEventSummaries.status, 0, fromEventSummaries.stderr);
  assert.equal(JSON.parse(fromEventSummaries.stdout), false);
});

test('db journal stale-claim evidence rejects zero-count stale-claim summaries', { skip: !hasPhp }, () => {
  const fromEventSummaries = runHasStaleClaimRejectionEvidence(
    [
      { sequence: 61, event: 'apply-committed' },
    ],
    [
      { event: 'stale-claim-rejected', count: 0, latestId: 62 },
    ],
  );
  assert.equal(fromEventSummaries.status, 0, fromEventSummaries.stderr);
  assert.equal(JSON.parse(fromEventSummaries.stdout), false);
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

test('checked db journal boundary contract keeps ownership restart readability aligned with authoritative checked lease evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContract({
    checkedSurface: true,
    staleClaimRejected: true,
    claimKeyUnique: true,
    monotonicSequence: true,
    restartReadable: false,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    ownership: {
      ownsJournal: true,
      restartReadable: false,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: false,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: false,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: false,
        staleClaimRejected: true,
      },
    },
  });
});

test('checked db journal boundary contract carries the active claim id into both writer-lease surfaces', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContract({
    checkedSurface: true,
    staleClaimRejected: true,
    claimKeyUnique: true,
    monotonicSequence: true,
    restartReadable: true,
    claimId: 'checked-claim-hash-01',
    claimKeyHash: 'checked-claim-key-hash-01',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).writerLease.claimId, 'checked-claim-hash-01');
  assert.equal(JSON.parse(result.stdout).leaseFence.writerLease.claimId, 'checked-claim-hash-01');
  assert.equal(JSON.parse(result.stdout).writerLease.claimKeyHash, 'checked-claim-key-hash-01');
  assert.equal(JSON.parse(result.stdout).leaseFence.writerLease.claimKeyHash, 'checked-claim-key-hash-01');
});

test('checked db journal boundary contract fails closed when the checked claim contract is missing or malformed', { skip: !hasPhp }, () => {
  const baseJournal = structuredClone(buildAcceptedInlineDbJournal());

  let result = runCheckedBoundaryContractMatches(baseJournal);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), true);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claim: undefined,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claimEvidence: undefined,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claim: {
      ...baseJournal.claim,
      activeClaimSequence: 0,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claim: {
      ...baseJournal.claim,
      previousClaimId: undefined,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claimEvidence: {
      ...baseJournal.claimEvidence,
      activeRow: {
        ...baseJournal.claimEvidence.activeRow,
        sequence: 21,
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claimEvidence: {
      ...baseJournal.claimEvidence,
      activeRow: {
        ...baseJournal.claimEvidence.activeRow,
        claimId: undefined,
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claimEvidence: {
      ...baseJournal.claimEvidence,
      abandonedRow: {
        ...baseJournal.claimEvidence.abandonedRow,
        claimId: undefined,
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    claimEvidence: {
      ...baseJournal.claimEvidence,
      previousRow: {
        ...baseJournal.claimEvidence.previousRow,
        claimId: undefined,
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    writerLease: {
      ...baseJournal.writerLease,
      claimId: 'different-active-claim-id',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    writerLease: {
      ...baseJournal.writerLease,
      claimKeyHash: 'different-active-claim-key-hash',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract accepts distinct claim ids when claim-key hashes stay coherent', { skip: !hasPhp }, () => {
  const baseJournal = structuredClone(buildAcceptedInlineDbJournal());
  baseJournal.claim.activeClaimId = 'authoritative-claim-id-02';
  baseJournal.claim.previousClaimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.activeRow.claimId = 'authoritative-claim-id-02';
  baseJournal.claimEvidence.abandonedRow.claimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.previousRow.claimId = 'retry-claim-id-01';
  baseJournal.writerLease.claimId = 'authoritative-claim-id-02';
  baseJournal.leaseFence.writerLease.claimId = 'authoritative-claim-id-02';
  baseJournal.latestRows[0].claimId = 'authoritative-claim-id-02';

  const result = runCheckedBoundaryContractMatches(baseJournal);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), true);
});

test('checked db journal boundary contract fails closed when a stale-claim rejected latest row omits a distinct active claim id', { skip: !hasPhp }, () => {
  const baseJournal = structuredClone(buildAcceptedInlineDbJournal());
  baseJournal.claim.activeClaimId = 'authoritative-claim-id-02';
  baseJournal.claim.previousClaimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.activeRow.claimId = 'authoritative-claim-id-02';
  baseJournal.claimEvidence.abandonedRow.claimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.previousRow.claimId = 'retry-claim-id-01';
  baseJournal.writerLease.claimId = 'authoritative-claim-id-02';
  baseJournal.leaseFence.writerLease.claimId = 'authoritative-claim-id-02';
  delete baseJournal.latestRows[0].claimId;

  const result = runCheckedBoundaryContractMatches(baseJournal);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when a stale-claim abandoned latest row omits a distinct previous claim id', { skip: !hasPhp }, () => {
  const baseJournal = structuredClone(buildAcceptedInlineDbJournal());
  baseJournal.claim.activeClaimId = 'authoritative-claim-id-02';
  baseJournal.claim.previousClaimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.activeRow.claimId = 'authoritative-claim-id-02';
  baseJournal.claimEvidence.abandonedRow.claimId = 'retry-claim-id-01';
  baseJournal.claimEvidence.previousRow.claimId = 'retry-claim-id-01';
  baseJournal.writerLease.claimId = 'authoritative-claim-id-02';
  baseJournal.leaseFence.writerLease.claimId = 'authoritative-claim-id-02';
  baseJournal.latestRows.push({
    sequence: 24,
    event: 'stale-claim-abandoned',
    claimKeyHash: 'retry-claim-hash-01',
    idempotencyKeyHash: 'idem-hash-01',
    requestHash: 'request-hash-01',
    resourceHashEvidence: {
      startedCursor: 'db-journal:19',
      claimCursor: 'db-journal:18',
    },
  });
  baseJournal.eventSummaries = [
    {
      event: 'stale-claim-rejected',
      count: 1,
      latestId: 33,
    },
    {
      event: 'stale-claim-abandoned',
      count: 1,
      latestId: 24,
    },
  ];

  const result = runCheckedBoundaryContractMatches(baseJournal);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when stale-claim rejection is claimed without persisted stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
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
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        sequence: 20,
        event: 'apply-committed',
      },
    ],
    eventSummaries: [
      {
        event: 'apply-committed',
        count: 1,
        latestId: 20,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when ownership is not restart-readable', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
    ],
    ownership: {
      ownsJournal: true,
      restartReadable: false,
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
    latestRows: [
      {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when lease-fence boundary diverges from ownership and storage guard evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      boundary: 'mysql-advisory-lock-lease',
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
    latestRows: [
      {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when stale-claim rejection evidence predates the checked claim lineage', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        id: 10,
        sequence: 10,
        event: 'stale-claim-rejected',
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 10,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when only event summaries retain stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when stale-claim rejection row names only the previous rejected lineage', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-03',
      activeClaimSequence: 47,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 20,
      previousClaimKeyHash: 'retry-claim-hash-02',
      previousClaimEvent: 'stale-claim-retry-started',
    },
    claimEvidence: {
      activeRow: {
        sequence: 47,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-03',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:20',
      },
      previousRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 4,
        requestHashes: 1,
        latestId: 47,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 48,
      },
      {
        event: 'stale-claim-rejected',
        sequence: 47,
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 47,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when authoritative latest rows disagree on id and sequence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'stale-claim-rejected',
        id: 20,
        sequence: 19,
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-rejected', count: 1, latestId: 20 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when only contradictory latest rows can satisfy stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
      {
        event: 'stale-claim-rejected',
        id: 20,
        sequence: 19,
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-rejected', count: 1, latestId: 10 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when only another claim lineage satisfies stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
      {
        event: 'stale-claim-rejected',
        sequence: 20,
        claimKeyHash: 'retry-claim-hash-unrelated',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-rejected', count: 1, latestId: 20 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when active rejected claim evidence omits the rejected row claim hash', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
      {
        event: 'stale-claim-rejected',
        sequence: 20,
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-rejected', count: 1, latestId: 20 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when stale-claim rejected rows omit claim hash after retry-started active claim events', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'stale-claim-rejected',
        sequence: 20,
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-rejected', count: 1, latestId: 20 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when only an abandoned-row cursor drift can satisfy stale-claim evidence', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
      {
        event: 'stale-claim-abandoned',
        sequence: 18,
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        resourceHashEvidence: {
          startedCursor: 'db-journal:77',
          claimCursor: 'db-journal:66',
        },
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-abandoned', count: 1, latestId: 18 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when abandoned-row claim hash is omitted', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'apply-committed',
        sequence: 21,
      },
      {
        event: 'stale-claim-abandoned',
        sequence: 18,
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        resourceHashEvidence: {
          startedCursor: 'db-journal:12',
          claimCursor: 'db-journal:11',
        },
      },
    ],
    eventSummaries: [
      { event: 'stale-claim-abandoned', count: 1, latestId: 18 },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when abandoned-row idempotency hash is omitted', { skip: !hasPhp }, () => {
  const result = runCheckedBoundaryContractMatches({
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 2,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
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
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimKeyHash: 'retry-claim-hash-01',
        requestHash: 'request-hash-01',
        resourceHashEvidence: {
          startedCursor: 'db-journal:12',
          claimCursor: 'db-journal:11',
        },
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-abandoned',
        count: 1,
        latestId: 18,
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

test('checked db journal boundary contract fails closed when persisted journal arrays omit meaningful event evidence', { skip: !hasPhp }, () => {
  const baseJournal = {
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
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
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    latestRows: [
      {
        event: 'stale-claim-rejected',
        sequence: 20,
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
  };

  let result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    latestRows: [
      {
        sequence: 20,
      },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    eventSummaries: [
      {
        count: 1,
        latestId: 20,
      },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);

  result = runCheckedBoundaryContractMatches({
    ...baseJournal,
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 0,
        latestId: 20,
      },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
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

test('checked db journal merge preserves custom writer lease evidence when accepted inline anchors still disagree', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'custom-inline-adapter',
      },
      writerLease: {
        strategy: 'custom-inline-writer',
        claimKeyUnique: false,
        fsyncEvidence: true,
        storageGuard: 'custom-inline-guard',
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'custom-inline-boundary',
        claimKeyUnique: false,
        fsyncEvidence: true,
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'custom-inline-writer',
          claimKeyUnique: false,
          fsyncEvidence: true,
          storageGuard: 'custom-inline-guard',
          monotonicSequence: false,
          restartReadable: false,
          staleClaimRejected: true,
        },
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
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    acceptedOnCheckedBoundary: true,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'custom-inline-adapter',
    },
    writerLease: {
      strategy: 'custom-inline-writer',
      claimKeyUnique: false,
      fsyncEvidence: true,
      storageGuard: 'custom-inline-guard',
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'custom-inline-boundary',
      claimKeyUnique: false,
      fsyncEvidence: true,
      monotonicSequence: false,
      restartReadable: false,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'custom-inline-writer',
        claimKeyUnique: false,
        fsyncEvidence: true,
        storageGuard: 'custom-inline-guard',
        monotonicSequence: false,
        restartReadable: false,
        staleClaimRejected: true,
      },
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

test('checked db journal merge replaces conflicting accepted nested adapter and storage-guard strings with the authoritative checked contract', { skip: !hasPhp }, () => {
  const result = runMerge(
    {
      acceptedOnCheckedBoundary: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'mysql-advisory-lock-lease',
      },
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'mysql-advisory-lock-lease',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
      leaseFence: {
        boundary: 'mysql-advisory-lock-lease',
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
        writerLease: {
          strategy: 'claim-fenced-single-writer',
          claimKeyUnique: true,
          fsyncEvidence: true,
          storageGuard: 'mysql-advisory-lock-lease',
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

test('checked db journal attachment fails closed when persisted journal rows omit positive row identity', { skip: !hasPhp }, () => {
  const missingLatestRowIds = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 3,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        latestRows: [
          { event: 'idempotency-opened' },
          { event: 'mutation-applied' },
          { event: 'apply-committed' },
        ],
        eventSummaries: [
          { event: 'apply-committed', count: 1, latestId: 3 },
        ],
        claim: {
          status: 'active',
          activeClaimKeyHash: 'active-claim-hash-01',
          activeClaimSequence: 3,
          activeClaimEvent: 'idempotency-opened',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
    },
  );

  assert.equal(missingLatestRowIds.status, 0, missingLatestRowIds.stderr);
  assert.equal(JSON.parse(missingLatestRowIds.stdout).dbJournal.acceptedOnCheckedBoundary, false);

  const missingSummaryLatestIds = runAttachCheckedDbJournalContract(
    {
      ok: true,
      dbJournal: {
        acceptedOnCheckedBoundary: true,
        schemaVersion: 1,
        table: 'wp_reprint_push_lab_push_journal',
        rowCount: 3,
        scope: 'checked live production-shaped journal surface; not local Playground fixture only',
        latestRows: [
          { event: 'idempotency-opened', id: 1 },
          { event: 'mutation-applied', id: 2 },
          { event: 'apply-committed', id: 3 },
        ],
        eventSummaries: [
          { event: 'apply-committed', count: 1 },
        ],
        claim: {
          status: 'active',
          activeClaimKeyHash: 'active-claim-hash-01',
          activeClaimSequence: 3,
          activeClaimEvent: 'idempotency-opened',
          idempotencyKeyHash: 'idem-hash-01',
          requestHash: 'request-hash-01',
          staleClaimRejected: false,
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
        storageGuard: {
          boundary: 'wpdb-single-statement-cas',
          operation: 'update',
          outcome: 'applied',
        },
      },
    },
    {
      acceptedOnCheckedBoundary: true,
    },
  );

  assert.equal(missingSummaryLatestIds.status, 0, missingSummaryLatestIds.stderr);
  assert.equal(JSON.parse(missingSummaryLatestIds.stdout).dbJournal.acceptedOnCheckedBoundary, false);
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
      scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
    scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
    scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
    scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
    scope: 'packaged production journal scope',
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
      scope: 'packaged production journal scope',
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
