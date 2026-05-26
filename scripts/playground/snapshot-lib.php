<?php
/**
 * Shared snapshot helpers for the Playground push lab.
 *
 * These helpers intentionally cover only the fixture surface used by the lab:
 * marked posts, allowlisted plugin-owned options/postmeta, fixture-scoped lab
 * plugin/table metadata, named lab plugin files, and upload files under
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
            'wp_postmeta' => [],
            'wp_reprint_push_forms_lab' => [],
        ],
    ];

    foreach (reprint_push_allowed_plugin_options() as $option_name => $plugin_owner) {
        $value = get_option($option_name, null);
        if ($value === null) {
            continue;
        }
        $row = [
            'option_name' => $option_name,
            'option_value' => reprint_push_normalize_snapshot_value($value),
            '__pluginOwner' => $plugin_owner,
        ];
        $snapshot['db']['wp_options']['option_name:' . $option_name] = $row;
    }

    $posts = $wpdb->get_results(
        "SELECT p.ID, p.post_title, p.post_name, p.post_content, p.post_status, p.post_type, p.post_parent, p.post_author
         FROM {$wpdb->posts} p
         INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
         WHERE pm.meta_key = 'reprint_push_fixture'
           AND pm.meta_value <> ''
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
    reprint_push_export_plugin_owned_row_driver_tables($snapshot);
    reprint_push_add_plugin_owned_policy($snapshot);

    $fixture_root = WP_CONTENT_DIR . '/uploads/reprint-push';
    if (is_dir($fixture_root)) {
        reprint_push_export_fixture_files($snapshot, $fixture_root, 'wp-content/uploads/reprint-push');
    }

    ksort($snapshot['files']);
    ksort($snapshot['plugins']);
    foreach ($snapshot['db'] as $table => $rows) {
        if (is_array($rows)) {
            ksort($snapshot['db'][$table]);
        }
    }
    ksort($snapshot['db']);

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
    if (!function_exists('get_plugin_data')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    $active_plugins = get_option('active_plugins', []);
    $active_plugins = is_array($active_plugins) ? $active_plugins : [];

    foreach (reprint_push_allowed_fixture_plugins() as $slug => $plugin) {
        $plugin_basename = $slug . '/' . $slug . '.php';
        $plugin_file = WP_PLUGIN_DIR . '/' . $plugin_basename;
        if (!is_file($plugin_file)) {
            continue;
        }

        $plugin_data = get_plugin_data($plugin_file, false, false);
        $snapshot['plugins'][$slug] = [
            'name' => (string) ($plugin_data['Name'] ?: $plugin['name']),
            'version' => (string) ($plugin_data['Version'] ?: ''),
            'pluginFile' => $plugin_basename,
            'active' => in_array($plugin_basename, $active_plugins, true),
            '__pluginOwner' => $plugin['owner'],
        ];

        foreach (reprint_push_allowed_fixture_plugin_file_paths($slug) as $relative_path) {
            reprint_push_export_fixture_file($snapshot, WP_CONTENT_DIR . substr($relative_path, strlen('wp-content')), $relative_path);
        }
    }
}

function reprint_push_export_plugin_owned_row_driver_tables(array &$snapshot): void
{
    foreach (reprint_push_plugin_owned_row_drivers() as $driver) {
        $export_callback = $driver['exportRowsCallback'] ?? null;
        if (!is_callable($export_callback)) {
            $table = (string) ($driver['table'] ?? '');
            throw new RuntimeException('Plugin-owned driver is missing exportRowsCallback for table: ' . $table);
        }
        $table = (string) ($driver['table'] ?? '');
        if ($table !== '' && !array_key_exists($table, $snapshot['db'])) {
            $snapshot['db'][$table] = [];
        }
        $export_callback($snapshot, $driver);
    }
}

function reprint_push_export_fixture_custom_table(array &$snapshot): void
{
    reprint_push_export_forms_lab_driver_rows($snapshot, reprint_push_default_forms_lab_driver());
}

function reprint_push_export_forms_lab_driver_rows(array &$snapshot, array $driver): void
{
    global $wpdb;

    $table_name = reprint_push_forms_lab_table_name();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists !== $table_name) {
        return;
    }

    $table = (string) ($driver['table'] ?? 'wp_reprint_push_forms_lab');
    if (!isset($snapshot['db'][$table]) || !is_array($snapshot['db'][$table])) {
        $snapshot['db'][$table] = [];
    }

    $rows = $wpdb->get_results(
        "SELECT id, form_slug, payload_json, updated_marker FROM {$table_name} ORDER BY id ASC",
        ARRAY_A
    );

    foreach ($rows as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        $snapshot['db'][$table]['id:' . (int) $row['id']] = [
            'id' => (int) $row['id'],
            'form_slug' => (string) $row['form_slug'],
            'payload' => json_last_error() === JSON_ERROR_NONE
                ? reprint_push_normalize_snapshot_value($payload)
                : (string) $row['payload_json'],
            'updated_marker' => (string) $row['updated_marker'],
            '__pluginOwner' => (string) ($driver['pluginOwner'] ?? 'forms'),
        ];
    }
}

function reprint_push_add_plugin_owned_policy(array &$snapshot): void
{
    $allowed_resources = [];
    foreach (array_keys($snapshot['db']['wp_options']) as $row_id) {
        $option_name = reprint_push_option_name($row_id);
        if (!in_array($option_name, reprint_push_allowed_plugin_option_names(), true)) {
            continue;
        }
        $allowed_resources[] = [
            'resourceKey' => 'row:' . wp_json_encode(['wp_options', $row_id], JSON_UNESCAPED_SLASHES),
            'pluginOwner' => reprint_push_allowed_plugin_options()[$option_name] ?? 'forms',
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

    foreach (reprint_push_plugin_owned_row_drivers() as $driver) {
        $table = (string) ($driver['table'] ?? '');
        if ($table === '' || !isset($snapshot['db'][$table]) || !is_array($snapshot['db'][$table])) {
            continue;
        }
        foreach (array_keys($snapshot['db'][$table]) as $row_id) {
            $allowed_resources[] = reprint_push_plugin_owned_driver_allowed_resource($driver, $row_id);
        }
    }

    usort($allowed_resources, static function (array $left, array $right): int {
        return strcmp((string) $left['resourceKey'], (string) $right['resourceKey']);
    });

    $snapshot['meta']['pluginOwnedResources'] = [
        'allowedResources' => $allowed_resources,
    ];
}

function reprint_push_add_fixture_plugin_owned_policy(array &$snapshot): void
{
    reprint_push_add_plugin_owned_policy($snapshot);
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

function reprint_push_export_fixture_file(array &$snapshot, string $absolute_path, string $relative_path): void
{
    if (!is_file($absolute_path)) {
        return;
    }
    $snapshot['files'][$relative_path] = file_get_contents($absolute_path);
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
    if ($type === 'plugin') {
        reprint_push_apply_plugin_resource((string) $resource['name'], $is_delete, $value);
        return;
    }

    throw new RuntimeException('Unsupported apply resource type: ' . (string) $type);
}

function reprint_push_apply_resource_with_storage_guard(array $resource, array $payload, array $expected_resource_value, ?array $expected_storage_value = null): array
{
    if (($resource['type'] ?? null) === 'file') {
        return reprint_push_apply_file_resource_with_storage_guard($resource, $payload, $expected_resource_value, $expected_storage_value);
    }

    if (($resource['type'] ?? null) !== 'row' || !empty($payload['absent'])) {
        reprint_push_apply_resource($resource, $payload);
        return [
            'applied' => true,
            'storageGuard' => null,
        ];
    }

    if (($expected_resource_value['exists'] ?? false) !== true || !is_array($expected_resource_value['value'] ?? null)) {
        reprint_push_apply_resource($resource, $payload);
        return [
            'applied' => true,
            'storageGuard' => null,
        ];
    }

    $table = (string) ($resource['table'] ?? '');
    $id = (string) ($resource['id'] ?? '');
    $value = $payload['value'] ?? null;
    if (!is_array($value)) {
        reprint_push_apply_resource($resource, $payload);
        return [
            'applied' => true,
            'storageGuard' => null,
        ];
    }

    if ($table === 'wp_posts') {
        return reprint_push_guarded_update_existing_post_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
    }
    if ($table === 'wp_options') {
        return reprint_push_guarded_update_existing_option_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
    }
    if ($table === 'wp_postmeta') {
        return reprint_push_guarded_update_existing_postmeta_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
    }
    if ($table === 'wp_reprint_push_forms_lab') {
        return reprint_push_guarded_update_existing_forms_lab_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
    }

    reprint_push_apply_resource($resource, $payload);
    return [
        'applied' => true,
        'storageGuard' => null,
    ];
}

function reprint_push_guarded_update_existing_post_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    $post_id = reprint_push_numeric_id($id, 'ID');
    $columns = ['ID', 'post_title', 'post_name', 'post_content', 'post_status', 'post_type', 'post_parent', 'post_author'];
    foreach ($columns as $column) {
        if (!array_key_exists($column, $expected) || !array_key_exists($column, $value)) {
            throw new RuntimeException('Post row payload must include guarded column: ' . $column);
        }
    }

    $table = reprint_push_quote_identifier($wpdb->posts);
    $postmeta_table = reprint_push_quote_identifier($wpdb->postmeta);
    $expected_fixture_marker_id = (int) ($expected_storage_value['value']['fixture_marker_meta_id'] ?? 0);
    $expected_fixture_marker = (string) ($expected_storage_value['value']['fixture_marker_meta_value'] ?? '');
    $shape = "UPDATE {$table} SET post_title = %s, post_name = %s, post_content = %s, post_status = %s, post_type = %s, post_parent = %d, post_author = %d WHERE ID = %d AND post_title = %s AND post_name = %s AND post_content = %s AND post_status = %s AND post_type = %s AND post_parent = %d AND post_author = %d AND EXISTS (SELECT 1 FROM {$postmeta_table} reprint_push_fixture_marker WHERE reprint_push_fixture_marker.meta_id = %d AND reprint_push_fixture_marker.post_id = {$table}.ID AND reprint_push_fixture_marker.meta_key = %s AND reprint_push_fixture_marker.meta_value = %s AND reprint_push_fixture_marker.meta_value <> '')";
    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        (string) $value['post_title'],
        (string) $value['post_name'],
        (string) $value['post_content'],
        (string) $value['post_status'],
        (string) $value['post_type'],
        (int) $value['post_parent'],
        (int) $value['post_author'],
        $post_id,
        (string) $expected['post_title'],
        (string) $expected['post_name'],
        (string) $expected['post_content'],
        (string) $expected['post_status'],
        (string) $expected['post_type'],
        (int) $expected['post_parent'],
        (int) $expected['post_author'],
        $expected_fixture_marker_id,
        'reprint_push_fixture',
        $expected_fixture_marker
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded post row update: ' . $wpdb->last_error);
    }
    if ((int) $rows === 1) {
        clean_post_cache($post_id);
    }

    return reprint_push_storage_guard_result('wp-post', 'wp_posts', $wpdb->posts, 'update', array_merge($columns, ['fixture_marker']), $expected, $expected_storage_value['value'] ?? $expected, $rows, $shape);
}

function reprint_push_guarded_update_existing_option_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    $option_name = reprint_push_option_name($id);
    if (!in_array($option_name, reprint_push_allowed_plugin_option_names(), true)) {
        throw new RuntimeException('Refusing to mutate non-fixture option: ' . $option_name);
    }
    if (!array_key_exists('option_value', $expected) || !array_key_exists('option_value', $value)) {
        throw new RuntimeException('Option row payload must include option_value');
    }

    $expected_storage = [
        'option_name' => $option_name,
        'option_value' => maybe_serialize($expected['option_value']),
    ];
    if (($expected_storage_value['exists'] ?? false) === true && is_array($expected_storage_value['value'] ?? null)) {
        $expected_storage = $expected_storage_value['value'];
    }
    $table = reprint_push_quote_identifier($wpdb->options);
    $shape = "UPDATE {$table} SET option_value = %s WHERE option_name = %s AND option_value = %s";
    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        maybe_serialize($value['option_value']),
        $option_name,
        $expected_storage['option_value']
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded option row update: ' . $wpdb->last_error);
    }
    if ((int) $rows === 1) {
        wp_cache_delete($option_name, 'options');
        wp_cache_delete('alloptions', 'options');
        wp_cache_delete('notoptions', 'options');
    }

    return reprint_push_storage_guard_result('wp-option', 'wp_options', $wpdb->options, 'update', ['option_name', 'option_value'], $expected, $expected_storage, $rows, $shape);
}

function reprint_push_guarded_update_existing_postmeta_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    [$post_id, $meta_key] = reprint_push_parse_postmeta_row_id($id);
    if ((int) ($expected['post_id'] ?? 0) !== $post_id
        || (string) ($expected['meta_key'] ?? '') !== $meta_key
        || !array_key_exists('meta_value', $expected)
        || !array_key_exists('meta_value', $value)
        || (int) ($value['post_id'] ?? 0) !== $post_id
        || (string) ($value['meta_key'] ?? '') !== $meta_key
    ) {
        throw new RuntimeException('Postmeta row payload does not match row id: ' . $id);
    }

    $expected_storage = [
        'post_id' => $post_id,
        'meta_key' => $meta_key,
        'meta_value' => maybe_serialize($expected['meta_value']),
    ];
    if (($expected_storage_value['exists'] ?? false) === true && is_array($expected_storage_value['value'] ?? null)) {
        $expected_storage = $expected_storage_value['value'];
    }
    $table = reprint_push_quote_identifier($wpdb->postmeta);
    $posts_table = reprint_push_quote_identifier($wpdb->posts);
    $expected_parent_fixture_marker_id = (int) ($expected_storage['parent_fixture_marker_meta_id'] ?? 0);
    $expected_parent_fixture_marker = (string) ($expected_storage['parent_fixture_marker_meta_value'] ?? '');
    $shape = "UPDATE {$table} SET meta_value = %s WHERE post_id = %d AND meta_key = %s AND meta_value = %s AND (SELECT COUNT(*) FROM (SELECT meta_id FROM {$table} WHERE post_id = %d AND meta_key = %s) AS reprint_push_guard_postmeta_count) = 1 AND (SELECT COUNT(*) FROM (SELECT marker.meta_id FROM {$table} marker INNER JOIN {$posts_table} p ON p.ID = marker.post_id WHERE marker.meta_id = %d AND p.ID = %d AND marker.meta_key = %s AND marker.meta_value = %s AND marker.meta_value <> '') AS reprint_push_guard_parent_marker_count) >= 1";
    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        maybe_serialize($value['meta_value']),
        $post_id,
        $meta_key,
        $expected_storage['meta_value'],
        $post_id,
        $meta_key,
        $expected_parent_fixture_marker_id,
        $post_id,
        'reprint_push_fixture',
        $expected_parent_fixture_marker
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded postmeta row update: ' . $wpdb->last_error);
    }
    if ((int) $rows === 1) {
        wp_cache_delete($post_id, 'post_meta');
    }

    return reprint_push_storage_guard_result('wp-postmeta', 'wp_postmeta', $wpdb->postmeta, 'update', ['post_id', 'meta_key', 'meta_value', 'parent_fixture_marker'], $expected, $expected_storage, $rows, $shape);
}

function reprint_push_guarded_update_existing_forms_lab_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    reprint_push_validate_forms_lab_row_value($id, $value);
    $row_id = reprint_push_forms_lab_row_id($id);
    if ((int) ($expected['id'] ?? 0) !== $row_id) {
        throw new RuntimeException('Forms lab expected row does not match row id: ' . $id);
    }

    $table_name = reprint_push_forms_lab_table_name();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    $expected_payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($expected['payload'] ?? null));
    $payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($value['payload'] ?? null));
    if (!is_string($expected_payload_json) || !is_string($payload_json)) {
        throw new RuntimeException('Could not encode forms lab row payload: ' . $id);
    }

    $expected_storage = [
        'id' => $row_id,
        'form_slug' => (string) ($expected['form_slug'] ?? ''),
        'payload_json' => $expected_payload_json,
        'updated_marker' => (string) ($expected['updated_marker'] ?? ''),
    ];
    if (($expected_storage_value['exists'] ?? false) === true && is_array($expected_storage_value['value'] ?? null)) {
        $expected_storage = $expected_storage_value['value'];
    }
    $table = reprint_push_quote_identifier($table_name);
    $shape = "UPDATE {$table} SET form_slug = %s, payload_json = %s, updated_marker = %s WHERE id = %d AND form_slug = %s AND payload_json = %s AND updated_marker = %s";
    if ($exists !== $table_name) {
        return reprint_push_storage_guard_result('fixture-forms-lab-table', 'wp_reprint_push_forms_lab', $table_name, 'update', ['id', 'form_slug', 'payload_json', 'updated_marker'], $expected, $expected_storage, 0, $shape);
    }
    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        (string) $value['form_slug'],
        $payload_json,
        (string) $value['updated_marker'],
        $row_id,
        $expected_storage['form_slug'],
        $expected_storage['payload_json'],
        $expected_storage['updated_marker']
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded forms lab row update: ' . $wpdb->last_error);
    }

    return reprint_push_storage_guard_result('fixture-forms-lab-table', 'wp_reprint_push_forms_lab', $table_name, 'update', ['id', 'form_slug', 'payload_json', 'updated_marker'], $expected, $expected_storage, $rows, $shape);
}

function reprint_push_storage_guard_result(
    string $driver,
    string $logical_table,
    string $physical_table,
    string $operation,
    array $compared_columns,
    array $expected_resource,
    array $expected_storage,
    $rows,
    string $sql_shape
): array {
    $affected = (int) $rows;
    return [
        'applied' => $affected === 1,
        'storageGuard' => [
            'boundary' => 'wpdb-single-statement-cas',
            'driver' => $driver,
            'logicalTable' => $logical_table,
            'physicalTable' => $physical_table,
            'operation' => $operation,
            'comparedColumns' => array_values($compared_columns),
            'expectedResourceHash' => hash('sha256', reprint_push_stable_json(reprint_push_normalize_snapshot_value($expected_resource))),
            'expectedStorageHash' => hash('sha256', reprint_push_stable_json(reprint_push_normalize_snapshot_value($expected_storage))),
            'rowsAffected' => $affected,
            'outcome' => $affected === 1 ? 'applied' : 'stale-at-write',
            'sqlShapeHash' => hash('sha256', $sql_shape),
        ],
    ];
}

function reprint_push_quote_identifier(string $identifier): string
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $identifier)) {
        throw new RuntimeException('Unsafe SQL identifier for fixture write.');
    }
    return '`' . $identifier . '`';
}

function reprint_push_get_storage_resource(array $resource): array
{
    global $wpdb;

    if (($resource['type'] ?? null) === 'file') {
        return reprint_push_get_file_storage_resource((string) ($resource['path'] ?? ''));
    }

    if (($resource['type'] ?? null) !== 'row') {
        return ['exists' => false, 'value' => null];
    }

    $table = (string) ($resource['table'] ?? '');
    $id = (string) ($resource['id'] ?? '');
    if ($table === 'wp_posts') {
        $post_id = reprint_push_numeric_id($id, 'ID');
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT ID, post_title, post_name, post_content, post_status, post_type, post_parent, post_author FROM {$wpdb->posts} WHERE ID = %d",
                $post_id
            ),
            ARRAY_A
        );
        if (!is_array($row)) {
            return ['exists' => false, 'value' => null];
        }
        $row['ID'] = (int) $row['ID'];
        $row['post_parent'] = (int) $row['post_parent'];
        $row['post_author'] = (int) $row['post_author'];
        $marker = reprint_push_fixture_marker_storage_row($post_id);
        $row['fixture_marker_meta_id'] = is_array($marker) ? (int) $marker['meta_id'] : 0;
        $row['fixture_marker_meta_value'] = is_array($marker) ? (string) $marker['meta_value'] : '';
        return ['exists' => true, 'value' => $row];
    }
    if ($table === 'wp_options') {
        $option_name = reprint_push_option_name($id);
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name = %s",
                $option_name
            ),
            ARRAY_A
        );
        return is_array($row) ? ['exists' => true, 'value' => $row] : ['exists' => false, 'value' => null];
    }
    if ($table === 'wp_postmeta') {
        [$post_id, $meta_key] = reprint_push_parse_postmeta_row_id($id);
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id ASC",
                $post_id,
                $meta_key
            ),
            ARRAY_A
        ) ?: [];
        if (count($rows) !== 1) {
            return ['exists' => false, 'value' => null, 'rowCount' => count($rows)];
        }
        $rows[0]['post_id'] = (int) $rows[0]['post_id'];
        $marker = reprint_push_fixture_marker_storage_row($post_id);
        $rows[0]['parent_fixture_marker_meta_id'] = is_array($marker) ? (int) $marker['meta_id'] : 0;
        $rows[0]['parent_fixture_marker_meta_value'] = is_array($marker) ? (string) $marker['meta_value'] : '';
        return ['exists' => true, 'value' => $rows[0], 'rowCount' => 1];
    }
    if ($table === 'wp_reprint_push_forms_lab') {
        $row_id = reprint_push_forms_lab_row_id($id);
        $table_name = reprint_push_forms_lab_table_name();
        $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
        if ($exists !== $table_name) {
            return ['exists' => false, 'value' => null];
        }
        $row = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT id, form_slug, payload_json, updated_marker FROM ' . reprint_push_quote_identifier($table_name) . ' WHERE id = %d',
                $row_id
            ),
            ARRAY_A
        );
        if (!is_array($row)) {
            return ['exists' => false, 'value' => null];
        }
        $row['id'] = (int) $row['id'];
        return ['exists' => true, 'value' => $row];
    }

    return ['exists' => false, 'value' => null];
}

function reprint_push_get_file_storage_resource(string $relative_path): array
{
    if (!reprint_push_is_fixture_file_guard_path($relative_path)) {
        return ['exists' => false, 'value' => null];
    }

    $absolute_path = reprint_push_fixture_file_absolute_path($relative_path);
    if (!is_file($absolute_path)) {
        return ['exists' => false, 'value' => null];
    }

    $contents = file_get_contents($absolute_path);
    if ($contents === false) {
        throw new RuntimeException('Could not read fixture file for guarded write: ' . $relative_path);
    }

    return [
        'exists' => true,
        'value' => [
            'type' => 'file',
            'content' => $contents,
        ],
    ];
}

function reprint_push_hash_storage_resource_value(array $storage_value): string
{
    if (($storage_value['exists'] ?? false) !== true) {
        return hash('sha256', '"__REPRINT_PUSH_ABSENT__"');
    }
    return hash('sha256', reprint_push_stable_json(reprint_push_normalize_snapshot_value($storage_value['value'] ?? null)));
}

function reprint_push_apply_file_resource_with_storage_guard(array $resource, array $payload, array $expected_resource_value, ?array $expected_storage_value = null): array
{
    $relative_path = (string) ($resource['path'] ?? '');
    $is_delete = !empty($payload['absent']);

    if (!reprint_push_is_fixture_file_guard_path($relative_path)) {
        reprint_push_apply_resource($resource, $payload);
        return [
            'applied' => true,
            'storageGuard' => null,
        ];
    }

    if ($expected_storage_value === null) {
        $expected_storage_value = $expected_resource_value;
    }

    $expected_resource_exists = ($expected_resource_value['exists'] ?? false) === true;
    $expected_storage_exists = ($expected_storage_value['exists'] ?? false) === true;
    $is_fixture_upload = reprint_push_is_fixture_upload_path($relative_path);

    if ($is_delete) {
        if (!$is_fixture_upload) {
            reprint_push_apply_resource($resource, $payload);
            return [
                'applied' => true,
                'storageGuard' => null,
            ];
        }

        $current_storage_value = reprint_push_get_file_storage_resource($relative_path);
        if (!$expected_resource_exists || !$expected_storage_exists) {
            return [
                'applied' => false,
                'storageGuard' => reprint_push_file_storage_guard_evidence(
                    $relative_path,
                    'delete',
                    $expected_resource_value,
                    $expected_storage_value,
                    $current_storage_value,
                    null,
                    'stale-at-write'
                ),
            ];
        }

        $expected_storage_hash = reprint_push_hash_storage_resource_value($expected_storage_value);
        $current_storage_hash = reprint_push_hash_storage_resource_value($current_storage_value);
        if ($current_storage_hash !== $expected_storage_hash) {
            return [
                'applied' => false,
                'storageGuard' => reprint_push_file_storage_guard_evidence(
                    $relative_path,
                    'delete',
                    $expected_resource_value,
                    $expected_storage_value,
                    $current_storage_value,
                    null,
                    'stale-at-write'
                ),
            ];
        }

        $absolute_path = reprint_push_fixture_file_absolute_path($relative_path);
        if (!unlink($absolute_path)) {
            throw new RuntimeException('Could not delete guarded fixture file: ' . $relative_path);
        }

        return [
            'applied' => true,
            'storageGuard' => reprint_push_file_storage_guard_evidence(
                $relative_path,
                'delete',
                $expected_resource_value,
                $expected_storage_value,
                $current_storage_value,
                null,
                'applied'
            ),
        ];
    }

    $value = $payload['value'] ?? null;
    $contents = is_array($value) && ($value['type'] ?? null) === 'file'
        ? (string) ($value['content'] ?? '')
        : (string) $value;

    if (!$expected_resource_exists || !$expected_storage_exists) {
        if (!$is_fixture_upload) {
            reprint_push_apply_resource($resource, $payload);
            return [
                'applied' => true,
                'storageGuard' => null,
            ];
        }

        $current_storage_value = reprint_push_get_file_storage_resource($relative_path);
        if ($expected_resource_exists || $expected_storage_exists) {
            return [
                'applied' => false,
                'storageGuard' => reprint_push_file_storage_guard_evidence(
                    $relative_path,
                    $expected_resource_exists ? 'update' : 'create',
                    $expected_resource_value,
                    $expected_storage_value,
                    $current_storage_value,
                    $contents,
                    'stale-at-write'
                ),
            ];
        }

        $expected_storage_hash = reprint_push_hash_storage_resource_value($expected_storage_value);
        $current_storage_hash = reprint_push_hash_storage_resource_value($current_storage_value);
        if ($current_storage_hash !== $expected_storage_hash) {
            return [
                'applied' => false,
                'storageGuard' => reprint_push_file_storage_guard_evidence(
                    $relative_path,
                    'create',
                    $expected_resource_value,
                    $expected_storage_value,
                    $current_storage_value,
                    $contents,
                    'stale-at-write'
                ),
            ];
        }

        reprint_push_write_fixture_file_via_temp_rename($relative_path, $contents, null);

        return [
            'applied' => true,
            'storageGuard' => reprint_push_file_storage_guard_evidence(
                $relative_path,
                'create',
                $expected_resource_value,
                $expected_storage_value,
                $current_storage_value,
                $contents,
                'applied'
            ),
        ];
    }

    $absolute_path = reprint_push_fixture_file_absolute_path($relative_path);
    $dir = dirname($absolute_path);
    if (!is_dir($dir) && !wp_mkdir_p($dir)) {
        throw new RuntimeException('Could not create fixture file directory for guarded write: ' . $relative_path);
    }

    $temp_path = tempnam($dir, '.reprint-push-');
    if ($temp_path === false) {
        throw new RuntimeException('Could not create temporary fixture file for guarded write: ' . $relative_path);
    }

    try {
        if (file_put_contents($temp_path, $contents) === false) {
            throw new RuntimeException('Could not write temporary fixture file for guarded write: ' . $relative_path);
        }
        $existing_mode = @fileperms($absolute_path);
        if (is_int($existing_mode)) {
            @chmod($temp_path, $existing_mode & 0777);
        }

        $current_storage_value = reprint_push_get_file_storage_resource($relative_path);
        $expected_storage_hash = reprint_push_hash_storage_resource_value($expected_storage_value);
        $current_storage_hash = reprint_push_hash_storage_resource_value($current_storage_value);
        if ($current_storage_hash !== $expected_storage_hash) {
            return [
                'applied' => false,
                'storageGuard' => reprint_push_file_storage_guard_evidence(
                    $relative_path,
                    'update',
                    $expected_resource_value,
                    $expected_storage_value,
                    $current_storage_value,
                    $contents,
                    'stale-at-write'
                ),
            ];
        }

        if (!rename($temp_path, $absolute_path)) {
            throw new RuntimeException('Could not replace fixture file with guarded write: ' . $relative_path);
        }
        $temp_path = null;

        return [
            'applied' => true,
            'storageGuard' => reprint_push_file_storage_guard_evidence(
                $relative_path,
                'update',
                $expected_resource_value,
                $expected_storage_value,
                $current_storage_value,
                $contents,
                'applied'
            ),
        ];
    } finally {
        if (is_string($temp_path) && $temp_path !== '' && file_exists($temp_path)) {
            @unlink($temp_path);
        }
    }
}

function reprint_push_write_fixture_file_via_temp_rename(string $relative_path, string $contents, ?int $mode): void
{
    $absolute_path = reprint_push_fixture_file_absolute_path($relative_path);
    $dir = dirname($absolute_path);
    if (!is_dir($dir) && !wp_mkdir_p($dir)) {
        throw new RuntimeException('Could not create fixture file directory for guarded write: ' . $relative_path);
    }

    $temp_path = tempnam($dir, '.reprint-push-');
    if ($temp_path === false) {
        throw new RuntimeException('Could not create temporary fixture file for guarded write: ' . $relative_path);
    }

    try {
        if (file_put_contents($temp_path, $contents) === false) {
            throw new RuntimeException('Could not write temporary fixture file for guarded write: ' . $relative_path);
        }
        if ($mode !== null) {
            @chmod($temp_path, $mode & 0777);
        }
        if (!rename($temp_path, $absolute_path)) {
            throw new RuntimeException('Could not replace fixture file with guarded write: ' . $relative_path);
        }
        $temp_path = null;
    } finally {
        if (is_string($temp_path) && $temp_path !== '' && file_exists($temp_path)) {
            @unlink($temp_path);
        }
    }
}

function reprint_push_file_storage_guard_evidence(
    string $relative_path,
    string $operation,
    array $expected_resource_value,
    array $expected_storage_value,
    array $current_storage_value,
    ?string $planned_contents,
    string $outcome
): array {
    return [
        'boundary' => $operation === 'delete' ? 'filesystem-compare-unlink' : 'filesystem-compare-rename',
        'driver' => reprint_push_is_fixture_upload_path($relative_path) ? 'fixture-upload-file' : 'fixture-plugin-file',
        'operation' => $operation,
        'logicalPath' => $relative_path,
        'physicalPathHash' => hash('sha256', reprint_push_fixture_file_absolute_path($relative_path)),
        'comparedFields' => ['file-bytes'],
        'expectedResourceHash' => reprint_push_hash_file_guard_resource_value($expected_resource_value),
        'expectedStorageHash' => reprint_push_hash_storage_resource_value($expected_storage_value),
        'actualStorageHash' => reprint_push_hash_storage_resource_value($current_storage_value),
        'plannedStorageHash' => reprint_push_hash_file_guard_planned_value($planned_contents),
        'outcome' => $outcome,
    ];
}

function reprint_push_hash_file_guard_resource_value(array $resource_value): string
{
    if (($resource_value['exists'] ?? false) !== true) {
        return hash('sha256', '"__REPRINT_PUSH_ABSENT__"');
    }
    return hash('sha256', reprint_push_stable_json(reprint_push_normalize_snapshot_value($resource_value['value'] ?? null)));
}

function reprint_push_hash_file_guard_planned_value(?string $planned_contents): string
{
    if ($planned_contents === null) {
        return hash('sha256', '"__REPRINT_PUSH_ABSENT__"');
    }
    return hash('sha256', reprint_push_stable_json([
        'content' => $planned_contents,
        'type' => 'file',
    ]));
}

function reprint_push_is_fixture_file_guard_path(string $relative_path): bool
{
    return reprint_push_is_fixture_upload_path($relative_path) || reprint_push_is_fixture_plugin_file_path($relative_path);
}

function reprint_push_fixture_marker_storage_row(int $post_id): ?array
{
    global $wpdb;

    $row = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id ASC LIMIT 1",
            $post_id,
            'reprint_push_fixture'
        ),
        ARRAY_A
    );
    return is_array($row) ? $row : null;
}

function reprint_push_assert_supported_apply_resource(array $resource): void
{
    $type = $resource['type'] ?? null;
    if ($type === 'file') {
        $path = (string) ($resource['path'] ?? '');
        if (!reprint_push_is_fixture_upload_path($path) && !reprint_push_is_fixture_plugin_file_path($path)) {
            throw new RuntimeException('Refusing to apply file outside fixture uploads or named lab plugins: ' . $path);
        }
        return;
    }
    if ($type === 'plugin') {
        reprint_push_assert_fixture_plugin_slug((string) ($resource['name'] ?? ''));
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
        if ($table === 'wp_reprint_push_forms_lab') {
            reprint_push_forms_lab_row_id($id);
            return;
        }
        $driver = reprint_push_plugin_owned_row_driver_for_table($table);
        if (is_array($driver)) {
            reprint_push_assert_plugin_owned_driver_row_id($driver, $id);
            return;
        }
        throw new RuntimeException('Unsupported apply table: ' . $table);
    }
    throw new RuntimeException('Unsupported apply resource type: ' . (string) $type);
}

function reprint_push_apply_file_resource(string $relative_path, bool $is_delete, $value): void
{
    if (!reprint_push_is_fixture_upload_path($relative_path) && !reprint_push_is_fixture_plugin_file_path($relative_path)) {
        throw new RuntimeException('Refusing to write outside fixture files: ' . $relative_path);
    }

    $absolute_path = reprint_push_fixture_file_absolute_path($relative_path);
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

function reprint_push_fixture_file_absolute_path(string $relative_path): string
{
    return WP_CONTENT_DIR . substr($relative_path, strlen('wp-content'));
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
    if ($table === 'wp_reprint_push_forms_lab') {
        reprint_push_apply_forms_lab_row($id, $is_delete, $value);
        return;
    }
    $driver = reprint_push_plugin_owned_row_driver_for_table($table);
    if (is_array($driver)) {
        $apply_callback = $driver['applyRowCallback'] ?? null;
        if (!is_callable($apply_callback)) {
            throw new RuntimeException('Plugin-owned driver is missing applyRowCallback for table: ' . $table);
        }
        $apply_callback($id, $is_delete, $value, $driver);
        return;
    }
    throw new RuntimeException('Unsupported table: ' . $table);
}

function reprint_push_apply_plugin_resource(string $slug, bool $is_delete, $value): void
{
    reprint_push_assert_fixture_plugin_slug($slug);
    $plugin_basename = $slug . '/' . $slug . '.php';

    if (!function_exists('activate_plugin')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    if ($is_delete) {
        deactivate_plugins([$plugin_basename], true);
        reprint_push_delete_fixture_plugin_dir($slug);
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Plugin resource payload must be an object');
    }
    if ((string) ($value['pluginFile'] ?? '') !== $plugin_basename) {
        throw new RuntimeException('Plugin resource payload does not match fixture plugin basename: ' . $slug);
    }
    $plugin_owner = reprint_push_allowed_fixture_plugins()[$slug]['owner'] ?? null;
    if (isset($value['__pluginOwner']) && (string) $value['__pluginOwner'] !== (string) $plugin_owner) {
        throw new RuntimeException('Plugin resource payload owner does not match fixture plugin: ' . $slug);
    }
    if (!is_file(WP_PLUGIN_DIR . '/' . $plugin_basename)) {
        throw new RuntimeException('Plugin main file is missing for fixture plugin: ' . $slug);
    }

    if (!empty($value['active'])) {
        $result = activate_plugin($plugin_basename);
        if (is_wp_error($result)) {
            throw new RuntimeException('Could not activate fixture plugin ' . $slug . ': ' . $result->get_error_message());
        }
        return;
    }

    deactivate_plugins([$plugin_basename], true);
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

function reprint_push_apply_forms_lab_row(string $id, bool $is_delete, $value, ?array $driver = null): void
{
    global $wpdb;

    $row_id = reprint_push_forms_lab_row_id($id);
    if ($is_delete) {
        throw new RuntimeException('Fixture forms lab table driver does not support deletes: ' . $id);
    }
    reprint_push_validate_forms_lab_row_value($id, $value);
    $form_slug = (string) ($value['form_slug'] ?? '');
    $updated_marker = (string) ($value['updated_marker'] ?? '');

    $table_name = reprint_push_forms_lab_table_name();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists !== $table_name) {
        $wpdb->query(
            'CREATE TABLE `' . $table_name . '` ' .
            '(id bigint(20) unsigned NOT NULL, form_slug varchar(191) NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (id)) ' .
            $wpdb->get_charset_collate()
        );
    }

    $payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($value['payload'] ?? null));
    if (!is_string($payload_json)) {
        throw new RuntimeException('Could not encode forms lab row payload: ' . $id);
    }

    $sql = $wpdb->prepare(
        'INSERT INTO `' . $table_name . '` (id, form_slug, payload_json, updated_marker)
         VALUES (%d, %s, %s, %s)
         ON DUPLICATE KEY UPDATE form_slug = VALUES(form_slug), payload_json = VALUES(payload_json), updated_marker = VALUES(updated_marker)',
        $row_id,
        $form_slug,
        $payload_json,
        $updated_marker
    );
    if ($wpdb->query($sql) === false) {
        throw new RuntimeException('Could not apply forms lab row: ' . $wpdb->last_error);
    }
}

function reprint_push_validate_forms_lab_row_value(string $id, $value): void
{
    $row_id = reprint_push_forms_lab_row_id($id);
    if (!is_array($value)) {
        throw new RuntimeException('Forms lab row payload must be an object');
    }
    $allowed_keys = ['id', 'form_slug', 'payload', 'updated_marker', '__pluginOwner'];
    foreach (array_keys($value) as $key) {
        if (!in_array($key, $allowed_keys, true)) {
            throw new RuntimeException('Unsupported forms lab row column: ' . (string) $key);
        }
    }
    if ((int) ($value['id'] ?? 0) !== $row_id) {
        throw new RuntimeException('Forms lab row payload does not match row id: ' . $id);
    }
    if ((string) ($value['__pluginOwner'] ?? '') !== 'forms') {
        throw new RuntimeException('Forms lab row payload owner does not match fixture driver: ' . $id);
    }
    if (!is_array($value['payload'] ?? null) || array_is_list($value['payload'])) {
        throw new RuntimeException('Forms lab row payload must include a deterministic object payload: ' . $id);
    }
    if ((string) ($value['payload']['owner'] ?? '') !== 'forms') {
        throw new RuntimeException('Forms lab row payload owner marker is invalid: ' . $id);
    }
    $form_slug = (string) ($value['form_slug'] ?? '');
    if (!in_array($form_slug, ['contact', 'newsletter', 'intake'], true)) {
        throw new RuntimeException('Unsupported forms lab row form_slug: ' . $form_slug);
    }
    $updated_marker = (string) ($value['updated_marker'] ?? '');
    if (!preg_match('/^[a-z0-9_-]{1,32}$/', $updated_marker)) {
        throw new RuntimeException('Unsupported forms lab row updated_marker: ' . $updated_marker);
    }
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

function reprint_push_forms_lab_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'id');
    if ($row_id < 1 || $id !== 'id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_forms_lab_table_name(): string
{
    global $wpdb;

    $prefix = (string) $wpdb->prefix;
    if (!preg_match('/^[A-Za-z0-9_]+$/', $prefix)) {
        throw new RuntimeException('Unsupported WordPress table prefix for fixture forms lab table.');
    }
    return $prefix . 'reprint_push_forms_lab';
}

function reprint_push_default_forms_lab_driver(): array
{
    return [
        'driver' => 'fixture-forms-lab-table',
        'table' => 'wp_reprint_push_forms_lab',
        'pluginOwner' => 'forms',
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_export_forms_lab_driver_rows',
        'applyRowCallback' => 'reprint_push_apply_forms_lab_row',
        'validateMutationCallback' => 'reprint_push_validate_forms_lab_driver_mutation',
    ];
}

function reprint_push_plugin_owned_row_drivers(): array
{
    static $drivers = null;
    if ($drivers !== null) {
        return $drivers;
    }

    $drivers = [
        'fixture-forms-lab-table' => reprint_push_default_forms_lab_driver(),
    ];
    if (function_exists('apply_filters')) {
        $drivers = apply_filters('reprint_push_plugin_owned_row_drivers', $drivers);
    }
    if (!is_array($drivers)) {
        $drivers = [];
    }

    $normalized = [];
    foreach ($drivers as $name => $driver) {
        if (!is_array($driver)) {
            continue;
        }
        $driver_name = (string) ($driver['driver'] ?? $name);
        $table = (string) ($driver['table'] ?? '');
        if ($driver_name === '' || $table === '') {
            continue;
        }
        $normalized[$driver_name] = [
            'driver' => $driver_name,
            'table' => $table,
            'pluginOwner' => (string) ($driver['pluginOwner'] ?? ''),
            'supportsDelete' => !empty($driver['supportsDelete']),
            'exportRowsCallback' => $driver['exportRowsCallback'] ?? null,
            'applyRowCallback' => $driver['applyRowCallback'] ?? null,
            'validateMutationCallback' => $driver['validateMutationCallback'] ?? null,
        ];
    }

    $drivers = $normalized;
    return $drivers;
}

function reprint_push_plugin_owned_row_driver(string $driver): ?array
{
    $drivers = reprint_push_plugin_owned_row_drivers();
    return $drivers[$driver] ?? null;
}

function reprint_push_plugin_owned_row_driver_for_table(string $table): ?array
{
    foreach (reprint_push_plugin_owned_row_drivers() as $driver) {
        if (($driver['table'] ?? null) === $table) {
            return $driver;
        }
    }
    return null;
}

function reprint_push_plugin_owned_driver_allowed_resource(array $driver, string $row_id): array
{
    return [
        'resourceKey' => 'row:' . wp_json_encode([(string) $driver['table'], $row_id], JSON_UNESCAPED_SLASHES),
        'pluginOwner' => (string) ($driver['pluginOwner'] ?? ''),
        'driver' => (string) ($driver['driver'] ?? ''),
        'table' => (string) ($driver['table'] ?? ''),
        'supportsDelete' => !empty($driver['supportsDelete']),
    ];
}

function reprint_push_assert_plugin_owned_driver_row_id(array $driver, string $id): void
{
    if (($driver['driver'] ?? null) === 'fixture-forms-lab-table') {
        reprint_push_forms_lab_row_id($id);
        return;
    }
    if ($id === '') {
        throw new RuntimeException('Plugin-owned driver row id must not be empty.');
    }
}

function reprint_push_allowed_plugin_option_names(): array
{
    return array_keys(reprint_push_allowed_plugin_options());
}

function reprint_push_allowed_plugin_options(): array
{
    return [
        'reprint_push_plugin_payload' => 'forms',
        'reprint_push_forms_fixture' => 'forms',
        'reprint_push_atomic_fixture_data' => 'reprint-push-atomic-dependent-fixture',
    ];
}

function reprint_push_allowed_fixture_plugins(): array
{
    return [
        'reprint-push-forms-fixture' => [
            'name' => 'Reprint Push Forms Fixture',
            'owner' => 'forms',
        ],
        'reprint-push-atomic-dependency-fixture' => [
            'name' => 'Reprint Push Atomic Dependency Fixture',
            'owner' => 'reprint-push-atomic-dependency-fixture',
        ],
        'reprint-push-atomic-dependent-fixture' => [
            'name' => 'Reprint Push Atomic Dependent Fixture',
            'owner' => 'reprint-push-atomic-dependent-fixture',
        ],
        'reprint-push-atomic-failing-fixture' => [
            'name' => 'Reprint Push Atomic Failing Fixture',
            'owner' => 'reprint-push-atomic-failing-fixture',
        ],
    ];
}

function reprint_push_fixture_plugin_dependency_closure(): array
{
    return [
        'reprint-push-atomic-dependent-fixture' => ['reprint-push-atomic-dependency-fixture'],
        'reprint-push-atomic-failing-fixture' => ['reprint-push-atomic-dependency-fixture'],
    ];
}

function reprint_push_fixture_plugin_owned_row_dependencies(): array
{
    return [
        'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]' => 'reprint-push-atomic-dependent-fixture',
    ];
}

function reprint_push_assert_fixture_plugin_slug(string $slug): void
{
    if (!array_key_exists($slug, reprint_push_allowed_fixture_plugins())) {
        throw new RuntimeException('Unsupported fixture plugin: ' . $slug);
    }
}

function reprint_push_is_fixture_plugin_file_path(string $relative_path): bool
{
    return in_array($relative_path, reprint_push_allowed_fixture_plugin_file_paths(), true);
}

function reprint_push_allowed_fixture_plugin_file_paths(?string $slug = null): array
{
    $paths = [];
    foreach (array_keys(reprint_push_allowed_fixture_plugins()) as $plugin_slug) {
        if ($slug !== null && $slug !== $plugin_slug) {
            continue;
        }
        $paths[] = 'wp-content/plugins/' . $plugin_slug . '/' . $plugin_slug . '.php';
    }
    return $paths;
}

function reprint_push_delete_fixture_plugin_dir(string $slug): void
{
    reprint_push_assert_fixture_plugin_slug($slug);
    $dir = WP_PLUGIN_DIR . '/' . $slug;
    if (!is_dir($dir)) {
        return;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $file_info) {
        if ($file_info->isDir()) {
            if (!rmdir($file_info->getPathname())) {
                throw new RuntimeException('Could not remove fixture plugin directory: ' . $file_info->getPathname());
            }
            continue;
        }
        if (!unlink($file_info->getPathname())) {
            throw new RuntimeException('Could not remove fixture plugin file: ' . $file_info->getPathname());
        }
    }
    if (!rmdir($dir)) {
        throw new RuntimeException('Could not remove fixture plugin directory: ' . $dir);
    }
}

function reprint_push_validate_fixture_atomic_group_dependencies(array $plan, array $snapshot, array $mutations): void
{
    $groups = isset($plan['atomicGroups']) && is_array($plan['atomicGroups']) ? $plan['atomicGroups'] : [];
    reprint_push_validate_fixture_plugin_dependency_coverage($snapshot, $mutations, $groups);

    $mutations_by_resource = [];
    foreach ($mutations as $mutation) {
        if (!is_array($mutation)) {
            continue;
        }
        $mutations_by_resource[(string) ($mutation['resourceKey'] ?? '')] = $mutation;
    }

    foreach ($groups as $group) {
        if (!is_array($group)) {
            continue;
        }
        $group_id = (string) ($group['id'] ?? '');
        $group_mutation_ids = [];
        foreach (($group['mutationIds'] ?? []) as $mutation_id) {
            $group_mutation_ids[(string) $mutation_id] = true;
        }
        foreach ($mutations as $mutation) {
            if ((string) ($mutation['atomicGroupId'] ?? '') === $group_id) {
                $group_mutation_ids[(string) ($mutation['id'] ?? '')] = true;
            }
        }

        foreach (reprint_push_atomic_group_dependency_requirements($group) as $requirement) {
            $plugin = (string) ($requirement['plugin'] ?? '');
            if ($plugin === '') {
                throw new RuntimeException('Atomic group ' . $group_id . ' declares a plugin dependency without a plugin name.');
            }
            reprint_push_assert_fixture_plugin_slug($plugin);

            $resource = ['type' => 'plugin', 'name' => $plugin];
            $resource_key = 'plugin:' . $plugin;
            $mutation = $mutations_by_resource[$resource_key] ?? null;

            if (is_array($mutation) && empty($group_mutation_ids[(string) ($mutation['id'] ?? '')])) {
                throw new RuntimeException('Atomic group ' . $group_id . ' depends on plugin ' . $plugin . ', but its mutation is outside the group.');
            }

            if (is_array($mutation)) {
                $planned = reprint_push_planned_resource_value($mutation['value'] ?? []);
                if (($planned['exists'] ?? false) !== true) {
                    throw new RuntimeException('Atomic group ' . $group_id . ' would remove plugin dependency ' . $plugin . '.');
                }
                reprint_push_validate_atomic_plugin_dependency_value(
                    $group_id,
                    $plugin,
                    $requirement,
                    $planned['value'],
                    reprint_push_hash_snapshot_value($planned['value']),
                    'same-atomic-group'
                );
                continue;
            }

            $current = reprint_push_get_resource($snapshot, $resource);
            if (($current['exists'] ?? false) !== true) {
                throw new RuntimeException('Atomic group ' . $group_id . ' is missing plugin dependency ' . $plugin . '.');
            }

            $actual_hash = reprint_push_hash_resource($snapshot, $resource);
            $evidence_hash = reprint_push_atomic_dependency_evidence_hash($requirement);
            if ($evidence_hash === null) {
                throw new RuntimeException('Atomic group ' . $group_id . ' has no live-remote hash evidence for plugin dependency ' . $plugin . '.');
            }
            if ($actual_hash !== $evidence_hash) {
                throw new RuntimeException(
                    'Atomic group ' . $group_id . ' has stale live-remote evidence for plugin dependency ' . $plugin
                    . ': expected ' . $evidence_hash . ', got ' . $actual_hash . '.'
                );
            }

            reprint_push_validate_atomic_plugin_dependency_value(
                $group_id,
                $plugin,
                $requirement,
                $current['value'],
                $actual_hash,
                'live-remote'
            );
        }
    }
}

function reprint_push_validate_fixture_plugin_dependency_coverage(array $snapshot, array $mutations, array $groups): void
{
    foreach ($mutations as $mutation) {
        if (!is_array($mutation)) {
            continue;
        }

        $required_plugins = reprint_push_fixture_plugin_dependencies_required_for_mutation($snapshot, $mutation);
        if (count($required_plugins) === 0) {
            continue;
        }

        $declared_dependencies = [];
        $groups_covering_mutation = [];
        foreach ($groups as $group) {
            if (!is_array($group) || !reprint_push_atomic_group_covers_mutation($group, $mutation)) {
                continue;
            }

            $groups_covering_mutation[] = (string) ($group['id'] ?? '');
            foreach (reprint_push_atomic_group_dependency_requirements($group) as $requirement) {
                $plugin = (string) ($requirement['plugin'] ?? '');
                if ($plugin !== '') {
                    $declared_dependencies[$plugin] = true;
                }
            }
        }

        foreach ($required_plugins as $plugin) {
            if (isset($declared_dependencies[$plugin])) {
                continue;
            }

            throw new RuntimeException(
                'Mutation ' . (string) ($mutation['id'] ?? '')
                . ' for ' . (string) ($mutation['resourceKey'] ?? '')
                . ' requires an atomic group dependency requirement for ' . $plugin . '.'
            );
        }
    }
}

function reprint_push_fixture_plugin_dependencies_required_for_mutation(array $snapshot, array $mutation): array
{
    $resource = isset($mutation['resource']) && is_array($mutation['resource']) ? $mutation['resource'] : [];
    $plugin = reprint_push_fixture_plugin_owner_for_mutation($snapshot, $mutation);
    $dependencies = reprint_push_fixture_plugin_dependency_closure()[$plugin] ?? [];
    if (count($dependencies) === 0) {
        return [];
    }

    if (($resource['type'] ?? null) === 'row') {
        return $dependencies;
    }

    $planned = reprint_push_planned_resource_value(isset($mutation['value']) && is_array($mutation['value']) ? $mutation['value'] : []);
    if (($planned['exists'] ?? false) !== true) {
        return [];
    }

    $is_install = !array_key_exists($plugin, $snapshot['plugins'] ?? []);
    $value = $planned['value'];
    $is_activation = is_array($value) && !empty($value['active']);
    return ($is_install || $is_activation) ? $dependencies : [];
}

function reprint_push_fixture_plugin_owner_for_mutation(array $snapshot, array $mutation): ?string
{
    $resource = isset($mutation['resource']) && is_array($mutation['resource']) ? $mutation['resource'] : [];
    if (($resource['type'] ?? null) === 'plugin') {
        return (string) ($resource['name'] ?? '');
    }

    if (($resource['type'] ?? null) !== 'row') {
        return null;
    }

    $planned = reprint_push_planned_resource_value(isset($mutation['value']) && is_array($mutation['value']) ? $mutation['value'] : []);
    $planned_owner = reprint_push_fixture_dependency_owner_from_value($planned['value'] ?? null);
    if ($planned_owner !== null) {
        return $planned_owner;
    }

    $current = reprint_push_get_resource($snapshot, $resource);
    $current_owner = reprint_push_fixture_dependency_owner_from_value($current['value'] ?? null);
    if ($current_owner !== null) {
        return $current_owner;
    }

    $resource_key = (string) ($mutation['resourceKey'] ?? '');
    $row_dependencies = reprint_push_fixture_plugin_owned_row_dependencies();
    return isset($row_dependencies[$resource_key]) ? (string) $row_dependencies[$resource_key] : null;
}

function reprint_push_fixture_dependency_owner_from_value($value): ?string
{
    if (!is_array($value) || !isset($value['__pluginOwner'])) {
        return null;
    }
    $owner = (string) $value['__pluginOwner'];
    return array_key_exists($owner, reprint_push_fixture_plugin_dependency_closure()) ? $owner : null;
}

function reprint_push_atomic_group_covers_mutation(array $group, array $mutation): bool
{
    $group_id = (string) ($group['id'] ?? '');
    if ($group_id !== '' && (string) ($mutation['atomicGroupId'] ?? '') === $group_id) {
        return true;
    }

    $mutation_id = (string) ($mutation['id'] ?? '');
    foreach (($group['mutationIds'] ?? []) as $group_mutation_id) {
        if ((string) $group_mutation_id === $mutation_id) {
            return true;
        }
    }

    return false;
}

function reprint_push_atomic_group_dependency_requirements(array $group): array
{
    $requirements = [];
    $seen = [];

    foreach (($group['dependencyRequirements'] ?? []) as $requirement) {
        if (is_string($requirement)) {
            $normalized = ['plugin' => $requirement];
        } elseif (is_array($requirement)) {
            $normalized = $requirement;
            $normalized['plugin'] = (string) ($requirement['plugin'] ?? $requirement['name'] ?? $requirement['slug'] ?? '');
        } else {
            $normalized = ['plugin' => ''];
        }
        $requirements[] = $normalized;
        if (($normalized['plugin'] ?? '') !== '') {
            $seen[(string) $normalized['plugin']] = true;
        }
    }

    $dependency_plugins = $group['dependencies']['plugins'] ?? [];
    if (!is_array($dependency_plugins)) {
        return $requirements;
    }
    foreach ($dependency_plugins as $plugin) {
        if (is_string($plugin)) {
            $name = $plugin;
            $normalized = ['plugin' => $name];
        } elseif (is_array($plugin)) {
            $name = (string) ($plugin['name'] ?? $plugin['plugin'] ?? $plugin['slug'] ?? '');
            $normalized = $plugin;
            $normalized['plugin'] = $name;
        } else {
            $name = '';
            $normalized = ['plugin' => ''];
        }
        if ($name !== '' && isset($seen[$name])) {
            continue;
        }
        $requirements[] = $normalized;
        if ($name !== '') {
            $seen[$name] = true;
        }
    }

    return $requirements;
}

function reprint_push_planned_resource_value(array $payload): array
{
    if (!empty($payload['absent'])) {
        return ['exists' => false, 'value' => null];
    }
    return ['exists' => true, 'value' => $payload['value'] ?? null];
}

function reprint_push_assert_supported_plugin_owned_mutation(array $mutation, array $snapshot): void
{
    $resource = $mutation['resource'] ?? [];
    if (($resource['type'] ?? null) !== 'row') {
        return;
    }

    $planned = reprint_push_planned_resource_value($mutation['value'] ?? []);
    $owner = null;
    if (($planned['exists'] ?? false) === true && is_array($planned['value'] ?? null)) {
        $owner = $planned['value']['__pluginOwner'] ?? null;
    }
    if ($owner === null) {
        $current = reprint_push_get_resource($snapshot, $resource);
        if (($current['exists'] ?? false) === true && is_array($current['value'] ?? null)) {
            $owner = $current['value']['__pluginOwner'] ?? null;
        }
    }
    if ($owner === null) {
        return;
    }

    $policy = $mutation['pluginOwnedResource'] ?? null;
    $driver = is_array($policy) ? (string) ($policy['driver'] ?? '') : '';
    if ($driver === 'wp-option' && (string) ($resource['table'] ?? '') === 'wp_options') {
        return;
    }
    if (in_array($driver, ['wp-postmeta', 'wp-post-meta'], true) && (string) ($resource['table'] ?? '') === 'wp_postmeta') {
        return;
    }
    if (in_array($driver, ['wp-termmeta', 'wp-term-meta'], true) && (string) ($resource['table'] ?? '') === 'wp_termmeta') {
        return;
    }
    if (in_array($driver, ['wp-usermeta', 'wp-user-meta'], true) && (string) ($resource['table'] ?? '') === 'wp_usermeta') {
        return;
    }

    $driver_definition = reprint_push_plugin_owned_row_driver($driver);
    if (is_array($driver_definition)) {
        $matches_driver = (string) ($resource['table'] ?? '') === (string) ($driver_definition['table'] ?? '')
            && (string) $owner === (string) ($driver_definition['pluginOwner'] ?? '');
        if ($matches_driver && !empty($mutation['value']['absent']) && empty($driver_definition['supportsDelete'])) {
            throw new RuntimeException('Plugin-owned mutation driver does not support deletes for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
        }
        $validate_callback = $driver_definition['validateMutationCallback'] ?? null;
        if ($matches_driver && !is_callable($validate_callback)) {
            throw new RuntimeException('Plugin-owned driver is missing validateMutationCallback for driver: ' . (string) ($driver_definition['driver'] ?? 'unknown'));
        }
        if ($matches_driver && $validate_callback($mutation, $snapshot, $driver_definition) === true) {
            return;
        }
    }

    throw new RuntimeException('Unsupported plugin-owned mutation driver for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
}

function reprint_push_validate_forms_lab_driver_mutation(array $mutation, array $snapshot, array $driver): bool
{
    $resource = $mutation['resource'] ?? [];
    return (string) ($driver['pluginOwner'] ?? '') === 'forms'
        && (string) ($driver['table'] ?? '') === 'wp_reprint_push_forms_lab'
        && (string) ($resource['table'] ?? '') === 'wp_reprint_push_forms_lab'
        && preg_match('/^id:[1-9]\d*$/', (string) ($resource['id'] ?? ''))
        && empty($mutation['value']['absent'])
        && reprint_push_valid_fixture_forms_lab_driver_evidence(($mutation['pluginOwnedResource']['driverEvidence'] ?? null), $snapshot);
}

function reprint_push_valid_fixture_forms_lab_driver_evidence($evidence, array $snapshot): bool
{
    if (!is_array($evidence)) {
        return false;
    }
    if (($evidence['plugin'] ?? '') !== 'reprint-push-forms-fixture'
        || ($evidence['resourceKey'] ?? '') !== 'plugin:reprint-push-forms-fixture'
        || ($evidence['source'] ?? '') !== 'live-remote') {
        return false;
    }
    return is_string($evidence['baseHash'] ?? null)
        && is_string($evidence['remoteHash'] ?? null)
        && preg_match('/^[a-f0-9]{64}$/', $evidence['baseHash'])
        && preg_match('/^[a-f0-9]{64}$/', $evidence['remoteHash'])
        && $evidence['baseHash'] === $evidence['remoteHash']
        && reprint_push_snapshot_has_active_forms_fixture_plugin($snapshot)
        && reprint_push_hash_resource($snapshot, [
            'type' => 'plugin',
            'name' => 'reprint-push-forms-fixture',
        ]) === $evidence['remoteHash'];
}

function reprint_push_snapshot_has_active_forms_fixture_plugin(array $snapshot): bool
{
    $plugin = $snapshot['plugins']['reprint-push-forms-fixture'] ?? null;
    return is_array($plugin) && ($plugin['active'] ?? false) === true;
}

function reprint_push_hash_snapshot_value($value): string
{
    return hash('sha256', reprint_push_stable_json($value));
}

function reprint_push_atomic_dependency_evidence_hash(array $requirement): ?string
{
    foreach (['remoteHash', 'hash', 'expectedHash'] as $key) {
        if (isset($requirement[$key]) && is_string($requirement[$key]) && $requirement[$key] !== '') {
            return $requirement[$key];
        }
    }
    if (isset($requirement['evidence']) && is_array($requirement['evidence'])) {
        foreach (['remoteHash', 'hash', 'expectedHash'] as $key) {
            if (isset($requirement['evidence'][$key]) && is_string($requirement['evidence'][$key]) && $requirement['evidence'][$key] !== '') {
                return $requirement['evidence'][$key];
            }
        }
    }
    return null;
}

function reprint_push_validate_atomic_plugin_dependency_value(
    string $group_id,
    string $plugin,
    array $requirement,
    $value,
    string $hash,
    string $source
): void {
    if (isset($requirement['expectedHash']) && is_string($requirement['expectedHash']) && $requirement['expectedHash'] !== '' && $requirement['expectedHash'] !== $hash) {
        throw new RuntimeException('Atomic group ' . $group_id . ' requires plugin ' . $plugin . ' at hash ' . $requirement['expectedHash'] . ', but ' . $source . ' has ' . $hash . '.');
    }

    $actual_version = is_array($value) && isset($value['version']) ? (string) $value['version'] : null;
    $expected_version = isset($requirement['expectedVersion']) && is_string($requirement['expectedVersion']) && $requirement['expectedVersion'] !== ''
        ? $requirement['expectedVersion']
        : null;
    $version_range = isset($requirement['versionRange']) && is_string($requirement['versionRange']) && $requirement['versionRange'] !== ''
        ? $requirement['versionRange']
        : null;

    if (($expected_version !== null || $version_range !== null) && $actual_version === null) {
        throw new RuntimeException('Atomic group ' . $group_id . ' requires a versioned plugin dependency ' . $plugin . ', but ' . $source . ' has no version metadata.');
    }
    if ($expected_version !== null && $actual_version !== $expected_version) {
        throw new RuntimeException('Atomic group ' . $group_id . ' requires plugin ' . $plugin . ' version ' . $expected_version . ', but ' . $source . ' has ' . (string) $actual_version . '.');
    }
    if ($version_range !== null && !reprint_push_satisfies_version_range((string) $actual_version, $version_range)) {
        throw new RuntimeException('Atomic group ' . $group_id . ' requires plugin ' . $plugin . ' version ' . $version_range . ', but ' . $source . ' has ' . (string) $actual_version . '.');
    }
    if (isset($requirement['active']) && is_bool($requirement['active'])) {
        $actual_active = is_array($value) && !empty($value['active']);
        if ($actual_active !== $requirement['active']) {
            throw new RuntimeException('Atomic group ' . $group_id . ' requires plugin ' . $plugin . ' active=' . ($requirement['active'] ? 'true' : 'false') . ', but ' . $source . ' has active=' . ($actual_active ? 'true' : 'false') . '.');
        }
    }
}

function reprint_push_satisfies_version_range(string $version, string $range): bool
{
    $comparators = preg_split('/\s+/', trim($range));
    if (!is_array($comparators) || count($comparators) === 0) {
        return false;
    }
    foreach ($comparators as $comparator) {
        if ($comparator === '') {
            continue;
        }
        if (!preg_match('/^(>=|>|<=|<|=)?(.+)$/', $comparator, $matches)) {
            return false;
        }
        $operator = $matches[1] !== '' ? $matches[1] : '=';
        $comparison = reprint_push_compare_versions($version, $matches[2]);
        if ($comparison === null || !reprint_push_version_comparator_satisfied($comparison, $operator)) {
            return false;
        }
    }
    return true;
}

function reprint_push_compare_versions(string $left, string $right): ?int
{
    $left = preg_replace('/^v/i', '', $left);
    $right = preg_replace('/^v/i', '', $right);
    if (!is_string($left) || !is_string($right) || !preg_match('/^\d+(\.\d+)*$/', $left) || !preg_match('/^\d+(\.\d+)*$/', $right)) {
        return null;
    }
    $left_parts = array_map('intval', explode('.', $left));
    $right_parts = array_map('intval', explode('.', $right));
    $length = max(count($left_parts), count($right_parts));
    for ($index = 0; $index < $length; $index++) {
        $left_part = $left_parts[$index] ?? 0;
        $right_part = $right_parts[$index] ?? 0;
        if ($left_part === $right_part) {
            continue;
        }
        return $left_part > $right_part ? 1 : -1;
    }
    return 0;
}

function reprint_push_version_comparator_satisfied(int $comparison, string $operator): bool
{
    if ($operator === '>') {
        return $comparison > 0;
    }
    if ($operator === '>=') {
        return $comparison >= 0;
    }
    if ($operator === '<') {
        return $comparison < 0;
    }
    if ($operator === '<=') {
        return $comparison <= 0;
    }
    return $comparison === 0;
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
