import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0847-block-theme-templates-v3.md');
const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0847-block-theme-templates-v3';
const themeSlug = 'rpp-0847-block-v3';
const themeRoot = `wp-content/themes/${themeSlug}`;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const blockThemeFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/theme.json`, kind: 'block-theme-config', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/index.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/home.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/archive.html`, kind: 'block-theme-template', required: true }),
  Object.freeze({ path: `${themeRoot}/templates/page.html`, kind: 'block-theme-template', required: false }),
  Object.freeze({ path: `${themeRoot}/parts/header.html`, kind: 'block-theme-template-part', required: true }),
  Object.freeze({ path: `${themeRoot}/parts/footer.html`, kind: 'block-theme-template-part', required: true }),
  Object.freeze({ path: `${themeRoot}/parts/sidebar.html`, kind: 'block-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/parts/comments.html`, kind: 'block-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/patterns/landing-section.php`, kind: 'block-theme-pattern', required: false }),
  Object.freeze({ path: `${themeRoot}/patterns/query-card.php`, kind: 'block-theme-pattern', required: false }),
  Object.freeze({ path: `${themeRoot}/styles/high-contrast.json`, kind: 'block-theme-style-variation', required: false }),
  Object.freeze({ path: `${themeRoot}/styles/large-print.json`, kind: 'block-theme-style-variation', required: false }),
]);

const localOnlyBlockThemeFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/templates/search.html`, kind: 'block-theme-template', required: false }),
]);

const allBlockThemeFiles = Object.freeze([...blockThemeFiles, ...localOnlyBlockThemeFiles]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/block-theme-v3',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/block-theme-v3/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/block-theme-v3',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/block-theme-v3',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/block-theme-v3/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/block-theme-v3',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/block-theme-v3',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/block-theme-v3',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/block-theme-v3',
  REPRINT_PUSH_USERNAME: 'block-theme-v3-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0847-application-password-must-not-leak',
});

const forbiddenProofNeedles = Object.freeze([
  'rpp-0847-application-password-must-not-leak',
  'rpp-0847-source-index-private',
  'rpp-0847-source-home-private',
  'rpp-0847-source-archive-private',
  'rpp-0847-source-page-private',
  'rpp-0847-local-index-private',
  'rpp-0847-local-home-private',
  'rpp-0847-local-search-private',
  'rpp-0847-local-header-private',
  'rpp-0847-local-sidebar-private',
  'rpp-0847-local-style-private',
  'rpp-0847-remote-home-private',
]);

const expectedLocalChangedFileKeys = Object.freeze([
  `file:${themeRoot}/parts/header.html`,
  `file:${themeRoot}/parts/sidebar.html`,
  `file:${themeRoot}/styles/high-contrast.json`,
  `file:${themeRoot}/styles/large-print.json`,
  `file:${themeRoot}/templates/home.html`,
  `file:${themeRoot}/templates/index.html`,
  `file:${themeRoot}/templates/search.html`,
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

test('RPP-0847 captures variant 3 block theme template scope and fails release closed', () => {
  const proof = buildBlockThemeTemplatesProof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0847');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.variant, externalWordPressTopologyVariant);
  assert.equal(proof.builtOn.adjacentEvidence, 'RPP-0827 block theme templates variant 2');
  assert.deepEqual(proof.builtOn.productionTopologyEvidence, [
    'RPP-0841 three-site local production topology v3',
    'RPP-0842 Docker WordPress topology v3',
    'RPP-0843 external WordPress topology v3',
  ]);
  assert.equal(proof.topology.sourceUrl, 'https://source.example.test/block-theme-v3');
  assert.equal(proof.topology.localUrl, 'https://local.example.test/block-theme-v3');
  assert.equal(proof.topology.remoteChangedUrl, 'https://changed.example.test/block-theme-v3');
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.topology.identityChecked, true);
  assert.equal(proof.topology.sameSourceAcrossRoutes, true);
  assert.equal(proof.topology.remoteAliasMatchesSource, true);
  assert.equal(proof.topology.noTunnelPolicyEnforced, true);
  assert.equal(proof.topology.noUrlSecrets, true);
  assert.equal(proof.topology.localLoopbackIngress, true);
  assert.equal(proof.topology.packagedFallbackDisabled, true);
  assert.equal(proof.topology.networkProbePerformed, false);
  assert.match(proof.topology.sourceIdentityHash, sha256Pattern);
  assert.match(proof.topology.localIdentityHash, sha256Pattern);
  assert.match(proof.topology.remoteChangedIdentityHash, sha256Pattern);

  assert.equal(proof.blockThemeTemplates.themeType, 'block');
  assert.equal(proof.blockThemeTemplates.themeSlug, themeSlug);
  assert.equal(proof.blockThemeTemplates.scopeRoot, themeRoot);
  assert.deepEqual(
    proof.blockThemeTemplates.fileScope.map((entry) => entry.path),
    blockThemeFiles.map((entry) => entry.path),
  );
  assert.deepEqual(proof.blockThemeTemplates.requiredFileKeys, [
    `file:${themeRoot}/theme.json`,
    `file:${themeRoot}/templates/index.html`,
    `file:${themeRoot}/templates/home.html`,
    `file:${themeRoot}/templates/archive.html`,
    `file:${themeRoot}/parts/header.html`,
    `file:${themeRoot}/parts/footer.html`,
  ]);
  assert.equal(proof.blockThemeTemplates.requiredFilesPresentInAllRoles, true);
  assert.equal(proof.blockThemeTemplates.themeJsonPresentInAllRoles, true);
  assert.equal(proof.blockThemeTemplates.themeJsonValidInAllRoles, true);
  assert.equal(proof.blockThemeTemplates.themeJsonCustomTemplatesDeclared, true);
  assert.equal(proof.blockThemeTemplates.templateAndPartPathsNotNested, true);
  assert.deepEqual(proof.blockThemeTemplates.sourceTemplateSlugs, ['archive', 'home', 'index', 'page']);
  assert.deepEqual(proof.blockThemeTemplates.localTemplateSlugs, ['archive', 'home', 'index', 'page', 'search']);
  assert.deepEqual(proof.blockThemeTemplates.customTemplateSlugs, ['landing', 'wide']);
  assert.deepEqual(proof.blockThemeTemplates.templatePartAreas, [
    { slug: 'header', area: 'header' },
    { slug: 'footer', area: 'footer' },
    { slug: 'sidebar', area: 'uncategorized' },
    { slug: 'comments', area: 'uncategorized' },
  ]);
  assert.equal(proof.blockThemeTemplates.templatePartAreasDeclared, true);
  assert.equal(proof.blockThemeTemplates.activeThemeOptionRowsCaptured, true);
  assert.equal(proof.blockThemeTemplates.templateFileCount, 5);
  assert.equal(proof.blockThemeTemplates.templatePartFileCount, 4);
  assert.equal(proof.blockThemeTemplates.patternFileCount, 2);
  assert.equal(proof.blockThemeTemplates.styleVariationFileCount, 2);

  assert.deepEqual(proof.blockThemeTemplates.localChangedFileKeys, expectedLocalChangedFileKeys);
  assert.deepEqual(proof.blockThemeTemplates.remoteChangedFileKeys, [
    `file:${themeRoot}/templates/home.html`,
  ]);
  assert.ok(proof.blockThemeTemplates.roleFileHashes.every((entry) =>
    sha256Pattern.test(entry.sourceHash)
      && sha256Pattern.test(entry.localHash)
      && sha256Pattern.test(entry.remoteChangedHash)));
  assert.match(proof.blockThemeTemplates.scopeHash, sha256EvidencePattern);

  assert.equal(proof.planner.ready.status, 'ready');
  assert.deepEqual(proof.planner.ready.templateMutationKeys, proof.blockThemeTemplates.localChangedFileKeys);
  assert.deepEqual(proof.planner.ready.templatePreconditionKeys, proof.blockThemeTemplates.localChangedFileKeys);
  assert.ok(proof.planner.ready.templateMutations.every((mutation) =>
    mutation.checkedAgainst === 'live-remote'
      && sha256Pattern.test(mutation.baseHash)
      && sha256Pattern.test(mutation.localHash)
      && sha256Pattern.test(mutation.remoteBeforeHash)
      && /^sha256:[a-f0-9]{64}$/.test(mutation.mutationHash)
      && /^sha256:[a-f0-9]{64}$/.test(mutation.preconditionHash)));
  assert.equal(proof.planner.remoteChanged.status, 'conflict');
  assert.deepEqual(proof.planner.remoteChanged.templateConflictKeys, [`file:${themeRoot}/templates/home.html`]);
  assert.equal(proof.invariants.remoteChangedTemplateDriftFailsClosed, true);

  assert.equal(proof.productionTopologyEvidence.requiredCommand, 'npm run verify:release');
  assert.equal(proof.productionTopologyEvidence.topologyCommand, 'npm run verify:release:docker-local-production');
  assert.equal(proof.productionTopologyEvidence.successTarget, 'verify-release-passes-without-packaged-fallback-on-block-theme-topology');
  assert.equal(proof.productionTopologyEvidence.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(proof.productionTopologyEvidence.exactUnavailableCapabilityRecorded, true);
  assert.deepEqual(proof.productionTopologyEvidence.unavailableCapability, exactUnavailableCapability);
  assert.equal(proof.productionTopologyEvidence.packagedFallbackObserved, false);
  assert.equal(proof.productionTopologyEvidence.releaseMovement, 'none');

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.identityChecked, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.packagedFallbackDisabled, true);
  assert.equal(proof.invariants.onlySandbox8080Ingress, true);
  assert.equal(proof.invariants.blockThemeTemplateScopeRecorded, true);
  assert.equal(proof.invariants.requiredBlockThemeFilesPresent, true);
  assert.equal(proof.invariants.themeJsonValidInAllRoles, true);
  assert.equal(proof.invariants.themeJsonCustomTemplatesDeclared, true);
  assert.equal(proof.invariants.templateAndPartPathsNotNested, true);
  assert.equal(proof.invariants.templatePartAreasDeclared, true);
  assert.equal(proof.invariants.readyPlanCoversLocalBlockThemeTemplates, true);
  assert.equal(proof.invariants.everyTemplateMutationHasLiveRemotePrecondition, true);
  assert.equal(proof.invariants.exactUnavailableCapabilityRecorded, true);
  assert.equal(proof.invariants.hashOnlyThemeEvidence, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.outputHash, sha256EvidencePattern);
  assertNoNeedles(proof, forbiddenProofNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0847 block theme template proof' }));
});

test('RPP-0847 fails closed before accepting variant 3 scope for tunnels, URL secrets, and packaged fallback', () => {
  const proof = buildBlockThemeTemplatesProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0847-secret@source.example.test/block-theme-v3',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/block-theme-v3?token=rpp0847-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.localhost.run/block-theme-v3',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceUrl, '');
  assert.equal(proof.topology.localUrl, '');
  assert.equal(proof.topology.remoteChangedUrl, '');
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecrets, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.equal(proof.blockThemeTemplates.scopeAcceptedForReleaseTopology, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assertNoNeedles(proof, [
    'admin:rpp0847-secret',
    'rpp0847-secret',
    'token=rpp0847-token',
    'rpp0847-token',
    'changed.localhost.run',
  ]);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0847 rejected topology proof' }));
});

test('RPP-0847 block theme template proof is deterministic and hash-only', () => {
  const firstProof = buildBlockThemeTemplatesProof({ env: goodEnv });
  const secondProof = buildBlockThemeTemplatesProof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.equal(firstProof.blockThemeTemplates.scopeHash, secondProof.blockThemeTemplates.scopeHash);
  assert.deepEqual(firstProof.blockThemeTemplates.roleFileHashes, secondProof.blockThemeTemplates.roleFileHashes);
  assert.deepEqual(firstProof.planner.ready.templateMutations, secondProof.planner.ready.templateMutations);
  assert.deepEqual(firstProof.planner.remoteChanged.templateConflicts, secondProof.planner.remoteChanged.templateConflicts);
  assertNoNeedles(firstProof, forbiddenProofNeedles);
  assertNoNeedles(secondProof, forbiddenProofNeedles);
});

test('RPP-0847 evidence document records support-only NO-GO variant 3 scope', () => {
  const { report, text } = loadEvidenceReport();
  const validation = validateSupportReport(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0847');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.coverageMode, 'generated-local-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.successContract.criterion, 'verify-release-passes-without-packaged-fallback-on-block-theme-topology');
  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.exactUnavailableCapabilityRecorded, true);
  assert.equal(report.successContract.finalReleaseMayMove, false);

  assert.equal(report.blockThemeTemplatesScope.themeType, 'block');
  assert.equal(report.blockThemeTemplatesScope.themeRoot, themeRoot);
  assert.equal(report.blockThemeTemplatesScope.themeJsonValidated, true);
  assert.equal(report.blockThemeTemplatesScope.themeJsonCustomTemplatesDeclared, true);
  assert.equal(report.blockThemeTemplatesScope.templateFileCount, 5);
  assert.equal(report.blockThemeTemplatesScope.templatePartFileCount, 4);
  assert.equal(report.blockThemeTemplatesScope.patternFileCount, 2);
  assert.equal(report.blockThemeTemplatesScope.styleVariationFileCount, 2);
  assert.equal(report.blockThemeTemplatesScope.templateAndPartPathsNotNested, true);
  assert.equal(report.blockThemeTemplatesScope.templatePartAreasDeclared, true);
  assert.equal(report.blockThemeTemplatesScope.localChangedFileCount, 8);
  assert.equal(report.blockThemeTemplatesScope.remoteChangedTemplateDriftFailsClosed, true);
  assert.equal(report.blockThemeTemplatesScope.plannerMutationsRequireLiveRemotePreconditions, true);
  assert.equal(report.releaseVerifierTarget.requiredCommand, 'npm run verify:release');
  assert.equal(report.releaseVerifierTarget.topologyCommand, 'npm run verify:release:docker-local-production');
  assert.equal(report.releaseVerifierTarget.observedPassingRun, false);
  assert.equal(report.releaseVerifierTarget.packagedFallbackObserved, false);
  assert.equal(report.releaseVerifierTarget.finalReleaseStatus, 'NO-GO');
  assert.deepEqual(report.unavailableCapability, exactUnavailableCapability);
  assert.equal(report.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(report.evidenceLimits.rawTemplateBodiesIncluded, false);
  assert.equal(report.evidenceLimits.rawThemeJsonBodiesIncluded, false);
  assert.equal(report.evidenceLimits.rawOptionRowPayloadsIncluded, false);
  assert.equal(report.evidenceLimits.rawUrlValuesIncluded, false);
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.match(report.scopeEvidenceHash, sha256Pattern);
  assert.equal(report.scopeEvidenceHash, digest(scopeEvidenceInput(report)));
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /rpp-0847-(?:source|local|remote|application-password)/i);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, { label: 'RPP-0847 support report' }));
});

test('RPP-0847 evidence validator rejects production claims and fallback ambiguity', () => {
  const { report } = loadEvidenceReport();

  const productionClaim = structuredClone(report);
  productionClaim.productionBacked = true;
  productionClaim.releaseEligible = true;
  productionClaim.finalReleaseStatus = 'GO';
  productionClaim.successContract.finalReleaseMayMove = true;
  assertFailure(validateSupportReport(productionClaim), 'RPP_0847_SUPPORT_ONLY_NO_GO_REQUIRED');

  const fallbackClaim = structuredClone(report);
  fallbackClaim.releaseVerifierTarget.packagedFallbackObserved = true;
  fallbackClaim.evidenceLimits.packagedFallbackSurfaceCount = 1;
  assertFailure(validateSupportReport(fallbackClaim), 'RPP_0847_PACKAGED_FALLBACK_REJECTED');

  const missingCapability = structuredClone(report);
  missingCapability.successContract.exactUnavailableCapabilityRecorded = false;
  missingCapability.unavailableCapability.code = '';
  assertFailure(validateSupportReport(missingCapability), 'RPP_0847_UNAVAILABLE_CAPABILITY_NOT_EXACT');
});

function buildBlockThemeTemplatesProof({ env, now = fixedNow } = {}) {
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
  const templatePartAreas = templatePartAreasFromThemeJson(sourceSnapshot);
  const templatePartAreasDeclared = sameStringSet(
    templatePartAreas.map((entry) => `${entry.slug}:${entry.area}`),
    [
      'header:header',
      'footer:footer',
      'sidebar:uncategorized',
      'comments:uncategorized',
    ],
  );
  const themeJsonCustomTemplatesDeclared = sameStringSet(customTemplateSlugs, ['landing', 'wide']);
  const templateAndPartPathsNotNested = allBlockThemeFiles
    .filter((entry) => entry.kind === 'block-theme-template' || entry.kind === 'block-theme-template-part')
    .every((entry) =>
      /^wp-content\/themes\/[^/]+\/templates\/[^/]+\.html$/.test(entry.path)
        || /^wp-content\/themes\/[^/]+\/parts\/[^/]+\.html$/.test(entry.path));
  const readyTemplateMutations = summarizeTemplateMutations(readyPlan, allScopedFileKeys);
  const remoteChangedTemplateConflicts = summarizeTemplateConflicts(remoteChangedPlan, allScopedFileKeys);
  const topologyOk = topologyProof.ok === true;
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
    templatePartAreas,
    localChangedFileKeys,
    remoteChangedFileKeys,
    scopeCounts,
  };
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
    readyPlanCoversLocalBlockThemeTemplates: sameStringSet(
      readyTemplateMutations.map((mutation) => mutation.resourceKey),
      localChangedFileKeys,
    ),
    everyTemplateMutationHasLiveRemotePrecondition: readyTemplateMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote' && sha256Pattern.test(mutation.remoteBeforeHash)),
    remoteChangedTemplateDriftFailsClosed: remoteChangedPlan.status === 'conflict'
      && remoteChangedTemplateConflicts.some((conflict) => conflict.resourceKey === `file:${themeRoot}/templates/home.html`),
    exactUnavailableCapabilityRecorded: exactUnavailableCapability.code === 'DOCKER_CLI_MISSING',
    hashOnlyThemeEvidence: true,
    supportOnlyNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0847',
    proofId,
    variant: 3,
    checkedAt: now.toISOString(),
    status: passed ? 'passed' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      rppId: 'RPP-0803',
      variant: externalWordPressTopologyVariant,
      adjacentEvidence: 'RPP-0827 block theme templates variant 2',
      productionTopologyEvidence: [
        'RPP-0841 three-site local production topology v3',
        'RPP-0842 Docker WordPress topology v3',
        'RPP-0843 external WordPress topology v3',
      ],
      contract: 'source/local/changed URL capture with variant 3 block theme template scope',
      status: topologyProof.status,
    },
    topology: {
      sourceUrl: exposeAcceptedUrl(topologyProof.urlCapture.source, topologyOk),
      localUrl: exposeAcceptedUrl(topologyProof.urlCapture.localEdited, topologyOk),
      remoteChangedUrl: exposeAcceptedUrl(topologyProof.urlCapture.remoteChanged, topologyOk),
      sourceIdentityHash: topologyProof.urlCapture.source.identityHash,
      localIdentityHash: topologyProof.urlCapture.localEdited.identityHash,
      remoteChangedIdentityHash: topologyProof.urlCapture.remoteChanged.identityHash,
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured,
      sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
      identityChecked: topologyOk && topologyProof.rppEvidence.identityChecked === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
      remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
      noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
      noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok,
      localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
      networkProbePerformed: topologyProof.constraints.networkProbePerformed,
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
      templatePartAreas,
      templatePartAreasDeclared,
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
    productionTopologyEvidence: {
      requiredCommand: 'npm run verify:release',
      topologyCommand: 'npm run verify:release:docker-local-production',
      successTarget: 'verify-release-passes-without-packaged-fallback-on-block-theme-topology',
      verifyReleasePassedWithoutPackagedFallback: false,
      productionTopologyAvailable: false,
      exactUnavailableCapabilityRecorded: true,
      unavailableCapability: exactUnavailableCapability,
      packagedFallbackAllowed: false,
      packagedFallbackObserved: topologyProof.identityChecks.packagedFallbackDisabled.ok !== true,
      releaseMovement: 'none',
    },
    invariants,
    failures: topologyProof.failures.map((failure) => ({
      code: failure.code,
      role: failure.role || '',
      envKey: failure.envKey || '',
    })),
  };

  return {
    ...proofCore,
    outputHash: `sha256:${digest(proofCore)}`,
  };
}

function blockThemeSite(role) {
  const files = {
    [`${themeRoot}/theme.json`]: themeJsonForRole('source'),
    [`${themeRoot}/templates/index.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0847-source-index-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/home.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0847-source-home-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"sidebar","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/archive.html`]: [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:query --><main>rpp-0847-source-archive-private</main><!-- /wp:query -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n'),
    [`${themeRoot}/templates/page.html`]: '<!-- wp:group --><main>rpp-0847-source-page-private</main><!-- /wp:group -->',
    [`${themeRoot}/parts/header.html`]: '<!-- wp:group --><header>RPP 0847 source header</header><!-- /wp:group -->',
    [`${themeRoot}/parts/footer.html`]: '<!-- wp:group --><footer>RPP 0847 source footer</footer><!-- /wp:group -->',
    [`${themeRoot}/parts/sidebar.html`]: '<!-- wp:group --><aside>RPP 0847 source sidebar</aside><!-- /wp:group -->',
    [`${themeRoot}/parts/comments.html`]: '<!-- wp:comments --><section>RPP 0847 source comments</section><!-- /wp:comments -->',
    [`${themeRoot}/patterns/landing-section.php`]: '<?php /* Title: RPP 0847 Landing Section */ ?>',
    [`${themeRoot}/patterns/query-card.php`]: '<?php /* Title: RPP 0847 Query Card */ ?>',
    [`${themeRoot}/styles/high-contrast.json`]: JSON.stringify({
      version: 3,
      title: 'RPP 0847 High Contrast',
      styles: { color: { text: '#111111' } },
    }),
    [`${themeRoot}/styles/large-print.json`]: JSON.stringify({
      version: 3,
      title: 'RPP 0847 Large Print',
      settings: { typography: { fontSizes: [{ slug: 'large', size: '1.5rem', name: 'Large' }] } },
    }),
  };

  if (role === 'localEdited') {
    files[`${themeRoot}/theme.json`] = themeJsonForRole('localEdited');
    files[`${themeRoot}/templates/index.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0847-local-index-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
    files[`${themeRoot}/templates/home.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0847-local-home-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"sidebar","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
    files[`${themeRoot}/templates/search.html`] = '<!-- wp:group --><main>rpp-0847-local-search-private</main><!-- /wp:group -->';
    files[`${themeRoot}/parts/header.html`] = '<!-- wp:group --><header>rpp-0847-local-header-private</header><!-- /wp:group -->';
    files[`${themeRoot}/parts/sidebar.html`] = '<!-- wp:group --><aside>rpp-0847-local-sidebar-private</aside><!-- /wp:group -->';
    files[`${themeRoot}/styles/high-contrast.json`] = JSON.stringify({
      version: 3,
      title: 'RPP 0847 High Contrast',
      styles: { color: { text: '#222222' } },
      customTemplates: ['rpp-0847-local-style-private'],
    });
    files[`${themeRoot}/styles/large-print.json`] = JSON.stringify({
      version: 3,
      title: 'RPP 0847 Large Print',
      settings: { typography: { fontSizes: [{ slug: 'large', size: '1.75rem', name: 'Large' }] } },
    });
  }

  if (role === 'remoteChanged') {
    files[`${themeRoot}/templates/home.html`] = [
      '<!-- wp:template-part {"slug":"header","area":"header"} /-->',
      '<!-- wp:group --><main>rpp-0847-remote-home-private</main><!-- /wp:group -->',
      '<!-- wp:template-part {"slug":"sidebar","area":"uncategorized"} /-->',
      '<!-- wp:template-part {"slug":"footer","area":"footer"} /-->',
    ].join('\n');
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
    title: 'RPP 0847 Block V3',
    settings: {
      layout: { contentSize: '780px', wideSize: '1200px' },
      spacing: { units: ['px', 'rem', 'vh'] },
    },
    styles: {
      spacing: { blockGap: role === 'localEdited' ? '2rem' : '1.25rem' },
    },
    customTemplates: [
      { name: 'landing', title: 'Landing', postTypes: ['page'] },
      { name: 'wide', title: 'Wide', postTypes: ['page', 'post'] },
    ],
    templateParts: [
      { name: 'header', area: 'header' },
      { name: 'footer', area: 'footer' },
      { name: 'sidebar', area: 'uncategorized' },
      { name: 'comments', area: 'uncategorized' },
    ],
  };
  return JSON.stringify(base);
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
    && parsed.customTemplates.length === 2
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

function templatePartAreasFromThemeJson(site) {
  const parsed = parseThemeJson(site);
  return [...(parsed?.templateParts || [])]
    .map((entry) => ({ slug: entry.name, area: entry.area }));
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

function exposeAcceptedUrl(captured, topologyOk) {
  return topologyOk && captured?.valid === true ? captured.normalizedUrl : '';
}

function countScopedKind(files, kind) {
  return files.filter((entry) => entry.kind === kind).length;
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0847 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function validateSupportReport(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0847'
    || report.proofId !== proofId
    || report.variant !== 3
    || report.coverageMode !== 'generated-local-support-only') {
    failures.push({ code: 'RPP_0847_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.successContract?.finalReleaseMayMove !== false) {
    failures.push({ code: 'RPP_0847_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.criterion !== 'verify-release-passes-without-packaged-fallback-on-block-theme-topology'
    || report.successContract?.verifyReleasePassedWithoutPackagedFallback !== false
    || report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'RPP_0847_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.unavailableCapability?.code !== 'DOCKER_CLI_MISSING'
    || report.unavailableCapability?.capability !== 'docker-cli'
    || report.unavailableCapability?.command !== 'docker --version'
    || report.unavailableCapability?.observedExitCode !== 127
    || report.unavailableCapability?.missingExecutable !== true) {
    failures.push({ code: 'RPP_0847_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
  }
  if (report.blockThemeTemplatesScope?.themeRoot !== themeRoot
    || report.blockThemeTemplatesScope?.templateFileCount !== 5
    || report.blockThemeTemplatesScope?.templatePartFileCount !== 4
    || report.blockThemeTemplatesScope?.patternFileCount !== 2
    || report.blockThemeTemplatesScope?.styleVariationFileCount !== 2
    || report.blockThemeTemplatesScope?.localChangedFileCount !== expectedLocalChangedFileKeys.length) {
    failures.push({ code: 'RPP_0847_BLOCK_THEME_SCOPE_MISMATCH' });
  }
  if (report.blockThemeTemplatesScope?.themeJsonValidated !== true
    || report.blockThemeTemplatesScope?.themeJsonCustomTemplatesDeclared !== true
    || report.blockThemeTemplatesScope?.templateAndPartPathsNotNested !== true
    || report.blockThemeTemplatesScope?.templatePartAreasDeclared !== true
    || report.blockThemeTemplatesScope?.remoteChangedTemplateDriftFailsClosed !== true
    || report.blockThemeTemplatesScope?.plannerMutationsRequireLiveRemotePreconditions !== true) {
    failures.push({ code: 'RPP_0847_BLOCK_THEME_INVARIANT_FAILED' });
  }
  if (report.releaseVerifierTarget?.requiredCommand !== 'npm run verify:release'
    || report.releaseVerifierTarget?.topologyCommand !== 'npm run verify:release:docker-local-production'
    || report.releaseVerifierTarget?.observedPassingRun !== false
    || report.releaseVerifierTarget?.packagedFallbackObserved !== false
    || report.releaseVerifierTarget?.packagedFallbackAllowed !== false
    || report.releaseVerifierTarget?.finalReleaseStatus !== 'NO-GO') {
    failures.push({ code: 'RPP_0847_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.rawTemplateBodiesIncluded !== false
    || report.evidenceLimits?.rawThemeJsonBodiesIncluded !== false
    || report.evidenceLimits?.rawOptionRowPayloadsIncluded !== false
    || report.evidenceLimits?.rawUrlValuesIncluded !== false
    || report.evidenceLimits?.packagedFallbackSurfaceCount !== 0) {
    failures.push({ code: 'RPP_0847_EVIDENCE_LIMITS_FAILED' });
  }
  if (report.scopeEvidenceHash !== digest(scopeEvidenceInput(report))) {
    failures.push({ code: 'RPP_0847_SCOPE_HASH_MISMATCH' });
  }
  const redactionIssues = findEvidenceRedactionIssues(report);
  if (redactionIssues.length > 0) {
    failures.push({ code: 'RPP_0847_RAW_EVIDENCE_REJECTED', issues: redactionIssues });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function scopeEvidenceInput(report) {
  return {
    successContract: report.successContract,
    blockThemeTemplatesScope: report.blockThemeTemplatesScope,
    releaseVerifierTarget: report.releaseVerifierTarget,
    unavailableCapability: report.unavailableCapability,
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

function assertFailure(result, expectedCode) {
  assert.equal(result.ok, false, `expected ${expectedCode} failure`);
  assert.ok(
    result.failures.some((failure) => failure.code === expectedCode),
    `expected ${expectedCode}, got ${JSON.stringify(result.failures)}`,
  );
}
