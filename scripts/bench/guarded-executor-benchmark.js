#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { applyPlan, PushPlanError } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import {
  appendRecoveryClaimOpened,
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../../src/recovery-inspect.js';
import { resourceHash } from '../../src/resources.js';
import { DEFAULT_LIMITS, MIB } from './performance-model.js';

const FIXED_NOW = new Date('2026-05-24T00:00:00.000Z');
const LARGE_UPLOAD_PATH = 'wp-content/uploads/2026/05/catalog-export.bin';
const COMMERCE_PLUGIN = 'commerce';
const PAYMENTS_PLUGIN = 'payments';
const COMMERCE_MAIN_FILE = `wp-content/plugins/${COMMERCE_PLUGIN}/${COMMERCE_PLUGIN}.php`;
const PAYMENTS_MAIN_FILE = `wp-content/plugins/${PAYMENTS_PLUGIN}/${PAYMENTS_PLUGIN}.php`;
const ATOMIC_GROUP_ID = 'install-commerce-stack';
const BENCHMARK_GRAPH_ROW_IDS = Object.freeze({
  postsParents: 'ID:20001',
  featuredAttachment: 'ID:20002',
  featuredImageMeta: 'meta_id:20001',
  term: 'term_id:20001',
  termTaxonomy: 'term_taxonomy_id:20001',
  termRelationship: 'object_id:10000|term_taxonomy_id:20001',
  termmeta: 'meta_id:20002',
});
const GRAPH_FAMILY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'postsParents',
    label: 'posts/parents',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Benchmark covers a ready-plan wp_posts.post_parent row against a stable remote parent identity.',
  }),
  Object.freeze({
    id: 'postmetaPostRefs',
    label: 'postmeta/post refs',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/bench/guarded-executor-benchmark.js',
    notes: 'Covers stable wp_postmeta.post_id references only; same-plan rewrites still block.',
  }),
  Object.freeze({
    id: 'featuredImagesAttachments',
    label: 'featured images/attachments',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Benchmark covers a ready-plan attachment row plus _thumbnail_id rewrite against that same-plan attachment.',
  }),
  Object.freeze({
    id: 'termsTaxonomies',
    label: 'terms/taxonomies',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Benchmark covers a ready-plan wp_terms/wp_term_taxonomy closure on a supported taxonomy surface.',
  }),
  Object.freeze({
    id: 'termRelationships',
    label: 'term relationships',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/push-protocol-smoke.mjs',
    notes: 'Benchmark covers a ready-plan wp_term_relationships row against a stable post and same-plan taxonomy.',
  }),
  Object.freeze({
    id: 'termmeta',
    label: 'termmeta',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    notes: 'Benchmark covers a ready-plan wp_termmeta row against a same-plan term target.',
  }),
  Object.freeze({
    id: 'unsupportedPluginOwnedSurfaces',
    label: 'unsupported/plugin-owned surfaces',
    plannerOwner: 'planner:test/push-planner.test.js',
    smokeOwner: 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    notes: 'Must stay fail-closed until an allowlisted driver and smoke prove safe ownership/mapping.',
  }),
]);

export const GUARDED_EXECUTOR_BENCHMARK_PROFILES = Object.freeze({
  unit: Object.freeze({
    fileBytes: 2 * MIB,
    chunkSizeBytes: 512 * 1024,
    rowCount: 24,
    rowPayloadBytes: 256,
  }),
  ci: Object.freeze({
    fileBytes: 16 * MIB,
    chunkSizeBytes: 1 * MIB,
    rowCount: 128,
    rowPayloadBytes: 512,
  }),
  guardedLarge: Object.freeze({
    fileBytes: 384 * MIB,
    chunkSizeBytes: DEFAULT_LIMITS.chunkSizeBytes,
    rowCount: 2_000,
    rowPayloadBytes: 700,
  }),
});

export class BenchmarkClaimError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BenchmarkClaimError';
    this.code = details.code || 'BENCHMARK_CLAIM_BLOCKED';
    this.details = details;
  }
}

export function runGuardedExecutorBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const tempDir = config.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-guarded-bench-'));
  fs.mkdirSync(tempDir, { recursive: true });
  const journalClaimPrefix = path.basename(tempDir);

  const timings = {};
  const successJournalPath = path.join(tempDir, 'success.jsonl');
  const successClaimId = `${journalClaimPrefix}:guarded-executor-benchmark-success`;
  const successJournal = openRecoveryJournal(successJournalPath, {
    truncate: true,
    now: config.now,
    claimId: successClaimId,
  });
  appendRecoveryClaimOpened(successJournal, {
    plan: { id: 'plan-guarded-executor-benchmark' },
    current: { benchmark: 'guarded-executor-benchmark', phase: 'success' },
    claimId: successClaimId,
    reason: 'Benchmark staging claim opened before durable chunk receipts.',
  });

  let stagedFile;
  let plan;
  let sites;
  let applyResult;
  const totalStarted = performance.now();

  try {
    const stageStarted = performance.now();
    stagedFile = stageGeneratedFileBytes({
      tempDir,
      journal: successJournal,
      planId: 'plan-guarded-executor-benchmark',
      resourceKey: `file:${LARGE_UPLOAD_PATH}`,
      fileBytes: config.fileBytes,
      chunkSizeBytes: config.chunkSizeBytes,
      seed: config.seed,
    });
    timings.stageFileMs = elapsedMs(stageStarted);

    const planStarted = performance.now();
    sites = buildBenchmarkSites(config, stagedFile);
    plan = createPushPlan({
      base: sites.base,
      local: sites.local,
      remote: sites.remote,
      now: config.now,
    });
    assertBenchmarkPlan(plan, config, sites);
    timings.planMs = elapsedMs(planStarted);

    const applyStarted = performance.now();
    applyResult = applyPlan(clone(sites.remote), plan, { durableJournal: successJournal });
    timings.applyMs = elapsedMs(applyStarted);
  } finally {
    successJournal.close();
  }

  const successPersisted = readRecoveryJournal(successJournalPath);
  const successInspection = inspectRecoveryJournal({
    journal: successPersisted,
    plan,
    current: applyResult.site,
  });
  const preCommitFailure = runFailureProbe({
    mode: 'pre-commit',
    plan,
    remote: sites.remote,
    tempDir,
    now: config.now,
  });
  const partialFailure = runFailureProbe({
    mode: 'partial-commit',
    plan,
    remote: sites.remote,
    tempDir,
    now: config.now,
    failDuringCommitAtMutation: firstAtomicGroupMutationIndex(plan),
  });

  timings.totalMs = elapsedMs(totalStarted);
  const report = buildReport({
    config,
    tempDir,
    timings,
    stagedFile,
    plan,
    sites,
    applyResult,
    successPersisted,
    successInspection,
    preCommitFailure,
    partialFailure,
  });
  report.claims.productionThroughput = productionThroughputClaim(report);

  if (config.claimProductionThroughput) {
    assertCanClaimProductionThroughput(report);
  }

  return report;
}

export function productionThroughputBlockers(report) {
  const blockers = [];
  if (report.evidence.chunkReceipts.recorded !== report.evidence.chunkReceipts.expected) {
    blockers.push('missing-durable-chunk-receipts');
  }
  if (!report.evidence.preconditions.everyMutationHasLiveRemotePrecondition) {
    blockers.push('missing-live-remote-preconditions');
  }
  if (!report.evidence.journal.allJournalsIntegrityOk) {
    blockers.push('missing-durable-journal-integrity');
  }
  if (!report.evidence.redaction.durableJournalsContainNoRawValues) {
    blockers.push('durable-journal-redaction-not-proven');
  }
  if (
    !report.evidence.wordpressGraphIdentity?.allPostmetaReferencesUseStableRemoteIdentity
    || report.evidence.wordpressGraphIdentity.graphIdentityBlockers !== 0
  ) {
    blockers.push('wordpress-graph-identity-evidence-not-proven');
  }
  if (!report.evidence.recovery.successReplayInspectable) {
    blockers.push('missing-success-recovery-evidence');
  }
  if (!report.evidence.recovery.preCommitFailureInspectable) {
    blockers.push('missing-pre-commit-recovery-evidence');
  }
  if (!report.evidence.recovery.partialCommitBlocksRecovery) {
    blockers.push('missing-partial-commit-recovery-evidence');
  }
  if (!report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged) {
    blockers.push('atomic-group-pre-commit-visibility-not-proven');
  }
  if (!report.evidence.atomicGroup.productionAtomicCommitMeasured) {
    blockers.push('production-atomic-group-commit-not-measured');
  }
  if (report.executorCapabilities.fileReceipts !== 'production-storage-receipts') {
    blockers.push('production-storage-receipts-not-measured');
  }
  if (report.executorCapabilities.rowApply !== 'production-batched-compare-and-swap') {
    blockers.push('production-row-batch-executor-not-measured');
  }
  return blockers;
}

export function productionThroughputClaim(report) {
  const blockers = productionThroughputBlockers(report);
  return {
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    blockers,
  };
}

export function assertCanClaimProductionThroughput(report) {
  const claim = productionThroughputClaim(report);
  if (!claim.allowed) {
    throw new BenchmarkClaimError(
      `Production throughput claim blocked: ${claim.blockers.join(', ')}`,
      {
        code: 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED',
        blockers: claim.blockers,
      },
    );
  }
}

function benchmarkConfig(options) {
  const profileName = options.profile || 'ci';
  const profile = GUARDED_EXECUTOR_BENCHMARK_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown guarded executor benchmark profile: ${profileName}`);
  }
  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || FIXED_NOW,
    seed: options.seed || 'guarded-executor-benchmark-v1',
    claimProductionThroughput: options.claimProductionThroughput === true,
  };
}

function stageGeneratedFileBytes({
  tempDir,
  journal,
  planId,
  resourceKey,
  fileBytes,
  chunkSizeBytes,
  seed,
}) {
  const stagingDir = path.join(tempDir, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagingPath = path.join(stagingDir, 'catalog-export.bin');
  const fd = fs.openSync(stagingPath, 'w');
  const fileHash = crypto.createHash('sha256');
  const chunkCount = Math.ceil(fileBytes / chunkSizeBytes);
  let bytesMoved = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const offsetBytes = chunkIndex * chunkSizeBytes;
      const sizeBytes = Math.min(chunkSizeBytes, fileBytes - offsetBytes);
      const chunk = deterministicChunk(sizeBytes, seed, chunkIndex);
      const chunkDigest = digestBuffer(chunk);
      fileHash.update(chunk);
      fs.writeSync(fd, chunk, 0, chunk.length, offsetBytes);
      bytesMoved += chunk.length;
      journal.appendEvent('chunk-receipt', {
        planId,
        resourceKey,
        state: 'staged',
        chunkIndex,
        chunkCount,
        offsetBytes,
        sizeBytes,
        chunkDigest: `sha256:${chunkDigest}`,
        canonicalVisible: false,
        idempotencyKey: `${planId}:${resourceKey}:chunk:${chunkIndex}`,
        receiptKey: `${planId}:${resourceKey}:${chunkIndex}:sha256:${chunkDigest}`,
        artifactRefs: {
          staging: `bench-staging:${resourceKey}:${chunkIndex}`,
        },
      });
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const assembledDigest = fileHash.digest('hex');
  const stat = fs.statSync(stagingPath);
  journal.appendEvent('file-staging-finalized', {
    planId,
    resourceKey,
    state: 'staged-file-complete',
    chunkReceipts: chunkCount,
    sizeBytes: stat.size,
    assembledHash: `sha256:${assembledDigest}`,
    canonicalVisible: false,
    idempotencyKey: `${planId}:${resourceKey}:file-staging-finalize`,
    artifactRefs: {
      staging: `bench-staging:${resourceKey}:assembled`,
    },
  });

  return {
    stagingPath,
    bytesMoved,
    chunkCount,
    chunkSizeBytes,
    assembledHash: `sha256:${assembledDigest}`,
    descriptor: fileDescriptor({
      sizeBytes: stat.size,
      contentDigest: `sha256:${assembledDigest}`,
      storage: 'bench-generated-chunk-staging',
    }),
  };
}

function buildBenchmarkSites(config, stagedFile) {
  const base = {
    files: {
      [LARGE_UPLOAD_PATH]: fileDescriptor({
        sizeBytes: config.fileBytes,
        contentDigest: digestLabel('base-large-upload'),
        storage: 'remote-existing-file',
      }),
      [PAYMENTS_MAIN_FILE]: fileDescriptor({
        sizeBytes: 4096,
        contentDigest: digestLabel('payments-plugin-file'),
        storage: 'remote-existing-file',
      }),
    },
    plugins: {
      [PAYMENTS_PLUGIN]: { version: '2.1.0', active: true },
    },
    db: {
      wp_posts: benchmarkStablePosts(config.rowCount),
      wp_postmeta: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
    },
  };
  const local = clone(base);
  const rowResourceKeys = [];
  const allowedResources = [];
  const graphIdentityTargets = [];
  const familyFixtures = initializeFamilyFixtures();

  local.files[LARGE_UPLOAD_PATH] = stagedFile.descriptor;
  local.files[COMMERCE_MAIN_FILE] = fileDescriptor({
    sizeBytes: 8192,
    contentDigest: digestLabel('commerce-plugin-main-file'),
    storage: 'bench-plugin-descriptor',
  });
  local.plugins[COMMERCE_PLUGIN] = {
    version: '1.0.0',
    active: true,
    requires: [PAYMENTS_PLUGIN],
  };

  for (let index = 1; index <= config.rowCount; index++) {
    const id = `meta_id:${index}`;
    const postId = benchmarkPostIdForRow(index);
    const resourceKey = `row:${JSON.stringify(['wp_postmeta', id])}`;
    const targetResourceKey = `row:${JSON.stringify(['wp_posts', `ID:${postId}`])}`;
    rowResourceKeys.push(resourceKey);
    graphIdentityTargets.push(targetResourceKey);
    familyFixtures.postmetaPostRefs.resourceKeys.push(resourceKey);
    allowedResources.push({
      resourceKey,
      pluginOwner: COMMERCE_PLUGIN,
      driver: 'wp-postmeta',
    });
    local.db.wp_postmeta[id] = {
      meta_id: index,
      post_id: postId,
      meta_key: `_commerce_bench_${index}`,
      meta_value: deterministicRowPayload(index, config.rowPayloadBytes),
      __pluginOwner: COMMERCE_PLUGIN,
    };
  }

  const postsParentResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'postsParents',
    table: 'wp_posts',
    id: BENCHMARK_GRAPH_ROW_IDS.postsParents,
    value: {
      ID: 20001,
      post_title: 'Benchmark child post',
      post_status: 'draft',
      post_type: 'product',
      post_parent: benchmarkPostIdForRow(1),
    },
  });

  const featuredAttachmentResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'featuredImagesAttachments',
    table: 'wp_posts',
    id: BENCHMARK_GRAPH_ROW_IDS.featuredAttachment,
    value: {
      ID: 20002,
      post_title: 'Benchmark featured attachment',
      post_status: 'inherit',
      post_type: 'attachment',
      guid: 'https://example.test/wp-content/uploads/2026/05/benchmark-featured-attachment.jpg',
    },
  });

  const featuredImageMetaResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'featuredImagesAttachments',
    table: 'wp_postmeta',
    id: BENCHMARK_GRAPH_ROW_IDS.featuredImageMeta,
    value: {
      meta_id: 20001,
      post_id: benchmarkPostIdForRow(2),
      meta_key: '_thumbnail_id',
      meta_value: '20002',
    },
  });

  const termResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'termsTaxonomies',
    table: 'wp_terms',
    id: BENCHMARK_GRAPH_ROW_IDS.term,
    value: {
      term_id: 20001,
      name: 'benchmark-topic',
      slug: 'benchmark-topic',
    },
  });

  const termTaxonomyResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'termsTaxonomies',
    table: 'wp_term_taxonomy',
    id: BENCHMARK_GRAPH_ROW_IDS.termTaxonomy,
    value: {
      term_taxonomy_id: 20001,
      term_id: 20001,
      taxonomy: 'category',
      parent: 0,
      count: 1,
    },
  });

  const termRelationshipResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'termRelationships',
    table: 'wp_term_relationships',
    id: BENCHMARK_GRAPH_ROW_IDS.termRelationship,
    value: {
      object_id: benchmarkPostIdForRow(1),
      term_taxonomy_id: 20001,
      term_order: 0,
    },
  });

  const termmetaResourceKey = addBenchmarkRow({
    site: local,
    rowResourceKeys,
    familyFixtures,
    familyId: 'termmeta',
    table: 'wp_termmeta',
    id: BENCHMARK_GRAPH_ROW_IDS.termmeta,
    value: {
      meta_id: 20002,
      term_id: 20001,
      meta_key: '_benchmark_term_flag',
      meta_value: deterministicRowPayload(config.rowCount + 1, config.rowPayloadBytes),
    },
  });

  local.pushIntents = [
    {
      id: ATOMIC_GROUP_ID,
      kind: 'plugin-install',
      label: 'Install commerce stack',
      requireAtomic: true,
      resources: [
        `file:${COMMERCE_MAIN_FILE}`,
        `plugin:${COMMERCE_PLUGIN}`,
        ...rowResourceKeys,
      ],
      dependencies: {
        plugins: [
          {
            name: PAYMENTS_PLUGIN,
            version: '2.1.0',
            active: true,
            hash: resourceHash(base, pluginResource(PAYMENTS_PLUGIN)),
          },
        ],
      },
      resourcePolicy: {
        pluginOwnedResources: {
          allowedResources,
        },
      },
    },
  ];

  return {
    base,
    local,
    remote: clone(base),
    rowResourceKeys,
    graphIdentityTargets: [...new Set(graphIdentityTargets)],
    graphFamilyFixtures: {
      ...familyFixtures,
      postsParents: {
        ...familyFixtures.postsParents,
        representativeResourceKey: postsParentResourceKey,
      },
      featuredImagesAttachments: {
        ...familyFixtures.featuredImagesAttachments,
        representativeResourceKeys: [
          featuredAttachmentResourceKey,
          featuredImageMetaResourceKey,
        ],
      },
      termsTaxonomies: {
        ...familyFixtures.termsTaxonomies,
        representativeResourceKeys: [
          termResourceKey,
          termTaxonomyResourceKey,
        ],
      },
      termRelationships: {
        ...familyFixtures.termRelationships,
        representativeResourceKey: termRelationshipResourceKey,
      },
      termmeta: {
        ...familyFixtures.termmeta,
        representativeResourceKey: termmetaResourceKey,
      },
    },
    atomicGroupId: ATOMIC_GROUP_ID,
  };
}

function initializeFamilyFixtures() {
  return {
    postmetaPostRefs: { resourceKeys: [] },
    postsParents: { resourceKeys: [] },
    featuredImagesAttachments: { resourceKeys: [] },
    termsTaxonomies: { resourceKeys: [] },
    termRelationships: { resourceKeys: [] },
    termmeta: { resourceKeys: [] },
  };
}

function addBenchmarkRow({ site, rowResourceKeys, familyFixtures, familyId, table, id, value }) {
  const resourceKey = `row:${JSON.stringify([table, id])}`;
  rowResourceKeys.push(resourceKey);
  familyFixtures[familyId].resourceKeys.push(resourceKey);
  site.db[table][id] = value;
  return resourceKey;
}

function benchmarkStablePosts(rowCount) {
  const posts = {};
  for (let index = 1; index <= rowCount; index++) {
    const postId = benchmarkPostIdForRow(index);
    posts[`ID:${postId}`] ||= {
      ID: postId,
      post_title: `Benchmark catalog identity ${postId}`,
      post_status: 'publish',
      post_type: 'product',
    };
  }
  return posts;
}

function benchmarkPostIdForRow(index) {
  return 10_000 + Math.floor(index / 8);
}

function runFailureProbe({ mode, plan, remote, tempDir, now, failDuringCommitAtMutation = null }) {
  const journalPath = path.join(tempDir, `${mode}.jsonl`);
  const claimId = `${path.basename(tempDir)}:guarded-executor-benchmark:${mode}`;
  const durableJournal = openRecoveryJournal(journalPath, {
    truncate: true,
    now,
    claimId,
  });
  appendRecoveryClaimOpened(durableJournal, {
    plan,
    current: remote,
    claimId,
    reason: `Benchmark ${mode} failure probe claim opened before applyPlan.`,
  });
  const current = clone(remote);
  const before = JSON.stringify(current);
  const atomicGroup = plan.atomicGroups.find((group) => group.id === ATOMIC_GROUP_ID);
  const atomicGroupResourceKeys = new Set(atomicGroup?.resources || []);
  let error = null;
  const started = performance.now();

  try {
    if (mode === 'pre-commit') {
      applyPlan(current, plan, { failAfterDependencyValidation: true, durableJournal });
    } else if (mode === 'partial-commit') {
      applyPlan(current, plan, {
        mutateRemote: true,
        failDuringCommitAtMutation,
        durableJournal,
      });
    } else {
      throw new Error(`Unknown failure probe mode: ${mode}`);
    }
  } catch (caught) {
    error = caught;
  } finally {
    durableJournal.close();
  }

  if (!(error instanceof PushPlanError)) {
    throw new Error(`Expected ${mode} failure probe to raise PushPlanError.`);
  }

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current });
  return {
    mode,
    errorCode: error.code,
    recoveryStatus: error.details?.recovery?.status || null,
    journalPath,
    journalIntegrity: persisted.integrity.status,
    journalRecords: persisted.records.length,
    journalRecordTypes: persisted.records.map((record) => record.type),
    durableJournalHasNoRawValues: durableJournalHasNoRawValues(persisted),
    inspectionStatus: inspection.status,
    inspectionCounts: inspection.counts,
    remoteUnchanged: JSON.stringify(current) === before,
    groupNewTargets: inspection.targets
      .filter((target) => atomicGroupResourceKeys.has(target.resourceKey))
      .filter((target) => target.state === 'new').length,
    elapsedMs: elapsedMs(started),
  };
}

function buildReport({
  config,
  tempDir,
  timings,
  stagedFile,
  plan,
  sites,
  applyResult,
  successPersisted,
  successInspection,
  preCommitFailure,
  partialFailure,
}) {
  const chunkReceiptRecords = successPersisted.records.filter((record) => record.type === 'chunk-receipt');
  const mutationPreconditions = plan.preconditions || [];
  const mutationCount = plan.mutations.length;
  const atomicGroup = plan.atomicGroups.find((group) => group.id === sites.atomicGroupId);
  const allJournalsIntegrityOk = [
    successPersisted.integrity.status,
    preCommitFailure.journalIntegrity,
    partialFailure.journalIntegrity,
  ].every((status) => status === 'ok');
  const durableJournalsContainNoRawValues = [
    durableJournalHasNoRawValues(successPersisted),
    preCommitFailure.durableJournalHasNoRawValues,
    partialFailure.durableJournalHasNoRawValues,
  ].every(Boolean);
  const graphIdentityReport = buildGraphIdentityReport({ config, sites, plan });

  return {
    schemaVersion: 1,
    profile: config.profile,
    priority: 'no-data-loss-no-data-loss-reliable-fast',
    tempDir,
    shape: {
      largeUploadResourceKey: `file:${LARGE_UPLOAD_PATH}`,
      fileBytes: config.fileBytes,
      bytesMovedThroughStaging: stagedFile.bytesMoved,
      chunkSizeBytes: config.chunkSizeBytes,
      chunkCount: stagedFile.chunkCount,
      rowCount: config.rowCount,
      rowPayloadBytes: config.rowPayloadBytes,
      graphIdentityTargetCount: sites.graphIdentityTargets.length,
      mutations: mutationCount,
      atomicGroupId: sites.atomicGroupId,
      atomicGroupMutationCount: atomicGroup?.mutationIds.length || 0,
    },
    timings,
    throughput: {
      labStagedMiBPerSecond: mibPerSecond(stagedFile.bytesMoved, timings.stageFileMs),
      labApplyMutationsPerSecond: perSecond(mutationCount, timings.applyMs),
      productionThroughput: 'not-claimed',
    },
    executorCapabilities: {
      chunkStaging: 'bench-generated-file-staging',
      fileReceipts: 'lab-file-journal-receipts',
      guardedApply: 'applyPlan-live-precondition-model',
      rowApply: 'per-row-apply-model',
      recoveryJournal: 'file-backed-jsonl-fsync',
      productionAtomicCommit: 'not-measured',
    },
    evidence: {
      chunkReceipts: {
        expected: stagedFile.chunkCount,
        recorded: chunkReceiptRecords.length,
        finalStagingRecord: successPersisted.records.some((record) =>
          record.type === 'file-staging-finalized'
          && record.assembledHash === stagedFile.assembledHash),
        canonicalVisibleBeforePublish: chunkReceiptRecords.some((record) =>
          record.canonicalVisible === true),
      },
      preconditions: {
        mutations: mutationCount,
        liveRemoteMutationPreconditions: mutationPreconditions.length,
        everyMutationHasLiveRemotePrecondition: plan.mutations.every((mutation) => {
          const precondition = mutationPreconditions.find((entry) => entry.mutationId === mutation.id);
          return precondition
            && precondition.resourceKey === mutation.resourceKey
            && precondition.expectedHash === mutation.remoteBeforeHash
            && precondition.checkedAgainst === 'live-remote';
        }),
      },
      journal: {
        successIntegrity: successPersisted.integrity.status,
        successRecords: successPersisted.records.length,
        preCommitFailureIntegrity: preCommitFailure.journalIntegrity,
        partialFailureIntegrity: partialFailure.journalIntegrity,
        allJournalsIntegrityOk,
      },
      atomicGroup: {
        groupStatus: atomicGroup?.status || null,
        requireAtomic: atomicGroup?.requireAtomic === true,
        successAllTargetsNew: successInspection.status === 'fully-updated-remote',
        preCommitFailureLeavesRemoteUnchanged: preCommitFailure.remoteUnchanged,
        partialCommitGroupNewTargets: partialFailure.groupNewTargets,
        partialCommitStatus: partialFailure.inspectionStatus,
        productionAtomicCommitMeasured: false,
      },
      recovery: {
        successInspectionStatus: successInspection.status,
        successInspectionCounts: successInspection.counts,
        successReplayInspectable: successInspection.status === 'fully-updated-remote',
        preCommitFailureInspectionStatus: preCommitFailure.inspectionStatus,
        preCommitFailureInspectable: preCommitFailure.inspectionStatus === 'old-remote',
        partialCommitInspectionStatus: partialFailure.inspectionStatus,
        partialCommitBlocksRecovery: partialFailure.inspectionStatus === 'blocked-recovery',
      },
      redaction: {
        durableJournalsContainNoRawValues,
      },
      wordpressGraphIdentity: {
        postmetaReferences: graphIdentityReport.postmetaReferences,
        stableRemotePostTargets: graphIdentityReport.stableRemotePostTargets,
        allPostmetaReferencesUseStableRemoteIdentity:
          graphIdentityReport.allPostmetaReferencesUseStableRemoteIdentity,
        graphIdentityBlockers: graphIdentityReport.graphIdentityBlockers,
        familyCounters: graphIdentityReport.familyCounters,
        familyReport: graphIdentityReport.families,
        actionableBlockers: graphIdentityReport.actionableBlockers,
      },
    },
    results: {
      appliedMutations: applyResult.appliedMutations,
      successJournalPath: successPersisted.filePath,
      preCommitFailure: {
        errorCode: preCommitFailure.errorCode,
        recoveryStatus: preCommitFailure.recoveryStatus,
        journalPath: preCommitFailure.journalPath,
      },
      partialFailure: {
        errorCode: partialFailure.errorCode,
        recoveryStatus: partialFailure.recoveryStatus,
        journalPath: partialFailure.journalPath,
      },
    },
    claims: {
      labGuardedExecutorEvidence: true,
    },
  };
}

function benchmarkGraphIdentityStable(sites) {
  return sites.graphIdentityTargets.every((targetResourceKey) => {
    const [table, id] = JSON.parse(targetResourceKey.slice('row:'.length));
    if (table !== 'wp_posts' || !id) {
      return false;
    }
    const basePost = sites.base.db.wp_posts?.[id] || null;
    const remotePost = sites.remote.db.wp_posts?.[id] || null;
    return basePost
      && remotePost
      && JSON.stringify(basePost) === JSON.stringify(remotePost);
  });
}

function buildGraphIdentityReport({ config, sites, plan }) {
  const allPostmetaReferencesUseStableRemoteIdentity = benchmarkGraphIdentityStable(sites);
  const graphIdentityBlockers = plan.blockers.filter((blocker) =>
    blocker.class === 'stale-wordpress-graph-identity').length;
  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const blockerKeys = new Set(
    plan.blockers
      .filter((blocker) => blocker.class === 'stale-wordpress-graph-identity')
      .map((blocker) => blocker.resourceKey),
  );
  const families = {};

  for (const definition of GRAPH_FAMILY_DEFINITIONS) {
    const family = {
      family: definition.label,
      plannerOwner: definition.plannerOwner,
      smokeOwner: definition.smokeOwner,
      notes: definition.notes,
    };
    if (definition.id === 'postmetaPostRefs') {
      const benchmarkedResources = sites.graphFamilyFixtures.postmetaPostRefs.resourceKeys.length;
      family.status = allPostmetaReferencesUseStableRemoteIdentity && graphIdentityBlockers === 0
        ? 'mapped'
        : 'blocked';
      family.mapped = allPostmetaReferencesUseStableRemoteIdentity ? benchmarkedResources : 0;
      family.unmapped = allPostmetaReferencesUseStableRemoteIdentity ? 0 : benchmarkedResources;
      family.targets = sites.graphIdentityTargets.length;
      family.blockers = graphIdentityBlockers === 0
        ? []
        : [`planner emitted ${graphIdentityBlockers} stale-wordpress-graph-identity blocker(s)`];
    } else if (definition.id === 'unsupportedPluginOwnedSurfaces') {
      family.status = 'planner-guarded';
      family.mapped = 0;
      family.unmapped = 0;
      family.blockers = [
        'surface remains intentionally fail-closed outside explicit driver allowlists',
      ];
    } else {
      const fixture = sites.graphFamilyFixtures[definition.id];
      const benchmarkedResources = fixture?.resourceKeys || [];
      const mappedResources = benchmarkedResources.filter((resourceKey) => mutationKeys.has(resourceKey));
      const blockedResources = benchmarkedResources.filter((resourceKey) => blockerKeys.has(resourceKey));
      family.status = blockedResources.length > 0
        ? 'blocked'
        : benchmarkedResources.length > 0 && mappedResources.length === benchmarkedResources.length
          ? 'mapped'
          : 'unmapped';
      family.mapped = mappedResources.length;
      family.unmapped = benchmarkedResources.length - mappedResources.length;
      family.blockers = blockedResources.length > 0
        ? blockedResources.map((resourceKey) => `planner blocked benchmark fixture resource ${resourceKey}`)
        : benchmarkedResources.length > 0
          ? []
          : [`no benchmark coverage for ${definition.label}`];
    }
    families[definition.id] = family;
  }

  const actionableBlockers = Object.values(families)
    .filter((family) => family.status !== 'mapped')
    .map((family) => ({
      family: family.family,
      status: family.status,
      plannerOwner: family.plannerOwner,
      smokeOwner: family.smokeOwner,
      blockers: family.blockers,
    }));
  const mappedFamilies = Object.values(families).filter((family) => family.status === 'mapped').length;
  const unmappedFamilies = Object.values(families).filter((family) => family.status === 'unmapped').length;
  const guardedFamilies = Object.values(families).filter((family) => family.status === 'planner-guarded').length;
  const blockedFamilies = Object.values(families).filter((family) => family.status === 'blocked').length;

  return {
    postmetaReferences: config.rowCount,
    stableRemotePostTargets: sites.graphIdentityTargets.length,
    allPostmetaReferencesUseStableRemoteIdentity,
    graphIdentityBlockers,
    familyCounters: {
      totalFamilies: GRAPH_FAMILY_DEFINITIONS.length,
      mappedFamilies,
      unmappedFamilies,
      blockedFamilies,
      guardedFamilies,
      mappedReferences: Object.values(families).reduce((sum, family) => sum + family.mapped, 0),
      unmappedReferences: Object.values(families).reduce((sum, family) => sum + family.unmapped, 0),
    },
    families,
    actionableBlockers,
  };
}

function assertBenchmarkPlan(plan, config, sites) {
  if (plan.status !== 'ready') {
    throw new Error(`Benchmark plan must be ready; got ${plan.status}.`);
  }
  const expectedMutations = sites.rowResourceKeys.length + 3;
  if (plan.mutations.length !== expectedMutations) {
    throw new Error(`Expected ${expectedMutations} benchmark mutations; got ${plan.mutations.length}.`);
  }
  if (plan.preconditions.length !== plan.mutations.length) {
    throw new Error('Benchmark plan does not have one live precondition per mutation.');
  }
  if (!plan.preconditions.every((precondition) => precondition.checkedAgainst === 'live-remote')) {
    throw new Error('Benchmark plan includes a non-live precondition.');
  }
  const atomicGroup = plan.atomicGroups.find((group) => group.id === ATOMIC_GROUP_ID);
  if (!atomicGroup || atomicGroup.status !== 'ready' || atomicGroup.requireAtomic !== true) {
    throw new Error('Benchmark plan does not contain a ready required atomic group.');
  }
}

function firstAtomicGroupMutationIndex(plan) {
  const index = plan.mutations.findIndex((mutation) => mutation.atomicGroupId === ATOMIC_GROUP_ID);
  if (index < 0) {
    throw new Error('Benchmark plan has no atomic group mutation.');
  }
  return index + 1;
}

function deterministicChunk(sizeBytes, seed, chunkIndex) {
  const marker = crypto.createHash('sha256').update(`${seed}:chunk:${chunkIndex}`).digest();
  const chunk = Buffer.allocUnsafe(sizeBytes);
  for (let offset = 0; offset < sizeBytes; offset += marker.length) {
    marker.copy(chunk, offset, 0, Math.min(marker.length, sizeBytes - offset));
  }
  return chunk;
}

function deterministicRowPayload(index, byteLength) {
  const marker = crypto.createHash('sha256').update(`row-payload:${index}`).digest('hex');
  return marker.repeat(Math.ceil(byteLength / marker.length)).slice(0, byteLength);
}

function fileDescriptor({ sizeBytes, contentDigest, storage }) {
  return {
    type: 'file',
    sizeBytes,
    contentDigest,
    storage,
  };
}

function pluginResource(name) {
  return {
    type: 'plugin',
    name,
    key: `plugin:${name}`,
  };
}

function digestBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function digestLabel(label) {
  return `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
}

function durableJournalHasNoRawValues(journal) {
  try {
    for (const record of journal.records) {
      assertJournalRecordHasNoRawValues(record);
    }
    return journal.integrity.status === 'ok';
  } catch {
    return false;
  }
}

function mibPerSecond(bytes, ms) {
  return Number(((bytes / MIB) / Math.max(ms / 1000, 0.001)).toFixed(2));
}

function perSecond(count, ms) {
  return Number((count / Math.max(ms / 1000, 0.001)).toFixed(2));
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--claim-production-throughput') {
      options.claimProductionThroughput = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'profile') {
      options.profile = value;
    } else if (key === 'file-bytes') {
      options.fileBytes = Number.parseInt(value, 10);
    } else if (key === 'chunk-size-bytes') {
      options.chunkSizeBytes = Number.parseInt(value, 10);
    } else if (key === 'row-count') {
      options.rowCount = Number.parseInt(value, 10);
    } else if (key === 'row-payload-bytes') {
      options.rowPayloadBytes = Number.parseInt(value, 10);
    } else if (key === 'temp-dir') {
      options.tempDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runGuardedExecutorBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
