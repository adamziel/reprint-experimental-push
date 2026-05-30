import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T08:39:06.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const sourceNavigationId = 396;
const targetNavigationId = 1396;
const sourceNavigationRowId = `ID:${sourceNavigationId}`;
const targetNavigationRowId = `ID:${targetNavigationId}`;
const navigationMetaKey = 'rpp0396_navigation_owner';
const sourceNavigationResourceKey = rowResourceKey('wp_posts', sourceNavigationRowId);
const targetNavigationResourceKey = rowResourceKey('wp_posts', targetNavigationRowId);
const sourceNavigationMetaRowId = `post_id:${sourceNavigationId}:meta_key:${navigationMetaKey}`;
const rewrittenNavigationMetaRowId = `post_id:${targetNavigationId}:meta_key:${navigationMetaKey}`;
const sourceNavigationMetaResourceKey = rowResourceKey('wp_postmeta', sourceNavigationMetaRowId);
const rewrittenNavigationMetaResourceKey = rowResourceKey('wp_postmeta', rewrittenNavigationMetaRowId);

const privateNavigationFixtures = Object.freeze([
  'RPP-0396 Local Private Navigation',
  'rpp-0396-local-private-navigation',
  'RPP-0396 private navigation block label',
  'rpp-0396-local-private-navigation-guid',
  'rpp-0396-private-navigation-meta',
  'RPP-0396 Mapped Private Navigation',
  'rpp-0396-mapped-private-navigation',
  'RPP-0396 mapped private block label',
  'rpp-0396-mapped-private-navigation-meta',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0396 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0396 stable anchor post',
          post_name: 'rpp-0396-stable-anchor',
          post_content: 'RPP-0396 stable anchor body',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
    },
  };
}

function navigationRow({ id, title, slug, label, guid = undefined }) {
  return {
    ID: id,
    post_title: title,
    post_name: slug,
    post_content: `<!-- wp:navigation-link {"label":${JSON.stringify(label)},"url":"/rpp-0396"} /-->`,
    post_status: 'publish',
    post_type: 'wp_navigation',
    post_parent: 0,
    post_author: 0,
    ...(guid ? { guid } : {}),
  };
}

function addLocalNavigationSource(snapshot, { withIdentityMap = false } = {}) {
  if (withIdentityMap) {
    snapshot.meta = {
      wordpressGraphIdentityMap: {
        rows: [
          {
            table: 'wp_posts',
            localId: sourceNavigationRowId,
            remoteId: targetNavigationRowId,
          },
        ],
      },
    };
  }

  snapshot.db.wp_posts[sourceNavigationRowId] = navigationRow({
    id: sourceNavigationId,
    title: withIdentityMap ? 'RPP-0396 Mapped Private Navigation' : 'RPP-0396 Local Private Navigation',
    slug: withIdentityMap ? 'rpp-0396-mapped-private-navigation' : 'rpp-0396-local-private-navigation',
    label: withIdentityMap ? 'RPP-0396 mapped private block label' : 'RPP-0396 private navigation block label',
    guid: withIdentityMap ? undefined : 'rpp-0396-local-private-navigation-guid',
  });
  snapshot.db.wp_postmeta[sourceNavigationMetaRowId] = {
    post_id: sourceNavigationId,
    meta_key: navigationMetaKey,
    meta_value: withIdentityMap
      ? 'rpp-0396-mapped-private-navigation-meta'
      : 'rpp-0396-private-navigation-meta',
  };
}

function addRemoteNavigationTarget(snapshot) {
  snapshot.db.wp_posts[targetNavigationRowId] = navigationRow({
    id: targetNavigationId,
    title: 'RPP-0396 Mapped Private Navigation',
    slug: 'rpp-0396-mapped-private-navigation',
    label: 'RPP-0396 mapped private block label',
  });
}

function navigationSnapshots({ withIdentityMap = false, withRemoteTarget = false } = {}) {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  addLocalNavigationSource(local, { withIdentityMap });
  if (withRemoteTarget) {
    addRemoteNavigationTarget(remote);
  }

  return { base, local, remote };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey) || null;
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function releaseVerifierProof(plan, {
  verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey),
} = {}) {
  const receiptHash = digest({
    kind: 'rpp-0396-release-verifier-receipt',
    planHash: digest(plan),
  });

  return {
    dryRun: {
      receiptHash,
    },
    apply: {
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        planHash: digest(plan),
        receiptHash,
        verifiedCount: verifiedResourceKeys.length,
        verifiedResourceKeys,
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations),
      },
    },
  };
}

function summarizePlan(plan) {
  return {
    status: plan.status,
    summary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
      atomicGroups: plan.summary.atomicGroups,
    },
    mutationCount: plan.mutations.length,
    decisionCount: plan.decisions.length,
    preconditionCount: plan.preconditions.length,
    blockerCount: plan.blockers.length,
    hash: sha256Evidence({
      status: plan.status,
      summary: plan.summary,
      mutations: plan.mutations.map((mutation) => ({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })),
      decisions: plan.decisions.map((decision) => ({
        resourceKey: decision.resourceKey,
        decision: decision.decision,
        targetResourceKey: decision.targetResourceKey || null,
        baseHash: decision.baseHash || null,
        localHash: decision.localHash || null,
        remoteHash: decision.remoteHash || null,
      })),
      blockers: plan.blockers.map((blocker) => ({
        resourceKey: blocker.resourceKey,
        class: blocker.class,
        reasonHash: digest(blocker.reason || ''),
        baseHash: blocker.baseHash,
        localHash: blocker.localHash,
        remoteHash: blocker.remoteHash,
      })),
    }),
  };
}

function changeHashEvidence(change) {
  return {
    localChange: change?.localChange || null,
    remoteChange: change?.remoteChange || null,
    base: {
      state: change?.base?.state || null,
      hash: change?.base?.hash || null,
    },
    local: {
      state: change?.local?.state || null,
      hash: change?.local?.hash || null,
    },
    remote: {
      state: change?.remote?.state || null,
      hash: change?.remote?.hash || null,
    },
  };
}

function hashOnlyReferenceEvidence(reference) {
  return {
    relationshipKey: reference.relationshipKey || null,
    relationshipType: reference.relationshipType || null,
    sourceResourceKey: reference.sourceResourceKey || null,
    sourceTable: reference.sourceTable || null,
    sourceRowId: reference.sourceRowId || null,
    targetResourceKey: reference.targetResourceKey || null,
    targetTable: reference.targetTable || null,
    targetId: reference.targetId || null,
    targetBaseHash: reference.targetBaseHash || null,
    targetLocalHash: reference.targetLocalHash || null,
    targetRemoteHash: reference.targetRemoteHash || null,
    targetChange: changeHashEvidence(reference.targetChange),
    targetSupport: reference.targetSupport ? {
      supported: reference.targetSupport.supported === true,
      className: reference.targetSupport.className || null,
      reasonHash: digest(reference.targetSupport.reason || ''),
    } : null,
  };
}

function hashOnlyBlockerEvidence(blocker) {
  return blocker ? {
    id: blocker.id,
    class: blocker.class,
    resourceKey: blocker.resourceKey,
    resolutionPolicy: blocker.resolutionPolicy || null,
    reasonHash: digest(blocker.reason || ''),
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
    change: changeHashEvidence(blocker.change),
    references: (blocker.references || []).map(hashOnlyReferenceEvidence),
  } : null;
}

function decisionEvidence(decision) {
  return decision ? {
    resourceKey: decision.resourceKey,
    decision: decision.decision,
    targetResourceKey: decision.targetResourceKey || null,
    identityMapSource: decision.identityMapSource || null,
    baseHash: decision.baseHash || null,
    localHash: decision.localHash || null,
    remoteHash: decision.remoteHash || null,
    targetRemoteHash: decision.targetRemoteHash || null,
  } : null;
}

function rewriteEvidence(rewrite) {
  return rewrite ? {
    relationshipKey: rewrite.relationshipKey || null,
    relationshipType: rewrite.relationshipType || null,
    field: rewrite.field || null,
    sourceResourceKey: rewrite.sourceResourceKey || null,
    rewrittenResourceKey: rewrite.rewrittenResourceKey || null,
    sourceTargetResourceKey: rewrite.sourceTargetResourceKey || null,
    targetResourceKey: rewrite.targetResourceKey || null,
    identityMapSource: rewrite.identityMapSource || null,
    sourceTargetLocalHash: rewrite.sourceTargetLocalHash || null,
    targetRemoteHash: rewrite.targetRemoteHash || null,
  } : null;
}

function durableJournalRecorder() {
  return {
    claimFenced: true,
    claimHash: '6'.repeat(64),
    events: [],
    appendEvent(type, payload) {
      const record = { sequence: this.events.length + 1, type, ...payload };
      this.events.push(record);
      return record;
    },
  };
}

function releaseVerifierScope(overrides = {}) {
  return {
    rpp: 'RPP-0396',
    evidenceSource: 'release-verifier-wp-navigation-fail-closed-reference-v5',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    noGoCaveat: 'Local release-verifier evidence only; production-backed release evidence is still required.',
    ...overrides,
  };
}

function buildFailClosedReleaseVerifierEvidence() {
  const fixture = navigationSnapshots();
  const plan = planFor(fixture);
  const navigationBlocker = plan.blockers.find((entry) =>
    entry.resourceKey === sourceNavigationResourceKey) || null;
  const metaBlocker = plan.blockers.find((entry) =>
    entry.resourceKey === sourceNavigationMetaResourceKey) || null;
  const postReference = metaBlocker?.references.find((entry) =>
    entry.relationshipType === 'postmeta-post') || null;
  const remoteAttempt = cloneJson(fixture.remote);
  const remoteHashBefore = sha256Evidence(remoteAttempt);
  const durableJournal = durableJournalRecorder();
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remoteAttempt, plan, {
    mutateRemote: true,
    durableJournal,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const remoteHashAfter = sha256Evidence(remoteAttempt);

  const invariants = {
    blockedPlan: plan.status === 'blocked',
    navigationMutationAbsent: !mutationFor(plan, sourceNavigationResourceKey),
    navigationMetaMutationAbsent: !mutationFor(plan, sourceNavigationMetaResourceKey),
    unsupportedNavigationSurfaceRejected: navigationBlocker?.class === 'stale-wordpress-graph-identity'
      && navigationBlocker?.resolutionPolicy === 'preserve-remote-wordpress-graph-and-stop'
      && /unsupported post graph surface wp_navigation/.test(navigationBlocker.reason || ''),
    postmetaTargetRejected: postReference?.relationshipKey === 'wp_postmeta.post_id'
      && postReference?.targetResourceKey === sourceNavigationResourceKey
      && postReference?.targetSupport?.className === 'stale-wordpress-graph-identity',
    applyRefusedBeforeMutation: error instanceof PushPlanError
      && error.code === 'PLAN_NOT_READY'
      && beforeMutationCalls === 0
      && durableJournal.events.length === 0,
    remoteDataPreserved: remoteHashAfter === remoteHashBefore,
    hashOnlyBlockerEvidence: [navigationBlocker, metaBlocker].every((blocker) =>
      blocker
      && [blocker.baseHash, blocker.localHash, blocker.remoteHash].every(isSha256Hex)
      && ['base', 'local', 'remote'].every((slot) => isSha256Hex(blocker.change?.[slot]?.hash))),
  };

  const evidence = releaseVerifierScope({
    scenario: 'wp-navigation-without-proven-identity-map',
    status: 'support_only',
    verdict: 'WP_NAVIGATION_REFERENCE_FAIL_CLOSED_HASH_ONLY',
    plan: summarizePlan(plan),
    resource: {
      navigationResourceKey: sourceNavigationResourceKey,
      navigationMetaResourceKey: sourceNavigationMetaResourceKey,
      relationshipKey: 'wp_postmeta.post_id',
      relationshipType: 'postmeta-post',
    },
    graphIdentity: {
      navigationBlocker: hashOnlyBlockerEvidence(navigationBlocker),
      metaBlocker: hashOnlyBlockerEvidence(metaBlocker),
    },
    applyRefusal: {
      code: error.code,
      detailsHash: sha256Evidence(error.details || null),
      beforeMutationCalls,
      durableJournalEventCount: durableJournal.events.length,
      remoteHashBefore,
      remoteHashAfter,
    },
    redaction: {
      format: 'hash-only',
      rawFixtureIncluded: false,
      checkedFixtureCount: privateNavigationFixtures.length,
    },
    invariants,
    ok: Object.values(invariants).every(Boolean),
  });

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function buildMappedRewriteReleaseVerifierEvidence({
  verifiedResourceKeys,
} = {}) {
  const fixture = navigationSnapshots({
    withIdentityMap: true,
    withRemoteTarget: true,
  });
  const plan = planFor(fixture);
  const proof = releaseVerifierProof(plan, {
    verifiedResourceKeys: verifiedResourceKeys || plan.mutations.map((mutation) => mutation.resourceKey),
  });
  const applyRevalidation = proof.apply.applyRevalidation;
  const rewrittenMetaMutation = mutationFor(plan, rewrittenNavigationMetaResourceKey);
  const rewrittenMetaPrecondition = preconditionFor(plan, rewrittenNavigationMetaResourceKey);
  const plannedMeta = rewrittenMetaMutation
    ? deserializeResourceValue(rewrittenMetaMutation.value)
    : null;
  const postRewrite = rewrittenMetaMutation?.wordpressGraphIdentity?.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'postmeta-post') || null;
  const applied = plan.status === 'ready'
    ? applyPlan(cloneJson(fixture.remote), plan).site
    : null;
  const finalMeta = applied?.db?.wp_postmeta?.[rewrittenNavigationMetaRowId] || null;
  const exactVerifiedSet = JSON.stringify(applyRevalidation.verifiedResourceKeys)
    === JSON.stringify(plan.mutations.map((mutation) => mutation.resourceKey));
  const verifiedBeforeFirstMutation =
    applyRevalidation.required === 'fresh-live-hashes-before-first-mutation'
    && applyRevalidation.phase === 'before-first-mutation'
    && applyRevalidation.checkedAgainst === 'live-remote'
    && applyRevalidation.planHash === digest(plan)
    && applyRevalidation.receiptHash === proof.dryRun.receiptHash
    && exactVerifiedSet
    && applyRevalidation.verifiedResourceKeys.includes(rewrittenNavigationMetaResourceKey);

  const invariants = {
    readyPlan: plan.status === 'ready',
    sourceNavigationMappedToRemote: decisionFor(plan, sourceNavigationResourceKey)?.decision === 'map-local-identity-to-remote'
      && decisionFor(plan, sourceNavigationResourceKey)?.targetResourceKey === targetNavigationResourceKey,
    targetNavigationPreserved: decisionFor(plan, targetNavigationResourceKey)?.decision === 'keep-remote',
    sourceNavigationRowsNotMutated: ![
      sourceNavigationResourceKey,
      targetNavigationResourceKey,
      sourceNavigationMetaResourceKey,
    ].some((resourceKey) => mutationFor(plan, resourceKey)),
    metadataRewrittenToTargetNavigation: rewrittenMetaMutation?.resourceKey === rewrittenNavigationMetaResourceKey
      && rewrittenMetaMutation?.changeKind === 'create'
      && plannedMeta?.post_id === targetNavigationId
      && postRewrite?.relationshipKey === 'wp_postmeta.post_id'
      && postRewrite?.sourceTargetResourceKey === sourceNavigationResourceKey
      && postRewrite?.targetResourceKey === targetNavigationResourceKey
      && postRewrite?.rewrittenResourceKey === rewrittenNavigationMetaResourceKey,
    rewrittenMetadataHasLivePrecondition: rewrittenMetaPrecondition?.checkedAgainst === 'live-remote'
      && rewrittenMetaPrecondition?.expectedHash === rewrittenMetaMutation?.remoteBeforeHash
      && isSha256Hex(rewrittenMetaPrecondition?.expectedHash),
    releaseVerifierRevalidatesRewrittenMetadata: verifiedBeforeFirstMutation,
    applyCarriesRemoteNavigationId: finalMeta?.post_id === targetNavigationId
      && applied?.db?.wp_posts?.[targetNavigationRowId]?.post_type === 'wp_navigation'
      && !applied?.db?.wp_posts?.[sourceNavigationRowId]
      && !applied?.db?.wp_postmeta?.[sourceNavigationMetaRowId],
    noGraphIdentityBlockers: plan.blockers.length === 0,
  };

  const accepted = Object.values(invariants).every(Boolean);
  const evidence = releaseVerifierScope({
    scenario: 'wp-navigation-identity-map-rewrites-postmeta-reference',
    status: accepted ? 'support_only' : 'blocked',
    verdict: accepted
      ? 'WP_NAVIGATION_REFERENCE_REWRITTEN_SUPPORT_ONLY'
      : 'WP_NAVIGATION_REFERENCE_RELEASE_VERIFIER_REVALIDATION_REQUIRED',
    acceptedForReleaseGate: false,
    plan: summarizePlan(plan),
    identityMap: {
      sourceNavigation: decisionEvidence(decisionFor(plan, sourceNavigationResourceKey)),
      targetNavigation: decisionEvidence(decisionFor(plan, targetNavigationResourceKey)),
    },
    rewrite: rewriteEvidence(postRewrite),
    mutation: rewrittenMetaMutation ? {
      resourceKey: rewrittenMetaMutation.resourceKey,
      action: rewrittenMetaMutation.action,
      changeKind: rewrittenMetaMutation.changeKind,
      postId: plannedMeta?.post_id ?? null,
      baseHash: rewrittenMetaMutation.baseHash,
      localHash: rewrittenMetaMutation.localHash,
      remoteBeforeHash: rewrittenMetaMutation.remoteBeforeHash,
      precondition: rewrittenMetaPrecondition ? {
        checkedAgainst: rewrittenMetaPrecondition.checkedAgainst,
        expectedHash: rewrittenMetaPrecondition.expectedHash,
        matchesRemoteBeforeHash: rewrittenMetaPrecondition.expectedHash === rewrittenMetaMutation.remoteBeforeHash,
      } : null,
    } : null,
    releaseVerifier: {
      applyRevalidation: {
        required: applyRevalidation.required,
        phase: applyRevalidation.phase,
        checkedAgainst: applyRevalidation.checkedAgainst,
        verifiedCount: applyRevalidation.verifiedCount,
        verifiedResourceKeysHash: sha256Evidence(applyRevalidation.verifiedResourceKeys),
        exactVerifiedSet,
        verifiedBeforeFirstMutation,
        preconditionSetHash: sha256Evidence(plan.preconditions),
        mutationSetHash: sha256Evidence(plan.mutations.map((mutation) => ({
          resourceKey: mutation.resourceKey,
          baseHash: mutation.baseHash,
          localHash: mutation.localHash,
          remoteBeforeHash: mutation.remoteBeforeHash,
        }))),
      },
    },
    applyCarryThrough: {
      accepted,
      finalNavigationResourceKey: targetNavigationResourceKey,
      finalMetadataResourceKey: rewrittenNavigationMetaResourceKey,
      finalMetadataPostId: finalMeta?.post_id ?? null,
      sourceNavigationAbsent: !applied?.db?.wp_posts?.[sourceNavigationRowId],
      sourceMetadataAbsent: !applied?.db?.wp_postmeta?.[sourceNavigationMetaRowId],
      targetNavigationHash: applied
        ? sha256Evidence(applied.db.wp_posts[targetNavigationRowId])
        : null,
    },
    redaction: {
      format: 'hash-only-plus-resource-ids',
      rawFixtureIncluded: false,
      checkedFixtureCount: privateNavigationFixtures.length,
    },
    invariants,
    ok: accepted,
  });

  return {
    ...evidence,
    proofHash: sha256Evidence(evidence),
  };
}

function isSha256Hex(value) {
  return typeof value === 'string' && hashPattern.test(value);
}

function assertSha256Evidence(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function assertNoPrivateNavigationFixtures(value, label) {
  const serialized = JSON.stringify(value);
  for (const fixture of privateNavigationFixtures) {
    assert.equal(serialized.includes(fixture), false, `${label} leaked ${fixture}`);
  }
  for (const rawField of ['post_title', 'post_content', 'meta_value', 'guid']) {
    assert.equal(serialized.includes(rawField), false, `${label} exposed raw ${rawField} fields`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0396 release verifier keeps wp_navigation references fail-closed with hash-only evidence', () => {
  const proof = buildFailClosedReleaseVerifierEvidence();

  assert.equal(proof.rpp, 'RPP-0396');
  assert.equal(proof.evidenceSource, 'release-verifier-wp-navigation-fail-closed-reference-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'WP_NAVIGATION_REFERENCE_FAIL_CLOSED_HASH_ONLY');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.productionBacked, false);
  assert.deepEqual(proof.plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 2,
    atomicGroups: 0,
  });
  assert.equal(proof.graphIdentity.navigationBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(proof.graphIdentity.navigationBlocker.resourceKey, sourceNavigationResourceKey);
  assert.equal(proof.graphIdentity.navigationBlocker.references.length, 0);
  assert.equal(proof.graphIdentity.metaBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(proof.graphIdentity.metaBlocker.resourceKey, sourceNavigationMetaResourceKey);
  assert.equal(proof.graphIdentity.metaBlocker.references[0].relationshipKey, 'wp_postmeta.post_id');
  assert.equal(proof.graphIdentity.metaBlocker.references[0].relationshipType, 'postmeta-post');
  assert.equal(proof.graphIdentity.metaBlocker.references[0].targetResourceKey, sourceNavigationResourceKey);
  assert.equal(
    proof.graphIdentity.metaBlocker.references[0].targetSupport.className,
    'stale-wordpress-graph-identity',
  );
  assert.equal(proof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.beforeMutationCalls, 0);
  assert.equal(proof.applyRefusal.durableJournalEventCount, 0);
  assert.equal(proof.applyRefusal.remoteHashAfter, proof.applyRefusal.remoteHashBefore);
  assert.deepEqual(proof.invariants, {
    blockedPlan: true,
    navigationMutationAbsent: true,
    navigationMetaMutationAbsent: true,
    unsupportedNavigationSurfaceRejected: true,
    postmetaTargetRejected: true,
    applyRefusedBeforeMutation: true,
    remoteDataPreserved: true,
    hashOnlyBlockerEvidence: true,
  });
  assert.equal(proof.ok, true);
  assertSha256Evidence(proof.proofHash, 'RPP-0396 fail-closed proof hash');
  assertNoPrivateNavigationFixtures(proof, 'RPP-0396 fail-closed release evidence');
});

test('RPP-0396 release verifier carries wp_navigation identity-map postmeta rewrite through apply', () => {
  const proof = buildMappedRewriteReleaseVerifierEvidence();

  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'WP_NAVIGATION_REFERENCE_REWRITTEN_SUPPORT_ONLY');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.deepEqual(proof.plan.summary, {
    mutations: 1,
    decisions: 2,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(proof.identityMap.sourceNavigation.decision, 'map-local-identity-to-remote');
  assert.equal(proof.identityMap.sourceNavigation.targetResourceKey, targetNavigationResourceKey);
  assert.equal(proof.identityMap.targetNavigation.decision, 'keep-remote');
  assert.equal(proof.rewrite.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(proof.rewrite.relationshipType, 'postmeta-post');
  assert.equal(proof.rewrite.sourceTargetResourceKey, sourceNavigationResourceKey);
  assert.equal(proof.rewrite.targetResourceKey, targetNavigationResourceKey);
  assert.equal(proof.rewrite.rewrittenResourceKey, rewrittenNavigationMetaResourceKey);
  assert.match(proof.rewrite.sourceTargetLocalHash, hashPattern);
  assert.match(proof.rewrite.targetRemoteHash, hashPattern);
  assert.equal(proof.mutation.resourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(proof.mutation.action, 'put');
  assert.equal(proof.mutation.changeKind, 'create');
  assert.equal(proof.mutation.postId, targetNavigationId);
  assert.equal(proof.mutation.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.mutation.precondition.matchesRemoteBeforeHash, true);
  assert.equal(proof.releaseVerifier.applyRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(proof.releaseVerifier.applyRevalidation.exactVerifiedSet, true);
  assert.equal(proof.applyCarryThrough.accepted, true);
  assert.equal(proof.applyCarryThrough.finalMetadataResourceKey, rewrittenNavigationMetaResourceKey);
  assert.equal(proof.applyCarryThrough.finalMetadataPostId, targetNavigationId);
  assert.equal(proof.applyCarryThrough.sourceNavigationAbsent, true);
  assert.equal(proof.applyCarryThrough.sourceMetadataAbsent, true);
  assert.deepEqual(proof.invariants, {
    readyPlan: true,
    sourceNavigationMappedToRemote: true,
    targetNavigationPreserved: true,
    sourceNavigationRowsNotMutated: true,
    metadataRewrittenToTargetNavigation: true,
    rewrittenMetadataHasLivePrecondition: true,
    releaseVerifierRevalidatesRewrittenMetadata: true,
    applyCarriesRemoteNavigationId: true,
    noGraphIdentityBlockers: true,
  });
  assert.equal(proof.ok, true);
  assertSha256Evidence(proof.proofHash, 'RPP-0396 mapped rewrite proof hash');
  assertNoPrivateNavigationFixtures(proof, 'RPP-0396 mapped rewrite release evidence');
});

test('RPP-0396 release evidence fails closed if the rewritten wp_navigation metadata is not revalidated', () => {
  const proof = buildMappedRewriteReleaseVerifierEvidence({ verifiedResourceKeys: [] });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.verdict, 'WP_NAVIGATION_REFERENCE_RELEASE_VERIFIER_REVALIDATION_REQUIRED');
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.releaseVerifier.applyRevalidation.verifiedCount, 0);
  assert.equal(proof.releaseVerifier.applyRevalidation.verifiedBeforeFirstMutation, false);
  assert.equal(proof.invariants.releaseVerifierRevalidatesRewrittenMetadata, false);
  assert.equal(proof.applyCarryThrough.accepted, false);
  assert.equal(proof.ok, false);
  assertSha256Evidence(proof.proofHash, 'RPP-0396 missing-revalidation proof hash');
  assertNoPrivateNavigationFixtures(proof, 'RPP-0396 missing-revalidation release evidence');
});
