<?php
/**
 * Plugin Name: Reprint Push Lab REST Endpoint
 * Description: Lab-only WordPress REST surface for the local Playground push protocol fixture.
 * Version: 0.0.0
 * License: GPL-2.0-or-later
 *
 * This file is intentionally public and unauthenticated only for local
 * Playground proof runs. It must be loaded as an ordinary plugin or mu-plugin
 * inside a disposable local WordPress instance; it is not production auth.
 */

if (!defined('ABSPATH')) {
    exit;
}

$reprint_push_lab_dir = getenv('REPRINT_PUSH_LAB_DIR') ?: __DIR__;
if (!is_file($reprint_push_lab_dir . '/snapshot-lib.php') && is_file('/workspace/scripts/playground/snapshot-lib.php')) {
    $reprint_push_lab_dir = '/workspace/scripts/playground';
}

require_once $reprint_push_lab_dir . '/snapshot-lib.php';
require_once $reprint_push_lab_dir . '/push-remote-lib.php';
require_once $reprint_push_lab_dir . '/push-db-journal-lib.php';

const REPRINT_PUSH_LAB_REST_NAMESPACE = 'reprint-push-lab/v1';

add_action('rest_api_init', 'reprint_push_lab_rest_register_routes');

function reprint_push_lab_rest_register_routes(): void
{
    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/dry-run', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_dry_run',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/apply', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_apply',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/recovery/inspect', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_recovery_inspect',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/snapshot', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_snapshot',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_journal',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
        'args' => [
            'limit' => [
                'type' => 'integer',
                'default' => 20,
                'minimum' => 1,
                'maximum' => 80,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/db-journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
        'args' => [
            'limit' => [
                'type' => 'integer',
                'default' => 20,
                'minimum' => 1,
                'maximum' => 80,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/db-journal/schema', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal_schema',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);
}

function reprint_push_lab_rest_public_lab_permission(): bool
{
    return true;
}

function reprint_push_lab_rest_dry_run(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_protocol_response('dry-run', $request);
}

function reprint_push_lab_rest_apply(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_apply_with_db_journal($request);
}

function reprint_push_lab_rest_recovery_inspect(WP_REST_Request $request): WP_REST_Response
{
    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'inspect');
        $receipt = reprint_push_lab_rest_receipt_payload($payload);

        $result = reprint_push_protocol_inspect_recovery($plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
            'restRoute' => '/recovery/inspect',
        ]);
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_protocol_response(string $mode, WP_REST_Request $request): WP_REST_Response
{
    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, $mode);
        $receipt = $mode === 'apply' ? reprint_push_lab_rest_receipt_payload($payload) : null;

        $result = reprint_push_protocol_run_payload($mode, $plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
        ], reprint_push_lab_rest_lab_options($payload));
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_apply_with_db_journal(WP_REST_Request $request): WP_REST_Response
{
    $context = null;
    $received_entry = null;

    try {
        $idempotency_key = trim((string) $request->get_header('x-reprint-push-idempotency-key'));
        if ($idempotency_key === '') {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'MISSING_IDEMPOTENCY_KEY',
                'message' => 'POST /apply requires X-Reprint-Push-Idempotency-Key for the DB journal idempotency path.',
                'mode' => 'apply',
            ]);
        }

        $payload = reprint_push_lab_rest_json_payload($request);
        $context = reprint_push_lab_rest_db_journal_context($payload, $idempotency_key);
        $committed = reprint_push_lab_db_journal_committed_row_for_key($context['idempotencyKeyHash']);

        if (is_array($committed) && (string) ($committed['request_hash'] ?? '') === $context['requestHash']) {
            $replay_result = reprint_push_lab_db_journal_replay_result($committed);
            $replay_entry = reprint_push_lab_db_journal_append_event('apply-replayed', $context + [
                'appliedCount' => 0,
                'result' => $replay_result,
                'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($replay_result),
            ]);
            $replay_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($replay_entry);
            return reprint_push_lab_rest_json_response($replay_result);
        }

        if (reprint_push_lab_db_journal_key_has_different_request($context['idempotencyKeyHash'], $context['requestHash'])) {
            return reprint_push_lab_rest_json_response(
                reprint_push_lab_rest_idempotency_conflict_result($context)
            );
        }

        $claim = reprint_push_lab_db_journal_try_open_idempotency($context);
        if (($claim['opened'] ?? false) !== true) {
            $claim_entry = is_array($claim['entry'] ?? null) ? $claim['entry'] : [];
            if ((string) ($claim_entry['requestHash'] ?? '') !== $context['requestHash']) {
                return reprint_push_lab_rest_json_response(
                    reprint_push_lab_rest_idempotency_conflict_result($context)
                );
            }

            $terminal = reprint_push_lab_db_journal_terminal_row_for_key($context['idempotencyKeyHash']);
            if (is_array($terminal) && (string) ($terminal['request_hash'] ?? '') === $context['requestHash']) {
                $replay_result = (string) ($terminal['event'] ?? '') === 'apply-committed'
                    ? reprint_push_lab_db_journal_replay_result($terminal)
                    : reprint_push_lab_db_journal_replay_rejected_result($terminal);
                $replay_entry = reprint_push_lab_db_journal_append_event('apply-replayed', $context + [
                    'appliedCount' => 0,
                    'result' => $replay_result,
                    'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($replay_result),
                ]);
                $replay_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($replay_entry);
                return reprint_push_lab_rest_json_response($replay_result);
            }

            $in_progress_result = [
                'ok' => false,
                'code' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
                'message' => 'An apply request for this idempotency key is already in progress. Retry the same canonical request.',
                'mode' => 'apply',
                'idempotency' => [
                    'replayed' => false,
                    'conflict' => false,
                    'inProgress' => true,
                    'freshMutationWork' => false,
                    'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                    'requestHash' => $context['requestHash'],
                    'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                ],
            ];
            $in_progress_entry = reprint_push_lab_db_journal_append_event('idempotency-in-progress', $context + [
                'errorCode' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
                'result' => $in_progress_result,
                'resourceHashEvidence' => [
                    'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                    'requestHash' => $context['requestHash'],
                ],
            ]);
            $in_progress_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($in_progress_entry);
            return reprint_push_lab_rest_json_response($in_progress_result);
        }

        $opened_entry = $claim['entry'];
        reprint_push_lab_rest_delay_after_idempotency_open($payload);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
        $receipt = reprint_push_lab_rest_receipt_payload($payload);
        $mutations = reprint_push_lab_rest_plan_mutations_for_db_journal($plan);

        $started_entry = reprint_push_lab_db_journal_append_event('apply-started', $context + [
            'resourceHashEvidence' => [
                'openedCursor' => 'db-journal:' . (int) ($opened_entry['sequence'] ?? 0),
                'mutationCount' => count($mutations),
                'resourceKeys' => array_values(array_map(
                    static fn (array $mutation): string => (string) ($mutation['resourceKey'] ?? ''),
                    $mutations
                )),
            ],
        ]);

        $result = reprint_push_protocol_run_payload('apply', $plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'dbJournalCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
        ], reprint_push_lab_rest_lab_options($payload));

        $result['idempotency'] = [
            'replayed' => false,
            'freshMutationWork' => true,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
        ];
        $after_snapshot = reprint_push_export_snapshot();
        foreach ($mutations as $index => $mutation) {
            $observed_hash = reprint_push_hash_resource($after_snapshot, $mutation['resource']);
            reprint_push_lab_db_journal_append_event('mutation-applied', $context + [
                'appliedCount' => $index + 1,
                'resourceHashEvidence' => reprint_push_lab_db_journal_mutation_evidence($mutation, $observed_hash),
            ]);
        }
        $committed_entry = reprint_push_lab_db_journal_append_event('apply-committed', $context + [
            'appliedCount' => (int) ($result['applied'] ?? 0),
            'result' => reprint_push_lab_db_journal_compact_result($result),
            'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($result),
        ]);
        $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($committed_entry);
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
        if (is_array($context)) {
            $rejected_entry = reprint_push_lab_db_journal_append_event('apply-rejected', $context + [
                'appliedCount' => (int) ($result['applied'] ?? 0),
                'errorCode' => (string) ($result['code'] ?? 'PUSH_PROTOCOL_ERROR'),
                'result' => reprint_push_lab_db_journal_compact_result($result),
                'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($result),
            ]);
            $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($rejected_entry);
        }
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
        if (is_array($context)) {
            $error_entry = reprint_push_lab_db_journal_append_event('apply-rejected', $context + [
                'errorCode' => 'PUSH_PROTOCOL_ERROR',
                'result' => reprint_push_lab_db_journal_compact_result($result),
            ]);
            $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($error_entry);
        }
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_idempotency_conflict_result(array $context): array
{
    $conflict_result = [
        'ok' => false,
        'code' => 'IDEMPOTENCY_KEY_CONFLICT',
        'message' => 'Idempotency key was already used for a different canonical apply request.',
        'mode' => 'apply',
        'idempotency' => [
            'replayed' => false,
            'conflict' => true,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
        ],
    ];
    $conflict_entry = reprint_push_lab_db_journal_append_event('idempotency-key-conflict', $context + [
        'errorCode' => 'IDEMPOTENCY_KEY_CONFLICT',
        'result' => $conflict_result,
    ]);
    $conflict_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($conflict_entry);
    return $conflict_result;
}

function reprint_push_lab_rest_db_journal_context(array $payload, string $idempotency_key): array
{
    return [
        'idempotencyKeyHash' => reprint_push_lab_db_journal_key_hash($idempotency_key),
        'requestHash' => reprint_push_lab_db_journal_request_hash($payload),
        'planHash' => reprint_push_lab_db_journal_plan_hash_from_payload($payload),
        'receiptHash' => reprint_push_lab_db_journal_receipt_hash_from_payload($payload),
        'planFingerprint' => reprint_push_lab_db_journal_plan_fingerprint_from_payload($payload),
        'mutationCount' => reprint_push_lab_db_journal_mutation_count_from_payload($payload),
    ];
}

function reprint_push_lab_rest_plan_mutations_for_db_journal(array $plan): array
{
    if (!isset($plan['mutations'])) {
        return [];
    }
    if (!is_array($plan['mutations'])) {
        return [];
    }
    return array_values(array_filter($plan['mutations'], static function ($mutation): bool {
        return is_array($mutation)
            && isset($mutation['resource'])
            && is_array($mutation['resource']);
    }));
}

function reprint_push_lab_rest_json_payload(WP_REST_Request $request): array
{
    $payload = $request->get_json_params();
    if (!is_array($payload)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Request body must be a JSON object.',
        ]);
    }
    return $payload;
}

function reprint_push_lab_rest_plan_payload(array $payload, string $mode): array
{
    if (isset($payload['plan'])) {
        if (!is_array($payload['plan'])) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Request plan must be a JSON object.',
            ]);
        }
        return $payload['plan'];
    }

    if ($mode === 'dry-run') {
        return $payload;
    }

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'INVALID_ARGUMENT',
        'message' => 'Apply requires a plan JSON object.',
    ]);
}

function reprint_push_lab_rest_receipt_payload(array $payload): ?array
{
    if (!array_key_exists('receipt', $payload)) {
        return null;
    }
    if (!is_array($payload['receipt'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_RECEIPT',
            'message' => 'Receipt JSON must be an object.',
        ]);
    }
    return $payload['receipt'];
}

function reprint_push_lab_rest_lab_options(array $payload): array
{
    $options = [];
    if (array_key_exists('labFailAfterMutations', $payload)) {
        $options['labFailAfterMutations'] = $payload['labFailAfterMutations'];
    }
    return $options;
}

function reprint_push_lab_rest_delay_after_idempotency_open(array $payload): void
{
    if (!array_key_exists('labDelayAfterIdempotencyOpenMs', $payload)) {
        return;
    }

    $delay = $payload['labDelayAfterIdempotencyOpenMs'];
    if (!is_int($delay) && !(is_string($delay) && preg_match('/^\d+$/', $delay))) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labDelayAfterIdempotencyOpenMs must be a non-negative integer when supplied.',
        ]);
    }

    $milliseconds = max(0, min(5000, (int) $delay));
    if ($milliseconds > 0) {
        $deadline = microtime(true) + ($milliseconds / 1000);
        while (microtime(true) < $deadline) {
            // Lab-only overlap hook for concurrency smoke tests.
            if (function_exists('usleep')) {
                $remaining_microseconds = max(1, (int) (($deadline - microtime(true)) * 1000000));
                usleep(min(50000, $remaining_microseconds));
            }
        }
    }
}

function reprint_push_lab_rest_snapshot(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'snapshot' => reprint_push_export_snapshot(),
    ]);
}

function reprint_push_lab_rest_journal(WP_REST_Request $request): WP_REST_Response
{
    $limit = max(1, min(80, (int) $request->get_param('limit')));
    $journal = get_option('reprint_push_protocol_journal', null);
    $entries = is_array($journal) && isset($journal['entries']) && is_array($journal['entries'])
        ? $journal['entries']
        : [];

    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'journal' => [
            'option' => 'reprint_push_protocol_journal',
            'nextSequence' => is_array($journal) ? (int) ($journal['nextSequence'] ?? 1) : 1,
            'entries' => array_slice($entries, -$limit),
        ],
    ]);
}

function reprint_push_lab_rest_db_journal(WP_REST_Request $request): WP_REST_Response
{
    $limit = max(1, min(80, (int) $request->get_param('limit')));
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'dbJournal' => reprint_push_lab_db_journal_summary($limit),
    ]);
}

function reprint_push_lab_rest_db_journal_schema(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'dbJournalSchema' => reprint_push_lab_db_journal_schema(),
    ]);
}

function reprint_push_lab_rest_db_journal_evidence(array $entry): array
{
    return [
        'table' => reprint_push_lab_db_journal_table_name(),
        'cursor' => 'db-journal:' . (int) ($entry['sequence'] ?? 0),
        'event' => (string) ($entry['event'] ?? ''),
        'sequence' => (int) ($entry['sequence'] ?? 0),
        'idempotencyKeyHash' => (string) ($entry['idempotencyKeyHash'] ?? ''),
        'requestHash' => (string) ($entry['requestHash'] ?? ''),
        'resultHash' => (string) ($entry['resultHash'] ?? ''),
        'scope' => 'local Playground fixture only',
    ];
}

function reprint_push_lab_rest_json_response(array $result): WP_REST_Response
{
    $result['lab'] = reprint_push_lab_rest_lab_notice();
    $response = new WP_REST_Response($result, reprint_push_lab_rest_status_for_result($result));
    $response->header('X-Reprint-Push-Lab', 'local-only-public-playground');
    return $response;
}

function reprint_push_lab_rest_lab_notice(): array
{
    return [
        'surface' => 'wordpress-rest',
        'namespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
        'scope' => 'local Playground fixture only',
        'permission' => 'public lab route; not production auth',
    ];
}

function reprint_push_lab_rest_status_for_result(array $result): int
{
    if (($result['ok'] ?? false) === true) {
        return 200;
    }

    switch ((string) ($result['code'] ?? '')) {
        case 'MISSING_IDEMPOTENCY_KEY':
            return 400;
        case 'IDEMPOTENCY_KEY_CONFLICT':
        case 'IDEMPOTENCY_KEY_IN_PROGRESS':
            return 409;
        case 'MISSING_DRY_RUN_RECEIPT':
            return 428;
        case 'INVALID_ARGUMENT':
        case 'INVALID_PLAN':
        case 'INVALID_RECEIPT':
            return 400;
        case 'PRECONDITION_FAILED':
            return 412;
        case 'PLAN_NOT_READY':
        case 'RECEIPT_MISMATCH':
            return 409;
        default:
            return 500;
    }
}
