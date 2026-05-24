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
    if (!in_array($mode, ['dry-run', 'apply'], true)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Mode must be dry-run or apply.',
            'mode' => $mode,
        ]);
    }

    if ($mode === 'apply' && ($receipt_path === null || $receipt_path === '')) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', [
            'mode' => $mode,
            'planPathHash' => hash('sha256', $plan_path),
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON path.',
            'mode' => $mode,
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    $plan = reprint_push_protocol_read_json_file($plan_path, 'Plan');
    $receipt_payload = null;

    if ($receipt_path !== null && $receipt_path !== '') {
        if ($mode !== 'apply') {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Receipt paths are only accepted for apply.',
                'mode' => $mode,
            ]);
        }

        $receipt_payload = reprint_push_protocol_read_json_file($receipt_path, 'Receipt');
    }

    return reprint_push_protocol_run_payload($mode, $plan, $receipt_payload, [
        'transport' => 'cli-file',
    ]);
}

function reprint_push_protocol_run_payload(
    string $mode,
    array $plan,
    ?array $receipt_payload = null,
    array $journal_context = []
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

    $started_entry = reprint_push_protocol_append_journal_event('apply-started', $journal_context + $plan_evidence + [
        'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
        'verifiedPreconditions' => reprint_push_protocol_compact_precondition_hashes($verified_preconditions),
    ]);

    foreach ($mutations as $mutation) {
        reprint_push_apply_resource($mutation['resource'], $mutation['value']);
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

    foreach ($mutations as $mutation) {
        reprint_push_protocol_validate_mutation_shape($mutation);
        reprint_push_assert_supported_apply_resource($mutation['resource']);

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

    return [
        'option' => 'reprint_push_protocol_journal',
        'cursor' => $entry['cursor'],
        'event' => $entry['event'],
        'sequence' => $entry['sequence'],
        'recent' => array_slice($entries, -5),
    ];
}

function reprint_push_protocol_sanitize_journal_context(array $context): array
{
    $safe = [];
    foreach ($context as $key => $value) {
        $key = (string) $key;
        if (in_array($key, ['value', 'content', 'payload', 'currentSnapshot', 'afterSnapshot', 'beforeSnapshot'], true)) {
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
            if (in_array($key, ['value', 'content', 'payload', 'option_value', 'post_content'], true)) {
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
