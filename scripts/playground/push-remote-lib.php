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

    $plan = reprint_push_protocol_read_json_file($plan_path, 'Plan');
    reprint_push_protocol_assert_plan_ready($plan, $mode);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);

    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);

    $plan_hash = reprint_push_protocol_plan_hash($plan);
    $receipt = null;

    if ($receipt_path !== null && $receipt_path !== '') {
        if ($mode !== 'apply') {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Receipt paths are only accepted for apply.',
                'mode' => $mode,
            ]);
        }

        $receipt = reprint_push_protocol_extract_receipt(
            reprint_push_protocol_read_json_file($receipt_path, 'Receipt')
        );
        reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_hash, $mutations);
    }

    $current = reprint_push_export_snapshot();
    $verified_preconditions = reprint_push_protocol_verify_preconditions($current, $precondition_entries);

    if ($mode === 'dry-run') {
        $receipt = reprint_push_protocol_create_receipt($plan, $plan_hash, $mutations, $verified_preconditions, $current);

        return [
            'ok' => true,
            'mode' => 'dry-run',
            'applied' => 0,
            'verifiedPreconditions' => $verified_preconditions,
            'receipt' => $receipt,
            'currentSnapshot' => $current,
        ];
    }

    foreach ($mutations as $mutation) {
        reprint_push_apply_resource($mutation['resource'], $mutation['value']);
    }

    $after = reprint_push_export_snapshot();
    $verified_keys = reprint_push_protocol_verify_after_hashes($after, $mutations);
    $receipt = $receipt ?? reprint_push_protocol_create_receipt($plan, $plan_hash, $mutations, $verified_preconditions, $current);

    return [
        'ok' => true,
        'mode' => 'apply',
        'applied' => count($mutations),
        'verifiedKeys' => $verified_keys,
        'verifiedPreconditions' => $verified_preconditions,
        'receipt' => $receipt,
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

function reprint_push_protocol_assert_plan_ready(array $plan, string $mode): void
{
    $status = (string) ($plan['status'] ?? 'unknown');
    $conflicts = isset($plan['conflicts']) && is_array($plan['conflicts']) ? $plan['conflicts'] : [];
    $blockers = isset($plan['blockers']) && is_array($plan['blockers']) ? $plan['blockers'] : [];

    if ($status === 'ready' && count($conflicts) === 0 && count($blockers) === 0) {
        return;
    }

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'PLAN_NOT_READY',
        'message' => 'Refusing ' . $mode . ' for a non-ready plan.',
        'mode' => $mode,
        'status' => $status,
        'summary' => $plan['summary'] ?? null,
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

function reprint_push_protocol_verify_preconditions(array $snapshot, array $preconditions): array
{
    $verified = [];

    foreach ($preconditions as $precondition) {
        $actual_hash = reprint_push_hash_resource($snapshot, $precondition['resource']);
        $expected_hash = (string) $precondition['expectedHash'];

        if ($actual_hash !== $expected_hash) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'PRECONDITION_FAILED',
                'message' => 'Precondition failed for ' . (string) $precondition['resourceKey'] . '.',
                'resourceKey' => (string) $precondition['resourceKey'],
                'mutationId' => (string) $precondition['mutationId'],
                'expectedHash' => $expected_hash,
                'actualHash' => $actual_hash,
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
    string $plan_hash,
    array $mutations,
    array $verified_preconditions,
    array $snapshot
): array {
    $receipt = [
        'schemaVersion' => 1,
        'protocol' => 'reprint-push-lab',
        'mode' => 'dry-run',
        'planId' => $plan['id'] ?? null,
        'planHash' => $plan_hash,
        'snapshotHash' => hash('sha256', reprint_push_stable_json($snapshot)),
        'mutationCount' => count($mutations),
        'verifiedResourceKeys' => array_values(array_map(
            static fn (array $entry): string => (string) $entry['resourceKey'],
            $verified_preconditions
        )),
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
    string $plan_hash,
    array $mutations
): void {
    $required = ['schemaVersion', 'protocol', 'mode', 'planHash', 'mutationCount', 'verifiedResourceKeys', 'receiptHash'];
    foreach ($required as $key) {
        if (!array_key_exists($key, $receipt)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_RECEIPT',
                'message' => 'Receipt is missing ' . $key . '.',
            ]);
        }
    }

    $expected_hash = (string) $receipt['receiptHash'];
    $without_hash = $receipt;
    unset($without_hash['receiptHash']);
    if (hash('sha256', reprint_push_stable_json($without_hash)) !== $expected_hash) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_RECEIPT',
            'message' => 'Receipt hash does not match receipt body.',
        ]);
    }

    $plan_id = $plan['id'] ?? null;
    $expected_keys = array_values(array_map(
        static fn (array $mutation): string => (string) $mutation['resourceKey'],
        $mutations
    ));

    if ((int) $receipt['schemaVersion'] !== 1
        || (string) $receipt['protocol'] !== 'reprint-push-lab'
        || (string) $receipt['mode'] !== 'dry-run'
        || (string) $receipt['planHash'] !== $plan_hash
        || ($plan_id !== null && ($receipt['planId'] ?? null) !== $plan_id)
        || (int) $receipt['mutationCount'] !== count($mutations)
        || !is_array($receipt['verifiedResourceKeys'])
        || array_values($receipt['verifiedResourceKeys']) !== $expected_keys
    ) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'RECEIPT_PLAN_MISMATCH',
            'message' => 'Receipt does not bind to the supplied plan.',
            'receiptPlanId' => $receipt['planId'] ?? null,
            'planId' => $plan_id,
            'receiptPlanHash' => $receipt['planHash'] ?? null,
            'planHash' => $plan_hash,
        ]);
    }
}

function reprint_push_protocol_plan_hash(array $plan): string
{
    return hash('sha256', reprint_push_stable_json($plan));
}
