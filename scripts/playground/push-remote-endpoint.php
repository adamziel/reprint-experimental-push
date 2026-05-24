<?php
/**
 * Lab-only push endpoint entrypoint for Playground fixtures.
 *
 * Usage:
 *   php push-remote-endpoint.php dry-run /path/to/plan.json
 *   php push-remote-endpoint.php apply /path/to/plan.json /path/to/dry-run-receipt.json
 */

if (!defined('ABSPATH')) {
    $wp_load = '/wordpress/wp-load.php';
    if (!is_file($wp_load)) {
        fwrite(STDERR, "Cannot find /wordpress/wp-load.php\n");
        exit(1);
    }
    require_once $wp_load;
}

require_once __DIR__ . '/snapshot-lib.php';
require_once __DIR__ . '/push-remote-lib.php';

$exit_code = 0;

try {
    $mode = $argv[1] ?? null;
    $plan_path = $argv[2] ?? null;
    $receipt_path = $argv[3] ?? null;

    if (!is_string($mode) || !is_string($plan_path)) {
        throw new Reprint_Push_Protocol_Error([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Usage: php push-remote-endpoint.php dry-run <plan.json> | php push-remote-endpoint.php apply <plan.json> <dry-run-receipt.json>',
        ]);
    }

    $result = reprint_push_protocol_run($mode, $plan_path, $receipt_path);
} catch (Reprint_Push_Protocol_Error $error) {
    $exit_code = max(1, $error->getCode());
    $result = $error->result;
} catch (Throwable $error) {
    $exit_code = 1;
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

echo "REPRINT_PUSH_PROTOCOL_JSON_BEGIN\n";
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
echo "REPRINT_PUSH_PROTOCOL_JSON_END\n";

exit($exit_code);
