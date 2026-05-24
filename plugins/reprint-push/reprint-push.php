<?php
/**
 * Plugin Name: Reprint Push
 * Description: Production-shaped source-site push endpoint prototype for Reprint.
 * Version: 0.0.0
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('REPRINT_PUSH_DISABLE_LAB_ROUTES')) {
    define('REPRINT_PUSH_DISABLE_LAB_ROUTES', true);
}

if (!defined('REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP')) {
    define('REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP', true);
}

$reprint_push_candidates = [
    __DIR__ . '/includes/push-remote-rest-plugin.php',
    dirname(__DIR__, 2) . '/scripts/playground/push-remote-rest-plugin.php',
    '/workspace/scripts/playground/push-remote-rest-plugin.php',
];

foreach ($reprint_push_candidates as $reprint_push_candidate) {
    if (is_file($reprint_push_candidate)) {
        require_once $reprint_push_candidate;
        return;
    }
}

add_action('admin_notices', static function (): void {
    echo '<div class="notice notice-error"><p>Reprint Push could not load its endpoint implementation files.</p></div>';
});
