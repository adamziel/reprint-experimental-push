#!/usr/bin/env node
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const REMOTE_HASH_PAGINATION_BENCHMARK_ID = 'rpp-0711-remote-hash-pagination';
export const REMOTE_HASH_CURSOR_FORMAT = 'snapcursor:{sourceHashPrefix}:{scopeHashPrefix}:{offset}';
export const REMOTE_HASH_CURSOR_PATTERN = /^snapcursor:([a-f0-9]{16}):([a-f0-9]{16}):(\d+)$/;
export const REMOTE_HASH_MAX_BATCH_SIZE = 1000;

const DEFAULT_RESOURCE_COUNT = 2505;
const DEFAULT_BATCH_SIZE = 400;
const DEFAULT_MAX_DURATION_MS = 5000;
const DEFAULT_MAX_HEAP_USED_BYTES = 128 * 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'remote hash pagination raw fixture',
  'pagination-secret',
  'private row value',
]);

export class RemoteHashPaginationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RemoteHashPaginationError';
    this.code = code;
    this.details = details;
  }
}

export function runRemoteHashPaginationBenchmark(options = {}) {
  const started = performance.now();
  const config = benchmarkConfig(options);
  const source = config.source;
  const scope = config.scope;
  const sourceHash = remoteHashSourceHash(source);
  const scopeHash = remoteHashScopeHash(scope);
  const resources = buildRemoteHashResources(config.resourceCount, { seed: config.seed });
  const pageWalk = walkRemoteHashPages({
    resources,
    source,
    scope,
    batchSize: config.batchSize,
  });
  const repeatedPageWalk = walkRemoteHashPages({
    resources: [...resources].reverse(),
    source,
    scope,
    batchSize: config.batchSize,
  });
  const errorPaths = exerciseErrorPaths({ source, scope, sourceHash, scopeHash, resources });
  const durationMs = elapsedMs(started);
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const deterministicCoverage = {
    pageCount: pageWalk.pages.length,
    resourceCount: resources.length,
    uniqueResourceCount: pageWalk.uniqueResourceCount,
    duplicateResourceKeys: pageWalk.duplicateResourceKeys,
    emptyPageCount: pageWalk.pages.filter((page) => page.resources.length === 0).length,
    completePageCount: pageWalk.pages.filter((page) => page.complete).length,
    cursorCount: pageWalk.pages.filter((page) => page.cursor !== null).length,
    pageHashesStable: stablePageHashes(pageWalk, repeatedPageWalk),
    planningOnlyPages: pageWalk.pages.filter((page) => (
      page.planningOnly.readOnly === true
        && page.planningOnly.mutates === false
        && page.planningOnly.authority === 'planning-evidence-only'
    )).length,
    errorPaths,
    rawValueEvidenceLeaks: pageWalk.pages.filter(evidenceContainsRawFixtureData).length,
  };
  const gates = buildGates({ config, durationMs, memory, pageWalk, repeatedPageWalk, deterministicCoverage });
  const ok = gates.every((gate) => gate.status === 'pass');

  return {
    schemaVersion: 1,
    rppId: 'RPP-0711',
    benchmark: REMOTE_HASH_PAGINATION_BENCHMARK_ID,
    ok,
    mode: 'deterministic-no-live-remote',
    runtime: {
      generatedAt: config.now.toISOString(),
      durationMs,
      node: process.version,
      platform: process.platform,
      budgets: {
        maxDurationMs: config.maxDurationMs,
        maxHeapUsedBytes: config.maxHeapUsedBytes,
      },
      liveRemoteService: {
        status: 'unavailable',
        unavailableCapabilities: ['live-wordpress-remote-service'],
        detail: 'No live remote service was supplied; benchmark ran deterministic pagination, configuration, and error-path coverage only.',
      },
    },
    resources: {
      remoteHashes: {
        cursorFormat: REMOTE_HASH_CURSOR_FORMAT,
        maxBatchSize: REMOTE_HASH_MAX_BATCH_SIZE,
        requestedBatchSize: config.batchSize,
        resourceCount: resources.length,
        pageCount: pageWalk.pages.length,
        complete: pageWalk.complete,
        duplicateResourceKeys: pageWalk.duplicateResourceKeys,
        sourceHash,
        scopeHash,
        snapshotHashSetHash: pageWalk.snapshotHashSetHash,
      },
      process: {
        heapUsedBytes: memory.heapUsed,
        rssBytes: memory.rss,
        userCpuMs: microsecondsToMilliseconds(cpu.user),
        systemCpuMs: microsecondsToMilliseconds(cpu.system),
      },
    },
    gates,
    deterministicCoverage,
    limitations: [
      'No live remote WordPress service was available in this sandbox run.',
      'This report proves deterministic pagination, cursor binding, configuration limits, and error paths; it does not claim live production proof.',
    ],
  };
}

export function walkRemoteHashPages({ resources, source, scope, batchSize }) {
  const pages = [];
  let cursor = null;
  let complete = false;
  let guard = 0;
  const seen = new Set();
  const duplicateResourceKeys = [];
  let snapshotHashSetHash = '';

  while (!complete) {
    guard += 1;
    if (guard > resources.length + 2) {
      throw new RemoteHashPaginationError('Remote hash pagination did not converge.', 'PAGINATION_DID_NOT_CONVERGE');
    }

    const page = paginateRemoteHashResources({
      resources,
      source,
      scope,
      batchSize,
      cursor,
    });
    pages.push(page);
    snapshotHashSetHash = page.snapshotHashSetHash;

    for (const resource of page.resources) {
      if (seen.has(resource.resource_key)) {
        duplicateResourceKeys.push(resource.resource_key);
      }
      seen.add(resource.resource_key);
    }

    cursor = page.cursor;
    complete = page.complete;
  }

  return {
    complete,
    pages,
    uniqueResourceCount: seen.size,
    duplicateResourceKeys,
    snapshotHashSetHash,
  };
}

export function paginateRemoteHashResources({
  resources,
  source,
  scope,
  batchSize = DEFAULT_BATCH_SIZE,
  cursor = null,
}) {
  const normalizedBatchSize = normalizeRemoteHashBatchSize(batchSize);
  const sourceHash = remoteHashSourceHash(source);
  const scopeHash = remoteHashScopeHash(scope);
  const cursorState = parseRemoteHashCursor(cursor, {
    expectedSourceHash: sourceHash,
    expectedScopeHash: scopeHash,
  });
  const orderedResources = normalizeRemoteHashResources(resources);
  const offset = cursorState.offset;
  if (offset > orderedResources.length) {
    throw new RemoteHashPaginationError(
      'Snapshot hashes cursor is outside the current remote comparison set.',
      'INVALID_CURSOR_OFFSET',
      { offset, resourceCount: orderedResources.length },
    );
  }

  const pageResources = orderedResources.slice(offset, offset + normalizedBatchSize);
  const pageProofs = pageResources.map(remoteHashResourceProof);
  const allProofs = orderedResources.map(remoteHashResourceProof);
  const nextOffset = offset + pageResources.length;
  const complete = nextOffset >= orderedResources.length;
  const nextCursor = complete
    ? null
    : makeRemoteHashCursor({ sourceHash, scopeHash, offset: nextOffset });

  return {
    ok: true,
    mode: 'snapshot-hashes',
    snapshotHashSetHash: `sha256:${digest(allProofs)}`,
    cursor: nextCursor,
    complete,
    resources: pageResources,
    pageHash: `sha256:${digest(pageProofs)}`,
    pagination: {
      version: 1,
      cursorFormat: REMOTE_HASH_CURSOR_FORMAT,
      sourceHashPrefix: sourceHashPrefix(sourceHash),
      scopeHashPrefix: scopeHashPrefix(scopeHash),
      offset,
      batchSize: normalizedBatchSize,
      nextOffset,
      pageResourceCount: pageResources.length,
      resourceCount: orderedResources.length,
      complete,
    },
    planningOnly: {
      readOnly: true,
      mutates: false,
      authority: 'planning-evidence-only',
      applyBoundary: 'apply-must-revalidate-live-resource-hash',
    },
  };
}

export function makeRemoteHashCursor({ sourceHash, scopeHash, offset }) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RemoteHashPaginationError('Snapshot hashes cursor offset must be a non-negative integer.', 'INVALID_CURSOR_OFFSET');
  }
  return `snapcursor:${sourceHashPrefix(sourceHash)}:${scopeHashPrefix(scopeHash)}:${offset}`;
}

export function parseRemoteHashCursor(cursor, { expectedSourceHash, expectedScopeHash } = {}) {
  if (cursor === null || cursor === undefined || cursor === '') {
    return {
      version: 1,
      sourceHashPrefix: '',
      scopeHashPrefix: '',
      offset: 0,
    };
  }
  if (typeof cursor !== 'string') {
    throw new RemoteHashPaginationError('Snapshot hashes cursor is invalid.', 'INVALID_CURSOR_FORMAT');
  }

  const match = cursor.match(REMOTE_HASH_CURSOR_PATTERN);
  if (!match) {
    throw new RemoteHashPaginationError('Snapshot hashes cursor is invalid.', 'INVALID_CURSOR_FORMAT');
  }

  const cursorState = {
    version: 1,
    sourceHashPrefix: match[1],
    scopeHashPrefix: match[2],
    offset: Number.parseInt(match[3], 10),
  };

  if (expectedSourceHash && cursorState.sourceHashPrefix !== sourceHashPrefix(expectedSourceHash)) {
    throw new RemoteHashPaginationError(
      'Snapshot hashes cursor source does not match the current remote source.',
      'INVALID_CURSOR_SOURCE',
    );
  }
  if (expectedScopeHash && cursorState.scopeHashPrefix !== scopeHashPrefix(expectedScopeHash)) {
    throw new RemoteHashPaginationError(
      'Snapshot hashes cursor scope does not match the requested comparison scope.',
      'INVALID_CURSOR_SCOPE',
    );
  }

  return cursorState;
}

export function normalizeRemoteHashBatchSize(value) {
  const batchSize = typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : value;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > REMOTE_HASH_MAX_BATCH_SIZE) {
    throw new RemoteHashPaginationError(
      `Snapshot hashes batch_size must be between 1 and ${REMOTE_HASH_MAX_BATCH_SIZE}.`,
      'INVALID_BATCH_SIZE',
      { maxBatchSize: REMOTE_HASH_MAX_BATCH_SIZE },
    );
  }
  return batchSize;
}

export function remoteHashSourceHash(source) {
  return digest({
    sourceUrlHash: source.sourceUrlHash,
    restNamespace: source.restNamespace,
    routeProfile: source.routeProfile,
  });
}

export function remoteHashScopeHash(scope) {
  return digest({
    files: stableStringList(scope.files),
    tables: stableStringList(scope.tables),
    plugins: scope.plugins !== false,
    includeAbsentForBaseKeys: stableStringList(scope.includeAbsentForBaseKeys),
  });
}

export function buildRemoteHashResources(count = DEFAULT_RESOURCE_COUNT, options = {}) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RemoteHashPaginationError('Remote hash resource count must be a non-negative integer.', 'INVALID_RESOURCE_COUNT');
  }
  const seed = options.seed || 'rpp-0711';
  const resources = [];
  for (let index = 0; index < count; index += 1) {
    resources.push(buildRemoteHashResource(index, seed));
  }
  return normalizeRemoteHashResources(resources);
}

function buildRemoteHashResource(index, seed) {
  const shard = String(index % 32).padStart(2, '0');
  if (index % 11 === 0) {
    return {
      resource_key: `plugin:forms-${String(index).padStart(5, '0')}`,
      resource_type: 'plugin',
      hash: `sha256:${digest({ seed, type: 'plugin', index })}`,
      exists: true,
      owner: `forms-${String(index).padStart(5, '0')}`,
      storage_guard: 'semantic-driver',
    };
  }
  if (index % 3 === 0) {
    return {
      resource_key: `row:["wp_posts","ID:${100000 + index}"]`,
      resource_type: 'row',
      hash: `sha256:${digest({ seed, type: 'row', index })}`,
      exists: true,
      owner: 'core',
      storage_guard: 'mysql-transaction-row-lock',
    };
  }
  return {
    resource_key: `file:wp-content/uploads/rpp-0711/${shard}/asset-${String(index).padStart(5, '0')}.bin`,
    resource_type: 'file',
    hash: `sha256:${digest({ seed, type: 'file', index })}`,
    exists: true,
    owner: 'core',
    storage_guard: 'filesystem-compare-rename',
  };
}

function exerciseErrorPaths({ source, scope, sourceHash, scopeHash, resources }) {
  const errorPaths = {};
  errorPaths.invalidCursorFormat = capturesRemoteHashError(() => parseRemoteHashCursor('snapcursor:not-valid'));
  errorPaths.cursorSourceMismatch = capturesRemoteHashError(() => parseRemoteHashCursor(
    makeRemoteHashCursor({ sourceHash: digest('other-source'), scopeHash, offset: 1 }),
    { expectedSourceHash: sourceHash, expectedScopeHash: scopeHash },
  ));
  errorPaths.cursorScopeMismatch = capturesRemoteHashError(() => parseRemoteHashCursor(
    makeRemoteHashCursor({ sourceHash, scopeHash: digest('other-scope'), offset: 1 }),
    { expectedSourceHash: sourceHash, expectedScopeHash: scopeHash },
  ));
  errorPaths.batchSizeTooSmall = capturesRemoteHashError(() => normalizeRemoteHashBatchSize(0));
  errorPaths.batchSizeTooLarge = capturesRemoteHashError(() => normalizeRemoteHashBatchSize(REMOTE_HASH_MAX_BATCH_SIZE + 1));
  errorPaths.cursorOutsideComparisonSet = capturesRemoteHashError(() => paginateRemoteHashResources({
    resources,
    source,
    scope,
    batchSize: 10,
    cursor: makeRemoteHashCursor({ sourceHash, scopeHash, offset: resources.length + 1 }),
  }));
  return errorPaths;
}

function capturesRemoteHashError(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof RemoteHashPaginationError) {
      return {
        ok: true,
        code: error.code,
        messageHash: digest(error.message),
      };
    }
    return {
      ok: false,
      code: error.name || 'UNKNOWN_ERROR',
      messageHash: digest(error.message || String(error)),
    };
  }
  return {
    ok: false,
    code: 'NO_ERROR_THROWN',
    messageHash: '',
  };
}

function buildGates({ config, durationMs, memory, pageWalk, repeatedPageWalk, deterministicCoverage }) {
  return [
    gate('complete-resource-set', (
      pageWalk.complete
        && deterministicCoverage.uniqueResourceCount === config.resourceCount
        && deterministicCoverage.duplicateResourceKeys.length === 0
        && deterministicCoverage.completePageCount === 1
    ), {
      resourceCount: config.resourceCount,
      uniqueResourceCount: deterministicCoverage.uniqueResourceCount,
      pageCount: deterministicCoverage.pageCount,
    }),
    gate('cursor-binds-source-and-scope', (
      deterministicCoverage.errorPaths.cursorSourceMismatch.code === 'INVALID_CURSOR_SOURCE'
        && deterministicCoverage.errorPaths.cursorScopeMismatch.code === 'INVALID_CURSOR_SCOPE'
    ), {
      sourceMismatchCode: deterministicCoverage.errorPaths.cursorSourceMismatch.code,
      scopeMismatchCode: deterministicCoverage.errorPaths.cursorScopeMismatch.code,
    }),
    gate('configuration-bounds-enforced', (
      deterministicCoverage.errorPaths.batchSizeTooSmall.code === 'INVALID_BATCH_SIZE'
        && deterministicCoverage.errorPaths.batchSizeTooLarge.code === 'INVALID_BATCH_SIZE'
        && deterministicCoverage.errorPaths.invalidCursorFormat.code === 'INVALID_CURSOR_FORMAT'
        && deterministicCoverage.errorPaths.cursorOutsideComparisonSet.code === 'INVALID_CURSOR_OFFSET'
    ), {
      invalidCursorFormat: deterministicCoverage.errorPaths.invalidCursorFormat.code,
      batchSizeTooSmall: deterministicCoverage.errorPaths.batchSizeTooSmall.code,
      batchSizeTooLarge: deterministicCoverage.errorPaths.batchSizeTooLarge.code,
      cursorOutsideComparisonSet: deterministicCoverage.errorPaths.cursorOutsideComparisonSet.code,
    }),
    gate('page-hashes-deterministic', deterministicCoverage.pageHashesStable, {
      firstRunPageHashes: pageWalk.pages.map((page) => page.pageHash),
      repeatedRunPageHashes: repeatedPageWalk.pages.map((page) => page.pageHash),
    }),
    gate('planning-only-not-write-authority', deterministicCoverage.planningOnlyPages === deterministicCoverage.pageCount, {
      planningOnlyPages: deterministicCoverage.planningOnlyPages,
      pageCount: deterministicCoverage.pageCount,
    }),
    gate('hash-only-page-evidence', deterministicCoverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: deterministicCoverage.rawValueEvidenceLeaks,
      samplePageHash: pageWalk.pages[0]?.pageHash || '',
    }),
    gate('runtime-resource-budget', (
      durationMs <= config.maxDurationMs
        && memory.heapUsed <= config.maxHeapUsedBytes
    ), {
      durationMs,
      heapUsedBytes: memory.heapUsed,
      maxDurationMs: config.maxDurationMs,
      maxHeapUsedBytes: config.maxHeapUsedBytes,
    }),
  ];
}

function gate(id, passed, evidence) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence,
  };
}

function stablePageHashes(left, right) {
  return stableJson(left.pages.map((page) => page.pageHash)) === stableJson(right.pages.map((page) => page.pageHash))
    && left.snapshotHashSetHash === right.snapshotHashSetHash;
}

function normalizeRemoteHashResources(resources) {
  return [...resources]
    .map((resource) => ({
      resource_key: String(resource.resource_key),
      resource_type: String(resource.resource_type),
      hash: String(resource.hash),
      exists: Boolean(resource.exists),
      owner: String(resource.owner || 'core'),
      storage_guard: String(resource.storage_guard),
    }))
    .sort((left, right) => left.resource_key.localeCompare(right.resource_key));
}

function remoteHashResourceProof(resource) {
  return {
    resource_key: resource.resource_key,
    hash: resource.hash,
    exists: resource.exists,
    storage_guard: resource.storage_guard,
  };
}

function sourceHashPrefix(sourceHash) {
  return String(sourceHash).slice(0, 16);
}

function scopeHashPrefix(scopeHash) {
  return String(scopeHash).slice(0, 16);
}

function stableStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function evidenceContainsRawFixtureData(evidence) {
  const serialized = JSON.stringify(evidence);
  return RAW_FIXTURE_TOKENS.some((token) => serialized.includes(token));
}

function benchmarkConfig(options) {
  const config = {
    now: options.now || new Date(),
    resourceCount: options.resourceCount ?? DEFAULT_RESOURCE_COUNT,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    maxDurationMs: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    maxHeapUsedBytes: options.maxHeapUsedBytes ?? DEFAULT_MAX_HEAP_USED_BYTES,
    seed: options.seed || 'rpp-0711',
    source: options.source || {
      sourceUrlHash: digest('https://example.invalid/remote'),
      restNamespace: 'reprint/v1',
      routeProfile: 'production-shaped',
    },
    scope: options.scope || {
      files: ['wp-content/plugins', 'wp-content/themes', 'wp-content/uploads'],
      tables: ['wp_options', 'wp_posts', 'wp_postmeta'],
      plugins: true,
      includeAbsentForBaseKeys: [
        'file:wp-content/plugins/forms/forms.php',
        'row:["wp_posts","ID:1"]',
      ],
    },
  };

  config.resourceCount = integerOption(config.resourceCount, 'resourceCount', 0, 1_000_000);
  config.batchSize = normalizeRemoteHashBatchSize(config.batchSize);
  config.maxDurationMs = integerOption(config.maxDurationMs, 'maxDurationMs', 1, Number.MAX_SAFE_INTEGER);
  config.maxHeapUsedBytes = integerOption(config.maxHeapUsedBytes, 'maxHeapUsedBytes', 1, Number.MAX_SAFE_INTEGER);
  return config;
}

function integerOption(value, name, min, max) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : value;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new RemoteHashPaginationError(`${name} must be an integer between ${min} and ${max}.`, 'INVALID_CONFIG');
  }
  return normalized;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, innerValue]) => [key, sortForJson(innerValue)]),
    );
  }
  return value;
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function microsecondsToMilliseconds(microseconds) {
  return Number((microseconds / 1000).toFixed(2));
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match) {
      if (arg === '--help' || arg === '-h') {
        options.help = true;
        continue;
      }
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'resource-count') {
      options.resourceCount = Number.parseInt(value, 10);
    } else if (key === 'batch-size') {
      options.batchSize = Number.parseInt(value, 10);
    } else if (key === 'max-duration-ms') {
      options.maxDurationMs = Number.parseInt(value, 10);
    } else if (key === 'max-heap-used-bytes') {
      options.maxHeapUsedBytes = Number.parseInt(value, 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/bench/remote-hash-pagination.js [--resource-count=<n>] [--batch-size=<n>]',
    '',
    'Reports runtime, resources, and pass/fail gates for RPP-0711 remote hash pagination.',
    'Without a live remote service, it runs deterministic pagination, configuration, and error-path coverage.',
    '',
  ].join('\n'));
}

export function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = runRemoteHashPaginationBenchmark(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmark: REMOTE_HASH_PAGINATION_BENCHMARK_ID,
      ok: false,
      error: {
        name: error.name,
        code: error.code || 'REMOTE_HASH_PAGINATION_ERROR',
        message: error.message,
      },
    }, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli();
}
