import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionPluginPackageProofSummary } from '../scripts/playground/production-plugin-package-proof-summary.js';
import { scenarioGroups } from '../scripts/playground/production-plugin-package-scenarios.js';

test('plugin-driver proof summary reports full packaged guard coverage', () => {
  const summary = buildProductionPluginPackageProofSummary({
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
    },
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: false,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
    driverUpdateApply: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      remoteSupportsDelete: false,
      applied: 1,
    },
    driverDeleteGuard: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      forgedPlanAcceptedByDryRun: false,
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverUpdateValidationGuard: {
      dryRunRejectedCode: 'INVALID_PLAN',
    },
    driverReceiptPlanBindingGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptExpiryGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
    },
    driverReceiptIdentityGuard: {
      applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRotatedCredentialGuard: {
      rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
    },
    driverReceiptRevokedCredentialGuard: {
      applyRejectedCode: 'reprint_push_lab_auth_required',
    },
    driverDeleteApply: {
      resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
      remoteSupportsDelete: true,
      deletedAfterApply: true,
    },
    driverExportGuard: {
      missingExportRowsCallback: true,
    },
    driverApplyGuard: {
      missingApplyRowCallback: true,
    },
    driverValidateGuard: {
      missingValidateMutationCallback: true,
    },
    driverMissingNameGuard: {
      missingDriverName: true,
    },
    driverPluginOwnerGuard: {
      missingPluginOwner: true,
    },
    driverMissingTableGuard: {
      missingTable: true,
    },
    driverDuplicateNameGuard: {
      duplicateDriverName: true,
    },
    driverDuplicateTableGuard: {
      duplicateTable: true,
    },
  });

  assert.equal(summary.kind, 'production-plugin-package-driver-proof');
  assert.equal(summary.ok, true);
  assert.equal(summary.checkedScenarioCount, 11);
  assert.equal(summary.passedScenarioCount, 11);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.skippedScenarioCount, 0);
  assert.equal(summary.checkedBundleCount, 6);
  assert.equal(summary.passedBundleCount, 6);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.skippedBundleCount, 0);
  assert.equal(summary.requestedScenarioCount, 'all');
  assert.equal(summary.passedRequestedScenarioCount, 'all');
  assert.equal(summary.failedRequestedScenarioCount, 'all');
  assert.equal(summary.requestedBundleCount, 'all');
  assert.equal(summary.passedRequestedBundleCount, 'all');
  assert.equal(summary.failedRequestedBundleCount, 'all');
  assert.equal(summary.requestedConcreteScenarioCount, 'all');
  assert.equal(summary.passedRequestedConcreteScenarioCount, 'all');
  assert.equal(summary.failedRequestedConcreteScenarioCount, 'all');
  assert.equal(summary.requestedScenarios, 'all');
  assert.equal(summary.requestedBundles, 'all');
  assert.equal(summary.requestedConcreteScenarios, 'all');
  assert.equal(summary.passedRequestedScenarios, 'all');
  assert.equal(summary.failedRequestedScenarios, 'all');
  assert.equal(summary.passedRequestedBundles, 'all');
  assert.equal(summary.failedRequestedBundles, 'all');
  assert.equal(summary.passedRequestedConcreteScenarios, 'all');
  assert.equal(summary.failedRequestedConcreteScenarios, 'all');
  assert.equal(summary.requestedScenarioStatuses, 'all');
  assert.equal(summary.requestedBundleStatuses, 'all');
  assert.equal(summary.requestedConcreteScenarioStatuses, 'all');
  assert.equal(summary.checkedScenarios, 'all');
  assert.deepEqual(summary.passedScenarios, [
    'core-package-routes',
    'driver-delete-apply',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, []);
  assert.equal(summary.checkedBundles, 'all');
  assert.deepEqual(summary.passedBundles, [
    'driverCallbackGuards',
    'driverPositiveProof',
    'driverRegistrationGuards',
    'driverRegistrationShapeGuards',
    'driverReleaseProof',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.selectedScenarios, 'all');
  assert.equal(summary.routes.labBacked, false);
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: 'all',
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: 'all',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
    remoteSupportsDelete: true,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: 'all',
  });
  assert.equal(summary.mutationProof.deleteRejected, true);
  assert.deepEqual(summary.bundles, {
    driverVerifierGuards: 'passed',
    driverPositiveProof: 'passed',
    driverReleaseProof: 'passed',
    driverRegistrationGuards: 'passed',
    driverCallbackGuards: 'passed',
    driverRegistrationShapeGuards: 'passed',
  });
  assert.deepEqual(summary.scenarios, {
    corePackageRoutes: 'passed',
    driverReceiptGuards: 'passed',
    driverDeleteApply: 'passed',
    driverMissingExportGuard: 'passed',
    driverMissingApplyGuard: 'passed',
    driverMissingValidateGuard: 'passed',
    driverMissingNameGuard: 'passed',
    driverMissingPluginOwnerGuard: 'passed',
    driverMissingTableGuard: 'passed',
    driverDuplicateNameGuard: 'passed',
    driverDuplicateTableGuard: 'passed',
  });
});

test('plugin-driver proof summary marks unselected scenarios as skipped', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        resourceKey: 'row:["wp_reprint_push_driver_fixture","entry_id:1"]',
        remoteSupportsDelete: false,
        applied: 1,
      },
      driverDeleteGuard: {
        forgedPlanAcceptedByDryRun: false,
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.checkedScenarioCount, 9);
  assert.equal(summary.passedScenarioCount, 9);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.skippedScenarioCount, 2);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 1);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.skippedBundleCount, 5);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 1);
  assert.equal(summary.failedRequestedScenarioCount, 0);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 1);
  assert.equal(summary.failedRequestedBundleCount, 0);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.requestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.passedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, []);
  assert.deepEqual(summary.checkedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {});
  assert.deepEqual(summary.selectedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.bundles, {
    driverPositiveProof: 'skipped',
    driverReleaseProof: 'skipped',
    driverVerifierGuards: 'passed',
    driverRegistrationGuards: 'skipped',
    driverCallbackGuards: 'skipped',
    driverRegistrationShapeGuards: 'skipped',
  });
  assert.equal(summary.scenarios.corePackageRoutes, 'skipped');
  assert.equal(summary.scenarios.driverReceiptGuards, 'passed');
  assert.equal(summary.scenarios.driverDeleteApply, 'skipped');
  assert.equal(summary.scenarios.driverDuplicateTableGuard, 'passed');
});

test('plugin-driver proof summary exposes direct requested route-proof state', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
    },
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(['core-package-routes']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'core-package-routes': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.positiveProof, {
    ...summary.positiveProof,
    status: 'skipped',
    requiredScenarioCount: 2,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.releaseProof, {
    ...summary.releaseProof,
    status: 'skipped',
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
  });
  assert.deepEqual(summary.verifierGuards, {
    ...summary.verifierGuards,
    status: 'skipped',
    requiredScenarioCount: 9,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    passedScenarios: [],
    failedScenarios: [],
  });
});

test('plugin-driver proof summary marks missing requested route-proof state directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: ['core-package-routes'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'core-package-routes': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    namespace: null,
    profile: null,
    labBacked: null,
    labNamespaceDisabled: null,
    authBootstrapDisabled: null,
    cliOk: null,
    finalMatchesLocal: null,
    requestedStatus: 'missing',
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary fails core package routes when packaged routes still report lab-backed mode', () => {
  const summary = buildProductionPluginPackageProofSummary({
    package: {
      plugin: 'reprint-push/reprint-push.php',
      mountedAs: '/wordpress/wp-content/plugins/reprint-push',
    },
    routes: {
      namespace: 'reprint/v1',
      profile: 'production-shaped',
      labNamespaceDisabled: true,
      authBootstrapDisabled: true,
      labBacked: true,
    },
    cli: {
      ok: true,
    },
    final: {
      finalMatchesLocal: true,
    },
  }, {
    requestedScenarios: ['driver-positive-proof'],
    selectedScenarios: new Set(scenarioGroups['driver-positive-proof']),
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.scenarios.corePackageRoutes, 'missing');
  assert.equal(summary.bundles.driverPositiveProof, 'missing');
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-positive-proof']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverPositiveProof']);
});

test('plugin-driver proof summary fails requested bundle verdict when a requested guard is missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: false,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 0);
  assert.equal(summary.failedBundleCount, 1);
  assert.equal(summary.skippedBundleCount, 5);
  assert.equal(summary.checkedScenarioCount, 9);
  assert.equal(summary.passedScenarioCount, 8);
  assert.equal(summary.failedScenarioCount, 1);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.passedScenarios, [
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-receipt-guards',
  ]);
  assert.deepEqual(summary.failedScenarios, ['driver-missing-validate-guard']);
  assert.deepEqual(summary.checkedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedBundles, []);
  assert.deepEqual(summary.failedBundles, ['driverVerifierGuards']);
  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 0);
  assert.equal(summary.failedRequestedScenarioCount, 1);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 0);
  assert.equal(summary.failedRequestedBundleCount, 1);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.equal(summary.bundles.driverVerifierGuards, 'missing');
  assert.equal(summary.scenarios.driverMissingValidateGuard, 'missing');
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
});

test('plugin-driver proof summary scopes requested bundle verdicts to requested bundles only', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: false,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-positive-proof'],
      selectedScenarios: new Set([
        ...scenarioGroups['driver-positive-proof'],
        ...scenarioGroups['driver-verifier-guards'],
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 1);
  assert.equal(summary.failedRequestedScenarioCount, 0);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 1);
  assert.equal(summary.failedRequestedBundleCount, 0);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-positive-proof']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverPositiveProof']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-positive-proof': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverPositiveProof: 'passed',
  });
  assert.equal(summary.bundles.driverPositiveProof, 'passed');
  assert.equal(summary.bundles.driverVerifierGuards, 'skipped');
  assert.equal(summary.scenarios.driverMissingValidateGuard, 'missing');
  assert.deepEqual(summary.positiveProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    routeStatus: 'passed',
    deleteStatus: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    finalMatchesLocal: true,
    requiredScenarioCount: 2,
    passedScenarioCount: 2,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    passedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
  });
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: {
      driverPositiveProof: 'passed',
    },
  });
});

test('plugin-driver proof summary reports requested receipt guard verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-receipt-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.equal(summary.checkedBundleCount, 1);
  assert.equal(summary.passedBundleCount, 1);
  assert.equal(summary.failedBundleCount, 0);
  assert.deepEqual(summary.requestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.checkedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.passedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.failedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptGuards: 'passed',
  });
  assert.deepEqual(summary.passedRequestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.equal(summary.bundles.driverReceiptGuards, 'passed');
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReceiptGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary reports requested callback bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
    },
    {
      requestedScenarios: ['driver-callback-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-callback-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-callback-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverCallbackGuards: 'passed',
  });
  assert.equal(summary.bundles.driverCallbackGuards, 'passed');
  assert.deepEqual(summary.callbackGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 3,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverCallbackGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary exposes bounded release-proof bundle status', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set(scenarioGroups['driver-release-proof']),
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedScenarios, ['driver-release-proof']);
  assert.deepEqual(summary.requestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-release-proof']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.passedRequestedBundles, ['driverReleaseProof']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-release-proof': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
  assert.equal(summary.bundles.driverReleaseProof, 'passed');
  assert.deepEqual(summary.releaseProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    routeStatus: 'passed',
    receiptStatus: 'passed',
    deleteStatus: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 3,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.routeProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    cliOk: true,
    finalMatchesLocal: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: {
      driverReleaseProof: 'passed',
    },
  });
});

test('plugin-driver proof summary treats bundled receipt alias as selected for release-proof coverage', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'driver-release-proof',
        'core-package-routes',
        'driver-receipt-guards',
        'driver-delete-apply',
      ]),
    },
  );

  assert.equal(summary.releaseProof.selected, true);
  assert.equal(summary.releaseProof.status, 'missing');
  assert.equal(summary.releaseProof.receiptStatus, 'missing');
  assert.equal(summary.releaseProof.requestedStatus, 'missing');
  assert.deepEqual(summary.releaseProof.requestedBundleStatuses, {
    driverReleaseProof: 'missing',
  });
});

test('plugin-driver proof summary reports requested verifier bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-verifier-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.verifierGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    receiptStatus: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 9,
    passedScenarioCount: 9,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverVerifierGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary treats fully requested concrete receipt guards as a requested receipt bundle', () => {
  const concreteReceiptScenarios = scenarioGroups['driver-receipt-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: concreteReceiptScenarios,
      selectedScenarios: new Set(concreteReceiptScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundles, []);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.receiptGuards.requested, true);
  assert.equal(summary.receiptGuards.requestedStatus, 'passed');
  assert.equal(summary.receiptGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.receiptGuards.requestedBundleStatuses, {
    driverReceiptGuards: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete release proof as a requested release bundle on the object', () => {
  const concreteReleaseScenarios = scenarioGroups['driver-release-proof'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: concreteReleaseScenarios,
      selectedScenarios: new Set(concreteReleaseScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.releaseProof.requested, true);
  assert.equal(summary.releaseProof.requestedStatus, 'passed');
  assert.equal(summary.releaseProof.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.releaseProof.requestedBundleStatuses, {
    driverReleaseProof: 'passed',
  });
});

test('plugin-driver proof summary treats fully requested concrete verifier guards as a requested verifier bundle on the object', () => {
  const concreteVerifierScenarios = scenarioGroups['driver-verifier-guards'].slice();
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: concreteVerifierScenarios,
      selectedScenarios: new Set(concreteVerifierScenarios),
    },
  );

  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.equal(summary.verifierGuards.requested, true);
  assert.equal(summary.verifierGuards.requestedStatus, 'passed');
  assert.equal(summary.verifierGuards.requestedBundleStatus, 'passed');
  assert.deepEqual(summary.verifierGuards.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
});

test('plugin-driver proof summary reports requested registration-shape bundle verdicts directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-registration-shape-guards'],
      selectedScenarios: new Set(scenarioGroups['driver-registration-shape-guards']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-registration-shape-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverRegistrationShapeGuards: 'passed',
  });
  assert.equal(summary.bundles.driverRegistrationShapeGuards, 'passed');
  assert.deepEqual(summary.registrationShapeGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 5,
    passedScenarioCount: 5,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverRegistrationShapeGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary dedupes repeated requested bundle aliases', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-verifier-guards',
        'driver-registration-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.deepEqual(summary.requestedScenarios, [
    'driver-verifier-guards',
    'driver-registration-guards',
  ]);
  assert.deepEqual(summary.requestedBundles, [
    'driverVerifierGuards',
    'driverRegistrationGuards',
  ]);
  assert.deepEqual(summary.passedRequestedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.checkedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.passedBundles, [
    'driverRegistrationGuards',
    'driverVerifierGuards',
  ]);
  assert.deepEqual(summary.failedBundles, []);
  assert.equal(summary.checkedBundleCount, 2);
  assert.equal(summary.passedBundleCount, 2);
  assert.equal(summary.failedBundleCount, 0);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
});

test('plugin-driver proof summary exposes requested concrete scenarios separately from bundle aliases', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-delete-apply',
        'driver-delete-apply',
      ],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.deepEqual(summary.requestedScenarios, [
    'driver-verifier-guards',
    'driver-delete-apply',
  ]);
  assert.deepEqual(summary.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.checkedScenarios, [
    'driver-delete-apply',
    'driver-duplicate-name-guard',
    'driver-duplicate-table-guard',
    'driver-missing-apply-guard',
    'driver-missing-export-guard',
    'driver-missing-name-guard',
    'driver-missing-plugin-owner-guard',
    'driver-missing-table-guard',
    'driver-missing-validate-guard',
    'driver-receipt-guards',
  ]);
  assert.equal(summary.checkedScenarioCount, 10);
  assert.equal(summary.passedScenarioCount, 10);
  assert.equal(summary.failedScenarioCount, 0);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
});

test('plugin-driver proof summary exposes failing requested concrete scenarios without subtracting bundle expansions', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: false,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: false,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-delete-apply',
      ],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'missing',
    'driver-verifier-guards': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'passed',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.releaseProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'skipped',
    receiptStatus: 'passed',
    deleteStatus: 'missing',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: false,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary keeps requested scenario verdict scoped to the requested proof set', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverDeleteApply: {
        deletedAfterApply: false,
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
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
      ]),
    },
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedScenarios, ['driver-delete-apply']);
});

test('plugin-driver proof summary treats bundle verdicts as satisfied when only concrete scenarios were requested', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverDeleteApply: {
        deletedAfterApply: true,
      },
    },
    {
      requestedScenarios: ['driver-delete-apply'],
      selectedScenarios: new Set(['driver-delete-apply']),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, true);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedScenarios, []);
  assert.equal(summary.checkedBundleCount, 0);
  assert.equal(summary.passedBundleCount, 0);
  assert.equal(summary.failedBundleCount, 0);
  assert.deepEqual(summary.requestedBundles, []);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, []);
  assert.deepEqual(summary.requestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'passed',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'passed',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: true,
    requestedStatus: 'passed',
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.checkedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.failedScenarios, []);
  assert.equal(summary.bundles.driverVerifierGuards, 'skipped');
  assert.equal(summary.scenarios.driverDeleteApply, 'passed');
});

test('plugin-driver proof summary fails requested concrete scenarios omitted from the selected proof set', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
    },
    {
      requestedScenarios: ['driver-delete-apply'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, true);
  assert.equal(summary.requestedConcreteScenariosSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.passedRequestedConcreteScenarios, []);
  assert.deepEqual(summary.failedRequestedConcreteScenarios, ['driver-delete-apply']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {});
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {
    'driver-delete-apply': 'missing',
  });
  assert.deepEqual(summary.deleteApplyProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    requestedStatus: 'missing',
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary exposes failed requested bundles directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: null,
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: [
        'driver-verifier-guards',
        'driver-registration-guards',
      ],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
        'driver-duplicate-table-guard',
      ]),
    },
  );

  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.deepEqual(summary.passedRequestedScenarios, ['driver-registration-guards']);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.passedRequestedBundles, ['driverRegistrationGuards']);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-registration-guards': 'passed',
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverRegistrationGuards: 'passed',
    driverVerifierGuards: 'missing',
  });
  assert.deepEqual(summary.requestedConcreteScenarioStatuses, {});
  assert.deepEqual(summary.registrationGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'passed',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 8,
    passedScenarioCount: 8,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    failedScenarios: [],
    requestedStatus: 'passed',
    requestedBundleStatus: 'passed',
    requestedBundleStatuses: {
      driverRegistrationGuards: 'passed',
    },
  });
});

test('plugin-driver proof summary fails requested bundles when the selected proof set omits bundle scenarios', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
      driverDuplicateNameGuard: {
        duplicateDriverName: true,
      },
      driverDuplicateTableGuard: {
        duplicateTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
        'driver-duplicate-name-guard',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.passedRequestedScenarios, []);
  assert.deepEqual(summary.failedRequestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.passedRequestedBundles, []);
  assert.deepEqual(summary.failedRequestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'missing',
  });
  assert.equal(summary.bundles.driverVerifierGuards, 'missing');
  assert.equal(summary.scenarios.driverDuplicateTableGuard, 'skipped');
  assert.deepEqual(summary.releaseProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'skipped',
    receiptStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.registrationGuards, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 8,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.callbackGuards, {
    requested: false,
    selected: true,
    ok: false,
    status: 'skipped',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-validate-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
  assert.deepEqual(summary.registrationShapeGuards, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'passed',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: true,
    duplicateTable: true,
    requiredScenarioCount: 5,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary exposes missing requested release bundle state directly', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      package: {
        plugin: 'reprint-push/reprint-push.php',
        mountedAs: '/wordpress/wp-content/plugins/reprint-push',
      },
      routes: {
        namespace: 'reprint/v1',
        profile: 'production-shaped',
        labNamespaceDisabled: true,
        authBootstrapDisabled: true,
        labBacked: false,
      },
      cli: {
        ok: true,
      },
      final: {
        finalMatchesLocal: true,
      },
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
    },
    {
      requestedScenarios: ['driver-release-proof'],
      selectedScenarios: new Set([
        'core-package-routes',
        'driver-receipt-guards',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-release-proof': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReleaseProof: 'missing',
  });
  assert.deepEqual(summary.releaseProof, {
    requested: true,
    selected: false,
    ok: false,
    status: 'missing',
    routeStatus: 'passed',
    receiptStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 3,
    passedScenarioCount: 2,
    failedScenarioCount: 1,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
      'driver-receipt-guards',
    ],
    passedScenarios: ['core-package-routes', 'driver-receipt-guards'],
    failedScenarios: ['driver-delete-apply'],
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverReleaseProof: 'missing',
    },
  });
  assert.deepEqual(summary.positiveProof, {
    requested: false,
    selected: false,
    ok: false,
    status: 'skipped',
    routeStatus: 'passed',
    deleteStatus: 'skipped',
    namespace: 'reprint/v1',
    profile: 'production-shaped',
    labBacked: false,
    labNamespaceDisabled: true,
    authBootstrapDisabled: true,
    resourceKey: null,
    remoteSupportsDelete: null,
    deletedAfterApply: false,
    finalMatchesLocal: true,
    requiredScenarioCount: 2,
    passedScenarioCount: 0,
    failedScenarioCount: 0,
    requiredScenarios: [
      'core-package-routes',
      'driver-delete-apply',
    ],
    passedScenarios: [],
    failedScenarios: [],
    requestedStatus: null,
    requestedBundleStatus: null,
    requestedBundleStatuses: null,
  });
});

test('plugin-driver proof summary marks incomplete requested verifier bundle as missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {
      driverUpdateApply: {
        applied: 1,
      },
      driverDeleteGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverUpdateValidationGuard: {
        dryRunRejectedCode: 'INVALID_PLAN',
      },
      driverReceiptPlanBindingGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptExpiryGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_EXPIRED',
      },
      driverReceiptIdentityGuard: {
        applyRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRotatedCredentialGuard: {
        rotatedCredentialRejectedCode: 'AUTH_RECEIPT_MISMATCH',
      },
      driverReceiptRevokedCredentialGuard: {
        applyRejectedCode: 'reprint_push_lab_auth_required',
      },
      driverExportGuard: {
        missingExportRowsCallback: true,
      },
      driverApplyGuard: {
        missingApplyRowCallback: true,
      },
      driverValidateGuard: {
        missingValidateMutationCallback: true,
      },
      driverMissingNameGuard: {
        missingDriverName: true,
      },
      driverPluginOwnerGuard: {
        missingPluginOwner: true,
      },
      driverMissingTableGuard: {
        missingTable: true,
      },
    },
    {
      requestedScenarios: ['driver-verifier-guards'],
      selectedScenarios: new Set([
        'driver-receipt-guards',
        'driver-missing-export-guard',
        'driver-missing-apply-guard',
        'driver-missing-validate-guard',
        'driver-missing-name-guard',
        'driver-missing-plugin-owner-guard',
        'driver-missing-table-guard',
      ]),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedScenarioCount, 1);
  assert.equal(summary.passedRequestedScenarioCount, 0);
  assert.equal(summary.failedRequestedScenarioCount, 1);
  assert.equal(summary.requestedBundleCount, 1);
  assert.equal(summary.passedRequestedBundleCount, 0);
  assert.equal(summary.failedRequestedBundleCount, 1);
  assert.equal(summary.requestedConcreteScenarioCount, 0);
  assert.equal(summary.passedRequestedConcreteScenarioCount, 0);
  assert.equal(summary.failedRequestedConcreteScenarioCount, 0);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-verifier-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverVerifierGuards: 'missing',
  });
  assert.deepEqual(summary.verifierGuards, {
    requested: true,
    selected: false,
    ok: false,
    status: 'missing',
    receiptStatus: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    exportStatus: 'passed',
    applyStatus: 'passed',
    validateStatus: 'passed',
    missingExportRowsCallback: true,
    missingApplyRowCallback: true,
    missingValidateMutationCallback: true,
    missingNameStatus: 'passed',
    missingPluginOwnerStatus: 'passed',
    missingTableStatus: 'passed',
    missingDriverName: true,
    missingPluginOwner: true,
    missingTable: true,
    duplicateNameStatus: 'skipped',
    duplicateTableStatus: 'skipped',
    duplicateDriverName: false,
    duplicateTable: false,
    requiredScenarioCount: 9,
    passedScenarioCount: 7,
    failedScenarioCount: 2,
    requiredScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    passedScenarios: [
      'driver-missing-apply-guard',
      'driver-missing-export-guard',
      'driver-missing-name-guard',
      'driver-missing-plugin-owner-guard',
      'driver-missing-table-guard',
      'driver-missing-validate-guard',
      'driver-receipt-guards',
    ],
    failedScenarios: [
      'driver-duplicate-name-guard',
      'driver-duplicate-table-guard',
    ],
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverVerifierGuards: 'missing',
    },
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: true,
    ok: true,
    status: 'passed',
    planBinding: 'AUTH_RECEIPT_MISMATCH',
    identity: 'AUTH_RECEIPT_MISMATCH',
    expiry: 'AUTH_RECEIPT_EXPIRED',
    rotatedCredential: 'AUTH_RECEIPT_MISMATCH',
    revokedCredential: 'reprint_push_lab_auth_required',
    requestedStatus: 'passed',
    requestedBundleStatus: null,
    requestedBundleStatuses: {
      driverVerifierGuards: 'missing',
    },
  });
});

test('plugin-driver proof summary marks incomplete requested receipt guard scenario as missing', () => {
  const summary = buildProductionPluginPackageProofSummary(
    {},
    {
      requestedScenarios: ['driver-receipt-guards'],
      selectedScenarios: new Set(),
    },
  );

  assert.equal(summary.requestedScenariosSatisfied, false);
  assert.equal(summary.requestedBundlesSatisfied, false);
  assert.equal(summary.requestedConcreteScenariosSatisfied, true);
  assert.deepEqual(summary.requestedBundles, ['driverReceiptGuards']);
  assert.deepEqual(summary.requestedConcreteScenarios, []);
  assert.deepEqual(summary.requestedScenarioStatuses, {
    'driver-receipt-guards': 'missing',
  });
  assert.deepEqual(summary.requestedBundleStatuses, {
    driverReceiptGuards: 'missing',
  });
  assert.deepEqual(summary.receiptGuards, {
    requested: true,
    selected: false,
    ok: false,
    status: 'skipped',
    planBinding: null,
    identity: null,
    expiry: null,
    rotatedCredential: null,
    revokedCredential: null,
    requestedStatus: 'missing',
    requestedBundleStatus: 'missing',
    requestedBundleStatuses: {
      driverReceiptGuards: 'missing',
    },
  });
});
