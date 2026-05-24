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
    return reprint_push_lab_rest_protocol_response('apply', $request);
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
