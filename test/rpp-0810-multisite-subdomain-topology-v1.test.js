import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0810-multisite-subdomain-topology-v1.md',
);
const hexSha256Pattern = /^[a-f0-9]{64}$/;

test('RPP-0810 progress report records candidate versus release-ready multisite subdomain scope', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0810');
  assert.equal(report.variant, 1);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.topologyContract.rppId, 'RPP-0803');
  assert.equal(report.builtOn.topologyContract.sourceLocalChangedUrlCapture, true);
  assert.equal(report.builtOn.topologyContract.identityHashOnly, true);
  assert.equal(report.builtOn.urlIdentityPattern.rppId, 'RPP-0808');
  assert.deepEqual(report.builtOn.urlIdentityPattern.roleIdentities, [
    'source',
    'local-edited',
    'remote-changed',
  ]);
  assert.equal(report.builtOn.urlIdentityPattern.sameSourceAcrossRoutesRequired, true);

  assert.equal(report.progressReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(report.progressReport.candidateLabel, 'candidate');
  assert.equal(report.progressReport.releaseReadyLabel, 'release-ready');
  assert.equal(report.progressReport.percentMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'multisite-subdomain-topology-candidate');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-static-external-wordpress-topology-derived');
  assert.equal(report.candidateScope.topologyShape.installMode, 'multisite');
  assert.equal(report.candidateScope.topologyShape.addressingMode, 'subdomain');
  assert.equal(report.candidateScope.topologyShape.subdirectoryModeExcluded, true);
  assert.equal(report.candidateScope.topologyShape.sourceLocalChangedRoleIdentitiesCaptured, true);
  assert.equal(report.candidateScope.topologyShape.roleIdentityHashesOnly, true);
  assertRoleIdentityHashes(report.candidateScope.topologyShape.roleIdentityHashes);
  assert.equal(report.candidateScope.topologyShape.roleIdentitiesDistinct, true);
  assert.equal(report.candidateScope.topologyShape.sourceAliasAndRouteSourceIdentitiesMatch, true);
  assert.equal(report.candidateScope.topologyShape.networkProbePerformed, false);
  assert.equal(report.candidateScope.topologyShape.sandboxIngressPort, 8080);
  assert.equal(report.candidateScope.topologyShape.remoteTunnelsAllowed, false);

  assert.deepEqual(report.candidateScope.networkTables, [
    'wp_site',
    'wp_blogs',
    'wp_sitemeta',
    'wp_blogmeta',
    'wp_blog_versions',
    'wp_registration_log',
  ]);
  assert.deepEqual(report.candidateScope.blogScopedTables, [
    'wp_options',
    'wp_posts',
    'wp_2_options',
    'wp_2_posts',
  ]);
  assert.ok(report.candidateScope.configurationSurface.includes('SUBDOMAIN_INSTALL'));
  assert.ok(report.candidateScope.configurationSurface.includes('DOMAIN_CURRENT_SITE'));
  assert.ok(report.candidateScope.candidateClaims.includes('source-local-changed-url-identity-contract-reused'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('production-bound-multisite-import-export'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('cross-blog-table-mutation-proof'));

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-bound-wordpress-multisite-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'subdomain-install-constants-read-back-from-live-wordpress',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'per-site-prefix-table-routing-and-cross-blog-mutation-preconditions-proven',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('no-accepted-production-bound-multisite-import-export'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-prove-live-subdomain-resolution'),
  );

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0810 remains support-only without production multisite topology proof', () => {
  const { report } = loadProgressReport();

  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.productionBacked, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.progressReport.finalReleaseReadinessMovement, 'none');
  assert.equal(report.releaseReadyScope.readyWhen, 'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true');
});

test('RPP-0810 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.topologyShape.roleIdentityHashesOnly, true);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel/i,
  );
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0810 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertRoleIdentityHashes(roleIdentityHashes) {
  assert.match(roleIdentityHashes.source, hexSha256Pattern);
  assert.match(roleIdentityHashes.localEdited, hexSha256Pattern);
  assert.match(roleIdentityHashes.remoteChanged, hexSha256Pattern);
  assert.equal(new Set(Object.values(roleIdentityHashes)).size, 3);
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
  };
}
