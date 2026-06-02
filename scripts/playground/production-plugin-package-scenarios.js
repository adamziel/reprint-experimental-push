const arbitraryPluginFixturePackageBoundary = Object.freeze({
  plugin: 'driver-fixture/driver-fixture.php',
  driver: 'fixture-arbitrary-plugin-table',
  pluginOwner: 'driver-fixture',
  table: 'wp_reprint_push_driver_fixture',
  resourceKey: 'row:[\"wp_reprint_push_driver_fixture\",\"entry_id:1\"]',
  scenario: 'driver-receipt-guards',
});

const localArbitraryPluginFixturePackageEvidenceScope = 'local-playground';
const productionBackedEvidenceScope = 'production-backed';
const sha256EvidencePattern = /^(?:sha256:)?[a-f0-9]{64}$/;

const scenarioGroups = {
  'source-mutation-guards': [
    'core-db-file-guarded-apply',
  ],
  'arbitrary-plugin-fixture-package': [
    'driver-receipt-guards',
  ],
  'driver-verifier-guards': [
    'driver-receipt-guards',
    'driver-noncanonical-contract-evidence-guard',
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-production-boundary-guards': [
    'driver-receipt-guards',
    'driver-activation-hook-effects-boundary',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-owner-driver-allowlist-guards': [
    'driver-missing-plugin-owner-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-activation-hook-effects-guards': [
    'driver-activation-hook-effects-boundary',
  ],
  'driver-registration-guards': [
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
  'driver-callback-guards': [
    'driver-missing-export-guard',
    'driver-missing-apply-guard',
    'driver-missing-validate-guard',
  ],
  'driver-registration-shape-guards': [
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
  ],
};

const scenarioNames = [
  'core-package-routes',
  'core-db-file-guarded-apply',
  'driver-receipt-guards',
  'driver-noncanonical-contract-evidence-guard',
  'driver-activation-hook-effects-boundary',
  'driver-delete-apply',
  'driver-missing-export-guard',
  'driver-missing-apply-guard',
  'driver-missing-validate-guard',
  'driver-missing-name-guard',
  'driver-missing-plugin-owner-guard',
  'driver-missing-table-guard',
  'driver-duplicate-name-guard',
  'driver-duplicate-table-guard',
];

const knownScenarioNames = new Set([
  ...scenarioNames,
  ...Object.keys(scenarioGroups),
]);

export function summarizeArbitraryPluginFixturePackageEvidence(summary = {}) {
  const fixtureProof = summary.arbitraryPluginFixturePackageProof
    || summary.arbitraryPluginFixturePackage
    || {};
  const guard = summary.driverReceiptRevokedCredentialGuard
    || summary.packagedRevokedCredentialGuard
    || {};
  const rowRetainedAfterReject = guard.rowRetainedAfterReject === true;
  const remoteDataPreserved = rowRetainedAfterReject
    && guard.updatedMarkerAfterReject === 'base'
    && guard.payloadModeAfterReject === 'base';
  const applyRejectedCode = typeof guard.applyRejectedCode === 'string' && guard.applyRejectedCode
    ? guard.applyRejectedCode
    : null;
  const evidenceScope = resolveArbitraryPluginFixturePackageEvidenceScope(fixtureProof, summary);
  const productionScoped = arbitraryPluginFixturePackageEvidenceIsProductionScoped(fixtureProof, evidenceScope);
  const registeredContractProvenance =
    arbitraryPluginFixturePackageRegisteredContractProvenance(fixtureProof);
  const productionBacked = productionScoped && registeredContractProvenance.accepted;
  const packageChecksComplete = remoteDataPreserved
    && Boolean(applyRejectedCode)
    && fixtureProof.planReady !== false
    && fixtureProof.allowlistExact !== false
    && fixtureProof.noMutationAfterRevokedCredential !== false;
  const checked = packageChecksComplete
    && (!productionScoped || registeredContractProvenance.accepted);
  const releaseGate = buildArbitraryPluginFixturePackageReleaseGate({
    checked,
    packageChecksComplete,
    evidenceScope,
    productionScoped,
    productionBacked,
    registeredContractProvenanceAccepted: registeredContractProvenance.accepted,
  });

  return {
    plugin: arbitraryPluginFixturePackageBoundary.plugin,
    driver: arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
    table: arbitraryPluginFixturePackageBoundary.table,
    resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
    scenario: arbitraryPluginFixturePackageBoundary.scenario,
    proofKind: 'arbitrary-plugin-fixture-package',
    sourceKind: productionBacked
      ? productionBackedEvidenceScope
      : (fixtureProof.sourceKind || localArbitraryPluginFixturePackageEvidenceScope),
    evidenceScope,
    releaseGateEvidenceScope: evidenceScope,
    productionScoped,
    productionBacked,
    supportOnly: !productionBacked,
    checked,
    packageChecksComplete,
    registeredContractProvenanceAccepted: registeredContractProvenance.accepted,
    remoteDataPreserved,
    acceptedForReleaseGate: releaseGate.acceptedForReleaseGate,
    releaseGate,
    packageProof: {
      allowlistExact: fixtureProof.allowlistExact === true,
      planReady: fixtureProof.planReady === true,
      mutationCount: Number.isFinite(fixtureProof.mutationCount) ? fixtureProof.mutationCount : null,
      noMutationAfterRevokedCredential: fixtureProof.noMutationAfterRevokedCredential === true,
      registeredContractProvenanceAccepted: registeredContractProvenance.accepted,
      registeredDriverProvenanceHash: registeredContractProvenance.evidenceHash,
      contractHash: registeredContractProvenance.contractHash,
      contractValidationHash: registeredContractProvenance.contractValidationHash,
    },
    revokedCredentialGuard: {
      resourceKey: typeof guard.resourceKey === 'string' ? guard.resourceKey : arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode,
      rowRetainedAfterReject,
      updatedMarkerAfterReject: guard.updatedMarkerAfterReject || null,
      payloadModeAfterReject: guard.payloadModeAfterReject || null,
    },
  };
}

function resolveArbitraryPluginFixturePackageEvidenceScope(proof = {}, summary = {}) {
  return normalizeArbitraryPluginFixturePackageEvidenceScope(
    proof.releaseGateEvidenceScope
      || proof.evidenceScope
      || proof.releaseGate?.evidenceScope
      || summary.releaseGateEvidenceScope
      || summary.evidenceScope
      || (proof.productionBacked === true || proof.sourceKind === productionBackedEvidenceScope
        ? productionBackedEvidenceScope
        : localArbitraryPluginFixturePackageEvidenceScope),
  );
}

function arbitraryPluginFixturePackageEvidenceIsProductionScoped(proof = {}, evidenceScope = '') {
  return proof.productionBacked === true
    || proof.sourceKind === productionBackedEvidenceScope
    || proof.releaseGate?.productionBacked === true
    || evidenceScope === productionBackedEvidenceScope;
}

function arbitraryPluginFixturePackageRegisteredContractProvenance(proof = {}) {
  const nested = proof.registeredContractProvenance
    || proof.registeredDriverProvenance
    || {};
  const evidenceHash = firstSha256Evidence(
    proof.registeredDriverProvenanceHash,
    proof.registeredContractProvenanceHash,
    proof.registrationProvenanceHash,
    nested.evidenceHash,
    nested.registeredDriverProvenanceHash,
    nested.registrationProvenanceHash,
  );
  const contractHash = firstSha256Evidence(
    proof.contractHash,
    nested.contractHash,
  );
  const contractValidationHash = firstSha256Evidence(
    proof.contractValidationHash,
    nested.contractValidationHash,
  );
  const acceptedClaim = proof.registeredContractProvenanceAccepted === true
    || proof.registeredDriverProvenanceAccepted === true
    || nested.accepted === true;
  const accepted = acceptedClaim
    && Boolean(evidenceHash)
    && Boolean(contractHash)
    && Boolean(contractValidationHash);
  return {
    accepted,
    evidenceHash,
    contractHash,
    contractValidationHash,
  };
}

function firstSha256Evidence(...values) {
  return values.find((value) =>
    typeof value === 'string' && sha256EvidencePattern.test(value)) || null;
}

function normalizeArbitraryPluginFixturePackageEvidenceScope(value) {
  if (value === productionBackedEvidenceScope) {
    return productionBackedEvidenceScope;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return localArbitraryPluginFixturePackageEvidenceScope;
}

export function buildArbitraryPluginFixturePackageReleaseGate({
  checked = false,
  packageChecksComplete = checked,
  evidenceScope = localArbitraryPluginFixturePackageEvidenceScope,
  productionScoped = false,
  productionBacked = false,
  registeredContractProvenanceAccepted = false,
} = {}) {
  const normalizedScope = normalizeArbitraryPluginFixturePackageEvidenceScope(evidenceScope);
  const claimedProductionScope = productionScoped === true
    || productionBacked === true
    || normalizedScope === productionBackedEvidenceScope;
  const acceptedForReleaseGate = checked === true
    && productionBacked === true
    && registeredContractProvenanceAccepted === true;

  return {
    status: acceptedForReleaseGate ? 'GO' : 'NO-GO',
    verdict: acceptedForReleaseGate
      ? 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED'
      : claimedProductionScope
        ? registeredContractProvenanceAccepted
          ? 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE'
          : 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_REGISTERED_PROVENANCE_REQUIRED'
        : 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    evidenceScope: normalizedScope,
    productionBacked: productionBacked === true && registeredContractProvenanceAccepted === true,
    acceptedForReleaseGate,
    note: claimedProductionScope
      ? registeredContractProvenanceAccepted
        ? 'arbitrary plugin fixture package proof is production-backed with registered contract provenance; release gate can count it only when the package checks are complete'
        : `arbitrary plugin fixture package proof claims production-backed scope but is missing registered contract provenance; evidenceScope=${normalizedScope}; release gate remains NO-GO`
      : `arbitrary plugin fixture package proof is local/support-only; evidenceScope=${normalizedScope}; production-backed release gate evidence is still required`,
    packageChecksComplete: packageChecksComplete === true,
    registeredContractProvenanceAccepted: registeredContractProvenanceAccepted === true,
  };
}

export function parseProductionPluginPackageSelectedScenarios(argv, envValue) {
  const explicitArg = argv.find((arg) => arg.startsWith('--scenario='));
  const rawValue = explicitArg ? explicitArg.slice('--scenario='.length) : envValue;
  if (!rawValue) {
    return null;
  }
  const requestedNames = rawValue
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (requestedNames.length === 0) {
    return null;
  }

  const unknownNames = requestedNames.filter((name) => !knownScenarioNames.has(name));
  if (unknownNames.length > 0) {
    throw new Error(
      `Unknown production plugin package smoke scenario: ${unknownNames.sort().join(', ')}`,
    );
  }

  const expandedNames = requestedNames.flatMap((name) => scenarioGroups[name] ?? [name]);
  return new Set(expandedNames);
}

export { arbitraryPluginFixturePackageBoundary, scenarioGroups, scenarioNames };
