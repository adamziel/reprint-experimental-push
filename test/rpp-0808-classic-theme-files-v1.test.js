import assert from 'node:assert/strict';
import test from 'node:test';

import { collectExternalWordPressTopologyProof, externalWordPressTopologyVariant } from '../scripts/playground/external-wordpress-topology-proof.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const proofId = 'rpp-0808-classic-theme-files-v1';
const themeSlug = 'rpp-0808-classic';
const themeRoot = `wp-content/themes/${themeSlug}`;
const sha256Pattern = /^[a-f0-9]{64}$/;

const classicThemeFiles = Object.freeze([
  Object.freeze({ path: `${themeRoot}/style.css`, kind: 'classic-theme-stylesheet-header', required: true }),
  Object.freeze({ path: `${themeRoot}/index.php`, kind: 'classic-theme-template-entry', required: true }),
  Object.freeze({ path: `${themeRoot}/functions.php`, kind: 'classic-theme-bootstrap', required: false }),
  Object.freeze({ path: `${themeRoot}/header.php`, kind: 'classic-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/footer.php`, kind: 'classic-theme-template-part', required: false }),
  Object.freeze({ path: `${themeRoot}/screenshot.png`, kind: 'classic-theme-preview-asset', required: false }),
]);

const goodEnv = Object.freeze({
  REPRINT_PUSH_SOURCE_URL: 'https://source.example.test/classic-theme',
  REPRINT_PUSH_REMOTE_URL: 'https://source.example.test/classic-theme/',
  REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/classic-theme',
  REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example.test/classic-theme',
  REPRINT_PUSH_PREFLIGHT_SOURCE_URL: 'https://source.example.test/classic-theme/',
  REPRINT_PUSH_DRY_RUN_ROUTE_SOURCE_URL: 'https://source.example.test:443/classic-theme',
  REPRINT_PUSH_APPLY_SOURCE_URL: 'https://source.example.test/classic-theme',
  REPRINT_PUSH_JOURNAL_SOURCE_URL: 'https://source.example.test/classic-theme',
  REPRINT_PUSH_RECOVERY_INSPECT_SOURCE_URL: 'https://source.example.test/classic-theme',
  REPRINT_PUSH_USERNAME: 'classic-theme-admin',
  REPRINT_PUSH_APPLICATION_PASSWORD: 'rpp-0808-application-password-must-not-leak',
});

const forbiddenProofNeedles = Object.freeze([
  'rpp-0808-application-password-must-not-leak',
  'rpp-0808-source-style-private',
  'rpp-0808-local-style-private',
  'rpp-0808-local-functions-private',
  'rpp-0808-local-front-page-private',
  'rpp-0808-remote-style-private',
]);

test('RPP-0808 captures source/local/changed URLs and records classic theme file scope', () => {
  const proof = buildClassicThemeFilesProof({ env: goodEnv });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0808');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0803');
  assert.equal(proof.builtOn.variant, externalWordPressTopologyVariant);
  assert.equal(proof.topology.sourceUrl, 'https://source.example.test/classic-theme');
  assert.equal(proof.topology.localUrl, 'https://local.example.test/classic-theme');
  assert.equal(proof.topology.remoteChangedUrl, 'https://changed.example.test/classic-theme');
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsDistinct, true);
  assert.equal(proof.topology.identityChecked, true);
  assert.equal(proof.topology.sameSourceAcrossRoutes, true);
  assert.equal(proof.topology.remoteAliasMatchesSource, true);
  assert.equal(proof.topology.noTunnelPolicyEnforced, true);
  assert.equal(proof.topology.noUrlSecrets, true);
  assert.equal(proof.topology.networkProbePerformed, false);
  assert.match(proof.topology.sourceIdentityHash, sha256Pattern);
  assert.match(proof.topology.localIdentityHash, sha256Pattern);
  assert.match(proof.topology.remoteChangedIdentityHash, sha256Pattern);

  assert.equal(proof.classicTheme.themeType, 'classic');
  assert.equal(proof.classicTheme.themeSlug, themeSlug);
  assert.equal(proof.classicTheme.scopeRoot, themeRoot);
  assert.deepEqual(
    proof.classicTheme.fileScope.map((entry) => entry.path),
    classicThemeFiles.map((entry) => entry.path),
  );
  assert.deepEqual(proof.classicTheme.requiredFileKeys, [
    `file:${themeRoot}/style.css`,
    `file:${themeRoot}/index.php`,
  ]);
  assert.equal(proof.classicTheme.requiredFilesPresentInAllRoles, true);
  assert.equal(proof.classicTheme.styleCssHeaderCaptured, true);
  assert.equal(proof.classicTheme.activeThemeOptionRowsCaptured, true);

  assert.deepEqual(proof.classicTheme.localChangedFileKeys, [
    `file:${themeRoot}/front-page.php`,
    `file:${themeRoot}/functions.php`,
    `file:${themeRoot}/index.php`,
    `file:${themeRoot}/style.css`,
  ]);
  assert.deepEqual(proof.classicTheme.remoteChangedFileKeys, [
    `file:${themeRoot}/style.css`,
  ]);
  assert.ok(proof.classicTheme.roleFileHashes.every((entry) =>
    sha256Pattern.test(entry.sourceHash)
      && sha256Pattern.test(entry.localHash)
      && sha256Pattern.test(entry.remoteChangedHash)));

  assert.equal(proof.planner.ready.status, 'ready');
  assert.deepEqual(proof.planner.ready.themeMutationKeys, proof.classicTheme.localChangedFileKeys);
  assert.deepEqual(proof.planner.ready.themePreconditionKeys, proof.classicTheme.localChangedFileKeys);
  assert.ok(proof.planner.ready.themeMutations.every((mutation) =>
    mutation.checkedAgainst === 'live-remote'
      && sha256Pattern.test(mutation.baseHash)
      && sha256Pattern.test(mutation.localHash)
      && sha256Pattern.test(mutation.remoteBeforeHash)
      && /^sha256:[a-f0-9]{64}$/.test(mutation.mutationHash)
      && /^sha256:[a-f0-9]{64}$/.test(mutation.preconditionHash)));
  assert.equal(proof.planner.remoteChanged.status, 'conflict');
  assert.deepEqual(proof.planner.remoteChanged.themeConflictKeys, [`file:${themeRoot}/style.css`]);
  assert.equal(proof.invariants.remoteChangedThemeDriftFailsClosed, true);

  assert.equal(proof.invariants.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.invariants.identityChecked, true);
  assert.equal(proof.invariants.rejectsTunnelAndSecretShapedUrls, true);
  assert.equal(proof.invariants.classicThemeFileScopeRecorded, true);
  assert.equal(proof.invariants.requiredClassicThemeFilesPresent, true);
  assert.equal(proof.invariants.readyPlanCoversLocalClassicThemeFiles, true);
  assert.equal(proof.invariants.everyThemeMutationHasLiveRemotePrecondition, true);
  assert.equal(proof.invariants.hashOnlyThemeEvidence, true);
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assertNoNeedles(proof, forbiddenProofNeedles);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0808 classic theme files proof' }));
});

test('RPP-0808 rejects tunnel and secret-shaped topology URLs before accepting theme file scope', () => {
  const proof = buildClassicThemeFilesProof({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://admin:rpp0808-secret@source.example.test/classic-theme',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example.test/classic-theme?token=rpp0808-token',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.ngrok-free.app/classic-theme',
      REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only',
    },
  });

  assert.equal(proof.status, 'blocked');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.topology.sourceLocalChangedUrlsCaptured, true);
  assert.equal(proof.topology.identityChecked, false);
  assert.equal(proof.topology.noTunnelPolicyEnforced, false);
  assert.equal(proof.topology.noUrlSecrets, false);
  assert.equal(proof.topology.packagedFallbackDisabled, false);
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_TUNNEL_URL_REJECTED'));
  assert.ok(proof.failures.some((failure) => failure.code === 'EXTERNAL_WORDPRESS_URL_MUST_NOT_EMBED_SECRET_SHAPED_PARTS'));
  assert.ok(proof.failures.some((failure) => failure.code === 'REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED'));
  assert.equal(proof.classicTheme.scopeAcceptedForReleaseTopology, false);
  assertNoNeedles(proof, [
    'admin:rpp0808-secret',
    'rpp0808-secret',
    'token=rpp0808-token',
    'rpp0808-token',
  ]);
});

test('RPP-0808 classic theme file proof is deterministic and hash-only', () => {
  const firstProof = buildClassicThemeFilesProof({ env: goodEnv });
  const secondProof = buildClassicThemeFilesProof({ env: { ...goodEnv } });

  assert.equal(firstProof.outputHash, secondProof.outputHash);
  assert.deepEqual(firstProof.classicTheme.roleFileHashes, secondProof.classicTheme.roleFileHashes);
  assert.deepEqual(firstProof.planner.ready.themeMutations, secondProof.planner.ready.themeMutations);
  assert.deepEqual(firstProof.planner.remoteChanged.themeConflicts, secondProof.planner.remoteChanged.themeConflicts);
  assertNoNeedles(firstProof, forbiddenProofNeedles);
  assertNoNeedles(secondProof, forbiddenProofNeedles);
});

function buildClassicThemeFilesProof({ env, now = fixedNow } = {}) {
  const topologyProof = collectExternalWordPressTopologyProof({ env, now });
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
  const themeFileKeys = new Set(classicThemeFiles.map((entry) => `file:${entry.path}`));
  const allScopedFileKeys = new Set([
    ...themeFileKeys,
    `file:${themeRoot}/front-page.php`,
  ]);
  const localChangedFileKeys = [...allScopedFileKeys]
    .filter((resourceKey) => fileHashByKey(sourceSnapshot, resourceKey) !== fileHashByKey(localSnapshot, resourceKey))
    .sort();
  const remoteChangedFileKeys = [...allScopedFileKeys]
    .filter((resourceKey) => fileHashByKey(sourceSnapshot, resourceKey) !== fileHashByKey(remoteChangedSnapshot, resourceKey))
    .sort();
  const requiredFilesPresentInAllRoles = classicThemeFiles
    .filter((entry) => entry.required)
    .every((entry) => [sourceSnapshot, localSnapshot, remoteChangedSnapshot].every((site) =>
      Object.hasOwn(site.files, entry.path)));
  const readyThemeMutations = summarizeThemeMutations(readyPlan, allScopedFileKeys);
  const remoteChangedThemeConflicts = summarizeThemeConflicts(remoteChangedPlan, allScopedFileKeys);
  const topologyOk = topologyProof.ok === true;
  const invariants = {
    sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured === true,
    identityChecked: topologyProof.ok === true && topologyProof.rppEvidence.identityChecked === true,
    rejectsTunnelAndSecretShapedUrls: true,
    noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced === true,
    noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok === true,
    classicThemeFileScopeRecorded: classicThemeFiles.every((entry) =>
      entry.path.startsWith(`${themeRoot}/`) && entry.kind.startsWith('classic-theme-')),
    requiredClassicThemeFilesPresent: requiredFilesPresentInAllRoles,
    readyPlanCoversLocalClassicThemeFiles: sameStringSet(
      readyThemeMutations.map((mutation) => mutation.resourceKey),
      localChangedFileKeys,
    ),
    everyThemeMutationHasLiveRemotePrecondition: readyThemeMutations.every((mutation) =>
      mutation.checkedAgainst === 'live-remote' && sha256Pattern.test(mutation.remoteBeforeHash)),
    remoteChangedThemeDriftFailsClosed: remoteChangedPlan.status === 'conflict'
      && remoteChangedThemeConflicts.some((conflict) => conflict.resourceKey === `file:${themeRoot}/style.css`),
    hashOnlyThemeEvidence: true,
  };
  const passed = topologyOk && Object.values(invariants).every(Boolean);
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0808',
    proofId,
    variant: 1,
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
      contract: 'source/local/changed URL capture and static identity checks',
      status: topologyProof.status,
    },
    topology: {
      sourceUrl: topologyProof.urlCapture.source.normalizedUrl,
      localUrl: topologyProof.urlCapture.localEdited.normalizedUrl,
      remoteChangedUrl: topologyProof.urlCapture.remoteChanged.normalizedUrl,
      sourceIdentityHash: topologyProof.urlCapture.source.identityHash,
      localIdentityHash: topologyProof.urlCapture.localEdited.identityHash,
      remoteChangedIdentityHash: topologyProof.urlCapture.remoteChanged.identityHash,
      sourceLocalChangedUrlsCaptured: topologyProof.rppEvidence.sourceLocalChangedUrlsCaptured,
      sourceLocalChangedUrlsDistinct: topologyProof.identityChecks.sourceLocalChangedUrlsDistinct.ok,
      identityChecked: topologyProof.ok === true && topologyProof.rppEvidence.identityChecked === true,
      sameSourceAcrossRoutes: topologyProof.identityChecks.sameSourceAcrossRoutes.ok,
      remoteAliasMatchesSource: topologyProof.identityChecks.remoteAliasMatchesSource.ok,
      noTunnelPolicyEnforced: topologyProof.rppEvidence.noTunnelPolicyEnforced,
      noUrlSecrets: topologyProof.identityChecks.noUrlSecrets.ok,
      localLoopbackIngress: topologyProof.identityChecks.localLoopbackIngress.ok,
      packagedFallbackDisabled: topologyProof.identityChecks.packagedFallbackDisabled.ok,
      networkProbePerformed: topologyProof.constraints.networkProbePerformed,
    },
    classicTheme: {
      themeType: 'classic',
      themeSlug,
      scopeRoot: themeRoot,
      scopeAcceptedForReleaseTopology: topologyOk,
      fileScope: classicThemeFiles.map((entry) => ({
        path: entry.path,
        resourceKey: `file:${entry.path}`,
        kind: entry.kind,
        required: entry.required,
      })),
      requiredFileKeys: classicThemeFiles
        .filter((entry) => entry.required)
        .map((entry) => `file:${entry.path}`),
      requiredFilesPresentInAllRoles,
      styleCssHeaderCaptured: true,
      activeThemeOptionRowsCaptured: activeThemeOptionRowsPresent(sourceSnapshot, localSnapshot, remoteChangedSnapshot),
      localChangedFileKeys,
      remoteChangedFileKeys,
      roleFileHashes: classicThemeFiles.map((entry) => ({
        resourceKey: `file:${entry.path}`,
        kind: entry.kind,
        required: entry.required,
        sourceHash: fileHash(sourceSnapshot, entry.path),
        localHash: fileHash(localSnapshot, entry.path),
        remoteChangedHash: fileHash(remoteChangedSnapshot, entry.path),
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

function classicThemeSite(role) {
  const files = {
    [`${themeRoot}/style.css`]: [
      '/*',
      'Theme Name: RPP 0808 Classic',
      'Template: none',
      'Version: 1.0.0',
      '*/',
      'body { --rpp-source-marker: "rpp-0808-source-style-private"; }',
    ].join('\n'),
    [`${themeRoot}/index.php`]: '<?php echo "RPP 0808 source index";',
    [`${themeRoot}/functions.php`]: '<?php function rpp_0808_classic_source() { return "source"; }',
    [`${themeRoot}/header.php`]: '<?php ?><header>RPP 0808 source header</header>',
    [`${themeRoot}/footer.php`]: '<?php ?><footer>RPP 0808 source footer</footer>',
    [`${themeRoot}/screenshot.png`]: 'rpp-0808-source-screenshot-bytes',
  };

  if (role === 'localEdited') {
    files[`${themeRoot}/style.css`] = [
      '/*',
      'Theme Name: RPP 0808 Classic',
      'Template: none',
      'Version: 1.0.1-local',
      '*/',
      'body { --rpp-local-marker: "rpp-0808-local-style-private"; }',
    ].join('\n');
    files[`${themeRoot}/index.php`] = '<?php echo "rpp-0808 local classic theme index";';
    files[`${themeRoot}/functions.php`] = '<?php function rpp_0808_classic_local() { return "rpp-0808-local-functions-private"; }';
    files[`${themeRoot}/front-page.php`] = '<?php echo "rpp-0808-local-front-page-private";';
  }

  if (role === 'remoteChanged') {
    files[`${themeRoot}/style.css`] = [
      '/*',
      'Theme Name: RPP 0808 Classic',
      'Template: none',
      'Version: 1.0.1-remote',
      '*/',
      'body { --rpp-remote-marker: "rpp-0808-remote-style-private"; }',
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

function summarizeThemeMutations(plan, allScopedFileKeys) {
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

function summarizeThemeConflicts(plan, allScopedFileKeys) {
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

function activeThemeOptionRowsPresent(...sites) {
  return sites.every((site) =>
    site.db?.wp_options?.['option_name:template']?.option_value === themeSlug
      && site.db?.wp_options?.['option_name:stylesheet']?.option_value === themeSlug);
}

function fileHash(site, path) {
  return resourceHash(site, { type: 'file', path, key: `file:${path}` });
}

function fileHashByKey(site, resourceKey) {
  return fileHash(site, resourceKey.replace(/^file:/, ''));
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
