#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { applyPlan } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

export const LARGE_POST_TABLE_BENCHMARK_ID = 'rpp-0714-large-post-table';

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const MIB = 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'RPP0714 base post',
  'RPP0714 local post',
  'RPP0714 post body',
  'rpp-0714-post-',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    tableRows: 96,
    changedRows: 48,
    batchSizeRows: 12,
    maxDurationMs: 3_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    tableRows: 20_000,
    changedRows: 10_000,
    batchSizeRows: 500,
    maxDurationMs: 15_000,
    maxHeapUsedBytes: 256 * MIB,
  }),
});

export function runLargePostTableBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const timings = {};

  const fixtureStarted = performance.now();
  const sites = createPostBenchmarkSites(config);
  timings.fixtureMs = elapsedMs(fixtureStarted);

  const planStarted = performance.now();
  const plan = createPushPlan({
    base: sites.base,
    local: sites.local,
    remote: sites.remote,
    now: config.now,
  });
  timings.planMs = elapsedMs(planStarted);

  const batchStarted = performance.now();
  const batchWindows = buildPostBatchWindows(plan.mutations, config.batchSizeRows);
  timings.batchWindowMs = elapsedMs(batchStarted);

  const applyStarted = performance.now();
  const applyResult = applyPlan(sites.remote, plan);
  timings.applyMs = elapsedMs(applyStarted);

  const verifyStarted = performance.now();
  const verification = verifyAppliedRows({
    config,
    plan,
    local: sites.local,
    remote: sites.remote,
    applied: applyResult.site,
  });
  timings.verifyMs = elapsedMs(verifyStarted);
  timings.totalMs = elapsedMs(started);

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const runtime = buildRuntimeReport({ config, timings });
  const resources = buildResourceReport({
    config,
    plan,
    batchWindows,
    applyResult,
    verification,
    startUsage,
    endUsage,
    startMemory,
    endMemory,
  });
  const deterministicCoverage = buildCoverageReport({
    config,
    plan,
    batchWindows,
    verification,
  });
  deterministicCoverage.redaction.rawValueEvidenceLeaks = countRawValueEvidenceLeaks({
    runtime,
    resources,
    deterministicCoverage,
  });

  const gates = evaluateLargePostTableGates({
    config,
    plan,
    resources,
    runtime,
    deterministicCoverage,
  });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0714',
    benchmark: LARGE_POST_TABLE_BENCHMARK_ID,
    profile: config.profile,
    ok: gates.every((gate) => gate.status === 'pass'),
    runtime,
    resources,
    gates,
    deterministicCoverage,
    claims: {
      largeSiteBudget: gates.find((gate) => gate.id === 'large-site-runtime-budget')?.status || 'fail',
      productionThroughput: 'not-claimed',
    },
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown large post table benchmark profile: ${profileName}`);
  }
  const config = {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0714-large-post-table',
    tableRows: integerOption(options.tableRows, 'tableRows', profile.tableRows),
    changedRows: integerOption(options.changedRows, 'changedRows', profile.changedRows),
    batchSizeRows: integerOption(options.batchSizeRows, 'batchSizeRows', profile.batchSizeRows),
    maxDurationMs: integerOption(options.maxDurationMs, 'maxDurationMs', profile.maxDurationMs),
    maxHeapUsedBytes: integerOption(options.maxHeapUsedBytes, 'maxHeapUsedBytes', profile.maxHeapUsedBytes),
  };
  if (config.tableRows < 1) {
    throw new Error('tableRows must be at least 1');
  }
  if (config.changedRows < 1) {
    throw new Error('changedRows must be at least 1');
  }
  if (config.changedRows > config.tableRows) {
    throw new Error('changedRows must be less than or equal to tableRows');
  }
  if (config.batchSizeRows < 1) {
    throw new Error('batchSizeRows must be at least 1');
  }
  return config;
}

function integerOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

function createPostBenchmarkSites(config) {
  return {
    base: createPostSite(config, 0),
    local: createPostSite(config, config.changedRows),
    remote: createPostSite(config, 0),
  };
}

function createPostSite(config, changedRows) {
  const site = {
    files: {},
    plugins: {},
    db: {
      wp_posts: {},
    },
  };
  for (let postId = 1; postId <= config.tableRows; postId += 1) {
    site.db.wp_posts[`ID:${postId}`] = postRow({
      config,
      postId,
      changed: postId <= changedRows,
    });
  }
  return site;
}

function postRow({ config, postId, changed }) {
  const revision = changed ? 'local' : 'base';
  const titlePrefix = changed ? 'RPP0714 local post' : 'RPP0714 base post';
  return {
    ID: postId,
    post_content: deterministicPostContent(config.seed, revision, postId),
    post_title: `${titlePrefix} ${postId}`,
    post_status: 'publish',
    post_type: 'post',
  };
}

function deterministicPostContent(seed, revision, postId) {
  const marker = digest({
    seed,
    revision,
    postId,
    fixture: 'RPP0714 post body',
  });
  return `RPP0714 post body ${revision} ${postId} ${marker}`;
}

function buildPostBatchWindows(mutations, batchSizeRows) {
  const rows = mutations
    .filter((mutation) => mutation.resource?.type === 'row' && mutation.resource.table === 'wp_posts')
    .map((mutation) => ({
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      postId: postIdFromResource(mutation.resource),
      remoteBeforeHash: mutation.remoteBeforeHash,
      localHash: mutation.localHash,
    }))
    .sort((left, right) => left.postId - right.postId);
  const batches = [];
  for (let offset = 0; offset < rows.length; offset += batchSizeRows) {
    const batchRows = rows.slice(offset, offset + batchSizeRows);
    const first = batchRows[0];
    const last = batchRows[batchRows.length - 1];
    batches.push({
      batchId: `wp_posts:${String(batches.length + 1).padStart(4, '0')}`,
      batchIndex: batches.length,
      table: 'wp_posts',
      rowCount: batchRows.length,
      firstPostId: first.postId,
      lastPostId: last.postId,
      firstMutationId: first.mutationId,
      lastMutationId: last.mutationId,
      preconditionCount: batchRows.length,
      rowHashDigest: digest(batchRows.map((row) => ({
        postId: row.postId,
        remoteBeforeHash: row.remoteBeforeHash,
        localHash: row.localHash,
      }))),
    });
  }
  return {
    rows,
    batches,
    coverage: batchCoverage(rows, batches, batchSizeRows),
  };
}

function batchCoverage(rows, batches, batchSizeRows) {
  const postIds = rows.map((row) => row.postId);
  const uniquePostIds = new Set(postIds);
  const monotonicPrimaryKeyOrder = postIds.every((postId, index) =>
    index === 0 || postId > postIds[index - 1]);
  const observedRows = batches.reduce((sum, batch) => sum + batch.rowCount, 0);
  const maxObservedBatchRows = batches.reduce((max, batch) => Math.max(max, batch.rowCount), 0);
  return {
    table: 'wp_posts',
    batchSizeRows,
    plannedRows: rows.length,
    observedRows,
    batches: batches.length,
    duplicatePostIds: postIds.length - uniquePostIds.size,
    monotonicPrimaryKeyOrder,
    maxObservedBatchRows,
    allRowsCoveredOnce: observedRows === rows.length && uniquePostIds.size === rows.length,
    everyBatchWithinLimit: maxObservedBatchRows <= batchSizeRows,
  };
}

function verifyAppliedRows({ config, plan, local, remote, applied }) {
  const changedResources = [];
  const failures = [];
  for (let postId = 1; postId <= config.changedRows; postId += 1) {
    const resource = postResource(postId);
    const appliedHash = resourceHash(applied, resource);
    const localHash = resourceHash(local, resource);
    if (appliedHash !== localHash) {
      failures.push(`ID:${postId}: applied hash did not match local hash`);
    }
    changedResources.push({
      postId,
      resource,
      appliedHash,
      localHash,
      remoteBeforeHash: resourceHash(remote, resource),
    });
  }

  const unchangedSamples = samplePostIds(config.changedRows + 1, config.tableRows, 3)
    .map((postId) => {
      const resource = postResource(postId);
      const appliedHash = resourceHash(applied, resource);
      const remoteHash = resourceHash(remote, resource);
      if (appliedHash !== remoteHash) {
        failures.push(`ID:${postId}: unchanged row drifted during apply`);
      }
      return {
        postId,
        appliedHash,
        remoteHash,
      };
    });

  const changedSamples = samplePostIds(1, config.changedRows, 5)
    .map((postId) => {
      const resource = postResource(postId);
      return {
        postId,
        resourceKeyHash: digest(resource.key),
        remoteBeforeHash: resourceHash(remote, resource),
        appliedHash: resourceHash(applied, resource),
        localHash: resourceHash(local, resource),
      };
    });

  return {
    planStatus: plan.status,
    planMutations: plan.mutations.length,
    appliedMutationsExpected: config.changedRows,
    changedRowsVerified: changedResources.length - failures.filter((failure) =>
      failure.includes('applied hash did not match local hash')).length,
    unchangedSamplesVerified: unchangedSamples.filter((sample) =>
      sample.appliedHash === sample.remoteHash).length,
    changedSamples,
    unchangedSamples: unchangedSamples.map((sample) => ({
      postId: sample.postId,
      resourceKeyHash: digest(postResource(sample.postId).key),
      appliedHash: sample.appliedHash,
      remoteHash: sample.remoteHash,
    })),
    failures,
  };
}

function buildRuntimeReport({ config, timings }) {
  return {
    benchmarkId: LARGE_POST_TABLE_BENCHMARK_ID,
    generatedAt: config.now.toISOString(),
    durationMs: timings.totalMs,
    timings,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    budgets: {
      profile: config.profile,
      maxDurationMs: config.maxDurationMs,
      maxHeapUsedBytes: config.maxHeapUsedBytes,
    },
  };
}

function buildResourceReport({
  config,
  plan,
  batchWindows,
  applyResult,
  verification,
  startUsage,
  endUsage,
  startMemory,
  endMemory,
}) {
  return {
    table: {
      engine: 'in-memory-wordpress-site-fixture',
      table: 'wp_posts',
      totalRows: config.tableRows,
      changedRows: config.changedRows,
      unchangedRows: config.tableRows - config.changedRows,
      mutationRows: plan.mutations.length,
      applyMode: 'applyPlan-live-precondition-row-mutations',
      storageBoundary: 'live-remote-hash-precondition-before-apply',
    },
    batchSizing: {
      table: 'wp_posts',
      batchSizeRows: config.batchSizeRows,
      batchCount: batchWindows.batches.length,
      maxObservedBatchRows: batchWindows.coverage.maxObservedBatchRows,
      observedRows: batchWindows.coverage.observedRows,
      duplicatePostIds: batchWindows.coverage.duplicatePostIds,
      order: 'primary-key-ascending',
      allRowsCoveredOnce: batchWindows.coverage.allRowsCoveredOnce,
    },
    preconditions: {
      expected: config.changedRows,
      recorded: plan.preconditions.length,
      liveRemote: plan.preconditions.filter((precondition) =>
        precondition.checkedAgainst === 'live-remote').length,
      everyMutationHasLivePrecondition: everyMutationHasLivePrecondition(plan),
    },
    apply: {
      appliedMutations: applyResult.appliedMutations,
      changedRowsVerified: verification.changedRowsVerified,
      unchangedSamplesVerified: verification.unchangedSamplesVerified,
      verificationFailures: verification.failures.length,
    },
    process: {
      userCpuMs: microsecondsToMilliseconds(endUsage.userCPUTime - startUsage.userCPUTime),
      systemCpuMs: microsecondsToMilliseconds(endUsage.systemCPUTime - startUsage.systemCPUTime),
      maxRssBytes: endUsage.maxRSS * 1024,
      heapUsedBytes: endMemory.heapUsed,
      heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
    },
    runtimeBudget: {
      profile: config.profile,
      maxDurationMs: config.maxDurationMs,
      maxHeapUsedBytes: config.maxHeapUsedBytes,
    },
  };
}

function buildCoverageReport({ config, plan, batchWindows, verification }) {
  return {
    profile: config.profile,
    workload: {
      table: 'wp_posts',
      totalRows: config.tableRows,
      changedRows: config.changedRows,
      batchSizeRows: config.batchSizeRows,
    },
    plan: {
      status: plan.status,
      mutations: plan.mutations.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      decisions: plan.decisions.length,
    },
    batchWindows: batchWindows.batches.map((batch) => ({
      batchId: batch.batchId,
      batchIndex: batch.batchIndex,
      table: batch.table,
      rowCount: batch.rowCount,
      firstPostId: batch.firstPostId,
      lastPostId: batch.lastPostId,
      preconditionCount: batch.preconditionCount,
      rowHashDigest: batch.rowHashDigest,
    })),
    batchCoverage: batchWindows.coverage,
    hashOnlySamples: {
      changedRows: verification.changedSamples,
      unchangedRows: verification.unchangedSamples,
    },
    failures: verification.failures,
    redaction: {
      rawValueEvidenceLeaks: 0,
    },
  };
}

function evaluateLargePostTableGates({
  config,
  plan,
  resources,
  runtime,
  deterministicCoverage,
}) {
  const coverage = deterministicCoverage.batchCoverage;
  return [
    gate('large-post-table-plan-ready',
      plan.status === 'ready'
        && plan.conflicts.length === 0
        && plan.blockers.length === 0
        && plan.mutations.length === config.changedRows,
      {
        status: plan.status,
        mutations: plan.mutations.length,
        expectedMutations: config.changedRows,
        conflicts: plan.conflicts.length,
        blockers: plan.blockers.length,
      }),
    gate('wp-posts-live-preconditions',
      resources.preconditions.recorded === config.changedRows
        && resources.preconditions.liveRemote === config.changedRows
        && resources.preconditions.everyMutationHasLivePrecondition,
      resources.preconditions),
    gate('bounded-primary-key-batches',
      coverage.allRowsCoveredOnce
        && coverage.everyBatchWithinLimit
        && coverage.duplicatePostIds === 0
        && coverage.monotonicPrimaryKeyOrder,
      coverage),
    gate('apply-result-matches-plan',
      resources.apply.appliedMutations === config.changedRows
        && resources.apply.changedRowsVerified === config.changedRows
        && resources.apply.verificationFailures === 0,
      resources.apply),
    gate('hash-only-evidence',
      deterministicCoverage.redaction.rawValueEvidenceLeaks === 0,
      {
        rawValueEvidenceLeaks: deterministicCoverage.redaction.rawValueEvidenceLeaks,
        changedSampleRows: deterministicCoverage.hashOnlySamples.changedRows.length,
        unchangedSampleRows: deterministicCoverage.hashOnlySamples.unchangedRows.length,
      }),
    gate('large-site-runtime-budget',
      runtime.durationMs <= config.maxDurationMs
        && resources.process.heapUsedBytes <= config.maxHeapUsedBytes,
      {
        profile: config.profile,
        durationMs: runtime.durationMs,
        maxDurationMs: config.maxDurationMs,
        heapUsedBytes: resources.process.heapUsedBytes,
        maxHeapUsedBytes: config.maxHeapUsedBytes,
      }),
  ];
}

function everyMutationHasLivePrecondition(plan) {
  const preconditionsByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );
  return plan.mutations.every((mutation) => {
    const precondition = preconditionsByMutationId.get(mutation.id);
    return precondition
      && precondition.resourceKey === mutation.resourceKey
      && precondition.expectedHash === mutation.remoteBeforeHash
      && precondition.checkedAgainst === 'live-remote';
  });
}

function gate(id, passed, evidence = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence,
  };
}

function postResource(postId) {
  return {
    type: 'row',
    table: 'wp_posts',
    id: `ID:${postId}`,
    key: `row:${JSON.stringify(['wp_posts', `ID:${postId}`])}`,
  };
}

function postIdFromResource(resource) {
  const match = String(resource?.id || '').match(/^ID:(\d+)$/);
  if (!match) {
    throw new Error(`Unexpected wp_posts resource id: ${resource?.id}`);
  }
  return Number(match[1]);
}

function samplePostIds(first, last, limit) {
  if (first > last) {
    return [];
  }
  const candidates = [
    first,
    Math.floor((first + last) / 2),
    last,
    first + 1,
    last - 1,
  ].filter((postId) => postId >= first && postId <= last);
  return [...new Set(candidates)].slice(0, limit);
}

function countRawValueEvidenceLeaks(value) {
  const text = JSON.stringify(value);
  return RAW_FIXTURE_TOKENS.filter((token) => text.includes(token)).length;
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
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'profile') {
      options.profile = value;
    } else if (key === 'table-rows') {
      options.tableRows = Number.parseInt(value, 10);
    } else if (key === 'changed-rows') {
      options.changedRows = Number.parseInt(value, 10);
    } else if (key === 'batch-size-rows') {
      options.batchSizeRows = Number.parseInt(value, 10);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runLargePostTableBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
