import { scenarioGroups } from './production-plugin-package-scenarios.js';

const scenarioDefinitions = [
  {
    key: 'corePackageRoutes',
    scenario: 'core-package-routes',
    evaluate(summary) {
      return summary?.routes?.namespace === 'reprint/v1'
        && summary?.routes?.labNamespaceDisabled === true
        && summary?.routes?.labBacked === false
        && summary?.cli?.ok === true
        && summary?.final?.finalMatchesLocal === true;
    },
  },
  {
    key: 'driverReceiptGuards',
    scenario: 'driver-receipt-guards',
    evaluate(summary) {
      return summary?.driverUpdateApply?.applied === 1
        && summary?.driverDeleteGuard?.dryRunRejectedCode !== undefined
        && summary?.driverUpdateValidationGuard?.dryRunRejectedCode !== undefined
        && summary?.driverReceiptPlanBindingGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && summary?.driverReceiptExpiryGuard?.applyRejectedCode === 'AUTH_RECEIPT_EXPIRED'
        && summary?.driverReceiptIdentityGuard?.applyRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode === 'AUTH_RECEIPT_MISMATCH'
        && summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode === 'reprint_push_lab_auth_required';
    },
  },
  {
    key: 'driverDeleteApply',
    scenario: 'driver-delete-apply',
    evaluate(summary) {
      return summary?.driverDeleteApply?.deletedAfterApply === true;
    },
  },
  {
    key: 'driverMissingExportGuard',
    scenario: 'driver-missing-export-guard',
    evaluate(summary) {
      return summary?.driverExportGuard?.missingExportRowsCallback === true;
    },
  },
  {
    key: 'driverMissingApplyGuard',
    scenario: 'driver-missing-apply-guard',
    evaluate(summary) {
      return summary?.driverApplyGuard?.missingApplyRowCallback === true;
    },
  },
  {
    key: 'driverMissingValidateGuard',
    scenario: 'driver-missing-validate-guard',
    evaluate(summary) {
      return summary?.driverValidateGuard?.missingValidateMutationCallback === true;
    },
  },
  {
    key: 'driverMissingNameGuard',
    scenario: 'driver-missing-name-guard',
    evaluate(summary) {
      return summary?.driverMissingNameGuard?.missingDriverName === true;
    },
  },
  {
    key: 'driverMissingPluginOwnerGuard',
    scenario: 'driver-missing-plugin-owner-guard',
    evaluate(summary) {
      return summary?.driverPluginOwnerGuard?.missingPluginOwner === true;
    },
  },
  {
    key: 'driverMissingTableGuard',
    scenario: 'driver-missing-table-guard',
    evaluate(summary) {
      return summary?.driverMissingTableGuard?.missingTable === true;
    },
  },
  {
    key: 'driverDuplicateNameGuard',
    scenario: 'driver-duplicate-name-guard',
    evaluate(summary) {
      return summary?.driverDuplicateNameGuard?.duplicateDriverName === true;
    },
  },
  {
    key: 'driverDuplicateTableGuard',
    scenario: 'driver-duplicate-table-guard',
    evaluate(summary) {
      return summary?.driverDuplicateTableGuard?.duplicateTable === true;
    },
  },
];

function isScenarioSelected(selectedScenarios, name) {
  if (selectedScenarios === null) {
    return true;
  }
  return selectedScenarios.has(name);
}

function summarizeScenario(selected, passed) {
  if (!selected) {
    return 'skipped';
  }
  return passed ? 'passed' : 'missing';
}

function toBundleKey(name) {
  return name.replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
}

function requestedScenarioAliases(normalizedRequestedScenarios, scenario) {
  if (normalizedRequestedScenarios === null) {
    return 'all';
  }
  return normalizedRequestedScenarios.filter(
    (requestedScenario) => requestedScenario === scenario
      || scenarioGroups[requestedScenario]?.includes(scenario),
  );
}

function summarizeRequestedScenario(selected, passed) {
  return selected && passed ? 'passed' : 'missing';
}

function buildBundleScenarioDetails(bundleName, scenarioPasses) {
  const requiredScenarios = scenarioGroups[bundleName].slice().sort();
  const passedScenarios = requiredScenarios.filter((scenario) => scenarioPasses.get(scenario) === true);
  const failedScenarios = requiredScenarios.filter((scenario) => scenarioPasses.get(scenario) !== true);
  return {
    requiredScenarios,
    passedScenarios,
    failedScenarios,
  };
}

export function buildProductionPluginPackageProofSummary(
  summary,
  { requestedScenarios = null, selectedScenarios = null } = {},
) {
  const normalizedRequestedScenarios = requestedScenarios === null
    ? null
    : Array.from(new Set(requestedScenarios));
  const requestedBundleAliases = normalizedRequestedScenarios === null
    ? 'all'
    : normalizedRequestedScenarios.filter((scenario) => Object.hasOwn(scenarioGroups, scenario));
  const requestedBundles = normalizedRequestedScenarios === null
    ? 'all'
    : requestedBundleAliases.map((bundleName) => toBundleKey(bundleName));
  const requestedConcreteScenarios = normalizedRequestedScenarios === null
    ? 'all'
    : normalizedRequestedScenarios.filter((scenario) => !Object.hasOwn(scenarioGroups, scenario));
  const requestedConcreteScenarioSet = requestedConcreteScenarios === 'all'
    ? null
    : new Set(requestedConcreteScenarios);
  const requestedBundleSet = requestedBundles === 'all'
    ? null
    : new Set(requestedBundles);
  const hasRequestedBundles = requestedBundles === 'all'
    || requestedBundles.length > 0;
  const scenarioResults = {};
  const bundleResults = {};
  const checkedBundles = [];
  const passedBundles = [];
  const failedBundles = [];
  const checkedScenarios = [];
  const passedScenarios = [];
  const failedScenarios = [];
  const passedRequestedBundles = [];
  const failedRequestedBundles = [];
  const passedRequestedConcreteScenarios = [];
  const failedRequestedConcreteScenarios = [];
  const passedRequestedScenarios = [];
  const failedRequestedScenarios = [];
  const requestedBundleStatuses = {};
  const requestedConcreteScenarioStatuses = {};
  const requestedScenarioStatuses = {};
  let requestedBundleCount = 0;
  let passedRequestedBundleCount = 0;
  let failedRequestedBundleCount = 0;
  let checkedBundleCount = 0;
  let passedBundleCount = 0;
  let failedBundleCount = 0;
  let skippedBundleCount = 0;
  const scenarioPasses = new Map();
  const requestedScenarioAliasMap = new Map();
  let checkedScenarioCount = 0;
  let passedScenarioCount = 0;
  let failedScenarioCount = 0;
  let skippedScenarioCount = 0;

  for (const definition of scenarioDefinitions) {
    requestedScenarioAliasMap.set(
      definition.scenario,
      requestedScenarioAliases(normalizedRequestedScenarios, definition.scenario),
    );
    const selected = isScenarioSelected(selectedScenarios, definition.scenario);
    const passed = definition.evaluate(summary);
    scenarioPasses.set(definition.scenario, passed);
    const status = summarizeScenario(selected, passed);
    scenarioResults[definition.key] = status;
    if (selected) {
      checkedScenarioCount += 1;
      checkedScenarios.push(definition.scenario);
      if (passed) {
        passedScenarioCount += 1;
        passedScenarios.push(definition.scenario);
        if (requestedConcreteScenarioSet?.has(definition.scenario)) {
          passedRequestedConcreteScenarios.push(definition.scenario);
          requestedConcreteScenarioStatuses[definition.scenario] = 'passed';
        }
      } else {
        failedScenarioCount += 1;
        failedScenarios.push(definition.scenario);
        if (requestedConcreteScenarioSet?.has(definition.scenario)) {
          failedRequestedConcreteScenarios.push(definition.scenario);
          requestedConcreteScenarioStatuses[definition.scenario] = 'missing';
        }
      }
    } else {
      skippedScenarioCount += 1;
    }
  }

  for (const [bundleName, bundleScenarios] of Object.entries(scenarioGroups)) {
    const selected = normalizedRequestedScenarios === null
      ? selectedScenarios === null || bundleScenarios.some((scenario) => selectedScenarios.has(scenario))
      : normalizedRequestedScenarios.includes(bundleName);
    const bundleCoverageSatisfied = selectedScenarios === null
      || bundleScenarios.every((scenario) => selectedScenarios.has(scenario));
    const passed = bundleCoverageSatisfied
      && bundleScenarios.every((scenario) => scenarioPasses.get(scenario) === true);
    const bundleKey = toBundleKey(bundleName);
    bundleResults[bundleKey] = summarizeScenario(selected, passed);
    if (selected) {
      checkedBundleCount += 1;
      checkedBundles.push(bundleKey);
      if (passed) {
        passedBundleCount += 1;
      }
    } else {
      skippedBundleCount += 1;
    }
    if (selected && passed) {
      passedBundles.push(bundleKey);
      if (requestedBundleSet?.has(bundleKey)) {
        requestedBundleCount += 1;
        passedRequestedBundleCount += 1;
        passedRequestedBundles.push(bundleKey);
        passedRequestedScenarios.push(bundleName);
        requestedBundleStatuses[bundleKey] = 'passed';
        requestedScenarioStatuses[bundleName] = 'passed';
      }
    } else if (selected) {
      failedBundles.push(bundleKey);
      failedBundleCount += 1;
      if (requestedBundleSet?.has(bundleKey)) {
        requestedBundleCount += 1;
        failedRequestedBundleCount += 1;
        failedRequestedBundles.push(bundleKey);
        failedRequestedScenarios.push(bundleName);
        requestedBundleStatuses[bundleKey] = 'missing';
        requestedScenarioStatuses[bundleName] = 'missing';
      }
    }
  }

  if (requestedConcreteScenarios !== 'all') {
    for (const scenario of requestedConcreteScenarios) {
      if (!requestedConcreteScenarioStatuses[scenario]) {
        failedRequestedConcreteScenarios.push(scenario);
        requestedConcreteScenarioStatuses[scenario] = 'missing';
      }
    }
    for (const scenario of passedRequestedConcreteScenarios) {
      requestedScenarioStatuses[scenario] = 'passed';
    }
    for (const scenario of failedRequestedConcreteScenarios) {
      requestedScenarioStatuses[scenario] = 'missing';
    }
    passedRequestedScenarios.push(...passedRequestedConcreteScenarios);
    failedRequestedScenarios.push(...failedRequestedConcreteScenarios);
  }

  return {
    kind: 'production-plugin-package-driver-proof',
    ok: checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount,
    checkedScenarioCount,
    passedScenarioCount,
    failedScenarioCount,
    skippedScenarioCount,
    checkedBundleCount,
    passedBundleCount,
    failedBundleCount,
    skippedBundleCount,
    requestedScenarios: normalizedRequestedScenarios === null ? 'all' : normalizedRequestedScenarios.slice(),
    requestedBundles,
    requestedConcreteScenarios,
    passedRequestedScenarios: normalizedRequestedScenarios === null
      ? 'all'
      : passedRequestedScenarios.sort(),
    failedRequestedScenarios: normalizedRequestedScenarios === null
      ? 'all'
      : failedRequestedScenarios.sort(),
    passedRequestedBundles: requestedBundles === 'all'
      ? 'all'
      : passedRequestedBundles.sort(),
    failedRequestedBundles: requestedBundles === 'all'
      ? 'all'
      : failedRequestedBundles.sort(),
    passedRequestedConcreteScenarios: requestedConcreteScenarios === 'all'
      ? 'all'
      : passedRequestedConcreteScenarios.sort(),
    failedRequestedConcreteScenarios: requestedConcreteScenarios === 'all'
      ? 'all'
      : failedRequestedConcreteScenarios.sort(),
    requestedScenarioStatuses: normalizedRequestedScenarios === null
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedScenarioStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    requestedBundleStatuses: requestedBundles === 'all'
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedBundleStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    requestedConcreteScenarioStatuses: requestedConcreteScenarios === 'all'
      ? 'all'
      : Object.fromEntries(
        Object.entries(requestedConcreteScenarioStatuses)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    checkedScenarios: normalizedRequestedScenarios === null && selectedScenarios === null ? 'all' : checkedScenarios.sort(),
    passedScenarios: passedScenarios.sort(),
    failedScenarios: failedScenarios.sort(),
    checkedBundles: normalizedRequestedScenarios === null && selectedScenarios === null ? 'all' : checkedBundles.sort(),
    passedBundles: passedBundles.sort(),
    failedBundles: failedBundles.sort(),
    requestedScenariosSatisfied: normalizedRequestedScenarios === null
      ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
      : (
        (hasRequestedBundles
          ? (
            requestedBundles === 'all'
              ? checkedBundleCount > 0 && checkedBundleCount === passedBundleCount
              : requestedBundleCount > 0 && failedRequestedBundleCount === 0
          )
          : true)
        && (
          requestedConcreteScenarios === 'all'
            ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
            : failedRequestedConcreteScenarios.length === 0
        )
      ),
    requestedBundlesSatisfied: hasRequestedBundles
      ? (
        requestedBundles === 'all'
          ? checkedBundleCount > 0 && checkedBundleCount === passedBundleCount
          : requestedBundleCount > 0 && failedRequestedBundleCount === 0
      )
      : true,
    requestedConcreteScenariosSatisfied: requestedConcreteScenarios === 'all'
      ? checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount
      : failedRequestedConcreteScenarios.length === 0,
    selectedScenarios: selectedScenarios === null ? 'all' : Array.from(selectedScenarios).sort(),
    package: {
      plugin: summary?.package?.plugin ?? null,
      mountedAs: summary?.package?.mountedAs ?? null,
    },
    driverResource: {
      resourceKey: summary?.driverUpdateApply?.resourceKey
        ?? summary?.driverDeleteApply?.resourceKey
        ?? summary?.driverDeleteGuard?.resourceKey
        ?? null,
      remoteSupportsDelete: summary?.driverUpdateApply?.remoteSupportsDelete ?? null,
      deleteSupportedByDriver: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
    },
    routes: {
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
    },
    routeProof: {
      requested: requestedScenarioAliasMap.get('core-package-routes') === 'all'
        || requestedScenarioAliasMap.get('core-package-routes').length > 0,
      selected: selectedScenarios === null
        || selectedScenarios.has('core-package-routes'),
      ok: scenarioResults.corePackageRoutes === 'passed',
      status: scenarioResults.corePackageRoutes,
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
      cliOk: summary?.cli?.ok ?? null,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
      requestedStatus: requestedScenarioAliasMap.get('core-package-routes') === 'all'
        || requestedScenarioAliasMap.get('core-package-routes').length > 0
        ? summarizeRequestedScenario(
          selectedScenarios === null || selectedScenarios.has('core-package-routes'),
          scenarioPasses.get('core-package-routes') === true,
        )
        : null,
    },
    receiptGuards: {
      requested: requestedScenarioAliasMap.get('driver-receipt-guards') === 'all'
        || requestedScenarioAliasMap.get('driver-receipt-guards').length > 0,
      selected: selectedScenarios === null
        || selectedScenarios.has('driver-receipt-guards'),
      ok: scenarioResults.driverReceiptGuards === 'passed',
      status: scenarioResults.driverReceiptGuards,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      requestedStatus: requestedScenarioAliasMap.get('driver-receipt-guards') === 'all'
        || requestedScenarioAliasMap.get('driver-receipt-guards').length > 0
        ? summarizeRequestedScenario(
          selectedScenarios === null || selectedScenarios.has('driver-receipt-guards'),
          scenarioPasses.get('driver-receipt-guards') === true,
        )
        : null,
    },
    deleteApplyProof: {
      requested: requestedScenarioAliasMap.get('driver-delete-apply') === 'all'
        || requestedScenarioAliasMap.get('driver-delete-apply').length > 0,
      selected: selectedScenarios === null
        || selectedScenarios.has('driver-delete-apply'),
      ok: scenarioResults.driverDeleteApply === 'passed',
      status: scenarioResults.driverDeleteApply,
      resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
      remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
      deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      requestedStatus: requestedScenarioAliasMap.get('driver-delete-apply') === 'all'
        || requestedScenarioAliasMap.get('driver-delete-apply').length > 0
        ? summarizeRequestedScenario(
          selectedScenarios === null || selectedScenarios.has('driver-delete-apply'),
          scenarioPasses.get('driver-delete-apply') === true,
        )
        : null,
    },
    mutationProof: {
      updateApplied: summary?.driverUpdateApply?.applied ?? 0,
      deleteRejected: summary?.driverDeleteGuard?.forgedPlanAcceptedByDryRun === false,
      deleteApplied: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? false,
    },
    positiveProof: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-positive-proof'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-positive-proof'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverPositiveProof === 'passed',
      status: bundleResults.driverPositiveProof,
      routeStatus: scenarioResults.corePackageRoutes,
      deleteStatus: scenarioResults.driverDeleteApply,
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
      resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
      remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
      deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
      ...buildBundleScenarioDetails('driver-positive-proof', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-positive-proof'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverPositiveProof ?? null,
    },
    releaseProof: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-release-proof'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-release-proof'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverReleaseProof === 'passed',
      status: bundleResults.driverReleaseProof,
      routeStatus: scenarioResults.corePackageRoutes,
      receiptStatus: scenarioResults.driverReceiptGuards,
      deleteStatus: scenarioResults.driverDeleteApply,
      namespace: summary?.routes?.namespace ?? null,
      profile: summary?.routes?.profile ?? null,
      labBacked: summary?.routes?.labBacked ?? null,
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      resourceKey: summary?.driverDeleteApply?.resourceKey ?? null,
      remoteSupportsDelete: summary?.driverDeleteApply?.remoteSupportsDelete ?? null,
      deletedAfterApply: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? null,
      ...buildBundleScenarioDetails('driver-release-proof', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-release-proof'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverReleaseProof ?? null,
    },
    verifierGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-verifier-guards'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-verifier-guards'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverVerifierGuards === 'passed',
      status: bundleResults.driverVerifierGuards,
      receiptStatus: scenarioResults.driverReceiptGuards,
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails('driver-verifier-guards', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-verifier-guards'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverVerifierGuards ?? null,
    },
    registrationGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-registration-guards'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-registration-guards'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverRegistrationGuards === 'passed',
      status: bundleResults.driverRegistrationGuards,
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails('driver-registration-guards', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-registration-guards'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverRegistrationGuards ?? null,
    },
    callbackGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-callback-guards'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-callback-guards'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverCallbackGuards === 'passed',
      status: bundleResults.driverCallbackGuards,
      exportStatus: scenarioResults.driverMissingExportGuard,
      applyStatus: scenarioResults.driverMissingApplyGuard,
      validateStatus: scenarioResults.driverMissingValidateGuard,
      missingExportRowsCallback: summary?.driverExportGuard?.missingExportRowsCallback ?? false,
      missingApplyRowCallback: summary?.driverApplyGuard?.missingApplyRowCallback ?? false,
      missingValidateMutationCallback: summary?.driverValidateGuard?.missingValidateMutationCallback ?? false,
      ...buildBundleScenarioDetails('driver-callback-guards', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-callback-guards'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverCallbackGuards ?? null,
    },
    registrationShapeGuards: {
      requested: normalizedRequestedScenarios === null
        ? true
        : normalizedRequestedScenarios.includes('driver-registration-shape-guards'),
      selected: selectedScenarios === null
        || scenarioGroups['driver-registration-shape-guards'].every((scenario) => selectedScenarios.has(scenario)),
      ok: bundleResults.driverRegistrationShapeGuards === 'passed',
      status: bundleResults.driverRegistrationShapeGuards,
      missingNameStatus: scenarioResults.driverMissingNameGuard,
      missingPluginOwnerStatus: scenarioResults.driverMissingPluginOwnerGuard,
      missingTableStatus: scenarioResults.driverMissingTableGuard,
      missingDriverName: summary?.driverMissingNameGuard?.missingDriverName ?? false,
      missingPluginOwner: summary?.driverPluginOwnerGuard?.missingPluginOwner ?? false,
      missingTable: summary?.driverMissingTableGuard?.missingTable ?? false,
      duplicateNameStatus: scenarioResults.driverDuplicateNameGuard,
      duplicateTableStatus: scenarioResults.driverDuplicateTableGuard,
      duplicateDriverName: summary?.driverDuplicateNameGuard?.duplicateDriverName ?? false,
      duplicateTable: summary?.driverDuplicateTableGuard?.duplicateTable ?? false,
      ...buildBundleScenarioDetails('driver-registration-shape-guards', scenarioPasses),
      requestedStatus: requestedScenarioStatuses['driver-registration-shape-guards'] ?? null,
      requestedBundleStatus: requestedBundleStatuses.driverRegistrationShapeGuards ?? null,
    },
    bundles: bundleResults,
    scenarios: scenarioResults,
  };
}
