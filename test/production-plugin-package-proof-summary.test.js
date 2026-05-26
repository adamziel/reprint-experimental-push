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
  assert.equal(summary.selectedScenarios, 'all');
  assert.equal(summary.receiptGuards.revokedCredential, 'reprint_push_lab_auth_required');
  assert.equal(summary.mutationProof.deleteRejected, true);
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
    },
    {
      selectedScenarios: new Set([
        'core-package-routes',
        'driver-receipt-guards',
      ]),
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.checkedScenarioCount, 2);
  assert.equal(summary.passedScenarioCount, 2);
  assert.equal(summary.skippedScenarioCount, 9);
  assert.deepEqual(summary.selectedScenarios, [
    'core-package-routes',
    'driver-receipt-guards',
  ]);
  assert.equal(summary.scenarios.corePackageRoutes, 'passed');
  assert.equal(summary.scenarios.driverReceiptGuards, 'passed');
  assert.equal(summary.scenarios.driverDeleteApply, 'skipped');
  assert.equal(summary.scenarios.driverDuplicateTableGuard, 'skipped');
});
