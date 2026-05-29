#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  SQLITE_CAS_ADAPTER,
  SQLITE_CAS_BOUNDARY,
  SQLITE_CAS_SURFACE_DEFINITIONS,
  applySqliteCasWriteGuard,
  buildSqliteCasUpdateShape,
  createSqliteCasFixture,
  createSqliteCasFixtureTable,
  insertSqliteCasFixtureRow,
  pickSqliteCasColumns,
  readSqliteCasStorageByKey,
} from '../../src/sqlite-cas-write-guard.js';
import { ABSENT, digest } from '../../src/stable-json.js';

export const SQLITE_CAS_BENCHMARK_ID = 'rpp-0702-sqlite-cas-write-guard';

const DEFAULT_NOW = new Date('2026-05-29T00:00:00.000Z');
const DEFAULT_ITERATIONS = 80;
const DEFAULT_MAX_DURATION_MS = 3_000;
const DEFAULT_MAX_HEAP_USED_BYTES = 256 * 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'sqlite-base-title-',
  'sqlite-planned-title-',
  'sqlite-drift-title-',
  'sqlite-base-value-',
  'sqlite-planned-value-',
  'sqlite-drift-value-',
  'sqlite-payload-json-',
  'sqlite-release-payload-',
]);

export async function runSqliteCasWriteGuardBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const sqliteCapability = await config.loadSqliteRuntime();
  const deterministicCoverage = sqliteCapability.DatabaseSync
    ? runRuntimeGuardCoverage(config, sqliteCapability.DatabaseSync)
    : unavailableCoverage(config, sqliteCapability.report);
  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);

  const runtime = {
    benchmarkId: SQLITE_CAS_BENCHMARK_ID,
    generatedAt: config.now.toISOString(),
    durationMs,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    sqliteRuntime: sqliteCapability.report,
  };

  const resources = buildResourceReport({
    deterministicCoverage,
    startUsage,
    endUsage,
    startMemory,
    endMemory,
  });
  const gates = evaluateSqliteCasGates({
    deterministicCoverage,
    runtime,
    resources,
    maxDurationMs: config.maxDurationMs,
    maxHeapUsedBytes: config.maxHeapUsedBytes,
  });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0702',
    benchmark: SQLITE_CAS_BENCHMARK_ID,
    ok: gates.every((gate) => gate.status === 'pass'),
    mode: sqliteCapability.DatabaseSync ? 'sqlite-runtime-guarded-writes' : 'sqlite-runtime-unavailable',
    runtime,
    resources,
    gates,
    deterministicCoverage: publicCoverageSummary(deterministicCoverage),
  };
}

export async function loadSqliteRuntime() {
  try {
    const sqlite = await import('node:sqlite');
    const { DatabaseSync } = sqlite;
    if (typeof DatabaseSync !== 'function') {
      return unavailableSqliteRuntime('node:sqlite did not expose DatabaseSync.');
    }
    const database = new DatabaseSync(':memory:');
    let sqliteVersion = null;
    try {
      sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version;
    } finally {
      database.close();
    }
    return {
      DatabaseSync,
      report: {
        status: 'available',
        unavailableCapabilities: [],
        detail: 'node:sqlite DatabaseSync available for in-memory guarded write validation',
        sqliteVersion,
      },
    };
  } catch (error) {
    return unavailableSqliteRuntime(error.code || error.message);
  }
}

function unavailableSqliteRuntime(detail) {
  return {
    DatabaseSync: null,
    report: {
      status: 'unavailable',
      unavailableCapabilities: ['node-sqlite-database-sync'],
      detail: `node:sqlite DatabaseSync unavailable: ${detail}`,
    },
  };
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
    loadSqliteRuntime: typeof options.loadSqliteRuntime === 'function'
      ? options.loadSqliteRuntime
      : loadSqliteRuntime,
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

function runRuntimeGuardCoverage(config, DatabaseSync) {
  const coverage = {
    iterations: config.iterations,
    surfaces: [],
    writes: {
      attempted: 0,
      applied: 0,
      staleAtWrite: 0,
      absentAtWrite: 0,
      unsafeMultipleMatch: 0,
    },
    sqlShapes: [],
    evidenceSamples: [],
    failures: [],
    rawValueEvidenceLeaks: 0,
    sqlite: {
      databasesOpened: 0,
    },
  };

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    for (const surface of SQLITE_CAS_SURFACE_DEFINITIONS) {
      const fixture = createSqliteCasFixture(surface, iteration);
      const shape = buildSqliteCasUpdateShape(surface);
      coverage.sqlShapes.push(shape);
      const surfaceSummary = coverage.surfaces.find((entry) => entry.logicalTable === surface.logicalTable)
        || addSurfaceSummary(coverage, surface, shape);

      const success = withFixtureDatabase(DatabaseSync, coverage, surface, [fixture.expectedStorage], (database) => {
        const write = applySqliteCasWriteGuard({
          database,
          surface,
          expectedResource: fixture.expectedResource,
          expectedStorage: fixture.expectedStorage,
          nextStorage: fixture.nextStorage,
        });
        const row = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);
        return { write, row };
      });
      coverage.writes.attempted += 1;
      if (success.write.applied && success.write.storageGuard.rowsAffected === 1 && success.write.storageGuard.outcome === 'applied') {
        coverage.writes.applied += 1;
        surfaceSummary.applied += 1;
      } else {
        coverage.failures.push(`${surface.id}: matching storage did not update exactly one row`);
      }
      if (!storageHasSetColumns(success.row, fixture.nextStorage, surface.setColumns)) {
        coverage.failures.push(`${surface.id}: matching storage update did not persist planned set columns`);
      }
      recordEvidenceSample(coverage, success.write.storageGuard);

      const stale = withFixtureDatabase(DatabaseSync, coverage, surface, [fixture.driftedStorage], (database) => {
        const write = applySqliteCasWriteGuard({
          database,
          surface,
          expectedResource: fixture.expectedResource,
          expectedStorage: fixture.expectedStorage,
          nextStorage: fixture.nextStorage,
        });
        const row = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);
        return { write, row };
      });
      coverage.writes.attempted += 1;
      if (!stale.write.applied && stale.write.storageGuard.rowsAffected === 0 && stale.write.storageGuard.outcome === 'stale-at-write') {
        coverage.writes.staleAtWrite += 1;
        surfaceSummary.staleAtWrite += 1;
      } else {
        coverage.failures.push(`${surface.id}: stale storage was not rejected`);
      }
      if (!storageHasSetColumns(stale.row, fixture.driftedStorage, surface.setColumns)) {
        coverage.failures.push(`${surface.id}: stale storage row changed despite rejected guard`);
      }
      recordEvidenceSample(coverage, stale.write.storageGuard);

      const absent = withFixtureDatabase(DatabaseSync, coverage, surface, [], (database) => {
        const write = applySqliteCasWriteGuard({
          database,
          surface,
          expectedResource: fixture.expectedResource,
          expectedStorage: fixture.expectedStorage,
          nextStorage: fixture.nextStorage,
        });
        const row = readSqliteCasStorageByKey(database, surface, fixture.expectedStorage);
        return { write, row };
      });
      coverage.writes.attempted += 1;
      if (!absent.write.applied && absent.write.storageGuard.rowsAffected === 0 && absent.write.storageGuard.outcome === 'stale-at-write') {
        coverage.writes.absentAtWrite += 1;
        surfaceSummary.absentAtWrite += 1;
      } else {
        coverage.failures.push(`${surface.id}: absent storage was not rejected`);
      }
      if (absent.row !== ABSENT) {
        coverage.failures.push(`${surface.id}: absent storage guard inserted or changed a row`);
      }
      recordEvidenceSample(coverage, absent.write.storageGuard);

      for (const write of [success.write, stale.write, absent.write]) {
        if (write.storageGuard.rowsAffected > 1) {
          coverage.writes.unsafeMultipleMatch += 1;
          coverage.failures.push(`${surface.id}: guard affected more than one row`);
        }
      }
    }
  }

  coverage.sqlShapes = dedupeShapes(coverage.sqlShapes);
  return coverage;
}

function unavailableCoverage(config, runtimeReport) {
  return {
    iterations: config.iterations,
    surfaces: SQLITE_CAS_SURFACE_DEFINITIONS.map((surface) => {
      const shape = buildSqliteCasUpdateShape(surface);
      return {
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
    }),
    writes: {
      attempted: 0,
      applied: 0,
      staleAtWrite: 0,
      absentAtWrite: 0,
      unsafeMultipleMatch: 0,
    },
    sqlShapes: dedupeShapes(SQLITE_CAS_SURFACE_DEFINITIONS.map(buildSqliteCasUpdateShape)),
    evidenceSamples: [],
    failures: [`SQLite runtime unavailable: ${runtimeReport.detail}`],
    rawValueEvidenceLeaks: 0,
    sqlite: {
      databasesOpened: 0,
    },
  };
}

function withFixtureDatabase(DatabaseSync, coverage, surface, rows, callback) {
  const database = new DatabaseSync(':memory:');
  coverage.sqlite.databasesOpened += 1;
  try {
    createSqliteCasFixtureTable(database, surface);
    for (const row of rows) {
      insertSqliteCasFixtureRow(database, surface, row);
    }
    return callback(database);
  } finally {
    database.close();
  }
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
  if (coverage.evidenceSamples.length < SQLITE_CAS_SURFACE_DEFINITIONS.length * 2) {
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
      nullSafePredicate: shape.nullSafePredicate,
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
      boundary: SQLITE_CAS_BOUNDARY,
      adapter: SQLITE_CAS_ADAPTER,
      engine: 'sqlite',
      logicalTables: deterministicCoverage.surfaces.length,
      guardedWritesAttempted: deterministicCoverage.writes.attempted,
      appliedWrites: deterministicCoverage.writes.applied,
      staleAtWriteWrites: deterministicCoverage.writes.staleAtWrite,
      absentAtWriteWrites: deterministicCoverage.writes.absentAtWrite,
      unsafeMultipleMatchWrites: deterministicCoverage.writes.unsafeMultipleMatch,
      comparedColumnsByTable: Object.fromEntries(
        deterministicCoverage.surfaces.map((surface) => [surface.logicalTable, surface.comparedColumns]),
      ),
    },
    sqlite: {
      databasesOpened: deterministicCoverage.sqlite.databasesOpened,
    },
    sql: {
      singleStatementShapes: deterministicCoverage.sqlShapes.length,
      shapes: deterministicCoverage.sqlShapes,
    },
  };
}

function evaluateSqliteCasGates({ deterministicCoverage, runtime, resources, maxDurationMs, maxHeapUsedBytes }) {
  const expectedPerOutcome = deterministicCoverage.iterations * SQLITE_CAS_SURFACE_DEFINITIONS.length;
  const shapeChecks = deterministicCoverage.sqlShapes.map((shape) => {
    const fullShape = buildSqliteCasUpdateShape(shape.logicalTable).sqlShape;
    return fullShape.startsWith('UPDATE ')
      && fullShape.includes(' SET ')
      && fullShape.includes(' WHERE ')
      && !fullShape.includes(';')
      && shape.comparedColumns.every((column) => fullShape.includes(`${quoteSqliteIdentifierForBenchmark(column)} IS ?`));
  });
  const evidenceHashesOk = deterministicCoverage.evidenceSamples.every((evidence) => (
    /^[a-f0-9]{64}$/.test(evidence.expectedResourceHash)
      && /^[a-f0-9]{64}$/.test(evidence.expectedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.plannedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.observedStorageHash)
      && /^[a-f0-9]{64}$/.test(evidence.sqlShapeHash)
  ));
  const sqliteRuntimeAvailable = runtime.sqliteRuntime.status === 'available'
    && typeof runtime.sqliteRuntime.sqliteVersion === 'string'
    && runtime.sqliteRuntime.sqliteVersion.length > 0;

  return [
    gate('sqlite-runtime-available', sqliteRuntimeAvailable, {
      status: runtime.sqliteRuntime.status,
      sqliteVersion: runtime.sqliteRuntime.sqliteVersion || null,
      unavailableCapabilities: runtime.sqliteRuntime.unavailableCapabilities || [],
    }),
    gate('deterministic-guard-behavior', deterministicCoverage.failures.length === 0, {
      attempted: deterministicCoverage.writes.attempted,
      failures: deterministicCoverage.failures.length,
    }),
    gate('applied-and-stale-outcomes',
      deterministicCoverage.writes.applied === expectedPerOutcome
        && deterministicCoverage.writes.staleAtWrite === expectedPerOutcome
        && deterministicCoverage.writes.absentAtWrite === expectedPerOutcome
        && deterministicCoverage.writes.unsafeMultipleMatch === 0,
      {
        expectedPerOutcome,
        applied: deterministicCoverage.writes.applied,
        staleAtWrite: deterministicCoverage.writes.staleAtWrite,
        absentAtWrite: deterministicCoverage.writes.absentAtWrite,
        unsafeMultipleMatch: deterministicCoverage.writes.unsafeMultipleMatch,
      }),
    gate('single-statement-null-safe-cas-shapes',
      deterministicCoverage.sqlShapes.length === SQLITE_CAS_SURFACE_DEFINITIONS.length
        && shapeChecks.every(Boolean),
      {
        shapeCount: deterministicCoverage.sqlShapes.length,
        expectedShapeCount: SQLITE_CAS_SURFACE_DEFINITIONS.length,
      }),
    gate('hash-only-evidence', evidenceHashesOk && deterministicCoverage.rawValueEvidenceLeaks === 0, {
      evidenceSamples: deterministicCoverage.evidenceSamples.length,
      rawValueEvidenceLeaks: deterministicCoverage.rawValueEvidenceLeaks,
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

function storageHasSetColumns(row, expected, columns) {
  if (row === ABSENT) {
    return false;
  }
  const leftHash = digest(pickSqliteCasColumns(row, columns));
  const rightHash = digest(pickSqliteCasColumns(expected, columns));
  return leftHash === rightHash;
}

function evidenceContainsRawFixtureData(evidence) {
  const json = JSON.stringify(evidence);
  return RAW_FIXTURE_TOKENS.some((token) => json.includes(token));
}

function elapsedMs(started) {
  return Math.round((performance.now() - started) * 1000) / 1000;
}

function quoteSqliteIdentifierForBenchmark(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
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
    if (arg === '--max-heap-used-bytes') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--max-heap-used-bytes requires a value');
      }
      options.maxHeapUsedBytes = Number(argv[index]);
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
    'Usage: node scripts/bench/sqlite-cas-write-guard.js [--iterations <n>] [--max-duration-ms <ms>] [--max-heap-used-bytes <bytes>]',
    '',
    'Reports runtime, resource usage, and pass/fail gates for the RPP-0702 SQLite compare-and-swap write guard benchmark.',
    'The benchmark uses node:sqlite in-memory databases and verifies matching writes apply while stale and absent storage states are rejected.',
    '',
  ].join('\n'));
}

export async function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = await runSqliteCasWriteGuardBenchmark(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmark: SQLITE_CAS_BENCHMARK_ID,
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
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
