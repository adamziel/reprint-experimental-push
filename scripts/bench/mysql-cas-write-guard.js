#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { ABSENT, digest } from '../../src/stable-json.js';

export const MYSQL_CAS_BOUNDARY = 'wpdb-single-statement-cas';
export const MYSQL_CAS_ADAPTER = 'mysql-wpdb-single-statement-cas';
export const MYSQL_CAS_BENCHMARK_ID = 'rpp-0701-mysql-cas-write-guard';

export const MYSQL_CAS_SURFACE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'wp_posts',
    driver: 'wp-post',
    logicalTable: 'wp_posts',
    physicalTable: 'wp_posts',
    keyColumns: Object.freeze(['ID']),
    setColumns: Object.freeze(['post_title', 'post_name', 'post_content', 'post_status', 'post_type', 'post_parent', 'post_author']),
    compareColumns: Object.freeze(['ID', 'post_title', 'post_name', 'post_content', 'post_status', 'post_type', 'post_parent', 'post_author']),
  }),
  Object.freeze({
    id: 'wp_options',
    driver: 'wp-option',
    logicalTable: 'wp_options',
    physicalTable: 'wp_options',
    keyColumns: Object.freeze(['option_name']),
    setColumns: Object.freeze(['option_value']),
    compareColumns: Object.freeze(['option_name', 'option_value']),
  }),
  Object.freeze({
    id: 'wp_postmeta',
    driver: 'wp-postmeta',
    logicalTable: 'wp_postmeta',
    physicalTable: 'wp_postmeta',
    keyColumns: Object.freeze(['post_id', 'meta_key']),
    setColumns: Object.freeze(['meta_value']),
    compareColumns: Object.freeze(['post_id', 'meta_key', 'meta_value']),
    uniquenessPredicate: 'single-row-per-post-and-key',
  }),
  Object.freeze({
    id: 'wp_reprint_push_forms_lab',
    driver: 'fixture-forms-lab-table',
    logicalTable: 'wp_reprint_push_forms_lab',
    physicalTable: 'wp_reprint_push_forms_lab',
    keyColumns: Object.freeze(['id']),
    setColumns: Object.freeze(['form_slug', 'payload_json', 'updated_marker']),
    compareColumns: Object.freeze(['id', 'form_slug', 'payload_json', 'updated_marker']),
  }),
  Object.freeze({
    id: 'wp_reprint_push_release_state',
    driver: 'reprint-push-release-state',
    logicalTable: 'wp_reprint_push_release_state',
    physicalTable: 'wp_reprint_push_release_state',
    keyColumns: Object.freeze(['state_id']),
    setColumns: Object.freeze(['payload_json', 'updated_marker']),
    compareColumns: Object.freeze(['state_id', 'payload_json', 'updated_marker']),
  }),
]);

const DEFAULT_NOW = new Date('2026-05-29T00:00:00.000Z');
const DEFAULT_ITERATIONS = 80;
const DEFAULT_MAX_DURATION_MS = 2_000;
const DEFAULT_MAX_HEAP_USED_BYTES = 256 * 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'base-title-',
  'planned-title-',
  'drift-title-',
  'base-value-',
  'planned-value-',
  'drift-value-',
  'payload-json-',
  'release-payload-',
]);

export function runMysqlCasWriteGuardBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const mysqlRuntime = config.detectMysqlRuntime();
  const deterministicCoverage = runDeterministicGuardCoverage(config);
  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);

  const runtime = {
    benchmarkId: MYSQL_CAS_BENCHMARK_ID,
    generatedAt: config.now.toISOString(),
    durationMs,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    mysqlRuntime,
  };

  const resources = buildResourceReport({
    deterministicCoverage,
    startUsage,
    endUsage,
    startMemory,
    endMemory,
  });
  const gates = evaluateMysqlCasGates({
    deterministicCoverage,
    runtime,
    resources,
    maxDurationMs: config.maxDurationMs,
    maxHeapUsedBytes: config.maxHeapUsedBytes,
  });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0701',
    benchmark: MYSQL_CAS_BENCHMARK_ID,
    ok: gates.every((gate) => gate.status === 'pass'),
    mode: mysqlRuntime.status === 'available' ? 'mysql-runtime-recorded' : 'deterministic-no-mysql-runtime',
    runtime,
    resources,
    gates,
    deterministicCoverage: publicCoverageSummary(deterministicCoverage),
  };
}

export function detectMysqlRuntime(env = process.env, spawn = spawnSync) {
  const mysqlVersion = spawn('mysql', ['--version'], {
    encoding: 'utf8',
    timeout: 3_000,
  });
  const unavailableCapabilities = [];
  const details = [];
  let clientVersion = null;

  if (mysqlVersion.error) {
    unavailableCapabilities.push('mysql-client-binary-on-path');
    details.push(`mysql --version failed: ${mysqlVersion.error.code || mysqlVersion.error.message}`);
  } else if (mysqlVersion.status !== 0) {
    unavailableCapabilities.push('mysql-client-version-command');
    details.push(`mysql --version exited ${mysqlVersion.status}`);
  } else {
    clientVersion = (mysqlVersion.stdout || mysqlVersion.stderr || '').trim();
  }

  const connectionConfig = mysqlConnectionConfigFromEnv(env);
  if (!connectionConfig.ok) {
    unavailableCapabilities.push(connectionConfig.reasonCode);
    details.push(connectionConfig.detail);
  }

  if (unavailableCapabilities.length === 0) {
    const probe = spawn('mysql', mysqlProbeArgs(connectionConfig.connection), {
      encoding: 'utf8',
      timeout: 3_000,
      env: mysqlProbeEnv(env, connectionConfig.connection),
    });
    if (probe.error) {
      unavailableCapabilities.push('mysql-runtime-connection-probe');
      details.push(`mysql connection probe failed: ${probe.error.code || probe.error.message}`);
    } else if (probe.status !== 0) {
      unavailableCapabilities.push('mysql-runtime-connection-probe');
      details.push(`mysql connection probe exited ${probe.status}: ${redactMysqlProbeOutput(probe.stderr || probe.stdout || '', connectionConfig.connection)}`);
    } else {
      return {
        status: 'available',
        unavailableCapabilities: [],
        detail: 'mysql client connection probe succeeded; benchmark did not run live CAS DML',
        clientVersion,
        serverVersion: (probe.stdout || '').trim().split(/\r?\n/)[0] || 'unknown',
        connection: 'configured-redacted',
      };
    }
  }

  if (unavailableCapabilities.length > 0) {
    return {
      status: 'unavailable',
      unavailableCapabilities,
      detail: details.join('; '),
      ...(clientVersion ? { clientVersion } : {}),
      ...(connectionConfig.ok ? { connection: 'configured-redacted' } : {}),
    };
  }

  return {
    status: 'unavailable',
    unavailableCapabilities: ['mysql-runtime-connection-settings'],
    detail: 'REPRINT_PUSH_MYSQL_CAS_DSN or REPRINT_PUSH_MYSQL_CAS_HOST/REPRINT_PUSH_MYSQL_CAS_DATABASE/REPRINT_PUSH_MYSQL_CAS_USER not set',
    ...(clientVersion ? { clientVersion } : {}),
  };
}

function mysqlConnectionConfigFromEnv(env) {
  if (env.REPRINT_PUSH_MYSQL_CAS_DSN) {
    return mysqlConnectionConfigFromDsn(env.REPRINT_PUSH_MYSQL_CAS_DSN);
  }

  const host = env.REPRINT_PUSH_MYSQL_CAS_HOST || '';
  const socket = env.REPRINT_PUSH_MYSQL_CAS_SOCKET || '';
  const database = env.REPRINT_PUSH_MYSQL_CAS_DATABASE || '';
  const user = env.REPRINT_PUSH_MYSQL_CAS_USER || '';
  if ((!host && !socket) || !database || !user) {
    return {
      ok: false,
      reasonCode: 'mysql-runtime-connection-settings',
      detail: 'REPRINT_PUSH_MYSQL_CAS_DSN or (REPRINT_PUSH_MYSQL_CAS_HOST or REPRINT_PUSH_MYSQL_CAS_SOCKET) with REPRINT_PUSH_MYSQL_CAS_DATABASE and REPRINT_PUSH_MYSQL_CAS_USER not set',
    };
  }

  return {
    ok: true,
    connection: {
      host,
      socket,
      port: env.REPRINT_PUSH_MYSQL_CAS_PORT || '',
      database,
      user,
      password: env.REPRINT_PUSH_MYSQL_CAS_PASSWORD || '',
    },
  };
}

function mysqlConnectionConfigFromDsn(dsn) {
  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    return {
      ok: false,
      reasonCode: 'mysql-runtime-connection-settings',
      detail: 'REPRINT_PUSH_MYSQL_CAS_DSN is not a valid mysql:// URL',
    };
  }

  if (parsed.protocol !== 'mysql:') {
    return {
      ok: false,
      reasonCode: 'mysql-runtime-connection-settings',
      detail: 'REPRINT_PUSH_MYSQL_CAS_DSN must use the mysql:// scheme',
    };
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const socket = parsed.searchParams.get('socket') || '';
  if ((!parsed.hostname && !socket) || !parsed.username || !database) {
    return {
      ok: false,
      reasonCode: 'mysql-runtime-connection-settings',
      detail: 'REPRINT_PUSH_MYSQL_CAS_DSN must include host or socket, database, and user',
    };
  }

  return {
    ok: true,
    connection: {
      host: parsed.hostname || '',
      socket,
      port: parsed.port || '',
      database,
      user: decodeURIComponent(parsed.username),
      password: parsed.password ? decodeURIComponent(parsed.password) : '',
    },
  };
}

function mysqlProbeArgs(connection) {
  const args = [
    '--batch',
    '--skip-column-names',
    '--raw',
    '--connect-timeout=3',
  ];
  if (connection.socket) {
    args.push('--protocol=socket', `--socket=${connection.socket}`);
  } else {
    args.push('--protocol=tcp', `--host=${connection.host}`);
    if (connection.port) {
      args.push(`--port=${connection.port}`);
    }
  }
  args.push(
    `--user=${connection.user}`,
    `--database=${connection.database}`,
    '--execute=SELECT @@version',
  );
  return args;
}

function mysqlProbeEnv(env, connection) {
  if (!connection.password) {
    return env;
  }
  return {
    ...env,
    MYSQL_PWD: connection.password,
  };
}

function redactMysqlProbeOutput(output, connection) {
  let redacted = String(output).replace(/\s+/g, ' ').trim();
  const values = [
    connection.password,
    connection.user,
    connection.database,
    connection.host,
    connection.socket,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const value of values) {
    redacted = redacted.split(value).join('[redacted]');
  }
  return redacted || 'no probe output';
}

export function buildMysqlCasUpdateShape(surfaceInput) {
  const surface = resolveSurface(surfaceInput);
  const setClause = surface.setColumns
    .map((column) => `${quoteMysqlIdentifier(column)} = ?`)
    .join(', ');
  const predicateColumns = orderedUnique([
    ...surface.keyColumns,
    ...surface.compareColumns,
  ]);
  const whereClause = predicateColumns
    .map((column) => `${quoteMysqlIdentifier(column)} = ?`)
    .join(' AND ');
  const uniquenessClause = surface.uniquenessPredicate
    ? ' AND /* single-row-per-post-and-key */ 1 = 1'
    : '';
  const sqlShape = `UPDATE ${quoteMysqlIdentifier(surface.physicalTable)} SET ${setClause} WHERE ${whereClause}${uniquenessClause} LIMIT 1`;

  return {
    boundary: MYSQL_CAS_BOUNDARY,
    adapter: MYSQL_CAS_ADAPTER,
    engine: 'mysql',
    logicalTable: surface.logicalTable,
    physicalTable: surface.physicalTable,
    driver: surface.driver,
    operation: 'update',
    keyColumns: [...surface.keyColumns],
    setColumns: [...surface.setColumns],
    comparedColumns: predicateColumns,
    singleStatement: true,
    statementKind: 'UPDATE',
    sqlShape,
    sqlShapeHash: digest(sqlShape),
  };
}

export function applyMysqlCasWriteGuard({
  surface: surfaceInput,
  rows,
  key,
  expectedResource,
  expectedStorage,
  nextStorage,
}) {
  const surface = resolveSurface(surfaceInput);
  const rowMap = rows instanceof Map ? rows : rowsByKey(surface, rows || []);
  const rowKeyValue = rowKey(surface, key || expectedStorage);
  const current = rowMap.get(rowKeyValue);
  const shape = buildMysqlCasUpdateShape(surface);
  const matches = current
    ? shape.comparedColumns.every((column) => casValuesEqual(current[column], expectedStorage[column]))
    : false;
  const rowsAffected = matches ? 1 : 0;

  if (matches) {
    rowMap.set(rowKeyValue, {
      ...current,
      ...pickColumns(nextStorage, surface.setColumns),
    });
  }

  return {
    applied: rowsAffected === 1,
    rows: rowMap,
    storageGuard: mysqlCasStorageGuardEvidence({
      surface,
      shape,
      rowsAffected,
      expectedResource,
      expectedStorage,
      nextStorage,
      observedStorage: current || ABSENT,
    }),
  };
}

export function createMysqlCasFixture(surfaceInput, index = 0) {
  const surface = resolveSurface(surfaceInput);
  if (surface.id === 'wp_posts') {
    const id = 10_000 + index;
    const expectedStorage = {
      ID: id,
      post_title: `base-title-${index}`,
      post_name: `base-post-${index}`,
      post_content: `base-value-${index}`,
      post_status: 'draft',
      post_type: 'post',
      post_parent: 0,
      post_author: 1,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      post_title: `planned-title-${index}`,
      post_content: `planned-value-${index}`,
    }, {
      post_title: `drift-title-${index}`,
      post_content: `drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_options') {
    const expectedStorage = {
      option_name: `reprint_push_option_${index}`,
      option_value: `base-value-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      option_value: `planned-value-${index}`,
    }, {
      option_value: `drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_postmeta') {
    const expectedStorage = {
      post_id: 20_000 + index,
      meta_key: `_reprint_push_meta_${index}`,
      meta_value: `base-value-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      meta_value: `planned-value-${index}`,
    }, {
      meta_value: `drift-value-${index}`,
    });
  }
  if (surface.id === 'wp_reprint_push_forms_lab') {
    const expectedStorage = {
      id: 30_000 + index,
      form_slug: `fixture-${index}`,
      payload_json: `payload-json-base-${index}`,
      updated_marker: `base-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      payload_json: `payload-json-planned-${index}`,
      updated_marker: `planned-${index}`,
    }, {
      payload_json: `payload-json-drift-${index}`,
      updated_marker: `drift-${index}`,
    });
  }
  if (surface.id === 'wp_reprint_push_release_state') {
    const expectedStorage = {
      state_id: 1,
      payload_json: `release-payload-base-${index}`,
      updated_marker: `base-${index}`,
    };
    return fixtureFromStorage(surface, expectedStorage, {
      payload_json: `release-payload-planned-${index}`,
      updated_marker: `planned-${index}`,
    }, {
      payload_json: `release-payload-drift-${index}`,
      updated_marker: `drift-${index}`,
    });
  }
  throw new Error(`No MySQL CAS fixture for ${surface.id}`);
}

function benchmarkConfig(options) {
  const iterations = numberOption(options.iterations, 'iterations', DEFAULT_ITERATIONS);
  const maxDurationMs = numberOption(options.maxDurationMs, 'maxDurationMs', DEFAULT_MAX_DURATION_MS);
  const maxHeapUsedBytes = numberOption(options.maxHeapUsedBytes, 'maxHeapUsedBytes', DEFAULT_MAX_HEAP_USED_BYTES);
  return {
    iterations,
    maxDurationMs,
    maxHeapUsedBytes,
    now: options.now || DEFAULT_NOW,
    detectMysqlRuntime: typeof options.detectMysqlRuntime === 'function'
      ? options.detectMysqlRuntime
      : () => detectMysqlRuntime(options.env || process.env),
  };
}

function numberOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return number;
}

function runDeterministicGuardCoverage(config) {
  const coverage = {
    iterations: config.iterations,
    surfaces: [],
    writes: {
      attempted: 0,
      applied: 0,
      staleAtWrite: 0,
      absentAtWrite: 0,
    },
    sqlShapes: [],
    evidenceSamples: [],
    failures: [],
    rawValueEvidenceLeaks: 0,
  };

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    for (const surface of MYSQL_CAS_SURFACE_DEFINITIONS) {
      const fixture = createMysqlCasFixture(surface, iteration);
      const shape = buildMysqlCasUpdateShape(surface);
      coverage.sqlShapes.push(shape);
      const surfaceSummary = coverage.surfaces.find((entry) => entry.logicalTable === surface.logicalTable)
        || addSurfaceSummary(coverage, surface, shape);

      const successRows = rowsByKey(surface, [fixture.expectedStorage]);
      const success = applyMysqlCasWriteGuard({
        surface,
        rows: successRows,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      coverage.writes.attempted += 1;
      if (success.applied && success.storageGuard.rowsAffected === 1 && success.storageGuard.outcome === 'applied') {
        coverage.writes.applied += 1;
        surfaceSummary.applied += 1;
      } else {
        coverage.failures.push(`${surface.id}: applied guard did not update exactly one row`);
      }
      recordEvidenceSample(coverage, success.storageGuard);

      const successRow = successRows.get(rowKey(surface, fixture.expectedStorage));
      for (const column of surface.setColumns) {
        if (!casValuesEqual(successRow[column], fixture.nextStorage[column])) {
          coverage.failures.push(`${surface.id}: set column ${column} was not updated`);
        }
      }

      const staleRows = rowsByKey(surface, [fixture.driftedStorage]);
      const stale = applyMysqlCasWriteGuard({
        surface,
        rows: staleRows,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      coverage.writes.attempted += 1;
      if (!stale.applied && stale.storageGuard.rowsAffected === 0 && stale.storageGuard.outcome === 'stale-at-write') {
        coverage.writes.staleAtWrite += 1;
        surfaceSummary.staleAtWrite += 1;
      } else {
        coverage.failures.push(`${surface.id}: stale guard did not reject changed storage`);
      }
      recordEvidenceSample(coverage, stale.storageGuard);

      const absentRows = new Map();
      const absent = applyMysqlCasWriteGuard({
        surface,
        rows: absentRows,
        expectedResource: fixture.expectedResource,
        expectedStorage: fixture.expectedStorage,
        nextStorage: fixture.nextStorage,
      });
      coverage.writes.attempted += 1;
      if (!absent.applied && absent.storageGuard.rowsAffected === 0 && absent.storageGuard.outcome === 'stale-at-write') {
        coverage.writes.absentAtWrite += 1;
        surfaceSummary.absentAtWrite += 1;
      } else {
        coverage.failures.push(`${surface.id}: absent guard did not reject missing storage`);
      }
      recordEvidenceSample(coverage, absent.storageGuard);
    }
  }

  coverage.sqlShapes = dedupeShapes(coverage.sqlShapes);
  return coverage;
}

function addSurfaceSummary(coverage, surface, shape) {
  const summary = {
    logicalTable: surface.logicalTable,
    physicalTable: surface.physicalTable,
    driver: surface.driver,
    keyColumns: [...surface.keyColumns],
    setColumns: [...surface.setColumns],
    comparedColumns: [...shape.comparedColumns],
    sqlShapeHash: shape.sqlShapeHash,
    applied: 0,
    staleAtWrite: 0,
    absentAtWrite: 0,
  };
  coverage.surfaces.push(summary);
  return summary;
}

function recordEvidenceSample(coverage, evidence) {
  if (evidenceContainsRawFixtureData(evidence)) {
    coverage.rawValueEvidenceLeaks += 1;
  }
  if (coverage.evidenceSamples.length < MYSQL_CAS_SURFACE_DEFINITIONS.length * 2) {
    coverage.evidenceSamples.push(evidence);
  }
}

function dedupeShapes(shapes) {
  const byHash = new Map();
  for (const shape of shapes) {
    byHash.set(shape.sqlShapeHash, {
      logicalTable: shape.logicalTable,
      physicalTable: shape.physicalTable,
      driver: shape.driver,
      statementKind: shape.statementKind,
      singleStatement: shape.singleStatement,
      keyColumns: shape.keyColumns,
      setColumns: shape.setColumns,
      comparedColumns: shape.comparedColumns,
      sqlShapeHash: shape.sqlShapeHash,
      predicateCount: shape.comparedColumns.length,
      assignmentCount: shape.setColumns.length,
    });
  }
  return [...byHash.values()].sort((left, right) => left.logicalTable.localeCompare(right.logicalTable));
}

function buildResourceReport({ deterministicCoverage, startUsage, endUsage, startMemory, endMemory }) {
  return {
    process: {
      rssBytes: endMemory.rss,
      heapUsedBytes: endMemory.heapUsed,
      heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
      externalBytes: endMemory.external,
      arrayBuffersBytes: endMemory.arrayBuffers,
      userCpuMs: Math.max(0, (endUsage.userCPUTime - startUsage.userCPUTime) / 1000),
      systemCpuMs: Math.max(0, (endUsage.systemCPUTime - startUsage.systemCPUTime) / 1000),
      maxRSSKiB: endUsage.maxRSS,
    },
    storage: {
      boundary: MYSQL_CAS_BOUNDARY,
      adapter: MYSQL_CAS_ADAPTER,
      engine: 'mysql',
      logicalTables: deterministicCoverage.surfaces.length,
      guardedWritesAttempted: deterministicCoverage.writes.attempted,
      appliedWrites: deterministicCoverage.writes.applied,
      staleAtWriteWrites: deterministicCoverage.writes.staleAtWrite,
      absentAtWriteWrites: deterministicCoverage.writes.absentAtWrite,
      comparedColumnsByTable: Object.fromEntries(
        deterministicCoverage.surfaces.map((surface) => [surface.logicalTable, surface.comparedColumns]),
      ),
    },
    sql: {
      singleStatementShapes: deterministicCoverage.sqlShapes.length,
      shapes: deterministicCoverage.sqlShapes,
    },
  };
}

function evaluateMysqlCasGates({ deterministicCoverage, runtime, resources, maxDurationMs, maxHeapUsedBytes }) {
  const expectedPerOutcome = deterministicCoverage.iterations * MYSQL_CAS_SURFACE_DEFINITIONS.length;
  const shapeChecks = deterministicCoverage.sqlShapes.map((shape) => {
    const fullShape = buildMysqlCasUpdateShape(shape.logicalTable).sqlShape;
    return fullShape.startsWith('UPDATE ')
      && fullShape.includes(' SET ')
      && fullShape.includes(' WHERE ')
      && fullShape.endsWith(' LIMIT 1')
      && !fullShape.includes(';')
      && shape.comparedColumns.every((column) => fullShape.includes(quoteMysqlIdentifier(column)));
  });
  const evidenceHashesOk = deterministicCoverage.evidenceSamples.every((evidence) => (
    /^[a-f0-9]{64}$/.test(evidence.expectedResourceHash)
      && /^[a-f0-9]{64}$/.test(evidence.expectedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.plannedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.observedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.sqlShapeHash)
  ));
  const capabilityRecorded = runtime.mysqlRuntime.status === 'available'
    || (runtime.mysqlRuntime.status === 'unavailable'
      && Array.isArray(runtime.mysqlRuntime.unavailableCapabilities)
      && runtime.mysqlRuntime.unavailableCapabilities.length > 0
      && typeof runtime.mysqlRuntime.detail === 'string'
      && runtime.mysqlRuntime.detail.length > 0);

  return [
    gate('deterministic-guard-behavior', deterministicCoverage.failures.length === 0, {
      attempted: deterministicCoverage.writes.attempted,
      failures: deterministicCoverage.failures.length,
    }),
    gate('applied-and-stale-outcomes',
      deterministicCoverage.writes.applied === expectedPerOutcome
        && deterministicCoverage.writes.staleAtWrite === expectedPerOutcome
        && deterministicCoverage.writes.absentAtWrite === expectedPerOutcome,
      {
        expectedPerOutcome,
        applied: deterministicCoverage.writes.applied,
        staleAtWrite: deterministicCoverage.writes.staleAtWrite,
        absentAtWrite: deterministicCoverage.writes.absentAtWrite,
      }),
    gate('single-statement-cas-shapes',
      deterministicCoverage.sqlShapes.length === MYSQL_CAS_SURFACE_DEFINITIONS.length
        && shapeChecks.every(Boolean),
      {
        shapeCount: deterministicCoverage.sqlShapes.length,
        expectedShapeCount: MYSQL_CAS_SURFACE_DEFINITIONS.length,
      }),
    gate('hash-only-evidence', evidenceHashesOk && deterministicCoverage.rawValueEvidenceLeaks === 0, {
      evidenceSamples: deterministicCoverage.evidenceSamples.length,
      rawValueEvidenceLeaks: deterministicCoverage.rawValueEvidenceLeaks,
    }),
    gate('mysql-runtime-capability-recorded', capabilityRecorded, {
      status: runtime.mysqlRuntime.status,
      unavailableCapabilities: runtime.mysqlRuntime.unavailableCapabilities || [],
    }),
    gate('runtime-resource-budget',
      runtime.durationMs <= maxDurationMs && resources.process.heapUsedBytes <= maxHeapUsedBytes,
      {
        durationMs: runtime.durationMs,
        maxDurationMs,
        heapUsedBytes: resources.process.heapUsedBytes,
        maxHeapUsedBytes,
      }),
  ];
}

function gate(id, ok, metrics = {}) {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    metrics,
  };
}

function publicCoverageSummary(coverage) {
  return {
    iterations: coverage.iterations,
    writes: coverage.writes,
    surfaces: coverage.surfaces,
    evidenceSamples: coverage.evidenceSamples,
    failures: coverage.failures,
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
  };
}

function mysqlCasStorageGuardEvidence({
  surface,
  shape,
  rowsAffected,
  expectedResource,
  expectedStorage,
  nextStorage,
  observedStorage,
}) {
  return {
    boundary: MYSQL_CAS_BOUNDARY,
    adapter: MYSQL_CAS_ADAPTER,
    engine: 'mysql',
    driver: surface.driver,
    logicalTable: surface.logicalTable,
    physicalTable: surface.physicalTable,
    operation: 'update',
    keyColumns: [...surface.keyColumns],
    setColumns: [...surface.setColumns],
    comparedColumns: [...shape.comparedColumns],
    expectedResourceHash: digest(expectedResource),
    expectedStorageHash: digest(pickColumns(expectedStorage, shape.comparedColumns)),
    plannedStorageHash: digest(pickColumns(nextStorage, surface.setColumns)),
    observedStorageHash: digest(observedStorage === ABSENT ? ABSENT : pickColumns(observedStorage, shape.comparedColumns)),
    rowsAffected,
    outcome: rowsAffected === 1 ? 'applied' : 'stale-at-write',
    sqlShapeHash: shape.sqlShapeHash,
  };
}

function fixtureFromStorage(surface, expectedStorage, plannedPatch, driftPatch) {
  const nextStorage = {
    ...expectedStorage,
    ...plannedPatch,
  };
  const driftedStorage = {
    ...expectedStorage,
    ...driftPatch,
  };
  return {
    surface: surface.id,
    expectedResource: {
      type: 'row',
      table: surface.logicalTable,
      id: rowKey(surface, expectedStorage),
      storageHash: digest(pickColumns(expectedStorage, surface.compareColumns)),
    },
    expectedStorage,
    nextStorage,
    driftedStorage,
  };
}

function resolveSurface(surfaceInput) {
  if (typeof surfaceInput === 'string') {
    const surface = MYSQL_CAS_SURFACE_DEFINITIONS.find((definition) => (
      definition.id === surfaceInput
        || definition.logicalTable === surfaceInput
        || definition.physicalTable === surfaceInput
    ));
    if (!surface) {
      throw new Error(`Unknown MySQL CAS surface: ${surfaceInput}`);
    }
    return surface;
  }
  if (surfaceInput && typeof surfaceInput === 'object') {
    return surfaceInput;
  }
  throw new Error('MySQL CAS surface is required.');
}

function rowsByKey(surfaceInput, rows) {
  const surface = resolveSurface(surfaceInput);
  const map = new Map();
  for (const row of rows) {
    map.set(rowKey(surface, row), { ...row });
  }
  return map;
}

function rowKey(surfaceInput, row) {
  const surface = resolveSurface(surfaceInput);
  return surface.keyColumns.map((column) => String(row[column])).join('\u0000');
}

function pickColumns(row, columns) {
  if (row === ABSENT) {
    return ABSENT;
  }
  const picked = {};
  for (const column of columns) {
    picked[column] = row?.[column];
  }
  return picked;
}

function casValuesEqual(left, right) {
  return digest(left === undefined ? null : left) === digest(right === undefined ? null : right);
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function quoteMysqlIdentifier(identifier) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe MySQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function evidenceContainsRawFixtureData(evidence) {
  const json = JSON.stringify(evidence);
  return RAW_FIXTURE_TOKENS.some((token) => json.includes(token));
}

function elapsedMs(started) {
  return Math.round((performance.now() - started) * 1000) / 1000;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--iterations') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--iterations requires a value');
      }
      options.iterations = Number(argv[index]);
      continue;
    }
    if (arg === '--max-duration-ms') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--max-duration-ms requires a value');
      }
      options.maxDurationMs = Number(argv[index]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/bench/mysql-cas-write-guard.js [--iterations <n>] [--max-duration-ms <ms>]',
    '',
    'Reports runtime, resource usage, and pass/fail gates for the RPP-0701 MySQL compare-and-swap write guard benchmark.',
    'When a MySQL runtime is unavailable, the report records the exact missing capability and still runs deterministic guard coverage.',
    '',
  ].join('\n'));
}

export function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = runMysqlCasWriteGuardBenchmark(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmark: MYSQL_CAS_BENCHMARK_ID,
      ok: false,
      error: {
        name: error.name,
        message: error.message,
      },
    }, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli();
}
