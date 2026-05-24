<?php
/**
 * Shared snapshot helpers for the Playground push lab.
 *
 * These helpers intentionally cover only the fixture surface used by the lab:
 * marked posts, one plugin-owned option, and upload files under
 * wp-content/uploads/reprint-push.
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
        ],
    ];

    foreach (['reprint_push_plugin_payload'] as $option_name) {
        $value = get_option($option_name, null);
        if ($value === null) {
            continue;
        }
        $row = [
            'option_name' => $option_name,
            'option_value' => reprint_push_normalize_snapshot_value($value),
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
        reprint_push_export_fixture_files($snapshot, $fixture_root, 'wp-content/uploads/reprint-push');
    }

    ksort($snapshot['files']);
    ksort($snapshot['db']['wp_posts']);
    ksort($snapshot['db']['wp_options']);

    return $snapshot;
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
            if ($option_name !== 'reprint_push_plugin_payload') {
                throw new RuntimeException('Unsupported option for fixture apply: ' . $option_name);
            }
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
}

function reprint_push_apply_option_row(string $id, bool $is_delete, $value): void
{
    $option_name = reprint_push_option_name($id);
    if ($option_name !== 'reprint_push_plugin_payload') {
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
