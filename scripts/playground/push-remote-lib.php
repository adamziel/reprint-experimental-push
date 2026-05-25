<?php
/**
 * Lab-only remote push protocol helpers for Playground fixtures.
 *
 * This library models the future remote endpoint without exposing HTTP. It is
 * intentionally fixture-scoped and delegates all writes to snapshot-lib.php's
 * guarded apply helpers.
 */

class Reprint_Push_Protocol_Error extends RuntimeException
{
    /** @var array<string, mixed> */
    public array $result;

    public function __construct(array $result, int $exit_code = 1)
    {
        parent::__construct((string) ($result['message'] ?? $result['code'] ?? 'Push protocol error'), $exit_code);
        $this->result = $result;
    }
}

function reprint_push_protocol_run(string $mode, string $plan_path, ?string $receipt_path = null): array
{
    if (!in_array($mode, ['dry-run', 'apply', 'inspect'], true)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Mode must be dry-run, apply, or inspect.',
            'mode' => $mode,
        ]);
    }

    if (($mode === 'apply' || $mode === 'inspect') && ($receipt_path === null || $receipt_path === '')) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', [
            'mode' => $mode,
            'planPathHash' => hash('sha256', $plan_path),
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => ucfirst($mode) . ' requires a supplied dry-run receipt JSON path.',
            'mode' => $mode,
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    $plan = reprint_push_protocol_read_json_file($plan_path, 'Plan');
    $receipt_payload = null;

    if ($receipt_path !== null && $receipt_path !== '') {
        if (!in_array($mode, ['apply', 'inspect'], true)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Receipt paths are only accepted for apply or inspect.',
                'mode' => $mode,
            ]);
        }

        $receipt_payload = reprint_push_protocol_read_json_file($receipt_path, 'Receipt');
    }

    if ($mode === 'inspect') {
        return reprint_push_protocol_inspect_recovery($plan, $receipt_payload, [
            'transport' => 'cli-file',
        ]);
    }

    return reprint_push_protocol_run_payload($mode, $plan, $receipt_payload, [
        'transport' => 'cli-file',
    ]);
}

function reprint_push_protocol_run_payload(
    string $mode,
    array $plan,
    ?array $receipt_payload = null,
    array $journal_context = [],
    array $options = []
): array {
    if (!in_array($mode, ['dry-run', 'apply'], true)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Mode must be dry-run or apply.',
            'mode' => $mode,
        ]);
    }

    $plan_hash = reprint_push_protocol_plan_hash($plan);

    if ($mode === 'apply' && $receipt_payload === null) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', $journal_context + [
            'mode' => $mode,
            'planId' => $plan['id'] ?? null,
            'planHash' => $plan_hash,
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON.',
            'mode' => $mode,
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    reprint_push_protocol_assert_plan_ready($plan, $mode, $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);

    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);

    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);
    $receipt = null;

    if ($receipt_payload !== null) {
        if ($mode !== 'apply') {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Receipts are only accepted for apply.',
                'mode' => $mode,
            ]);
        }

        $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
        reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);
    }

    $current = reprint_push_export_snapshot();
    reprint_push_protocol_validate_fixture_atomic_dependencies($plan, $current, $mutations, $journal_context + $plan_evidence);
    $verified_preconditions = reprint_push_protocol_verify_preconditions(
        $current,
        $precondition_entries,
        $journal_context + ($mode === 'apply' ? $plan_evidence + ['receiptHash' => (string) ($receipt['receiptHash'] ?? '')] : $plan_evidence)
    );

    if ($mode === 'dry-run') {
        $receipt = reprint_push_protocol_create_receipt($plan, $plan_evidence, $mutations, $precondition_entries, $verified_preconditions, $current);
        $journal_entry = reprint_push_protocol_append_journal_event('dry-run-recorded', $journal_context + $plan_evidence + [
            'receiptHash' => (string) $receipt['receiptHash'],
            'verifiedPreconditions' => reprint_push_protocol_compact_precondition_hashes($verified_preconditions),
        ]);

        return [
            'ok' => true,
            'mode' => 'dry-run',
            'applied' => 0,
            'verifiedPreconditions' => $verified_preconditions,
            'receipt' => $receipt,
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
            'currentSnapshot' => $current,
        ];
    }

    $lab_fail_after_mutations = reprint_push_protocol_lab_fail_after_mutations($options);
    $mutation_event_callback = reprint_push_protocol_mutation_event_callback($options);
    $recovery_entries = reprint_push_protocol_recovery_entries($mutations, $preconditions);
    $started_entry = reprint_push_protocol_append_journal_event('apply-started', $journal_context + $plan_evidence + [
        'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
        'verifiedPreconditions' => reprint_push_protocol_compact_precondition_hashes($verified_preconditions),
        'recoveryPlan' => $recovery_entries,
        'labFailAfterMutations' => $lab_fail_after_mutations,
    ]);

    $applied = 0;
    try {
        if ($lab_fail_after_mutations === 0) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'LAB_INJECTED_APPLY_FAILURE',
                'message' => 'Lab failpoint injected after 0 successful target resource mutations.',
                'mode' => 'apply',
                'applied' => 0,
                'labFailAfterMutations' => $lab_fail_after_mutations,
            ]);
        }

        foreach ($mutations as $index => $mutation) {
            $mutation_id = (string) $mutation['id'];
            $precondition = $preconditions[$mutation_id] ?? [];
            $before_hash = (string) ($precondition['expectedHash'] ?? '');
            $planned_after_hash = (string) ($mutation['localHash'] ?? '');

            reprint_push_protocol_emit_mutation_event($mutation_event_callback, 'mutation-prepared', $journal_context + $plan_evidence + [
                'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                'startedCursor' => $started_entry['cursor'],
                'index' => (int) $index,
                'mutationId' => $mutation_id,
                'resource' => $mutation['resource'],
                'resourceKey' => (string) $mutation['resourceKey'],
                'resourceType' => (string) ($mutation['resource']['type'] ?? ''),
                'beforeHash' => $before_hash,
                'plannedAfterHash' => $planned_after_hash,
                'phase' => 'before-write',
                'status' => 'pending',
                'appliedCount' => $applied,
            ]);

            $pre_write_check = reprint_push_protocol_recheck_mutation_precondition(
                $plan,
                $mutation,
                $precondition,
                $journal_context + $plan_evidence + [
                    'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                    'startedCursor' => $started_entry['cursor'],
                    'index' => (int) $index,
                    'appliedCount' => $applied,
                ],
                $mutation_event_callback,
                $recovery_entries
            );
            $pre_write_hash = (string) $pre_write_check['actualHash'];
            $pre_write_evidence = [
                'preWriteExpectedHash' => $before_hash,
                'preWriteActualHash' => $pre_write_hash,
                'actualHash' => $pre_write_hash,
                'preconditionCheck' => (string) $pre_write_check['preconditionCheck'],
            ];
            if (isset($pre_write_check['preWriteStagingProof']) && is_array($pre_write_check['preWriteStagingProof'])) {
                $pre_write_evidence['preWriteStagingProof'] = $pre_write_check['preWriteStagingProof'];
            }
            reprint_push_protocol_emit_mutation_event($mutation_event_callback, 'mutation-storage-write-ready', $journal_context + $plan_evidence + [
                'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                'startedCursor' => $started_entry['cursor'],
                'index' => (int) $index,
                'mutationId' => $mutation_id,
                'resource' => $mutation['resource'],
                'resourceKey' => (string) $mutation['resourceKey'],
                'resourceType' => (string) ($mutation['resource']['type'] ?? ''),
                'beforeHash' => $before_hash,
                'plannedAfterHash' => $planned_after_hash,
                'phase' => 'storage-write-boundary',
                'status' => 'pending',
                'appliedCount' => $applied,
            ] + $pre_write_evidence);

            $apply_result = reprint_push_apply_resource_with_storage_guard(
                $mutation['resource'],
                $mutation['value'],
                isset($pre_write_check['resourceValue']) && is_array($pre_write_check['resourceValue'])
                    ? $pre_write_check['resourceValue']
                    : ['exists' => false, 'value' => null],
                isset($pre_write_check['storageValue']) && is_array($pre_write_check['storageValue'])
                    ? $pre_write_check['storageValue']
                    : null
            );
            $storage_guard = isset($apply_result['storageGuard']) && is_array($apply_result['storageGuard'])
                ? $apply_result['storageGuard']
                : null;
            if ($storage_guard !== null) {
                $pre_write_evidence['storageGuard'] = $storage_guard;
                $pre_write_evidence['preconditionCheck'] = 'storage-boundary-cas';
            }
            if (($apply_result['applied'] ?? true) !== true) {
                $post_failure_snapshot = reprint_push_export_snapshot();
                $post_failure_hash = reprint_push_hash_resource($post_failure_snapshot, $mutation['resource']);
                $recovery_entries = reprint_push_protocol_mark_recovery_entry(
                    $recovery_entries,
                    $mutation_id,
                    'precondition-failed',
                    $post_failure_hash
                );
                $failure_evidence = $journal_context + $plan_evidence + [
                    'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                    'startedCursor' => $started_entry['cursor'],
                    'index' => (int) $index,
                    'mutationId' => $mutation_id,
                    'resourceKey' => (string) $mutation['resourceKey'],
                    'resourceType' => (string) ($mutation['resource']['type'] ?? ''),
                    'beforeHash' => $before_hash,
                    'plannedAfterHash' => $planned_after_hash,
                    'observedHash' => $post_failure_hash,
                    'actualHash' => $post_failure_hash,
                    'phase' => 'storage-write-boundary',
                    'status' => 'rejected',
                    'appliedCount' => $applied,
                    'recoveryPlan' => $recovery_entries,
                ] + $pre_write_evidence;
                reprint_push_protocol_emit_mutation_event($mutation_event_callback, 'mutation-precondition-failed', $failure_evidence);
                reprint_push_protocol_append_journal_event('mutation-precondition-failed', $failure_evidence);
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'PRECONDITION_FAILED',
                    'message' => 'Storage-boundary precondition failed for ' . (string) $mutation['resourceKey'] . '.',
                    'resourceKey' => (string) $mutation['resourceKey'],
                    'mutationId' => $mutation_id,
                    'expectedHash' => $before_hash,
                    'actualHash' => $post_failure_hash,
                    'preWriteExpectedHash' => $before_hash,
                    'preWriteActualHash' => $pre_write_hash,
                    'preconditionCheck' => 'storage-boundary-cas',
                    'storageGuard' => $storage_guard,
                ]);
            }
            $applied++;

            $observed_snapshot = reprint_push_export_snapshot();
            $observed_hash = reprint_push_hash_resource($observed_snapshot, $mutation['resource']);
            $recovery_entries = reprint_push_protocol_mark_recovery_entry(
                $recovery_entries,
                (string) $mutation['id'],
                'applied',
                $observed_hash
            );

            reprint_push_protocol_emit_mutation_event($mutation_event_callback, 'mutation-applied', $journal_context + $plan_evidence + [
                'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                'startedCursor' => $started_entry['cursor'],
                'index' => (int) $index,
                'mutationId' => $mutation_id,
                'resourceKey' => (string) $mutation['resourceKey'],
                'resourceType' => (string) ($mutation['resource']['type'] ?? ''),
                'beforeHash' => $before_hash,
                'plannedAfterHash' => $planned_after_hash,
                'observedHash' => $observed_hash,
                'phase' => 'after-write',
                'status' => 'applied',
                'appliedCount' => $applied,
            ] + $pre_write_evidence);

            reprint_push_protocol_append_journal_event('mutation-applied', $journal_context + $plan_evidence + [
                'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
                'startedCursor' => $started_entry['cursor'],
                'index' => (int) $index,
                'mutationId' => $mutation_id,
                'resourceKey' => (string) $mutation['resourceKey'],
                'observedHash' => $observed_hash,
                'recoveryPlan' => $recovery_entries,
            ] + $pre_write_evidence);

            if ($lab_fail_after_mutations !== null && $applied >= $lab_fail_after_mutations) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'LAB_INJECTED_APPLY_FAILURE',
                    'message' => 'Lab failpoint injected after ' . $applied . ' successful target resource mutation(s).',
                    'mode' => 'apply',
                    'applied' => $applied,
                    'labFailAfterMutations' => $lab_fail_after_mutations,
                ]);
            }
        }
    } catch (Reprint_Push_Protocol_Error $error) {
        reprint_push_protocol_record_apply_failure(
            $error->result,
            $journal_context,
            $plan_evidence,
            $receipt,
            $started_entry,
            $recovery_entries,
            $mutations,
            $applied
        );
    } catch (Throwable $error) {
        reprint_push_protocol_record_apply_failure(
            [
                'ok' => false,
                'code' => 'APPLY_LOOP_FAILED',
                'message' => $error->getMessage(),
                'error' => [
                    'class' => get_class($error),
                    'message' => $error->getMessage(),
                ],
            ],
            $journal_context,
            $plan_evidence,
            $receipt,
            $started_entry,
            $recovery_entries,
            $mutations,
            $applied
        );
    }

    $after = reprint_push_export_snapshot();
    $verified_keys = reprint_push_protocol_verify_after_hashes($after, $mutations);
    $committed_entry = reprint_push_protocol_append_journal_event('apply-committed', $journal_context + $plan_evidence + [
        'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
        'startedCursor' => $started_entry['cursor'],
        'verifiedKeys' => $verified_keys,
    ]);

    return [
        'ok' => true,
        'mode' => 'apply',
        'applied' => count($mutations),
        'verifiedKeys' => $verified_keys,
        'verifiedPreconditions' => $verified_preconditions,
        'receipt' => $receipt,
        'journal' => reprint_push_protocol_journal_evidence($committed_entry),
        'afterSnapshot' => $after,
    ];
}

function reprint_push_protocol_record_apply_failure(
    array $failure,
    array $journal_context,
    array $plan_evidence,
    ?array $receipt,
    array $started_entry,
    array $recovery_entries,
    array $mutations,
    int $applied
): void {
    $snapshot = reprint_push_export_snapshot();
    $current_hashes = reprint_push_protocol_current_hashes($snapshot, $mutations);
    $failure_code = (string) ($failure['code'] ?? 'APPLY_LOOP_FAILED');
    $failure_message = (string) ($failure['message'] ?? $failure_code);

    $failed_entry = reprint_push_protocol_append_journal_event('apply-failed', $journal_context + $plan_evidence + [
        'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : '',
        'startedCursor' => $started_entry['cursor'],
        'failureCode' => $failure_code,
        'failureMessageHash' => hash('sha256', $failure_message),
        'applied' => $applied,
        'currentHashes' => $current_hashes,
        'recoveryPlan' => $recovery_entries,
    ]);

    $required_entry = reprint_push_protocol_append_journal_event('recovery-required', $journal_context + $plan_evidence + [
        'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : '',
        'startedCursor' => $started_entry['cursor'],
        'failedCursor' => $failed_entry['cursor'],
        'failureCode' => $failure_code,
        'applied' => $applied,
        'currentHashes' => $current_hashes,
        'recoveryPlan' => $recovery_entries,
    ]);

    $inspection = reprint_push_protocol_inspect_recovery_from_prepared(
        $mutations,
        $current_hashes,
        $plan_evidence,
        is_array($receipt) ? $receipt : null,
        $snapshot,
        $recovery_entries
    );

    reprint_push_protocol_fail($failure + [
        'ok' => false,
        'mode' => 'apply',
        'applied' => $applied,
        'journal' => reprint_push_protocol_journal_evidence($required_entry),
        'recovery' => [
            'required' => true,
            'state' => $inspection['state'],
            'counts' => $inspection['counts'],
            'targets' => $inspection['targets'],
            'currentHashes' => $current_hashes,
            'scope' => 'lab-only evidence; not durable process-kill recovery',
        ],
    ]);
}

function reprint_push_protocol_recheck_mutation_precondition(
    array $plan,
    array $mutation,
    array $precondition,
    array $journal_context,
    $mutation_event_callback,
    array &$recovery_entries
): array {
    $snapshot = reprint_push_export_snapshot();
    $actual_hash = reprint_push_hash_resource($snapshot, $mutation['resource']);
    $expected_hash = (string) ($precondition['expectedHash'] ?? '');
    $mutation_id = (string) ($mutation['id'] ?? '');
    $resource_key = (string) ($mutation['resourceKey'] ?? ($precondition['resourceKey'] ?? ''));

    if ($actual_hash === $expected_hash) {
        return [
            'actualHash' => $actual_hash,
            'preconditionCheck' => 'just-in-time',
            'resourceValue' => reprint_push_get_resource($snapshot, $mutation['resource']),
            'storageValue' => reprint_push_get_storage_resource($mutation['resource']),
        ];
    }

    $staging_proof = reprint_push_protocol_same_apply_staged_plugin_proof(
        $plan,
        $mutation,
        $recovery_entries,
        $actual_hash
    );
    if ($staging_proof !== null) {
        return [
            'actualHash' => $actual_hash,
            'preconditionCheck' => 'same-apply-staged',
            'preWriteStagingProof' => $staging_proof,
        ];
    }

    $recovery_entries = reprint_push_protocol_mark_recovery_entry(
        $recovery_entries,
        $mutation_id,
        'precondition-failed',
        $actual_hash
    );

    $failure_evidence = $journal_context + [
        'mutationId' => $mutation_id,
        'resourceKey' => $resource_key,
        'resourceType' => (string) ($mutation['resource']['type'] ?? ''),
        'beforeHash' => $expected_hash,
        'preWriteExpectedHash' => $expected_hash,
        'preWriteActualHash' => $actual_hash,
        'actualHash' => $actual_hash,
        'plannedAfterHash' => (string) ($mutation['localHash'] ?? ''),
        'observedHash' => $actual_hash,
        'phase' => 'pre-write-check',
        'status' => 'rejected',
        'preconditionCheck' => 'just-in-time',
        'recoveryPlan' => $recovery_entries,
    ];

    reprint_push_protocol_emit_mutation_event(
        $mutation_event_callback,
        'mutation-precondition-failed',
        $failure_evidence
    );
    reprint_push_protocol_append_journal_event('mutation-precondition-failed', $failure_evidence);

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'PRECONDITION_FAILED',
        'message' => 'Precondition failed for ' . $resource_key . '.',
        'resourceKey' => $resource_key,
        'mutationId' => $mutation_id,
        'expectedHash' => $expected_hash,
        'actualHash' => $actual_hash,
        'preconditionCheck' => 'just-in-time',
    ]);
}

function reprint_push_protocol_same_apply_staged_plugin_proof(
    array $plan,
    array $mutation,
    array $recovery_entries,
    string $actual_hash
): ?array
{
    $resource = isset($mutation['resource']) && is_array($mutation['resource']) ? $mutation['resource'] : [];
    if ((string) ($resource['type'] ?? '') !== 'plugin') {
        return null;
    }
    $atomic_group_id = (string) ($mutation['atomicGroupId'] ?? '');
    if ($atomic_group_id === '') {
        return null;
    }
    if (!isset($mutation['value']) || !is_array($mutation['value']) || !isset($mutation['value']['value'])) {
        return null;
    }
    if (!is_array($mutation['value']['value'])) {
        return null;
    }

    $plugin_slug = (string) ($resource['name'] ?? '');
    $staged_value = $mutation['value']['value'];
    if (($staged_value['active'] ?? null) !== true) {
        return null;
    }
    $plugin_file = (string) ($staged_value['pluginFile'] ?? '');
    if ($plugin_slug === '' || $plugin_file !== $plugin_slug . '/' . $plugin_slug . '.php') {
        return null;
    }
    $staged_value['active'] = false;
    $staged_hash = hash('sha256', reprint_push_stable_json($staged_value));
    if ($actual_hash !== $staged_hash) {
        return null;
    }

    $current_index = null;
    $mutation_id = (string) ($mutation['id'] ?? '');
    foreach ($recovery_entries as $entry) {
        if ((string) ($entry['mutationId'] ?? '') === $mutation_id) {
            $current_index = (int) ($entry['index'] ?? -1);
            break;
        }
    }
    if ($current_index === null || $current_index < 0) {
        return null;
    }

    $main_file_path = 'wp-content/plugins/' . $plugin_file;
    foreach ($recovery_entries as $entry) {
        if ((int) ($entry['index'] ?? -1) >= $current_index) {
            continue;
        }
        if ((string) ($entry['status'] ?? '') !== 'applied') {
            continue;
        }
        if ((string) ($entry['atomicGroupId'] ?? '') !== $atomic_group_id) {
            continue;
        }

        $entry_resource = isset($entry['resource']) && is_array($entry['resource']) ? $entry['resource'] : [];
        if ((string) ($entry_resource['type'] ?? '') !== 'file') {
            continue;
        }
        if ((string) ($entry_resource['path'] ?? '') !== $main_file_path) {
            continue;
        }

        $after_hash = (string) ($entry['afterHash'] ?? $entry['localHash'] ?? '');
        $observed_hash = (string) ($entry['observedHash'] ?? '');
        if ($after_hash === '' || $observed_hash === '' || $observed_hash !== $after_hash) {
            continue;
        }

        $declared_group_proof = reprint_push_protocol_declared_staged_plugin_group_proof(
            $plan,
            $mutation,
            $entry
        );
        if ($declared_group_proof === null) {
            continue;
        }

        return $declared_group_proof + [
            'scope' => 'same-apply-declared-atomic-group-recovery-entry',
            'plugin' => $plugin_slug,
            'atomicGroupId' => $atomic_group_id,
            'stagedHash' => $staged_hash,
            'currentMutationId' => $mutation_id,
            'currentMutationIndex' => $current_index,
            'prerequisiteMutationId' => (string) ($entry['mutationId'] ?? ''),
            'prerequisiteMutationIndex' => (int) ($entry['index'] ?? -1),
            'prerequisiteResourceKey' => (string) ($entry['resourceKey'] ?? ''),
            'prerequisiteAfterHash' => $after_hash,
            'prerequisiteObservedHash' => $observed_hash,
        ];
    }

    return null;
}

function reprint_push_protocol_declared_staged_plugin_group_proof(
    array $plan,
    array $mutation,
    array $prerequisite_entry
): ?array {
    $group_id = (string) ($mutation['atomicGroupId'] ?? '');
    if ($group_id === '') {
        return null;
    }

    $current_mutation_id = (string) ($mutation['id'] ?? '');
    $prerequisite_mutation_id = (string) ($prerequisite_entry['mutationId'] ?? '');
    $current_resource_key = (string) ($mutation['resourceKey'] ?? '');
    $prerequisite_resource_key = (string) ($prerequisite_entry['resourceKey'] ?? '');
    if ($current_mutation_id === '' || $prerequisite_mutation_id === '' || $current_resource_key === '' || $prerequisite_resource_key === '') {
        return null;
    }

    $groups = isset($plan['atomicGroups']) && is_array($plan['atomicGroups']) ? $plan['atomicGroups'] : [];
    foreach ($groups as $group) {
        if (!is_array($group) || (string) ($group['id'] ?? '') !== $group_id) {
            continue;
        }

        if (($group['requireAtomic'] ?? null) !== true) {
            return null;
        }
        if ((string) ($group['status'] ?? '') !== 'ready') {
            return null;
        }
        if ((string) ($group['kind'] ?? '') !== 'plugin-install') {
            return null;
        }

        $mutation_ids = reprint_push_protocol_string_set($group['mutationIds'] ?? []);
        if (!isset($mutation_ids[$current_mutation_id]) || !isset($mutation_ids[$prerequisite_mutation_id])) {
            return null;
        }

        $resource_keys = reprint_push_protocol_string_set($group['resources'] ?? []);
        if (!isset($resource_keys[$current_resource_key]) || !isset($resource_keys[$prerequisite_resource_key])) {
            return null;
        }

        return [
            'declaredAtomicGroupId' => $group_id,
            'declaredAtomicGroupKind' => (string) ($group['kind'] ?? ''),
            'declaredAtomicGroupStatus' => (string) ($group['status'] ?? ''),
            'declaredAtomicGroupRequireAtomic' => true,
            'declaredAtomicGroupCoverage' => 'mutationIds+resources',
        ];
    }

    return null;
}

function reprint_push_protocol_string_set($values): array
{
    $set = [];
    if (!is_array($values)) {
        return $set;
    }
    foreach ($values as $value) {
        $set[(string) $value] = true;
    }
    return $set;
}

function reprint_push_protocol_lab_fail_after_mutations(array $options): ?int
{
    $raw = array_key_exists('labFailAfterMutations', $options)
        ? $options['labFailAfterMutations']
        : getenv('REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS');

    if ($raw === false || $raw === null || $raw === '') {
        return null;
    }
    if (is_bool($raw) || is_array($raw) || is_object($raw) || !is_numeric($raw)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labFailAfterMutations must be a non-negative integer when supplied.',
        ]);
    }

    $after = (int) $raw;
    if ((string) $after !== (string) $raw && (string) $after !== trim((string) $raw)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labFailAfterMutations must be a non-negative integer when supplied.',
        ]);
    }
    if ($after < 0) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labFailAfterMutations must be a non-negative integer when supplied.',
        ]);
    }

    return $after;
}

function reprint_push_protocol_mutation_event_callback(array $options)
{
    if (!array_key_exists('mutationEventCallback', $options) || $options['mutationEventCallback'] === null) {
        return null;
    }
    if (!is_callable($options['mutationEventCallback'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'mutationEventCallback must be callable when supplied.',
        ]);
    }
    return $options['mutationEventCallback'];
}

function reprint_push_protocol_emit_mutation_event($callback, string $event, array $evidence): void
{
    if ($callback === null) {
        return;
    }
    $callback($event, reprint_push_protocol_sanitize_journal_context($evidence));
}

function reprint_push_protocol_recovery_entries(array $mutations, array $preconditions): array
{
    $preconditions_by_mutation = reprint_push_protocol_preconditions_by_mutation($preconditions);
    $entries = [];

    foreach ($mutations as $index => $mutation) {
        $mutation_id = (string) $mutation['id'];
        $precondition = $preconditions_by_mutation[$mutation_id];
        $expected_hash = (string) $precondition['expectedHash'];
        $local_hash = (string) ($mutation['localHash'] ?? '');

        $entries[] = [
            'index' => (int) $index,
            'mutationId' => $mutation_id,
            'resourceKey' => (string) $mutation['resourceKey'],
            'resource' => $mutation['resource'],
            'atomicGroupId' => isset($mutation['atomicGroupId']) ? (string) $mutation['atomicGroupId'] : null,
            'beforeHash' => $expected_hash,
            'preconditionExpectedHash' => $expected_hash,
            'afterHash' => $local_hash,
            'localHash' => $local_hash,
            'status' => 'pending',
        ];
    }

    return $entries;
}

function reprint_push_protocol_mark_recovery_entry(
    array $entries,
    string $mutation_id,
    string $status,
    ?string $observed_hash = null
): array {
    foreach ($entries as $index => $entry) {
        if ((string) ($entry['mutationId'] ?? '') !== $mutation_id) {
            continue;
        }
        $entries[$index]['status'] = $status;
        if ($observed_hash !== null) {
            $entries[$index]['observedHash'] = $observed_hash;
        }
        break;
    }
    return $entries;
}

function reprint_push_protocol_current_hashes(array $snapshot, array $mutations): array
{
    $hashes = [];
    foreach ($mutations as $index => $mutation) {
        $hashes[] = [
            'index' => (int) $index,
            'mutationId' => (string) $mutation['id'],
            'resourceKey' => (string) $mutation['resourceKey'],
            'hash' => reprint_push_hash_resource($snapshot, $mutation['resource']),
        ];
    }
    return $hashes;
}

function reprint_push_protocol_inspect_recovery(
    array $plan,
    ?array $receipt_payload,
    array $journal_context = []
): array {
    if ($receipt_payload === null) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', $journal_context + [
            'mode' => 'inspect',
            'planId' => $plan['id'] ?? null,
            'planHash' => reprint_push_protocol_plan_hash($plan),
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Inspect requires a supplied dry-run receipt JSON.',
            'mode' => 'inspect',
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    $plan_hash = reprint_push_protocol_plan_hash($plan);
    reprint_push_protocol_assert_plan_ready($plan, 'inspect', $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);

    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);

    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);
    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);

    $snapshot = reprint_push_export_snapshot();
    $current_hashes = reprint_push_protocol_current_hashes($snapshot, $mutations);

    return [
        'ok' => true,
        'mode' => 'inspect',
        'recovery' => reprint_push_protocol_inspect_recovery_from_prepared(
            $mutations,
            $current_hashes,
            $plan_evidence,
            $receipt,
            $snapshot,
            $precondition_entries
        ),
    ];
}

function reprint_push_protocol_inspect_recovery_from_prepared(
    array $mutations,
    array $current_hashes,
    array $plan_evidence,
    ?array $receipt,
    array $snapshot,
    array $preconditions = []
): array {
    $hashes_by_mutation = [];
    foreach ($current_hashes as $entry) {
        $hashes_by_mutation[(string) $entry['mutationId']] = (string) $entry['hash'];
    }

    $old_hashes_by_mutation = [];
    foreach ($preconditions as $precondition) {
        if (!is_array($precondition) || !isset($precondition['mutationId'])) {
            continue;
        }
        $old_hashes_by_mutation[(string) $precondition['mutationId']] = (string) (
            $precondition['expectedHash'] ?? $precondition['beforeHash'] ?? ''
        );
    }

    $targets = [];
    $old = 0;
    $new = 0;
    $unknown = 0;

    foreach ($mutations as $index => $mutation) {
        $mutation_id = (string) $mutation['id'];
        $current_hash = (string) ($hashes_by_mutation[$mutation_id] ?? '');
        $old_hash = array_key_exists($mutation_id, $old_hashes_by_mutation)
            ? $old_hashes_by_mutation[$mutation_id]
            : (string) ($mutation['remoteBeforeHash'] ?? '');
        $new_hash = (string) ($mutation['localHash'] ?? '');

        if ($current_hash === $old_hash) {
            $classification = 'old';
            $old++;
        } elseif ($current_hash === $new_hash) {
            $classification = 'new';
            $new++;
        } else {
            $classification = 'blocked-unknown';
            $unknown++;
        }

        $targets[] = [
            'index' => (int) $index,
            'mutationId' => $mutation_id,
            'resourceKey' => (string) $mutation['resourceKey'],
            'resource' => $mutation['resource'],
            'expectedOldHash' => $old_hash,
            'expectedNewHash' => $new_hash,
            'currentHash' => $current_hash,
            'classification' => $classification,
        ];
    }

    $state = 'blocked-recovery';
    if (count($targets) > 0 && $old === count($targets)) {
        $state = 'old-remote';
    } elseif (count($targets) > 0 && $new === count($targets)) {
        $state = 'fully-updated-remote';
    }

    return [
        'schemaVersion' => 1,
        'scope' => 'lab-only inspect evidence; not durable process-kill recovery',
        'state' => $state,
        'counts' => [
            'old' => $old,
            'new' => $new,
            'blockedUnknown' => $unknown,
            'total' => count($targets),
        ],
        'targets' => $targets,
        'currentHashes' => $current_hashes,
        'currentSnapshotHash' => hash('sha256', reprint_push_stable_json($snapshot)),
        'planEvidence' => $plan_evidence,
        'receiptEvidence' => $receipt === null ? null : [
            'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null,
            'planHash' => isset($receipt['planHash']) ? (string) $receipt['planHash'] : null,
            'mutationCount' => isset($receipt['mutationCount']) ? (int) $receipt['mutationCount'] : null,
        ],
        'journalEvidence' => reprint_push_protocol_latest_recovery_journal_evidence(
            (string) $plan_evidence['planHash'],
            $receipt !== null && isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null
        ),
    ];
}

function reprint_push_protocol_latest_recovery_journal_evidence(string $plan_hash, ?string $receipt_hash): array
{
    $journal = get_option('reprint_push_protocol_journal', null);
    $entries = is_array($journal) && isset($journal['entries']) && is_array($journal['entries'])
        ? $journal['entries']
        : [];
    $events = [
        'apply-started',
        'mutation-applied',
        'apply-failed',
        'recovery-required',
        'apply-committed',
    ];
    $matches = [];

    foreach ($entries as $entry) {
        if (!is_array($entry) || !in_array((string) ($entry['event'] ?? ''), $events, true)) {
            continue;
        }
        $matches_plan = isset($entry['planHash']) && (string) $entry['planHash'] === $plan_hash;
        $matches_receipt = $receipt_hash !== null
            && isset($entry['receiptHash'])
            && (string) $entry['receiptHash'] === $receipt_hash;
        if (!$matches_plan && !$matches_receipt) {
            continue;
        }
        $matches[] = $entry;
    }

    return [
        'option' => 'reprint_push_protocol_journal',
        'nextSequence' => is_array($journal) ? (int) ($journal['nextSequence'] ?? 1) : 1,
        'latestRelevant' => array_slice($matches, -10),
    ];
}

function reprint_push_protocol_fail(array $result): void
{
    throw new Reprint_Push_Protocol_Error($result);
}

function reprint_push_protocol_read_json_file(string $path, string $label): array
{
    if (!is_file($path)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $label . ' JSON file does not exist: ' . $path,
        ]);
    }

    $contents = file_get_contents($path);
    if ($contents === false) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Could not read ' . strtolower($label) . ' JSON file: ' . $path,
        ]);
    }

    $decoded = json_decode($contents, true);
    if (!is_array($decoded)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $label . ' JSON did not decode to an object.',
        ]);
    }

    return $decoded;
}

function reprint_push_protocol_assert_plan_ready(array $plan, string $mode, string $plan_hash): void
{
    $status = (string) ($plan['status'] ?? 'unknown');
    $conflicts = isset($plan['conflicts']) && is_array($plan['conflicts']) ? $plan['conflicts'] : [];
    $blockers = isset($plan['blockers']) && is_array($plan['blockers']) ? $plan['blockers'] : [];

    if ($status === 'ready' && count($conflicts) === 0 && count($blockers) === 0) {
        return;
    }

    $journal_entry = reprint_push_protocol_append_journal_event('plan-not-ready', [
        'mode' => $mode,
        'planId' => $plan['id'] ?? null,
        'planHash' => $plan_hash,
        'status' => $status,
        'summaryHash' => hash('sha256', reprint_push_stable_json($plan['summary'] ?? null)),
        'conflictIds' => array_values(array_map(
            static fn (array $conflict): ?string => isset($conflict['id']) ? (string) $conflict['id'] : null,
            $conflicts
        )),
        'blockerIds' => array_values(array_map(
            static fn (array $blocker): ?string => isset($blocker['id']) ? (string) $blocker['id'] : null,
            $blockers
        )),
    ]);

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'PLAN_NOT_READY',
        'message' => 'Refusing ' . $mode . ' for a non-ready plan.',
        'mode' => $mode,
        'status' => $status,
        'summary' => $plan['summary'] ?? null,
        'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        'audit' => [
            'conflicts' => array_map('reprint_push_protocol_conflict_evidence', $conflicts),
            'blockers' => array_map('reprint_push_protocol_blocker_evidence', $blockers),
        ],
    ]);
}

function reprint_push_protocol_conflict_evidence(array $conflict): array
{
    return [
        'id' => $conflict['id'] ?? null,
        'resourceKey' => $conflict['resourceKey'] ?? null,
        'class' => $conflict['class'] ?? null,
        'reason' => $conflict['reason'] ?? null,
        'resolutionPolicy' => $conflict['resolutionPolicy'] ?? null,
        'baseHash' => $conflict['baseHash'] ?? null,
        'localHash' => $conflict['localHash'] ?? null,
        'remoteHash' => $conflict['remoteHash'] ?? null,
    ];
}

function reprint_push_protocol_blocker_evidence(array $blocker): array
{
    return [
        'id' => $blocker['id'] ?? null,
        'class' => $blocker['class'] ?? null,
        'groupId' => $blocker['groupId'] ?? null,
        'plugin' => $blocker['plugin'] ?? null,
        'reason' => $blocker['reason'] ?? null,
    ];
}

function reprint_push_protocol_plan_array(array $plan, string $key): array
{
    if (!isset($plan[$key])) {
        return [];
    }
    if (!is_array($plan[$key])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Plan ' . $key . ' must be an array.',
        ]);
    }
    return $plan[$key];
}

function reprint_push_protocol_preconditions_by_mutation(array $preconditions): array
{
    $indexed = [];
    foreach ($preconditions as $precondition) {
        if (!is_array($precondition) || empty($precondition['mutationId'])) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Invalid precondition entry.',
            ]);
        }

        $mutation_id = (string) $precondition['mutationId'];
        if (array_key_exists($mutation_id, $indexed)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Duplicate precondition for mutation: ' . $mutation_id,
            ]);
        }
        $indexed[$mutation_id] = $precondition;
    }
    return $indexed;
}

function reprint_push_protocol_validate_mutations_and_preconditions(
    array $mutations,
    array $preconditions,
    array $precondition_entries
): void {
    $mutation_ids = [];
    $current_snapshot = reprint_push_export_snapshot();

    foreach ($mutations as $mutation) {
        reprint_push_protocol_validate_mutation_shape($mutation);
        reprint_push_assert_supported_apply_resource($mutation['resource']);
        try {
            reprint_push_assert_supported_plugin_owned_mutation($mutation, $current_snapshot);
        } catch (Throwable $error) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => $error->getMessage(),
            ]);
        }

        $mutation_id = (string) $mutation['id'];
        if (isset($mutation_ids[$mutation_id])) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Duplicate mutation id: ' . $mutation_id,
            ]);
        }
        $mutation_ids[$mutation_id] = true;

        if (!array_key_exists($mutation_id, $preconditions)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Missing precondition for mutation: ' . $mutation_id,
            ]);
        }

        reprint_push_protocol_validate_precondition_shape($preconditions[$mutation_id]);
        reprint_push_assert_supported_apply_resource($preconditions[$mutation_id]['resource']);
        reprint_push_protocol_assert_precondition_binds_to_mutation($preconditions[$mutation_id], $mutation);
    }

    foreach ($precondition_entries as $precondition) {
        reprint_push_protocol_validate_precondition_shape($precondition);
        if (!array_key_exists((string) $precondition['mutationId'], $mutation_ids)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Precondition references unknown mutation: ' . (string) $precondition['mutationId'],
            ]);
        }
        reprint_push_assert_supported_apply_resource($precondition['resource']);
    }

    reprint_push_protocol_validate_mutation_dependencies($mutations);
}

function reprint_push_protocol_validate_mutation_dependencies(array $mutations): void
{
    $mutation_by_id = [];
    foreach ($mutations as $mutation) {
        $mutation_by_id[(string) $mutation['id']] = $mutation;
    }

    $seen = [];
    foreach ($mutations as $mutation) {
        $mutation_id = (string) $mutation['id'];
        $dependency_ids = array_keys(reprint_push_protocol_string_set($mutation['dependsOnMutationIds'] ?? []));
        foreach ($dependency_ids as $dependency_id) {
            if (!array_key_exists($dependency_id, $mutation_by_id)) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'INVALID_PLAN',
                    'message' => 'Mutation ' . $mutation_id . ' depends on unknown mutation ' . $dependency_id . '.',
                ]);
            }
            if (!array_key_exists($dependency_id, $seen)) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'INVALID_PLAN',
                    'message' => 'Mutation ' . $mutation_id . ' depends on ' . $dependency_id . ', but the dependency is not ordered first.',
                ]);
            }
        }

        foreach (reprint_push_protocol_plan_array($mutation, 'wordpressGraphReferences') as $reference) {
            if ((string) ($reference['resolutionPolicy'] ?? '') !== 'same-plan-local-create') {
                continue;
            }
            $dependency = is_array($reference['dependency'] ?? null) ? $reference['dependency'] : [];
            $target_mutation_id = (string) ($dependency['targetMutationId'] ?? '');
            $target_resource_key = (string) ($dependency['targetResourceKey'] ?? '');
            $target_local_hash = (string) ($dependency['targetLocalHash'] ?? '');
            $target_mutation = $target_mutation_id !== '' && array_key_exists($target_mutation_id, $mutation_by_id)
                ? $mutation_by_id[$target_mutation_id]
                : null;
            $target_matches = is_array($target_mutation)
                && in_array($target_mutation_id, $dependency_ids, true)
                && (string) ($dependency['source'] ?? '') === 'same-plan-local-create'
                && $target_resource_key === (string) ($reference['targetResourceKey'] ?? '')
                && $target_local_hash === (string) ($reference['targetLocalHash'] ?? '')
                && (string) ($target_mutation['resourceKey'] ?? '') === $target_resource_key
                && (string) ($target_mutation['action'] ?? '') === 'put'
                && (string) ($target_mutation['changeKind'] ?? '') === 'create'
                && (string) ($target_mutation['localHash'] ?? '') === $target_local_hash;
            if (!$target_matches) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'INVALID_PLAN',
                    'message' => 'Mutation ' . $mutation_id . ' has invalid same-plan WordPress graph dependency evidence.',
                ]);
            }
        }

        $seen[$mutation_id] = true;
    }
}

function reprint_push_protocol_validate_fixture_atomic_dependencies(
    array $plan,
    array $snapshot,
    array $mutations,
    array $journal_context = []
): void {
    try {
        reprint_push_validate_fixture_atomic_group_dependencies($plan, $snapshot, $mutations);
    } catch (Throwable $error) {
        $journal_entry = reprint_push_protocol_append_journal_event('atomic-dependency-invalid', $journal_context + [
            'planId' => $plan['id'] ?? null,
            'reasonHash' => hash('sha256', $error->getMessage()),
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'ATOMIC_GROUP_DEPENDENCY_INVALID',
            'message' => $error->getMessage(),
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
            'currentSnapshot' => $snapshot,
        ]);
    }
}

function reprint_push_protocol_validate_mutation_shape(array $mutation): void
{
    foreach (['id', 'resource', 'resourceKey', 'value', 'localHash'] as $key) {
        if (!array_key_exists($key, $mutation)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Mutation is missing ' . $key . '.',
            ]);
        }
    }
    if (!is_array($mutation['resource']) || !is_array($mutation['value'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Mutation resource and value must be objects.',
        ]);
    }
}

function reprint_push_protocol_validate_precondition_shape(array $precondition): void
{
    foreach (['mutationId', 'resource', 'resourceKey', 'expectedHash'] as $key) {
        if (!array_key_exists($key, $precondition)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_PLAN',
                'message' => 'Precondition is missing ' . $key . '.',
            ]);
        }
    }
    if (!is_array($precondition['resource'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Precondition resource must be an object.',
        ]);
    }
}

function reprint_push_protocol_assert_precondition_binds_to_mutation(array $precondition, array $mutation): void
{
    if ((string) $precondition['mutationId'] !== (string) $mutation['id']) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Precondition mutationId does not match mutation id: ' . (string) $mutation['id'],
        ]);
    }
    if ((string) $precondition['resourceKey'] !== (string) $mutation['resourceKey']) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Precondition resourceKey does not match mutation: ' . (string) $mutation['id'],
        ]);
    }
    if (reprint_push_stable_json($precondition['resource']) !== reprint_push_stable_json($mutation['resource'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_PLAN',
            'message' => 'Precondition resource does not match mutation: ' . (string) $mutation['id'],
        ]);
    }
}

function reprint_push_protocol_verify_preconditions(array $snapshot, array $preconditions, array $journal_context = []): array
{
    $verified = [];

    foreach ($preconditions as $precondition) {
        $actual_hash = reprint_push_hash_resource($snapshot, $precondition['resource']);
        $expected_hash = (string) $precondition['expectedHash'];

        if ($actual_hash !== $expected_hash) {
            $journal_entry = reprint_push_protocol_append_journal_event('precondition-failed', $journal_context + [
                'mutationId' => (string) $precondition['mutationId'],
                'resourceKey' => (string) $precondition['resourceKey'],
                'expectedHash' => $expected_hash,
                'actualHash' => $actual_hash,
            ]);

            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'PRECONDITION_FAILED',
                'message' => 'Precondition failed for ' . (string) $precondition['resourceKey'] . '.',
                'resourceKey' => (string) $precondition['resourceKey'],
                'mutationId' => (string) $precondition['mutationId'],
                'expectedHash' => $expected_hash,
                'actualHash' => $actual_hash,
                'journal' => reprint_push_protocol_journal_evidence($journal_entry),
                'currentSnapshot' => $snapshot,
            ]);
        }

        $verified[] = [
            'mutationId' => (string) $precondition['mutationId'],
            'resourceKey' => (string) $precondition['resourceKey'],
            'expectedHash' => $expected_hash,
            'actualHash' => $actual_hash,
        ];
    }

    return $verified;
}

function reprint_push_protocol_verify_after_hashes(array $snapshot, array $mutations): array
{
    $verified = [];

    foreach ($mutations as $mutation) {
        $actual_hash = reprint_push_hash_resource($snapshot, $mutation['resource']);
        $expected_hash = (string) ($mutation['localHash'] ?? '');

        if ($actual_hash !== $expected_hash) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'POST_APPLY_VERIFICATION_FAILED',
                'message' => 'Post-apply verification failed for ' . (string) $mutation['resourceKey'] . '.',
                'resourceKey' => (string) $mutation['resourceKey'],
                'mutationId' => (string) $mutation['id'],
                'expectedHash' => $expected_hash,
                'actualHash' => $actual_hash,
                'afterSnapshot' => $snapshot,
            ]);
        }

        $verified[] = (string) $mutation['resourceKey'];
    }

    return $verified;
}

function reprint_push_protocol_create_receipt(
    array $plan,
    array $plan_evidence,
    array $mutations,
    array $preconditions,
    array $verified_preconditions,
    array $snapshot
): array {
    $receipt = [
        'schemaVersion' => 1,
        'protocol' => 'reprint-push-lab',
        'mode' => 'dry-run',
        'planId' => $plan['id'] ?? null,
        'planHash' => $plan_evidence['planHash'],
        'planFingerprint' => $plan_evidence['planFingerprint'],
        'summaryHash' => $plan_evidence['summaryHash'],
        'mutationSetHash' => $plan_evidence['mutationSetHash'],
        'preconditionSetHash' => $plan_evidence['preconditionSetHash'],
        'snapshotHash' => hash('sha256', reprint_push_stable_json($snapshot)),
        'mutationCount' => count($mutations),
        'verifiedResourceKeys' => array_values(array_map(
            static fn (array $entry): string => (string) $entry['resourceKey'],
            $verified_preconditions
        )),
        'planPreconditions' => reprint_push_protocol_plan_precondition_hashes($preconditions),
        'preconditionHashes' => array_values(array_map(
            static fn (array $entry): array => [
                'mutationId' => (string) $entry['mutationId'],
                'resourceKey' => (string) $entry['resourceKey'],
                'expectedHash' => (string) $entry['expectedHash'],
                'actualHash' => (string) $entry['actualHash'],
            ],
            $verified_preconditions
        )),
    ];
    $receipt['receiptHash'] = hash('sha256', reprint_push_stable_json($receipt));

    return $receipt;
}

function reprint_push_protocol_extract_receipt(array $receipt_payload): array
{
    $receipt = isset($receipt_payload['receipt']) && is_array($receipt_payload['receipt'])
        ? $receipt_payload['receipt']
        : $receipt_payload;

    if (!is_array($receipt)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_RECEIPT',
            'message' => 'Receipt JSON did not contain a receipt object.',
        ]);
    }

    return $receipt;
}

function reprint_push_protocol_assert_receipt_binds_to_plan(
    array $receipt,
    array $plan,
    array $plan_evidence,
    array $mutations,
    array $preconditions
): void {
    $required = [
        'schemaVersion',
        'protocol',
        'mode',
        'planId',
        'planHash',
        'planFingerprint',
        'summaryHash',
        'mutationSetHash',
        'preconditionSetHash',
        'mutationCount',
        'verifiedResourceKeys',
        'planPreconditions',
        'preconditionHashes',
        'receiptHash',
    ];
    foreach ($required as $key) {
        if (!array_key_exists($key, $receipt)) {
            reprint_push_protocol_receipt_mismatch('Receipt is missing ' . $key . '.', $plan_evidence, $receipt);
        }
    }

    $expected_hash = (string) $receipt['receiptHash'];
    $without_hash = $receipt;
    unset($without_hash['receiptHash']);
    if (hash('sha256', reprint_push_stable_json($without_hash)) !== $expected_hash) {
        reprint_push_protocol_receipt_mismatch('Receipt hash does not match receipt body.', $plan_evidence, $receipt);
    }

    $plan_id = $plan['id'] ?? null;
    $expected_keys = array_values(array_map(
        static fn (array $mutation): string => (string) $mutation['resourceKey'],
        $mutations
    ));
    $expected_plan_preconditions = reprint_push_protocol_plan_precondition_hashes($preconditions);
    $expected_dry_run_hashes = reprint_push_protocol_expected_dry_run_precondition_hashes($preconditions);

    if ((int) $receipt['schemaVersion'] !== 1
        || (string) $receipt['protocol'] !== 'reprint-push-lab'
        || (string) $receipt['mode'] !== 'dry-run'
        || (string) $receipt['planId'] !== (string) $plan_id
        || (string) $receipt['planHash'] !== (string) $plan_evidence['planHash']
        || (string) $receipt['planFingerprint'] !== (string) $plan_evidence['planFingerprint']
        || (string) $receipt['summaryHash'] !== (string) $plan_evidence['summaryHash']
        || (string) $receipt['mutationSetHash'] !== (string) $plan_evidence['mutationSetHash']
        || (string) $receipt['preconditionSetHash'] !== (string) $plan_evidence['preconditionSetHash']
        || (int) $receipt['mutationCount'] !== count($mutations)
        || !is_array($receipt['verifiedResourceKeys'])
        || array_values($receipt['verifiedResourceKeys']) !== $expected_keys
        || !is_array($receipt['planPreconditions'])
        || array_values($receipt['planPreconditions']) !== $expected_plan_preconditions
        || !is_array($receipt['preconditionHashes'])
        || array_values($receipt['preconditionHashes']) !== $expected_dry_run_hashes
    ) {
        reprint_push_protocol_receipt_mismatch('Receipt does not bind to the supplied plan.', $plan_evidence, $receipt);
    }
}

function reprint_push_protocol_plan_hash(array $plan): string
{
    return hash('sha256', reprint_push_stable_json($plan));
}

function reprint_push_protocol_plan_evidence(
    array $plan,
    string $plan_hash,
    array $mutations,
    array $preconditions
): array {
    $resource_keys = array_values(array_map(
        static fn (array $mutation): string => (string) $mutation['resourceKey'],
        $mutations
    ));

    return [
        'planId' => $plan['id'] ?? null,
        'planHash' => $plan_hash,
        'planFingerprint' => hash('sha256', reprint_push_stable_json([
            'id' => $plan['id'] ?? null,
            'status' => $plan['status'] ?? null,
            'summary' => $plan['summary'] ?? null,
            'mutations' => reprint_push_protocol_mutation_bindings($mutations),
            'preconditions' => reprint_push_protocol_precondition_bindings($preconditions),
        ])),
        'summaryHash' => hash('sha256', reprint_push_stable_json($plan['summary'] ?? null)),
        'mutationSetHash' => hash('sha256', reprint_push_stable_json(reprint_push_protocol_mutation_bindings($mutations))),
        'preconditionSetHash' => hash('sha256', reprint_push_stable_json(reprint_push_protocol_precondition_bindings($preconditions))),
        'mutationCount' => count($mutations),
        'resourceKeys' => $resource_keys,
    ];
}

function reprint_push_protocol_mutation_bindings(array $mutations): array
{
    return array_values(array_map(
        static fn (array $mutation): array => [
            'id' => (string) $mutation['id'],
            'resourceKey' => (string) $mutation['resourceKey'],
            'resource' => $mutation['resource'],
            'action' => $mutation['action'] ?? null,
            'changeKind' => $mutation['changeKind'] ?? null,
            'baseHash' => $mutation['baseHash'] ?? null,
            'remoteBeforeHash' => $mutation['remoteBeforeHash'] ?? null,
            'localHash' => $mutation['localHash'] ?? null,
        ],
        $mutations
    ));
}

function reprint_push_protocol_precondition_bindings(array $preconditions): array
{
    return array_values(array_map(
        static fn (array $precondition): array => [
            'mutationId' => (string) $precondition['mutationId'],
            'resourceKey' => (string) $precondition['resourceKey'],
            'resource' => $precondition['resource'],
            'expectedHash' => (string) $precondition['expectedHash'],
        ],
        $preconditions
    ));
}

function reprint_push_protocol_plan_precondition_hashes(array $preconditions): array
{
    return array_values(array_map(
        static fn (array $precondition): array => [
            'mutationId' => (string) $precondition['mutationId'],
            'resourceKey' => (string) $precondition['resourceKey'],
            'expectedHash' => (string) $precondition['expectedHash'],
        ],
        $preconditions
    ));
}

function reprint_push_protocol_expected_dry_run_precondition_hashes(array $preconditions): array
{
    return array_values(array_map(
        static fn (array $precondition): array => [
            'mutationId' => (string) $precondition['mutationId'],
            'resourceKey' => (string) $precondition['resourceKey'],
            'expectedHash' => (string) $precondition['expectedHash'],
            'actualHash' => (string) $precondition['expectedHash'],
        ],
        $preconditions
    ));
}

function reprint_push_protocol_compact_precondition_hashes(array $preconditions): array
{
    return array_values(array_map(
        static fn (array $entry): array => [
            'mutationId' => (string) $entry['mutationId'],
            'resourceKey' => (string) $entry['resourceKey'],
            'expectedHash' => (string) $entry['expectedHash'],
            'actualHash' => (string) $entry['actualHash'],
        ],
        $preconditions
    ));
}

function reprint_push_protocol_receipt_mismatch(string $message, array $plan_evidence, array $receipt): void
{
    $journal_entry = reprint_push_protocol_append_journal_event('receipt-mismatch', $plan_evidence + [
        'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null,
        'receiptPlanId' => $receipt['planId'] ?? null,
        'receiptPlanHash' => $receipt['planHash'] ?? null,
        'reasonHash' => hash('sha256', $message),
    ]);

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'RECEIPT_MISMATCH',
        'message' => $message,
        'planId' => $plan_evidence['planId'] ?? null,
        'planHash' => $plan_evidence['planHash'] ?? null,
        'receiptPlanId' => $receipt['planId'] ?? null,
        'receiptPlanHash' => $receipt['planHash'] ?? null,
        'journal' => reprint_push_protocol_journal_evidence($journal_entry),
    ]);
}

function reprint_push_protocol_append_journal_event(string $event, array $context = []): array
{
    $journal = get_option('reprint_push_protocol_journal', null);
    if (!is_array($journal)) {
        $journal = [
            'schemaVersion' => 1,
            'nextSequence' => 1,
            'entries' => [],
        ];
    }

    $sequence = max(1, (int) ($journal['nextSequence'] ?? 1));
    $entry = [
        'sequence' => $sequence,
        'cursor' => 'journal:' . $sequence,
        'event' => $event,
        'recordedAt' => gmdate('Y-m-d\TH:i:s\Z'),
    ] + reprint_push_protocol_sanitize_journal_context($context);

    $entries = isset($journal['entries']) && is_array($journal['entries']) ? $journal['entries'] : [];
    $entries[] = $entry;
    $journal['entries'] = array_slice($entries, -80);
    $journal['nextSequence'] = $sequence + 1;

    update_option('reprint_push_protocol_journal', $journal, false);

    return $entry;
}

function reprint_push_protocol_journal_evidence(array $entry): array
{
    $journal = get_option('reprint_push_protocol_journal', null);
    $entries = is_array($journal) && isset($journal['entries']) && is_array($journal['entries'])
        ? $journal['entries']
        : [];
    $recent = array_slice($entries, -5);
    $pinned = [];
    foreach (['startedCursor', 'failedCursor'] as $cursor_key) {
        if (!isset($entry[$cursor_key])) {
            continue;
        }
        $cursor = (string) $entry[$cursor_key];
        foreach ($entries as $candidate) {
            if (is_array($candidate) && isset($candidate['cursor']) && (string) $candidate['cursor'] === $cursor) {
                $pinned[$cursor] = $candidate;
                break;
            }
        }
    }
    foreach (array_reverse($recent) as $candidate) {
        if (!is_array($candidate) || !isset($candidate['cursor'])) {
            continue;
        }
        $pinned[(string) $candidate['cursor']] = $candidate;
        if (count($pinned) >= 5) {
            break;
        }
    }
    $recent = array_values($pinned);
    usort($recent, static function (array $left, array $right): int {
        return (int) ($left['sequence'] ?? 0) <=> (int) ($right['sequence'] ?? 0);
    });

    return [
        'option' => 'reprint_push_protocol_journal',
        'cursor' => $entry['cursor'],
        'event' => $entry['event'],
        'sequence' => $entry['sequence'],
        'recent' => $recent,
    ];
}

function reprint_push_protocol_sanitize_journal_context(array $context): array
{
    $safe = [];
    foreach ($context as $key => $value) {
        $key = (string) $key;
        if (in_array($key, ['value', 'content', 'payload', 'option_value', 'post_content', 'meta_value', 'currentSnapshot', 'afterSnapshot', 'beforeSnapshot'], true)) {
            continue;
        }
        $safe[$key] = reprint_push_protocol_sanitize_journal_value($value);
    }
    return $safe;
}

function reprint_push_protocol_sanitize_journal_value($value)
{
    if (is_array($value)) {
        $safe = [];
        foreach ($value as $key => $inner_value) {
            $key = (string) $key;
            if (in_array($key, ['value', 'content', 'payload', 'option_value', 'post_content', 'meta_value'], true)) {
                continue;
            }
            $safe[$key] = reprint_push_protocol_sanitize_journal_value($inner_value);
        }
        return $safe;
    }
    if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
        return $value;
    }
    return (string) $value;
}
