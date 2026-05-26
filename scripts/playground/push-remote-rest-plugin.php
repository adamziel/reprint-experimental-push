<?php
/**
 * Plugin Name: Reprint Push Lab REST Endpoint
 * Description: Lab-only WordPress REST surface for the local Playground push protocol fixture.
 * Version: 0.0.0
 * License: GPL-2.0-or-later
 *
 * The base lab routes remain public for existing local Playground proof runs.
 * Authenticated aliases below are still fixture-scoped, but require a real
 * WordPress identity via Application Password basic auth.
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
const REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE = 'reprint/v1';
const REPRINT_PUSH_LAB_AUTH_SCOPE = 'reprint-push-lab:authenticated-http-push';
const REPRINT_PUSH_LAB_AUTH_REQUEST_ATTRIBUTE = 'reprint_push_lab_auth';
const REPRINT_PUSH_LAB_SIGNATURE_REQUEST_ATTRIBUTE = 'reprint_push_lab_signature';
const REPRINT_PUSH_LAB_SIGNED_SESSION_TTL = 300;
const REPRINT_PUSH_LAB_SIGNED_TIMESTAMP_SKEW = 300;
const REPRINT_PUSH_LAB_SIGNED_STORE_CLEANUP_LIMIT = 500;

add_filter('wp_is_application_passwords_available', 'reprint_push_lab_rest_application_passwords_available');
add_action('rest_api_init', 'reprint_push_lab_rest_register_routes');
add_action('init', 'reprint_push_lab_rest_maybe_bootstrap_auth_users');

function reprint_push_lab_rest_application_passwords_available($available): bool
{
    if (reprint_push_lab_rest_auth_bootstrap_enabled()) {
        return true;
    }
    return (bool) $available;
}

function reprint_push_lab_rest_register_routes(): void
{
    if (reprint_push_lab_rest_lab_routes_enabled()) {
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

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/preflight', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'reprint_push_lab_rest_authenticated_preflight',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/dry-run', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'reprint_push_lab_rest_authenticated_dry_run',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/apply', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'reprint_push_lab_rest_authenticated_apply',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/snapshot', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'reprint_push_lab_rest_snapshot',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/journal', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'reprint_push_lab_rest_journal',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
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

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/db-journal', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'reprint_push_lab_rest_db_journal',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
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

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/db-journal/schema', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'reprint_push_lab_rest_db_journal_schema',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);

        register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/authenticated/recovery/inspect', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'reprint_push_lab_rest_authenticated_recovery_inspect',
            'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
        ]);
    }

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/preflight', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_authenticated_preflight',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/dry-run', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_authenticated_dry_run',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/apply', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_authenticated_apply',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/snapshot', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_snapshot',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_journal',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
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

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/db-journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
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

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/db-journal/schema', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal_schema',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);

    register_rest_route(REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE, '/push/recovery/inspect', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_authenticated_recovery_inspect',
        'permission_callback' => 'reprint_push_lab_rest_authenticated_permission',
    ]);
}

function reprint_push_lab_rest_public_lab_permission(): bool
{
    return true;
}

function reprint_push_lab_rest_lab_routes_enabled(): bool
{
    return !defined('REPRINT_PUSH_DISABLE_LAB_ROUTES') || REPRINT_PUSH_DISABLE_LAB_ROUTES !== true;
}

function reprint_push_lab_rest_route_profile(WP_REST_Request $request): array
{
    $route = (string) $request->get_route();
    if (strpos($route, '/' . REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE . '/push/') === 0) {
        return [
            'profile' => 'production-shaped',
            'restNamespace' => REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE,
            'routePrefix' => '/push',
            'dryRunRoute' => '/push/dry-run',
            'authScope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
            'labBacked' => true,
            'warning' => 'Production-shaped route names backed by the local Playground lab harness; not a production Reprint endpoint.',
        ];
    }

    if (strpos($route, '/' . REPRINT_PUSH_LAB_REST_NAMESPACE . '/authenticated/') !== 0) {
        return [
            'profile' => 'lab-public',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
            'routePrefix' => '',
            'dryRunRoute' => '/dry-run',
            'authScope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
            'labBacked' => true,
            'warning' => 'Public local Playground lab route; not production auth.',
        ];
    }

    return [
        'profile' => 'lab-authenticated',
        'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
        'routePrefix' => '/authenticated',
        'dryRunRoute' => '/authenticated/dry-run',
        'authScope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
        'labBacked' => true,
        'warning' => 'Local Playground lab authenticated route; not a production Reprint endpoint.',
    ];
}

function reprint_push_lab_rest_profile_route(WP_REST_Request $request, string $suffix): string
{
    $profile = reprint_push_lab_rest_route_profile($request);
    return (string) $profile['routePrefix'] . $suffix;
}

function reprint_push_lab_rest_authenticated_permission(WP_REST_Request $request)
{
    $auth = reprint_push_lab_rest_basic_auth_context($request);
    if (!is_array($auth)) {
        return new WP_Error(
            'reprint_push_lab_auth_required',
            'Authenticated push routes require WordPress Application Password basic auth.',
            ['status' => 401]
        );
    }

    reprint_push_lab_rest_set_auth_context($request, $auth);
    wp_set_current_user((int) $auth['userId']);
    $user = wp_get_current_user();
    if (!$user->exists() || (int) $user->ID !== (int) $auth['userId']) {
        return new WP_Error(
            'reprint_push_lab_auth_required',
            'Application Password authentication did not establish the requested WordPress user.',
            ['status' => 401]
        );
    }

    if (!current_user_can('manage_options')) {
        return new WP_Error(
            'reprint_push_lab_forbidden',
            'Authenticated push routes require manage_options.',
            ['status' => 403]
        );
    }

    return true;
}

function reprint_push_lab_rest_authenticated_preflight(WP_REST_Request $request): WP_REST_Response
{
    $signature_error = reprint_push_lab_rest_require_signed_request($request, 'preflight');
    if ($signature_error instanceof WP_REST_Response) {
        return $signature_error;
    }

    $auth = reprint_push_lab_rest_auth_evidence($request);
    $signature = reprint_push_lab_rest_signature_context($request);
    $profile = reprint_push_lab_rest_route_profile($request);

    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'mode' => 'preflight',
        'auth' => $auth,
        'routeProfile' => $profile,
        'protocol' => [
            'schemaVersion' => 1,
            'authString' => 'nonce + timestamp + content_hash',
            'pushCanonicalString' => "REPRINT-PUSH-LAB-V1\nUPPERCASE_METHOD\nACTUAL_REQUEST_PATH\nCANONICAL_QUERY\nCONTENT_HASH\nSESSION\nIDEMPOTENCY_KEY",
            'contentHash' => 'lowercase hex SHA-256 of the exact raw request body bytes',
            'signature' => 'lowercase hex HMAC-SHA256',
            'labSigningKey' => 'hex HMAC-SHA256 with key = Basic application password and data = "reprint-push-lab-v1\\n" + Basic username',
        ],
        'requirements' => [
            'authentication' => 'application-password-basic',
            'capability' => 'manage_options',
            'idempotencyHeader' => 'X-Reprint-Push-Idempotency-Key',
            'signedHeaders' => [
                'X-Auth-Content-Hash',
                'X-Auth-Timestamp',
                'X-Auth-Nonce',
                'X-Auth-Signature',
                'X-Reprint-Push-Signature',
                'X-Reprint-Push-Session',
                'X-Reprint-Push-Idempotency-Key',
            ],
        ],
        'authorized' => [
            'identity' => $auth['identity'],
            'capabilities' => [
                'manage_options' => current_user_can('manage_options'),
                'reprint_push' => current_user_can('manage_options'),
            ],
            'scopes' => [
                (string) $profile['authScope'],
                'dry-run',
                'apply',
            ],
        ],
        'session' => [
            'type' => 'lab-signed-push-session',
            'id' => $signature['session']['id'] ?? null,
            'sessionHash' => $signature['session']['sessionHash'] ?? null,
            'applicationPasswordUuid' => $auth['session']['applicationPasswordUuid'] ?? null,
            'credentialHash' => $auth['session']['credentialHash'] ?? null,
            'signingKeyHash' => $signature['signingKeyHash'] ?? null,
            'issuedAt' => $signature['session']['issuedAt'] ?? null,
            'expiresAt' => $signature['session']['expiresAt'] ?? null,
            'receiptTtlSeconds' => 300,
        ],
        'sessionStore' => [
            'type' => 'wp-options',
            'cleanup' => $signature['cleanup'] ?? [],
            'retention' => [
                'sessionTtlSeconds' => REPRINT_PUSH_LAB_SIGNED_SESSION_TTL,
                'nonceTtlSeconds' => REPRINT_PUSH_LAB_SIGNED_TIMESTAMP_SKEW,
            ],
        ],
        'limits' => [
            'maxMutationsPerPlan' => 100,
            'maxReceiptAgeSeconds' => 300,
            'requiresIdempotencyKey' => true,
        ],
        'journal' => [
            'available' => true,
            'optionJournal' => [
                'available' => true,
                'option' => 'reprint_push_protocol_journal',
            ],
            'dbJournal' => [
                'available' => true,
                'table' => reprint_push_lab_db_journal_table_name(),
                'scope' => 'local Playground fixture only; not production durability',
            ],
        ],
        'snapshotHash' => hash('sha256', reprint_push_stable_json(reprint_push_export_snapshot())),
    ]);
}

function reprint_push_lab_rest_authenticated_dry_run(WP_REST_Request $request): WP_REST_Response
{
    $signature_error = reprint_push_lab_rest_require_signed_request($request, 'dry-run');
    if ($signature_error instanceof WP_REST_Response) {
        return $signature_error;
    }

    $response = reprint_push_lab_rest_protocol_response('dry-run', $request);
    $result = $response->get_data();
    if (($result['ok'] ?? false) === true && isset($result['receipt']) && is_array($result['receipt'])) {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'dry-run');
        $result['receipt'] = reprint_push_lab_rest_bind_authenticated_receipt(
            $result['receipt'],
            $request,
            $payload,
            $plan
        );
        $result['auth'] = reprint_push_lab_rest_auth_evidence($request);
        $result['signedRequest'] = reprint_push_lab_rest_signed_request_evidence($request);
    }
    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_authenticated_apply(WP_REST_Request $request): WP_REST_Response
{
    $signature_error = reprint_push_lab_rest_require_signed_request($request, 'apply');
    if ($signature_error instanceof WP_REST_Response) {
        return $signature_error;
    }

    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
        $receipt_payload = reprint_push_lab_rest_receipt_payload($payload);
        if ($receipt_payload === null) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'MISSING_DRY_RUN_RECEIPT',
                'message' => 'Apply requires a supplied dry-run receipt JSON.',
                'mode' => 'apply',
            ]);
        }
        reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload);
    } catch (Reprint_Push_Protocol_Error $error) {
        return reprint_push_lab_rest_json_response($error->result);
    } catch (Throwable $error) {
        return reprint_push_lab_rest_json_response([
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ]);
    }

    $response = reprint_push_lab_rest_apply_with_db_journal($request, true);
    $result = $response->get_data();
    if (($result['ok'] ?? false) === true || isset($result['idempotency'])) {
        $result['auth'] = reprint_push_lab_rest_auth_evidence($request);
        $result['signedRequest'] = reprint_push_lab_rest_signed_request_evidence($request);
    }
    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_authenticated_recovery_inspect(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_recovery_inspect($request);
}

function reprint_push_lab_rest_dry_run(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_protocol_response('dry-run', $request);
}

function reprint_push_lab_rest_apply(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_apply_with_db_journal($request, true);
}

function reprint_push_lab_rest_recovery_inspect(WP_REST_Request $request): WP_REST_Response
{
    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'inspect');
        $receipt = reprint_push_lab_rest_receipt_payload($payload);
        $profile = reprint_push_lab_rest_route_profile($request);

        $result = reprint_push_protocol_inspect_recovery($plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => (string) $profile['restNamespace'],
            'restRoute' => reprint_push_lab_rest_profile_route($request, '/recovery/inspect'),
            'routeProfile' => (string) $profile['profile'],
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
        $profile = reprint_push_lab_rest_route_profile($request);

        $result = reprint_push_protocol_run_payload($mode, $plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => (string) $profile['restNamespace'],
            'restRoute' => reprint_push_lab_rest_profile_route($request, $mode === 'dry-run' ? '/dry-run' : '/apply'),
            'routeProfile' => (string) $profile['profile'],
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

function reprint_push_lab_rest_apply_with_db_journal(
    WP_REST_Request $request,
    bool $validate_before_idempotency_claim = false
): WP_REST_Response
{
    $profile = reprint_push_lab_rest_route_profile($request);
    $context = null;
    $received_entry = null;
    $accepted = null;
    $plan = null;
    $receipt = null;

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
        $context = reprint_push_lab_rest_db_journal_context($payload, $idempotency_key, $profile);
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

        $terminal = reprint_push_lab_db_journal_terminal_row_for_key($context['idempotencyKeyHash']);
        if (is_array($terminal)
            && (string) ($terminal['event'] ?? '') === 'apply-rejected'
            && (string) ($terminal['request_hash'] ?? '') === $context['requestHash']
        ) {
            $replay_result = reprint_push_lab_db_journal_replay_rejected_result($terminal);
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

        $existing_claim = reprint_push_lab_db_journal_claim_row_for_key($context['idempotencyKeyHash']);
        $same_request_claim_exists = is_array($existing_claim)
            && (string) ($existing_claim['requestHash'] ?? '') === $context['requestHash'];

        if ($validate_before_idempotency_claim && !$same_request_claim_exists) {
            $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
            $receipt = reprint_push_lab_rest_receipt_payload($payload);
            $accepted = reprint_push_lab_rest_validate_apply_for_db_journal($plan, $receipt, $context);
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

            $stale_claim_retry = reprint_push_lab_rest_maybe_prepare_stale_claim_retry($payload, $context, $claim_entry);
            if (is_array($stale_claim_retry)) {
                if (isset($stale_claim_retry['result']) && is_array($stale_claim_retry['result'])) {
                    return reprint_push_lab_rest_json_response($stale_claim_retry['result']);
                }
                $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
                $receipt = reprint_push_lab_rest_receipt_payload($payload);
                $accepted = reprint_push_lab_rest_validate_apply_for_db_journal($plan, $receipt, $context);
                $result = reprint_push_lab_rest_run_db_journal_apply(
                    $payload,
                    $context,
                    $claim_entry,
                    $plan,
                    $receipt,
                    $accepted,
                    $stale_claim_retry
                );
                return reprint_push_lab_rest_json_response($result);
            }

            $missing_commit_result = reprint_push_lab_rest_maybe_finalize_missing_commit($payload, $context, $claim_entry);
            if (is_array($missing_commit_result)) {
                return reprint_push_lab_rest_json_response($missing_commit_result);
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
        if (!is_array($accepted)) {
            $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
            $receipt = reprint_push_lab_rest_receipt_payload($payload);
            $accepted = reprint_push_lab_rest_validate_apply_for_db_journal($plan, $receipt, $context);
        }
        $result = reprint_push_lab_rest_run_db_journal_apply($payload, $context, $opened_entry, $plan, $receipt, $accepted);
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

function reprint_push_lab_rest_validate_apply_for_db_journal(array $plan, ?array $receipt_payload, array $context): array
{
    $plan_hash = reprint_push_protocol_plan_hash($plan);
    reprint_push_protocol_assert_plan_ready($plan, 'apply', $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);
    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);

    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);
    if ($receipt_payload === null) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', $context + [
            'mode' => 'apply',
            'planId' => $plan['id'] ?? null,
            'planHash' => $plan_hash,
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON.',
            'mode' => 'apply',
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);

    $current = reprint_push_export_snapshot();
    reprint_push_protocol_validate_fixture_atomic_dependencies($plan, $current, $mutations, $context + $plan_evidence + [
        'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
    ]);

    $verified_preconditions = reprint_push_protocol_verify_preconditions(
        $current,
        $precondition_entries,
        $context + $plan_evidence + ['receiptHash' => (string) ($receipt['receiptHash'] ?? '')]
    );

    return [
        'mutations' => $mutations,
        'preconditions' => $precondition_entries,
        'planEvidence' => $plan_evidence,
        'receipt' => $receipt,
        'verifiedPreconditions' => $verified_preconditions,
        'recoveryTargets' => reprint_push_lab_rest_recovery_targets_for_db_journal($mutations, $precondition_entries),
    ];
}

function reprint_push_lab_rest_run_db_journal_apply(
    array $payload,
    array $context,
    array $claim_entry,
    array $plan,
    ?array $receipt,
    array $accepted,
    ?array $stale_claim_retry = null
): array {
    $mutations = $accepted['mutations'];
    $started_evidence = [
        'openedCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
        'mutationCount' => count($mutations),
        'acceptedPlanEvidence' => [
            'planHash' => $accepted['planEvidence']['planHash'] ?? '',
            'receiptHash' => (string) ($accepted['receipt']['receiptHash'] ?? ''),
            'preconditionSetHash' => $accepted['planEvidence']['preconditionSetHash'] ?? '',
            'mutationSetHash' => $accepted['planEvidence']['mutationSetHash'] ?? '',
        ],
        'verifiedPreconditions' => reprint_push_lab_db_journal_sanitize_value($accepted['verifiedPreconditions']),
        'recoveryTargets' => $accepted['recoveryTargets'],
        'plannedMutations' => reprint_push_lab_db_journal_planned_mutation_evidence($mutations, $accepted['preconditions']),
        'resourceKeys' => array_values(array_map(
            static fn (array $mutation): string => (string) ($mutation['resourceKey'] ?? ''),
            $mutations
        )),
    ];
    if (is_array($stale_claim_retry)) {
        $started_evidence['staleClaimRetry'] = [
            'accepted' => true,
            'abandonedCursor' => 'db-journal:' . (int) ($stale_claim_retry['abandonedSequence'] ?? 0),
            'retryStartedCursor' => 'db-journal:' . (int) ($stale_claim_retry['retryStartedSequence'] ?? 0),
            'previousStartedCursor' => 'db-journal:' . (int) ($stale_claim_retry['previousStartedSequence'] ?? 0),
            'counts' => $stale_claim_retry['counts'] ?? null,
        ];
    }

    $started_entry = reprint_push_lab_db_journal_append_event('apply-started', $context + [
        'resourceHashEvidence' => $started_evidence,
    ]);

    if (reprint_push_lab_rest_should_simulate_stale_claim_all_old($payload) && !is_array($stale_claim_retry)) {
        $abandoned_result = [
            'ok' => false,
            'code' => 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
            'message' => 'Lab-only hook stopped after durable claim/start evidence and before any mutation execution.',
            'mode' => 'apply',
            'applied' => 0,
            'idempotency' => [
                'replayed' => false,
                'freshMutationWork' => false,
                'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                'requestHash' => $context['requestHash'],
                'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
                'staleClaimAbandoned' => true,
            ],
            'recovery' => [
                'required' => true,
                'state' => 'stale-claim-all-old-simulated',
                'scope' => 'lab-only deterministic stale-claim hook; no production durability claim',
                'counts' => [
                    'old' => count($mutations),
                    'new' => 0,
                    'blockedUnknown' => 0,
                    'total' => count($mutations),
                ],
            ],
            'dbJournal' => reprint_push_lab_rest_db_journal_evidence($started_entry),
        ];
        $abandoned_entry = reprint_push_lab_db_journal_append_event('stale-claim-abandoned', $context + [
            'appliedCount' => 0,
            'errorCode' => 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
            'result' => reprint_push_lab_db_journal_compact_result($abandoned_result),
            'resourceHashEvidence' => [
                'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
                'requestHash' => $context['requestHash'],
                'planHash' => $context['planHash'],
                'receiptHash' => $context['receiptHash'],
                'plannedTargetCount' => count($mutations),
                'targetSetHash' => reprint_push_lab_rest_target_set_hash($accepted['recoveryTargets']),
            ],
        ]);
        $abandoned_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($abandoned_entry);
        return $abandoned_result;
    }

    if (is_array($stale_claim_retry) && reprint_push_lab_rest_should_simulate_stale_retry_after_started($payload)) {
        return [
            'ok' => false,
            'code' => 'LAB_SIMULATED_STALE_RETRY_AFTER_STARTED',
            'message' => 'Lab-only hook stopped a stale retry after its retry apply-started row and before any mutation execution.',
            'mode' => 'apply',
            'applied' => 0,
            'idempotency' => [
                'replayed' => false,
                'freshMutationWork' => false,
                'staleClaimRetry' => true,
                'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                'requestHash' => $context['requestHash'],
                'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                'abandonedSequence' => (int) ($stale_claim_retry['abandonedSequence'] ?? 0),
                'previousStartedSequence' => (int) ($stale_claim_retry['previousStartedSequence'] ?? 0),
                'retryStartedSequence' => (int) ($stale_claim_retry['retryStartedSequence'] ?? 0),
                'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
                'recoveryCounts' => $stale_claim_retry['counts'] ?? null,
            ],
            'recovery' => [
                'required' => true,
                'state' => 'stale-retry-started-simulated',
                'scope' => 'lab-only deterministic stale retry hook; no production durability claim',
                'counts' => $stale_claim_retry['counts'] ?? null,
            ],
            'dbJournal' => reprint_push_lab_rest_db_journal_evidence($started_entry),
        ];
    }

    $options = reprint_push_lab_rest_lab_options($payload);
    $options['mutationEventCallback'] = reprint_push_lab_rest_compose_mutation_callbacks([
        reprint_push_lab_rest_db_journal_mutation_callback($context, $started_entry),
        reprint_push_lab_rest_lab_drift_after_prepared_callback($options),
        reprint_push_lab_rest_lab_drift_before_storage_write_callback($options),
    ]);
    $result = reprint_push_protocol_run_payload('apply', $plan, $receipt, [
        'transport' => 'wordpress-rest',
        'restNamespace' => (string) ($context['restNamespace'] ?? REPRINT_PUSH_LAB_REST_NAMESPACE),
        'routeProfile' => (string) ($context['routeProfile'] ?? 'lab-authenticated'),
        'idempotencyKeyHash' => $context['idempotencyKeyHash'],
        'requestHash' => $context['requestHash'],
        'dbJournalCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
    ], $options);

    $result['idempotency'] = [
        'replayed' => false,
        'freshMutationWork' => true,
        'idempotencyKeyHash' => $context['idempotencyKeyHash'],
        'requestHash' => $context['requestHash'],
    ];
    if (is_array($stale_claim_retry)) {
        $result['idempotency'] += [
            'staleClaimRetry' => true,
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'abandonedSequence' => (int) ($stale_claim_retry['abandonedSequence'] ?? 0),
            'previousStartedSequence' => (int) ($stale_claim_retry['previousStartedSequence'] ?? 0),
            'retryStartedSequence' => (int) ($stale_claim_retry['retryStartedSequence'] ?? 0),
            'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'recoveryCounts' => $stale_claim_retry['counts'] ?? null,
        ];
    }
    if (reprint_push_lab_rest_should_simulate_missing_db_commit($payload)) {
        $result = [
            'ok' => false,
            'code' => 'LAB_SIMULATED_MISSING_DB_COMMIT',
            'message' => 'Lab-only hook stopped after target hashes reached planned after hashes and before DB apply-committed was written.',
            'mode' => 'apply',
            'applied' => (int) ($result['applied'] ?? count($mutations)),
            'idempotency' => [
                'replayed' => false,
                'freshMutationWork' => true,
                'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                'requestHash' => $context['requestHash'],
                'missingCommitSimulated' => true,
            ],
            'recovery' => [
                'required' => true,
                'state' => 'missing-db-commit-simulated',
                'scope' => 'lab-only deterministic missing-commit hook; no production durability claim',
            ],
            'dbJournal' => reprint_push_lab_rest_db_journal_evidence($started_entry),
        ];
        return $result;
    }

    $committed_entry = reprint_push_lab_db_journal_append_event('apply-committed', $context + [
        'appliedCount' => (int) ($result['applied'] ?? 0),
        'result' => reprint_push_lab_db_journal_compact_result($result),
        'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($result),
    ]);
    $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($committed_entry);
    return $result;
}

function reprint_push_lab_rest_db_journal_mutation_callback(array $context, array $started_entry): callable
{
    return static function (string $event, array $evidence) use ($context, $started_entry): void {
        if (!in_array($event, ['mutation-prepared', 'mutation-precondition-failed', 'mutation-applied'], true)) {
            return;
        }

        $event_context = $context + [
            'planHash' => (string) ($evidence['planHash'] ?? ''),
            'receiptHash' => (string) ($evidence['receiptHash'] ?? ''),
            'planFingerprint' => (string) ($evidence['planFingerprint'] ?? ''),
            'mutationCount' => (int) ($evidence['mutationCount'] ?? 0),
            'appliedCount' => max(0, (int) ($evidence['appliedCount'] ?? 0)),
            'resourceHashEvidence' => reprint_push_lab_db_journal_mutation_evidence(array_merge($evidence, [
                'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
            ])),
        ];

        reprint_push_lab_db_journal_append_event($event, $event_context);
    };
}

function reprint_push_lab_rest_compose_mutation_callbacks(array $callbacks): callable
{
    $callbacks = array_values(array_filter($callbacks, 'is_callable'));
    return static function (string $event, array $evidence) use ($callbacks): void {
        foreach ($callbacks as $callback) {
            $callback($event, $evidence);
        }
    };
}

function reprint_push_lab_rest_lab_drift_after_prepared_callback(array $options): ?callable
{
    if (!array_key_exists('labDriftAfterPrepared', $options)) {
        return null;
    }

    $spec = $options['labDriftAfterPrepared'];
    if (!is_array($spec)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labDriftAfterPrepared must be an object when supplied.',
        ]);
    }

    $mutation_id = isset($spec['mutationId']) ? (string) $spec['mutationId'] : '';
    $resource_key = isset($spec['resourceKey']) ? (string) $spec['resourceKey'] : '';
    if ($mutation_id === '' && $resource_key === '') {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labDriftAfterPrepared requires mutationId or resourceKey.',
        ]);
    }
    if (!array_key_exists('value', $spec) && !array_key_exists('absent', $spec)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labDriftAfterPrepared requires value or absent.',
        ]);
    }

    $payload = [];
    if (array_key_exists('absent', $spec)) {
        $payload['absent'] = $spec['absent'] === true || $spec['absent'] === 1 || $spec['absent'] === '1';
    }
    if (array_key_exists('value', $spec)) {
        $payload['value'] = $spec['value'];
    }
    $resource_override = isset($spec['resource']) && is_array($spec['resource']) ? $spec['resource'] : null;

    $did_drift = false;
    return static function (string $event, array $evidence) use ($mutation_id, $resource_key, $payload, $resource_override, &$did_drift): void {
        if ($did_drift || $event !== 'mutation-prepared') {
            return;
        }
        if ($mutation_id !== '' && (string) ($evidence['mutationId'] ?? '') !== $mutation_id) {
            return;
        }
        if ($resource_key !== '' && (string) ($evidence['resourceKey'] ?? '') !== $resource_key) {
            return;
        }

        $resource = $resource_override ?? ($evidence['resource'] ?? null);
        if (!is_array($resource)) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'labDriftAfterPrepared could not resolve the prepared mutation resource.',
            ]);
        }

        reprint_push_assert_supported_apply_resource($resource);
        reprint_push_apply_resource($resource, $payload);
        $did_drift = true;
    };
}

function reprint_push_lab_rest_lab_drift_before_storage_write_callback(array $options): ?callable
{
    if (!array_key_exists('labDriftBeforeStorageWrite', $options)) {
        return null;
    }

    return reprint_push_lab_rest_drift_mutation_callback(
        $options['labDriftBeforeStorageWrite'],
        'labDriftBeforeStorageWrite',
        'mutation-storage-write-ready'
    );
}

function reprint_push_lab_rest_drift_mutation_callback($spec, string $option_name, string $target_event): callable
{
    if (!is_array($spec)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $option_name . ' must be an object when supplied.',
        ]);
    }

    $mutation_id = isset($spec['mutationId']) ? (string) $spec['mutationId'] : '';
    $resource_key = isset($spec['resourceKey']) ? (string) $spec['resourceKey'] : '';
    if ($mutation_id === '' && $resource_key === '') {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $option_name . ' requires mutationId or resourceKey.',
        ]);
    }
    if (!array_key_exists('value', $spec) && !array_key_exists('absent', $spec) && !array_key_exists('clearFixtureMarkerForPostId', $spec)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $option_name . ' requires value, absent, or clearFixtureMarkerForPostId.',
        ]);
    }

    $payload = [];
    if (array_key_exists('absent', $spec)) {
        $payload['absent'] = $spec['absent'] === true || $spec['absent'] === 1 || $spec['absent'] === '1';
    }
    if (array_key_exists('value', $spec)) {
        $payload['value'] = $spec['value'];
    }
    $clear_fixture_marker_for_post_id = null;
    if (array_key_exists('clearFixtureMarkerForPostId', $spec)) {
        if (!is_int($spec['clearFixtureMarkerForPostId']) && !(is_string($spec['clearFixtureMarkerForPostId']) && preg_match('/^\d+$/', $spec['clearFixtureMarkerForPostId']))) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => $option_name . ' clearFixtureMarkerForPostId must be a positive integer.',
            ]);
        }
        $clear_fixture_marker_for_post_id = (int) $spec['clearFixtureMarkerForPostId'];
        if ($clear_fixture_marker_for_post_id < 1) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => $option_name . ' clearFixtureMarkerForPostId must be a positive integer.',
            ]);
        }
    }
    $resource_override = isset($spec['resource']) && is_array($spec['resource']) ? $spec['resource'] : null;

    $did_drift = false;
    return static function (string $event, array $evidence) use ($mutation_id, $resource_key, $payload, $resource_override, $option_name, $target_event, $clear_fixture_marker_for_post_id, &$did_drift): void {
        if ($did_drift || $event !== $target_event) {
            return;
        }
        if ($mutation_id !== '' && (string) ($evidence['mutationId'] ?? '') !== $mutation_id) {
            return;
        }
        if ($resource_key !== '' && (string) ($evidence['resourceKey'] ?? '') !== $resource_key) {
            return;
        }

        if ($clear_fixture_marker_for_post_id !== null) {
            global $wpdb;

            $updated = $wpdb->query($wpdb->prepare(
                "UPDATE {$wpdb->postmeta} SET meta_value = '' WHERE post_id = %d AND meta_key = %s",
                $clear_fixture_marker_for_post_id,
                'reprint_push_fixture'
            ));
            if ($updated === false) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'LAB_DRIFT_FAILED',
                    'message' => $option_name . ' could not clear the fixture marker.',
                ]);
            }
        }

        if (array_key_exists('value', $payload) || array_key_exists('absent', $payload)) {
            $resource = $resource_override ?? ($evidence['resource'] ?? null);
            if (!is_array($resource)) {
                reprint_push_protocol_fail([
                    'ok' => false,
                    'code' => 'INVALID_ARGUMENT',
                    'message' => $option_name . ' could not resolve the prepared mutation resource.',
                ]);
            }

            reprint_push_assert_supported_apply_resource($resource);
            reprint_push_apply_resource($resource, $payload);
        }
        $did_drift = true;
    };
}

function reprint_push_lab_rest_recovery_targets_for_db_journal(array $mutations, array $preconditions): array
{
    $preconditions_by_mutation = [];
    foreach ($preconditions as $precondition) {
        if (is_array($precondition) && isset($precondition['mutationId'])) {
            $preconditions_by_mutation[(string) $precondition['mutationId']] = $precondition;
        }
    }

    $targets = [];
    foreach ($mutations as $index => $mutation) {
        if (!is_array($mutation) || !isset($mutation['resource']) || !is_array($mutation['resource'])) {
            continue;
        }
        $mutation_id = (string) ($mutation['id'] ?? '');
        $precondition = $preconditions_by_mutation[$mutation_id] ?? [];
        $targets[] = reprint_push_lab_db_journal_sanitize_value([
            'index' => (int) $index,
            'mutationId' => $mutation_id,
            'resourceKey' => (string) ($mutation['resourceKey'] ?? ''),
            'resource' => $mutation['resource'],
            'beforeHash' => (string) ($precondition['expectedHash'] ?? $mutation['remoteBeforeHash'] ?? ''),
            'afterHash' => (string) ($mutation['localHash'] ?? ''),
        ]);
    }
    return $targets;
}

function reprint_push_lab_rest_maybe_finalize_missing_commit(array $payload, array $context, array $claim_entry): ?array
{
    $started_entry = reprint_push_lab_rest_latest_db_row_for_key_event(
        $context['idempotencyKeyHash'],
        $context['requestHash'],
        'apply-started'
    );
    if (!is_array($started_entry)) {
        return null;
    }

    $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
    $receipt_payload = reprint_push_lab_rest_receipt_payload($payload);
    $validated = reprint_push_lab_rest_validate_plan_receipt_for_missing_commit($plan, $receipt_payload);
    $planned_targets = reprint_push_lab_rest_planned_targets_from_started_entry($started_entry);
    $target_validation = reprint_push_lab_rest_validate_started_targets($planned_targets, $validated['recoveryTargets']);

    if (($target_validation['ok'] ?? false) !== true) {
        return reprint_push_lab_rest_blocked_missing_commit_result(
            $context,
            $claim_entry,
            $started_entry,
            reprint_push_lab_rest_missing_commit_recovery_from_targets($planned_targets, $validated['planEvidence'], $validated['receipt'], [
                'blockedReason' => (string) ($target_validation['reason'] ?? 'missing durable target evidence'),
            ])
        );
    }

    $recovery = reprint_push_lab_rest_missing_commit_recovery_from_targets(
        $planned_targets,
        $validated['planEvidence'],
        $validated['receipt']
    );

    if (($recovery['state'] ?? '') !== 'fully-updated-remote') {
        return reprint_push_lab_rest_blocked_missing_commit_result($context, $claim_entry, $started_entry, $recovery);
    }

    $verified_keys = array_values(array_map(
        static fn (array $target): string => (string) ($target['resourceKey'] ?? ''),
        $planned_targets
    ));
    $finalized_result = [
        'ok' => true,
        'mode' => 'apply',
        'code' => 'BATCH_RECOVERY_FINALIZED',
        'message' => 'Missing DB apply commit finalized after every target hash matched the durable planned after hash.',
        'applied' => count($planned_targets),
        'verifiedKeys' => $verified_keys,
        'receiptHash' => (string) ($validated['receipt']['receiptHash'] ?? ''),
        'recovery' => $recovery + ['finalized' => true],
        'idempotency' => [
            'replayed' => true,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'finalizedMissingCommit' => true,
        ],
        'audit' => [
            'scope' => 'Playground lab DB journal evidence only; no production durability or rollback guarantee',
            'durableEvidence' => [
                'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
                'requestHash' => $context['requestHash'],
                'planHash' => $context['planHash'],
                'receiptHash' => $context['receiptHash'],
                'plannedTargetCount' => count($planned_targets),
            ],
        ],
    ];

    $committed_entry = reprint_push_lab_db_journal_append_event('apply-committed', $context + [
        'appliedCount' => count($planned_targets),
        'result' => reprint_push_lab_db_journal_compact_result($finalized_result),
        'resourceHashEvidence' => [
            'recoveryFinalized' => true,
            'verifiedKeys' => $verified_keys,
            'recovery' => $recovery,
        ],
    ]);
    $finalized_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($committed_entry);

    return $finalized_result;
}

function reprint_push_lab_rest_validate_plan_receipt_for_missing_commit(array $plan, ?array $receipt_payload): array
{
    $plan_hash = reprint_push_protocol_plan_hash($plan);
    reprint_push_protocol_assert_plan_ready($plan, 'apply', $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);
    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);
    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);

    if ($receipt_payload === null) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON.',
            'mode' => 'apply',
        ]);
    }

    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);
    reprint_push_protocol_validate_fixture_atomic_dependencies($plan, reprint_push_export_snapshot(), $mutations, $plan_evidence + [
        'receiptHash' => (string) ($receipt['receiptHash'] ?? ''),
    ]);

    return [
        'mutations' => $mutations,
        'preconditions' => $precondition_entries,
        'planEvidence' => $plan_evidence,
        'receipt' => $receipt,
        'recoveryTargets' => reprint_push_lab_rest_recovery_targets_for_db_journal($mutations, $precondition_entries),
    ];
}

function reprint_push_lab_rest_latest_db_row_for_key_event(string $idempotency_key_hash, string $request_hash, string $event): ?array
{
    $rows = array_reverse(reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash));
    foreach ($rows as $row) {
        if ((string) ($row['event'] ?? '') !== $event) {
            continue;
        }
        if ((string) ($row['request_hash'] ?? '') !== $request_hash) {
            continue;
        }
        return reprint_push_lab_db_journal_public_row($row);
    }
    return null;
}

function reprint_push_lab_rest_maybe_prepare_stale_claim_retry(array $payload, array $context, array $claim_entry): ?array
{
    $started_entry = reprint_push_lab_rest_latest_db_row_for_key_event(
        $context['idempotencyKeyHash'],
        $context['requestHash'],
        'apply-started'
    );
    if (!is_array($started_entry)) {
        return null;
    }

    $abandoned_entry = reprint_push_lab_rest_abandoned_entry_for_started_entry(
        $context['idempotencyKeyHash'],
        $context['requestHash'],
        $started_entry
    );
    if (!is_array($abandoned_entry)) {
        return null;
    }

    $mutation_counts = reprint_push_lab_rest_mutation_event_counts_for_key_request(
        $context['idempotencyKeyHash'],
        $context['requestHash']
    );
    if (($mutation_counts['prepared'] + $mutation_counts['applied'] + $mutation_counts['preconditionFailed']) > 0) {
        return null;
    }

    $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
    $receipt_payload = reprint_push_lab_rest_receipt_payload($payload);
    $validated = reprint_push_lab_rest_validate_plan_receipt_for_missing_commit($plan, $receipt_payload);
    $planned_targets = reprint_push_lab_rest_planned_targets_from_started_entry($started_entry);
    $target_validation = reprint_push_lab_rest_validate_started_targets($planned_targets, $validated['recoveryTargets']);
    if (($target_validation['ok'] ?? false) !== true) {
        return null;
    }

    $recovery = reprint_push_lab_rest_missing_commit_recovery_from_targets(
        $planned_targets,
        $validated['planEvidence'],
        $validated['receipt']
    );
    if (($recovery['state'] ?? '') !== 'old-remote') {
        return null;
    }

    $counts = isset($recovery['counts']) && is_array($recovery['counts'])
        ? $recovery['counts']
        : ['old' => 0, 'new' => 0, 'blockedUnknown' => 0, 'total' => 0];
    if ((int) ($counts['old'] ?? 0) < 1
        || (int) ($counts['old'] ?? 0) !== (int) ($counts['total'] ?? 0)
        || (int) ($counts['new'] ?? 0) !== 0
        || (int) ($counts['blockedUnknown'] ?? 0) !== 0
    ) {
        return null;
    }

    $retry_result = [
        'ok' => true,
        'mode' => 'apply',
        'code' => 'STALE_CLAIM_RETRY_STARTED',
        'idempotency' => [
            'replayed' => false,
            'freshMutationWork' => true,
            'staleClaimRetry' => true,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'abandonedSequence' => (int) ($abandoned_entry['sequence'] ?? 0),
            'previousStartedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'recoveryCounts' => $counts,
        ],
        'recovery' => [
            'state' => 'old-remote',
            'counts' => $counts,
        ],
    ];
    $retry_context = [
        'appliedCount' => 0,
        'result' => reprint_push_lab_db_journal_compact_result($retry_result),
        'abandonedSequence' => (int) ($abandoned_entry['sequence'] ?? 0),
        'previousStartedSequence' => (int) ($started_entry['sequence'] ?? 0),
        'resourceHashEvidence' => [
            'staleClaimRetry' => true,
            'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
            'abandonedCursor' => 'db-journal:' . (int) ($abandoned_entry['sequence'] ?? 0),
            'previousStartedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
            'requestHash' => $context['requestHash'],
            'planHash' => $context['planHash'],
            'receiptHash' => $context['receiptHash'],
            'recoveryState' => 'old-remote',
            'recoveryCounts' => $counts,
            'mutationEventCounts' => $mutation_counts,
            'startedTargetSetHash' => reprint_push_lab_rest_target_set_hash($planned_targets),
            'requestTargetSetHash' => reprint_push_lab_rest_target_set_hash($validated['recoveryTargets']),
            'currentHashSetHash' => reprint_push_lab_rest_current_hash_set_hash($recovery),
        ],
    ];
    $retry_claim = reprint_push_lab_db_journal_try_open_stale_retry($context, $retry_context);
    if (($retry_claim['opened'] ?? false) !== true) {
        $retry_claim_entry = is_array($retry_claim['entry'] ?? null) ? $retry_claim['entry'] : [];
        $blocked_result = [
            'ok' => false,
            'code' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
            'message' => 'A stale-claim retry executor is already in progress for this idempotency key and canonical request.',
            'mode' => 'apply',
            'idempotency' => [
                'replayed' => false,
                'conflict' => false,
                'inProgress' => true,
                'freshMutationWork' => false,
                'staleClaimRetry' => false,
                'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                'requestHash' => $context['requestHash'],
                'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                'abandonedSequence' => (int) ($abandoned_entry['sequence'] ?? 0),
                'previousStartedSequence' => (int) ($started_entry['sequence'] ?? 0),
                'retryClaimSequence' => (int) ($retry_claim_entry['sequence'] ?? 0),
            ],
        ];
        $blocked_entry = reprint_push_lab_db_journal_append_event('stale-claim-retry-in-progress', $context + [
            'appliedCount' => 0,
            'errorCode' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
            'result' => reprint_push_lab_db_journal_compact_result($blocked_result),
            'resourceHashEvidence' => [
                'staleClaimRetry' => false,
                'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                'abandonedCursor' => 'db-journal:' . (int) ($abandoned_entry['sequence'] ?? 0),
                'previousStartedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
                'retryClaimCursor' => 'db-journal:' . (int) ($retry_claim_entry['sequence'] ?? 0),
                'requestHash' => $context['requestHash'],
                'planHash' => $context['planHash'],
                'receiptHash' => $context['receiptHash'],
                'retryClaimHash' => (string) ($retry_claim['retryClaimHash'] ?? ''),
            ],
        ]);
        $blocked_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($blocked_entry);
        return ['result' => $blocked_result];
    }

    $retry_entry = $retry_claim['entry'];
    if (reprint_push_lab_rest_should_simulate_stale_retry_after_claim($payload)) {
        $claim_result = [
            'ok' => false,
            'code' => 'LAB_SIMULATED_STALE_RETRY_AFTER_CLAIM',
            'message' => 'Lab-only hook stopped a stale retry after its durable retry claim and before retry apply-started.',
            'mode' => 'apply',
            'applied' => 0,
            'idempotency' => [
                'replayed' => false,
                'freshMutationWork' => false,
                'staleClaimRetry' => true,
                'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                'requestHash' => $context['requestHash'],
                'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                'abandonedSequence' => (int) ($abandoned_entry['sequence'] ?? 0),
                'previousStartedSequence' => (int) ($started_entry['sequence'] ?? 0),
                'retryStartedSequence' => (int) ($retry_entry['sequence'] ?? 0),
                'recoveryCounts' => $counts,
            ],
            'recovery' => [
                'required' => true,
                'state' => 'stale-retry-claim-simulated',
                'scope' => 'lab-only deterministic stale retry claim hook; no production durability claim',
                'counts' => $counts,
            ],
            'dbJournal' => reprint_push_lab_rest_db_journal_evidence($retry_entry),
        ];
        return ['result' => $claim_result];
    }

    reprint_push_lab_rest_delay_after_stale_retry_claim($payload);

    return [
        'abandonedSequence' => (int) ($abandoned_entry['sequence'] ?? 0),
        'previousStartedSequence' => (int) ($started_entry['sequence'] ?? 0),
        'retryStartedSequence' => (int) ($retry_entry['sequence'] ?? 0),
        'counts' => $counts,
    ];
}

function reprint_push_lab_rest_abandoned_entry_for_started_entry(
    string $idempotency_key_hash,
    string $request_hash,
    array $started_entry
): ?array {
    $started_sequence = (int) ($started_entry['sequence'] ?? 0);
    if ($started_sequence < 1) {
        return null;
    }
    $expected_started_cursor = 'db-journal:' . $started_sequence;

    $rows = array_reverse(reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash));
    foreach ($rows as $row) {
        if ((string) ($row['event'] ?? '') !== 'stale-claim-abandoned') {
            continue;
        }
        if ((string) ($row['request_hash'] ?? '') !== $request_hash) {
            continue;
        }
        $public_row = reprint_push_lab_db_journal_public_row($row);
        $evidence = isset($public_row['resourceHashEvidence']) && is_array($public_row['resourceHashEvidence'])
            ? $public_row['resourceHashEvidence']
            : [];
        if ((string) ($evidence['startedCursor'] ?? '') !== $expected_started_cursor) {
            continue;
        }
        return $public_row;
    }

    return null;
}

function reprint_push_lab_rest_planned_targets_from_started_entry(array $started_entry): array
{
    $evidence = isset($started_entry['resourceHashEvidence']) && is_array($started_entry['resourceHashEvidence'])
        ? $started_entry['resourceHashEvidence']
        : [];
    $targets = isset($evidence['recoveryTargets']) && is_array($evidence['recoveryTargets'])
        ? $evidence['recoveryTargets']
        : [];

    return array_values(array_filter($targets, static function ($target): bool {
        return is_array($target)
            && isset($target['resource'])
            && is_array($target['resource'])
            && isset($target['mutationId'], $target['resourceKey'], $target['beforeHash'], $target['afterHash']);
    }));
}

function reprint_push_lab_rest_validate_started_targets(array $started_targets, array $request_targets): array
{
    if (count($started_targets) === 0 || count($started_targets) !== count($request_targets)) {
        return [
            'ok' => false,
            'reason' => 'missing or incomplete DB apply-started recoveryTargets evidence',
        ];
    }

    foreach ($started_targets as $index => $target) {
        $request_target = $request_targets[$index] ?? null;
        if (!is_array($request_target)
            || reprint_push_stable_json($target) !== reprint_push_stable_json($request_target)
        ) {
            return [
                'ok' => false,
                'reason' => 'DB apply-started target evidence does not match the retried canonical request',
            ];
        }
    }

    return ['ok' => true];
}

function reprint_push_lab_rest_mutation_event_counts_for_key_request(string $idempotency_key_hash, string $request_hash): array
{
    $counts = [
        'prepared' => 0,
        'applied' => 0,
        'preconditionFailed' => 0,
    ];
    foreach (reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash) as $row) {
        if ((string) ($row['request_hash'] ?? '') !== $request_hash) {
            continue;
        }
        switch ((string) ($row['event'] ?? '')) {
            case 'mutation-prepared':
                $counts['prepared']++;
                break;
            case 'mutation-applied':
                $counts['applied']++;
                break;
            case 'mutation-precondition-failed':
                $counts['preconditionFailed']++;
                break;
        }
    }
    return $counts;
}

function reprint_push_lab_rest_target_set_hash(array $targets): string
{
    $compact_targets = [];
    foreach (array_values($targets) as $index => $target) {
        if (!is_array($target)) {
            continue;
        }
        $compact_targets[] = [
            'index' => (int) ($target['index'] ?? $index),
            'mutationIdHash' => hash('sha256', (string) ($target['mutationId'] ?? '')),
            'resourceKeyHash' => hash('sha256', (string) ($target['resourceKey'] ?? '')),
            'resourceHash' => hash('sha256', reprint_push_stable_json($target['resource'] ?? null)),
            'beforeHash' => (string) ($target['beforeHash'] ?? $target['expectedOldHash'] ?? ''),
            'afterHash' => (string) ($target['afterHash'] ?? $target['expectedNewHash'] ?? ''),
        ];
    }
    return hash('sha256', reprint_push_stable_json($compact_targets));
}

function reprint_push_lab_rest_current_hash_set_hash(array $recovery): string
{
    $hashes = isset($recovery['currentHashes']) && is_array($recovery['currentHashes'])
        ? $recovery['currentHashes']
        : [];
    $compact_hashes = [];
    foreach (array_values($hashes) as $index => $hash_evidence) {
        if (!is_array($hash_evidence)) {
            continue;
        }
        $compact_hashes[] = [
            'index' => (int) ($hash_evidence['index'] ?? $index),
            'mutationIdHash' => hash('sha256', (string) ($hash_evidence['mutationId'] ?? '')),
            'resourceKeyHash' => hash('sha256', (string) ($hash_evidence['resourceKey'] ?? '')),
            'hash' => (string) ($hash_evidence['hash'] ?? ''),
        ];
    }
    return hash('sha256', reprint_push_stable_json($compact_hashes));
}

function reprint_push_lab_rest_missing_commit_recovery_from_targets(
    array $targets,
    array $plan_evidence,
    array $receipt,
    array $extra = []
): array {
    $snapshot = reprint_push_export_snapshot();
    $recovery_targets = [];
    $current_hashes = [];
    $old = 0;
    $new = 0;
    $unknown = 0;

    foreach ($targets as $index => $target) {
        $current_hash = isset($target['resource']) && is_array($target['resource'])
            ? reprint_push_hash_resource($snapshot, $target['resource'])
            : '';
        $old_hash = (string) ($target['beforeHash'] ?? '');
        $new_hash = (string) ($target['afterHash'] ?? '');
        if ($current_hash !== '' && $current_hash === $old_hash) {
            $classification = 'old';
            $old++;
        } elseif ($current_hash !== '' && $current_hash === $new_hash) {
            $classification = 'new';
            $new++;
        } else {
            $classification = 'blocked-unknown';
            $unknown++;
        }

        $current_hashes[] = [
            'index' => (int) $index,
            'mutationId' => (string) ($target['mutationId'] ?? ''),
            'resourceKey' => (string) ($target['resourceKey'] ?? ''),
            'hash' => $current_hash,
        ];
        $recovery_targets[] = [
            'index' => (int) $index,
            'mutationId' => (string) ($target['mutationId'] ?? ''),
            'resourceKey' => (string) ($target['resourceKey'] ?? ''),
            'resource' => $target['resource'] ?? null,
            'expectedOldHash' => $old_hash,
            'expectedNewHash' => $new_hash,
            'currentHash' => $current_hash,
            'classification' => $classification,
        ];
    }

    $state = 'blocked-recovery';
    if (count($recovery_targets) > 0 && $old === count($recovery_targets)) {
        $state = 'old-remote';
    } elseif (count($recovery_targets) > 0 && $new === count($recovery_targets)) {
        $state = 'fully-updated-remote';
    }

    return [
        'schemaVersion' => 1,
        'scope' => 'Playground lab DB journal missing-commit evidence only; no production durability or rollback guarantee',
        'state' => $state,
        'counts' => [
            'old' => $old,
            'new' => $new,
            'blockedUnknown' => $unknown,
            'total' => count($recovery_targets),
        ],
        'targets' => $recovery_targets,
        'currentHashes' => $current_hashes,
        'currentSnapshotHash' => hash('sha256', reprint_push_stable_json($snapshot)),
        'planEvidence' => $plan_evidence,
        'receiptEvidence' => [
            'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null,
            'planHash' => isset($receipt['planHash']) ? (string) $receipt['planHash'] : null,
            'mutationCount' => isset($receipt['mutationCount']) ? (int) $receipt['mutationCount'] : null,
        ],
    ] + $extra;
}

function reprint_push_lab_rest_blocked_missing_commit_result(
    array $context,
    array $claim_entry,
    array $started_entry,
    array $recovery
): array {
    $blocked_result = [
        'ok' => false,
        'code' => 'RECOVERY_BLOCKED',
        'message' => 'Missing DB apply commit cannot be finalized because live target hashes are not all at the durable planned after hashes.',
        'mode' => 'apply',
        'recovery' => $recovery + [
            'required' => true,
            'finalized' => false,
        ],
        'idempotency' => [
            'replayed' => false,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'finalizedMissingCommit' => false,
        ],
    ];

    $blocked_entry = reprint_push_lab_db_journal_append_event('recovery-blocked', $context + [
        'errorCode' => 'RECOVERY_BLOCKED',
        'result' => reprint_push_lab_db_journal_compact_result($blocked_result),
        'resourceHashEvidence' => [
            'recovery' => $recovery,
            'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
            'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
        ],
    ]);
    $blocked_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($blocked_entry);

    return $blocked_result;
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

function reprint_push_lab_rest_db_journal_context(array $payload, string $idempotency_key, array $profile = []): array
{
    return [
        'idempotencyKeyHash' => reprint_push_lab_db_journal_key_hash($idempotency_key),
        'requestHash' => reprint_push_lab_db_journal_request_hash($payload),
        'planHash' => reprint_push_lab_db_journal_plan_hash_from_payload($payload),
        'receiptHash' => reprint_push_lab_db_journal_receipt_hash_from_payload($payload),
        'planFingerprint' => reprint_push_lab_db_journal_plan_fingerprint_from_payload($payload),
        'mutationCount' => reprint_push_lab_db_journal_mutation_count_from_payload($payload),
        'restNamespace' => (string) ($profile['restNamespace'] ?? REPRINT_PUSH_LAB_REST_NAMESPACE),
        'routeProfile' => (string) ($profile['profile'] ?? 'lab-authenticated'),
    ];
}

function reprint_push_lab_rest_require_signed_request(WP_REST_Request $request, string $mode): ?WP_REST_Response
{
    $result = reprint_push_lab_rest_verify_signed_request($request, $mode);
    if (($result['ok'] ?? false) !== true) {
        return reprint_push_lab_rest_json_response($result + ['mode' => $mode]);
    }

    reprint_push_lab_rest_set_signature_context($request, $result['signature']);
    return null;
}

function reprint_push_lab_rest_verify_signed_request(WP_REST_Request $request, string $mode): array
{
    $auth = reprint_push_lab_rest_basic_auth_context($request);
    if (!is_array($auth) || !isset($auth['signingKey'])) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_AUTH_UNAVAILABLE',
            'Signed push requests require verified Application Password basic auth evidence.',
            401
        );
    }

    $content_hash = strtolower(trim((string) $request->get_header('x-auth-content-hash')));
    $timestamp = trim((string) $request->get_header('x-auth-timestamp'));
    $nonce = trim((string) $request->get_header('x-auth-nonce'));
    $auth_signature = trim((string) $request->get_header('x-auth-signature'));
    $push_signature = trim((string) $request->get_header('x-reprint-push-signature'));
    $session_id = trim((string) $request->get_header('x-reprint-push-session'));
    $idempotency_key = trim((string) $request->get_header('x-reprint-push-idempotency-key'));

    foreach ([
        'X-Auth-Content-Hash' => $content_hash,
        'X-Auth-Timestamp' => $timestamp,
        'X-Auth-Nonce' => $nonce,
        'X-Auth-Signature' => $auth_signature,
        'X-Reprint-Push-Signature' => $push_signature,
    ] as $header => $value) {
        if ($value === '') {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_HEADER_REQUIRED',
                $header . ' is required for signed authenticated push requests.',
                401
            );
        }
    }

    if ($mode === 'preflight') {
        if ($session_id !== '') {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_PREFLIGHT_SESSION_REJECTED',
                'Signed preflight mints a server session and does not accept X-Reprint-Push-Session.',
                400
            );
        }
    } else {
        if ($session_id === '') {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_SESSION_REQUIRED',
                'X-Reprint-Push-Session is required for signed dry-run and apply requests.',
                401
            );
        }
        if ($idempotency_key === '') {
            return reprint_push_lab_rest_signature_failure(
                'MISSING_IDEMPOTENCY_KEY',
                'X-Reprint-Push-Idempotency-Key is required for signed dry-run and apply requests.',
                400
            );
        }
    }

    if (!preg_match('/^[a-f0-9]{64}$/', $content_hash)) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_CONTENT_HASH_INVALID',
            'X-Auth-Content-Hash must be a lowercase hex SHA-256 digest.',
            400
        );
    }

    $raw_body = (string) $request->get_body();
    $actual_content_hash = hash('sha256', $raw_body);
    if (!hash_equals($actual_content_hash, $content_hash)) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_CONTENT_HASH_MISMATCH',
            'X-Auth-Content-Hash does not match the raw request body bytes.',
            401
        );
    }

    $timestamp_seconds = reprint_push_lab_rest_parse_signed_timestamp($timestamp);
    if ($timestamp_seconds === null || abs(time() - $timestamp_seconds) > REPRINT_PUSH_LAB_SIGNED_TIMESTAMP_SKEW) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_TIMESTAMP_INVALID',
            'X-Auth-Timestamp is outside the signed request acceptance window.',
            401
        );
    }

    if (!preg_match('/^[A-Za-z0-9._:-]{8,160}$/', $nonce)) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_NONCE_INVALID',
            'X-Auth-Nonce must be an opaque 8 to 160 character token.',
            400
        );
    }

    $signing_key = (string) $auth['signingKey'];
    $signing_key_hash = hash('sha256', $signing_key);
    $auth_string = $nonce . $timestamp . $content_hash;
    $expected_auth_signature = hash_hmac('sha256', $auth_string, $signing_key);
    if (!reprint_push_lab_rest_signature_matches($auth_signature, $expected_auth_signature)) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_AUTH_SIGNATURE_MISMATCH',
            'X-Auth-Signature does not match the signed auth string.',
            401
        );
    }

    $session = null;
    if ($mode === 'preflight') {
        $session = [
            'sessionHash' => '',
            'issuedAt' => '',
            'expiresAt' => '',
        ];
    } else {
        $session = reprint_push_lab_rest_signed_session($session_id);
        if (!is_array($session)) {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_SESSION_INVALID',
                'X-Reprint-Push-Session is not a valid lab signed push session.',
                401
            );
        }
        if ((int) ($session['expiresAtUnix'] ?? 0) < time()) {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_SESSION_EXPIRED',
                'X-Reprint-Push-Session has expired.',
                401
            );
        }
        if (!hash_equals((string) ($session['credentialHash'] ?? ''), (string) ($auth['credentialHash'] ?? ''))
            || !hash_equals((string) ($session['signingKeyHash'] ?? ''), $signing_key_hash)
            || (int) ($session['userId'] ?? 0) !== (int) ($auth['userId'] ?? 0)
            || (string) ($session['scope'] ?? '') !== REPRINT_PUSH_LAB_AUTH_SCOPE
        ) {
            return reprint_push_lab_rest_signature_failure(
                'SIGNED_SESSION_BINDING_MISMATCH',
                'X-Reprint-Push-Session is not bound to the current identity and credential.',
                401
            );
        }
    }

    $canonical = reprint_push_lab_rest_push_canonical_string(
        $request,
        $content_hash,
        $mode === 'preflight' ? '' : $session_id,
        $mode === 'preflight' ? '' : $idempotency_key
    );
    $expected_push_signature = hash_hmac('sha256', $canonical['string'], $signing_key);
    if (!reprint_push_lab_rest_signature_matches($push_signature, $expected_push_signature)) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_PUSH_SIGNATURE_MISMATCH',
            'X-Reprint-Push-Signature does not match the signed push canonical string.',
            401
        );
    }

    $nonce_claim = reprint_push_lab_rest_claim_signed_nonce($nonce, [
        'mode' => $mode,
        'timestamp' => $timestamp_seconds,
        'expiresAtUnix' => time() + REPRINT_PUSH_LAB_SIGNED_TIMESTAMP_SKEW,
        'contentHash' => $content_hash,
        'sessionHash' => (string) ($session['sessionHash'] ?? ''),
        'identityHash' => reprint_push_lab_rest_signed_identity_hash($auth),
        'credentialHash' => (string) ($auth['credentialHash'] ?? ''),
        'authSignatureHash' => hash('sha256', $expected_auth_signature),
        'pushSignatureHash' => hash('sha256', $expected_push_signature),
    ]);
    if (!$nonce_claim) {
        return reprint_push_lab_rest_signature_failure(
            'SIGNED_NONCE_REPLAYED',
            'X-Auth-Nonce has already been accepted for a signed request.',
            409
        );
    }

    if ($mode === 'preflight') {
        $session = reprint_push_lab_rest_mint_signed_session($auth, $signing_key_hash);
        $session_id = (string) $session['id'];
    }

    $cleanup = reprint_push_lab_rest_collect_expired_signed_artifacts();

    return [
        'ok' => true,
        'signature' => [
            'schemaVersion' => 1,
            'mode' => $mode,
            'contentHash' => $content_hash,
            'timestamp' => $timestamp,
            'timestampUnix' => $timestamp_seconds,
            'nonceHash' => hash('sha256', $nonce),
            'signingKeyHash' => $signing_key_hash,
            'session' => [
                'id' => $mode === 'preflight' ? $session_id : null,
                'sessionHash' => (string) ($session['sessionHash'] ?? ''),
                'issuedAt' => (string) ($session['issuedAt'] ?? ''),
                'expiresAt' => (string) ($session['expiresAt'] ?? ''),
            ],
            'request' => [
                'method' => $canonical['method'],
                'path' => $canonical['path'],
                'canonicalQuery' => $canonical['canonicalQuery'],
                'idempotencyKeyHash' => $idempotency_key !== '' ? hash('sha256', $idempotency_key) : '',
                'canonicalHash' => hash('sha256', $canonical['string']),
            ],
            'cleanup' => $cleanup,
        ],
    ];
}

function reprint_push_lab_rest_signature_failure(string $code, string $message, int $status): array
{
    return [
        'ok' => false,
        'code' => $code,
        'message' => $message,
        'signature' => [
            'required' => true,
            'status' => $status,
        ],
    ];
}

function reprint_push_lab_rest_parse_signed_timestamp(string $timestamp): ?int
{
    if (preg_match('/^\d{10}$/', $timestamp)) {
        return (int) $timestamp;
    }
    $parsed = strtotime($timestamp);
    return $parsed === false ? null : $parsed;
}

function reprint_push_lab_rest_signature_matches(string $supplied, string $expected_hex): bool
{
    $normalized = strtolower(trim($supplied));
    if (strpos($normalized, 'sha256=') === 0) {
        $normalized = substr($normalized, 7);
    }
    if (preg_match('/^[a-f0-9]{64}$/', $normalized)) {
        return hash_equals($expected_hex, $normalized);
    }

    $decoded = base64_decode($supplied, true);
    if (is_string($decoded) && $decoded !== '') {
        return hash_equals(hex2bin($expected_hex), $decoded);
    }

    return false;
}

function reprint_push_lab_rest_push_canonical_string(
    WP_REST_Request $request,
    string $content_hash,
    string $session,
    string $idempotency_key
): array {
    $request_uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $parts = parse_url($request_uri);
    $path = is_array($parts) && isset($parts['path']) ? (string) $parts['path'] : '/';
    $query = is_array($parts) && isset($parts['query']) ? (string) $parts['query'] : '';
    $method = strtoupper((string) $request->get_method());
    $canonical_query = reprint_push_lab_rest_canonical_query($query);
    $canonical = implode("\n", [
        'REPRINT-PUSH-LAB-V1',
        $method,
        $path,
        $canonical_query,
        $content_hash,
        $session,
        $idempotency_key,
    ]);

    return [
        'string' => $canonical,
        'method' => $method,
        'path' => $path,
        'canonicalQuery' => $canonical_query,
    ];
}

function reprint_push_lab_rest_canonical_query(string $query): string
{
    if ($query === '') {
        return '';
    }

    $pairs = [];
    foreach (explode('&', $query) as $index => $part) {
        if ($part === '') {
            continue;
        }
        $pieces = explode('=', $part, 2);
        $pairs[] = [
            'key' => rawurldecode(str_replace('+', '%20', $pieces[0])),
            'value' => rawurldecode(str_replace('+', '%20', $pieces[1] ?? '')),
            'index' => $index,
        ];
    }

    usort($pairs, static function (array $a, array $b): int {
        return [$a['key'], $a['value'], $a['index']] <=> [$b['key'], $b['value'], $b['index']];
    });

    return implode('&', array_map(static function (array $pair): string {
        return rawurlencode((string) $pair['key']) . '=' . rawurlencode((string) $pair['value']);
    }, $pairs));
}

function reprint_push_lab_rest_mint_signed_session(array $auth, string $signing_key_hash): array
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $session_hash = hash('sha256', $token);
    $now = time();
    $session = [
        'schemaVersion' => 1,
        'sessionHash' => $session_hash,
        'identityHash' => reprint_push_lab_rest_signed_identity_hash($auth),
        'credentialHash' => (string) ($auth['credentialHash'] ?? ''),
        'applicationPasswordUuid' => (string) ($auth['applicationPasswordUuid'] ?? ''),
        'userId' => (int) ($auth['userId'] ?? 0),
        'scope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
        'signingKeyHash' => $signing_key_hash,
        'issuedAt' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $now + REPRINT_PUSH_LAB_SIGNED_SESSION_TTL),
        'expiresAtUnix' => $now + REPRINT_PUSH_LAB_SIGNED_SESSION_TTL,
    ];
    add_option(reprint_push_lab_rest_signed_session_option($session_hash), $session, '', 'no');
    $session['id'] = $token;
    return $session;
}

function reprint_push_lab_rest_signed_session(string $session_id): ?array
{
    if (!preg_match('/^[A-Za-z0-9_-]{32,160}$/', $session_id)) {
        return null;
    }

    $session_hash = hash('sha256', $session_id);
    $session = get_option(reprint_push_lab_rest_signed_session_option($session_hash), null);
    if (!is_array($session)) {
        return null;
    }
    if ((int) ($session['expiresAtUnix'] ?? 0) < time()) {
        delete_option(reprint_push_lab_rest_signed_session_option($session_hash));
        return null;
    }
    $session['sessionHash'] = $session_hash;
    return $session;
}

function reprint_push_lab_rest_claim_signed_nonce(string $nonce, array $metadata): bool
{
    $nonce_hash = hash('sha256', $nonce);
    $metadata['schemaVersion'] = 1;
    $metadata['nonceHash'] = $nonce_hash;
    $metadata['createdAt'] = gmdate('Y-m-d\TH:i:s\Z');
    return add_option(reprint_push_lab_rest_signed_nonce_option($nonce_hash), $metadata, '', 'no');
}

function reprint_push_lab_rest_collect_expired_signed_artifacts(?int $now = null): array
{
    $now = $now ?? time();
    $session_cleanup = reprint_push_lab_rest_collect_expired_signed_artifacts_by_prefix(
        reprint_push_lab_rest_signed_session_option(''),
        $now
    );
    $nonce_cleanup = reprint_push_lab_rest_collect_expired_signed_artifacts_by_prefix(
        reprint_push_lab_rest_signed_nonce_option(''),
        $now
    );

    return [
        'schemaVersion' => 1,
        'store' => 'wp-options',
        'now' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'limit' => REPRINT_PUSH_LAB_SIGNED_STORE_CLEANUP_LIMIT,
        'sessionOptions' => $session_cleanup,
        'nonceOptions' => $nonce_cleanup,
        'deletedExpiredTotal' => (int) $session_cleanup['deletedExpired'] + (int) $nonce_cleanup['deletedExpired'],
    ];
}

function reprint_push_lab_rest_collect_expired_signed_artifacts_by_prefix(string $option_prefix, int $now): array
{
    global $wpdb;

    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE %s ORDER BY option_name ASC LIMIT %d",
            $wpdb->esc_like($option_prefix) . '%',
            REPRINT_PUSH_LAB_SIGNED_STORE_CLEANUP_LIMIT
        ),
        ARRAY_A
    );
    $rows = is_array($rows) ? $rows : [];

    $deleted = 0;
    $retained_unexpired = 0;
    $retained_without_expiry = 0;

    foreach ($rows as $row) {
        $option_name = (string) ($row['option_name'] ?? '');
        $value = maybe_unserialize($row['option_value'] ?? null);
        $expires_at = is_array($value) ? (int) ($value['expiresAtUnix'] ?? 0) : 0;

        if ($expires_at > 0 && $expires_at <= $now) {
            delete_option($option_name);
            $deleted++;
            continue;
        }

        if ($expires_at > $now) {
            $retained_unexpired++;
        } else {
            $retained_without_expiry++;
        }
    }

    return [
        'prefixHash' => hash('sha256', $option_prefix),
        'scanned' => count($rows),
        'deletedExpired' => $deleted,
        'retainedUnexpired' => $retained_unexpired,
        'retainedWithoutExpiry' => $retained_without_expiry,
        'limitReached' => count($rows) >= REPRINT_PUSH_LAB_SIGNED_STORE_CLEANUP_LIMIT,
    ];
}

function reprint_push_lab_rest_signed_identity_hash(array $auth): string
{
    return hash('sha256', implode("\n", [
        (string) ($auth['userId'] ?? ''),
        (string) ($auth['userLogin'] ?? ''),
        (string) ($auth['applicationPasswordUuid'] ?? ''),
        REPRINT_PUSH_LAB_AUTH_SCOPE,
    ]));
}

function reprint_push_lab_rest_signed_session_option(string $session_hash): string
{
    return 'reprint_push_lab_signed_session_' . $session_hash;
}

function reprint_push_lab_rest_signed_nonce_option(string $nonce_hash): string
{
    return 'reprint_push_lab_signed_nonce_' . $nonce_hash;
}

function reprint_push_lab_rest_set_signature_context(WP_REST_Request $request, array $signature): void
{
    $attributes = $request->get_attributes();
    $attributes[REPRINT_PUSH_LAB_SIGNATURE_REQUEST_ATTRIBUTE] = $signature;
    $request->set_attributes($attributes);
}

function reprint_push_lab_rest_signature_context(WP_REST_Request $request): array
{
    $attributes = $request->get_attributes();
    $signature = $attributes[REPRINT_PUSH_LAB_SIGNATURE_REQUEST_ATTRIBUTE] ?? null;
    return is_array($signature) ? $signature : [];
}

function reprint_push_lab_rest_signed_request_evidence(WP_REST_Request $request): array
{
    $signature = reprint_push_lab_rest_signature_context($request);
    return [
        'schemaVersion' => 1,
        'contentHash' => (string) ($signature['contentHash'] ?? ''),
        'timestamp' => (string) ($signature['timestamp'] ?? ''),
        'nonceHash' => (string) ($signature['nonceHash'] ?? ''),
        'sessionHash' => (string) ($signature['session']['sessionHash'] ?? ''),
        'signingKeyHash' => (string) ($signature['signingKeyHash'] ?? ''),
        'cleanup' => isset($signature['cleanup']) && is_array($signature['cleanup'])
            ? $signature['cleanup']
            : [],
        'request' => isset($signature['request']) && is_array($signature['request'])
            ? $signature['request']
            : [],
    ];
}

function reprint_push_lab_rest_maybe_bootstrap_auth_users(): void
{
    if (!reprint_push_lab_rest_auth_bootstrap_enabled()) {
        return;
    }

    foreach (reprint_push_lab_rest_auth_fixture_credentials() as $credential) {
        reprint_push_lab_rest_upsert_auth_user(
            (string) $credential['login'],
            (string) $credential['password'],
            (string) $credential['role'],
            (string) $credential['slug']
        );
    }
}

function reprint_push_lab_rest_upsert_auth_user(string $login, string $app_password, string $role, string $slug): void
{
    reprint_push_lab_rest_provision_push_application_password([
        'login' => $login,
        'appPassword' => $app_password,
        'role' => $role,
        'slug' => $slug,
        'name' => 'Reprint Push Lab Auth Smoke',
        'createUser' => true,
        'updateRole' => true,
    ]);
}

function reprint_push_lab_rest_provision_push_application_password(array $args): array
{
    $login = sanitize_user((string) ($args['login'] ?? ''), true);
    $app_password = (string) ($args['appPassword'] ?? $args['password'] ?? '');
    $role = sanitize_key((string) ($args['role'] ?? ''));
    $slug = sanitize_key((string) ($args['slug'] ?? $login));
    $name = sanitize_text_field((string) ($args['name'] ?? 'Reprint Push Credential'));
    $create_user = !empty($args['createUser']);
    $update_role = !empty($args['updateRole']);

    if ($login === '' || $app_password === '') {
        return [
            'ok' => false,
            'code' => 'reprint_push_provision_missing_credential',
            'message' => 'Provisioning requires a login and Application Password.',
        ];
    }

    $user = get_user_by('login', $login);
    if (!$user && $create_user) {
        $user_id = wp_insert_user([
            'user_login' => $login,
            'user_pass' => wp_generate_password(32, true, true),
            'user_email' => sanitize_user($login, true) . '@example.test',
            'display_name' => $login,
            'role' => $role !== '' ? $role : 'administrator',
        ]);
        if (is_wp_error($user_id)) {
            return [
                'ok' => false,
                'code' => 'reprint_push_provision_user_failed',
                'message' => $user_id->get_error_message(),
            ];
        }
        $user = get_user_by('id', (int) $user_id);
    }

    if (!$user) {
        return [
            'ok' => false,
            'code' => 'reprint_push_provision_user_missing',
            'message' => 'Provisioning requires an existing user unless createUser is enabled.',
        ];
    }

    $user_id = (int) $user->ID;
    if ($update_role && $role !== '') {
        $wp_user = new WP_User($user_id);
        $wp_user->set_role($role);
    }

    $uuid = reprint_push_lab_rest_stable_uuid('reprint-push-lab-' . $slug);
    $app_id = reprint_push_lab_rest_stable_uuid('reprint-push-lab-app-' . $slug);
    $items = get_user_meta($user_id, '_application_passwords', true);
    $items = is_array($items) ? array_values($items) : [];
    $items = array_values(array_filter($items, static function ($item) use ($uuid, $app_id): bool {
        return !is_array($item)
            || ((string) ($item['uuid'] ?? '') !== $uuid && (string) ($item['app_id'] ?? '') !== $app_id);
    }));
    $normalized_app_password = preg_replace('/[^a-zA-Z0-9]/', '', $app_password);
    $items[] = [
        'uuid' => $uuid,
        'app_id' => $app_id,
        'name' => $name !== '' ? $name : 'Reprint Push Credential',
        'password' => wp_hash_password($normalized_app_password),
        'created' => time(),
        'last_used' => null,
        'last_ip' => null,
        'reprint_push_scope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
        'reprint_push_credential_type' => 'push-application-password',
    ];
    update_user_meta($user_id, '_application_passwords', $items);

    return [
        'ok' => true,
        'userId' => $user_id,
        'userLogin' => (string) $user->user_login,
        'applicationPasswordUuid' => $uuid,
        'applicationPasswordAppId' => $app_id,
        'credentialHash' => hash('sha256', $login . "\n" . $app_password),
        'scope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
        'credentialType' => 'push-application-password',
    ];
}

function reprint_push_lab_rest_auth_bootstrap_enabled(): bool
{
    if (defined('REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP') && REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP === true) {
        return false;
    }

    // This plugin is a disposable Playground fixture. The Basic verifier below
    // is deliberately lab-only and must not be treated as production auth.
    return true;
}

function reprint_push_lab_rest_auth_fixture_credentials(): array
{
    return [
        [
            'login' => getenv('REPRINT_PUSH_LAB_AUTH_ADMIN_USER') ?: 'reprint_push_admin',
            'password' => getenv('REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD') ?: 'reprint-push-admin-app-password',
            'role' => 'administrator',
            'slug' => 'primary-admin',
        ],
        [
            'login' => getenv('REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_USER') ?: 'reprint_push_alt_admin',
            'password' => getenv('REPRINT_PUSH_LAB_AUTH_ALT_ADMIN_APP_PASSWORD') ?: 'reprint-push-alt-admin-app-password',
            'role' => 'administrator',
            'slug' => 'alternate-admin',
        ],
        [
            'login' => getenv('REPRINT_PUSH_LAB_AUTH_LIMITED_USER') ?: 'reprint_push_limited',
            'password' => getenv('REPRINT_PUSH_LAB_AUTH_LIMITED_APP_PASSWORD') ?: 'reprint-push-limited-app-password',
            'role' => 'subscriber',
            'slug' => 'limited-user',
        ],
    ];
}

function reprint_push_lab_rest_stable_uuid(string $seed): string
{
    $hex = md5($seed);
    return substr($hex, 0, 8)
        . '-' . substr($hex, 8, 4)
        . '-' . substr($hex, 12, 4)
        . '-' . substr($hex, 16, 4)
        . '-' . substr($hex, 20, 12);
}

function reprint_push_lab_rest_basic_auth_context(WP_REST_Request $request): ?array
{
    $existing = reprint_push_lab_rest_get_auth_context($request);
    if (is_array($existing)) {
        return $existing;
    }

    $header = reprint_push_lab_rest_authorization_header($request);
    if (!preg_match('/^Basic\s+(.+)$/i', $header, $matches)) {
        return null;
    }

    $decoded = base64_decode($matches[1], true);
    if (!is_string($decoded) || strpos($decoded, ':') === false) {
        return null;
    }

    [$login, $password] = explode(':', $decoded, 2);
    if ($login === '' || $password === '') {
        return null;
    }

    $user = get_user_by('login', $login);
    if ($user) {
        $verified = reprint_push_lab_rest_verify_application_password((int) $user->ID, $login, $password);
        if (is_array($verified)) {
            return $verified;
        }
    }

    $fallback = reprint_push_lab_rest_playground_basic_auth_context($login, $password);
    if (is_array($fallback)) {
        reprint_push_lab_rest_set_auth_context($request, $fallback);
    }

    return $fallback;
}

function reprint_push_lab_rest_get_auth_context(WP_REST_Request $request): ?array
{
    $attributes = $request->get_attributes();
    $auth = $attributes[REPRINT_PUSH_LAB_AUTH_REQUEST_ATTRIBUTE] ?? null;
    return is_array($auth) ? $auth : null;
}

function reprint_push_lab_rest_set_auth_context(WP_REST_Request $request, array $auth): void
{
    $attributes = $request->get_attributes();
    $attributes[REPRINT_PUSH_LAB_AUTH_REQUEST_ATTRIBUTE] = $auth;
    $request->set_attributes($attributes);
}

function reprint_push_lab_rest_authorization_header(WP_REST_Request $request): string
{
    $headers = [
        (string) $request->get_header('authorization'),
        (string) $request->get_header('x-reprint-push-playground-authorization'),
        (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''),
        (string) ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''),
    ];

    if (function_exists('getallheaders')) {
        $all_headers = getallheaders();
        if (is_array($all_headers)) {
            foreach ($all_headers as $name => $value) {
                if (strcasecmp((string) $name, 'authorization') === 0) {
                    $headers[] = (string) $value;
                }
            }
        }
    }

    foreach ($headers as $header) {
        if ($header !== '') {
            return $header;
        }
    }

    $php_auth_user = (string) ($_SERVER['PHP_AUTH_USER'] ?? '');
    $php_auth_pw = (string) ($_SERVER['PHP_AUTH_PW'] ?? '');
    if ($php_auth_user !== '' || $php_auth_pw !== '') {
        return 'Basic ' . base64_encode($php_auth_user . ':' . $php_auth_pw);
    }

    return '';
}

function reprint_push_lab_rest_verify_application_password(int $user_id, string $login, string $password): ?array
{
    $items = get_user_meta($user_id, '_application_passwords', true);
    $items = is_array($items) ? $items : [];
    $normalized_password = (string) preg_replace('/[^a-zA-Z0-9]/', '', $password);

    foreach ($items as $item) {
        if (!is_array($item) || !isset($item['password'])) {
            continue;
        }
        if (!wp_check_password($normalized_password, (string) $item['password'], $user_id)) {
            continue;
        }
        if (!reprint_push_lab_rest_application_password_item_allows_push($item)) {
            continue;
        }

        $user = get_user_by('id', $user_id);
        if (!$user) {
            return null;
        }

        return [
            'type' => 'application-password-basic',
            'verifier' => 'playground-basic-stored-application-password',
            'userId' => $user_id,
            'userLogin' => (string) $user->user_login,
            'applicationPasswordUuid' => (string) ($item['uuid'] ?? ''),
            'applicationPasswordAppId' => (string) ($item['app_id'] ?? ''),
            'credentialScope' => reprint_push_lab_rest_application_password_item_scope($item),
            'credentialType' => (string) ($item['reprint_push_credential_type'] ?? ''),
            'credentialHash' => hash('sha256', $login . "\n" . $password),
            'signingKey' => hash_hmac('sha256', 'reprint-push-lab-v1' . "\n" . $login, $password),
            'playgroundFallback' => true,
            'warning' => 'Lab-only Playground Basic verifier; not production authentication.',
        ];
    }

    return null;
}

function reprint_push_lab_rest_application_password_item_allows_push(array $item): bool
{
    return reprint_push_lab_rest_application_password_item_scope($item) === REPRINT_PUSH_LAB_AUTH_SCOPE;
}

function reprint_push_lab_rest_application_password_item_scope(array $item): string
{
    return (string) ($item['reprint_push_scope'] ?? $item['reprint_push_lab_scope'] ?? '');
}

function reprint_push_lab_rest_playground_basic_auth_context(string $login, string $password): ?array
{
    if (!reprint_push_lab_rest_auth_bootstrap_enabled()) {
        return null;
    }

    $candidates = reprint_push_lab_rest_auth_fixture_credentials();
    $normalized_password = (string) preg_replace('/[^a-zA-Z0-9]/', '', $password);
    foreach ($candidates as $candidate) {
        $candidate_password = (string) $candidate['password'];
        $normalized_candidate_password = (string) preg_replace('/[^a-zA-Z0-9]/', '', $candidate_password);
        if ($login !== $candidate['login']
            || (!hash_equals($candidate_password, $password) && !hash_equals($normalized_candidate_password, $normalized_password))
        ) {
            continue;
        }

        reprint_push_lab_rest_upsert_auth_user($login, $candidate_password, (string) $candidate['role'], (string) $candidate['slug']);
        $user = get_user_by('login', $login);
        if (!$user) {
            return null;
        }

        $verified = reprint_push_lab_rest_verify_application_password((int) $user->ID, $login, $password);
        if (!is_array($verified)) {
            return null;
        }
        $verified['verifier'] = 'playground-basic-bootstrap-fallback';
        $verified['warning'] = 'Lab-only Playground Basic bootstrap fallback; not production authentication.';

        $verified['applicationPasswordUuid'] = reprint_push_lab_rest_stable_uuid('reprint-push-lab-' . $candidate['slug']);
        return $verified;
    }

    return null;
}

function reprint_push_lab_rest_auth_evidence(WP_REST_Request $request): array
{
    $auth = reprint_push_lab_rest_basic_auth_context($request);
    $user = wp_get_current_user();

    return [
        'schemaVersion' => 1,
        'scope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
        'identity' => [
            'userId' => (int) $user->ID,
            'userLogin' => (string) $user->user_login,
            'roles' => array_values(array_map('strval', (array) $user->roles)),
            'capabilities' => [
                'manage_options' => current_user_can('manage_options'),
            ],
        ],
        'session' => [
            'type' => is_array($auth) ? $auth['type'] : null,
            'verifier' => is_array($auth) ? ($auth['verifier'] ?? null) : null,
            'applicationPasswordUuid' => is_array($auth) ? $auth['applicationPasswordUuid'] : null,
            'applicationPasswordAppId' => is_array($auth) ? ($auth['applicationPasswordAppId'] ?? null) : null,
            'credentialScope' => is_array($auth) ? ($auth['credentialScope'] ?? null) : null,
            'credentialType' => is_array($auth) ? ($auth['credentialType'] ?? null) : null,
            'credentialHash' => is_array($auth) ? $auth['credentialHash'] : null,
            'playgroundFallback' => is_array($auth) ? (bool) ($auth['playgroundFallback'] ?? false) : false,
            'warning' => is_array($auth) && isset($auth['warning']) ? (string) $auth['warning'] : null,
        ],
    ];
}

function reprint_push_lab_rest_bind_authenticated_receipt(
    array $receipt,
    WP_REST_Request $request,
    array $payload,
    array $plan
): array {
    $signed_request = reprint_push_lab_rest_signed_request_evidence($request);
    $profile = reprint_push_lab_rest_route_profile($request);
    $receipt['authBinding'] = [
        'schemaVersion' => 1,
        'scope' => (string) $profile['authScope'],
        'identity' => reprint_push_lab_rest_auth_evidence($request)['identity'],
        'session' => reprint_push_lab_rest_auth_evidence($request)['session'],
        'pushSession' => [
            'sessionHash' => $signed_request['sessionHash'],
            'signingKeyHash' => $signed_request['signingKeyHash'],
            'dryRunNonceHash' => $signed_request['nonceHash'],
            'dryRunContentHash' => $signed_request['contentHash'],
            'dryRunCanonicalHash' => (string) ($signed_request['request']['canonicalHash'] ?? ''),
        ],
        'request' => [
            'restNamespace' => (string) $profile['restNamespace'],
            'dryRunRoute' => (string) $profile['dryRunRoute'],
            'routeProfile' => (string) $profile['profile'],
            'labBacked' => (bool) ($profile['labBacked'] ?? false),
            'planPayloadHash' => hash('sha256', reprint_push_stable_json($plan)),
            'dryRunBodyHash' => hash('sha256', reprint_push_stable_json($payload)),
        ],
        'preconditions' => [
            'preconditionSetHash' => (string) ($receipt['preconditionSetHash'] ?? ''),
            'mutationSetHash' => (string) ($receipt['mutationSetHash'] ?? ''),
            'mutationCount' => (int) ($receipt['mutationCount'] ?? 0),
        ],
        'issuedAt' => gmdate('Y-m-d\TH:i:s\Z'),
        'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', time() + 300),
    ];
    unset($receipt['receiptHash']);
    $receipt['receiptHash'] = hash('sha256', reprint_push_stable_json($receipt));

    return $receipt;
}

function reprint_push_lab_rest_validate_authenticated_receipt(
    WP_REST_Request $request,
    array $payload,
    array $plan,
    array $receipt_payload
): void {
    $profile = reprint_push_lab_rest_route_profile($request);
    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    $binding = isset($receipt['authBinding']) && is_array($receipt['authBinding'])
        ? $receipt['authBinding']
        : null;
    if (!is_array($binding)) {
        reprint_push_lab_rest_auth_receipt_mismatch('Authenticated apply requires an auth-bound dry-run receipt.', $receipt);
    }

    $expected_hash = (string) ($receipt['receiptHash'] ?? '');
    $without_hash = $receipt;
    unset($without_hash['receiptHash']);
    if ($expected_hash === '' || hash('sha256', reprint_push_stable_json($without_hash)) !== $expected_hash) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt hash does not match receipt body.', $receipt);
    }

    if ((string) ($binding['scope'] ?? '') !== (string) $profile['authScope']) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt auth scope does not match authenticated push scope.', $receipt);
    }

    $expires_at = strtotime((string) ($binding['expiresAt'] ?? ''));
    if (!$expires_at || $expires_at < time()) {
        reprint_push_lab_rest_auth_receipt_mismatch('Authenticated dry-run receipt has expired.', $receipt, 'AUTH_RECEIPT_EXPIRED');
    }

    $current = reprint_push_lab_rest_auth_evidence($request);
    $identity = isset($binding['identity']) && is_array($binding['identity']) ? $binding['identity'] : [];
    $session = isset($binding['session']) && is_array($binding['session']) ? $binding['session'] : [];
    if ((int) ($identity['userId'] ?? 0) !== (int) ($current['identity']['userId'] ?? 0)
        || (string) ($identity['userLogin'] ?? '') !== (string) ($current['identity']['userLogin'] ?? '')
        || (string) ($session['type'] ?? '') !== (string) ($current['session']['type'] ?? '')
        || (string) ($session['applicationPasswordUuid'] ?? '') !== (string) ($current['session']['applicationPasswordUuid'] ?? '')
        || (string) ($session['credentialHash'] ?? '') !== (string) ($current['session']['credentialHash'] ?? '')
    ) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt auth identity or session does not match the current request.', $receipt);
    }

    $request_binding = isset($binding['request']) && is_array($binding['request']) ? $binding['request'] : [];
    if ((string) ($request_binding['restNamespace'] ?? '') !== (string) $profile['restNamespace']
        || (string) ($request_binding['dryRunRoute'] ?? '') !== (string) $profile['dryRunRoute']
        || (string) ($request_binding['planPayloadHash'] ?? '') !== hash('sha256', reprint_push_stable_json($plan))
    ) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt request binding does not match the supplied apply plan.', $receipt);
    }

    $preconditions = isset($binding['preconditions']) && is_array($binding['preconditions'])
        ? $binding['preconditions']
        : [];
    if ((string) ($preconditions['preconditionSetHash'] ?? '') !== (string) ($receipt['preconditionSetHash'] ?? '')
        || (string) ($preconditions['mutationSetHash'] ?? '') !== (string) ($receipt['mutationSetHash'] ?? '')
        || (int) ($preconditions['mutationCount'] ?? -1) !== (int) ($receipt['mutationCount'] ?? -2)
    ) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt precondition binding does not match receipt evidence.', $receipt);
    }

    $signed_request = reprint_push_lab_rest_signed_request_evidence($request);
    $push_session = isset($binding['pushSession']) && is_array($binding['pushSession'])
        ? $binding['pushSession']
        : [];
    if ((string) ($push_session['sessionHash'] ?? '') === ''
        || (string) ($push_session['sessionHash'] ?? '') !== (string) ($signed_request['sessionHash'] ?? '')
        || (string) ($push_session['signingKeyHash'] ?? '') !== (string) ($signed_request['signingKeyHash'] ?? '')
    ) {
        reprint_push_lab_rest_auth_receipt_mismatch('Receipt signed session binding does not match the current request.', $receipt);
    }
}

function reprint_push_lab_rest_auth_receipt_mismatch(
    string $message,
    array $receipt,
    string $code = 'AUTH_RECEIPT_MISMATCH'
): void {
    $journal_entry = reprint_push_protocol_append_journal_event('auth-receipt-mismatch', [
        'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null,
        'receiptPlanId' => $receipt['planId'] ?? null,
        'receiptPlanHash' => $receipt['planHash'] ?? null,
        'reasonHash' => hash('sha256', $message),
        'authScope' => REPRINT_PUSH_LAB_AUTH_SCOPE,
    ]);

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => $code,
        'message' => $message,
        'mode' => 'apply',
        'receiptPlanId' => $receipt['planId'] ?? null,
        'receiptPlanHash' => $receipt['planHash'] ?? null,
        'journal' => reprint_push_protocol_journal_evidence($journal_entry),
    ]);
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
    if (array_key_exists('labDriftAfterPrepared', $payload)) {
        $options['labDriftAfterPrepared'] = $payload['labDriftAfterPrepared'];
    }
    if (array_key_exists('labDriftBeforeStorageWrite', $payload)) {
        $options['labDriftBeforeStorageWrite'] = $payload['labDriftBeforeStorageWrite'];
    }
    return $options;
}

function reprint_push_lab_rest_should_simulate_missing_db_commit(array $payload): bool
{
    if (!array_key_exists('labSimulateMissingDbCommit', $payload)) {
        return false;
    }
    return $payload['labSimulateMissingDbCommit'] === true
        || $payload['labSimulateMissingDbCommit'] === 1
        || $payload['labSimulateMissingDbCommit'] === '1';
}

function reprint_push_lab_rest_should_simulate_stale_claim_all_old(array $payload): bool
{
    if (!array_key_exists('labSimulateStaleClaimAllOld', $payload)) {
        return false;
    }
    return $payload['labSimulateStaleClaimAllOld'] === true
        || $payload['labSimulateStaleClaimAllOld'] === 1
        || $payload['labSimulateStaleClaimAllOld'] === '1';
}

function reprint_push_lab_rest_should_simulate_stale_retry_after_started(array $payload): bool
{
    if (!array_key_exists('labSimulateStaleRetryAfterStarted', $payload)) {
        return false;
    }
    return $payload['labSimulateStaleRetryAfterStarted'] === true
        || $payload['labSimulateStaleRetryAfterStarted'] === 1
        || $payload['labSimulateStaleRetryAfterStarted'] === '1';
}

function reprint_push_lab_rest_should_simulate_stale_retry_after_claim(array $payload): bool
{
    if (!array_key_exists('labSimulateStaleRetryAfterClaim', $payload)) {
        return false;
    }
    return $payload['labSimulateStaleRetryAfterClaim'] === true
        || $payload['labSimulateStaleRetryAfterClaim'] === 1
        || $payload['labSimulateStaleRetryAfterClaim'] === '1';
}

function reprint_push_lab_rest_delay_after_stale_retry_claim(array $payload): void
{
    if (!array_key_exists('labDelayAfterStaleRetryClaimMs', $payload)) {
        return;
    }

    reprint_push_lab_rest_delay_from_payload($payload, 'labDelayAfterStaleRetryClaimMs');
}

function reprint_push_lab_rest_delay_after_idempotency_open(array $payload): void
{
    if (!array_key_exists('labDelayAfterIdempotencyOpenMs', $payload)) {
        return;
    }

    reprint_push_lab_rest_delay_from_payload($payload, 'labDelayAfterIdempotencyOpenMs');
}

function reprint_push_lab_rest_delay_from_payload(array $payload, string $key): void
{
    $delay = $payload[$key];
    if (!is_int($delay) && !(is_string($delay) && preg_match('/^\d+$/', $delay))) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => $key . ' must be a non-negative integer when supplied.',
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
    $snapshot = reprint_push_export_snapshot();
    $drift = reprint_push_lab_rest_maybe_drift_after_authenticated_snapshot($request);

    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'snapshot' => $snapshot,
        'labDriftAfterSnapshot' => $drift,
    ]);
}

function reprint_push_lab_rest_maybe_drift_after_authenticated_snapshot(WP_REST_Request $request): ?array
{
    if (!is_array(reprint_push_lab_rest_get_auth_context($request))) {
        return null;
    }

    $mode = (string) $request->get_param('reprint_push_lab_drift_after_snapshot');
    if ($mode === '') {
        $mode = (string) getenv('REPRINT_PUSH_LAB_DRIFT_AFTER_AUTH_SNAPSHOT');
    }
    if ($mode === '') {
        return null;
    }

    $option_name = 'reprint_push_lab_drift_after_auth_snapshot_done';
    if (get_option($option_name, '') === $mode) {
        return [
            'mode' => $mode,
            'applied' => false,
            'reason' => 'already-applied',
        ];
    }

    if ($mode !== 'post-title') {
        return [
            'mode' => $mode,
            'applied' => false,
            'reason' => 'unsupported-lab-drift-mode',
        ];
    }

    $post_id = 1001;
    $before = get_post($post_id);
    if (!$before instanceof WP_Post) {
        return [
            'mode' => $mode,
            'applied' => false,
            'reason' => 'fixture-post-missing',
            'resourceKey' => 'row:' . wp_json_encode(['wp_posts', 'ID:' . $post_id], JSON_UNESCAPED_SLASHES),
        ];
    }

    wp_update_post([
        'ID' => $post_id,
        'post_title' => 'Concurrent source drift after authenticated snapshot',
    ]);
    update_option($option_name, $mode, false);

    return [
        'mode' => $mode,
        'applied' => true,
        'resourceKey' => 'row:' . wp_json_encode(['wp_posts', 'ID:' . $post_id], JSON_UNESCAPED_SLASHES),
        'beforeHash' => hash('sha256', (string) $before->post_title),
        'afterHash' => hash('sha256', 'Concurrent source drift after authenticated snapshot'),
    ];
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
    $limit = max(1, min(500, (int) $request->get_param('limit')));
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
        'productionShapedNamespace' => REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE,
        'scope' => 'local Playground fixture only',
        'permission' => 'lab-backed route; production-shaped aliases still use local Playground fixture auth',
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
        case 'SIGNED_HEADER_REQUIRED':
        case 'SIGNED_AUTH_UNAVAILABLE':
        case 'SIGNED_CONTENT_HASH_MISMATCH':
        case 'SIGNED_TIMESTAMP_INVALID':
        case 'SIGNED_AUTH_SIGNATURE_MISMATCH':
        case 'SIGNED_SESSION_REQUIRED':
        case 'SIGNED_SESSION_INVALID':
        case 'SIGNED_SESSION_EXPIRED':
        case 'SIGNED_SESSION_BINDING_MISMATCH':
        case 'SIGNED_PUSH_SIGNATURE_MISMATCH':
            return 401;
        case 'SIGNED_NONCE_REPLAYED':
            return 409;
        case 'SIGNED_PREFLIGHT_SESSION_REJECTED':
        case 'SIGNED_CONTENT_HASH_INVALID':
        case 'SIGNED_NONCE_INVALID':
            return 400;
        case 'IDEMPOTENCY_KEY_CONFLICT':
        case 'IDEMPOTENCY_KEY_IN_PROGRESS':
        case 'RECOVERY_BLOCKED':
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
        case 'AUTH_RECEIPT_MISMATCH':
        case 'AUTH_RECEIPT_EXPIRED':
        case 'ATOMIC_GROUP_DEPENDENCY_INVALID':
            return 409;
        default:
            return 500;
    }
}
