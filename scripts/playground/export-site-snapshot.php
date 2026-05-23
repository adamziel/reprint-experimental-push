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

global $wpdb;

$snapshot = [
    'meta' => [
        'source' => 'wordpress-playground',
        'fixture' => get_option('reprint_push_fixture'),
        'site_url' => get_site_url(),
        'home_url' => get_home_url(),
        'table_prefix' => $wpdb->prefix,
    ],
    'files' => [],
    'plugins' => [],
    'db' => [
        'wp_posts' => [],
        'wp_options' => [],
    ],
];

foreach (['reprint_push_plugin_payload'] as $option_name) {
    $value = get_option($option_name, null);
    if ($value === null) {
        continue;
    }
    $row = [
        'option_name' => $option_name,
        'option_value' => normalize_snapshot_value($value),
    ];
    if ($option_name === 'reprint_push_plugin_payload') {
        $row['__pluginOwner'] = 'forms';
    }
    $snapshot['db']['wp_options']['option_name:' . $option_name] = $row;
}

$posts = $wpdb->get_results(
    "SELECT p.ID, p.post_title, p.post_name, p.post_content, p.post_status, p.post_type, p.post_parent, p.post_author
     FROM {$wpdb->posts} p
     INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
     WHERE pm.meta_key = 'reprint_push_fixture'
     ORDER BY p.ID ASC",
    ARRAY_A
);

foreach ($posts as $post) {
    $post['ID'] = (int) $post['ID'];
    $post['post_parent'] = (int) $post['post_parent'];
    $post['post_author'] = (int) $post['post_author'];
    $snapshot['db']['wp_posts']['ID:' . $post['ID']] = $post;
}

$fixture_root = WP_CONTENT_DIR . '/uploads/reprint-push';
if (is_dir($fixture_root)) {
    export_fixture_files($snapshot, $fixture_root, 'wp-content/uploads/reprint-push');
}

ksort($snapshot['files']);
ksort($snapshot['db']['wp_posts']);
ksort($snapshot['db']['wp_options']);

echo "REPRINT_PUSH_SNAPSHOT_JSON_BEGIN\n";
echo json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
echo "REPRINT_PUSH_SNAPSHOT_JSON_END\n";

function export_fixture_files(array &$snapshot, string $root, string $relative_root): void
{
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file_info) {
        if (!$file_info->isFile()) {
            continue;
        }
        $path = $file_info->getPathname();
        $relative = $relative_root . substr($path, strlen($root));
        $snapshot['files'][str_replace(DIRECTORY_SEPARATOR, '/', $relative)] = file_get_contents($path);
    }
}

function normalize_snapshot_value($value)
{
    if (is_array($value)) {
        $normalized = [];
        foreach ($value as $key => $inner_value) {
            $normalized[(string) $key] = normalize_snapshot_value($inner_value);
        }
        ksort($normalized);
        return $normalized;
    }
    if (is_object($value)) {
        return normalize_snapshot_value((array) $value);
    }
    return $value;
}

