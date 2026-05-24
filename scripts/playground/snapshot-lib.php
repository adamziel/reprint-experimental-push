<?php
/**
 * Shared snapshot helpers for the Playground push lab.
 *
 * These helpers intentionally cover only the fixture surface used by the lab:
 * marked posts, allowlisted plugin-owned options/postmeta, detection-only lab
 * plugin/table metadata, and upload files under wp-content/uploads/reprint-push.
 */

function reprint_push_export_snapshot(): array
{
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
            'wp_postmeta' => [],
            'wp_reprint_push_forms_lab' => [],
        ],
    ];

    foreach (reprint_push_allowed_plugin_option_names() as $option_name) {
        $value = get_option($option_name, null);
        if ($value === null) {
            continue;
        }
        $row = [
            'option_name' => $option_name,
            'option_value' => reprint_push_normalize_snapshot_value($value),
            '__pluginOwner' => 'forms',
        ];
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

    reprint_push_export_fixture_postmeta($snapshot);
    reprint_push_export_fixture_plugin_metadata($snapshot);
    reprint_push_export_fixture_custom_table($snapshot);
    reprint_push_add_fixture_plugin_owned_policy($snapshot);

    $fixture_root = WP_CONTENT_DIR . '/uploads/reprint-push';
    if (is_dir($fixture_root)) {
        reprint_push_export_fixture_files($snapshot, $fixture_root, 'wp-content/uploads/reprint-push');
    }

    ksort($snapshot['files']);
    ksort($snapshot['plugins']);
    ksort($snapshot['db']['wp_posts']);
    ksort($snapshot['db']['wp_options']);
    ksort($snapshot['db']['wp_postmeta']);
    ksort($snapshot['db']['wp_reprint_push_forms_lab']);

    return $snapshot;
}

function reprint_push_export_fixture_postmeta(array &$snapshot): void
{
    foreach (array_keys($snapshot['db']['wp_posts']) as $post_row_id) {
        $post_id = reprint_push_numeric_id($post_row_id, 'ID');
        $value = get_post_meta($post_id, reprint_push_forms_schema_meta_key(), true);
        if ($value === '') {
            continue;
        }
        $snapshot['db']['wp_postmeta'][reprint_push_postmeta_row_id($post_id, reprint_push_forms_schema_meta_key())] = [
            'post_id' => $post_id,
            'meta_key' => reprint_push_forms_schema_meta_key(),
            'meta_value' => reprint_push_normalize_snapshot_value($value),
            '__pluginOwner' => 'forms',
        ];
    }
}

function reprint_push_export_fixture_plugin_metadata(array &$snapshot): void
{
    $plugin_basename = 'reprint-push-forms-fixture/reprint-push-forms-fixture.php';
    $plugin_file = WP_PLUGIN_DIR . '/' . $plugin_basename;
    if (!is_file($plugin_file)) {
        return;
    }

    if (!function_exists('get_plugin_data')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    $plugin_data = get_plugin_data($plugin_file, false, false);
    $active_plugins = get_option('active_plugins', []);
    $snapshot['plugins']['reprint-push-forms-fixture'] = [
        'name' => (string) ($plugin_data['Name'] ?: 'Reprint Push Forms Fixture'),
        'version' => (string) ($plugin_data['Version'] ?: ''),
        'pluginFile' => $plugin_basename,
        'active' => in_array($plugin_basename, is_array($active_plugins) ? $active_plugins : [], true),
        '__pluginOwner' => 'forms',
    ];
}

function reprint_push_export_fixture_custom_table(array &$snapshot): void
{
    global $wpdb;

    $table_name = $wpdb->prefix . 'reprint_push_forms_lab';
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists !== $table_name) {
        return;
    }

    $rows = $wpdb->get_results(
        "SELECT id, form_slug, payload_json, updated_marker FROM {$table_name} ORDER BY id ASC",
        ARRAY_A
    );

    foreach ($rows as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        $snapshot['db']['wp_reprint_push_forms_lab']['id:' . (int) $row['id']] = [
            'id' => (int) $row['id'],
            'form_slug' => (string) $row['form_slug'],
            'payload' => json_last_error() === JSON_ERROR_NONE
                ? reprint_push_normalize_snapshot_value($payload)
                : (string) $row['payload_json'],
            'updated_marker' => (string) $row['updated_marker'],
            '__pluginOwner' => 'forms',
        ];
    }
}

function reprint_push_add_fixture_plugin_owned_policy(array &$snapshot): void
{
    $allowed_resources = [];
    foreach (array_keys($snapshot['db']['wp_options']) as $row_id) {
        $option_name = reprint_push_option_name($row_id);
        if (!in_array($option_name, reprint_push_allowed_plugin_option_names(), true)) {
            continue;
        }
        $allowed_resources[] = [
            'resourceKey' => 'row:' . wp_json_encode(['wp_options', $row_id], JSON_UNESCAPED_SLASHES),
            'pluginOwner' => 'forms',
            'driver' => 'wp-option',
        ];
    }
    foreach (array_keys($snapshot['db']['wp_postmeta']) as $row_id) {
        reprint_push_parse_postmeta_row_id($row_id);
        $allowed_resources[] = [
            'resourceKey' => 'row:' . wp_json_encode(['wp_postmeta', $row_id], JSON_UNESCAPED_SLASHES),
            'pluginOwner' => 'forms',
            'driver' => 'wp-postmeta',
        ];
    }

    usort($allowed_resources, static function (array $left, array $right): int {
        return strcmp((string) $left['resourceKey'], (string) $right['resourceKey']);
    });

    $snapshot['meta']['pluginOwnedResources'] = [
        'allowedResources' => $allowed_resources,
    ];
}

function reprint_push_export_fixture_files(array &$snapshot, string $root, string $relative_root): void
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

function reprint_push_normalize_snapshot_value($value)
{
    if (is_array($value)) {
        $normalized = [];
        foreach ($value as $key => $inner_value) {
            $normalized[(string) $key] = reprint_push_normalize_snapshot_value($inner_value);
        }
        ksort($normalized);
        return $normalized;
    }
    if (is_object($value)) {
        return reprint_push_normalize_snapshot_value((array) $value);
    }
    return $value;
}

function reprint_push_hash_resource(array $snapshot, array $resource): string
{
    $resource_value = reprint_push_get_resource($snapshot, $resource);
    if (!$resource_value['exists']) {
        return hash('sha256', '"__REPRINT_PUSH_ABSENT__"');
    }
    return hash('sha256', reprint_push_stable_json($resource_value['value']));
}

function reprint_push_get_resource(array $snapshot, array $resource): array
{
    $type = $resource['type'] ?? null;
    if ($type === 'file') {
        $path = (string) ($resource['path'] ?? '');
        if (!array_key_exists($path, $snapshot['files'] ?? [])) {
            return ['exists' => false, 'value' => null];
        }
        $value = $snapshot['files'][$path];
        if (is_string($value)) {
            $value = ['type' => 'file', 'content' => $value];
        }
        return ['exists' => true, 'value' => $value];
    }
    if ($type === 'row') {
        $table = (string) ($resource['table'] ?? '');
        $id = (string) ($resource['id'] ?? '');
        if (!array_key_exists($id, $snapshot['db'][$table] ?? [])) {
            return ['exists' => false, 'value' => null];
        }
        return ['exists' => true, 'value' => $snapshot['db'][$table][$id]];
    }
    if ($type === 'plugin') {
        $name = (string) ($resource['name'] ?? '');
        if (!array_key_exists($name, $snapshot['plugins'] ?? [])) {
            return ['exists' => false, 'value' => null];
        }
        return ['exists' => true, 'value' => $snapshot['plugins'][$name]];
    }
    throw new RuntimeException('Unsupported resource type: ' . (string) $type);
}

function reprint_push_apply_resource(array $resource, array $payload): void
{
    reprint_push_assert_supported_apply_resource($resource);

    $type = $resource['type'] ?? null;
    $is_delete = !empty($payload['absent']);
    $value = $payload['value'] ?? null;

    if ($type === 'file') {
        reprint_push_apply_file_resource((string) $resource['path'], $is_delete, $value);
        return;
    }
    if ($type === 'row') {
        reprint_push_apply_row_resource((string) $resource['table'], (string) $resource['id'], $is_delete, $value);
        return;
    }

    throw new RuntimeException('Unsupported apply resource type: ' . (string) $type);
}

function reprint_push_assert_supported_apply_resource(array $resource): void
{
    $type = $resource['type'] ?? null;
    if ($type === 'file') {
        $path = (string) ($resource['path'] ?? '');
        if (!reprint_push_is_fixture_upload_path($path)) {
            throw new RuntimeException('Refusing to apply file outside fixture uploads: ' . $path);
        }
        return;
    }
    if ($type === 'row') {
        $table = (string) ($resource['table'] ?? '');
        $id = (string) ($resource['id'] ?? '');
        if ($table === 'wp_posts') {
            reprint_push_numeric_id($id, 'ID');
            return;
        }
        if ($table === 'wp_options') {
            $option_name = reprint_push_option_name($id);
            if (!in_array($option_name, reprint_push_allowed_plugin_option_names(), true)) {
                throw new RuntimeException('Unsupported option for fixture apply: ' . $option_name);
            }
            return;
        }
        if ($table === 'wp_postmeta') {
            reprint_push_parse_postmeta_row_id($id);
            return;
        }
        throw new RuntimeException('Unsupported apply table: ' . $table);
    }
    throw new RuntimeException('Unsupported apply resource type: ' . (string) $type);
}

function reprint_push_apply_file_resource(string $relative_path, bool $is_delete, $value): void
{
    if (!reprint_push_is_fixture_upload_path($relative_path)) {
        throw new RuntimeException('Refusing to write outside fixture uploads: ' . $relative_path);
    }

    $absolute_path = WP_CONTENT_DIR . substr($relative_path, strlen('wp-content'));
    if ($is_delete) {
        if (file_exists($absolute_path) && !unlink($absolute_path)) {
            throw new RuntimeException('Could not delete file: ' . $relative_path);
        }
        return;
    }

    $contents = is_array($value) && ($value['type'] ?? null) === 'file'
        ? (string) ($value['content'] ?? '')
        : (string) $value;

    $dir = dirname($absolute_path);
    if (!is_dir($dir) && !wp_mkdir_p($dir)) {
        throw new RuntimeException('Could not create directory: ' . $dir);
    }
    if (file_put_contents($absolute_path, $contents) === false) {
        throw new RuntimeException('Could not write file: ' . $relative_path);
    }
}

function reprint_push_apply_row_resource(string $table, string $id, bool $is_delete, $value): void
{
    if ($table === 'wp_posts') {
        reprint_push_apply_post_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_options') {
        reprint_push_apply_option_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_postmeta') {
        reprint_push_apply_postmeta_row($id, $is_delete, $value);
        return;
    }
    throw new RuntimeException('Unsupported table: ' . $table);
}

function reprint_push_apply_post_row(string $id, bool $is_delete, $value): void
{
    $post_id = reprint_push_numeric_id($id, 'ID');
    $existing_post = get_post($post_id);

    if ($existing_post && !reprint_push_is_fixture_post($post_id)) {
        throw new RuntimeException('Refusing to mutate non-fixture post: ' . $id);
    }

    if ($is_delete) {
        if ($existing_post) {
            wp_delete_post($post_id, true);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Post row payload must be an object');
    }

    $post_data = [
        'ID' => $post_id,
        'post_title' => (string) ($value['post_title'] ?? ''),
        'post_name' => (string) ($value['post_name'] ?? ''),
        'post_content' => (string) ($value['post_content'] ?? ''),
        'post_status' => (string) ($value['post_status'] ?? 'draft'),
        'post_type' => (string) ($value['post_type'] ?? 'post'),
        'post_parent' => (int) ($value['post_parent'] ?? 0),
        'post_author' => (int) ($value['post_author'] ?? 1),
    ];

    if ($existing_post) {
        $result = wp_update_post($post_data, true);
    } else {
        unset($post_data['ID']);
        $post_data['import_id'] = $post_id;
        $result = wp_insert_post($post_data, true);
    }

    if (is_wp_error($result)) {
        throw new RuntimeException('Could not apply post row: ' . $result->get_error_message());
    }
    if ((int) $result !== $post_id) {
        throw new RuntimeException('Could not create post at fixture ID: ' . $id);
    }

    $fixture = $post_data['post_name'] === 'local-only-draft' ? 'local-only' : 'shared';
    update_post_meta($post_id, 'reprint_push_fixture', $fixture);
    reprint_push_flush_deferred_postmeta_for_post($post_id);
}

function reprint_push_apply_option_row(string $id, bool $is_delete, $value): void
{
    $option_name = reprint_push_option_name($id);
    if (!in_array($option_name, reprint_push_allowed_plugin_option_names(), true)) {
        throw new RuntimeException('Refusing to mutate non-fixture option: ' . $option_name);
    }

    if ($is_delete) {
        delete_option($option_name);
        return;
    }
    if (!is_array($value) || !array_key_exists('option_value', $value)) {
        throw new RuntimeException('Option row payload must include option_value');
    }
    update_option($option_name, $value['option_value']);
}

function reprint_push_apply_postmeta_row(string $id, bool $is_delete, $value): void
{
    [$post_id, $meta_key] = reprint_push_parse_postmeta_row_id($id);
    $post = get_post($post_id);

    if ($post && !reprint_push_is_fixture_post($post_id)) {
        throw new RuntimeException('Refusing to mutate postmeta for non-fixture post: ' . $id);
    }

    if ($is_delete) {
        if ($post) {
            delete_post_meta($post_id, $meta_key);
        }
        return;
    }

    if (!$post) {
        reprint_push_defer_postmeta_row($id, $post_id, $meta_key, $value);
        return;
    }

    if (!reprint_push_is_fixture_post($post_id)) {
        throw new RuntimeException('Refusing to mutate postmeta without fixture-marked parent post: ' . $id);
    }
    reprint_push_update_fixture_postmeta($id, $post_id, $meta_key, $value);
}

function reprint_push_update_fixture_postmeta(string $id, int $post_id, string $meta_key, $value): void
{
    if (!is_array($value) || !array_key_exists('meta_value', $value)) {
        throw new RuntimeException('Postmeta row payload must include meta_value');
    }
    if ((int) ($value['post_id'] ?? 0) !== $post_id || (string) ($value['meta_key'] ?? '') !== $meta_key) {
        throw new RuntimeException('Postmeta row payload does not match row id: ' . $id);
    }

    update_post_meta($post_id, $meta_key, $value['meta_value']);
}

function reprint_push_defer_postmeta_row(string $id, int $post_id, string $meta_key, $value): void
{
    if (!is_array($value) || !array_key_exists('meta_value', $value)) {
        throw new RuntimeException('Postmeta row payload must include meta_value');
    }
    if ((int) ($value['post_id'] ?? 0) !== $post_id || (string) ($value['meta_key'] ?? '') !== $meta_key) {
        throw new RuntimeException('Postmeta row payload does not match row id: ' . $id);
    }

    $rows =& reprint_push_deferred_postmeta_rows();
    $rows[$id] = [
        'post_id' => $post_id,
        'meta_key' => $meta_key,
        'value' => $value,
    ];
}

function reprint_push_flush_deferred_postmeta_for_post(int $post_id): void
{
    if (!reprint_push_is_fixture_post($post_id)) {
        return;
    }

    $rows =& reprint_push_deferred_postmeta_rows();
    foreach ($rows as $id => $row) {
        if ((int) $row['post_id'] !== $post_id) {
            continue;
        }
        reprint_push_update_fixture_postmeta((string) $id, $post_id, (string) $row['meta_key'], $row['value']);
        unset($rows[$id]);
    }
}

function &reprint_push_deferred_postmeta_rows(): array
{
    static $rows = [];
    return $rows;
}

function reprint_push_is_fixture_post(int $post_id): bool
{
    return get_post_meta($post_id, 'reprint_push_fixture', true) !== '';
}

function reprint_push_is_fixture_upload_path(string $relative_path): bool
{
    if (!str_starts_with($relative_path, 'wp-content/uploads/reprint-push/')) {
        return false;
    }
    if (str_contains($relative_path, '\\')) {
        return false;
    }

    $segments = explode('/', $relative_path);
    foreach ($segments as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..') {
            return false;
        }
    }

    return true;
}

function reprint_push_numeric_id(string $id, string $prefix): int
{
    $expected = $prefix . ':';
    if (!str_starts_with($id, $expected)) {
        throw new RuntimeException('Unsupported row id: ' . $id);
    }
    return (int) substr($id, strlen($expected));
}

function reprint_push_option_name(string $id): string
{
    $expected = 'option_name:';
    if (!str_starts_with($id, $expected)) {
        throw new RuntimeException('Unsupported option id: ' . $id);
    }
    return substr($id, strlen($expected));
}

function reprint_push_allowed_plugin_option_names(): array
{
    return [
        'reprint_push_plugin_payload',
        'reprint_push_forms_fixture',
    ];
}

function reprint_push_forms_schema_meta_key(): string
{
    return '_reprint_push_forms_schema';
}

function reprint_push_postmeta_row_id(int $post_id, string $meta_key): string
{
    return 'post_id:' . $post_id . ':meta_key:' . $meta_key;
}

function reprint_push_parse_postmeta_row_id(string $id): array
{
    if (!preg_match('/^post_id:(\d+):meta_key:(.+)$/', $id, $matches)) {
        throw new RuntimeException('Unsupported postmeta id: ' . $id);
    }
    $post_id = (int) $matches[1];
    $meta_key = $matches[2];
    if ($post_id <= 0 || $meta_key !== reprint_push_forms_schema_meta_key()) {
        throw new RuntimeException('Unsupported postmeta id: ' . $id);
    }
    return [$post_id, $meta_key];
}

function reprint_push_stable_json($value): string
{
    return json_encode(reprint_push_sort_for_json($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function reprint_push_sort_for_json($value)
{
    if (is_object($value)) {
        $value = (array) $value;
    }
    if (is_array($value)) {
        if (array_keys($value) === range(0, count($value) - 1)) {
            return array_map('reprint_push_sort_for_json', $value);
        }
        ksort($value);
        $sorted = [];
        foreach ($value as $key => $inner_value) {
            $sorted[(string) $key] = reprint_push_sort_for_json($inner_value);
        }
        return $sorted;
    }
    return $value;
}
