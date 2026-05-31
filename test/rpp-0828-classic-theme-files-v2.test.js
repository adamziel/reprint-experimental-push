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
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0828-classic-theme-files-v2.md',
);

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0828-classic-theme-files-v2';
const themeSlug = 'rpp-0828-classic-v2';
const themeRoot = `wp-content/themes/${themeSlug}`;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;
const requiredRoleOrder = Object.freeze(['source', 'localEdited', 'remoteChanged']);
const requiredSurfaceOrder = Object.freeze(['stylesheet', 'functions', 'template', 'asset']);

const classicThemeSurfaceFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/style.css`, surface: 'stylesheet', kind: 'classic-theme-stylesheet-header', required: true }),
  Object.freeze({ path: `${themeRoot}/functions.php`, surface: 'functions', kind: 'classic-theme-functions-bootstrap', required: false }),
  Object.freeze({ path: `${themeRoot}/index.php`, surface: 'template', kind: 'classic-theme-template-entry', required: true }),
  Object.freeze({ path: `${themeRoot}/front-page.php`, surface: 'template', kind: 'classic-theme-template-entry', required: false }),
  Object.freeze({ path: `${themeRoot}/page.php`, surface: 'template', kind: 'classic-theme-template', required: false }),
  Object.freeze({ path: `${themeRoot}/header.php`, surface: 'template', kind: 'classic-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/footer.php`, surface: 'template', kind: 'classic-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/screenshot.png`, surface: 'asset', kind: 'classic-theme-preview-asset', required: false }),
  Object.freeze({ path: `${themeRoot}/assets/classic-v2.css`, surface: 'asset', kind: 'classic-theme-static-asset', required: false }),
  Object.freeze({ path: `${themeRoot}/assets/logo.svg`, surface: 'asset', kind: 'classic-theme-static-asset', required: false }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/classic-theme-v2',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test:443/classic-theme-v2/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/classic-theme-v2',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/classic-theme-v2',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/classic-theme-v2/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/classic-theme-v2',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/classic-theme-v2',
  REPRINT_PUSH_JOURNAL_ROUTE_SOURCE_URL: 'https://source.example.test/classic-theme-v2',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/classic-theme-v2',
  REPRINT_PUSH_USERNAME: 'rpp-0828-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0828-application-password-must-not-leak',
});

const badEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0828-secret@source.example.test/classic-theme-v2',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/classic-theme-v2?token=rpp0828-token',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/classic-theme-v2',
  REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
});

const forbiddenProofNeedles = Object.freeze([
  'https://source.example.test',
  'https://local.example.test',
  'https://changed.example.test',
  'source.example.test',
  'local.example.test',
  'changed.example.test',
  'rpp-0828-admin',
  'rpp-0828-application-password-must-not-leak',
  'rpp-0828-source-style-private',
  'rpp-0828-local-style-private',
  'rpp-0828-local-functions-private',
  'rpp-0828-local-front-page-private',
  'rpp-0828-remote-style-private',
]);

if (process.env.RPP_0828_REPORT_JSON !== '1') {
  test('RPP-0828 captures source/local/changed role URLs and identity-checks classic theme file scope', () => {
    const proof = buildClassicThemeFilesV2Proof({ env: goodEnv });

    assert.equal(proof.schemaVersion, 1);
    assert.equal(proof.rppId, 'RPP-0828');
    assert.equal(proof.proofId, proofId);
    assert.equal(proof.variant, 2);
    assert.equal(proof.status, 'passed-support-only');
    assert.equal(proof.failClosed, false);
    assert.equal(proof.supportOnly, true);
    assert.equal(proof.productionBacked, false);
    assert.equal(proof.releaseEligible, false);
    assert.equal(proof.finalReleaseStatus, 'NO-GO');
    assert.equal(proof.integrationRecommendation, 'NO-GO');

    assert.equal(proof.builtOn.topologyContract.rppId, 'RPP-0803');
    assert.equal(proof.builtOn.topologyContract.variant, externalWordPressTopologyVariant);
    assert.equal(proof.builtOn.urlIdentityPattern.rppId, 'RPP-0808');
    assert.equal(proof.builtOn.urlIdentityPattern.variant, 1);
    assert.equal(proof.urlIdentity.sourceLocalChangedUrlsCaptured, true);
    assert.equal(proof.urlIdentity.capturedRoleUrlCount, 3);
    assert.equal(proof.urlIdentity.validRoleUrlCount, 3);
    assert.equal(proof.urlIdentity.identityHashCount, 3);
    assert.equal(proof.urlIdentity.roleIdentitiesDistinct, true);
    assert.equal(proof.urlIdentity.sourceAliasMatchesSource, true);
    assert.equal(proof.urlIdentity.sameSourceAcrossRoutes, true);
    assert.equal(proof.urlIdentity.identityChecked, true);
    assert.equal(proof.urlIdentity.noTunnelPolicyEnforced, true);
    assert.equal(proof.urlIdentity.noSecretShapedUrlParts, true);
    assert.equal(proof.urlIdentity.packagedFallbackDisabled, true);
    assert.equal(proof.urlIdentity.networkProbePerformed, false);
    assert.equal(proof.urlIdentity.rawUrlValuesIncluded, false);

    assert.deepEqual(
      proof.urlIdentity.roleUrlEvidence.map((entry) => entry.role),
      requiredRoleOrder,
    );
    for (const roleEvidence of proof.urlIdentity.roleUrlEvidence) {
      assert.equal(roleEvidence.captured, true);
      assert.equal(roleEvidence.valid, true);
      assert.match(roleEvidence.identityHash, sha256Pattern);
      assert.match(roleEvidence.originHash, sha256Pattern);
      assert.equal(roleEvidence.normalizedUrlStored, false);
      assert.equal(roleEvidence.hostStored, false);
      assert.equal(roleEvidence.rawUrlStored, false);
      assert.equal(roleEvidence.urlCharacterCount > 0, true);
    }
    assert.equal(new Set(Object.values(proof.urlIdentity.roleIdentityHashes)).size, 3);

    assert.equal(proof.classicTheme.themeType, 'classic');
    assert.equal(proof.classicTheme.themeSlug, themeSlug);
    assert.equal(proof.classicTheme.scopeRoot, themeRoot);
    assert.equal(proof.classicTheme.scopeAcceptedForReleaseTopology, true);
    assert.deepEqual(proof.classicTheme.requiredSurfaceNames, requiredSurfaceOrder);
    assert.deepEqual(proof.classicTheme.requiredFileKeys, [
      `file:${themeRoot}/style.css`,
      `file:${themeRoot}/index.php`,
    ]);
    assert.equal(proof.classicTheme.requiredFilesPresentInAllRoles, true);
    assert.equal(proof.classicTheme.styleCssHeaderCaptured, true);
    assert.equal(proof.classicTheme.activeThemeOptionRowsCaptured, true);

    assert.equal(proof.classicTheme.surfaceEvidence.format, 'hash-count-surface-only');
    assert.equal(proof.classicTheme.surfaceEvidence.rawFileContentsIncluded, false);
    assert.equal(proof.classicTheme.surfaceEvidence.totalScopedFileCount, 10);
    assert.deepEqual(proof.classicTheme.surfaceEvidence.surfaceNames, requiredSurfaceOrder);
    assert.deepEqual(proof.classicTheme.surfaceEvidence.surfaceCounts, {
      stylesheet: 1,
      functions: 1,
      template: 5,
      asset: 3,
    });
    assert.deepEqual(proof.classicTheme.surfaceEvidence.roleScopedFileCounts, {
      source: 9,
      localEdited: 10,
      remoteChanged: 9,
    });
    assert.match(proof.classicTheme.surfaceEvidence.fileScopeHash, sha256PrefixedPattern);
    assert.equal(proof.classicTheme.surfaceEvidence.surfaceHashes.length, 4);
    for (const surfaceHash of proof.classicTheme.surfaceEvidence.surfaceHashes) {
      assert.ok(requiredSurfaceOrder.includes(surfaceHash.surface));
      assert.equal(surfaceHash.fileCount > 0, true);
      assert.match(surfaceHash.sourceHash, sha256PrefixedPattern);
      assert.match(surfaceHash.localHash, sha256PrefixedPattern);
      assert.match(surfaceHash.remoteChangedHash, sha256PrefixedPattern);
    }

    assert.deepEqual(proof.classicTheme.localChangedFileKeys, [
      `file:${themeRoot}/assets/classic-v2.css`,
      `file:${themeRoot}/front-page.php`,
      `file:${themeRoot}/functions.php`,
      `file:${themeRoot}/page.php`,
      `file:${themeRoot}/style.css`,
    ]);
    assert.deepEqual(proof.classicTheme.remoteChangedFileKeys, [
      `file:${themeRoot}/style.css`,
    ]);
    assert.ok(proof.classicTheme.roleFileHashes.every((entry) =>
      sha256Pattern.test(entry.sourceHash)
        && sha256Pattern.test(entry.localHash)
        && sha256Pattern.test(entry.remoteChangedHash)
        && entry.rawFileContentsIncluded === false));

    assert.equal(proof.classicTheme.stylesheetEvidence.headerFieldCount, 3);
    assert.deepEqual(proof.classicTheme.stylesheetEvidence.headerFieldNames, [
      'Template',
      'Theme Name',
      'Version',
    ]);
    assert.match(proof.classicTheme.stylesheetEvidence.sourceHeaderHash, sha256PrefixedPattern);
    assert.match(proof.classicTheme.stylesheetEvidence.localHeaderHash, sha256PrefixedPattern);
    assert.match(proof.classicTheme.stylesheetEvidence.remoteChangedHeaderHash, sha256PrefixedPattern);
    assert.equal(proof.classicTheme.activeThemeOptions.rowCount, 2);
    assert.match(proof.classicTheme.activeThemeOptions.sourceRowsHash, sha256PrefixedPattern);

    assert.equal(proof.planner.ready.status, 'ready');
    assert.deepEqual(proof.planner.ready.themeMutationKeys, proof.classicTheme.localChangedFileKeys);
    assert.deepEqual(proof.planner.ready.themePreconditionKeys, proof.classicTheme.localChangedFileKeys);
    assert.ok(proof.planner.ready.themeMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote'
        && sha256Pattern.test(mutation.baseHash)
        && sha256Pattern.test(mutation.localHash)
        && sha256Pattern.test(mutation.remoteBeforeHash)
        && sha256PrefixedPattern.test(mutation.mutationHash)
        && sha256PrefixedPattern.test(mutation.preconditionHash)));
    assert.equal(proof.planner.remoteChanged.status, 'conflict');
    assert.deepEqual(proof.planner.remoteChanged.themeConflictKeys, [`file:${themeRoot}/style.css`]);

    assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
    assert.equal(proof.invariants.identityChecked, true);
    assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
    assert.equal(proof.invariants.classicThemeSurfaceScopeRecorded, true);
    assert.equal(proof.invariants.stylesheetFunctionsTemplateAssetSurfacesRecorded, true);
    assert.equal(proof.invariants.requiredClassicThemeFilesPresent, true);
    assert.equal(proof.invariants.readyPlanCoversLocalClassicThemeFiles, true);
    assert.equal(proof.invariants.everyThemeMutationHasLiveRemotePrecondition, true);
    assert.equal(proof.invariants.remoteChangedThemeDriftFailsClosed, true);
    assert.equal(proof.invariants.hashCountSurfaceOnlyEvidence, true);
    assert.equal(proof.invariants.releaseMovementNoGo, true);
    assert.match(proof.outputHash, sha256PrefixedPattern);

    assertNoNeedles(proof, forbiddenProofNeedles);
    assertNoRawUrls(proof);
    assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
      label: 'RPP-0828 classic theme files v2 proof',
    }));
  });

  test('RPP-0828 rejects tunnel and secret-shaped role URLs before accepting classic theme scope', () => {
    const proof = buildClassicThemeFilesV2Proof({ env: badEnv });

    assert.equal(proof.status, 'blocked');
    assert.equal(proof.failClosed, true);
    assert.equal(proof.releaseEligible, false);
    assert.equal(proof.finalReleaseStatus, 'NO-GO');
    assert.equal(proof.urlIdentity.sourceLocalChangedUrlsCaptured, true);
    assert.equal(proof.urlIdentity.identityChecked, false);
    assert.equal(proof.urlIdentity.noTunnelPolicyEnforced, false);
    assert.equal(proof.urlIdentity.noSecretShapedUrlParts, false);
    assert.equal(proof.urlIdentity.packagedFallbackDisabled, false);
    assert.equal(proof.classicTheme.scopeAcceptedForReleaseTopology, false);
    assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
    assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
    assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
    assertNoNeedles(proof, [
      'admin:rpp0828-secret',
      'rpp0828-secret',
      'token=rpp0828-token',
      'rpp0828-token',
      'changed.ngrok-free.app',
    ]);
    assertNoRawUrls(proof);
  });

  test('RPP-0828 classic theme files proof is deterministic and hash/count/surface-only', () => {
    const firstProof = buildClassicThemeFilesV2Proof({ env: goodEnv });
    const secondProof = buildClassicThemeFilesV2Proof({ env: { ...goodEnv } });

    assert.equal(firstProof.outputHash, secondProof.outputHash);
    assert.deepEqual(firstProof.urlIdentity.roleUrlEvidence, secondProof.urlIdentity.roleUrlEvidence);
    assert.deepEqual(firstProof.classicTheme.surfaceEvidence, secondProof.classicTheme.surfaceEvidence);
    assert.deepEqual(firstProof.classicTheme.roleFileHashes, secondProof.classicTheme.roleFileHashes);
    assert.deepEqual(firstProof.planner.ready.themeMutations, secondProof.planner.ready.themeMutations);
    assert.deepEqual(firstProof.planner.remoteChanged.themeConflicts, secondProof.planner.remoteChanged.themeConflicts);
    assertNoNeedles(firstProof, forbiddenProofNeedles);
    assertNoNeedles(secondProof, forbiddenProofNeedles);
    assertNoRawUrls(firstProof);
    assertNoRawUrls(secondProof);
  });

  test('RPP-0828 evidence document records the same NO-GO hash/count/surface scope', () => {
    const { report, text } = loadEvidenceReport();
    const expectedReport = buildEvidenceReport();

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.rppId, 'RPP-0828');
    assert.equal(report.variant, 2);
    assert.equal(report.status, 'passed-support-only');
    assert.equal(report.supportOnly, true);
    assert.equal(report.productionBacked, false);
    assert.equal(report.releaseEligible, false);
    assert.equal(report.integrationRecommendation, 'NO-GO');
    assert.deepEqual(report.builtOn, expectedReport.builtOn);
    assert.deepEqual(report.urlIdentityScope, expectedReport.urlIdentityScope);
    assert.deepEqual(report.classicThemeScope, expectedReport.classicThemeScope);
    assert.deepEqual(report.plannerScope, expectedReport.plannerScope);
    assert.deepEqual(report.negativeControls, expectedReport.negativeControls);
    assert.deepEqual(report.releaseScope, expectedReport.releaseScope);
    assert.deepEqual(report.redaction, expectedReport.redaction);
    assert.match(report.scopeEvidenceHash, sha256Pattern);
    assert.equal(report.scopeEvidenceHash, digest(scopeEvidenceInput(report)));
    assert.deepEqual(findEvidenceRedactionIssues(report), []);
    assertNoRawUrls(report);
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.doesNotMatch(text, /source\.example|local\.example|changed\.example|ngrok|token=|admin:/i);
  });
}

function buildClassicThemeFilesV2Proof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now, scope: proofId });
  const sourceSnapshot = classicThemeSite('source');
  const localSnapshot = classicThemeSite('localEdited');
  const remoteChangedSnapshot = classicThemeSite('remoteChanged');
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
  const scopedFileKeys = new Set(classicThemeSurfaceFiles.map((entry) => `file:${entry.path}`));
  const localChangedFileKeys = changedFileKeys(sourceSnapshot, localSnapshot, scopedFileKeys);
  const remoteChangedFileKeys = changedFileKeys(sourceSnapshot, remoteChangedSnapshot, scopedFileKeys);
  const requiredFilesPresentInAllRoles = classicThemeSurfaceFiles
    .filter((entry) => entry.required)
    .every((entry) => [sourceSnapshot, localSnapshot, remoteChangedSnapshot].every((site) =>
      Object.hasOwn(site.files, entry.path)));
  const readyThemeMutations = summarizeThemeMutations(readyPlan, scopedFileKeys);
  const remoteChangedThemeConflicts = summarizeThemeConflicts(remoteChangedPlan, scopedFileKeys);
  const roleUrlEvidence = requiredRoleOrder.map((role) =>
    summarizeRoleUrl(topologyProof.urlCapture[role]));
  const roleIdentityHashes = Object.fromEntries(roleUrlEvidence.map((entry) => [
    entry.role,
    entry.identityHash,
  ]));
  const topologyOk = topologyProof.ok === true;
  const sourceAliasAndRoutesMatch = topologyProof.identityChecks.remoteAliasMatchesSource.ok === true
    && topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true;
  const roleIdentitiesDistinct = topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok === true;
  const identityChecked = topologyOk && topologyProof.rppEvidence.identityChecked === true;
  const surfaceEvidence = buildSurfaceEvidence({
    source: sourceSnapshot,
    localEdited: localSnapshot,
    remoteChanged: remoteChangedSnapshot,
  });
  const stylesheetEvidence = buildStylesheetEvidence({
    source: sourceSnapshot,
    localEdited: localSnapshot,
    remoteChanged: remoteChangedSnapshot,
  });
  const activeThemeOptions = buildActiveThemeOptionEvidence({
    source: sourceSnapshot,
    localEdited: localSnapshot,
    remoteChanged: remoteChangedSnapshot,
  });
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    identityChecked,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.identityChecks.noTunnelHosts.ok === true,
    noSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
    classicThemeSurfaceScopeRecorded: classicThemeSurfaceFiles.every((entry) =>
      entry.path.startsWith(`${themeRoot}/`) && requiredSurfaceOrder.includes(entry.surface)),
    stylesheetFunctionsTemplateAssetSurfacesRecorded: sameStringSet(
      surfaceEvidence.surfaceNames,
      requiredSurfaceOrder,
    ),
    requiredClassicThemeFilesPresent: requiredFilesPresentInAllRoles,
    readyPlanCoversLocalClassicThemeFiles: sameStringSet(
      readyThemeMutations.map((mutation) => mutation.resourceKey),
      localChangedFileKeys,
    ),
    everyThemeMutationHasLiveRemotePrecondition: readyThemeMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote' && sha256Pattern.test(mutation.remoteBeforeHash)),
    remoteChangedThemeDriftFailsClosed: remoteChangedPlan.status === 'conflict'
      && remoteChangedThemeConflicts.some((conflict) => conflict.resourceKey === `file:${themeRoot}/style.css`),
    hashCountSurfaceOnlyEvidence: surfaceEvidence.rawFileContentsIncluded === false
      && roleUrlEvidence.every((entry) => entry.rawUrlStored === false && entry.hostStored === false),
    releaseMovementNoGo: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0828',
    proofId,
    variant: 2,
    checkedAt: now.toISOString(),
    status: passed ? 'passed-support-only' : 'blocked',
    failClosed: !passed,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      topologyContract: {
        rppId: 'RPP-0803',
        variant: externalWordPressTopologyVariant,
        sourceLocalChangedUrlCapture: true,
        staticIdentityChecks: true,
        tunnelAndSecretUrlRejection: true,
      },
      urlIdentityPattern: {
        rppId: 'RPP-0808',
        variant: 1,
        roleIdentities: ['source', 'local-edited', 'remote-changed'],
        identityHashOnly: true,
        sameSourceAcrossRoutesRequired: true,
      },
      classicThemePattern: {
        rppId: 'RPP-0808',
        variant: 1,
        fileScopeContract: 'classic-theme-style-functions-template-asset-scope',
      },
    },
    urlIdentity: {
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
      capturedRoleUrlCount: roleUrlEvidence.filter((entry) => entry.captured).length,
      validRoleUrlCount: roleUrlEvidence.filter((entry) => entry.valid).length,
      identityHashCount: roleUrlEvidence.filter((entry) => sha256Pattern.test(entry.identityHash)).length,
      roleUrlEvidence,
      roleIdentityHashes,
      roleIdentitiesDistinct,
      sourceAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok === true,
      sourceAliasAndRoutesMatch,
      identityChecked,
      noTunnelPolicyEnforced: topologyProof.identityChecks.noTunnelHosts.ok === true,
      noSecretShapedUrlParts: topologyProof.identityChecks.noUrlSecrets.ok === true,
      localLoopbackIngressOnly8080: topologyProof.identityChecks.localLoopbackIngress.ok === true,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok === true,
      networkProbePerformed: false,
      rawUrlValuesIncluded: false,
      routeSourceRawValuesIncluded: false,
      releaseMovement: 'none',
    },
    classicTheme: {
      themeType: 'classic',
      themeSlug,
      scopeRoot: themeRoot,
      scopeAcceptedForReleaseTopology: topologyOk,
      requiredSurfaceNames: [...requiredSurfaceOrder],
      fileScope: classicThemeSurfaceFiles.map((entry) => ({
        path: entry.path,
        resourceKey: `file:${entry.path}`,
        surface: entry.surface,
        kind: entry.kind,
        required: entry.required,
      })),
      requiredFileKeys: classicThemeSurfaceFiles
        .filter((entry) => entry.required)
        .map((entry) => `file:${entry.path}`),
      requiredFilesPresentInAllRoles,
      styleCssHeaderCaptured: stylesheetEvidence.headerCaptured,
      activeThemeOptionRowsCaptured: activeThemeOptions.rowsCaptured,
      surfaceEvidence,
      stylesheetEvidence,
      activeThemeOptions,
      localChangedFileKeys,
      remoteChangedFileKeys,
      roleFileHashes: classicThemeSurfaceFiles.map((entry) => ({
        resourceKey: `file:${entry.path}`,
        surface: entry.surface,
        kind: entry.kind,
        required: entry.required,
        sourcePresent: Object.hasOwn(sourceSnapshot.files, entry.path),
        localPresent: Object.hasOwn(localSnapshot.files, entry.path),
        remoteChangedPresent: Object.hasOwn(remoteChangedSnapshot.files, entry.path),
        sourceHash: fileHash(sourceSnapshot, entry.path),
        localHash: fileHash(localSnapshot, entry.path),
        remoteChangedHash: fileHash(remoteChangedSnapshot, entry.path),
        rawFileContentsIncluded: false,
      })),
    },
    planner: {
      ready: {
        status: readyPlan.status,
        summary: readyPlan.summary,
        themeMutationKeys: readyThemeMutations.map((mutation) => mutation.resourceKey).sort(),
        themePreconditionKeys: readyThemeMutations.map((mutation) => mutation.resourceKey).sort(),
        themeMutations: readyThemeMutations,
        planHash: `sha256:${digest(summarizePlanForHash(readyPlan))}`,
      },
      remoteChanged: {
        status: remoteChangedPlan.status,
        summary: remoteChangedPlan.summary,
        themeConflictKeys: remoteChangedThemeConflicts.map((conflict) => conflict.resourceKey).sort(),
        themeConflicts: remoteChangedThemeConflicts,
        planHash: `sha256:${digest(summarizePlanForHash(remoteChangedPlan))}`,
      },
    },
    redaction: {
      format: 'hash-count-surface-only',
      rawUrlValuesIncluded: false,
      rawHostValuesIncluded: false,
      rawFileContentsIncluded: false,
      credentialMaterialIncluded: false,
      routeSourceRawValuesIncluded: false,
    },
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
  const proof = buildClassicThemeFilesV2Proof({ env: goodEnv });
  const negativeProof = buildClassicThemeFilesV2Proof({ env: badEnv });
  const reportCore = {
    schemaVersion: 1,
    rppId: 'RPP-0828',
    variant: 2,
    title: 'Classic theme files v2 support scope',
    status: proof.status,
    supportOnly: proof.supportOnly,
    productionBacked: proof.productionBacked,
    releaseEligible: proof.releaseEligible,
    integrationRecommendation: proof.integrationRecommendation,
    builtOn: proof.builtOn,
    urlIdentityScope: {
      sourceLocalChangedRoleUrlsCaptured: proof.urlIdentity.sourceLocalChangedUrlsCaptured,
      roleSurfaces: ['source', 'local-edited', 'remote-changed'],
      capturedRoleUrlCount: proof.urlIdentity.capturedRoleUrlCount,
      validRoleUrlCount: proof.urlIdentity.validRoleUrlCount,
      identityHashCount: proof.urlIdentity.identityHashCount,
      roleIdentityHashes: proof.urlIdentity.roleIdentityHashes,
      roleIdentitiesDistinct: proof.urlIdentity.roleIdentitiesDistinct,
      sourceAliasMatchesSource: proof.urlIdentity.sourceAliasMatchesSource,
      sameSourceAcrossRoutes: proof.urlIdentity.sameSourceAcrossRoutes,
      identityChecked: proof.urlIdentity.identityChecked,
      noTunnelPolicyEnforced: proof.urlIdentity.noTunnelPolicyEnforced,
      noSecretShapedUrlParts: proof.urlIdentity.noSecretShapedUrlParts,
      packagedFallbackDisabled: proof.urlIdentity.packagedFallbackDisabled,
      networkProbePerformed: proof.urlIdentity.networkProbePerformed,
      rawUrlValuesIncluded: false,
      releaseMovement: 'none',
    },
    classicThemeScope: {
      status: 'support-only-classic-theme-file-scope',
      themeType: proof.classicTheme.themeType,
      scopeRoot: proof.classicTheme.scopeRoot,
      surfaceNames: proof.classicTheme.surfaceEvidence.surfaceNames,
      totalScopedFileCount: proof.classicTheme.surfaceEvidence.totalScopedFileCount,
      requiredFileCount: proof.classicTheme.requiredFileKeys.length,
      roleScopedFileCounts: proof.classicTheme.surfaceEvidence.roleScopedFileCounts,
      surfaceCounts: proof.classicTheme.surfaceEvidence.surfaceCounts,
      fileScopeHash: proof.classicTheme.surfaceEvidence.fileScopeHash,
      stylesheetHeaderFieldCount: proof.classicTheme.stylesheetEvidence.headerFieldCount,
      stylesheetHeaderHashCount: [
        proof.classicTheme.stylesheetEvidence.sourceHeaderHash,
        proof.classicTheme.stylesheetEvidence.localHeaderHash,
        proof.classicTheme.stylesheetEvidence.remoteChangedHeaderHash,
      ].filter((hash) => sha256PrefixedPattern.test(hash)).length,
      activeThemeOptionRowCount: proof.classicTheme.activeThemeOptions.rowCount,
      activeThemeOptionRowsHashCount: [
        proof.classicTheme.activeThemeOptions.sourceRowsHash,
        proof.classicTheme.activeThemeOptions.localRowsHash,
        proof.classicTheme.activeThemeOptions.remoteChangedRowsHash,
      ].filter((hash) => sha256PrefixedPattern.test(hash)).length,
      surfaceHashes: proof.classicTheme.surfaceEvidence.surfaceHashes,
      localChangedFileCount: proof.classicTheme.localChangedFileKeys.length,
      remoteChangedFileCount: proof.classicTheme.remoteChangedFileKeys.length,
      requiredClassicThemeFilesPresent: proof.classicTheme.requiredFilesPresentInAllRoles,
      rawFileContentsIncluded: false,
    },
    plannerScope: {
      readyPlanStatus: proof.planner.ready.status,
      readyThemeMutationCount: proof.planner.ready.themeMutationKeys.length,
      readyThemePreconditionCount: proof.planner.ready.themePreconditionKeys.length,
      readyPlanHash: proof.planner.ready.planHash,
      remoteChangedPlanStatus: proof.planner.remoteChanged.status,
      remoteChangedThemeConflictCount: proof.planner.remoteChanged.themeConflictKeys.length,
      remoteChangedPlanHash: proof.planner.remoteChanged.planHash,
      remoteChangedThemeDriftFailsClosed: proof.invariants.remoteChangedThemeDriftFailsClosed,
      everyThemeMutationHasLiveRemotePrecondition: proof.invariants.everyThemeMutationHasLiveRemotePrecondition,
    },
    negativeControls: {
      tunnelUrlRejected: negativeProof.failures.some((failure) =>
        failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'),
      secretShapedUrlRejected: negativeProof.failures.some((failure) =>
        failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'),
      packagedFallbackRejected: negativeProof.failures.some((failure) =>
        failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'),
      classicThemeScopeAcceptedAfterRejectedTopology: false,
      rawRejectedInputsStored: false,
    },
    releaseScope: {
      finalReleaseStatus: proof.finalReleaseStatus,
      releaseGateMovement: 'none',
      readyForReleaseMovement: false,
      blockers: [
        'support-only-local-url-identity-proof',
        'support-only-classic-theme-file-scope-proof',
        'no-production-backed-wordpress-reachability',
        'no-route-receipts-or-live-mutation-receipts',
      ],
    },
    redaction: proof.redaction,
  };

  return {
    ...reportCore,
    scopeEvidenceHash: digest(scopeEvidenceInput(reportCore)),
  };
}

function classicThemeSite(role) {
  const files = {
    [`${themeRoot}/style.css`]: [
      '/*',
      'Theme Name: RPP 0828 Classic V2',
      'Template: none',
      'Version: 2.0.0',
      '*/',
      'body { --rpp-source-marker: "rpp-0828-source-style-private"; }',
    ].join('\n'),
    [`${themeRoot}/functions.php`]: '<?php function rpp_0828_classic_source() { return "source"; }',
    [`${themeRoot}/index.php`]: '<?php echo "RPP 0828 source index";',
    [`${themeRoot}/page.php`]: '<?php echo "RPP 0828 source page";',
    [`${themeRoot}/header.php`]: '<?php ?><header>RPP 0828 source header</header>',
    [`${themeRoot}/footer.php`]: '<?php ?><footer>RPP 0828 source footer</footer>',
    [`${themeRoot}/screenshot.png`]: 'rpp-0828-source-screenshot-bytes',
    [`${themeRoot}/assets/classic-v2.css`]: '.rpp-0828-source { display: block; }',
    [`${themeRoot}/assets/logo.svg`]: '<svg><title>RPP 0828 source logo</title></svg>',
  };

  if (role === 'localEdited') {
    files[`${themeRoot}/style.css`] = [
      '/*',
      'Theme Name: RPP 0828 Classic V2',
      'Template: none',
      'Version: 2.0.1-local',
      '*/',
      'body { --rpp-local-marker: "rpp-0828-local-style-private"; }',
    ].join('\n');
    files[`${themeRoot}/functions.php`] = '<?php function rpp_0828_classic_local() { return "rpp-0828-local-functions-private"; }';
    files[`${themeRoot}/front-page.php`] = '<?php echo "rpp-0828-local-front-page-private";';
    files[`${themeRoot}/page.php`] = '<?php echo "RPP 0828 local page";';
    files[`${themeRoot}/assets/classic-v2.css`] = '.rpp-0828-local { display: grid; }';
  }

  if (role === 'remoteChanged') {
    files[`${themeRoot}/style.css`] = [
      '/*',
      'Theme Name: RPP 0828 Classic V2',
      'Template: none',
      'Version: 2.0.1-remote',
      '*/',
      'body { --rpp-remote-marker: "rpp-0828-remote-style-private"; }',
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

function buildSurfaceEvidence(sites) {
  const fileScope = classicThemeSurfaceFiles.map((entry) => ({
    resourceKey: `file:${entry.path}`,
    path: entry.path,
    surface: entry.surface,
    kind: entry.kind,
    required: entry.required,
  }));
  const surfaceCounts = Object.fromEntries(requiredSurfaceOrder.map((surface) => [
    surface,
    fileScope.filter((entry) => entry.surface === surface).length,
  ]));
  const roleScopedFileCounts = {
    source: countPresentScopedFiles(sites.source),
    localEdited: countPresentScopedFiles(sites.localEdited),
    remoteChanged: countPresentScopedFiles(sites.remoteChanged),
  };

  return {
    format: 'hash-count-surface-only',
    rawFileContentsIncluded: false,
    totalScopedFileCount: fileScope.length,
    surfaceNames: [...requiredSurfaceOrder],
    surfaceCounts,
    roleScopedFileCounts,
    fileScopeHash: `sha256:${digest(fileScope)}`,
    surfaceHashes: requiredSurfaceOrder.map((surface) => {
      const surfaceFiles = classicThemeSurfaceFiles.filter((entry) => entry.surface === surface);
      return {
        surface,
        fileCount: surfaceFiles.length,
        requiredFileCount: surfaceFiles.filter((entry) => entry.required).length,
        sourceHash: `sha256:${digest(surfaceHashInput(sites.source, surfaceFiles))}`,
        localHash: `sha256:${digest(surfaceHashInput(sites.localEdited, surfaceFiles))}`,
        remoteChangedHash: `sha256:${digest(surfaceHashInput(sites.remoteChanged, surfaceFiles))}`,
      };
    }),
  };
}

function buildStylesheetEvidence(sites) {
  const roleHeaders = Object.fromEntries(Object.entries(sites).map(([role, site]) => [
    role,
    parseStyleHeader(site.files[`${themeRoot}/style.css`] || ''),
  ]));
  const fieldNames = ['Template', 'Theme Name', 'Version'];
  const headerCaptured = Object.values(roleHeaders).every((header) =>
    fieldNames.every((field) => Object.hasOwn(header, field)));

  return {
    headerCaptured,
    headerFieldNames: fieldNames,
    headerFieldCount: fieldNames.length,
    sourceHeaderHash: `sha256:${digest(roleHeaders.source)}`,
    localHeaderHash: `sha256:${digest(roleHeaders.localEdited)}`,
    remoteChangedHeaderHash: `sha256:${digest(roleHeaders.remoteChanged)}`,
    rawHeaderValuesIncluded: false,
  };
}

function buildActiveThemeOptionEvidence(sites) {
  const rowKeys = ['option_name:template', 'option_name:stylesheet'];
  const rowsCaptured = Object.values(sites).every((site) =>
    rowKeys.every((rowKey) => Object.hasOwn(site.db.wp_options, rowKey)));

  return {
    rowsCaptured,
    rowKeys,
    rowCount: rowKeys.length,
    sourceRowsHash: `sha256:${digest(optionRowsForHash(sites.source, rowKeys))}`,
    localRowsHash: `sha256:${digest(optionRowsForHash(sites.localEdited, rowKeys))}`,
    remoteChangedRowsHash: `sha256:${digest(optionRowsForHash(sites.remoteChanged, rowKeys))}`,
    rawOptionRowPayloadsIncluded: false,
  };
}

function summarizeThemeMutations(plan, scopedFileKeys) {
  return plan.mutations
    .filter((mutation) => scopedFileKeys.has(mutation.resourceKey))
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

function summarizeThemeConflicts(plan, scopedFileKeys) {
  return plan.conflicts
    .filter((conflict) => scopedFileKeys.has(conflict.resourceKey))
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

function parseStyleHeader(css) {
  const header = {};
  const headerMatch = String(css || '').match(/\/\*([\s\S]*?)\*\//);
  for (const line of String(headerMatch?.[1] || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([^:]+):\s*(.+)$/);
    if (match) {
      header[match[1].trim()] = match[2].trim();
    }
  }
  return header;
}

function optionRowsForHash(site, rowKeys) {
  return rowKeys.map((rowKey) => ({
    rowKey,
    rowHash: digest(site.db.wp_options[rowKey] || null),
  }));
}

function surfaceHashInput(site, surfaceFiles) {
  return surfaceFiles.map((entry) => ({
    resourceKey: `file:${entry.path}`,
    present: Object.hasOwn(site.files, entry.path),
    hash: fileHash(site, entry.path),
  }));
}

function countPresentScopedFiles(site) {
  return classicThemeSurfaceFiles.filter((entry) => Object.hasOwn(site.files, entry.path)).length;
}

function changedFileKeys(leftSite, rightSite, scopedFileKeys) {
  return [...scopedFileKeys]
    .filter((resourceKey) => fileHashByKey(leftSite, resourceKey) !== fileHashByKey(rightSite, resourceKey))
    .sort();
}

function fileHash(site, filePath) {
  return resourceHash(site, { type: 'file', path: filePath, key: `file:${filePath}` });
}

function fileHashByKey(site, resourceKey) {
  return fileHash(site, resourceKey.replace(/^file:/, ''));
}

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0828 evidence must contain one JSON report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function scopeEvidenceInput(report) {
  return {
    urlIdentityScope: report.urlIdentityScope,
    classicThemeScope: report.classicThemeScope,
    plannerScope: report.plannerScope,
    negativeControls: report.negativeControls,
    releaseScope: report.releaseScope,
    redaction: report.redaction,
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

if (process.env.RPP_0828_REPORT_JSON === '1') {
  process.stdout.write(`${JSON.stringify(buildEvidenceReport(), null, 2)}\n`);
}
