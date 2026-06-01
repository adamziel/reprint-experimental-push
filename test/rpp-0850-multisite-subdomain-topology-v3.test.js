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
  'docs/evidence/rpp-0850-multisite-subdomain-topology-v3.md',
);
const hexSha256Pattern = /^[a-f0-9]{64}$/;

test('RPP-0850 progress report records candidate versus release-ready multisite subdomain scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0850');
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.candidateScopePattern.rppId, 'RPP-0830');
  assert.equal(report.builtOn.candidateScopePattern.variant, 2);
  assert.equal(report.builtOn.candidateScopePattern.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.builtOn.candidateScopePattern.hostRoleSurfaceCounts, true);
  assert.equal(report.builtOn.candidateScopePattern.pluginThemeSurfaceInventory, true);
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
    authSessionLifecycleObserved: false,
    durableJournalObserved: false,
    releaseGatesMoved: false,
    progressSurfacesModified: false,
  });

  assert.equal(report.candidateScope.status, 'multisite-subdomain-topology-candidate-v3');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-static-external-wordpress-topology-derived');
  assert.equal(report.candidateScope.topologyShape.installMode, 'multisite');
  assert.equal(report.candidateScope.topologyShape.addressingMode, 'subdomain');
  assert.equal(report.candidateScope.topologyShape.subdirectoryModeExcluded, true);
  assert.equal(report.candidateScope.topologyShape.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(report.candidateScope.topologyShape.hostIdentityHashesOnly, true);
  assert.equal(report.candidateScope.topologyShape.liveTopologyReadbackPerformed, false);
  assert.equal(report.candidateScope.topologyShape.networkProbePerformed, false);
  assert.equal(report.candidateScope.topologyShape.sandboxIngressPort, 8080);
  assert.equal(report.candidateScope.topologyShape.remoteTunnelsAllowed, false);
  assertHostRoleSurfaces(report.candidateScope.hostRoleSurfaces);

  assert.deepEqual(report.candidateScope.networkTables, [
    'wp_site',
    'wp_blogs',
    'wp_sitemeta',
    'wp_blogmeta',
    'wp_blog_versions',
    'wp_registration_log',
  ]);
  assert.deepEqual(report.candidateScope.siteScopedTables, [
    'wp_options',
    'wp_posts',
    'wp_postmeta',
    'wp_term_relationships',
    'wp_2_options',
    'wp_2_posts',
    'wp_2_postmeta',
    'wp_2_term_relationships',
  ]);
  assert.deepEqual(report.candidateScope.pluginThemeSurfaces.pluginSurfaces, [
    'network-active-plugins-sitemeta-surface',
    'site-active-plugins-option-surface',
    'must-use-plugin-directory-surface',
    'plugin-file-hash-inventory-surface',
  ]);
  assert.deepEqual(report.candidateScope.pluginThemeSurfaces.themeSurfaces, [
    'network-allowed-themes-sitemeta-surface',
    'site-allowed-themes-option-surface',
    'stylesheet-template-option-surface',
    'theme-file-hash-inventory-surface',
  ]);
  assert.equal(report.candidateScope.pluginThemeSurfaces.rawPluginPayloadsIncluded, false);
  assert.equal(report.candidateScope.pluginThemeSurfaces.rawThemePayloadsIncluded, false);
  assertSurfaceCountsMatch(report.candidateScope);

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0850 records exact production import/export, auth/session, journal, and live-topology gaps', () => {
  const { report } = loadProgressReport();

  assert.deepEqual(report.productionImportExportEvidence, {
    present: false,
    acceptedReleaseEvidence: false,
    observedAttempt: 'not-performed-in-rpp-0850',
    blockedReasonCode: 'PRODUCTION_BOUND_MULTISITE_IMPORT_EXPORT_AUTH_SESSION_JOURNAL_REQUIRED',
  });

  assert.deepEqual(report.candidateScope.runtimeGapCategories, {
    productionImportExport: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    liveTopologyReadback: 'missing',
    releaseArtifactBundle: 'missing',
  });
  assert.deepEqual(report.releaseReadyScope.gaps, {
    productionBoundMultisiteImportExport: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    liveTopologyReadback: 'missing',
    productionReleaseArtifacts: 'missing',
  });

  assert.deepEqual(report.candidateScope.importExportBlockers, [
    'no-production-bound-multisite-export',
    'no-production-bound-multisite-import',
    'no-authenticated-production-export-session',
    'no-authenticated-production-import-session',
    'no-live-subdomain-resolution-readback',
    'no-network-site-count-runtime-readback',
    'no-plugin-theme-runtime-readback',
    'no-cross-blog-mutation-precondition-run',
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
    'release-verifier-accepted-import-export-run',
  ]);
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('production-auth-session-lifecycle-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('durable-journal-restart-replay-proof'),
  );
  assert.ok(
    report.candidateScope.excludedFromCandidate.includes('release-verifier-artifact-bundle'),
  );

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-bound-wordpress-multisite-subdomain-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'auth-session-lifecycle-accepted-by-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'durable-journal-restart-replay-and-recovery-inspect-accepted-by-release-verifier',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('live-topology-release-verifier-accepted'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-run-production-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'candidate-does-not-carry-accepted-auth-session-lifecycle-proof',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-prove-durable-journal-restart-replay'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-prove-live-subdomain-resolution'),
  );
  assert.equal(
    report.releaseReadyScope.readyWhen,
    'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true',
  );
});

test('RPP-0850 remains support-only and final release no-go', () => {
  const { report } = loadProgressReport();

  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.equal(report.operationGuards.releaseGatesMoved, false);
  assert.equal(report.operationGuards.progressSurfacesModified, false);
});

test('RPP-0850 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0850 multisite subdomain topology progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawReleaseArtifactsIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'productionImportExportEvidence',
    'operationGuards',
    'finalReleaseStatus',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.topologyShape.hostIdentityHashesOnly, true);
  assert.equal(report.candidateScope.counts.rawPayloadCount, 0);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel/i,
  );
});

test('RPP-0850 evidence documents exact validation commands and results', () => {
  const { text } = loadProgressReport();

  assert.match(text, /node --check test\/rpp-0850-multisite-subdomain-topology-v3\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0850 test\/rpp-0850-multisite-subdomain-topology-v3\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0850-multisite-subdomain-topology-v3\.md/,
  );
  assert.match(text, /git diff --check/);
  assert.match(text, /exit 0/);
  assert.match(text, /Evidence redaction scan: `ok: true`, 0 rejected files/);
  assert.match(text, /Diff whitespace check: clean/);
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0850 evidence must contain one JSON progress report block');
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
  assert.equal(candidateScope.counts.hostRoleCount, candidateScope.hostRoleSurfaces.length);
  assert.equal(candidateScope.counts.networkCountPerHostRole, 1);
  assert.equal(candidateScope.counts.siteCountPerHostRole, 2);
  assert.equal(
    candidateScope.counts.totalNetworkCount,
    candidateScope.hostRoleSurfaces.reduce((total, role) => total + role.networkCount, 0),
  );
  assert.equal(
    candidateScope.counts.totalSiteCount,
    candidateScope.hostRoleSurfaces.reduce((total, role) => total + role.siteCount, 0),
  );
  assert.equal(candidateScope.counts.networkTableSurfaceCount, candidateScope.networkTables.length);
  assert.equal(candidateScope.counts.siteScopedTableSurfaceCount, candidateScope.siteScopedTables.length);
  assert.equal(
    candidateScope.counts.pluginSurfaceCount,
    candidateScope.pluginThemeSurfaces.pluginSurfaces.length,
  );
  assert.equal(
    candidateScope.counts.themeSurfaceCount,
    candidateScope.pluginThemeSurfaces.themeSurfaces.length,
  );
  assert.equal(candidateScope.counts.importExportBlockerCount, candidateScope.importExportBlockers.length);
  assert.equal(candidateScope.counts.releaseReadyGapCount, candidateScope.releaseReadyGaps.length);
  assert.equal(
    candidateScope.counts.runtimeGapCategoryCount,
    Object.keys(candidateScope.runtimeGapCategories).length,
  );
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    productionImportExportEvidence: report.productionImportExportEvidence,
    operationGuards: report.operationGuards,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
  };
}
