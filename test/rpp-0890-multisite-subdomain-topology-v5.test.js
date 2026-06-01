import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0890-multisite-subdomain-topology-v5.md',
);
const hexSha256Pattern = /^[a-f0-9]{64}$/;

test('RPP-0890 progress report records candidate versus release-ready multisite subdomain scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0890');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.candidateScopePattern.rppId, 'RPP-0870');
  assert.equal(report.builtOn.candidateScopePattern.variant, 4);
  assert.equal(report.builtOn.candidateScopePattern.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.builtOn.candidateScopePattern.hostRoleSurfaceCounts, true);
  assert.equal(report.builtOn.candidateScopePattern.pluginThemeSurfaceInventory, true);
  assert.equal(report.builtOn.candidateScopePattern.productionGapBookkeeping, true);
  assert.equal(report.builtOn.candidateScopePattern.releaseVerifierCarryThroughBoundary, true);
  assert.equal(report.builtOn.previousCandidateScopePattern.rppId, 'RPP-0850');
  assert.equal(report.builtOn.previousCandidateScopePattern.variant, 3);
  assert.equal(report.builtOn.earlierCandidateScopePattern.rppId, 'RPP-0830');
  assert.equal(report.builtOn.earlierCandidateScopePattern.variant, 2);
  assert.equal(report.builtOn.firstCandidateScopePattern.rppId, 'RPP-0810');
  assert.equal(report.builtOn.firstCandidateScopePattern.variant, 1);
  assert.equal(report.builtOn.topologyContract.rppId, 'RPP-0803');
  assert.equal(report.builtOn.topologyContract.sourceLocalChangedUrlCapture, true);
  assert.equal(report.builtOn.topologyContract.identityHashOnly, true);
  assert.equal(report.builtOn.urlIdentityPattern.rppId, 'RPP-0808');
  assert.deepEqual(report.builtOn.urlIdentityPattern.roleIdentities, [
    'source',
    'local-edited',
    'remote-changed',
  ]);

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.deepEqual(report.operationGuards, {
    liveWordPressUsed: false,
    wordpressRoutesCalled: false,
    networkProbePerformed: false,
    importExportPerformed: false,
    productionTopologyReadbackAccepted: false,
    releaseVerifierProductionRunPerformed: false,
    authSessionLifecycleObserved: false,
    durableJournalObserved: false,
    releaseGatesMoved: false,
    progressSurfacesModified: false,
  });

  assert.equal(report.candidateScope.status, 'multisite-subdomain-topology-candidate-v5');
  assert.equal(report.candidateScope.coverageMode, 'focused-regression-candidate-vs-release-ready');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-static-external-wordpress-topology-derived-v5');
  assert.equal(report.candidateScope.topologyShape.installMode, 'multisite');
  assert.equal(report.candidateScope.topologyShape.addressingMode, 'subdomain');
  assert.equal(report.candidateScope.topologyShape.subdirectoryModeExcluded, true);
  assert.equal(report.candidateScope.topologyShape.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(report.candidateScope.topologyShape.hostIdentityHashesOnly, true);
  assert.equal(report.candidateScope.topologyShape.liveTopologyReadbackPerformed, false);
  assert.equal(report.candidateScope.topologyShape.productionTopologyReadbackAccepted, false);
  assert.equal(report.candidateScope.topologyShape.releaseVerifierAccepted, false);
  assert.equal(report.candidateScope.topologyShape.networkProbePerformed, false);
  assert.equal(report.candidateScope.topologyShape.sandboxIngressPort, 8080);
  assert.equal(report.candidateScope.topologyShape.remoteTunnelsAllowed, false);
  assertHostRoleSurfaces(report.candidateScope.hostRoleSurfaces);

  assert.deepEqual(report.candidateScope.networkTables, expectedNetworkTables());
  assert.deepEqual(report.candidateScope.siteScopedTables, expectedSiteScopedTables());
  assert.deepEqual(report.candidateScope.configurationSurface, expectedConfigurationSurface());
  assert.deepEqual(report.candidateScope.pluginThemeSurfaces, expectedPluginThemeSurfaces());
  assert.deepEqual(report.candidateScope.focusedRegressionSurfaces, [
    'host-role-identity-hash-surfaces',
    'network-table-count-surfaces',
    'site-scoped-table-count-surfaces',
    'configuration-constant-name-surfaces',
    'plugin-theme-inventory-surfaces',
    'production-topology-readback-gap-surfaces',
    'release-verifier-carry-through-boundary-surfaces',
    'release-gate-no-go-surfaces',
  ]);
  assert.deepEqual(report.candidateScope.surfaceEvidence, expectedSurfaceEvidence());
  assertSurfaceCountsMatch(report.candidateScope);

  assert.match(report.candidateScope.surfaceEvidenceHash, hexSha256Pattern);
  assert.equal(report.candidateScope.surfaceEvidenceHash, digest(surfaceEvidenceInput(report)));
  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0890 records exact production-topology release gaps and final no-go', () => {
  const { report } = loadProgressReport();

  assert.deepEqual(report.productionImportExportEvidence, {
    present: false,
    acceptedReleaseEvidence: false,
    observedAttempt: 'not-performed-in-rpp-0890',
    blockedReasonCode: 'PRODUCTION_BOUND_MULTISITE_IMPORT_EXPORT_AUTH_SESSION_JOURNAL_REQUIRED',
  });
  assert.deepEqual(report.productionTopologyEvidence, {
    present: false,
    acceptedReleaseEvidence: false,
    liveSubdomainResolutionReadback: false,
    liveNetworkConstantReadback: false,
    liveNetworkSiteCountReadback: false,
    livePluginThemeReadback: false,
    releaseVerifierAccepted: false,
    observedAttempt: 'not-performed-in-rpp-0890',
    blockedReasonCode: 'LIVE_MULTISITE_SUBDOMAIN_TOPOLOGY_RELEASE_VERIFIER_REQUIRED',
  });
  assert.deepEqual(report.releaseVerifierCarryThrough, {
    present: true,
    coverageMode: 'candidate-boundary-carry-through',
    topologySurface: 'multisite-subdomain-production-topology',
    commandSurface: 'verify-release-command-surface',
    candidateVersusReleaseReadyBoundary: 'recorded',
    acceptedReleaseEvidence: false,
    productionBacked: false,
    releaseEligible: false,
    releaseVerifierAccepted: false,
    releaseGateMovement: 'none',
    blockedReasonCode: 'LIVE_MULTISITE_SUBDOMAIN_TOPOLOGY_RELEASE_VERIFIER_REQUIRED',
    releaseReadyRequiresProductionBackedVerifier: true,
    rawVerifierArtifactsIncluded: false,
  });

  assert.deepEqual(report.candidateScope.runtimeGapCategories, {
    productionImportExport: 'missing',
    productionTopologyReadback: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    releaseArtifactBundle: 'missing',
    releaseVerifierAcceptance: 'missing',
  });
  assert.deepEqual(report.candidateScope.importExportBlockers, [
    'no-production-bound-multisite-export',
    'no-production-bound-multisite-import',
    'no-authenticated-production-export-session',
    'no-authenticated-production-import-session',
    'no-live-subdomain-resolution-readback',
    'no-live-network-constant-readback',
    'no-network-site-count-runtime-readback',
    'no-plugin-theme-runtime-readback',
    'no-cross-blog-mutation-precondition-run',
    'no-release-verifier-accepted-production-topology',
  ]);
  assert.deepEqual(report.candidateScope.releaseReadyGaps, [
    'production-bound-multisite-export',
    'production-bound-multisite-import',
    'auth-session-lifecycle-release-verifier-acceptance',
    'durable-journal-restart-replay-proof',
    'live-source-local-changed-host-role-readback',
    'live-subdomain-resolution-proof',
    'live-network-constant-readback',
    'network-and-site-count-runtime-readback',
    'plugin-theme-runtime-surface-readback',
    'cross-blog-table-mutation-precondition-proof',
    'production-topology-release-verifier-acceptance',
    'redacted-release-artifact-bundle',
    'release-verifier-accepted-import-export-run',
  ]);

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.deepEqual(report.releaseReadyScope.gaps, {
    productionBoundMultisiteImportExport: 'missing',
    productionTopologyReadback: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    liveTopologyReadback: 'missing',
    productionReleaseArtifacts: 'missing',
  });
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-bound-wordpress-multisite-subdomain-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-topology-release-verifier-accepted'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'redacted-release-artifact-bundle-passes-artifact-redaction-scan',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-run-production-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'candidate-does-not-have-production-topology-release-verifier-acceptance',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('release-artifact-bundle-not-present'),
  );
  assert.equal(
    report.releaseReadyScope.readyWhen,
    'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true',
  );

  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.equal(report.operationGuards.releaseGatesMoved, false);
  assert.equal(report.operationGuards.progressSurfacesModified, false);
});

test('RPP-0890 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0890 multisite subdomain topology progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawReleaseArtifactsIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'productionImportExportEvidence',
    'productionTopologyEvidence',
    'releaseVerifierCarryThrough',
    'operationGuards',
    'finalReleaseStatus',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.topologyShape.hostIdentityHashesOnly, true);
  assert.equal(report.releaseVerifierCarryThrough.rawVerifierArtifactsIncluded, false);
  assert.equal(report.candidateScope.countEvidence.rawPayloadCount, 0);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel/i,
  );
});

test('RPP-0890 evidence documents exact validation commands and results', () => {
  const { text } = loadProgressReport();

  assert.match(text, /node --check test\/rpp-0890-multisite-subdomain-topology-v5\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0890 test\/rpp-0890-multisite-subdomain-topology-v5\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0890-multisite-subdomain-topology-v5\.md/,
  );
  assert.match(text, /git diff --check/);
  assert.match(text, /exit 0/);
  assert.match(text, /Evidence redaction scan: `ok: true`, 0 rejected files/);
  assert.match(text, /Diff whitespace check: clean/);
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0890 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertHostRoleSurfaces(hostRoleSurfaces) {
  assert.deepEqual(hostRoleSurfaces.map((surface) => surface.role), [
    'source',
    'local-edited',
    'remote-changed',
  ]);
  assert.equal(new Set(hostRoleSurfaces.map((surface) => surface.hostIdentityHash)).size, 3);

  for (const surface of hostRoleSurfaces) {
    assert.match(surface.hostIdentityHash, hexSha256Pattern);
    assert.equal(surface.rawHostIncluded, false);
    assert.equal(surface.rawUrlIncluded, false);
    assert.equal(surface.networkCount, 1);
    assert.equal(surface.siteCount, 2);
    assert.deepEqual(surface.siteAddressingSurfaces, [
      'network-root',
      'child-subdomain',
    ]);
  }
}

function assertSurfaceCountsMatch(candidateScope) {
  assert.equal(candidateScope.countEvidence.hostRoleCount, candidateScope.hostRoleSurfaces.length);
  assert.equal(candidateScope.countEvidence.networkCountPerHostRole, 1);
  assert.equal(candidateScope.countEvidence.siteCountPerHostRole, 2);
  assert.equal(
    candidateScope.countEvidence.totalNetworkCount,
    candidateScope.hostRoleSurfaces.reduce((total, role) => total + role.networkCount, 0),
  );
  assert.equal(
    candidateScope.countEvidence.totalSiteCount,
    candidateScope.hostRoleSurfaces.reduce((total, role) => total + role.siteCount, 0),
  );
  assert.equal(candidateScope.countEvidence.networkTableSurfaceCount, candidateScope.networkTables.length);
  assert.equal(candidateScope.countEvidence.siteScopedTableSurfaceCount, candidateScope.siteScopedTables.length);
  assert.equal(candidateScope.countEvidence.configurationSurfaceCount, candidateScope.configurationSurface.length);
  assert.equal(
    candidateScope.countEvidence.pluginSurfaceCount,
    candidateScope.pluginThemeSurfaces.pluginSurfaces.length,
  );
  assert.equal(
    candidateScope.countEvidence.themeSurfaceCount,
    candidateScope.pluginThemeSurfaces.themeSurfaces.length,
  );
  assert.equal(candidateScope.countEvidence.focusedRegressionSurfaceCount, candidateScope.focusedRegressionSurfaces.length);
  assert.equal(candidateScope.countEvidence.focusedRegressionSurfaceCount, candidateScope.surfaceEvidence.length);
  assert.equal(candidateScope.countEvidence.releaseVerifierCarryThroughSurfaceCount, 1);
  assert.equal(candidateScope.countEvidence.importExportBlockerCount, candidateScope.importExportBlockers.length);
  assert.equal(candidateScope.countEvidence.releaseReadyGapCount, candidateScope.releaseReadyGaps.length);
  assert.equal(
    candidateScope.countEvidence.runtimeGapCategoryCount,
    Object.keys(candidateScope.runtimeGapCategories).length,
  );
  assert.equal(candidateScope.countEvidence.productionTopologyEvidenceCount, 0);
  assert.equal(candidateScope.countEvidence.rawPayloadCount, 0);
}

function expectedNetworkTables() {
  return [
    'wp_site',
    'wp_blogs',
    'wp_sitemeta',
    'wp_blogmeta',
    'wp_blog_versions',
    'wp_registration_log',
  ];
}

function expectedSiteScopedTables() {
  return [
    'wp_options',
    'wp_posts',
    'wp_postmeta',
    'wp_term_relationships',
    'wp_2_options',
    'wp_2_posts',
    'wp_2_postmeta',
    'wp_2_term_relationships',
  ];
}

function expectedConfigurationSurface() {
  return [
    'SUBDOMAIN_INSTALL',
    'DOMAIN_CURRENT_SITE',
    'PATH_CURRENT_SITE',
    'SITE_ID_CURRENT_SITE',
    'BLOG_ID_CURRENT_SITE',
    'sunrise-domain-mapping-policy',
  ];
}

function expectedPluginThemeSurfaces() {
  return {
    pluginSurfaces: [
      'network-active-plugins-sitemeta-surface',
      'site-active-plugins-option-surface',
      'must-use-plugin-directory-surface',
      'plugin-file-hash-inventory-surface',
    ],
    themeSurfaces: [
      'network-allowed-themes-sitemeta-surface',
      'site-allowed-themes-option-surface',
      'stylesheet-template-option-surface',
      'theme-file-hash-inventory-surface',
    ],
    rawPluginPayloadsIncluded: false,
    rawThemePayloadsIncluded: false,
  };
}

function expectedSurfaceEvidence() {
  return surfaceEvidenceModel().map((entry) => ({
    ...entry,
    hash: digest(entry),
  }));
}

function surfaceEvidenceModel() {
  return [
    {
      surface: 'host-role-identity',
      surfaceType: 'hash-count',
      countKeys: ['hostRoleCount', 'totalNetworkCount', 'totalSiteCount'],
      fields: ['role', 'hostRole', 'hostIdentityHash', 'networkCount', 'siteCount'],
    },
    {
      surface: 'network-tables',
      surfaceType: 'table-count',
      tables: expectedNetworkTables(),
      countKeys: ['networkTableSurfaceCount'],
    },
    {
      surface: 'site-scoped-tables',
      surfaceType: 'table-count',
      tables: expectedSiteScopedTables(),
      countKeys: ['siteScopedTableSurfaceCount'],
    },
    {
      surface: 'configuration-constants',
      surfaceType: 'name-count',
      fields: expectedConfigurationSurface(),
      countKeys: ['configurationSurfaceCount'],
    },
    {
      surface: 'plugin-theme-inventory',
      surfaceType: 'surface-count',
      fields: [
        ...expectedPluginThemeSurfaces().pluginSurfaces,
        ...expectedPluginThemeSurfaces().themeSurfaces,
      ],
      countKeys: ['pluginSurfaceCount', 'themeSurfaceCount'],
    },
    {
      surface: 'production-topology-readback-gaps',
      surfaceType: 'gap-count',
      fields: [
        'productionImportExport',
        'productionTopologyReadback',
        'authSessionLifecycle',
        'durableJournal',
        'releaseArtifactBundle',
        'releaseVerifierAcceptance',
      ],
      countKeys: ['runtimeGapCategoryCount', 'productionTopologyEvidenceCount'],
    },
    {
      surface: 'release-verifier-carry-through-boundary',
      surfaceType: 'verifier-boundary-count',
      fields: [
        'topologySurface',
        'commandSurface',
        'candidateVersusReleaseReadyBoundary',
        'acceptedReleaseEvidence',
        'productionBacked',
        'releaseEligible',
        'releaseVerifierAccepted',
        'releaseGateMovement',
      ],
      countKeys: ['releaseVerifierCarryThroughSurfaceCount', 'productionTopologyEvidenceCount'],
    },
    {
      surface: 'release-gate-boundary',
      surfaceType: 'no-go-count',
      fields: ['supportOnly', 'productionBacked', 'releaseEligible', 'finalReleaseStatus', 'integrationRecommendation'],
      countKeys: ['importExportBlockerCount', 'releaseReadyGapCount', 'rawPayloadCount'],
    },
  ];
}

function surfaceEvidenceInput(report) {
  return {
    topologyShape: report.candidateScope.topologyShape,
    countEvidence: report.candidateScope.countEvidence,
    surfaceEvidence: report.candidateScope.surfaceEvidence.map(({ hash, ...entry }) => entry),
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    productionImportExportEvidence: report.productionImportExportEvidence,
    productionTopologyEvidence: report.productionTopologyEvidence,
    releaseVerifierCarryThrough: report.releaseVerifierCarryThrough,
    operationGuards: report.operationGuards,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
  };
}
