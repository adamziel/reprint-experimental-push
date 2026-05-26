import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionPluginPackageProofSummary } from '../scripts/playground/production-plugin-package-proof-summary.js';

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
  assert.equal(summary.skippedScenarioCount, 0);
  assert.equal(summary.requestedScenarios, 'all');
  assert.equal(summary.requestedBundles, 'all');
  assert.equal(summary.checkedBundles, 'all');
  assert.deepEqual(summary.passedBundles, [
    'driverCallbackGuards',
    'driverRegistrationGuards',
    'driverRegistrationShapeGuards',
    'driverVerifierGuards',
  ]);
  assert.equal(summary.selectedScenarios, 'all');
  assert.equal(summary.receiptGuards.revokedCredential, 'reprint_push_lab_auth_required');
  assert.equal(summary.mutationProof.deleteRejected, true);
  assert.deepEqual(summary.bundles, {
    driverVerifierGuards: 'passed',
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
  assert.equal(summary.skippedScenarioCount, 2);
  assert.deepEqual(summary.requestedScenarios, ['driver-verifier-guards']);
  assert.deepEqual(summary.requestedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.checkedBundles, ['driverVerifierGuards']);
  assert.deepEqual(summary.passedBundles, ['driverVerifierGuards']);
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
