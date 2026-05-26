import { scenarioGroups } from './production-plugin-package-scenarios.js';

const scenarioDefinitions = [
  {
    key: 'corePackageRoutes',
    scenario: 'core-package-routes',
    evaluate(summary) {
      return summary?.routes?.namespace === 'reprint/v1'
        && summary?.routes?.labNamespaceDisabled === true
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

export function buildProductionPluginPackageProofSummary(
  summary,
  { requestedScenarios = null, selectedScenarios = null } = {},
) {
  const scenarioResults = {};
  const bundleResults = {};
  const checkedBundles = [];
  const passedBundles = [];
  const failedBundles = [];
  const checkedScenarios = [];
  const passedScenarios = [];
  const failedScenarios = [];
  let checkedBundleCount = 0;
  let passedBundleCount = 0;
  let failedBundleCount = 0;
  let skippedBundleCount = 0;
  const scenarioPasses = new Map();
  let checkedScenarioCount = 0;
  let passedScenarioCount = 0;
  let skippedScenarioCount = 0;

  for (const definition of scenarioDefinitions) {
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
      } else {
        failedScenarios.push(definition.scenario);
      }
    } else {
      skippedScenarioCount += 1;
    }
  }

  for (const [bundleName, bundleScenarios] of Object.entries(scenarioGroups)) {
    const selected = requestedScenarios === null
      ? selectedScenarios === null || bundleScenarios.some((scenario) => selectedScenarios.has(scenario))
      : requestedScenarios.includes(bundleName);
    const passed = bundleScenarios.every((scenario) => scenarioPasses.get(scenario) === true);
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
    } else if (selected) {
      failedBundles.push(bundleKey);
      failedBundleCount += 1;
    }
  }

  const requestedBundles = requestedScenarios === null
    ? 'all'
    : requestedScenarios
      .filter((scenario) => Object.hasOwn(scenarioGroups, scenario))
      .map((bundleName) => toBundleKey(bundleName));

  return {
    kind: 'production-plugin-package-driver-proof',
    ok: checkedScenarioCount > 0 && checkedScenarioCount === passedScenarioCount,
    checkedScenarioCount,
    passedScenarioCount,
    skippedScenarioCount,
    checkedBundleCount,
    passedBundleCount,
    failedBundleCount,
    skippedBundleCount,
    requestedScenarios: requestedScenarios === null ? 'all' : requestedScenarios.slice(),
    requestedBundles,
    checkedScenarios: requestedScenarios === null && selectedScenarios === null ? 'all' : checkedScenarios.sort(),
    passedScenarios: passedScenarios.sort(),
    failedScenarios: failedScenarios.sort(),
    checkedBundles: requestedScenarios === null && selectedScenarios === null ? 'all' : checkedBundles.sort(),
    passedBundles: passedBundles.sort(),
    failedBundles: failedBundles.sort(),
    requestedBundlesSatisfied: checkedBundleCount > 0 && checkedBundleCount === passedBundleCount,
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
      labNamespaceDisabled: summary?.routes?.labNamespaceDisabled ?? null,
      authBootstrapDisabled: summary?.routes?.authBootstrapDisabled ?? null,
    },
    receiptGuards: {
      planBinding: summary?.driverReceiptPlanBindingGuard?.applyRejectedCode ?? null,
      identity: summary?.driverReceiptIdentityGuard?.applyRejectedCode ?? null,
      expiry: summary?.driverReceiptExpiryGuard?.applyRejectedCode ?? null,
      rotatedCredential: summary?.driverReceiptRotatedCredentialGuard?.rotatedCredentialRejectedCode ?? null,
      revokedCredential: summary?.driverReceiptRevokedCredentialGuard?.applyRejectedCode ?? null,
    },
    mutationProof: {
      updateApplied: summary?.driverUpdateApply?.applied ?? 0,
      deleteRejected: summary?.driverDeleteGuard?.forgedPlanAcceptedByDryRun === false,
      deleteApplied: summary?.driverDeleteApply?.deletedAfterApply ?? false,
      finalMatchesLocal: summary?.final?.finalMatchesLocal ?? false,
    },
    bundles: bundleResults,
    scenarios: scenarioResults,
  };
}
