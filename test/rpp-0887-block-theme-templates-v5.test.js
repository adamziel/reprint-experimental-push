import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectExternalWordPressTopologyProof,
  externalWordPressTopologyVariant,
} from '../scripts/playground/external-wordpress-topology-proof.mjs';
import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0887-block-theme-templates-v5.md');

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const rppId = 'RPP-0887';
const proofId = 'rpp-0887-block-theme-templates-v5';
const themeSlug = 'rpp-0887-block-v5';
const themeRoot = `wp-content/themes/${themeSlug}`;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;
const requiredRoleOrder = Object.freeze(['source', 'localEdited', 'remoteChanged']);

const blockThemeFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/theme.json`, kind: 'block-theme-config', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/index.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/front-page.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/single.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/page.html`, kind: 'block-theme-template', required: false }),
  Object.freeze({ path: `${themeRoot}/templates/404.html`, kind: 'block-theme-template', required: false }),
  Object.freeze({ path: `${themeRoot}/parts/header.html`, kind: 'block-theme-template-part', required: true }),
  Object.freeze({ path: `${themeRoot}/parts/footer.html`, kind: 'block-theme-template-part', required: true }),
  Object.freeze({ path: `${themeRoot}/parts/query-loop.html`, kind: 'block-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/parts/post-meta.html`, kind: 'block-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/patterns/featured-query.php`, kind: 'block-theme-pattern', required: false }),
  Object.freeze({ path: `${themeRoot}/patterns/cta-band.php`, kind: 'block-theme-pattern', required: false }),
  Object.freeze({ path: `${themeRoot}/styles/editorial.json`, kind: 'block-theme-style-variation', required: false }),
  Object.freeze({ path: `${themeRoot}/styles/contrast.json`, kind: 'block-theme-style-variation', required: false }),
]);

const localOnlyBlockThemeFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/templates/search.html`, kind: 'block-theme-template', required: false }),
]);

const allBlockThemeFiles = Object.freeze([...blockThemeFiles, ...localOnlyBlockThemeFiles]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/block-theme-v5',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/block-theme-v5/',
  REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8080/block-theme-v5-local',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/block-theme-v5',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/block-theme-v5/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/block-theme-v5',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/block-theme-v5',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/block-theme-v5',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/block-theme-v5',
  REPRINT_PUSH_USERNAME: 'block-theme-v5-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0887-application-password-must-not-leak',
});

const rejectedTopologyEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0887-secret@source.example.test/block-theme-v5',
  REPRINT_PUSH_LOCAL_URL: 'http://127.0.0.1:8081/block-theme-v5?token=rpp0887-token',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.localhost.run/block-theme-v5',
  REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
});

const expectedLocalChangedFileKeys = Object.freeze([
  `file:${themeRoot}/parts/header.html`,
  `file:${themeRoot}/parts/query-loop.html`,
  `file:${themeRoot}/styles/contrast.json`,
  `file:${themeRoot}/styles/editorial.json`,
  `file:${themeRoot}/templates/index.html`,
  `file:${themeRoot}/templates/search.html`,
  `file:${themeRoot}/templates/single.html`,
  `file:${themeRoot}/theme.json`,
]);

const exactUnavailableCapability = Object.freeze({
  code: 'DOCKER_CLI_MISSING',
  capability: 'docker-cli',
  command: 'docker --version',
  observedExitCode: 127,
  missingExecutable: true,
  externalLiveTopologyProvided: false,
  authMaterialProvided: false,
  requiredFor: Object.freeze([
    'block-theme-topology-start',
    'verify-release-without-packaged-fallback',
    'production-backed-block-theme-template-receipts',
  ]),
});

const forbiddenProofNeedles = Object.freeze([
  'https://source.example.test',
  'https://changed.example.test',
  'http://127.0.0.1',
  'source.example.test',
  'changed.example.test',
  'localhost.run',
  'block-theme-v5-admin',
  'rpp-0887-application-password-must-not-leak',
  'rpp-0887-source-index-private',
  'rpp-0887-source-front-page-private',
  'rpp-0887-source-single-private',
  'rpp-0887-source-page-private',
  'rpp-0887-source-404-private',
  'rpp-0887-local-index-private',
  'rpp-0887-local-single-private',
  'rpp-0887-local-search-private',
  'rpp-0887-local-header-private',
  'rpp-0887-local-query-loop-private',
  'rpp-0887-local-editorial-style-private',
  'rpp-0887-remote-header-private',
]);

if (process.env.RPP_0887_REPORT_JSON !== '1') {
  test('RPP-0887 carries block theme templates v5 release-verifier requirements without release movement', () => {
    const proof = buildBlockThemeTemplatesV5Proof({ env: goodEnv });

    assert.equal(proof.schemaVersion, 1);
    assert.equal(proof.rppId, rppId);
    assert.equal(proof.proofId, proofId);
    assert.equal(proof.variant, 5);
    assert.equal(proof.status, 'passed-support-only');
    assert.equal(proof.failClosed, false);
    assert.equal(proof.supportOnly, true);
    assert.equal(proof.productionBacked, false);
    assert.equal(proof.releaseEligible, false);
    assert.equal(proof.finalReleaseStatus, 'NO-GO');
    assert.equal(proof.integrationRecommendation, 'NO-GO');

    assert.equal(proof.builtOn.blockThemeVariant4Pattern.rppId, 'RPP-0867');
    assert.equal(proof.builtOn.blockThemeVariant3Pattern.rppId, 'RPP-0847');
    assert.equal(proof.builtOn.topologyContract.rppId, 'RPP-0803');
    assert.equal(proof.builtOn.topologyContract.variant, externalWordPressTopologyVariant);
    assert.deepEqual(proof.builtOn.productionTopologyEvidence, [
      'RPP-0881 three-site local production topology v5',
      'RPP-0883 external WordPress topology v5',
      'RPP-0867 block theme templates release-verifier pattern v4',
    ]);

    assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
    assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesCaptured, true);
    assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesIdentityChecked, true);
    assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
    assert.equal(proof.topology.sameSourceAcrossRoutes, true);
    assert.equal(proof.topology.remoteAliasMatchesSource, true);
    assert.equal(proof.topology.noTunnelPolicyEnforced, true);
    assert.equal(proof.topology.noUrlSecrets, true);
    assert.equal(proof.topology.localLoopbackIngress, true);
    assert.equal(proof.topology.packagedFallbackDisabled, true);
    assert.equal(proof.topology.networkProbePerformed, false);
    assert.equal(proof.topology.rawUrlValuesStored, false);
    assert.equal(proof.topology.hostnameValuesStored, false);
    assert.deepEqual(
      proof.topology.roleUrlEvidence.map((entry) => [entry.role, entry.captured, entry.valid]),
      [
        ['source', true, true],
        ['localEdited', true, true],
        ['remoteChanged', true, true],
      ],
    );
    assert.ok(proof.topology.roleUrlEvidence.every((entry) =>
      sha256Pattern.test(entry.identityHash)
        && sha256Pattern.test(entry.originHash)
        && entry.rawUrlStored === false
        && entry.hostStored === false));

    assert.equal(proof.blockThemeTemplates.themeType, 'block');
    assert.equal(proof.blockThemeTemplates.themeSlug, themeSlug);
    assert.equal(proof.blockThemeTemplates.scopeRoot, themeRoot);
    assert.equal(proof.blockThemeTemplates.scopeAcceptedForReleaseTopology, true);
    assert.deepEqual(
      proof.blockThemeTemplates.fileScope.map((entry) => entry.path),
      blockThemeFiles.map((entry) => entry.path),
    );
    assert.deepEqual(proof.blockThemeTemplates.requiredFileKeys, [
      `file:${themeRoot}/theme.json`,
      `file:${themeRoot}/templates/index.html`,
      `file:${themeRoot}/templates/front-page.html`,
      `file:${themeRoot}/templates/single.html`,
      `file:${themeRoot}/parts/header.html`,
      `file:${themeRoot}/parts/footer.html`,
    ]);
    assert.equal(proof.blockThemeTemplates.requiredFilesPresentInAllRoles, true);
    assert.equal(proof.blockThemeTemplates.themeJsonPresentInAllRoles, true);
    assert.equal(proof.blockThemeTemplates.themeJsonValidInAllRoles, true);
    assert.equal(proof.blockThemeTemplates.themeJsonCustomTemplatesDeclared, true);
    assert.equal(proof.blockThemeTemplates.templateAndPartPathsNotNested, true);
    assert.deepEqual(proof.blockThemeTemplates.sourceTemplateSlugs, ['404', 'front-page', 'index', 'page', 'single']);
    assert.deepEqual(proof.blockThemeTemplates.localTemplateSlugs, ['404', 'front-page', 'index', 'page', 'search', 'single']);
    assert.deepEqual(proof.blockThemeTemplates.customTemplateSlugs, ['case-study', 'landing', 'portfolio']);
    assert.deepEqual(proof.blockThemeTemplates.customTemplatePostTypeMatrix, [
      { slug: 'case-study', postTypes: ['page', 'post'] },
      { slug: 'landing', postTypes: ['page'] },
      { slug: 'portfolio', postTypes: ['page', 'portfolio'] },
    ]);
    assert.deepEqual(proof.blockThemeTemplates.templatePartAreas, [
      { slug: 'header', area: 'header' },
      { slug: 'footer', area: 'footer' },
      { slug: 'query-loop', area: 'uncategorized' },
      { slug: 'post-meta', area: 'uncategorized' },
    ]);
    assert.equal(proof.blockThemeTemplates.templatePartAreasDeclared, true);
    assert.deepEqual(proof.blockThemeTemplates.templatePartReferenceMatrix, [
      {
        role: 'source',
        references: ['footer:footer', 'header:header', 'post-meta:uncategorized', 'query-loop:uncategorized'],
      },
      {
        role: 'localEdited',
        references: ['footer:footer', 'header:header', 'post-meta:uncategorized', 'query-loop:uncategorized'],
      },
      {
        role: 'remoteChanged',
        references: ['footer:footer', 'header:header', 'post-meta:uncategorized', 'query-loop:uncategorized'],
      },
    ]);
    assert.equal(proof.blockThemeTemplates.allReferencedPartsDeclared, true);
    assert.deepEqual(proof.blockThemeTemplates.roleScopedFileCounts, {
      source: 14,
      localEdited: 15,
      remoteChanged: 14,
    });
    assert.equal(proof.blockThemeTemplates.activeThemeOptionRowsCaptured, true);
    assert.equal(proof.blockThemeTemplates.templateFileCount, 6);
    assert.equal(proof.blockThemeTemplates.templatePartFileCount, 4);
    assert.equal(proof.blockThemeTemplates.patternFileCount, 2);
    assert.equal(proof.blockThemeTemplates.styleVariationFileCount, 2);
    assert.deepEqual(proof.blockThemeTemplates.localChangedFileKeys, expectedLocalChangedFileKeys);
    assert.deepEqual(proof.blockThemeTemplates.remoteChangedFileKeys, [
      `file:${themeRoot}/parts/header.html`,
    ]);
    assert.ok(proof.blockThemeTemplates.roleFileHashes.every((entry) =>
      sha256Pattern.test(entry.sourceHash)
        && sha256Pattern.test(entry.localHash)
        && sha256Pattern.test(entry.remoteChangedHash)
        && entry.rawFileContentsIncluded === false));
    assert.match(proof.blockThemeTemplates.scopeHash, sha256PrefixedPattern);

    assert.equal(proof.planner.ready.status, 'ready');
    assert.deepEqual(proof.planner.ready.templateMutationKeys, proof.blockThemeTemplates.localChangedFileKeys);
    assert.deepEqual(proof.planner.ready.templatePreconditionKeys, proof.blockThemeTemplates.localChangedFileKeys);
    assert.ok(proof.planner.ready.templateMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote'
        && sha256Pattern.test(mutation.baseHash)
        && sha256Pattern.test(mutation.localHash)
        && sha256Pattern.test(mutation.remoteBeforeHash)
        && sha256PrefixedPattern.test(mutation.mutationHash)
        && sha256PrefixedPattern.test(mutation.preconditionHash)));
    assert.equal(proof.planner.remoteChanged.status, 'conflict');
    assert.deepEqual(proof.planner.remoteChanged.templateConflictKeys, [`file:${themeRoot}/parts/header.html`]);

    assert.equal(proof.releaseVerifier.requiredCommand, 'npm run verify:release');
    assert.equal(proof.releaseVerifier.topologyCommand, 'npm run verify:release:docker-local-production');
    assert.equal(proof.releaseVerifier.successTarget, 'verify-release-passes-without-packaged-fallback-on-block-theme-topology');
    assert.equal(proof.releaseVerifier.carriedThroughBySupportProof, true);
    assert.equal(proof.releaseVerifier.productionBackedVerifyReleaseEvidence.present, false);
    assert.equal(proof.releaseVerifier.productionBackedVerifyReleaseEvidence.observedPassingRun, false);
    assert.equal(proof.releaseVerifier.productionBackedVerifyReleaseEvidence.requiredBeforeReleaseEligibility, true);
    assert.deepEqual(proof.releaseVerifier.productionBackedVerifyReleaseEvidence.unavailableCapability, exactUnavailableCapability);
    assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
    assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
    assert.equal(proof.releaseVerifier.noPackagedFallback, true);
    assert.equal(proof.releaseVerifier.noTunnelEvidence, true);
    assert.equal(proof.releaseVerifier.tunnelObserved, false);
    assert.equal(proof.releaseVerifier.productionReadyClaimAccepted, false);
    assert.equal(proof.releaseVerifier.productionReadyAmbiguityRejected, true);
    assert.equal(proof.releaseVerifier.releaseMovementAllowed, false);
    assert.equal(proof.releaseVerifier.finalReleaseStatus, 'NO-GO');

    assert.equal(proof.releaseEligibility.status, 'not-release-eligible');
    assert.equal(proof.releaseEligibility.requiredProductionBackedVerifyReleaseBeforeEligibility, true);
    assert.equal(proof.releaseEligibility.productionReadyClaimAccepted, false);
    assert.equal(proof.releaseEligibility.productionReadyAmbiguityRejected, true);
    assert.ok(proof.releaseEligibility.blockers.includes('no-production-backed-verify-release-pass'));
    assert.ok(proof.releaseEligibility.requiredEvidence.includes('production-backed-verify-release-pass-on-block-theme-topology'));
    assert.ok(proof.releaseEligibility.requiredEvidence.includes('packaged-fallback-disabled-and-absent'));

    assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
    assert.equal(proof.invariants.packagedFallbackDisabled, true);
    assert.equal(proof.invariants.blockThemeTemplateScopeRecorded, true);
    assert.equal(proof.invariants.requiredBlockThemeFilesPresent, true);
    assert.equal(proof.invariants.themeJsonValidInAllRoles, true);
    assert.equal(proof.invariants.allReferencedPartsDeclared, true);
    assert.equal(proof.invariants.readyPlanCoversLocalBlockThemeTemplates, true);
    assert.equal(proof.invariants.everyTemplateMutationHasLiveRemotePrecondition, true);
    assert.equal(proof.invariants.remoteChangedTemplatePartDriftFailsClosed, true);
    assert.equal(proof.invariants.productionBackedVerifyReleaseRequiredBeforeEligibility, true);
    assert.equal(proof.invariants.rejectsProductionReadyAmbiguity, true);
    assert.equal(proof.invariants.hashCountSurfaceOnlyEvidence, true);
    assert.equal(proof.invariants.supportOnlyNoGo, true);
    assert.match(proof.outputHash, sha256PrefixedPattern);

    assertNoNeedles(proof, forbiddenProofNeedles);
    assertNoRawUrls(proof);
    assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
      label: 'RPP-0887 block theme template v5 proof',
    }));
  });

  test('RPP-0887 rejects tunnels, URL secret parts, non-8080 loopback, and packaged fallback before scope acceptance', () => {
    const proof = buildBlockThemeTemplatesV5Proof({ env: rejectedTopologyEnv });

    assert.equal(proof.status, 'blocked');
    assert.equal(proof.failClosed, true);
    assert.equal(proof.releaseEligible, false);
    assert.equal(proof.finalReleaseStatus, 'NO-GO');
    assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
    assert.equal(proof.topology.sourceLocalChangedUrlIdentitiesIdentityChecked, false);
    assert.equal(proof.topology.noTunnelPolicyEnforced, false);
    assert.equal(proof.topology.noUrlSecrets, false);
    assert.equal(proof.topology.localLoopbackIngress, false);
    assert.equal(proof.topology.packagedFallbackDisabled, false);
    assert.equal(proof.blockThemeTemplates.scopeAcceptedForReleaseTopology, false);
    assert.equal(proof.releaseVerifier.packagedFallbackObserved, true);
    assert.equal(proof.releaseVerifier.noPackagedFallback, false);
    assert.equal(proof.releaseVerifier.tunnelObserved, true);
    assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
    assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
    assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080'));
    assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
    assertNoNeedles(proof, [
      'admin:rpp0887-secret',
      'rpp0887-secret',
      'token=rpp0887-token',
      'rpp0887-token',
      '127.0.0.1:8081',
      'changed.localhost.run',
    ]);
    assertNoRawUrls(proof);
  });

  test('RPP-0887 block theme template proof is deterministic and hash/count/surface-only', () => {
    const firstProof = buildBlockThemeTemplatesV5Proof({ env: goodEnv });
    const secondProof = buildBlockThemeTemplatesV5Proof({ env: { ...goodEnv } });

    assert.equal(firstProof.outputHash, secondProof.outputHash);
    assert.deepEqual(firstProof.topology.roleUrlEvidence, secondProof.topology.roleUrlEvidence);
    assert.deepEqual(firstProof.blockThemeTemplates.roleFileHashes, secondProof.blockThemeTemplates.roleFileHashes);
    assert.deepEqual(firstProof.planner.ready.templateMutations, secondProof.planner.ready.templateMutations);
    assert.deepEqual(firstProof.planner.remoteChanged.templateConflicts, secondProof.planner.remoteChanged.templateConflicts);
    assert.deepEqual(firstProof.releaseVerifier, secondProof.releaseVerifier);
    assertNoNeedles(firstProof, forbiddenProofNeedles);
    assertNoNeedles(secondProof, forbiddenProofNeedles);
    assertNoRawUrls(firstProof);
    assertNoRawUrls(secondProof);
  });

  test('RPP-0887 evidence document records support-only NO-GO release-verifier requirements', () => {
    const { report, text } = loadEvidenceReport();
    const expectedReport = buildEvidenceReport();
    const validation = validateEvidenceReport(report);

    assert.equal(validation.ok, true, JSON.stringify(validation.failures));
    assert.deepEqual(report, expectedReport);
    assert.deepEqual(findEvidenceRedactionIssues(report), []);
    assertNoRawUrls(report);
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.doesNotMatch(text, /source\.example|changed\.example|localhost\.run|token=|admin:/i);
    assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, {
      label: 'RPP-0887 block theme templates v5 evidence report',
    }));
  });

  test('RPP-0887 evidence validator rejects packaged fallback, tunnel gaps, and production-ready ambiguity', () => {
    const report = buildEvidenceReport();

    const productionClaim = structuredClone(report);
    productionClaim.productionBacked = true;
    productionClaim.releaseEligible = true;
    productionClaim.finalReleaseStatus = 'GO';
    productionClaim.releaseEligibility.status = 'release-eligible';
    productionClaim.releaseEligibility.productionReadyClaimAccepted = true;
    assertFailure(validateEvidenceReport(productionClaim), 'RPP_0887_SUPPORT_ONLY_NO_GO_REQUIRED');

    const missingProductionBackedVerifier = structuredClone(report);
    missingProductionBackedVerifier.releaseEligibility.requiredProductionBackedVerifyReleaseBeforeEligibility = false;
    missingProductionBackedVerifier.releaseVerifier.productionBackedVerifyReleaseEvidence.requiredBeforeReleaseEligibility = false;
    assertFailure(validateEvidenceReport(missingProductionBackedVerifier), 'RPP_0887_PRODUCTION_BACKED_VERIFY_RELEASE_REQUIRED');

    const fallbackClaim = structuredClone(report);
    fallbackClaim.releaseVerifier.packagedFallbackObserved = true;
    fallbackClaim.releaseVerifier.noPackagedFallback = false;
    fallbackClaim.evidenceLimits.packagedFallbackSurfaceCount = 1;
    assertFailure(validateEvidenceReport(fallbackClaim), 'RPP_0887_PACKAGED_FALLBACK_REJECTED');

    const tunnelGap = structuredClone(report);
    tunnelGap.releaseVerifier.noTunnelEvidence = false;
    tunnelGap.negativeControls.tunnelUrlRejected = false;
    assertFailure(validateEvidenceReport(tunnelGap), 'RPP_0887_TUNNEL_REJECTION_REQUIRED');

    const ambiguousReadyClaim = structuredClone(report);
    ambiguousReadyClaim.releaseVerifier.productionReadyClaimAccepted = true;
    ambiguousReadyClaim.releaseVerifier.productionReadyAmbiguityRejected = false;
    ambiguousReadyClaim.releaseEligibility.productionReadyClaimAccepted = true;
    ambiguousReadyClaim.releaseEligibility.productionReadyAmbiguityRejected = false;
    assertFailure(validateEvidenceReport(ambiguousReadyClaim), 'RPP_0887_PRODUCTION_READY_AMBIGUITY_REJECTED');
  });
}

function buildBlockThemeTemplatesV5Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now, scope: proofId });
  const sourceSnapshot = blockThemeSite('source');
  const localSnapshot = blockThemeSite('localEdited');
  const remoteChangedSnapshot = blockThemeSite('remoteChanged');
  const readyPlan = createPushPlan({
    base: sourceSnapshot,
    local: localSnapshot,
    remote: sourceSnapshot,
    now,
  });
  const remoteChangedPlan = createPushPlan({
    base: sourceSnapshot,
    local: localSnapshot,
    remote: remoteChangedSnapshot,
    now,
  });
  const allScopedFileKeys = new Set(allBlockThemeFiles.map((entry) => `file:${entry.path}`));
  const localChangedFileKeys = [...allScopedFileKeys]
    .filter((resourceKey) => fileHashByKey(sourceSnapshot, resourceKey) !== fileHashByKey(localSnapshot, resourceKey))
    .sort();
  const remoteChangedFileKeys = [...allScopedFileKeys]
    .filter((resourceKey) => fileHashByKey(sourceSnapshot, resourceKey) !== fileHashByKey(remoteChangedSnapshot, resourceKey))
    .sort();
  const requiredFilesPresentInAllRoles = blockThemeFiles
    .filter((entry) => entry.required)
    .every((entry) => [sourceSnapshot, localSnapshot, remoteChangedSnapshot].every((site) =>
      Object.hasOwn(site.files, entry.path)));
  const themeJsonPresentInAllRoles = [sourceSnapshot, localSnapshot, remoteChangedSnapshot].every((site) =>
    Object.hasOwn(site.files, `${themeRoot}/theme.json`));
  const themeJsonValidInAllRoles = [sourceSnapshot, localSnapshot, remoteChangedSnapshot]
    .every((site) => blockThemeJsonValid(site));
  const sourceTemplateSlugs = templateSlugs(sourceSnapshot);
  const localTemplateSlugs = templateSlugs(localSnapshot);
  const customTemplateSlugs = customTemplateSlugsFromThemeJson(sourceSnapshot);
  const customTemplatePostTypeMatrix = customTemplatePostTypesFromThemeJson(sourceSnapshot);
  const templatePartAreas = templatePartAreasFromThemeJson(sourceSnapshot);
  const templatePartAreasDeclared = sameStringSet(
    templatePartAreas.map((entry) => `${entry.slug}:${entry.area}`),
    [
      'header:header',
      'footer:footer',
      'query-loop:uncategorized',
      'post-meta:uncategorized',
    ],
  );
  const themeJsonCustomTemplatesDeclared = sameStringSet(customTemplateSlugs, ['case-study', 'landing', 'portfolio']);
  const templatePartReferenceMatrix = [
    { role: 'source', references: templatePartReferences(sourceSnapshot) },
    { role: 'localEdited', references: templatePartReferences(localSnapshot) },
    { role: 'remoteChanged', references: templatePartReferences(remoteChangedSnapshot) },
  ];
  const declaredPartRefs = new Set(templatePartAreas.map((entry) => `${entry.slug}:${entry.area}`));
  const allReferencedPartsDeclared = templatePartReferenceMatrix.every((entry) =>
    entry.references.every((reference) => declaredPartRefs.has(reference)));
  const roleScopedFileCounts = {
    source: countPresentScopedFiles(sourceSnapshot, allBlockThemeFiles),
    localEdited: countPresentScopedFiles(localSnapshot, allBlockThemeFiles),
    remoteChanged: countPresentScopedFiles(remoteChangedSnapshot, allBlockThemeFiles),
  };
  const templateAndPartPathsNotNested = allBlockThemeFiles
    .filter((entry) => entry.kind === 'block-theme-template' || entry.kind === 'block-theme-template-part')
    .every((entry) =>
      /^wp-content\/themes\/[^/]+\/templates\/[^/]+\.html$/.test(entry.path)
        || /^wp-content\/themes\/[^/]+\/parts\/[^/]+\.html$/.test(entry.path));
  const readyTemplateMutations = summarizeTemplateMutations(readyPlan, allScopedFileKeys);
  const remoteChangedTemplateConflicts = summarizeTemplateConflicts(remoteChangedPlan, allScopedFileKeys);
  const topologyOk = topologyProof.ok === true;
  const roleUrlEvidence = requiredRoleOrder.map((role) => summarizeRoleUrl(topologyProof.urlCapture[role]));
  const scopeCounts = {
    templateFileCount: countScopedKind(allBlockThemeFiles, 'block-theme-template'),
    templatePartFileCount: countScopedKind(allBlockThemeFiles, 'block-theme-template-part'),
    patternFileCount: countScopedKind(allBlockThemeFiles, 'block-theme-pattern'),
    styleVariationFileCount: countScopedKind(allBlockThemeFiles, 'block-theme-style-variation'),
  };
  const scopeCore = {
    themeType: 'block',
    themeSlug,
    scopeRoot: themeRoot,
    fileScope: blockThemeFiles.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      required: entry.required,
    })),
    sourceTemplateSlugs,
    localTemplateSlugs,
    customTemplateSlugs,
    customTemplatePostTypeMatrix,
    templatePartAreas,
    templatePartReferenceMatrix,
    roleScopedFileCounts,
    localChangedFileKeys,
    remoteChangedFileKeys,
    scopeCounts,
  };
  const releaseVerifier = buildReleaseVerifier(topologyProof);
  const releaseEligibility = buildReleaseEligibility();
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    identityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok === true,
    packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
    onlySandbox8080Ingress: topologyProof.identityChecks.localLoopbackIngress.ok === true,
    blockThemeTemplateScopeRecorded: blockThemeFiles.every((entry) =>
      entry.path.startsWith(`${themeRoot}/`) && entry.kind.startsWith('block-theme-')),
    requiredBlockThemeFilesPresent: requiredFilesPresentInAllRoles,
    themeJsonValidInAllRoles,
    themeJsonCustomTemplatesDeclared,
    templateAndPartPathsNotNested,
    templatePartAreasDeclared,
    allReferencedPartsDeclared,
    roleScopedFileCountsRecorded: JSON.stringify(roleScopedFileCounts) === JSON.stringify({
      source: 14,
      localEdited: 15,
      remoteChanged: 14,
    }),
    readyPlanCoversLocalBlockThemeTemplates: sameStringSet(
      readyTemplateMutations.map((mutation) => mutation.resourceKey),
      localChangedFileKeys,
    ),
    everyTemplateMutationHasLiveRemotePrecondition: readyTemplateMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote' && sha256Pattern.test(mutation.remoteBeforeHash)),
    remoteChangedTemplatePartDriftFailsClosed: remoteChangedPlan.status === 'conflict'
      && remoteChangedTemplateConflicts.some((conflict) => conflict.resourceKey === `file:${themeRoot}/parts/header.html`),
    productionBackedVerifyReleaseRequiredBeforeEligibility: releaseEligibility.requiredProductionBackedVerifyReleaseBeforeEligibility,
    rejectsProductionReadyAmbiguity: releaseVerifier.productionReadyAmbiguityRejected,
    hashCountSurfaceOnlyEvidence: true,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId,
    proofId,
    variant: 5,
    checkedAt: now.toISOString(),
    status: passed ? 'passed-support-only' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      blockThemeVariant4Pattern: {
        rppId: 'RPP-0867',
        variant: 4,
        supportOnlyNoGo: true,
        releaseVerifierPattern: true,
      },
      blockThemeVariant3Pattern: {
        rppId: 'RPP-0847',
        variant: 3,
        supportOnlyNoGo: true,
        templateScopePattern: true,
      },
      topologyContract: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        sourceLocalChangedUrlCapture: true,
        staticIdentityChecks: true,
        tunnelAndSecretUrlRejection: true,
      },
      productionTopologyEvidence: [
        'RPP-0881 three-site local production topology v5',
        'RPP-0883 external WordPress topology v5',
        'RPP-0867 block theme templates release-verifier pattern v4',
      ],
      contract: 'release verifier carry-through for block theme templates without packaged fallback',
    },
    topology: {
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
      sourceLocalChangedUrlIdentitiesCaptured: roleUrlEvidence.every((entry) => sha256Pattern.test(entry.identityHash)),
      sourceLocalChangedUrlIdentitiesIdentityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
      sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true,
      remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok === true,
      noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
      noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok === true,
      localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok === true,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
      networkProbePerformed: topologyProof.constraints.networkProbePerformed,
      rawUrlValuesStored: false,
      hostnameValuesStored: false,
      rejectedRawInputsStored: false,
      roleUrlEvidence,
    },
    blockThemeTemplates: {
      themeType: 'block',
      themeSlug,
      scopeRoot: themeRoot,
      scopeAcceptedForReleaseTopology: topologyOk,
      fileScope: blockThemeFiles.map((entry) => ({
        path: entry.path,
        resourceKey: `file:${entry.path}`,
        kind: entry.kind,
        required: entry.required,
      })),
      requiredFileKeys: blockThemeFiles
        .filter((entry) => entry.required)
        .map((entry) => `file:${entry.path}`),
      requiredFilesPresentInAllRoles,
      themeJsonPresentInAllRoles,
      themeJsonValidInAllRoles,
      themeJsonCustomTemplatesDeclared,
      templateAndPartPathsNotNested,
      sourceTemplateSlugs,
      localTemplateSlugs,
      customTemplateSlugs,
      customTemplatePostTypeMatrix,
      templatePartAreas,
      templatePartAreasDeclared,
      templatePartReferenceMatrix,
      allReferencedPartsDeclared,
      roleScopedFileCounts,
      activeThemeOptionRowsCaptured: activeThemeOptionRowsPresent(sourceSnapshot, localSnapshot, remoteChangedSnapshot),
      ...scopeCounts,
      localChangedFileKeys,
      remoteChangedFileKeys,
      roleFileHashes: blockThemeFiles.map((entry) => ({
        resourceKey: `file:${entry.path}`,
        kind: entry.kind,
        required: entry.required,
        sourceHash: fileHash(sourceSnapshot, entry.path),
        localHash: fileHash(localSnapshot, entry.path),
        remoteChangedHash: fileHash(remoteChangedSnapshot, entry.path),
        rawFileContentsIncluded: false,
      })),
      scopeHash: `sha256:${digest(scopeCore)}`,
    },
    planner: {
      ready: {
        status: readyPlan.status,
        summary: readyPlan.summary,
        templateMutationKeys: readyTemplateMutations.map((mutation) => mutation.resourceKey).sort(),
        templatePreconditionKeys: readyTemplateMutations.map((mutation) => mutation.resourceKey).sort(),
        templateMutations: readyTemplateMutations,
        planHash: `sha256:${digest(summarizePlanForHash(readyPlan))}`,
      },
      remoteChanged: {
        status: remoteChangedPlan.status,
        summary: remoteChangedPlan.summary,
        templateConflictKeys: remoteChangedTemplateConflicts.map((conflict) => conflict.resourceKey).sort(),
        templateConflicts: remoteChangedTemplateConflicts,
        planHash: `sha256:${digest(summarizePlanForHash(remoteChangedPlan))}`,
      },
    },
    releaseVerifier,
    releaseEligibility,
    evidenceLimits: buildEvidenceLimits(),
    invariants,
    failures: topologyProof.failures.map((failure) => ({
      code: failure.code,
      role: failure.role || '',
      route: failure.route || '',
      envKey: failure.envKey || '',
    })),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function buildEvidenceReport() {
  const proof = buildBlockThemeTemplatesV5Proof({ env: goodEnv });
  const negativeProof = buildBlockThemeTemplatesV5Proof({ env: rejectedTopologyEnv });
  const reportCore = {
    schemaVersion: 1,
    rppId,
    variant: 5,
    title: 'Block theme templates v5 release-verifier support evidence',
    status: proof.status,
    supportOnly: proof.supportOnly,
    productionBacked: proof.productionBacked,
    releaseEligible: proof.releaseEligible,
    finalReleaseStatus: proof.finalReleaseStatus,
    integrationRecommendation: proof.integrationRecommendation,
    builtOn: proof.builtOn,
    topologyScope: {
      sourceLocalChangedRoleUrlsCaptured: proof.topology.sourceLocalChangedUrlsCaptured,
      capturedRoleUrlCount: proof.topology.roleUrlEvidence.filter((entry) => entry.captured).length,
      validRoleUrlCount: proof.topology.roleUrlEvidence.filter((entry) => entry.valid).length,
      identityHashCount: proof.topology.roleUrlEvidence.filter((entry) => sha256Pattern.test(entry.identityHash)).length,
      sourceLocalChangedUrlIdentitiesIdentityChecked: proof.topology.sourceLocalChangedUrlIdentitiesIdentityChecked,
      sourceLocalChangedUrlsDistinct: proof.topology.sourceLocalChangedUrlsDistinct,
      sameSourceAcrossRoutes: proof.topology.sameSourceAcrossRoutes,
      remoteAliasMatchesSource: proof.topology.remoteAliasMatchesSource,
      noTunnelPolicyEnforced: proof.topology.noTunnelPolicyEnforced,
      noUrlSecrets: proof.topology.noUrlSecrets,
      localLoopbackIngressOnly8080: proof.topology.localLoopbackIngress,
      packagedFallbackDisabled: proof.topology.packagedFallbackDisabled,
      networkProbePerformed: proof.topology.networkProbePerformed,
      rawUrlValuesStored: false,
      hostnameValuesStored: false,
      roleIdentityHashes: Object.fromEntries(proof.topology.roleUrlEvidence.map((entry) => [
        entry.role,
        entry.identityHash,
      ])),
    },
    blockThemeTemplatesScope: {
      status: 'support-only-block-theme-template-scope',
      themeType: proof.blockThemeTemplates.themeType,
      themeRoot: proof.blockThemeTemplates.scopeRoot,
      requiredFiles: proof.blockThemeTemplates.requiredFileKeys.map((key) => key.replace(/^file:/, '')),
      templateFileCount: proof.blockThemeTemplates.templateFileCount,
      templatePartFileCount: proof.blockThemeTemplates.templatePartFileCount,
      patternFileCount: proof.blockThemeTemplates.patternFileCount,
      styleVariationFileCount: proof.blockThemeTemplates.styleVariationFileCount,
      themeJsonValidated: proof.blockThemeTemplates.themeJsonValidInAllRoles,
      themeJsonCustomTemplatesDeclared: proof.blockThemeTemplates.themeJsonCustomTemplatesDeclared,
      templateAndPartPathsNotNested: proof.blockThemeTemplates.templateAndPartPathsNotNested,
      templatePartAreasDeclared: proof.blockThemeTemplates.templatePartAreasDeclared,
      customTemplatePostTypeCount: proof.blockThemeTemplates.customTemplatePostTypeMatrix.length,
      templateReferenceSurfaceCount: proof.blockThemeTemplates.templatePartReferenceMatrix[0].references.length,
      roleScopedFileCounts: proof.blockThemeTemplates.roleScopedFileCounts,
      allReferencedPartsDeclared: proof.blockThemeTemplates.allReferencedPartsDeclared,
      activeThemeOptionRowsCaptured: proof.blockThemeTemplates.activeThemeOptionRowsCaptured,
      localChangedFileCount: proof.blockThemeTemplates.localChangedFileKeys.length,
      remoteChangedTemplatePartDriftFailsClosed: proof.invariants.remoteChangedTemplatePartDriftFailsClosed,
      plannerMutationsRequireLiveRemotePreconditions: proof.invariants.everyTemplateMutationHasLiveRemotePrecondition,
      rawTemplateBodiesIncluded: false,
      rawThemeJsonBodiesIncluded: false,
      scopeHash: proof.blockThemeTemplates.scopeHash,
      releaseGateMovement: 'none',
    },
    plannerScope: {
      readyPlanStatus: proof.planner.ready.status,
      readyTemplateMutationCount: proof.planner.ready.templateMutationKeys.length,
      readyTemplatePreconditionCount: proof.planner.ready.templatePreconditionKeys.length,
      readyPlanHash: proof.planner.ready.planHash,
      remoteChangedPlanStatus: proof.planner.remoteChanged.status,
      remoteChangedTemplateConflictCount: proof.planner.remoteChanged.templateConflictKeys.length,
      remoteChangedPlanHash: proof.planner.remoteChanged.planHash,
      remoteChangedTemplatePartDriftFailsClosed: proof.invariants.remoteChangedTemplatePartDriftFailsClosed,
      everyTemplateMutationHasLiveRemotePrecondition: proof.invariants.everyTemplateMutationHasLiveRemotePrecondition,
    },
    releaseVerifier: proof.releaseVerifier,
    negativeControls: {
      tunnelUrlRejected: negativeProof.failures.some((failure) =>
        failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'),
      secretShapedUrlRejected: negativeProof.failures.some((failure) =>
        failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'),
      non8080LoopbackRejected: negativeProof.failures.some((failure) =>
        failure.code === 'EXTERNAL_WORDPRESS_LOOPBACK_PORT_NOT_8080'),
      packagedFallbackRejected: negativeProof.failures.some((failure) =>
        failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'),
      blockThemeScopeAcceptedAfterRejectedTopology: false,
      rawRejectedInputsStored: false,
    },
    releaseEligibility: proof.releaseEligibility,
    evidenceLimits: proof.evidenceLimits,
  };

  return {
    ...reportCore,
    scopeEvidenceHash: digest(scopeEvidenceInput(reportCore)),
  };
}

function buildReleaseVerifier(topologyProof) {
  const packagedFallbackDisabled = topologyProof.identityChecks.packagedFallbackDisabled.ok === true;
  const noTunnelEvidence = topologyProof.identityChecks.noTunnelHosts.ok === true;
  return {
    requiredCommand: 'npm run verify:release',
    topologyCommand: 'npm run verify:release:docker-local-production',
    successTarget: 'verify-release-passes-without-packaged-fallback-on-block-theme-topology',
    carriedThroughBySupportProof: true,
    productionBackedVerifyReleaseEvidence: {
      present: false,
      observedPassingRun: false,
      topology: 'block-theme-production-topology',
      requiredBeforeReleaseEligibility: true,
      unavailableCapability: exactUnavailableCapability,
    },
    packagedFallbackAllowed: false,
    packagedFallbackObserved: packagedFallbackDisabled !== true,
    noPackagedFallback: packagedFallbackDisabled,
    noTunnelEvidence,
    tunnelObserved: noTunnelEvidence !== true,
    productionReadyClaimAccepted: false,
    productionReadyAmbiguityRejected: true,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
  };
}

function buildReleaseEligibility() {
  return {
    status: 'not-release-eligible',
    finalReleaseStatus: 'NO-GO',
    releaseGateMovement: 'none',
    requiredProductionBackedVerifyReleaseBeforeEligibility: true,
    productionReadyClaimAccepted: false,
    productionReadyAmbiguityRejected: true,
    requiredEvidence: [
      'production-backed-verify-release-pass-on-block-theme-topology',
      'packaged-fallback-disabled-and-absent',
      'no-tunnel-service-or-tunnel-url-use',
      'source-local-changed-url-identities-captured-and-checked',
      'route-receipts-durable-journal-and-live-mutation-receipts',
    ],
    blockers: [
      'support-only-block-theme-template-proof',
      'no-production-backed-verify-release-pass',
      'no-production-backed-wordpress-reachability',
      'no-route-receipts-or-live-mutation-receipts',
    ],
  };
}

function buildEvidenceLimits() {
  return {
    mode: 'hash-count-surface-only',
    rawTemplateBodiesIncluded: false,
    rawThemeJsonBodiesIncluded: false,
    rawOptionRowPayloadsIncluded: false,
    rawUrlValuesIncluded: false,
    hostnameValuesIncluded: false,
    authMaterialIncluded: false,
    networkTunnelOutputIncluded: false,
    packagedFallbackSurfaceCount: 0,
  };
}

function blockThemeSite(role) {
  const files = {
    [`${themeRoot}/theme.json`]: themeJsonForRole('source'),
    [`${themeRoot}/templates/index.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-source-index-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"query-loop","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/front-page.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-source-front-page-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/single.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-source-single-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"post-meta","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/page.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-source-page-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/404.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-source-404-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/parts/header.html`]: '<!-- wp:group --><header>RPP 0887 source header</header><!-- /wp:group -->',
    [`${themeRoot}/parts/footer.html`]: '<!-- wp:group --><footer>RPP 0887 source footer</footer><!-- /wp:group -->',
    [`${themeRoot}/parts/query-loop.html`]: '<!-- wp:query --><section>RPP 0887 source query loop</section><!-- /wp:query -->',
    [`${themeRoot}/parts/post-meta.html`]: '<!-- wp:group --><aside>RPP 0887 source post meta</aside><!-- /wp:group -->',
    [`${themeRoot}/patterns/featured-query.php`]: '<?php /* Title: RPP 0887 Featured Query */ ?>',
    [`${themeRoot}/patterns/cta-band.php`]: '<?php /* Title: RPP 0887 CTA Band */ ?>',
    [`${themeRoot}/styles/editorial.json`]: JSON.stringify({
      version: 3,
      title: 'RPP 0887 Editorial',
      settings: { typography: { fluid: true } },
    }),
    [`${themeRoot}/styles/contrast.json`]: JSON.stringify({
      version: 3,
      title: 'RPP 0887 Contrast',
      styles: { color: { text: '#111111', background: '#ffffff' } },
    }),
  };

  if (role === 'localEdited') {
    files[`${themeRoot}/theme.json`] = themeJsonForRole('localEdited');
    files[`${themeRoot}/templates/index.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-local-index-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"query-loop","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
    files[`${themeRoot}/templates/single.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-local-single-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"post-meta","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
    files[`${themeRoot}/templates/search.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0887-local-search-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"query-loop","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
    files[`${themeRoot}/parts/header.html`] = '<!-- wp:group --><header>rpp-0887-local-header-private</header><!-- /wp:group -->';
    files[`${themeRoot}/parts/query-loop.html`] = '<!-- wp:query --><section>rpp-0887-local-query-loop-private</section><!-- /wp:query -->';
    files[`${themeRoot}/styles/editorial.json`] = JSON.stringify({
      version: 3,
      title: 'RPP 0887 Editorial',
      settings: { typography: { fluid: true } },
      styles: { typography: { lineHeight: '1.7' } },
      evidenceNeedle: 'rpp-0887-local-editorial-style-private',
    });
    files[`${themeRoot}/styles/contrast.json`] = JSON.stringify({
      version: 3,
      title: 'RPP 0887 Contrast',
      styles: { color: { text: '#222222', background: '#f7f7f7' } },
    });
  }

  if (role === 'remoteChanged') {
    files[`${themeRoot}/parts/header.html`] = '<!-- wp:group --><header>rpp-0887-remote-header-private</header><!-- /wp:group -->';
  }

  return {
    files,
    plugins: {},
    db: {
      wp_options: {
        'option_name:template': { option_name: 'template', option_value: themeSlug },
        'option_name:stylesheet': { option_name: 'stylesheet', option_value: themeSlug },
      },
    },
  };
}

function themeJsonForRole(role) {
  const base = {
    version: 3,
    title: 'RPP 0887 Block V5',
    settings: {
      layout: { contentSize: '780px', wideSize: '1200px' },
      spacing: { units: ['px', 'rem', 'vh'] },
    },
    styles: {
      spacing: { blockGap: role === 'localEdited' ? '1.75rem' : '1.25rem' },
    },
    customTemplates: [
      { name: 'landing', title: 'Landing', postTypes: ['page'] },
      { name: 'case-study', title: 'Case Study', postTypes: ['page', 'post'] },
      { name: 'portfolio', title: 'Portfolio', postTypes: ['portfolio', 'page'] },
    ],
    templateParts: [
      { name: 'header', area: 'header' },
      { name: 'footer', area: 'footer' },
      { name: 'query-loop', area: 'uncategorized' },
      { name: 'post-meta', area: 'uncategorized' },
    ],
  };
  return JSON.stringify(base);
}

function summarizeRoleUrl(captured) {
  return {
    role: captured.role,
    envKey: captured.envKey,
    captured: captured.provided === true,
    valid: captured.valid === true,
    scheme: captured.protocol || '',
    serviceKind: captured.serviceKind || 'missing',
    port: captured.port || '',
    loopback: captured.loopback === true,
    loopbackAllowed: captured.loopbackAllowed === true,
    identityHash: captured.identityHash || '',
    originHash: captured.originHash || '',
    urlCharacterCount: captured.normalizedUrl ? captured.normalizedUrl.length : 0,
    pathDepth: captured.pathname
      ? captured.pathname.split('/').filter(Boolean).length
      : 0,
    normalizedUrlStored: false,
    hostStored: false,
    rawUrlStored: false,
  };
}

function summarizeTemplateMutations(plan, allScopedFileKeys) {
  return plan.mutations
    .filter((mutation) => allScopedFileKeys.has(mutation.resourceKey))
    .map((mutation) => {
      const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
      return {
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        checkedAgainst: precondition?.checkedAgainst || '',
        mutationHash: `sha256:${digest(mutation)}`,
        preconditionHash: precondition ? `sha256:${digest(precondition)}` : '',
      };
    })
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
}

function summarizeTemplateConflicts(plan, allScopedFileKeys) {
  return plan.conflicts
    .filter((conflict) => allScopedFileKeys.has(conflict.resourceKey))
    .map((conflict) => ({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy,
      conflictHash: `sha256:${digest(conflict)}`,
    }))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
}

function summarizePlanForHash(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
    conflictKeys: plan.conflicts.map((conflict) => conflict.resourceKey).sort(),
    blockerKeys: plan.blockers.map((blocker) => blocker.resourceKey || blocker.class).sort(),
  };
}

function blockThemeJsonValid(site) {
  const parsed = parseThemeJson(site);
  return parsed?.version === 3
    && Array.isArray(parsed.templateParts)
    && parsed.templateParts.length === 4
    && parsed.templateParts.every((entry) => typeof entry.name === 'string' && typeof entry.area === 'string')
    && Array.isArray(parsed.customTemplates)
    && parsed.customTemplates.length === 3
    && parsed.customTemplates.every((entry) => typeof entry.name === 'string');
}

function parseThemeJson(site) {
  try {
    return JSON.parse(site.files?.[`${themeRoot}/theme.json`] || '');
  } catch {
    return null;
  }
}

function customTemplateSlugsFromThemeJson(site) {
  const parsed = parseThemeJson(site);
  return [...(parsed?.customTemplates || [])]
    .map((entry) => entry.name)
    .sort();
}

function customTemplatePostTypesFromThemeJson(site) {
  const parsed = parseThemeJson(site);
  return [...(parsed?.customTemplates || [])]
    .map((entry) => ({
      slug: entry.name,
      postTypes: [...(entry.postTypes || [])].sort(),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function templatePartAreasFromThemeJson(site) {
  const parsed = parseThemeJson(site);
  return [...(parsed?.templateParts || [])]
    .map((entry) => ({ slug: entry.name, area: entry.area }));
}

function templatePartReferences(site) {
  const references = new Set();
  const templatePrefix = `${themeRoot}/templates/`;
  for (const [filePath, body] of Object.entries(site.files || {})) {
    if (!filePath.startsWith(templatePrefix) || !filePath.endsWith('.html')) {
      continue;
    }
    for (const match of body.matchAll(/wp:template-part\s+({[^>]+})/g)) {
      try {
        const parsed = JSON.parse(match[1]);
        if (typeof parsed.slug === 'string') {
          references.add(`${parsed.slug}:${parsed.area || 'uncategorized'}`);
        }
      } catch {
        references.add('malformed:template-part');
      }
    }
  }
  return [...references].sort();
}

function templateSlugs(site) {
  return Object.keys(site.files || {})
    .filter((filePath) => filePath.startsWith(`${themeRoot}/templates/`) && filePath.endsWith('.html'))
    .map((filePath) => path.basename(filePath, '.html'))
    .sort();
}

function activeThemeOptionRowsPresent(...sites) {
  return sites.every((site) =>
    site.db?.wp_options?.['option_name:template']?.option_value === themeSlug
      && site.db?.wp_options?.['option_name:stylesheet']?.option_value === themeSlug);
}

function fileHash(site, filePath) {
  return resourceHash(site, { type: 'file', path: filePath, key: `file:${filePath}` });
}

function fileHashByKey(site, resourceKey) {
  return fileHash(site, resourceKey.replace(/^file:/, ''));
}

function countScopedKind(files, kind) {
  return files.filter((entry) => entry.kind === kind).length;
}

function countPresentScopedFiles(site, files) {
  return files.filter((entry) => Object.hasOwn(site.files || {}, entry.path)).length;
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0887 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function validateEvidenceReport(report) {
  const failures = [];
  if (report.rppId !== rppId
    || report.variant !== 5
    || report.title !== 'Block theme templates v5 release-verifier support evidence'
    || report.status !== 'passed-support-only') {
    failures.push({ code: 'RPP_0887_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.releaseEligibility?.status !== 'not-release-eligible') {
    failures.push({ code: 'RPP_0887_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.releaseVerifier?.requiredCommand !== 'npm run verify:release'
    || report.releaseVerifier?.topologyCommand !== 'npm run verify:release:docker-local-production'
    || report.releaseVerifier?.successTarget !== 'verify-release-passes-without-packaged-fallback-on-block-theme-topology'
    || report.releaseVerifier?.carriedThroughBySupportProof !== true
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.present !== false
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.observedPassingRun !== false
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.requiredBeforeReleaseEligibility !== true
    || report.releaseEligibility?.requiredProductionBackedVerifyReleaseBeforeEligibility !== true) {
    failures.push({ code: 'RPP_0887_PRODUCTION_BACKED_VERIFY_RELEASE_REQUIRED' });
  }
  if (report.releaseVerifier?.packagedFallbackAllowed !== false
    || report.releaseVerifier?.packagedFallbackObserved !== false
    || report.releaseVerifier?.noPackagedFallback !== true
    || report.evidenceLimits?.packagedFallbackSurfaceCount !== 0) {
    failures.push({ code: 'RPP_0887_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.releaseVerifier?.noTunnelEvidence !== true
    || report.releaseVerifier?.tunnelObserved !== false
    || report.negativeControls?.tunnelUrlRejected !== true
    || report.evidenceLimits?.networkTunnelOutputIncluded !== false) {
    failures.push({ code: 'RPP_0887_TUNNEL_REJECTION_REQUIRED' });
  }
  if (report.releaseVerifier?.productionReadyClaimAccepted !== false
    || report.releaseVerifier?.productionReadyAmbiguityRejected !== true
    || report.releaseEligibility?.productionReadyClaimAccepted !== false
    || report.releaseEligibility?.productionReadyAmbiguityRejected !== true) {
    failures.push({ code: 'RPP_0887_PRODUCTION_READY_AMBIGUITY_REJECTED' });
  }
  if (report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.unavailableCapability?.code !== 'DOCKER_CLI_MISSING'
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.unavailableCapability?.capability !== 'docker-cli'
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.unavailableCapability?.command !== 'docker --version'
    || report.releaseVerifier?.productionBackedVerifyReleaseEvidence?.unavailableCapability?.observedExitCode !== 127) {
    failures.push({ code: 'RPP_0887_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
  }
  if (report.blockThemeTemplatesScope?.themeRoot !== themeRoot
    || report.blockThemeTemplatesScope?.templateFileCount !== 6
    || report.blockThemeTemplatesScope?.templatePartFileCount !== 4
    || report.blockThemeTemplatesScope?.patternFileCount !== 2
    || report.blockThemeTemplatesScope?.styleVariationFileCount !== 2
    || report.blockThemeTemplatesScope?.localChangedFileCount !== expectedLocalChangedFileKeys.length) {
    failures.push({ code: 'RPP_0887_BLOCK_THEME_SCOPE_MISMATCH' });
  }
  if (report.blockThemeTemplatesScope?.themeJsonValidated !== true
    || report.blockThemeTemplatesScope?.themeJsonCustomTemplatesDeclared !== true
    || report.blockThemeTemplatesScope?.templateAndPartPathsNotNested !== true
    || report.blockThemeTemplatesScope?.templatePartAreasDeclared !== true
    || report.blockThemeTemplatesScope?.customTemplatePostTypeCount !== 3
    || report.blockThemeTemplatesScope?.templateReferenceSurfaceCount !== 4
    || report.blockThemeTemplatesScope?.allReferencedPartsDeclared !== true
    || JSON.stringify(report.blockThemeTemplatesScope?.roleScopedFileCounts) !== JSON.stringify({
      source: 14,
      localEdited: 15,
      remoteChanged: 14,
    })
    || report.blockThemeTemplatesScope?.remoteChangedTemplatePartDriftFailsClosed !== true
    || report.blockThemeTemplatesScope?.plannerMutationsRequireLiveRemotePreconditions !== true) {
    failures.push({ code: 'RPP_0887_BLOCK_THEME_INVARIANT_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.rawTemplateBodiesIncluded !== false
    || report.evidenceLimits?.rawThemeJsonBodiesIncluded !== false
    || report.evidenceLimits?.rawOptionRowPayloadsIncluded !== false
    || report.evidenceLimits?.rawUrlValuesIncluded !== false
    || report.evidenceLimits?.hostnameValuesIncluded !== false
    || report.evidenceLimits?.authMaterialIncluded !== false) {
    failures.push({ code: 'RPP_0887_EVIDENCE_LIMITS_FAILED' });
  }
  if (report.scopeEvidenceHash !== digest(scopeEvidenceInput(report))) {
    failures.push({ code: 'RPP_0887_SCOPE_HASH_MISMATCH' });
  }
  const redactionIssues = findEvidenceRedactionIssues(report);
  if (redactionIssues.length > 0) {
    failures.push({ code: 'RPP_0887_RAW_EVIDENCE_REJECTED', issues: redactionIssues });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function scopeEvidenceInput(report) {
  return {
    topologyScope: report.topologyScope,
    blockThemeTemplatesScope: report.blockThemeTemplatesScope,
    plannerScope: report.plannerScope,
    releaseVerifier: report.releaseVerifier,
    negativeControls: report.negativeControls,
    releaseEligibility: report.releaseEligibility,
    evidenceLimits: report.evidenceLimits,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function sameStringSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function assertNoNeedles(value, needles) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `proof leaked raw fixture value: ${needle}`);
  }
}

function assertNoRawUrls(value) {
  assert.doesNotMatch(JSON.stringify(value), /https?:\/\//i);
}

function assertFailure(result, expectedCode) {
  assert.equal(result.ok, false, `expected ${expectedCode} failure`);
  assert.ok(
    result.failures.some((failure) => failure.code === expectedCode),
    `expected ${expectedCode}, got ${JSON.stringify(result.failures)}`,
  );
}

if (process.env.RPP_0887_REPORT_JSON === '1') {
  process.stdout.write(`${JSON.stringify(buildEvidenceReport(), null, 2)}\n`);
}
