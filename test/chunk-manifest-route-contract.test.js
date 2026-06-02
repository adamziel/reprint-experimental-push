import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const restSource = readFileSync(restSourcePath, 'utf8');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runPhp(code) {
  const result = spawnSync('php', ['-r', code], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function functionBody(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

test('chunk manifest protocol accepts only contiguous hash-only file transfer manifests', () => {
  const report = runPhp(`
    if (!function_exists('apply_filters')) {
        function apply_filters($hook_name, $value) { return $value; }
    }
    if (!function_exists('wp_json_encode')) {
        function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
    }
    require 'scripts/playground/snapshot-lib.php';
    require 'scripts/playground/push-remote-lib.php';

    function rpp_capture_chunk_manifest(callable $callback): array {
        try {
            return $callback();
        } catch (Reprint_Push_Protocol_Error $error) {
            return $error->result;
        }
    }

    $valid = [
        'planId' => 'plan-chunk-route-contract',
        'resourceKey' => 'file:wp-content/uploads/reprint-push/large.bin',
        'resource' => ['type' => 'file', 'path' => 'wp-content/uploads/reprint-push/large.bin'],
        'fileBytes' => 6,
        'chunkSizeBytes' => 2,
        'localResourceHash' => 'sha256:' . str_repeat('d', 64),
        'assembledHash' => 'sha256:' . str_repeat('e', 64),
        'entries' => [
            [
                'chunkIndex' => 0,
                'offsetBytes' => 0,
                'sizeBytes' => 2,
                'chunkDigest' => 'sha256:' . str_repeat('a', 64),
                'receiptKey' => 'receipt-secret-0',
                'idempotencyKey' => 'idem-secret-0',
            ],
            [
                'chunkIndex' => 1,
                'offsetBytes' => 2,
                'sizeBytes' => 2,
                'chunkDigest' => 'sha256:' . str_repeat('b', 64),
                'receiptKey' => 'receipt-secret-1',
                'idempotencyKey' => 'idem-secret-1',
            ],
            [
                'chunkIndex' => 2,
                'offsetBytes' => 4,
                'sizeBytes' => 2,
                'chunkDigest' => 'sha256:' . str_repeat('c', 64),
                'receiptKey' => 'receipt-secret-2',
                'idempotencyKey' => 'idem-secret-2',
            ],
        ],
    ];
    $wrapped = ['manifest' => $valid];
    $forged_key = $valid;
    $forged_key['resourceKey'] = 'file:wp-content/uploads/reprint-push/other.bin';
    $non_contiguous = $valid;
    $non_contiguous['entries'][1]['offsetBytes'] = 3;
    $raw_payload = $valid;
    $raw_payload['entries'][0]['chunkBody'] = 'secret raw bytes';
    $short_receipts = $valid;
    array_pop($short_receipts['entries']);
    $string_index = $valid;
    $string_index['entries'][1]['chunkIndex'] = '1';
    $unbounded_path = $valid;
    $unbounded_path['resource']['path'] = '../wp-content/uploads/reprint-push/large.bin';

    echo json_encode([
        'valid' => rpp_capture_chunk_manifest(static function () use ($valid): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($valid);
        }),
        'wrapped' => rpp_capture_chunk_manifest(static function () use ($wrapped): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($wrapped);
        }),
        'forgedKey' => rpp_capture_chunk_manifest(static function () use ($forged_key): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($forged_key);
        }),
        'nonContiguous' => rpp_capture_chunk_manifest(static function () use ($non_contiguous): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($non_contiguous);
        }),
        'rawPayload' => rpp_capture_chunk_manifest(static function () use ($raw_payload): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($raw_payload);
        }),
        'shortReceipts' => rpp_capture_chunk_manifest(static function () use ($short_receipts): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($short_receipts);
        }),
        'stringIndex' => rpp_capture_chunk_manifest(static function () use ($string_index): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($string_index);
        }),
        'unboundedPath' => rpp_capture_chunk_manifest(static function () use ($unbounded_path): array {
            return reprint_push_protocol_validate_chunk_manifest_payload($unbounded_path);
        }),
    ], JSON_THROW_ON_ERROR);
  `);

  assert.equal(report.valid.ok, true);
  assert.equal(report.valid.code, 'CHUNK_MANIFEST_ACCEPTED');
  assert.equal(report.valid.mode, 'chunk-manifest');
  assert.equal(report.valid.mutationAttempted, false);
  assert.equal(report.valid.chunkManifest.status, 'accepted');
  assert.equal(report.valid.chunkManifest.resourceKey, 'file:wp-content/uploads/reprint-push/large.bin');
  assert.equal(report.valid.chunkManifest.fileBytes, 6);
  assert.equal(report.valid.chunkManifest.chunkSizeBytes, 2);
  assert.equal(report.valid.chunkManifest.chunkCount, 3);
  assert.equal(report.valid.chunkManifest.byteRangeCoverage.contiguous, true);
  assert.equal(report.valid.chunkManifest.byteRangeCoverage.coveredBytes, 6);
  assert.equal(report.valid.chunkManifest.rawValuesIncluded, false);
  assert.match(report.valid.chunkManifest.entryDigest, sha256EvidencePattern);
  assert.match(report.valid.chunkManifest.manifestEvidenceHash, sha256EvidencePattern);
  assert.equal(report.valid.chunkManifest.entries.every((entry) => entry.canonicalVisible === false), true);
  assert.equal(JSON.stringify(report.valid).includes('receipt-secret'), false);
  assert.equal(JSON.stringify(report.valid).includes('idem-secret'), false);
  assert.deepEqual(report.wrapped, report.valid);

  for (const key of ['forgedKey', 'nonContiguous', 'rawPayload', 'shortReceipts', 'stringIndex', 'unboundedPath']) {
    assert.equal(report[key].ok, false, key);
    assert.equal(report[key].code, 'INVALID_CHUNK_MANIFEST', key);
    assert.equal(report[key].mode, 'chunk-manifest', key);
    assert.equal(report[key].mutationAttempted, false, key);
  }
  assert.equal(report.forgedKey.message, 'Chunk manifest resourceKey is not canonical for resource object.');
  assert.equal(report.nonContiguous.message, 'Chunk manifest byte ranges must be contiguous.');
  assert.equal(report.rawPayload.message, 'Chunk manifest must not include raw chunk payloads at $.manifest.entries[0].chunkBody.');
  assert.equal(report.shortReceipts.message, 'Chunk manifest entry count does not match file and chunk sizes.');
  assert.equal(report.stringIndex.message, 'Chunk manifest entry chunkIndex must be a non-negative integer.');
  assert.equal(report.unboundedPath.message, 'Chunk manifest file resource path must be a bounded wp-content relative path.');
});

test('REST plugin exposes signed chunk manifest routes without apply-capable work', () => {
  const callback = functionBody(restSource, 'reprint_push_lab_rest_authenticated_chunk_manifest');
  const uploadCallback = functionBody(restSource, 'reprint_push_lab_rest_authenticated_chunk_upload');
  const uploadResponse = functionBody(restSource, 'reprint_push_lab_rest_chunk_upload_response');
  const uploadStore = functionBody(restSource, 'reprint_push_lab_rest_store_chunk_upload');

  assert.match(restSource, /'\/authenticated\/chunk-manifest'/);
  assert.match(restSource, /'\/push\/chunk-manifest'/);
  assert.match(restSource, /'\/authenticated\/chunks'/);
  assert.match(restSource, /'\/push\/chunks'/);
  assert.match(callback, /reprint_push_lab_rest_require_signed_request\(\$request, 'chunk-manifest'\)/);
  assert.match(callback, /reprint_push_protocol_validate_chunk_manifest_payload\(\$payload\)/);
  assert.match(callback, /reprint_push_lab_rest_attach_authenticated_response_evidence\(\$result, \$request\)/);
  assert.match(callback, /'mutationAttempted'\s*=>\s*false/);
  assert.doesNotMatch(callback, /reprint_push_lab_rest_apply_with_db_journal|reprint_push_protocol_run_payload|reprint_push_apply_mutation/);
  assert.match(uploadCallback, /reprint_push_lab_rest_require_signed_request\(\$request, 'chunk-upload'\)/);
  assert.doesNotMatch(uploadCallback, /reprint_push_lab_rest_json_payload/);
  assert.match(uploadResponse, /\$raw_body\s*=\s*\(string\) \$request->get_body\(\)/);
  assert.match(uploadResponse, /hash\('sha256', \$raw_body\)/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_journal_context/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_receipt_row_for_key_request/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_rejection_row_for_key_request/);
  assert.match(uploadResponse, /reprint_push_lab_db_journal_key_has_different_request/);
  assert.match(uploadResponse, /reprint_push_lab_db_journal_try_open_idempotency/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_idempotency_conflict_result/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_in_progress_result/);
  assert.match(uploadResponse, /reprint_push_lab_rest_chunk_upload_rejected_result/);
  assert.match(uploadResponse, /reprint_push_lab_rest_store_chunk_upload/);
  assert.match(uploadStore, /reprint_push_lab_rest_chunk_upload_staging_root/);
  assert.match(restSource, /WP_CONTENT_DIR/);
  assert.match(restSource, /reprint-push-private\/chunks/);
  assert.match(restSource, /private-plan-staging/);
  assert.match(restSource, /reprint_push_lab_rest_signed_metadata_hash/);
  assert.match(restSource, /reprint_push_lab_rest_chunk_upload_signed_metadata/);
  assert.match(restSource, /X-Reprint-Push-Metadata-Hash/);
  assert.match(restSource, /SIGNED_METADATA_HASH_MISMATCH/);
  assert.match(restSource, /CHUNK_UPLOAD_ALREADY_ACCEPTED/);
  assert.match(restSource, /reprint_push_lab_rest_chunk_upload_replay_rejected_result/);
  assert.match(restSource, /chunk-idempotency-key-conflict/);
  assert.match(restSource, /chunk-idempotency-in-progress/);
  assert.match(restSource, /chunk-rejected/);
  assert.match(restSource, /case 'INVALID_CHUNK_MANIFEST':/);
  assert.match(restSource, /case 'INVALID_CHUNK_UPLOAD':/);
  assert.match(restSource, /case 'SIGNED_METADATA_HASH_MISMATCH':/);
  assert.match(uploadStore, /file_put_contents\(\$staging_path, \$raw_body, LOCK_EX\)/);
  assert.match(uploadResponse, /reprint_push_lab_db_journal_append_event\('chunk-receipt'/);
  assert.match(uploadResponse, /'rawValuesIncluded'\s*=>\s*false/);
  assert.match(uploadResponse, /'canonicalVisible'\s*=>\s*false/);
  assert.match(uploadResponse, /'freshMutationWork'\s*=>\s*false/);
  assert.match(uploadResponse, /'freshStagingWork'\s*=>\s*true/);
  assert.doesNotMatch(uploadResponse, /reprint_push_lab_rest_json_payload|reprint_push_lab_rest_apply_with_db_journal|reprint_push_protocol_run_payload|reprint_push_apply_mutation/);
  assert.match(restSource, /snapshot hashes, chunk manifest, chunk upload, apply/);
});

test('chunk upload metadata hash binds signed server-side headers', () => {
  const report = runPhp(`
    define('ABSPATH', '/tmp/');
    class WP_REST_Request {
        private $headers;
        private $body;
        private $method;
        public function __construct(array $headers = [], string $body = '', string $method = 'POST') {
            $this->headers = $headers;
            $this->body = $body;
            $this->method = $method;
        }
        public function get_header($name) {
            return $this->headers[strtolower((string) $name)] ?? '';
        }
        public function get_body() {
            return $this->body;
        }
        public function get_method() {
            return $this->method;
        }
    }
    class WP_REST_Response {}
    class WP_REST_Server {
        public const CREATABLE = 'POST';
        public const READABLE = 'GET';
    }
    function add_filter(...$args) {}
    function add_action(...$args) {}

    require 'scripts/playground/push-remote-rest-plugin.php';

    $headers = [
        'x-reprint-push-plan-id' => 'plan-chunk-metadata',
        'x-reprint-push-resource-key' => 'file:wp-content/uploads/reprint-push/large.bin',
        'x-reprint-push-local-resource-hash' => 'sha256:' . str_repeat('d', 64),
        'x-reprint-push-manifest-hash' => 'sha256:' . str_repeat('e', 64),
        'x-reprint-push-chunk-index' => '2',
        'x-reprint-push-chunk-offset' => '10',
        'x-reprint-push-chunk-size' => '5',
        'x-reprint-push-chunk-digest' => 'sha256:' . str_repeat('f', 64),
    ];
    $metadata = reprint_push_lab_rest_chunk_upload_signed_metadata(new WP_REST_Request($headers));
    $metadata_hash = 'sha256:' . hash('sha256', reprint_push_stable_json($metadata));
    $signed_headers = $headers + ['x-reprint-push-metadata-hash' => $metadata_hash];
    $tampered_headers = $signed_headers;
    $tampered_headers['x-reprint-push-resource-key'] = 'file:wp-content/uploads/reprint-push/other.bin';
    $_SERVER['REQUEST_URI'] = '/wp-json/reprint/v1/push/chunks?b=2&a=1';
    $canonical = reprint_push_lab_rest_push_canonical_string(
        new WP_REST_Request($signed_headers, 'raw', 'POST'),
        hash('sha256', 'raw'),
        'psh_chunkmetadatasession',
        'chunk-metadata-idempotency',
        $metadata_hash
    );

    echo json_encode([
        'ok' => reprint_push_lab_rest_signed_metadata_hash(new WP_REST_Request($signed_headers), 'chunk-upload'),
        'tampered' => reprint_push_lab_rest_signed_metadata_hash(new WP_REST_Request($tampered_headers), 'chunk-upload'),
        'missing' => reprint_push_lab_rest_signed_metadata_hash(new WP_REST_Request($headers), 'chunk-upload'),
        'ignoredForDryRun' => reprint_push_lab_rest_signed_metadata_hash(new WP_REST_Request($headers), 'dry-run'),
        'canonical' => $canonical,
    ], JSON_THROW_ON_ERROR);
  `);

  const chunkDigest = `sha256:${'f'.repeat(64)}`;
  const expectedMetadataHash = `sha256:${digest({
    schemaVersion: 1,
    mode: 'chunk-upload',
    planId: 'plan-chunk-metadata',
    resourceKey: 'file:wp-content/uploads/reprint-push/large.bin',
    localResourceHash: `sha256:${'d'.repeat(64)}`,
    manifestHash: `sha256:${'e'.repeat(64)}`,
    chunkIndex: '2',
    offsetBytes: '10',
    sizeBytes: '5',
    chunkDigest,
  })}`;

  assert.equal(report.ok.ok, true);
  assert.equal(report.ok.metadataHash, expectedMetadataHash);
  assert.equal(report.tampered.ok, false);
  assert.equal(report.tampered.code, 'SIGNED_METADATA_HASH_MISMATCH');
  assert.equal(report.missing.ok, false);
  assert.equal(report.missing.code, 'SIGNED_METADATA_HASH_REQUIRED');
  assert.equal(report.ignoredForDryRun.ok, true);
  assert.equal(report.ignoredForDryRun.metadataHash, '');
  assert.equal(report.canonical.metadataHash, expectedMetadataHash);
  assert.ok(report.canonical.string.endsWith(`\n${expectedMetadataHash}`));
});

test('authenticated client sends signed chunk uploads as raw octet streams', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        code: 'CHUNK_UPLOAD_ACCEPTED',
        chunkReceipt: {
          schemaVersion: 1,
          type: 'chunk-upload-receipt',
          sizeBytes: body.byteLength,
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const client = authenticatedHttpClient({
      sourceUrl: `http://127.0.0.1:${port}`,
      credential: {
        username: 'admin',
        password: 'application-password',
      },
      routeProfile: 'production-shaped',
    });
    const rawChunk = Buffer.from([0, 1, 2, 3, 255]);
    const localResourceHash = `sha256:${'d'.repeat(64)}`;
    const manifestHash = `sha256:${'e'.repeat(64)}`;
    const chunkDigest = `sha256:${sha256Hex(rawChunk)}`;
    const expectedMetadataHash = `sha256:${digest({
      schemaVersion: 1,
      mode: 'chunk-upload',
      planId: 'plan-chunk-upload',
      resourceKey: 'file:wp-content/uploads/reprint-push/large.bin',
      localResourceHash,
      manifestHash,
      chunkIndex: '2',
      offsetBytes: '10',
      sizeBytes: String(rawChunk.byteLength),
      chunkDigest,
    })}`;
    const response = await client.signedChunkUpload(rawChunk, {
      session: 'psh_chunkuploadsession',
      idempotencyKey: 'chunk-upload-idempotency-key',
      planId: 'plan-chunk-upload',
      resourceKey: 'file:wp-content/uploads/reprint-push/large.bin',
      localResourceHash,
      manifestHash,
      chunkIndex: 2,
      offsetBytes: 10,
      nonce: 'chunk-upload-nonce',
      timestamp: '1770000000',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.request.pathname, '/wp-json/reprint/v1/push/chunks');
    assert.equal(response.request.contentHash, sha256Hex(rawChunk));
    assert.equal(response.request.metadataHash, expectedMetadataHash);
    assert.equal(response.request.chunkDigest, chunkDigest);
    assert.equal(response.request.chunkIndex, 2);
    assert.equal(response.request.offsetBytes, 10);
    assert.equal(response.request.sizeBytes, rawChunk.byteLength);

    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/wp-json/reprint/v1/push/chunks');
    assert.equal(request.headers['content-type'], 'application/octet-stream');
    assert.equal(request.headers['x-auth-content-hash'], sha256Hex(rawChunk));
    assert.equal(request.headers['x-reprint-push-metadata-hash'], expectedMetadataHash);
    assert.equal(request.headers['x-reprint-push-session'], 'psh_chunkuploadsession');
    assert.equal(request.headers['x-reprint-push-idempotency-key'], 'chunk-upload-idempotency-key');
    assert.equal(request.headers['x-reprint-push-plan-id'], 'plan-chunk-upload');
    assert.equal(request.headers['x-reprint-push-resource-key'], 'file:wp-content/uploads/reprint-push/large.bin');
    assert.equal(request.headers['x-reprint-push-local-resource-hash'], localResourceHash);
    assert.equal(request.headers['x-reprint-push-manifest-hash'], manifestHash);
    assert.equal(request.headers['x-reprint-push-chunk-index'], '2');
    assert.equal(request.headers['x-reprint-push-chunk-offset'], '10');
    assert.equal(request.headers['x-reprint-push-chunk-size'], String(rawChunk.byteLength));
    assert.equal(request.headers['x-reprint-push-chunk-digest'], chunkDigest);
    assert.deepEqual(request.body, rawChunk);
    assert.equal(request.body.toString('utf8').startsWith('{'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
