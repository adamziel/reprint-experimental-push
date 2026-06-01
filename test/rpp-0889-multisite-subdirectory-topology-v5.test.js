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
  'docs/evidence/rpp-0889-multisite-subdirectory-topology-v5.md',
);
const variant = 'RPP-0889-variant-5';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0889',
  resource: 'reprint-push-release-state-row',
});
const sameArtifactBindingHash = digest({
  rpp: 'RPP-0889',
  binding: 'plugin-and-graph-same-import-export-artifact',
});
const requiredGraphTypes = Object.freeze([
  'featured-image-attachment',
  'category-term-relationship-termmeta',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
  'multisite-blog-option-routing',
  'multisite-cross-blog-reference-boundary',
]);
const requiredImportExportSequence = Object.freeze([
  'export-source-multisite-subdirectory',
  'import-local-edited-multisite-subdirectory',
  'export-local-edited-after-import',
  'read-back-plugin-driver-evidence',
  'read-back-required-graph-evidence',
  'release-verifier-acceptance',
]);

test('RPP-0889 support report records fail-closed multisite subdirectory variant 5 scope', () => {
  const { report, text } = loadSupportReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0889');
  assert.equal(report.variant, 5);
  assert.equal(report.status, 'blocked-support-only');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(
    report.successContract,
    'same-artifact-plugin-and-graph-evidence-survive-real-wordpress-import-export-for-multisite-subdirectory',
  );

  assert.equal(report.builtOn.previousSupportScope.rppId, 'RPP-0869');
  assert.equal(report.builtOn.previousSupportScope.variant, 4);
  assert.equal(report.builtOn.previousSupportScope.pluginGraphSurvivalContract, true);
  assert.equal(report.builtOn.previousSupportScope.productionTopologyBoundary, true);
  assert.equal(report.builtOn.previousSupportScope.releaseVerifierCarryThroughBoundary, true);
  assert.equal(report.builtOn.earlierSupportScope.rppId, 'RPP-0849');
  assert.equal(report.builtOn.earlierSupportScope.variant, 3);
  assert.equal(report.builtOn.candidateTopology.rppId, 'RPP-0809');
  assert.equal(report.builtOn.candidateTopology.addressingMode, 'subdirectory');
  assert.equal(report.builtOn.currentProductionTopologyPattern.rppId, 'RPP-0890');
  assert.equal(report.builtOn.currentProductionTopologyPattern.variant, 5);
  assert.equal(report.builtOn.currentProductionTopologyPattern.releaseVerifierCarryThroughBoundary, true);
  assert.equal(report.builtOn.topologyContract.rppId, 'RPP-0803');
  assert.equal(report.builtOn.topologyContract.identityHashOnly, true);
  assert.equal(report.builtOn.importExportSurvivalContract.rppId, 'RPP-0804');

  assert.equal(report.supportReport.recordsCandidateVersusReleaseReadyScope, true);
  assert.equal(
    report.supportReport.variantFocus,
    'same-artifact-real-wordpress-import-export-survival-v5',
  );
  assert.equal(report.supportReport.finalReleaseReadinessMovement, 'none');
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
    localServerStarted: false,
    remoteTunnelUsed: false,
    releaseGatesMoved: false,
    progressSurfacesModified: false,
  });

  assert.deepEqual(report.productionImportExportEvidence, {
    present: false,
    acceptedReleaseEvidence: false,
    orderedImportExportSequenceObserved: false,
    sameArtifactPluginGraphSurvivalObserved: false,
    pluginEvidenceSurvivalObserved: false,
    graphEvidenceSurvivalObserved: false,
    observedAttempt: 'not-performed-in-rpp-0889',
    blockedReasonCode: 'REAL_WORDPRESS_MULTISITE_SUBDIRECTORY_IMPORT_EXPORT_REQUIRED',
  });
  assert.deepEqual(report.releaseVerifierCarryThrough, {
    present: true,
    coverageMode: 'candidate-boundary-carry-through',
    topologySurface: 'multisite-subdirectory-production-topology',
    commandSurface: 'verify-release-command-surface',
    candidateVersusReleaseReadyBoundary: 'recorded',
    acceptedReleaseEvidence: false,
    productionBacked: false,
    releaseEligible: false,
    releaseVerifierAccepted: false,
    releaseGateMovement: 'none',
    blockedReasonCode: 'LIVE_MULTISITE_SUBDIRECTORY_TOPOLOGY_RELEASE_VERIFIER_REQUIRED',
    releaseReadyRequiresProductionBackedVerifier: true,
    sameArtifactPluginGraphSurvivalRequired: true,
    rawVerifierArtifactsIncluded: false,
  });

  assert.equal(report.candidateScope.status, 'multisite-subdirectory-import-export-survival-support-candidate-v5');
  assert.equal(
    report.candidateScope.coverageMode,
    'release-verifier-regression-support-contract-candidate-vs-release-ready',
  );
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.failClosed, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.topologyShape.installMode, 'multisite');
  assert.equal(report.candidateScope.topologyShape.addressingMode, 'subdirectory');
  assert.equal(report.candidateScope.topologyShape.pathBasedSites, true);
  assert.equal(report.candidateScope.topologyShape.subdomainModeExcluded, true);
  assert.equal(report.candidateScope.topologyShape.releaseVerifierAccepted, false);
  assert.equal(report.candidateScope.topologyShape.importExportObserved, false);
  assert.equal(report.candidateScope.topologyShape.sandboxIngressPort, 8080);
  assert.equal(report.candidateScope.topologyShape.remoteTunnelsAllowed, false);
  assertRoleSurfaces(report.candidateScope.routeRoleSurfaces);

  assert.deepEqual(report.candidateScope.networkTables, expectedNetworkTables());
  assert.deepEqual(report.candidateScope.siteScopedTables, expectedSiteScopedTables());
  assert.deepEqual(report.candidateScope.configurationSurface, expectedConfigurationSurface());
  assert.deepEqual(report.candidateScope.focusedSupportSurfaces, [
    'route-role-identity-hash-surfaces',
    'network-table-count-surfaces',
    'site-scoped-table-count-surfaces',
    'configuration-constant-name-surfaces',
    'plugin-survival-contract-surface',
    'graph-survival-contract-surface',
    'same-artifact-survival-contract-surface',
    'production-topology-readback-gap-surfaces',
    'import-export-topology-sequence-gap-surfaces',
    'release-verifier-carry-through-boundary-surfaces',
    'release-gate-no-go-surfaces',
  ]);
  assert.deepEqual(report.candidateScope.surfaceEvidence, expectedSurfaceEvidence());
  assertSurfaceCountsMatch(report.candidateScope);

  assert.equal(
    report.candidateScope.importExportSurvivalSurface.successContract,
    'same-artifact-plugin-and-graph-evidence-survive-real-wordpress-import-export-for-multisite-subdirectory',
  );
  assert.equal(report.candidateScope.importExportSurvivalSurface.runtimeRequired, 'real-wordpress-import-export');
  assert.equal(report.candidateScope.importExportSurvivalSurface.productionBackedRequired, true);
  assert.equal(report.candidateScope.importExportSurvivalSurface.sameArtifactEvidenceRequired, true);
  assert.equal(report.candidateScope.importExportSurvivalSurface.sameArtifactBindingHash, sameArtifactBindingHash);
  assert.equal(report.candidateScope.importExportSurvivalSurface.addressingModeRequired, 'subdirectory');
  assert.equal(report.candidateScope.importExportSurvivalSurface.pluginDriver, pluginDriver);
  assert.equal(report.candidateScope.importExportSurvivalSurface.pluginOwner, pluginOwner);
  assert.equal(report.candidateScope.importExportSurvivalSurface.pluginResourceKeyHash, pluginResourceKeyHash);
  assert.deepEqual(report.candidateScope.importExportSurvivalSurface.requiredGraphTypes, [
    ...requiredGraphTypes,
  ]);
  assert.deepEqual(report.candidateScope.importExportSurvivalSurface.rejectedSubstitutes, [
    'packaged-fallback-artifact',
    'local-playground-wordpress',
    'multisite-subdomain-substitute',
    'partial-plugin-or-graph-survival',
    'sequence-incomplete-import-export',
  ]);
  assert.equal(
    report.candidateScope.importExportSurvivalSurface.releaseVerifierAcceptanceRequiredForRelease,
    true,
  );
  assert.deepEqual(report.candidateScope.importExportTopologySequence, {
    expectedRuntime: 'real-wordpress-import-export',
    requiredOrder: [...requiredImportExportSequence],
    observedOrder: [],
    wordpressImportExportObserved: false,
    sameArtifactPluginGraphSurvivalObserved: false,
    pluginEvidenceSurvivalObserved: false,
    graphEvidenceSurvivalObserved: false,
    productionTopologyReadbackObserved: false,
    releaseEligibleWithoutSequence: false,
    blockedReasonCode: 'REAL_WORDPRESS_MULTISITE_SUBDIRECTORY_IMPORT_EXPORT_SEQUENCE_REQUIRED',
  });

  assert.match(report.candidateScope.surfaceEvidenceHash, hexSha256Pattern);
  assert.equal(report.candidateScope.surfaceEvidenceHash, digest(surfaceEvidenceInput(report)));
  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0889 release-ready scope stays no-go until production verifier evidence exists', () => {
  const { report } = loadSupportReport();

  assert.deepEqual(report.candidateScope.runtimeGapCategories, {
    productionImportExport: 'missing',
    productionTopologyReadback: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    releaseArtifactBundle: 'missing',
    releaseVerifierAcceptance: 'missing',
  });
  assert.ok(
    report.candidateScope.importExportBlockers.includes(
      'no-same-artifact-plugin-graph-survival-proof',
    ),
  );
  assert.ok(
    report.candidateScope.importExportBlockers.includes(
      'packaged-fallback-not-accepted-as-survival-evidence',
    ),
  );
  assert.ok(
    report.candidateScope.importExportBlockers.includes(
      'playground-or-subdomain-substitute-not-accepted',
    ),
  );
  assert.ok(
    report.candidateScope.releaseReadyGaps.includes(
      'same-artifact-plugin-graph-survival-proof',
    ),
  );
  assert.ok(
    report.candidateScope.releaseReadyGaps.includes(
      'release-verifier-accepted-same-artifact-import-export-run',
    ),
  );

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.deepEqual(report.releaseReadyScope.gaps, {
    productionBoundMultisiteImportExport: 'missing',
    productionTopologyReadback: 'missing',
    sameArtifactPluginGraphSurvival: 'missing',
    authSessionLifecycle: 'missing',
    durableJournal: 'missing',
    liveTopologyReadback: 'missing',
    productionReleaseArtifacts: 'missing',
  });
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'production-bound-wordpress-multisite-subdirectory-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'same-artifact-plugin-driver-and-required-graph-evidence-survives-real-wordpress-import-export',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'packaged-fallback-playground-subdomain-partial-and-sequence-incomplete-evidence-rejected',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('production-topology-release-verifier-accepted'),
  );
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-missing'));
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'candidate-does-not-have-production-topology-release-verifier-acceptance',
    ),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes(
      'candidate-does-not-prove-same-artifact-plugin-graph-survival',
    ),
  );
  assert.equal(
    report.releaseReadyScope.readyWhen,
    'all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-same-artifact-survival-and-release-verifier-acceptance',
  );

  assert.equal(report.failClosed, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0889 accepts only production-backed same-artifact subdirectory survival proof', () => {
  const proof = evaluateMultisiteSubdirectoryImportExportV5(
    successfulSameArtifactSubdirectoryImportExportArtifact(),
  );

  assert.equal(proof.ok, true);
  assert.equal(proof.successContractSatisfied, true);
  assert.equal(proof.acceptedForSupportContract, true);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseVerifierReviewRequired, true);
  assert.equal(proof.finalReleaseDecision, 'requires-release-verifier-review');
  assert.equal(proof.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(proof.importExport.productionBacked, true);
  assert.equal(proof.importExport.packagedFallback, false);
  assert.equal(proof.importExport.sequenceMatches, true);
  assert.deepEqual(proof.importExport.sequence, [...requiredImportExportSequence]);
  assert.equal(proof.topology.multisite, true);
  assert.equal(proof.topology.addressingMode, 'subdirectory');
  assert.equal(proof.topology.networkConstantsReadback, true);
  assert.match(proof.artifactIdHash, hexSha256Pattern);
  assert.equal(proof.pluginEvidence.driver, pluginDriver);
  assert.equal(proof.pluginEvidence.owner, pluginOwner);
  assert.equal(proof.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(proof.pluginEvidence.artifactIdHash, proof.artifactIdHash);
  assert.equal(proof.pluginEvidence.survivedImport, true);
  assert.equal(proof.pluginEvidence.survivedExport, true);
  assert.deepEqual(proof.graphEvidence.requiredTypes, [...requiredGraphTypes]);
  assert.deepEqual(proof.graphEvidence.missingTypes, []);
  assert.deepEqual(proof.graphEvidence.survivedTypes, [...requiredGraphTypes]);
  assert.equal(proof.sameArtifact.pluginAndGraphBoundToSameArtifact, true);
  assert.match(proof.artifactHash, hexSha256Pattern);
});

test('RPP-0889 rejects packaged fallback, playground, subdomain, partial, and sequence-incomplete evidence', () => {
  const missingProof = evaluateMultisiteSubdirectoryImportExportV5(null);

  assert.equal(missingProof.ok, false);
  assert.equal(missingProof.successContractSatisfied, false);
  assert.equal(missingProof.acceptedForSupportContract, false);
  assert.equal(missingProof.releaseEligible, false);
  assert.equal(missingProof.finalReleaseDecision, 'NO-GO');
  assert.deepEqual(missingProof.failures.map((failure) => failure.code), [
    'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
  ]);

  const cases = [
    {
      name: 'packaged fallback',
      mutate: (observed) => {
        observed.artifactOrigin = 'packaged-fallback';
        observed.importExport.productionBacked = false;
        observed.importExport.packagedFallback = true;
      },
      codes: [
        'PACKAGED_FALLBACK_REJECTED',
        'PRODUCTION_BACKED_ARTIFACT_REQUIRED',
      ],
    },
    {
      name: 'playground substitute',
      mutate: (observed) => {
        observed.runtime = 'local-playground-wordpress';
        observed.importExport.realWordPress = false;
      },
      codes: [
        'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
        'PLAYGROUND_SUBSTITUTE_REJECTED',
      ],
    },
    {
      name: 'subdomain substitute',
      mutate: (observed) => {
        observed.topology.addressingMode = 'subdomain';
      },
      codes: [
        'MULTISITE_SUBDIRECTORY_TOPOLOGY_REQUIRED',
        'SUBDOMAIN_SUBSTITUTE_REJECTED',
      ],
    },
    {
      name: 'partial survival',
      mutate: (observed) => {
        observed.pluginEvidence.survivedExport = false;
        observed.pluginEvidence.afterExportHash = null;
        observed.graphEvidence[0].afterExportHash = null;
        observed.graphEvidence = observed.graphEvidence.filter((entry) =>
          entry.type !== 'multisite-cross-blog-reference-boundary');
      },
      codes: [
        'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING',
        'PLUGIN_EVIDENCE_AFTER_EXPORT_HASH_MISSING',
        'GRAPH_EVIDENCE_SURVIVAL_MISSING',
        'PARTIAL_SURVIVAL_REJECTED',
      ],
      missingTypes: [
        'featured-image-attachment',
        'multisite-cross-blog-reference-boundary',
      ],
    },
    {
      name: 'sequence incomplete',
      mutate: (observed) => {
        observed.importExport.sequence = requiredImportExportSequence.slice(0, -1);
      },
      codes: [
        'IMPORT_EXPORT_SEQUENCE_MISMATCH',
        'SEQUENCE_INCOMPLETE_REJECTED',
      ],
    },
    {
      name: 'split artifact',
      mutate: (observed) => {
        observed.pluginEvidence.artifactIdHash = sampleHash('other-artifact');
        observed.graphEvidence[1].artifactIdHash = sampleHash('third-artifact');
      },
      codes: [
        'SAME_ARTIFACT_PLUGIN_BINDING_MISSING',
        'SAME_ARTIFACT_GRAPH_BINDING_MISSING',
        'SAME_ARTIFACT_PLUGIN_GRAPH_SURVIVAL_REQUIRED',
      ],
      missingTypes: [
        'category-term-relationship-termmeta',
      ],
    },
  ];

  for (const { name, mutate, codes, missingTypes } of cases) {
    const observed = successfulSameArtifactSubdirectoryImportExportArtifact();
    mutate(observed);
    const proof = evaluateMultisiteSubdirectoryImportExportV5(observed);
    const failureCodes = proof.failures.map((failure) => failure.code);

    assert.equal(proof.ok, false, name);
    assert.equal(proof.successContractSatisfied, false, name);
    assert.equal(proof.acceptedForSupportContract, false, name);
    assert.equal(proof.releaseEligible, false, name);
    assert.equal(proof.finalReleaseDecision, 'NO-GO', name);
    for (const code of codes) {
      assert.ok(failureCodes.includes(code), `${name} should include ${code}`);
    }
    if (missingTypes) {
      assert.deepEqual(proof.graphEvidence.missingTypes, missingTypes, name);
    }
  }
});

test('RPP-0889 evidence remains hash/count/surface only and scoped to support', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0889 multisite subdirectory support report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.pluginRawValuesIncluded, false);
  assert.equal(report.redaction.graphRawValuesIncluded, false);
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
    'successContract',
  ]);
  assert.equal(report.candidateScope.topologyShape.roleIdentityHashesOnly, true);
  assert.equal(report.releaseVerifierCarryThrough.rawVerifierArtifactsIncluded, false);
  assert.deepEqual(report.candidateScope.importExportTopologySequence.observedOrder, []);
  assert.equal(report.candidateScope.importExportTopologySequence.releaseEligibleWithoutSequence, false);
  assert.equal(report.candidateScope.countEvidence.rawPayloadCount, 0);
  assert.ok(report.candidateScope.excludedFromCandidate.includes('final-release-go-decision'));
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel/i,
  );
  assert.doesNotMatch(text, /"productionBacked": true/);
  assert.doesNotMatch(text, /"releaseEligible": true/);
  assert.doesNotMatch(text, /"integrationRecommendation": "GO"/);
});

test('RPP-0889 evidence documents scoped validation commands and results', () => {
  const { text } = loadSupportReport();

  assert.match(text, /node --check test\/rpp-0889-multisite-subdirectory-topology-v5\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0889 test\/rpp-0889-multisite-subdirectory-topology-v5\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0889-multisite-subdirectory-topology-v5\.md/,
  );
  assert.match(text, /git diff --check/);
  assert.match(text, /exit 0/);
  assert.match(text, /Evidence redaction scan: `ok: true`, 0 rejected files/);
  assert.match(text, /Diff whitespace check: clean/);
});

function evaluateMultisiteSubdirectoryImportExportV5(observed) {
  const validation = validateObservedImportExportSurvival(observed);
  const successContractSatisfied = validation.failures.length === 0;
  const releaseEligible = successContractSatisfied
    && validation.releaseVerifier.releaseVerifierAccepted === true
    && validation.releaseVerifier.productionTopologyAccepted === true;

  return {
    event: 'rpp-0889-multisite-subdirectory-topology-v5',
    variant,
    ok: successContractSatisfied,
    successContractSatisfied,
    acceptedForSupportContract: successContractSatisfied,
    releaseEligible,
    releaseVerifierReviewRequired: successContractSatisfied && !releaseEligible,
    finalReleaseDecision: releaseEligible
      ? 'release-verifier-accepted'
      : successContractSatisfied
        ? 'requires-release-verifier-review'
        : 'NO-GO',
    artifactIdHash: validation.artifactIdHash,
    topology: validation.topology,
    importExport: validation.importExport,
    pluginEvidence: validation.pluginEvidence,
    graphEvidence: validation.graphEvidence,
    sameArtifact: validation.sameArtifact,
    releaseVerifier: validation.releaseVerifier,
    artifactHash: validation.sanitizedArtifact
      ? digest(validation.sanitizedArtifact)
      : null,
    failures: validation.failures,
  };
}

function validateObservedImportExportSurvival(observed) {
  if (!observed) {
    return {
      artifactIdHash: null,
      topology: {
        multisite: false,
        addressingMode: null,
        networkConstantsReadback: false,
      },
      importExport: {
        runtime: null,
        realWordPress: false,
        productionBacked: false,
        packagedFallback: false,
        importObserved: false,
        exportObserved: false,
        sequence: [],
        sequenceMatches: false,
      },
      pluginEvidence: missingPluginEvidence(),
      graphEvidence: {
        requiredTypes: [...requiredGraphTypes],
        survivedTypes: [],
        missingTypes: [...requiredGraphTypes],
      },
      sameArtifact: {
        pluginAndGraphBoundToSameArtifact: false,
      },
      releaseVerifier: {
        releaseVerifierAccepted: false,
        productionTopologyAccepted: false,
      },
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress import/export survival artifact was provided.',
      }],
    };
  }

  const topology = observed.topology || {};
  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const releaseVerifier = observed.releaseVerifier || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const importExportSequence = Array.isArray(importExport.sequence) ? importExport.sequence : [];
  const sequenceMatches = arraysEqual(importExportSequence, requiredImportExportSequence);
  const sequenceIncomplete = importExportSequence.length !== requiredImportExportSequence.length;
  const artifactIdHash = isSha256(observed.artifactIdHash) ? observed.artifactIdHash : null;
  const pluginBoundToSameArtifact = artifactIdHash !== null
    && plugin.artifactIdHash === artifactIdHash;
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphTypes.includes(entry?.type)
      && entry.artifactIdHash === artifactIdHash
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.afterImportHash)
      && isSha256(entry.afterExportHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphTypes.filter((type) => !survivedGraphTypes.includes(type));
  const graphBoundToSameArtifact = missingGraphTypes.length === 0;
  const pluginFullySurvived = plugin.driver === pluginDriver
    && plugin.owner === pluginOwner
    && plugin.resourceKeyHash === pluginResourceKeyHash
    && pluginBoundToSameArtifact
    && plugin.survivedImport === true
    && plugin.survivedExport === true
    && isSha256(plugin.preconditionHash)
    && isSha256(plugin.afterImportHash)
    && isSha256(plugin.afterExportHash);
  const sameArtifactSurvival = pluginFullySurvived && graphBoundToSameArtifact;
  const failures = [];

  if (observed.artifactOrigin === 'packaged-fallback' || importExport.packagedFallback === true) {
    failures.push({
      code: 'PACKAGED_FALLBACK_REJECTED',
      reason: 'Packaged fallback artifacts do not prove production-backed WordPress import/export survival.',
    });
  }
  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0889 requires real WordPress import/export, not a local or synthetic substitute.',
    });
  }
  if (observed.runtime === 'local-playground-wordpress') {
    failures.push({
      code: 'PLAYGROUND_SUBSTITUTE_REJECTED',
      reason: 'Playground evidence cannot replace production-backed WordPress import/export survival proof.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_ARTIFACT_REQUIRED',
      reason: 'RPP-0889 remains support-only until production-backed proof is supplied.',
    });
  }
  if (
    topology.multisite !== true
    || topology.addressingMode !== 'subdirectory'
    || topology.networkConstantsReadback !== true
    || !isSha256(topology.siteSurfaceHash)
    || !isSha256(topology.perSiteRouteReceiptsHash)
  ) {
    failures.push({
      code: 'MULTISITE_SUBDIRECTORY_TOPOLOGY_REQUIRED',
      reason: 'The artifact must prove live multisite subdirectory constants and per-site route receipts by hash.',
    });
  }
  if (topology.addressingMode === 'subdomain') {
    failures.push({
      code: 'SUBDOMAIN_SUBSTITUTE_REJECTED',
      reason: 'Subdomain multisite evidence cannot satisfy the subdirectory topology contract.',
    });
  }
  if (importExport.importObserved !== true) {
    failures.push({
      code: 'WORDPRESS_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show WordPress import completion.',
    });
  }
  if (importExport.exportObserved !== true) {
    failures.push({
      code: 'WORDPRESS_EXPORT_AFTER_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show a WordPress export after import.',
    });
  }
  if (![importExport.importedSnapshotHash, importExport.exportedSnapshotHash].every(isSha256)) {
    failures.push({
      code: 'IMPORT_EXPORT_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only imported and exported snapshot evidence.',
    });
  }
  if (!sequenceMatches) {
    failures.push({
      code: 'IMPORT_EXPORT_SEQUENCE_MISMATCH',
      reason: 'The artifact must prove the ordered export, import, post-import export, plugin readback, graph readback, and verifier sequence.',
    });
  }
  if (sequenceIncomplete) {
    failures.push({
      code: 'SEQUENCE_INCOMPLETE_REJECTED',
      reason: 'Partial import/export sequences cannot satisfy RPP-0889.',
    });
  }
  if (!artifactIdHash) {
    failures.push({
      code: 'SAME_ARTIFACT_ID_HASH_MISSING',
      reason: 'The proof must bind plugin and graph evidence to one sanitized artifact ID hash.',
    });
  }
  if (
    plugin.driver !== pluginDriver
    || plugin.owner !== pluginOwner
    || plugin.resourceKeyHash !== pluginResourceKeyHash
  ) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_DRIVER_MISMATCH',
      reason: 'The artifact does not carry the required reprint-push plugin driver evidence.',
    });
  }
  if (!pluginBoundToSameArtifact) {
    failures.push({
      code: 'SAME_ARTIFACT_PLUGIN_BINDING_MISSING',
      reason: 'Plugin evidence is not bound to the same import/export artifact as the graph evidence.',
    });
  }
  if (plugin.survivedImport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_IMPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after import.',
    });
  }
  if (plugin.survivedExport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after export.',
    });
  }
  if (!isSha256(plugin.preconditionHash)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_HASH_MISSING',
      reason: 'Plugin evidence must include a hash-only live precondition.',
    });
  }
  if (!isSha256(plugin.afterImportHash)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_AFTER_IMPORT_HASH_MISSING',
      reason: 'Plugin evidence must include hash-only state after import.',
    });
  }
  if (!isSha256(plugin.afterExportHash)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_AFTER_EXPORT_HASH_MISSING',
      reason: 'Plugin evidence must include hash-only state after the post-import export.',
    });
  }
  if (missingGraphTypes.length > 0) {
    failures.push({
      code: 'GRAPH_EVIDENCE_SURVIVAL_MISSING',
      reason: `Missing graph survival evidence for: ${missingGraphTypes.join(', ')}`,
    });
  }
  if (graphEntries.some((entry) =>
    requiredGraphTypes.includes(entry?.type) && entry.artifactIdHash !== artifactIdHash)) {
    failures.push({
      code: 'SAME_ARTIFACT_GRAPH_BINDING_MISSING',
      reason: 'At least one required graph evidence entry is not bound to the same import/export artifact.',
    });
  }
  if (plugin.survivedImport !== true || plugin.survivedExport !== true || missingGraphTypes.length > 0) {
    failures.push({
      code: 'PARTIAL_SURVIVAL_REJECTED',
      reason: 'RPP-0889 requires both plugin evidence and every required graph type to survive import and export.',
    });
  }
  if (!sameArtifactSurvival) {
    failures.push({
      code: 'SAME_ARTIFACT_PLUGIN_GRAPH_SURVIVAL_REQUIRED',
      reason: 'Plugin and graph evidence must survive in the same production-backed import/export artifact.',
    });
  }

  return {
    artifactIdHash,
    topology: {
      multisite: topology.multisite === true,
      addressingMode: topology.addressingMode || null,
      networkConstantsReadback: topology.networkConstantsReadback === true,
      siteSurfaceHash: isSha256(topology.siteSurfaceHash) ? topology.siteSurfaceHash : null,
      perSiteRouteReceiptsHash: isSha256(topology.perSiteRouteReceiptsHash)
        ? topology.perSiteRouteReceiptsHash
        : null,
    },
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      productionBacked: importExport.productionBacked === true,
      packagedFallback: importExport.packagedFallback === true,
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
      sequence: importExportSequence,
      sequenceMatches,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
        ? importExport.importedSnapshotHash
        : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
        ? importExport.exportedSnapshotHash
        : null,
    },
    pluginEvidence: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      artifactIdHash: isSha256(plugin.artifactIdHash) ? plugin.artifactIdHash : null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
      afterImportHash: isSha256(plugin.afterImportHash) ? plugin.afterImportHash : null,
      afterExportHash: isSha256(plugin.afterExportHash) ? plugin.afterExportHash : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphTypes],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    sameArtifact: {
      pluginAndGraphBoundToSameArtifact: sameArtifactSurvival,
    },
    releaseVerifier: {
      releaseVerifierAccepted: releaseVerifier.releaseVerifierAccepted === true,
      productionTopologyAccepted: releaseVerifier.productionTopologyAccepted === true,
    },
    sanitizedArtifact: {
      artifactIdHash,
      artifactOrigin: observed.artifactOrigin || null,
      runtime: observed.runtime || null,
      topology: {
        multisite: topology.multisite === true,
        addressingMode: topology.addressingMode || null,
        networkConstantsReadback: topology.networkConstantsReadback === true,
        siteSurfaceHash: isSha256(topology.siteSurfaceHash) ? topology.siteSurfaceHash : null,
        perSiteRouteReceiptsHash: isSha256(topology.perSiteRouteReceiptsHash)
          ? topology.perSiteRouteReceiptsHash
          : null,
      },
      importExport: {
        realWordPress: importExport.realWordPress === true,
        productionBacked: importExport.productionBacked === true,
        packagedFallback: importExport.packagedFallback === true,
        importObserved: importExport.importObserved === true,
        exportObserved: importExport.exportObserved === true,
        sequence: importExportSequence,
        sequenceMatches,
        importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
          ? importExport.importedSnapshotHash
          : null,
        exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
          ? importExport.exportedSnapshotHash
          : null,
      },
      plugin: {
        driver: plugin.driver || null,
        owner: plugin.owner || null,
        resourceKeyHash: plugin.resourceKeyHash || null,
        artifactIdHash: isSha256(plugin.artifactIdHash) ? plugin.artifactIdHash : null,
        survivedImport: plugin.survivedImport === true,
        survivedExport: plugin.survivedExport === true,
        preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
        afterImportHash: isSha256(plugin.afterImportHash) ? plugin.afterImportHash : null,
        afterExportHash: isSha256(plugin.afterExportHash) ? plugin.afterExportHash : null,
      },
      graph: graphEntries.map((entry) => ({
        type: entry?.type || null,
        artifactIdHash: isSha256(entry?.artifactIdHash) ? entry.artifactIdHash : null,
        survivedImport: entry?.survivedImport === true,
        survivedExport: entry?.survivedExport === true,
        preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
        afterImportHash: isSha256(entry?.afterImportHash) ? entry.afterImportHash : null,
        afterExportHash: isSha256(entry?.afterExportHash) ? entry.afterExportHash : null,
        roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
      })),
      releaseVerifier: {
        releaseVerifierAccepted: releaseVerifier.releaseVerifierAccepted === true,
        productionTopologyAccepted: releaseVerifier.productionTopologyAccepted === true,
      },
    },
    failures,
  };
}

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0889 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertRoleSurfaces(routeRoleSurfaces) {
  assert.deepEqual(routeRoleSurfaces.map((surface) => surface.role), [
    'source',
    'local-edited',
    'remote-changed',
  ]);
  assert.equal(new Set(routeRoleSurfaces.map((surface) => surface.roleIdentityHash)).size, 3);

  for (const surface of routeRoleSurfaces) {
    assert.match(surface.roleIdentityHash, hexSha256Pattern);
    assert.equal(surface.rawHostIncluded, false);
    assert.equal(surface.rawUrlIncluded, false);
    assert.equal(surface.networkCount, 1);
    assert.equal(surface.siteCount, 2);
    assert.deepEqual(surface.siteAddressingSurfaces, [
      'network-root',
      'child-subdirectory',
    ]);
  }
}

function assertSurfaceCountsMatch(candidateScope) {
  assert.equal(candidateScope.countEvidence.routeRoleCount, candidateScope.routeRoleSurfaces.length);
  assert.equal(candidateScope.countEvidence.networkCountPerRouteRole, 1);
  assert.equal(candidateScope.countEvidence.siteCountPerRouteRole, 2);
  assert.equal(
    candidateScope.countEvidence.totalNetworkCount,
    candidateScope.routeRoleSurfaces.reduce((total, role) => total + role.networkCount, 0),
  );
  assert.equal(
    candidateScope.countEvidence.totalSiteCount,
    candidateScope.routeRoleSurfaces.reduce((total, role) => total + role.siteCount, 0),
  );
  assert.equal(candidateScope.countEvidence.networkTableSurfaceCount, candidateScope.networkTables.length);
  assert.equal(candidateScope.countEvidence.siteScopedTableSurfaceCount, candidateScope.siteScopedTables.length);
  assert.equal(candidateScope.countEvidence.configurationSurfaceCount, candidateScope.configurationSurface.length);
  assert.equal(
    candidateScope.countEvidence.requiredPluginSurvivalCount,
    candidateScope.importExportSurvivalSurface.requiredPluginSurvival.length,
  );
  assert.equal(
    candidateScope.countEvidence.requiredGraphTypeCount,
    candidateScope.importExportSurvivalSurface.requiredGraphTypes.length,
  );
  assert.equal(
    candidateScope.countEvidence.requiredGraphSurvivalCount,
    candidateScope.importExportSurvivalSurface.requiredGraphSurvival.length,
  );
  assert.equal(
    candidateScope.countEvidence.explicitRejectionRuleCount,
    candidateScope.importExportSurvivalSurface.rejectedSubstitutes.length,
  );
  assert.equal(
    candidateScope.countEvidence.importExportTopologySequenceStepCount,
    candidateScope.importExportTopologySequence.requiredOrder.length,
  );
  assert.deepEqual(candidateScope.importExportTopologySequence.requiredOrder, [
    ...requiredImportExportSequence,
  ]);
  assert.equal(candidateScope.countEvidence.focusedSupportSurfaceCount, candidateScope.focusedSupportSurfaces.length);
  assert.equal(candidateScope.countEvidence.focusedSupportSurfaceCount, candidateScope.surfaceEvidence.length);
  assert.equal(candidateScope.countEvidence.releaseVerifierCarryThroughSurfaceCount, 1);
  assert.equal(candidateScope.countEvidence.importExportBlockerCount, candidateScope.importExportBlockers.length);
  assert.equal(candidateScope.countEvidence.releaseReadyGapCount, candidateScope.releaseReadyGaps.length);
  assert.equal(
    candidateScope.countEvidence.runtimeGapCategoryCount,
    Object.keys(candidateScope.runtimeGapCategories).length,
  );
  assert.equal(candidateScope.countEvidence.unavailableCapabilityCount, 4);
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
    'MULTISITE',
    'SUBDOMAIN_INSTALL=false',
    'DOMAIN_CURRENT_SITE',
    'PATH_CURRENT_SITE',
    'SITE_ID_CURRENT_SITE',
    'BLOG_ID_CURRENT_SITE',
  ];
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
      surface: 'route-role-identity',
      surfaceType: 'hash-count',
      countKeys: ['routeRoleCount', 'totalNetworkCount', 'totalSiteCount'],
      fields: ['role', 'routeRole', 'roleIdentityHash', 'networkCount', 'siteCount'],
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
      surface: 'plugin-survival-contract',
      surfaceType: 'survival-count',
      fields: ['pluginDriver', 'pluginOwner', 'pluginResourceKeyHash', 'requiredPluginSurvival'],
      countKeys: ['requiredPluginSurvivalCount'],
    },
    {
      surface: 'graph-survival-contract',
      surfaceType: 'survival-count',
      fields: [...requiredGraphTypes],
      countKeys: ['requiredGraphTypeCount', 'requiredGraphSurvivalCount'],
    },
    {
      surface: 'same-artifact-survival-contract',
      surfaceType: 'same-artifact-count',
      fields: [
        'sameArtifactEvidenceRequired',
        'sameArtifactBindingHash',
        'pluginEvidenceArtifactIdHash',
        'graphEvidenceArtifactIdHash',
      ],
      countKeys: ['requiredPluginSurvivalCount', 'requiredGraphSurvivalCount'],
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
      surface: 'import-export-topology-sequence-gaps',
      surfaceType: 'sequence-gap-count',
      fields: [...requiredImportExportSequence],
      countKeys: ['importExportTopologySequenceStepCount', 'productionTopologyEvidenceCount'],
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
        'sameArtifactPluginGraphSurvivalRequired',
      ],
      countKeys: ['releaseVerifierCarryThroughSurfaceCount', 'productionTopologyEvidenceCount'],
    },
    {
      surface: 'release-gate-boundary',
      surfaceType: 'no-go-count',
      fields: ['supportOnly', 'failClosed', 'productionBacked', 'releaseEligible', 'finalReleaseStatus', 'integrationRecommendation'],
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
    successContract: report.successContract,
  };
}

function missingPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKeyHash: pluginResourceKeyHash,
    artifactIdHash: null,
    survivedImport: false,
    survivedExport: false,
    preconditionHash: null,
    afterImportHash: null,
    afterExportHash: null,
  };
}

function successfulSameArtifactSubdirectoryImportExportArtifact() {
  const artifactIdHash = sampleHash('production-import-export-artifact');

  return {
    artifactIdHash,
    artifactOrigin: 'production-release-verifier-candidate-artifact',
    runtime: 'real-wordpress-import-export',
    topology: {
      multisite: true,
      addressingMode: 'subdirectory',
      networkConstantsReadback: true,
      siteSurfaceHash: sampleHash('site-surface'),
      perSiteRouteReceiptsHash: sampleHash('per-site-route-receipts'),
    },
    importExport: {
      realWordPress: true,
      productionBacked: true,
      packagedFallback: false,
      importObserved: true,
      exportObserved: true,
      sequence: [...requiredImportExportSequence],
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      artifactIdHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash('plugin-precondition'),
      afterImportHash: sampleHash('plugin-after-import'),
      afterExportHash: sampleHash('plugin-after-export'),
    },
    graphEvidence: requiredGraphTypes.map((type) => ({
      type,
      artifactIdHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      afterImportHash: sampleHash(`${type}-after-import`),
      afterExportHash: sampleHash(`${type}-after-export`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
    releaseVerifier: {
      releaseVerifierAccepted: false,
      productionTopologyAccepted: false,
    },
  };
}

function sampleHash(label) {
  return digest({ rpp: 'RPP-0889', label });
}

function isSha256(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
