<?php
/**
 * Export a small deterministic Reprint Push Lab snapshot from a Playground site.
 *
 * This is not a production exporter. It intentionally exports only the fixture
 * resources created by fixtures/playground/*.blueprint.json so the Node planner
 * can be exercised against real WordPress posts, options, and files.
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

$snapshot = reprint_push_export_snapshot();

echo "REPRINT_PUSH_SNAPSHOT_JSON_BEGIN\n";
echo json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
echo "REPRINT_PUSH_SNAPSHOT_JSON_END\n";
