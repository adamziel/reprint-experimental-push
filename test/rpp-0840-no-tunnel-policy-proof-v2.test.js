import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  dockerReleaseCommand,
  dockerTopologyVariant,
  forbiddenPackagedFallbackEnvKeys,
  forbiddenTunnelBinaries,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0840-no-tunnel-policy-proof-v2.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0840-no-tunnel-policy-proof-v2';
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawEvidenceNeedles = Object.freeze([
  'ngrok http',
  'cloudflared tunnel',
  'localtunnel --port',
  'lt --port',
  'serveo.net',
  'localhost.run',
  'lhr.life',
  'tailscale funnel',
  'http://',
  'https://',
]);
const tunnelDomainSurfaces = Object.freeze(
  forbiddenTunnelBinaries
    .map((surface) => domainSurfaceForForbidden(surface))
    .filter(Boolean),
);

test('RPP-0840 progress report records candidate versus release-ready no-tunnel scope', () => {
  const { report, text } = loadProgressReport();
  const expected = buildNoTunnelPolicyProof();

  assert.deepEqual(report, expected);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0840');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 2);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);
  assert.match(report.scopeComparisonHash, sha256EvidencePattern);
  assert.equal(report.scopeComparisonHash, sha256Evidence(scopeComparisonInput(report)));
  assert.match(report.proofHash, sha256EvidencePattern);
  assert.equal(report.proofHash, sha256Evidence(proofHashInput(report)));
});

test('RPP-0840 rejects known tunnel command and domain surfaces without invoking tools', () => {
  const matrix = buildNoTunnelPolicyMatrix();

  assert.equal(matrix.commandRejections.length, forbiddenTunnelBinaries.length);
  assert.equal(matrix.domainRejections.length, tunnelDomainSurfaces.length);
  for (const entry of [...matrix.commandRejections, ...matrix.domainRejections]) {
    assert.equal(entry.invoked, false);
    assert.equal(entry.installed, false);
    assert.equal(entry.validation.ok, false);
    assert.ok(
      entry.validation.failures.some((failure) =>
        failure.code === 'FORBIDDEN_TUNNEL_REFERENCE' && failure.forbidden === entry.forbidden),
      `${entry.surface} should reject ${entry.forbidden}`,
    );
  }

  const report = buildNoTunnelPolicyProof();
  assert.equal(report.noTunnelPolicy.knownForbiddenSurfaceCount, forbiddenTunnelBinaries.length);
  assert.equal(report.noTunnelPolicy.commandSurfaceCount, forbiddenTunnelBinaries.length);
  assert.equal(report.noTunnelPolicy.commandSurfaceRejectionCount, forbiddenTunnelBinaries.length);
  assert.equal(report.noTunnelPolicy.domainSurfaceCount, tunnelDomainSurfaces.length);
  assert.equal(report.noTunnelPolicy.domainSurfaceRejectionCount, tunnelDomainSurfaces.length);
  assert.equal(report.noTunnelPolicy.rejectionCode, 'FORBIDDEN_TUNNEL_REFERENCE');
  assert.equal(report.noTunnelPolicy.tunnelToolsInstalledOrInvoked, false);
  assert.equal(report.noTunnelPolicy.tunnelProcessesStarted, false);
  assert.equal(report.noTunnelPolicy.liveNetworkProbes, false);
});

test('RPP-0840 permits only local sandbox ingress semantics', () => {
  const matrix = buildNoTunnelPolicyMatrix();
  const base = matrix.allowedIngress.find((entry) => entry.surface === 'sandbox-127-0-0-1-8080');
  const localhostAlias = matrix.allowedIngress.find((entry) => entry.surface === 'sandbox-localhost-8080');

  assert.equal(base.validation.ok, true);
  assert.equal(base.validation.checks.onePublishedPort, true);
  assert.equal(base.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(base.publishedHttpIngressCount, 1);
  assert.equal(base.hostPort, 8080);
  assert.equal(localhostAlias.validation.ok, true);
  assert.equal(localhostAlias.validation.checks.onlySandbox8080Ingress, true);

  assert.deepEqual(
    matrix.ingressRejections.map((entry) => entry.surface),
    [
      'public-host-8080-rejected',
      'sandbox-host-non-8080-rejected',
      'multiple-http-ingress-rejected',
    ],
  );
  for (const entry of matrix.ingressRejections) {
    assert.equal(entry.validation.ok, false);
    assert.ok(
      entry.validation.failures.some((failure) => entry.expectedCodes.includes(failure.code)),
      `${entry.surface} should reject with one of ${entry.expectedCodes.join(', ')}`,
    );
  }

  const report = buildNoTunnelPolicyProof();
  assert.equal(report.localSandboxIngress.onlySandbox8080Ingress, true);
  assert.equal(report.localSandboxIngress.publishedHttpIngressCount, 1);
  assert.equal(report.localSandboxIngress.permittedHost, '127.0.0.1');
  assert.equal(report.localSandboxIngress.permittedPort, 8080);
  assert.equal(report.localSandboxIngress.localhostAliasAccepted, true);
  assert.equal(report.localSandboxIngress.publicHostRejected, true);
  assert.equal(report.localSandboxIngress.non8080PortRejected, true);
  assert.equal(report.localSandboxIngress.multiplePublishedPortsRejected, true);
  assert.equal(report.localSandboxIngress.networkInternal, true);
});

test('RPP-0840 keeps packaged fallback disabled and release movement at NO-GO', () => {
  const matrix = buildNoTunnelPolicyMatrix();

  assert.equal(matrix.packagedFallbackRejections.length, 1 + forbiddenPackagedFallbackEnvKeys.length);
  for (const entry of matrix.packagedFallbackRejections) {
    assert.equal(entry.validation.ok, false);
    assert.ok(
      entry.validation.failures.some((failure) => entry.expectedCodes.includes(failure.code)),
      `${entry.surface} should reject fallback enablement`,
    );
  }

  const report = buildNoTunnelPolicyProof();
  assert.equal(report.packagedFallback.disabled, true);
  assert.equal(report.packagedFallback.runnerPackagedFallbackAllowed, false);
  assert.equal(report.packagedFallback.releaseCommand, dockerReleaseCommand.join(' '));
  assert.equal(report.releaseGate.releaseMovementAllowed, false);
  assert.equal(report.releaseGate.acceptedForReleaseGate, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0840 evidence remains deterministic hash/count/surface-only', () => {
  const first = buildNoTunnelPolicyProof();
  const second = buildNoTunnelPolicyProof();
  const { report, text } = loadProgressReport();

  assert.deepEqual(first, second);
  assert.deepEqual(report, first);
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0840 no-tunnel policy proof v2' }));
  assert.deepEqual(report.evidenceLimits, {
    mode: 'hash-count-surface-only',
    payloadsStored: false,
    rawPayloadCount: 0,
    rawCommandPayloadsIncluded: false,
    rawUrlPayloadsIncluded: false,
    sensitiveSurfaceCount: 0,
    tunnelToolInvocationCount: 0,
    liveNetworkProbeCount: 0,
    wordpressRouteCallCount: 0,
    surfaceCount: report.policySurfaces.surfaceCount,
    acceptedSurfaceCount: report.policySurfaces.acceptedSurfaceCount,
    rejectedSurfaceCount: report.policySurfaces.rejectedSurfaceCount,
    surfaceHash: report.policySurfaces.surfaceHash,
  });

  for (const needle of rawEvidenceNeedles) {
    assert.equal(text.includes(needle), false, `RPP-0840 evidence leaked raw tunnel or URL payload ${needle}`);
  }
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0840 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildNoTunnelPolicyProof() {
  const matrix = buildNoTunnelPolicyMatrix();
  const basePlan = buildBasePlan();
  const policySurfaces = buildPolicySurfaces(matrix);
  const candidateScope = {
    status: 'no-tunnel-policy-candidate-v2',
    sourcePattern: 'RPP-0820-no-tunnel-policy-pattern',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    releaseGateMovement: 'none',
    productionMovementRecorded: false,
    candidateClaims: [
      'topology-policy-surface-recorded',
      'known-tunnel-command-surfaces-rejected',
      'known-tunnel-domain-surfaces-rejected',
      'sandbox-8080-ingress-only',
      'packaged-fallback-disabled',
      'release-ready-gaps-recorded',
    ],
    excludedFromCandidate: [
      'live-tunnel-process-scan',
      'live-public-callback-url-observation',
      'docker-backed-release-verifier-pass',
      'release-gate-acceptance',
      'production-readback-of-running-topology',
    ],
  };
  const releaseReadyScope = {
    status: 'not-release-ready',
    productionMovement: {
      candidatePercentMovement: 'none',
      releaseReadyPercentMovement: 'none',
      finalReleaseReadinessMovement: 'none',
    },
    requiredEvidence: [
      'docker-capable-topology-started',
      'verify-release-passes-without-packaged-fallback',
      'release-gate-artifact-accepted',
      'production-backed-local-only-topology-readback',
      'integration-run-confirms-no-public-tunnel-process-or-url',
    ],
    blockers: [
      'support-only-local-policy-evidence',
      'no-docker-backed-topology-started-in-this-proof',
      'no-live-network-probes-or-wordpress-route-calls',
      'release-gates-not-moved',
    ],
    readyWhen: 'all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true',
  };
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0840',
    proofId,
    variant: 2,
    title: 'No tunnel policy proof candidate scope variant 2',
    checkedAt: fixedNow,
    status: 'passed-support-only',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    progressReport: {
      recordsCandidateVersusReleaseReadyScope: true,
      candidateLabel: 'candidate',
      releaseReadyLabel: 'release-ready',
      percentMovement: 'none',
      finalReleaseReadinessMovement: 'none',
    },
    candidateScope,
    releaseReadyScope,
    noTunnelPolicy: {
      sourcePattern: 'RPP-0820-no-tunnel-policy-pattern',
      topologyVariant: dockerTopologyVariant,
      knownForbiddenSurfaceCount: forbiddenTunnelBinaries.length,
      knownForbiddenSurfaceHash: sha256Evidence(forbiddenTunnelBinaries),
      commandSurfaceCount: matrix.commandRejections.length,
      commandSurfaceRejectionCount: matrix.commandRejections.length,
      domainSurfaceCount: matrix.domainRejections.length,
      domainSurfaceRejectionCount: matrix.domainRejections.length,
      rejectionCode: 'FORBIDDEN_TUNNEL_REFERENCE',
      tunnelToolsInstalledOrInvoked: false,
      tunnelProcessesStarted: false,
      liveNetworkProbes: false,
    },
    localSandboxIngress: {
      onlySandbox8080Ingress: true,
      publishedHttpIngressCount: basePlan.publishedPorts.length,
      permittedHost: basePlan.publishedPorts[0].host,
      permittedPort: basePlan.publishedPorts[0].hostPort,
      localhostAliasAccepted: matrix.allowedIngress
        .some((entry) => entry.surface === 'sandbox-localhost-8080' && entry.validation.ok),
      publicHostRejected: rejectionSurfaceOk(matrix.ingressRejections, 'public-host-8080-rejected'),
      non8080PortRejected: rejectionSurfaceOk(matrix.ingressRejections, 'sandbox-host-non-8080-rejected'),
      multiplePublishedPortsRejected: rejectionSurfaceOk(matrix.ingressRejections, 'multiple-http-ingress-rejected'),
      releaseVerifierTraffic: 'docker-service-dns-only',
      releaseUrlsUseDockerDns: basePlan.validation.checks.releaseUrlsUseDockerDns,
      networkInternal: basePlan.validation.checks.internalNetwork,
      ingressRejectionCodes: [
        'MULTIPLE_PUBLISHED_HTTP_PORTS',
        'NON_LOCAL_OR_NON_8080_PORT',
      ],
    },
    packagedFallback: {
      disabled: basePlan.runner.packagedFallbackAllowed === false,
      runnerPackagedFallbackAllowed: basePlan.runner.packagedFallbackAllowed,
      releaseCommand: dockerReleaseCommand.join(' '),
      fallbackFlagRejected: rejectionSurfaceOk(
        matrix.packagedFallbackRejections,
        'packaged-fallback-runner-flag-rejected',
      ),
      fallbackEnvRejectedCount: matrix.packagedFallbackRejections
        .filter((entry) => entry.surface.startsWith('packaged-fallback-env-')).length,
      fallbackRejectionCodes: [
        'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED',
        'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED',
      ],
    },
    releaseGate: {
      acceptedForReleaseGate: false,
      releaseMovementAllowed: false,
      releaseGatesMoved: false,
      finalReleaseStatus: 'NO-GO',
      integrationRecommendation: 'NO-GO',
    },
    policySurfaces,
    evidenceLimits: {
      mode: 'hash-count-surface-only',
      payloadsStored: false,
      rawPayloadCount: 0,
      rawCommandPayloadsIncluded: false,
      rawUrlPayloadsIncluded: false,
      sensitiveSurfaceCount: 0,
      tunnelToolInvocationCount: 0,
      liveNetworkProbeCount: 0,
      wordpressRouteCallCount: 0,
      surfaceCount: policySurfaces.surfaceCount,
      acceptedSurfaceCount: policySurfaces.acceptedSurfaceCount,
      rejectedSurfaceCount: policySurfaces.rejectedSurfaceCount,
      surfaceHash: policySurfaces.surfaceHash,
    },
    redaction: {
      format: 'hash-count-surface-only',
      rawTunnelCommandsIncluded: false,
      rawTunnelDomainsIncluded: false,
      rawUrlsIncluded: false,
      credentialMaterialIncluded: false,
      scopeComparisonHashCovers: [
        'candidateScope',
        'releaseReadyScope',
        'noTunnelPolicy',
        'localSandboxIngress',
        'packagedFallback',
        'policySurfaces',
        'releaseGate',
        'integrationRecommendation',
      ],
    },
  };
  const withScopeHash = {
    ...proofCore,
    scopeComparisonHash: sha256Evidence(scopeComparisonInput(proofCore)),
  };
  return {
    ...withScopeHash,
    proofHash: sha256Evidence(proofHashInput(withScopeHash)),
  };
}

function buildNoTunnelPolicyMatrix() {
  return {
    allowedIngress: [
      allowedIngressSurface('sandbox-127-0-0-1-8080', buildBasePlan()),
      allowedIngressSurface('sandbox-localhost-8080', buildBasePlan({ inspectionHost: 'localhost' })),
    ],
    ingressRejections: [
      rejectedSurface('public-host-8080-rejected', ['NON_LOCAL_OR_NON_8080_PORT'], clonePlanWith((plan) => {
        plan.publishedPorts[0].host = '0.0.0.0';
      })),
      rejectedSurface('sandbox-host-non-8080-rejected', ['NON_LOCAL_OR_NON_8080_PORT'], clonePlanWith((plan) => {
        plan.publishedPorts[0].hostPort = 8081;
      })),
      rejectedSurface('multiple-http-ingress-rejected', ['MULTIPLE_PUBLISHED_HTTP_PORTS'], clonePlanWith((plan) => {
        plan.publishedPorts.push({
          service: 'wp-remote-changed',
          host: '127.0.0.1',
          hostPort: 8080,
          containerPort: 80,
          purpose: 'policy rejection fixture only',
        });
      })),
    ],
    commandRejections: forbiddenTunnelBinaries.map((forbidden) =>
      rejectedSurface(`tunnel-command-${surfaceSlug(forbidden)}-rejected`, ['FORBIDDEN_TUNNEL_REFERENCE'], clonePlanWith((plan) => {
        plan.runner.plannerProofCommand = ['policy-fixture', forbidden];
      }), {
        forbidden,
        invoked: false,
        installed: false,
      })),
    domainRejections: tunnelDomainSurfaces.map((entry) =>
      rejectedSurface(`tunnel-domain-${entry.slug}-rejected`, ['FORBIDDEN_TUNNEL_REFERENCE'], clonePlanWith((plan) => {
        plan.releaseEnv.REPRINT_PUSH_SOURCE_URL = `http://${entry.domain}`;
      }), {
        forbidden: entry.forbidden,
        invoked: false,
        installed: false,
      })),
    packagedFallbackRejections: [
      rejectedSurface('packaged-fallback-runner-flag-rejected', ['DOCKER_PACKAGED_FALLBACK_NOT_DISABLED'], clonePlanWith((plan) => {
        plan.runner.packagedFallbackAllowed = true;
      })),
      ...forbiddenPackagedFallbackEnvKeys.map((key) =>
        rejectedSurface(`packaged-fallback-env-${surfaceSlug(key)}-rejected`, ['DOCKER_PACKAGED_FALLBACK_ENV_ENABLED'], clonePlanWith((plan) => {
          plan.releaseEnv[key] = key === 'REPRINT_PUSH_PACKAGE_SMOKE_MODE'
            ? 'driver-guard-only'
            : '1';
        }))),
    ],
  };
}

function buildPolicySurfaces(matrix) {
  const surfaceNames = [
    'base-topology-allows-sandbox-8080',
    'localhost-alias-allows-sandbox-8080',
    'non-local-ingress-rejected',
    'non-8080-ingress-rejected',
    'multiple-http-ingress-rejected',
    'known-tunnel-command-surfaces-rejected',
    'known-tunnel-domain-surfaces-rejected',
    'packaged-fallback-plan-flag-rejected',
    'packaged-fallback-env-flags-rejected',
    'release-verifier-stays-on-npm-run-verify-release',
  ];
  const rejectionCodes = [
    'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED',
    'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED',
    'FORBIDDEN_TUNNEL_REFERENCE',
    'MULTIPLE_PUBLISHED_HTTP_PORTS',
    'NON_LOCAL_OR_NON_8080_PORT',
  ];
  const acceptedSurfaceCount = matrix.allowedIngress.length + 1;
  const rejectedSurfaceCount = matrix.ingressRejections.length
    + matrix.commandRejections.length
    + matrix.domainRejections.length
    + matrix.packagedFallbackRejections.length;
  const surfaceHashInput = {
    surfaceNames,
    acceptedSurfaceCount,
    rejectedSurfaceCount,
    commandSurfaceCount: matrix.commandRejections.length,
    domainSurfaceCount: matrix.domainRejections.length,
    ingressRejectedSurfaceCount: matrix.ingressRejections.length,
    packagedFallbackRejectedSurfaceCount: matrix.packagedFallbackRejections.length,
    rejectionCodes,
  };

  return {
    format: 'surface-count-hash-only',
    rawCommandPayloadsIncluded: false,
    rawUrlPayloadsIncluded: false,
    acceptedSurfaceCount,
    rejectedSurfaceCount,
    surfaceCount: surfaceNames.length,
    knownForbiddenSurfaceCount: forbiddenTunnelBinaries.length,
    commandSurfaceCount: matrix.commandRejections.length,
    domainSurfaceCount: matrix.domainRejections.length,
    ingressRejectedSurfaceCount: matrix.ingressRejections.length,
    packagedFallbackRejectedSurfaceCount: matrix.packagedFallbackRejections.length,
    rejectionCodeCount: rejectionCodes.length,
    rejectionCodes,
    surfaceNames,
    surfaceHash: sha256Evidence(surfaceHashInput),
  };
}

function allowedIngressSurface(surface, plan) {
  return {
    surface,
    validation: plan.validation,
    publishedHttpIngressCount: plan.publishedPorts.length,
    hostPort: plan.publishedPorts[0]?.hostPort,
  };
}

function rejectedSurface(surface, expectedCodes, plan, extra = {}) {
  return {
    surface,
    expectedCodes,
    validation: plan.validation,
    ...extra,
  };
}

function clonePlanWith(mutator) {
  const plan = JSON.parse(JSON.stringify(buildBasePlan()));
  mutator(plan);
  return {
    ...plan,
    validation: validateTopologyPlan(plan),
  };
}

function buildBasePlan(options = {}) {
  return buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0840-docker-work',
    evidenceDir: '/tmp/rpp-0840-docker-evidence',
    env: {},
    ...options,
  });
}

function rejectionSurfaceOk(rejections, surface) {
  const entry = rejections.find((candidate) => candidate.surface === surface);
  return Boolean(
    entry
      && entry.validation.ok === false
      && entry.validation.failures.some((failure) => entry.expectedCodes.includes(failure.code)),
  );
}

function domainSurfaceForForbidden(forbidden) {
  if (forbidden === 'tailscale funnel') {
    return null;
  }
  const slug = surfaceSlug(forbidden);
  return {
    forbidden,
    slug,
    domain: forbidden.includes('.') ? `${forbidden}.policy.invalid` : `${slug}.policy.invalid`,
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    releaseReadyScope: report.releaseReadyScope,
    noTunnelPolicy: report.noTunnelPolicy,
    localSandboxIngress: report.localSandboxIngress,
    packagedFallback: report.packagedFallback,
    policySurfaces: report.policySurfaces,
    releaseGate: report.releaseGate,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function proofHashInput(report) {
  const { proofHash, ...withoutProofHash } = report;
  return withoutProofHash;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function surfaceSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
