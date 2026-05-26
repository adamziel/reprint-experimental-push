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
