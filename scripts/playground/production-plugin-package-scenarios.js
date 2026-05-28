const arbitraryPluginFixturePackageBoundary = Object.freeze({
  plugin: 'driver-fixture/driver-fixture.php',
  driver: 'fixture-arbitrary-plugin-table',
  pluginOwner: 'driver-fixture',
  table: 'wp_reprint_push_driver_fixture',
  resourceKey: 'row:[\"wp_reprint_push_driver_fixture\",\"entry_id:1\"]',
  scenario: 'driver-receipt-guards',
});

const scenarioGroups = {
  'arbitrary-plugin-fixture-package': [
    'driver-receipt-guards',
  ],
  'driver-verifier-guards': [
    'driver-receipt-guards',
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
  'driver-receipt-guards',
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
  const checked = remoteDataPreserved && Boolean(applyRejectedCode);

  return {
    plugin: arbitraryPluginFixturePackageBoundary.plugin,
    driver: arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
    table: arbitraryPluginFixturePackageBoundary.table,
    resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
    scenario: arbitraryPluginFixturePackageBoundary.scenario,
    proofKind: 'arbitrary-plugin-fixture-package',
    sourceKind: 'local-playground',
    productionBacked: false,
    supportOnly: true,
    checked,
    remoteDataPreserved,
    acceptedForReleaseGate: false,
    releaseGate: {
      status: 'NO-GO',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      note: 'arbitrary plugin fixture package proof is local/support-only; production-backed release gate evidence is still required',
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
