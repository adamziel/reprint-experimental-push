<?php
/**
 * Shared snapshot helpers for the Playground push lab.
 *
 * These helpers intentionally cover only the fixture surface used by the lab:
 * marked posts, their author identities, selected fixture graph postmeta,
 * selected fixture taxonomy graph rows,
 * selected fixture comment graph rows,
 * allowlisted plugin-owned options/postmeta,
 * fixture-scoped lab plugin/table metadata, named lab plugin files, and upload files under
 * wp-content/uploads/reprint-push.
 */

const REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_VERSION = 1;
const REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_KIND = 'plugin-owned-row-driver';
const REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION = 1;
const REPRINT_PUSH_WORDPRESS_GRAPH_RELATIONSHIP_CONTRACT_KIND = 'wordpress-graph-relationship';
const REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND = 'wordpress-graph-identity-map';

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
            'wp_users' => [],
            'wp_options' => [],
            'wp_postmeta' => [],
            'wp_reprint_push_forms_lab' => [],
            'wp_terms' => [],
            'wp_term_taxonomy' => [],
            'wp_term_relationships' => [],
            'wp_termmeta' => [],
            'wp_comments' => [],
            'wp_commentmeta' => [],
            'wp_site' => [],
            'wp_blogs' => [],
            'wp_blogmeta' => [],
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
    foreach (reprint_push_core_page_option_names() as $option_name) {
        $value = get_option($option_name, null);
        if ($value === null) {
            continue;
        }
        $snapshot['db']['wp_options']['option_name:' . $option_name] = [
            'option_name' => $option_name,
            'option_value' => reprint_push_normalize_snapshot_value($value),
        ];
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

    reprint_push_export_fixture_post_authors($snapshot);
    reprint_push_export_fixture_postmeta($snapshot);
    reprint_push_export_fixture_comment_graph($snapshot);
    reprint_push_export_fixture_taxonomy_graph($snapshot);
    reprint_push_export_fixture_multisite_graph($snapshot);
    reprint_push_export_fixture_plugin_metadata($snapshot);
    reprint_push_export_fixture_custom_table($snapshot);
    reprint_push_export_registered_plugin_owned_rows($snapshot);
    reprint_push_add_fixture_plugin_owned_policy($snapshot);
    reprint_push_add_wordpress_graph_contracts($snapshot);
    reprint_push_add_wordpress_graph_identity_maps($snapshot);

    $fixture_root = WP_CONTENT_DIR . '/uploads/reprint-push';
    if (is_dir($fixture_root)) {
        reprint_push_export_fixture_files($snapshot, $fixture_root, 'wp-content/uploads/reprint-push');
    }

    ksort($snapshot['files']);
    ksort($snapshot['plugins']);
    ksort($snapshot['db']['wp_posts']);
    ksort($snapshot['db']['wp_users']);
    ksort($snapshot['db']['wp_options']);
    ksort($snapshot['db']['wp_postmeta']);
    ksort($snapshot['db']['wp_reprint_push_forms_lab']);
    ksort($snapshot['db']['wp_terms']);
    ksort($snapshot['db']['wp_term_taxonomy']);
    ksort($snapshot['db']['wp_term_relationships']);
    ksort($snapshot['db']['wp_termmeta']);
    ksort($snapshot['db']['wp_comments']);
    ksort($snapshot['db']['wp_commentmeta']);
    ksort($snapshot['db']['wp_site']);
    ksort($snapshot['db']['wp_blogs']);
    ksort($snapshot['db']['wp_blogmeta']);

    return $snapshot;
}

function reprint_push_export_fixture_post_authors(array &$snapshot): void
{
    global $wpdb;

    $author_ids = [];
    foreach ($snapshot['db']['wp_posts'] as $post) {
        $author_id = (int) ($post['post_author'] ?? 0);
        if ($author_id > 0) {
            $author_ids[$author_id] = $author_id;
        }
    }
    if (count($author_ids) === 0) {
        return;
    }

    $placeholders = implode(', ', array_fill(0, count($author_ids), '%d'));
    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT ID
             FROM {$wpdb->users}
             WHERE ID IN ({$placeholders})
             ORDER BY ID ASC",
            ...array_values($author_ids)
        ),
        ARRAY_A
    );

    foreach ($rows as $row) {
        $row['ID'] = (int) $row['ID'];
        $snapshot['db']['wp_users']['ID:' . $row['ID']] = $row;
    }
}

function reprint_push_export_fixture_postmeta(array &$snapshot): void
{
    foreach (array_keys($snapshot['db']['wp_posts']) as $post_row_id) {
        $post_id = reprint_push_numeric_id($post_row_id, 'ID');
        foreach (reprint_push_fixture_postmeta_export_keys() as $meta_key) {
            $value = get_post_meta($post_id, $meta_key, true);
            if ($value === '') {
                continue;
            }
            $row = [
                'post_id' => $post_id,
                'meta_key' => $meta_key,
                'meta_value' => reprint_push_normalize_snapshot_value($value),
            ];
            if ($meta_key === reprint_push_forms_schema_meta_key()) {
                $row['__pluginOwner'] = 'forms';
            }
            $snapshot['db']['wp_postmeta'][reprint_push_postmeta_row_id($post_id, $meta_key)] = $row;
        }
    }
}

function reprint_push_export_fixture_comment_graph(array &$snapshot): void
{
    global $wpdb;

    if (count($snapshot['db']['wp_posts']) === 0) {
        return;
    }

    $post_ids = [];
    foreach (array_keys($snapshot['db']['wp_posts']) as $post_row_id) {
        $post_ids[] = reprint_push_numeric_id($post_row_id, 'ID');
    }

    $post_placeholders = implode(', ', array_fill(0, count($post_ids), '%d'));
    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT comment_ID, comment_post_ID, comment_author, comment_author_email, comment_author_url, comment_author_IP, comment_date, comment_date_gmt, comment_content, comment_karma, comment_approved, comment_agent, comment_type, comment_parent, user_id
             FROM {$wpdb->comments}
             WHERE comment_post_ID IN ({$post_placeholders})
               AND comment_agent = %s
             ORDER BY comment_ID ASC",
            ...array_merge(array_values($post_ids), [reprint_push_comment_fixture_agent()])
        ),
        ARRAY_A
    ) ?: [];

    if (count($rows) === 0) {
        return;
    }

    $comment_ids = [];
    foreach ($rows as $row) {
        $row['comment_ID'] = (int) $row['comment_ID'];
        $row['comment_post_ID'] = (int) $row['comment_post_ID'];
        $row['comment_karma'] = (int) $row['comment_karma'];
        $row['comment_parent'] = (int) $row['comment_parent'];
        $row['user_id'] = (int) $row['user_id'];
        $comment_ids[$row['comment_ID']] = $row['comment_ID'];
        $snapshot['db']['wp_comments']['comment_ID:' . $row['comment_ID']] = $row;
    }

    $allowed_meta_keys = reprint_push_fixture_commentmeta_export_keys();
    $comment_placeholders = implode(', ', array_fill(0, count($comment_ids), '%d'));
    $meta_key_placeholders = implode(', ', array_fill(0, count($allowed_meta_keys), '%s'));
    $commentmeta_rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT meta_id, comment_id, meta_key, meta_value
             FROM {$wpdb->commentmeta}
             WHERE comment_id IN ({$comment_placeholders})
               AND meta_key IN ({$meta_key_placeholders})
             ORDER BY meta_id ASC",
            ...array_values($comment_ids),
            ...$allowed_meta_keys
        ),
        ARRAY_A
    ) ?: [];

    foreach ($commentmeta_rows as $row) {
        $row['meta_id'] = (int) $row['meta_id'];
        $row['comment_id'] = (int) $row['comment_id'];
        $row['meta_value'] = reprint_push_normalize_snapshot_value($row['meta_value']);
        $snapshot['db']['wp_commentmeta']['meta_id:' . $row['meta_id']] = $row;
    }
}

function reprint_push_export_fixture_taxonomy_graph(array &$snapshot): void
{
    global $wpdb;

    $marker_key = reprint_push_taxonomy_fixture_meta_key();
    $marker_rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT meta_id, term_id, meta_key, meta_value
             FROM {$wpdb->termmeta}
             WHERE meta_key = %s
               AND meta_value <> ''
             ORDER BY meta_id ASC",
            $marker_key
        ),
        ARRAY_A
    ) ?: [];

    if (count($marker_rows) === 0) {
        return;
    }

    $term_ids = [];
    foreach ($marker_rows as $row) {
        $term_id = (int) ($row['term_id'] ?? 0);
        if ($term_id > 0) {
            $term_ids[$term_id] = $term_id;
        }
    }
    if (count($term_ids) === 0) {
        return;
    }

    $term_placeholders = implode(', ', array_fill(0, count($term_ids), '%d'));
    $terms = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT term_id, name, slug, term_group
             FROM {$wpdb->terms}
             WHERE term_id IN ({$term_placeholders})
             ORDER BY term_id ASC",
            ...array_values($term_ids)
        ),
        ARRAY_A
    ) ?: [];

    foreach ($terms as $term) {
        $term['term_id'] = (int) $term['term_id'];
        $term['term_group'] = (int) $term['term_group'];
        $snapshot['db']['wp_terms']['term_id:' . $term['term_id']] = $term;
    }

    $taxonomies = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT term_taxonomy_id, term_id, taxonomy, description, parent, count
             FROM {$wpdb->term_taxonomy}
             WHERE term_id IN ({$term_placeholders})
             ORDER BY term_taxonomy_id ASC",
            ...array_values($term_ids)
        ),
        ARRAY_A
    ) ?: [];

    $term_taxonomy_ids = [];
    foreach ($taxonomies as $taxonomy) {
        if (!in_array((string) ($taxonomy['taxonomy'] ?? ''), reprint_push_supported_fixture_taxonomies(), true)) {
            continue;
        }
        $taxonomy['term_taxonomy_id'] = (int) $taxonomy['term_taxonomy_id'];
        $taxonomy['term_id'] = (int) $taxonomy['term_id'];
        $taxonomy['parent'] = (int) $taxonomy['parent'];
        $taxonomy['count'] = (int) $taxonomy['count'];
        $term_taxonomy_ids[$taxonomy['term_taxonomy_id']] = $taxonomy['term_taxonomy_id'];
        $snapshot['db']['wp_term_taxonomy']['term_taxonomy_id:' . $taxonomy['term_taxonomy_id']] = $taxonomy;
    }

    if (count($term_taxonomy_ids) > 0 && count($snapshot['db']['wp_posts']) > 0) {
        $post_ids = [];
        foreach (array_keys($snapshot['db']['wp_posts']) as $post_row_id) {
            $post_ids[] = reprint_push_numeric_id($post_row_id, 'ID');
        }
        $post_placeholders = implode(', ', array_fill(0, count($post_ids), '%d'));
        $taxonomy_placeholders = implode(', ', array_fill(0, count($term_taxonomy_ids), '%d'));
        $relationships = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT object_id, term_taxonomy_id, term_order
                 FROM {$wpdb->term_relationships}
                 WHERE object_id IN ({$post_placeholders})
                   AND term_taxonomy_id IN ({$taxonomy_placeholders})
                 ORDER BY object_id ASC, term_taxonomy_id ASC",
                ...array_values($post_ids),
                ...array_values($term_taxonomy_ids)
            ),
            ARRAY_A
        ) ?: [];

        foreach ($relationships as $relationship) {
            $relationship['object_id'] = (int) $relationship['object_id'];
            $relationship['term_taxonomy_id'] = (int) $relationship['term_taxonomy_id'];
            $relationship['term_order'] = (int) $relationship['term_order'];
            $snapshot['db']['wp_term_relationships'][reprint_push_term_relationship_row_id(
                $relationship['object_id'],
                $relationship['term_taxonomy_id']
            )] = $relationship;
        }
    }

    $allowed_meta_keys = reprint_push_fixture_termmeta_export_keys();
    $meta_key_placeholders = implode(', ', array_fill(0, count($allowed_meta_keys), '%s'));
    $termmeta_rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT meta_id, term_id, meta_key, meta_value
             FROM {$wpdb->termmeta}
             WHERE term_id IN ({$term_placeholders})
               AND meta_key IN ({$meta_key_placeholders})
             ORDER BY meta_id ASC",
            ...array_values($term_ids),
            ...$allowed_meta_keys
        ),
        ARRAY_A
    ) ?: [];

    foreach ($termmeta_rows as $row) {
        $row['meta_id'] = (int) $row['meta_id'];
        $row['term_id'] = (int) $row['term_id'];
        $row['meta_value'] = reprint_push_normalize_snapshot_value($row['meta_value']);
        $snapshot['db']['wp_termmeta']['meta_id:' . $row['meta_id']] = $row;
    }
}

function reprint_push_export_fixture_multisite_graph(array &$snapshot): void
{
    global $wpdb;

    if (!function_exists('is_multisite') || !is_multisite()) {
        return;
    }

    $site_table = reprint_push_multisite_table_name('site');
    $blogs_table = reprint_push_multisite_table_name('blogs');
    $blogmeta_table = reprint_push_multisite_table_name('blogmeta');
    if (!reprint_push_table_exists($blogs_table) || !reprint_push_table_exists($blogmeta_table)) {
        return;
    }

    $blogs_sql_table = reprint_push_quote_identifier($blogs_table);
    $blogmeta_sql_table = reprint_push_quote_identifier($blogmeta_table);
    $marker_key = reprint_push_blog_fixture_meta_key();
    $blogs = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT DISTINCT b.blog_id, b.site_id, b.domain, b.path, b.registered, b.last_updated, b.public, b.archived, b.mature, b.spam, b.deleted
             FROM {$blogs_sql_table} b
             INNER JOIN {$blogmeta_sql_table} bm ON bm.blog_id = b.blog_id
             WHERE bm.meta_key = %s
               AND bm.meta_value <> ''
             ORDER BY b.blog_id ASC",
            $marker_key
        ),
        ARRAY_A
    ) ?: [];

    $blog_ids = [];
    $site_ids = [];
    foreach ($blogs as $blog) {
        $blog['blog_id'] = (int) $blog['blog_id'];
        $blog['site_id'] = (int) $blog['site_id'];
        $blog['public'] = (int) $blog['public'];
        $blog['archived'] = (int) $blog['archived'];
        $blog['mature'] = (int) $blog['mature'];
        $blog['spam'] = (int) $blog['spam'];
        $blog['deleted'] = (int) $blog['deleted'];
        if ($blog['blog_id'] <= 0) {
            continue;
        }
        $blog_ids[$blog['blog_id']] = $blog['blog_id'];
        if ($blog['site_id'] > 0) {
            $site_ids[$blog['site_id']] = $blog['site_id'];
        }
        $snapshot['db']['wp_blogs']['blog_id:' . $blog['blog_id']] = $blog;
    }

    if (count($site_ids) > 0 && reprint_push_table_exists($site_table)) {
        $site_sql_table = reprint_push_quote_identifier($site_table);
        $site_placeholders = implode(', ', array_fill(0, count($site_ids), '%d'));
        $sites = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, domain, path
                 FROM {$site_sql_table}
                 WHERE id IN ({$site_placeholders})
                 ORDER BY id ASC",
                ...array_values($site_ids)
            ),
            ARRAY_A
        ) ?: [];

        foreach ($sites as $site) {
            $site['id'] = (int) $site['id'];
            $snapshot['db']['wp_site']['id:' . $site['id']] = $site;
        }
    }

    if (count($blog_ids) === 0) {
        return;
    }

    $blog_placeholders = implode(', ', array_fill(0, count($blog_ids), '%d'));
    $allowed_meta_keys = reprint_push_fixture_blogmeta_export_keys();
    $meta_key_placeholders = implode(', ', array_fill(0, count($allowed_meta_keys), '%s'));
    $blogmeta_rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT blog_id, meta_key, meta_value
             FROM {$blogmeta_sql_table}
             WHERE blog_id IN ({$blog_placeholders})
               AND meta_key IN ({$meta_key_placeholders})
             ORDER BY blog_id ASC, meta_key ASC",
            ...array_values($blog_ids),
            ...$allowed_meta_keys
        ),
        ARRAY_A
    ) ?: [];

    $seen = [];
    $duplicates = [];
    foreach ($blogmeta_rows as $row) {
        $row_id = reprint_push_blogmeta_row_id((int) $row['blog_id'], (string) $row['meta_key']);
        if (isset($seen[$row_id])) {
            $duplicates[$row_id] = true;
        }
        $seen[$row_id] = true;
    }

    foreach ($blogmeta_rows as $row) {
        $blog_id = (int) $row['blog_id'];
        $meta_key = (string) $row['meta_key'];
        $row_id = reprint_push_blogmeta_row_id($blog_id, $meta_key);
        if (isset($duplicates[$row_id])) {
            unset($snapshot['db']['wp_blogmeta'][$row_id]);
            continue;
        }
        $snapshot['db']['wp_blogmeta'][$row_id] = [
            'blog_id' => $blog_id,
            'meta_key' => $meta_key,
            'meta_value' => reprint_push_normalize_snapshot_value(reprint_push_maybe_unserialize_snapshot_value($row['meta_value'])),
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

function reprint_push_export_fixture_custom_table(array &$snapshot): void
{
    global $wpdb;

    $table_name = reprint_push_forms_lab_table_name();
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
        $allowed_resources[] = reprint_push_plugin_owned_row_driver_policy_entry(
            'wp_options',
            $row_id,
            reprint_push_allowed_plugin_options()[$option_name] ?? 'forms',
            'wp-option',
            false
        );
    }
    foreach (array_keys($snapshot['db']['wp_postmeta']) as $row_id) {
        [, $meta_key] = reprint_push_parse_postmeta_row_id($row_id);
        if ($meta_key !== reprint_push_forms_schema_meta_key()) {
            continue;
        }
        $allowed_resources[] = reprint_push_plugin_owned_row_driver_policy_entry(
            'wp_postmeta',
            $row_id,
            'forms',
            'wp-postmeta',
            false
        );
    }
    foreach (array_keys($snapshot['db']['wp_reprint_push_forms_lab']) as $row_id) {
        reprint_push_forms_lab_row_id($row_id);
        $allowed_resources[] = reprint_push_plugin_owned_row_driver_policy_entry(
            'wp_reprint_push_forms_lab',
            $row_id,
            'forms',
            'fixture-forms-lab-table',
            false
        );
    }
    foreach (reprint_push_registered_plugin_owned_row_drivers() as $driver) {
        $table = (string) ($driver['table'] ?? '');
        $plugin_owner = (string) ($driver['pluginOwner'] ?? '');
        $driver_name = (string) ($driver['driver'] ?? '');
        if ($table === '' || $plugin_owner === '' || $driver_name === '') {
            continue;
        }
        foreach (array_keys($snapshot['db'][$table] ?? []) as $row_id) {
            $allowed_resources[] = reprint_push_plugin_owned_row_driver_policy_entry(
                $table,
                $row_id,
                $plugin_owner,
                $driver_name,
                !empty($driver['supportsDelete']),
                is_array($driver['rowSchema'] ?? null) ? $driver['rowSchema'] : null,
                $driver['mergePolicy'] ?? null,
                is_array($driver['referenceFields'] ?? ($driver['rowReferences'] ?? null))
                    ? ($driver['referenceFields'] ?? $driver['rowReferences'])
                    : null
            );
        }
    }

    usort($allowed_resources, static function (array $left, array $right): int {
        return strcmp((string) $left['resourceKey'], (string) $right['resourceKey']);
    });

    $snapshot['meta']['pluginOwnedResources'] = [
        'allowedResources' => $allowed_resources,
    ];
}

function reprint_push_plugin_owned_row_driver_policy_entry(
    string $table,
    string $row_id,
    string $plugin_owner,
    string $driver,
    bool $supports_delete,
    ?array $row_schema = null,
    $merge_policy = null,
    ?array $reference_fields = null
): array {
    $resource_key = 'row:' . wp_json_encode([$table, $row_id], JSON_UNESCAPED_SLASHES);
    $normalized_schema = $row_schema !== null
        ? reprint_push_normalize_plugin_owned_row_driver_row_schema($row_schema)
        : null;
    $normalized_merge_policy = $merge_policy !== null
        ? reprint_push_normalize_plugin_owned_row_driver_merge_policy($merge_policy)
        : null;
    $normalized_reference_fields = $reference_fields !== null
        ? reprint_push_normalize_plugin_owned_row_driver_reference_fields($reference_fields)
        : null;
    $entry = [
        'contractVersion' => REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_VERSION,
        'contractKind' => REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_KIND,
        'resourceKey' => $resource_key,
        'pluginOwner' => $plugin_owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
    ];
    if ($normalized_schema !== null) {
        $entry['rowSchema'] = $normalized_schema;
    }
    if ($normalized_merge_policy !== null) {
        $entry['mergePolicy'] = $normalized_merge_policy;
    }
    if ($normalized_reference_fields !== null) {
        $entry['referenceFields'] = $normalized_reference_fields;
    }
    $entry['contractHash'] = reprint_push_plugin_owned_row_driver_contract_hash(
        $resource_key,
        $plugin_owner,
        $driver,
        $table,
        $supports_delete,
        $normalized_schema,
        $normalized_merge_policy,
        $normalized_reference_fields
    );
    return $entry;
}

function reprint_push_plugin_owned_row_driver_contract_hash(
    string $resource_key,
    string $plugin_owner,
    string $driver,
    string $table,
    bool $supports_delete,
    ?array $row_schema = null,
    $merge_policy = null,
    ?array $reference_fields = null
): string {
    $contract = [
        'schemaVersion' => 1,
        'contractKind' => REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_KIND,
        'contractVersion' => REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_VERSION,
        'resourceKey' => $resource_key,
        'pluginOwner' => $plugin_owner,
        'driver' => $driver,
        'table' => $table,
        'supportsDelete' => $supports_delete,
    ];
    if ($row_schema !== null) {
        $contract['rowSchema'] = reprint_push_normalize_plugin_owned_row_driver_row_schema($row_schema);
    }
    if ($merge_policy !== null) {
        $contract['mergePolicy'] = reprint_push_normalize_plugin_owned_row_driver_merge_policy($merge_policy);
    }
    if ($reference_fields !== null) {
        $contract['referenceFields'] = reprint_push_normalize_plugin_owned_row_driver_reference_fields($reference_fields);
    }
    return hash('sha256', reprint_push_stable_json($contract));
}

function reprint_push_normalize_plugin_owned_row_driver_merge_policy($merge_policy): array
{
    if (is_string($merge_policy)) {
        $strategy = $merge_policy;
    } elseif (is_array($merge_policy)) {
        if (array_key_exists('rawValuesIncluded', $merge_policy) && $merge_policy['rawValuesIncluded'] !== false) {
            throw new RuntimeException('Plugin-owned row driver mergePolicy must not include raw values.');
        }
        $strategy = (string) ($merge_policy['strategy'] ?? ($merge_policy['policy'] ?? ''));
    } else {
        throw new RuntimeException('Plugin-owned row driver mergePolicy must be a string or object.');
    }

    if ($strategy !== 'refuse-on-conflict') {
        throw new RuntimeException('Unsupported plugin-owned row driver mergePolicy strategy.');
    }

    return [
        'schemaVersion' => 1,
        'strategy' => 'refuse-on-conflict',
        'conflictResolution' => 'preserve-remote-and-stop',
        'rawValuesIncluded' => false,
    ];
}

function reprint_push_normalize_plugin_owned_row_driver_reference_fields(array $reference_fields): array
{
    if (array_key_exists('rawValuesIncluded', $reference_fields) && $reference_fields['rawValuesIncluded'] !== false) {
        throw new RuntimeException('Plugin-owned row driver referenceFields must not include raw values.');
    }
    $fields_source = $reference_fields['fields'] ?? ($reference_fields['references'] ?? null);
    if (!is_array($fields_source) || !array_is_list($fields_source)) {
        throw new RuntimeException('Plugin-owned row driver referenceFields.fields must be an array.');
    }
    if (count($fields_source) === 0) {
        throw new RuntimeException('Plugin-owned row driver referenceFields must declare at least one field.');
    }

    $fields = [];
    $seen_paths = [];
    foreach ($fields_source as $definition) {
        $field = reprint_push_normalize_plugin_owned_row_driver_reference_field($definition);
        $path = (string) $field['path'];
        if (isset($seen_paths[$path])) {
            throw new RuntimeException('Plugin-owned row driver referenceFields paths must be unique.');
        }
        $seen_paths[$path] = true;
        $fields[] = $field;
    }
    usort($fields, static function (array $left, array $right): int {
        return strcmp((string) $left['path'], (string) $right['path']);
    });

    return [
        'schemaVersion' => 1,
        'fields' => $fields,
        'rawValuesIncluded' => false,
    ];
}

function reprint_push_normalize_plugin_owned_row_driver_reference_field($definition): array
{
    if (!is_array($definition) || array_is_list($definition)) {
        throw new RuntimeException('Plugin-owned row driver reference field must be an object.');
    }
    if (array_key_exists('rawValuesIncluded', $definition) && $definition['rawValuesIncluded'] !== false) {
        throw new RuntimeException('Plugin-owned row driver referenceFields must not include raw values.');
    }
    $path = (string) ($definition['path'] ?? ($definition['field'] ?? ''));
    $target_table = (string) ($definition['targetTable'] ?? ($definition['table'] ?? ''));
    $target_id_field = (string) ($definition['targetIdField'] ?? ($definition['targetField'] ?? ''));
    $scalar_type = (string) ($definition['scalarType'] ?? ($definition['type'] ?? 'positive-integer'));
    if (!reprint_push_is_plugin_owned_reference_field_path($path)) {
        throw new RuntimeException('Plugin-owned row driver reference field path is invalid.');
    }
    if ($target_table === '') {
        throw new RuntimeException('Plugin-owned row driver reference field targetTable is required.');
    }
    if ($target_id_field === '') {
        throw new RuntimeException('Plugin-owned row driver reference field targetIdField is required.');
    }
    $expected_target_id_field = reprint_push_plugin_owned_reference_target_primary_id_field($target_table);
    if ($expected_target_id_field === null || $target_id_field !== $expected_target_id_field) {
        throw new RuntimeException('Unsupported plugin-owned row driver reference target.');
    }
    if ($scalar_type !== 'positive-integer') {
        throw new RuntimeException('Unsupported plugin-owned row driver reference field type.');
    }

    return [
        'path' => $path,
        'targetTable' => $target_table,
        'targetIdField' => $target_id_field,
        'scalarType' => 'positive-integer',
        'required' => ($definition['required'] ?? true) !== false,
    ];
}

function reprint_push_plugin_owned_reference_target_primary_id_field(string $table): ?string
{
    $target_fields = [
        'posts' => 'ID',
        'users' => 'ID',
        'comments' => 'comment_ID',
        'terms' => 'term_id',
        'term_taxonomy' => 'term_taxonomy_id',
        'blogs' => 'blog_id',
        'site' => 'id',
    ];
    foreach ($target_fields as $suffix => $id_field) {
        if ($table === 'wp_' . $suffix || str_ends_with($table, '_' . $suffix)) {
            return $id_field;
        }
    }
    return null;
}

function reprint_push_is_plugin_owned_reference_field_path(string $path): bool
{
    if ($path === '') {
        return false;
    }
    foreach (explode('.', $path) as $segment) {
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $segment)) {
            return false;
        }
    }
    return true;
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema($row_schema): array
{
    if (!is_array($row_schema)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema must be an object.');
    }
    $fields_source = $row_schema['fields'] ?? null;
    if (is_array($fields_source) && array_is_list($fields_source)) {
        return reprint_push_normalize_plugin_owned_row_driver_row_schema_root(
            $row_schema,
            reprint_push_normalize_plugin_owned_row_driver_row_schema_fields($fields_source)
        );
    }
    if (!is_array($fields_source)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema.fields must be an object.');
    }
    $required_source = $row_schema['required'] ?? [];
    if (!is_array($required_source) || !array_is_list($required_source)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema.required must be an array.');
    }
    $required = [];
    foreach ($required_source as $field) {
        $field = (string) $field;
        if ($field === '') {
            throw new RuntimeException('Plugin-owned row driver rowSchema required fields must be non-empty strings.');
        }
        $required[$field] = true;
    }

    $supported_types = ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'];
    $field_names = array_keys($fields_source);
    sort($field_names, SORT_STRING);
    $fields = [];
    foreach ($field_names as $field) {
        $field = (string) $field;
        if ($field === '') {
            throw new RuntimeException('Plugin-owned row driver rowSchema field names must be non-empty strings.');
        }
        $definition = $fields_source[$field];
        if (is_string($definition)) {
            $type = $definition;
            $field_required = false;
        } elseif (is_array($definition)) {
            $type = $definition['type'] ?? null;
            $field_required = !empty($definition['required']);
        } else {
            $type = null;
            $field_required = false;
        }
        if (!is_string($type) || !in_array($type, $supported_types, true)) {
            throw new RuntimeException('Unsupported plugin-owned row driver rowSchema field type.');
        }
        $fields[] = reprint_push_normalize_plugin_owned_row_driver_row_schema_field([
            'field' => $field,
            'type' => $type,
            'required' => isset($required[$field]) || $field_required,
            'definition' => $definition,
        ]);
    }
    if (count($fields) === 0) {
        throw new RuntimeException('Plugin-owned row driver rowSchema must declare at least one field.');
    }
    $declared_fields = [];
    foreach ($fields as $field) {
        $declared_fields[$field['field']] = true;
    }
    foreach (array_keys($required) as $required_field) {
        if (!isset($declared_fields[$required_field])) {
            throw new RuntimeException('Plugin-owned row driver rowSchema required fields must be declared.');
        }
    }

    return reprint_push_normalize_plugin_owned_row_driver_row_schema_root(
        $row_schema,
        [
            'schemaVersion' => 1,
            'fields' => $fields,
        ]
    );
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema_root(array $row_schema, array $normalized): array
{
    if (!array_key_exists('additionalProperties', $row_schema)) {
        return $normalized;
    }
    if ($row_schema['additionalProperties'] !== false) {
        throw new RuntimeException('Plugin-owned row driver rowSchema additionalProperties must be false when declared.');
    }
    $with_root_boundary = [
        'schemaVersion' => $normalized['schemaVersion'],
        'additionalProperties' => false,
        'fields' => $normalized['fields'],
    ];
    return $with_root_boundary;
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema_fields(array $fields_source): array
{
    $supported_types = ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'];
    $fields = [];
    $seen_fields = [];
    foreach ($fields_source as $definition) {
        if (!is_array($definition)) {
            throw new RuntimeException('Plugin-owned row driver normalized rowSchema fields must be objects.');
        }
        $field = (string) ($definition['field'] ?? '');
        $type = $definition['type'] ?? null;
        if ($field === '') {
            throw new RuntimeException('Plugin-owned row driver rowSchema field names must be non-empty strings.');
        }
        if (isset($seen_fields[$field])) {
            throw new RuntimeException('Plugin-owned row driver rowSchema field names must be unique.');
        }
        $seen_fields[$field] = true;
        if (!is_string($type) || !in_array($type, $supported_types, true)) {
            throw new RuntimeException('Unsupported plugin-owned row driver rowSchema field type.');
        }
        $fields[] = reprint_push_normalize_plugin_owned_row_driver_row_schema_field([
            'field' => $field,
            'type' => $type,
            'required' => !empty($definition['required']),
            'definition' => $definition,
        ]);
    }
    if (count($fields) === 0) {
        throw new RuntimeException('Plugin-owned row driver rowSchema must declare at least one field.');
    }
    usort($fields, static function (array $left, array $right): int {
        return strcmp((string) $left['field'], (string) $right['field']);
    });
    return [
        'schemaVersion' => 1,
        'fields' => $fields,
    ];
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema_field(array $args): array
{
    $definition = is_array($args['definition'] ?? null) ? $args['definition'] : [];
    $normalized = [
        'field' => (string) $args['field'],
        'type' => (string) $args['type'],
        'required' => !empty($args['required']),
    ];
    $constraint = reprint_push_normalize_plugin_owned_row_driver_row_schema_field_constraint(
        (string) $args['type'],
        $definition
    );
    if ($constraint !== []) {
        $normalized = array_merge($normalized, $constraint);
    }
    if (array_key_exists('additionalProperties', $definition)) {
        if ((string) $args['type'] !== 'object') {
            throw new RuntimeException('Plugin-owned row driver rowSchema additionalProperties is only supported for object fields.');
        }
        if (!array_key_exists('properties', $definition)) {
            throw new RuntimeException('Plugin-owned row driver rowSchema additionalProperties requires object properties.');
        }
        if ($definition['additionalProperties'] !== false) {
            throw new RuntimeException('Plugin-owned row driver rowSchema additionalProperties must be false when declared.');
        }
        $normalized['additionalProperties'] = false;
    }
    if (array_key_exists('properties', $definition)) {
        if ((string) $args['type'] !== 'object') {
            throw new RuntimeException('Plugin-owned row driver rowSchema properties are only supported for object fields.');
        }
        $nested = reprint_push_normalize_plugin_owned_row_driver_row_schema([
            'fields' => $definition['properties'],
            'required' => is_array($definition['required'] ?? null) ? $definition['required'] : [],
        ]);
        $normalized['properties'] = $nested['fields'];
    }
    return $normalized;
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema_field_constraint(
    string $type,
    array $definition
): array {
    $has_raw_const = array_key_exists('const', $definition);
    $has_const_hash = array_key_exists('constHash', $definition);
    $has_raw_enum = array_key_exists('enum', $definition);
    $has_enum_hashes = array_key_exists('enumHashes', $definition);
    $has_minimum = array_key_exists('minimum', $definition);
    $has_maximum = array_key_exists('maximum', $definition);
    $has_range = $has_minimum || $has_maximum;
    $constraint_count = (($has_raw_const || $has_const_hash) ? 1 : 0)
        + (($has_raw_enum || $has_enum_hashes) ? 1 : 0)
        + ($has_range ? 1 : 0);

    if ($constraint_count === 0) {
        return [];
    }
    if ($has_range && !in_array($type, ['integer', 'number'], true)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema minimum/maximum constraints are only supported for integer or number fields.');
    }
    if (!$has_range && !in_array($type, ['boolean', 'integer', 'null', 'number', 'string'], true)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema const/enum constraints are only supported for scalar fields.');
    }
    if ($constraint_count > 1 || ($has_raw_const && $has_const_hash) || ($has_raw_enum && $has_enum_hashes)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema must declare exactly one const, enum, or range constraint representation.');
    }

    if ($has_range) {
        $range = [];
        if ($has_minimum) {
            $range['minimum'] = reprint_push_normalize_plugin_owned_row_driver_row_schema_range_boundary(
                $type,
                $definition['minimum']
            );
        }
        if ($has_maximum) {
            $range['maximum'] = reprint_push_normalize_plugin_owned_row_driver_row_schema_range_boundary(
                $type,
                $definition['maximum']
            );
        }
        if (array_key_exists('minimum', $range) && array_key_exists('maximum', $range) && $range['minimum'] > $range['maximum']) {
            throw new RuntimeException('Plugin-owned row driver rowSchema minimum must be less than or equal to maximum.');
        }
        return $range;
    }

    if ($has_raw_const) {
        $const_type = reprint_push_plugin_driver_payload_row_schema_value_type($definition['const']);
        if ($const_type !== $type) {
            throw new RuntimeException('Plugin-owned row driver rowSchema const value must match the field type.');
        }
        return [
            'constHash' => hash('sha256', reprint_push_stable_json($definition['const'])),
        ];
    }
    if ($has_const_hash) {
        if (!reprint_push_is_sha256_hex($definition['constHash'])) {
            throw new RuntimeException('Plugin-owned row driver rowSchema constHash must be a SHA-256 hex string.');
        }
        return [
            'constHash' => (string) $definition['constHash'],
        ];
    }
    if ($has_raw_enum) {
        if (!is_array($definition['enum']) || !array_is_list($definition['enum']) || count($definition['enum']) === 0) {
            throw new RuntimeException('Plugin-owned row driver rowSchema enum must be a non-empty array.');
        }
        $enum_hashes = [];
        foreach ($definition['enum'] as $value) {
            $value_type = reprint_push_plugin_driver_payload_row_schema_value_type($value);
            if ($value_type !== $type) {
                throw new RuntimeException('Plugin-owned row driver rowSchema enum values must match the field type.');
            }
            $enum_hashes[] = hash('sha256', reprint_push_stable_json($value));
        }
        $enum_hashes = array_values(array_unique($enum_hashes));
        sort($enum_hashes, SORT_STRING);
        return [
            'enumHashes' => $enum_hashes,
        ];
    }

    if (!is_array($definition['enumHashes'] ?? null) || !array_is_list($definition['enumHashes']) || count($definition['enumHashes']) === 0) {
        throw new RuntimeException('Plugin-owned row driver rowSchema enumHashes must be a non-empty array.');
    }
    foreach ($definition['enumHashes'] as $hash) {
        if (!reprint_push_is_sha256_hex($hash)) {
            throw new RuntimeException('Plugin-owned row driver rowSchema enumHashes must contain SHA-256 hex strings.');
        }
    }
    $enum_hashes = array_values(array_unique(array_map('strval', $definition['enumHashes'])));
    sort($enum_hashes, SORT_STRING);
    return [
        'enumHashes' => $enum_hashes,
    ];
}

function reprint_push_normalize_plugin_owned_row_driver_row_schema_range_boundary(
    string $type,
    $value
) {
    if (!(is_int($value) || is_float($value)) || !is_finite((float) $value)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema range boundaries must be finite numbers.');
    }
    if ($type === 'integer' && !is_int($value)) {
        throw new RuntimeException('Plugin-owned row driver rowSchema integer range boundaries must be integers.');
    }
    return $value;
}

function reprint_push_is_sha256_hex($value): bool
{
    return is_string($value) && preg_match('/^[a-f0-9]{64}$/', $value) === 1;
}

function reprint_push_add_wordpress_graph_contracts(array &$snapshot): void
{
    $snapshot['meta']['wordpressGraphContracts'] = reprint_push_wordpress_graph_contract_metadata();
}

function reprint_push_wordpress_graph_contract_metadata(): array
{
    return [
        'schemaVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        'relationshipContracts' => reprint_push_wordpress_graph_relationship_contracts(),
        'unsupportedSurfaceContracts' => reprint_push_wordpress_graph_unsupported_surface_contracts(),
        'identityMapContract' => [
            'schemaVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
            'contractKind' => REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
            'explicitMapTableSuffixes' => reprint_push_wordpress_graph_identity_map_table_suffixes(),
            'failClosedCollisionSurfaces' => reprint_push_wordpress_graph_identity_fail_closed_collision_surfaces(),
            'rewritesRequireEquivalentRemoteTarget' => true,
            'explicitContractsFailClosed' => true,
            'rewritesRecordHashOnlyEvidence' => true,
            'identityMapRowsRecordContractHash' => true,
            'rawValuesIncluded' => false,
        ],
        'rawValuesIncluded' => false,
    ];
}

function reprint_push_wordpress_graph_relationship_contracts(): array
{
    return [
        reprint_push_wordpress_graph_relationship_contract('comment-post', 'comments', ['comment_post_ID'], 'posts', true, 'valid-post-row'),
        reprint_push_wordpress_graph_relationship_contract('comment-parent', 'comments', ['comment_parent'], 'comments', true, 'valid-comment-row'),
        reprint_push_wordpress_graph_relationship_contract('comment-user', 'comments', ['user_id'], 'users', true, 'valid-user-row'),
        reprint_push_wordpress_graph_relationship_contract('commentmeta-comment', 'commentmeta', ['comment_id'], 'comments', true, 'valid-comment-row'),
        reprint_push_wordpress_graph_relationship_contract('link-owner', 'links', ['link_owner'], 'users', true, 'valid-user-row'),
        reprint_push_wordpress_graph_relationship_contract('blog-site', 'blogs', ['site_id'], 'site', true, 'valid-site-row'),
        reprint_push_wordpress_graph_relationship_contract('blogmeta-blog', 'blogmeta', ['blog_id'], 'blogs', true, 'valid-blog-row'),
        reprint_push_wordpress_graph_relationship_contract('blog-version-blog', 'blog_versions', ['blog_id'], 'blogs', true, 'valid-blog-row'),
        reprint_push_wordpress_graph_relationship_contract('sitemeta-site', 'sitemeta', ['site_id'], 'site', true, 'valid-site-row'),
        reprint_push_wordpress_graph_relationship_contract('registration-log-blog', 'registration_log', ['blog_id'], 'blogs', true, 'valid-blog-row'),
        reprint_push_wordpress_graph_relationship_contract('post-parent', 'posts', ['post_parent'], 'posts', true, 'valid-post-row'),
        reprint_push_wordpress_graph_relationship_contract('post-author', 'posts', ['post_author'], 'users', true, 'valid-user-row'),
        reprint_push_wordpress_graph_relationship_contract('postmeta-post', 'postmeta', ['post_id'], 'posts', true, 'valid-post-row'),
        reprint_push_wordpress_graph_relationship_contract('serialized-block-attachment', 'posts', ['post_content', 'post_excerpt'], 'posts', false, 'post-type:attachment'),
        reprint_push_wordpress_graph_relationship_contract('serialized-block-post', 'posts', ['post_content', 'post_excerpt'], 'posts', false, 'valid-post-row'),
        reprint_push_wordpress_graph_relationship_contract('serialized-block-reusable-block', 'posts', ['post_content', 'post_excerpt'], 'posts', false, 'post-type:wp_block'),
        reprint_push_wordpress_graph_relationship_contract('featured-image-attachment', 'postmeta', ['meta_value'], 'posts', true, 'post-type:attachment', 'meta_key:_thumbnail_id'),
        reprint_push_wordpress_graph_relationship_contract('postmeta-edit-last-user', 'postmeta', ['meta_value'], 'users', true, 'valid-user-row', 'meta_key:_edit_last'),
        reprint_push_wordpress_graph_relationship_contract('option-page-on-front-post', 'options', ['option_value'], 'posts', true, 'post-type:page', 'option_name:page_on_front'),
        reprint_push_wordpress_graph_relationship_contract('option-page-for-posts-post', 'options', ['option_value'], 'posts', true, 'post-type:page', 'option_name:page_for_posts'),
        reprint_push_wordpress_graph_relationship_contract('term-relationship-object', 'term_relationships', ['object_id'], 'posts', true, 'valid-post-row'),
        reprint_push_wordpress_graph_relationship_contract('term-relationship-taxonomy', 'term_relationships', ['term_taxonomy_id'], 'term_taxonomy', true, 'valid-term-taxonomy-row'),
        reprint_push_wordpress_graph_relationship_contract('term-taxonomy-term', 'term_taxonomy', ['term_id'], 'terms', true, 'valid-term-row'),
        reprint_push_wordpress_graph_relationship_contract('term-taxonomy-parent', 'term_taxonomy', ['parent'], 'terms', true, 'valid-term-row'),
        reprint_push_wordpress_graph_relationship_contract('termmeta-term', 'termmeta', ['term_id'], 'terms', true, 'valid-term-row'),
        reprint_push_wordpress_graph_relationship_contract('usermeta-user', 'usermeta', ['user_id'], 'users', true, 'valid-user-row'),
    ];
}

function reprint_push_wordpress_graph_relationship_contract(
    string $relationship_type,
    string $source_suffix,
    array $source_fields,
    string $target_suffix,
    bool $scalar_rewrite_supported = true,
    string $target_validation = 'row-present',
    ?string $source_condition = null,
    bool $same_plan_supported = true
): array {
    $contract = [
        'schemaVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        'contractKind' => REPRINT_PUSH_WORDPRESS_GRAPH_RELATIONSHIP_CONTRACT_KIND,
        'relationshipType' => $relationship_type,
        'sourceSuffix' => $source_suffix,
        'sourceFields' => array_values($source_fields),
        'targetSuffix' => $target_suffix,
        'scalarRewriteSupported' => $scalar_rewrite_supported,
        'targetValidation' => $target_validation,
        'samePlanSupported' => $same_plan_supported,
        'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        'rawValuesIncluded' => false,
    ];
    if ($source_condition !== null) {
        $contract['sourceCondition'] = $source_condition;
    }
    return $contract;
}

function reprint_push_wordpress_graph_unsupported_surface_contracts(): array
{
    return [
        [
            'surface' => 'wp_posts.post_type',
            'unsupportedValues' => ['nav_menu_item', 'revision', 'wp_navigation'],
            'reasonCode' => 'UNSUPPORTED_WORDPRESS_POST_GRAPH_SURFACE',
            'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        ],
        [
            'surface' => 'wp_postmeta.meta_key',
            'unsupportedValues' => [
                '_menu_item_object',
                '_menu_item_object_id',
                '_menu_item_menu_item_parent',
                '_menu_item_type',
                'menu_item_parent',
            ],
            'reasonCode' => 'UNSUPPORTED_WORDPRESS_MENU_ITEM_META_GRAPH_SURFACE',
            'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        ],
        [
            'surface' => 'wp_term_taxonomy.taxonomy',
            'unsupportedValues' => ['nav_menu'],
            'reasonCode' => 'UNSUPPORTED_WORDPRESS_NAV_MENU_TAXONOMY_GRAPH_SURFACE',
            'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        ],
        [
            'surface' => 'wp_term_taxonomy.taxonomy',
            'supportedValues' => ['category', 'post_tag', 'post_format'],
            'reasonCode' => 'UNSUPPORTED_WORDPRESS_CUSTOM_TAXONOMY_GRAPH_SURFACE',
            'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        ],
    ];
}

function reprint_push_wordpress_graph_identity_map_table_suffixes(): array
{
    return [
        'posts',
        'users',
        'comments',
        'terms',
        'term_taxonomy',
        'site',
        'blogs',
    ];
}

function reprint_push_wordpress_graph_identity_fail_closed_collision_surfaces(): array
{
    return [
        'wp_posts.guid',
        'wp_posts.post_type+post_name',
    ];
}

function reprint_push_add_wordpress_graph_identity_maps(array &$snapshot): void
{
    $rows = reprint_push_wordpress_graph_identity_map_rows();
    if (count($rows) === 0) {
        return;
    }

    $snapshot['meta']['wordpressGraphIdentityMap'] = [
        'contractVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        'contractKind' => REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
        'rows' => $rows,
        'rawValuesIncluded' => false,
    ];
}

function reprint_push_wordpress_graph_identity_map_rows(): array
{
    $source_rows = [];
    if (function_exists('get_option')) {
        $source_rows = get_option('reprint_push_wordpress_graph_identity_map', []);
    }
    if (function_exists('apply_filters')) {
        $source_rows = apply_filters('reprint_push_wordpress_graph_identity_map_rows', $source_rows);
    }

    return reprint_push_normalize_wordpress_graph_identity_map_rows($source_rows);
}

function reprint_push_normalize_wordpress_graph_identity_map_rows($source_rows): array
{
    if ($source_rows === null || $source_rows === false || $source_rows === '') {
        return [];
    }
    if (!is_array($source_rows)) {
        throw new RuntimeException('Unsupported WordPress graph identity map provider payload.');
    }
    if (array_key_exists('rows', $source_rows)) {
        $source_rows = $source_rows['rows'];
    } elseif (array_key_exists('resources', $source_rows)) {
        $source_rows = $source_rows['resources'];
    }
    if (!is_array($source_rows) || !array_is_list($source_rows)) {
        throw new RuntimeException('Unsupported WordPress graph identity map rows payload.');
    }

    $rows = [];
    foreach ($source_rows as $entry) {
        $rows[] = reprint_push_normalize_wordpress_graph_identity_map_row($entry);
    }
    return $rows;
}

function reprint_push_normalize_wordpress_graph_identity_map_row($entry): array
{
    if (!is_array($entry)) {
        throw new RuntimeException('Unsupported WordPress graph identity map row.');
    }

    $declares_contract = array_key_exists('contractVersion', $entry)
        || array_key_exists('schemaVersion', $entry)
        || array_key_exists('contractKind', $entry)
        || array_key_exists('kind', $entry);
    $provided_version = $entry['contractVersion'] ?? $entry['schemaVersion'] ?? null;
    if ($provided_version !== null && (int) $provided_version !== REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION) {
        throw new RuntimeException('Unsupported WordPress graph identity map contract version.');
    }
    $provided_kind = $entry['contractKind'] ?? $entry['kind'] ?? null;
    if ($declares_contract && ($provided_kind === null || (string) $provided_kind !== REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND)) {
        throw new RuntimeException('Unsupported WordPress graph identity map contract kind.');
    }
    if (array_key_exists('rawValuesIncluded', $entry) && $entry['rawValuesIncluded'] !== false) {
        throw new RuntimeException('WordPress graph identity map rows must not include raw values.');
    }

    $source_resource_key = reprint_push_wordpress_graph_identity_map_entry_resource_key($entry, 'source');
    $target_resource_key = reprint_push_wordpress_graph_identity_map_entry_resource_key($entry, 'target');
    [$source_table] = reprint_push_parse_wordpress_graph_row_resource_key($source_resource_key);
    [$target_table] = reprint_push_parse_wordpress_graph_row_resource_key($target_resource_key);
    $source_suffix = reprint_push_wordpress_graph_table_suffix($source_table);
    $target_suffix = reprint_push_wordpress_graph_table_suffix($target_table);

    if ($source_resource_key === $target_resource_key) {
        throw new RuntimeException('WordPress graph identity map source and target must differ.');
    }
    if ($source_suffix === null
        || $target_suffix === null
        || $source_suffix !== $target_suffix
        || !in_array($source_suffix, reprint_push_wordpress_graph_identity_map_table_suffixes(), true)) {
        throw new RuntimeException('Unsupported WordPress graph identity map table surface.');
    }
    $expected_contract_hash = reprint_push_wordpress_graph_identity_map_contract_hash(
        $source_resource_key,
        $target_resource_key
    );
    $nested_contract = is_array($entry['contract'] ?? null) ? $entry['contract'] : [];
    $supplied_contract_hash = $entry['contractHash'] ?? $nested_contract['contractHash'] ?? null;
    if ($supplied_contract_hash !== null && (string) $supplied_contract_hash !== $expected_contract_hash) {
        throw new RuntimeException('WordPress graph identity map contract hash mismatch.');
    }

    return [
        'contractVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        'contractKind' => REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
        'sourceResourceKey' => $source_resource_key,
        'targetResourceKey' => $target_resource_key,
        'contractHash' => $expected_contract_hash,
        'rawValuesIncluded' => false,
    ];
}

function reprint_push_wordpress_graph_identity_map_contract_hash(
    string $source_resource_key,
    string $target_resource_key
): string {
    [$source_table, $source_id] = reprint_push_parse_wordpress_graph_row_resource_key($source_resource_key);
    [$target_table, $target_id] = reprint_push_parse_wordpress_graph_row_resource_key($target_resource_key);

    return hash('sha256', reprint_push_stable_json([
        'schemaVersion' => REPRINT_PUSH_WORDPRESS_GRAPH_CONTRACT_SCHEMA_VERSION,
        'contractKind' => REPRINT_PUSH_WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_KIND,
        'sourceResourceKey' => $source_resource_key,
        'targetResourceKey' => $target_resource_key,
        'sourceTable' => $source_table,
        'targetTable' => $target_table,
        'sourceId' => $source_id,
        'targetId' => $target_id,
        'resolutionPolicy' => 'preserve-remote-wordpress-graph-and-stop',
        'rawValuesIncluded' => false,
    ]));
}

function reprint_push_wordpress_graph_identity_map_entry_resource_key(array $entry, string $side): string
{
    if ($side === 'source') {
        $resource_key = $entry['sourceResourceKey']
            ?? $entry['localResourceKey']
            ?? $entry['fromResourceKey']
            ?? null;
        $table = $entry['sourceTable'] ?? $entry['localTable'] ?? $entry['fromTable'] ?? $entry['table'] ?? null;
        $id = $entry['sourceId'] ?? $entry['localId'] ?? $entry['fromId'] ?? null;
    } else {
        $resource_key = $entry['targetResourceKey']
            ?? $entry['remoteResourceKey']
            ?? $entry['toResourceKey']
            ?? null;
        $table = $entry['targetTable'] ?? $entry['remoteTable'] ?? $entry['toTable'] ?? $entry['table'] ?? null;
        $id = $entry['targetId'] ?? $entry['remoteId'] ?? $entry['toId'] ?? null;
    }

    if (is_string($resource_key) && $resource_key !== '') {
        reprint_push_parse_wordpress_graph_row_resource_key($resource_key);
        return $resource_key;
    }
    if (is_string($table) && $table !== '' && is_string($id) && $id !== '') {
        return 'row:' . wp_json_encode([$table, $id], JSON_UNESCAPED_SLASHES);
    }

    throw new RuntimeException('WordPress graph identity map row must include source and target row resources.');
}

function reprint_push_parse_wordpress_graph_row_resource_key(string $resource_key): array
{
    if (!str_starts_with($resource_key, 'row:')) {
        throw new RuntimeException('WordPress graph identity map resource key must be a row resource.');
    }
    $decoded = json_decode(substr($resource_key, strlen('row:')), true);
    if (!is_array($decoded)
        || count($decoded) !== 2
        || !is_string($decoded[0] ?? null)
        || !is_string($decoded[1] ?? null)
        || $decoded[0] === ''
        || $decoded[1] === '') {
        throw new RuntimeException('WordPress graph identity map resource key must encode a table and row id.');
    }
    return [$decoded[0], $decoded[1]];
}

function reprint_push_wordpress_graph_table_suffix(string $table): ?string
{
    foreach (reprint_push_wordpress_graph_table_suffixes() as $suffix) {
        if ($table === 'wp_' . $suffix || str_ends_with($table, '_' . $suffix)) {
            return $suffix;
        }
    }
    return null;
}

function reprint_push_wordpress_graph_table_suffixes(): array
{
    return [
        'registration_log',
        'blog_versions',
        'commentmeta',
        'sitemeta',
        'blogmeta',
        'comments',
        'term_relationships',
        'term_taxonomy',
        'postmeta',
        'usermeta',
        'options',
        'users',
        'termmeta',
        'links',
        'blogs',
        'site',
        'posts',
        'terms',
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

function reprint_push_resource_object_key(array $resource): ?string
{
    $type = $resource['type'] ?? null;
    if ($type === 'file' && isset($resource['path']) && is_string($resource['path'])) {
        return 'file:' . $resource['path'];
    }
    if ($type === 'plugin' && isset($resource['name']) && is_string($resource['name'])) {
        return 'plugin:' . $resource['name'];
    }
    if ($type === 'row'
        && isset($resource['table'])
        && is_string($resource['table'])
        && isset($resource['id'])
        && is_string($resource['id'])) {
        return 'row:' . wp_json_encode([$resource['table'], $resource['id']], JSON_UNESCAPED_SLASHES);
    }
    return null;
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

    if ($table === 'wp_blogmeta') {
        return reprint_push_guarded_put_blogmeta_row($id, $expected_resource_value, $value, $expected_storage_value);
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
    if ($table === 'wp_reprint_push_release_state') {
        return reprint_push_guarded_update_existing_release_state_driver_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
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
    if (
        !in_array($option_name, reprint_push_allowed_plugin_option_names(), true)
        && !in_array($option_name, reprint_push_core_page_option_names(), true)
    ) {
        throw new RuntimeException('Refusing to mutate non-fixture option: ' . $option_name);
    }
    if (!array_key_exists('option_value', $expected) || !array_key_exists('option_value', $value)) {
        throw new RuntimeException('Option row payload must include option_value');
    }
    reprint_push_assert_core_page_option_payload_supported($option_name, $value);

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

function reprint_push_guarded_put_blogmeta_row(string $id, array $expected_resource_value, array $value, ?array $expected_storage_value = null): array
{
    if (($expected_resource_value['exists'] ?? false) === true && is_array($expected_resource_value['value'] ?? null)) {
        return reprint_push_guarded_update_existing_blogmeta_row($id, $expected_resource_value['value'], $value, $expected_storage_value);
    }

    return reprint_push_guarded_create_blogmeta_row($id, $value, $expected_storage_value);
}

function reprint_push_guarded_update_existing_blogmeta_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    [$blog_id, $meta_key] = reprint_push_validate_blogmeta_row_value($id, $value);
    if ((int) ($expected['blog_id'] ?? 0) !== $blog_id
        || (string) ($expected['meta_key'] ?? '') !== $meta_key
        || !array_key_exists('meta_value', $expected)
    ) {
        throw new RuntimeException('Blogmeta expected row does not match row id: ' . $id);
    }

    $expected_storage = [
        'blog_id' => $blog_id,
        'meta_key' => $meta_key,
        'meta_value' => (string) maybe_serialize($expected['meta_value']),
    ];
    if (($expected_storage_value['exists'] ?? false) === true && is_array($expected_storage_value['value'] ?? null)) {
        $expected_storage = $expected_storage_value['value'];
    }

    $table_name = reprint_push_blogmeta_table_name();
    $table = reprint_push_quote_identifier($table_name);
    $expected_parent_fixture_marker_id = (int) ($expected_storage['parent_fixture_marker_meta_id'] ?? 0);
    $expected_parent_fixture_marker = (string) ($expected_storage['parent_fixture_marker_meta_value'] ?? '');
    $shape = "UPDATE {$table} SET meta_value = %s WHERE blog_id = %d AND meta_key = %s AND meta_value = %s AND (SELECT COUNT(*) FROM (SELECT meta_id FROM {$table} WHERE blog_id = %d AND meta_key = %s) AS reprint_push_guard_blogmeta_count) = 1 AND (SELECT COUNT(*) FROM (SELECT marker.meta_id FROM {$table} marker WHERE marker.meta_id = %d AND marker.blog_id = %d AND marker.meta_key = %s AND marker.meta_value = %s AND marker.meta_value <> '') AS reprint_push_guard_parent_blog_marker_count) >= 1";
    if (!reprint_push_table_exists($table_name)) {
        return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'update', ['blog_id', 'meta_key', 'meta_value', 'parent_fixture_marker'], $expected, $expected_storage, 0, $shape);
    }

    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        (string) maybe_serialize($value['meta_value']),
        $blog_id,
        $meta_key,
        (string) ($expected_storage['meta_value'] ?? ''),
        $blog_id,
        $meta_key,
        $expected_parent_fixture_marker_id,
        $blog_id,
        reprint_push_blog_fixture_meta_key(),
        $expected_parent_fixture_marker
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded blogmeta row update: ' . $wpdb->last_error);
    }
    if ((int) $rows === 1) {
        reprint_push_clean_blogmeta_cache($blog_id);
    }

    return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'update', ['blog_id', 'meta_key', 'meta_value', 'parent_fixture_marker'], $expected, $expected_storage, $rows, $shape);
}

function reprint_push_guarded_create_blogmeta_row(string $id, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    [$blog_id, $meta_key] = reprint_push_validate_blogmeta_row_value($id, $value);
    $table_name = reprint_push_blogmeta_table_name();
    $shape = 'GET_LOCK wp_blogmeta row id; verify parent fixture marker; verify row absent; insert row; RELEASE_LOCK';
    $expected_storage = [
        'blog_id' => $blog_id,
        'meta_key' => $meta_key,
        'exists' => false,
        'rowCount' => (int) ($expected_storage_value['rowCount'] ?? 0),
    ];
    if (($expected_storage_value['exists'] ?? false) === true) {
        return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'insert', ['blog_id', 'meta_key', 'absent', 'parent_fixture_marker'], ['exists' => false], $expected_storage, 0, $shape, 'wpdb-named-lock-cas');
    }
    if (!reprint_push_table_exists($table_name)) {
        return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'insert', ['blog_id', 'meta_key', 'absent', 'parent_fixture_marker'], ['exists' => false], $expected_storage, 0, $shape, 'wpdb-named-lock-cas');
    }

    $lock_name = 'reprint_push_blogmeta:' . hash('sha256', $table_name . '|' . $blog_id . '|' . $meta_key);
    if (!reprint_push_acquire_mysql_named_lock($lock_name, 5)) {
        return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'insert', ['blog_id', 'meta_key', 'absent', 'parent_fixture_marker'], ['exists' => false], $expected_storage, 0, $shape, 'wpdb-named-lock-cas');
    }

    $rows = 0;
    try {
        if (!reprint_push_is_fixture_blog($blog_id) || reprint_push_blogmeta_row_count($blog_id, $meta_key) !== 0) {
            $rows = 0;
        } else {
            $inserted = $wpdb->insert(
                $table_name,
                [
                    'blog_id' => $blog_id,
                    'meta_key' => $meta_key,
                    'meta_value' => (string) maybe_serialize($value['meta_value']),
                ],
                ['%d', '%s', '%s']
            );
            if ($inserted === false) {
                throw new RuntimeException('Could not apply guarded blogmeta row insert: ' . $wpdb->last_error);
            }
            $rows = (int) $inserted;
            if ($rows === 1) {
                reprint_push_clean_blogmeta_cache($blog_id);
            }
        }
    } finally {
        reprint_push_release_mysql_named_lock($lock_name);
    }

    return reprint_push_storage_guard_result('wp-blogmeta', 'wp_blogmeta', $table_name, 'insert', ['blog_id', 'meta_key', 'absent', 'parent_fixture_marker'], ['exists' => false], $expected_storage, $rows, $shape, 'wpdb-named-lock-cas');
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

function reprint_push_guarded_update_existing_release_state_driver_row(string $id, array $expected, array $value, ?array $expected_storage_value = null): array
{
    global $wpdb;

    if ($id !== 'state_id:1') {
        throw new RuntimeException('Unsupported release state driver row id: ' . $id);
    }
    if ((int) ($expected['state_id'] ?? 0) !== 1 || (int) ($value['state_id'] ?? 0) !== 1) {
        throw new RuntimeException('Release state driver guarded payload does not match state_id:1.');
    }
    reprint_push_validate_release_state_driver_value($expected);
    reprint_push_validate_release_state_driver_value($value);

    $table_name = reprint_push_release_state_driver_storage_table();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    $expected_payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($expected['payload'] ?? null));
    $payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($value['payload'] ?? null));
    if (!is_string($expected_payload_json) || !is_string($payload_json)) {
        throw new RuntimeException('Could not encode release state driver guarded payload: ' . $id);
    }

    $expected_storage = [
        'state_id' => 1,
        'payload_json' => $expected_payload_json,
        'updated_marker' => (string) ($expected['updated_marker'] ?? ''),
    ];
    if (($expected_storage_value['exists'] ?? false) === true && is_array($expected_storage_value['value'] ?? null)) {
        $expected_storage = $expected_storage_value['value'];
    }
    $table = reprint_push_quote_identifier($table_name);
    $shape = "UPDATE {$table} SET payload_json = %s, updated_marker = %s WHERE state_id = %d AND payload_json = %s AND updated_marker = %s";
    if ($exists !== $table_name) {
        return reprint_push_storage_guard_result('reprint-push-release-state', 'wp_reprint_push_release_state', $table_name, 'update', ['state_id', 'payload_json', 'updated_marker'], $expected, $expected_storage, 0, $shape);
    }
    $rows = $wpdb->query($wpdb->prepare(
        $shape,
        $payload_json,
        (string) $value['updated_marker'],
        1,
        (string) ($expected_storage['payload_json'] ?? ''),
        (string) ($expected_storage['updated_marker'] ?? '')
    ));
    if ($rows === false) {
        throw new RuntimeException('Could not apply guarded release state driver row update: ' . $wpdb->last_error);
    }

    return reprint_push_storage_guard_result('reprint-push-release-state', 'wp_reprint_push_release_state', $table_name, 'update', ['state_id', 'payload_json', 'updated_marker'], $expected, $expected_storage, $rows, $shape);
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
    string $sql_shape,
    string $boundary = 'wpdb-single-statement-cas'
): array {
    $affected = (int) $rows;
    return [
        'applied' => $affected === 1,
        'storageGuard' => [
            'boundary' => $boundary,
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

function reprint_push_table_exists(string $table_name): bool
{
    global $wpdb;

    return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name)) === $table_name;
}

function reprint_push_multisite_table_name(string $suffix): string
{
    global $wpdb;

    if (!preg_match('/^[A-Za-z0-9_]+$/', $suffix)) {
        throw new RuntimeException('Unsafe multisite table suffix.');
    }
    $base_prefix = (string) ($wpdb->base_prefix ?? $wpdb->prefix ?? 'wp_');
    $table_name = $base_prefix . $suffix;
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table_name)) {
        throw new RuntimeException('Unsafe multisite table name.');
    }
    return $table_name;
}

function reprint_push_blogmeta_table_name(): string
{
    return reprint_push_multisite_table_name('blogmeta');
}

function reprint_push_maybe_unserialize_snapshot_value($value)
{
    return function_exists('maybe_unserialize') ? maybe_unserialize($value) : $value;
}

function reprint_push_acquire_mysql_named_lock(string $lock_name, int $timeout_seconds): bool
{
    global $wpdb;

    $result = $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, %d)', $lock_name, $timeout_seconds));
    return (string) $result === '1';
}

function reprint_push_release_mysql_named_lock(string $lock_name): void
{
    global $wpdb;

    $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name));
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
    if ($table === 'wp_blogmeta') {
        [$blog_id, $meta_key] = reprint_push_parse_blogmeta_row_id($id);
        $table_name = reprint_push_blogmeta_table_name();
        if (!reprint_push_table_exists($table_name)) {
            return ['exists' => false, 'value' => null, 'rowCount' => 0];
        }
        $sql_table = reprint_push_quote_identifier($table_name);
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT blog_id, meta_key, meta_value FROM {$sql_table} WHERE blog_id = %d AND meta_key = %s ORDER BY meta_id ASC",
                $blog_id,
                $meta_key
            ),
            ARRAY_A
        ) ?: [];
        if (count($rows) !== 1) {
            return ['exists' => false, 'value' => null, 'rowCount' => count($rows)];
        }
        $rows[0]['blog_id'] = (int) $rows[0]['blog_id'];
        $marker = reprint_push_blog_fixture_marker_storage_row($blog_id);
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
    if ($table === 'wp_reprint_push_release_state') {
        if ($id !== 'state_id:1') {
            throw new RuntimeException('Unsupported release state driver row id: ' . $id);
        }
        $table_name = reprint_push_release_state_driver_storage_table();
        $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
        if ($exists !== $table_name) {
            return ['exists' => false, 'value' => null];
        }
        $row = $wpdb->get_row(
            'SELECT state_id, payload_json, updated_marker FROM ' . reprint_push_quote_identifier($table_name) . ' WHERE state_id = 1',
            ARRAY_A
        );
        if (!is_array($row)) {
            return ['exists' => false, 'value' => null];
        }
        $row['state_id'] = (int) $row['state_id'];
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

function reprint_push_blog_fixture_marker_storage_row(int $blog_id): ?array
{
    global $wpdb;

    $table_name = reprint_push_blogmeta_table_name();
    if (!reprint_push_table_exists($table_name)) {
        return null;
    }
    $row = $wpdb->get_row(
        $wpdb->prepare(
            'SELECT meta_id, meta_value FROM ' . reprint_push_quote_identifier($table_name) . ' WHERE blog_id = %d AND meta_key = %s ORDER BY meta_id ASC LIMIT 1',
            $blog_id,
            reprint_push_blog_fixture_meta_key()
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
            if (
                !in_array($option_name, reprint_push_allowed_plugin_option_names(), true)
                && !in_array($option_name, reprint_push_core_page_option_names(), true)
            ) {
                throw new RuntimeException('Unsupported option for fixture apply: ' . $option_name);
            }
            return;
        }
        if ($table === 'wp_postmeta') {
            reprint_push_parse_postmeta_row_id($id);
            return;
        }
        if ($table === 'wp_blogmeta') {
            reprint_push_parse_blogmeta_row_id($id);
            return;
        }
        if ($table === 'wp_reprint_push_forms_lab') {
            reprint_push_forms_lab_row_id($id);
            return;
        }
        if ($table === 'wp_terms') {
            reprint_push_term_row_id($id);
            return;
        }
        if ($table === 'wp_term_taxonomy') {
            reprint_push_term_taxonomy_row_id($id);
            return;
        }
        if ($table === 'wp_term_relationships') {
            reprint_push_parse_term_relationship_row_id($id);
            return;
        }
        if ($table === 'wp_termmeta') {
            reprint_push_termmeta_row_id($id);
            return;
        }
        if ($table === 'wp_comments') {
            reprint_push_comment_row_id($id);
            return;
        }
        if ($table === 'wp_commentmeta') {
            reprint_push_commentmeta_row_id($id);
            return;
        }
        $driver = reprint_push_plugin_owned_row_driver_for_table($table);
        if (is_array($driver)) {
            if ($id === '' || strpos($id, ':') === false) {
                throw new RuntimeException('Unsupported plugin-owned row id: ' . $id);
            }
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
    if ($table === 'wp_blogmeta') {
        reprint_push_apply_blogmeta_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_reprint_push_forms_lab') {
        reprint_push_apply_forms_lab_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_terms') {
        reprint_push_apply_term_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_term_taxonomy') {
        reprint_push_apply_term_taxonomy_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_term_relationships') {
        reprint_push_apply_term_relationship_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_termmeta') {
        reprint_push_apply_termmeta_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_comments') {
        reprint_push_apply_comment_row($id, $is_delete, $value);
        return;
    }
    if ($table === 'wp_commentmeta') {
        reprint_push_apply_commentmeta_row($id, $is_delete, $value);
        return;
    }
    $driver = reprint_push_plugin_owned_row_driver_for_table($table);
    if (is_array($driver)) {
        $callback = $driver['applyRowCallback'] ?? null;
        if (!is_string($callback) || $callback === '' || !is_callable($callback)) {
            throw new RuntimeException('Unsupported apply callback for plugin-owned driver table: ' . $table);
        }
        $callback($id, $is_delete, $value, $driver);
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
    if (
        !in_array($option_name, reprint_push_allowed_plugin_option_names(), true)
        && !in_array($option_name, reprint_push_core_page_option_names(), true)
    ) {
        throw new RuntimeException('Refusing to mutate non-fixture option: ' . $option_name);
    }

    if ($is_delete) {
        if (in_array($option_name, reprint_push_core_page_option_names(), true)) {
            throw new RuntimeException('Refusing to delete core page option: ' . $option_name);
        }
        delete_option($option_name);
        return;
    }
    if (!is_array($value) || !array_key_exists('option_value', $value)) {
        throw new RuntimeException('Option row payload must include option_value');
    }
    reprint_push_assert_core_page_option_payload_supported($option_name, $value);
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

function reprint_push_apply_blogmeta_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    [$blog_id, $meta_key] = reprint_push_parse_blogmeta_row_id($id);
    if ($is_delete) {
        throw new RuntimeException('Fixture blogmeta rows do not support deletes: ' . $id);
    }
    if (!reprint_push_is_fixture_blog($blog_id)) {
        throw new RuntimeException('Refusing to mutate blogmeta without fixture-marked parent blog: ' . $id);
    }
    reprint_push_validate_blogmeta_row_value($id, $value);

    $table_name = reprint_push_blogmeta_table_name();
    if (!reprint_push_table_exists($table_name)) {
        throw new RuntimeException('Blogmeta table is missing for fixture apply: ' . $table_name);
    }
    $row_count = reprint_push_blogmeta_row_count($blog_id, $meta_key);
    if ($row_count > 1) {
        throw new RuntimeException('Refusing to mutate ambiguous duplicate blogmeta rows: ' . $id);
    }

    $meta_value = (string) maybe_serialize($value['meta_value']);
    if ($row_count === 0) {
        $inserted = $wpdb->insert(
            $table_name,
            [
                'blog_id' => $blog_id,
                'meta_key' => $meta_key,
                'meta_value' => $meta_value,
            ],
            ['%d', '%s', '%s']
        );
        if ($inserted === false) {
            throw new RuntimeException('Could not apply blogmeta row: ' . $wpdb->last_error);
        }
        reprint_push_clean_blogmeta_cache($blog_id);
        return;
    }

    $updated = $wpdb->update(
        $table_name,
        ['meta_value' => $meta_value],
        ['blog_id' => $blog_id, 'meta_key' => $meta_key],
        ['%s'],
        ['%d', '%s']
    );
    if ($updated === false) {
        throw new RuntimeException('Could not apply blogmeta row: ' . $wpdb->last_error);
    }
    reprint_push_clean_blogmeta_cache($blog_id);
}

function reprint_push_apply_term_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    $term_id = reprint_push_term_row_id($id);
    $existing = $wpdb->get_row(
        $wpdb->prepare("SELECT term_id, slug FROM {$wpdb->terms} WHERE term_id = %d", $term_id),
        ARRAY_A
    );
    if (is_array($existing) && !reprint_push_is_fixture_term($term_id, (string) ($existing['slug'] ?? ''))) {
        throw new RuntimeException('Refusing to mutate non-fixture term: ' . $id);
    }

    if ($is_delete) {
        if (is_array($existing)) {
            $wpdb->delete($wpdb->terms, ['term_id' => $term_id], ['%d']);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Term row payload must be an object');
    }
    if ((int) ($value['term_id'] ?? 0) !== $term_id) {
        throw new RuntimeException('Term row payload does not match row id: ' . $id);
    }
    $slug = (string) ($value['slug'] ?? '');
    if (!reprint_push_is_fixture_term($term_id, $slug)) {
        throw new RuntimeException('Unsupported fixture term slug: ' . $slug);
    }

    $result = $wpdb->replace(
        $wpdb->terms,
        [
            'term_id' => $term_id,
            'name' => (string) ($value['name'] ?? ''),
            'slug' => $slug,
            'term_group' => (int) ($value['term_group'] ?? 0),
        ],
        ['%d', '%s', '%s', '%d']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply term row: ' . $wpdb->last_error);
    }
}

function reprint_push_apply_term_taxonomy_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    $term_taxonomy_id = reprint_push_term_taxonomy_row_id($id);
    $existing = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT tt.term_taxonomy_id, tt.term_id, t.slug
             FROM {$wpdb->term_taxonomy} tt
             LEFT JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
             WHERE tt.term_taxonomy_id = %d",
            $term_taxonomy_id
        ),
        ARRAY_A
    );
    if (is_array($existing) && !reprint_push_is_fixture_term((int) ($existing['term_id'] ?? 0), (string) ($existing['slug'] ?? ''))) {
        throw new RuntimeException('Refusing to mutate non-fixture term taxonomy: ' . $id);
    }

    if ($is_delete) {
        if (is_array($existing)) {
            $wpdb->delete($wpdb->term_taxonomy, ['term_taxonomy_id' => $term_taxonomy_id], ['%d']);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Term taxonomy row payload must be an object');
    }
    if ((int) ($value['term_taxonomy_id'] ?? 0) !== $term_taxonomy_id) {
        throw new RuntimeException('Term taxonomy row payload does not match row id: ' . $id);
    }
    $term_id = (int) ($value['term_id'] ?? 0);
    $taxonomy = (string) ($value['taxonomy'] ?? '');
    if ($term_id <= 0 || !in_array($taxonomy, reprint_push_supported_fixture_taxonomies(), true)) {
        throw new RuntimeException('Unsupported fixture term taxonomy row: ' . $id);
    }

    $result = $wpdb->replace(
        $wpdb->term_taxonomy,
        [
            'term_taxonomy_id' => $term_taxonomy_id,
            'term_id' => $term_id,
            'taxonomy' => $taxonomy,
            'description' => (string) ($value['description'] ?? ''),
            'parent' => (int) ($value['parent'] ?? 0),
            'count' => (int) ($value['count'] ?? 0),
        ],
        ['%d', '%d', '%s', '%s', '%d', '%d']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply term taxonomy row: ' . $wpdb->last_error);
    }
}

function reprint_push_apply_term_relationship_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    [$object_id, $term_taxonomy_id] = reprint_push_parse_term_relationship_row_id($id);
    if (!reprint_push_is_fixture_post($object_id)) {
        throw new RuntimeException('Refusing to mutate term relationship for non-fixture post: ' . $id);
    }

    if ($is_delete) {
        $wpdb->delete(
            $wpdb->term_relationships,
            ['object_id' => $object_id, 'term_taxonomy_id' => $term_taxonomy_id],
            ['%d', '%d']
        );
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Term relationship row payload must be an object');
    }
    if ((int) ($value['object_id'] ?? 0) !== $object_id || (int) ($value['term_taxonomy_id'] ?? 0) !== $term_taxonomy_id) {
        throw new RuntimeException('Term relationship row payload does not match row id: ' . $id);
    }

    $result = $wpdb->replace(
        $wpdb->term_relationships,
        [
            'object_id' => $object_id,
            'term_taxonomy_id' => $term_taxonomy_id,
            'term_order' => (int) ($value['term_order'] ?? 0),
        ],
        ['%d', '%d', '%d']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply term relationship row: ' . $wpdb->last_error);
    }
}

function reprint_push_apply_termmeta_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    $meta_id = reprint_push_termmeta_row_id($id);
    $existing = $wpdb->get_row(
        $wpdb->prepare("SELECT meta_id, term_id, meta_key FROM {$wpdb->termmeta} WHERE meta_id = %d", $meta_id),
        ARRAY_A
    );
    if (is_array($existing) && !in_array((string) ($existing['meta_key'] ?? ''), reprint_push_fixture_termmeta_export_keys(), true)) {
        throw new RuntimeException('Refusing to mutate non-fixture termmeta: ' . $id);
    }

    if ($is_delete) {
        if (is_array($existing)) {
            $wpdb->delete($wpdb->termmeta, ['meta_id' => $meta_id], ['%d']);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Termmeta row payload must be an object');
    }
    if ((int) ($value['meta_id'] ?? 0) !== $meta_id) {
        throw new RuntimeException('Termmeta row payload does not match row id: ' . $id);
    }
    $meta_key = (string) ($value['meta_key'] ?? '');
    if (!in_array($meta_key, reprint_push_fixture_termmeta_export_keys(), true)) {
        throw new RuntimeException('Unsupported fixture termmeta key: ' . $meta_key);
    }
    $term_id = (int) ($value['term_id'] ?? 0);
    if ($term_id <= 0) {
        throw new RuntimeException('Termmeta row payload must include a positive term_id: ' . $id);
    }

    $meta_value = $value['meta_value'] ?? '';
    if (is_array($meta_value) || is_object($meta_value)) {
        $meta_value = wp_json_encode(reprint_push_normalize_snapshot_value($meta_value));
    }

    $result = $wpdb->replace(
        $wpdb->termmeta,
        [
            'meta_id' => $meta_id,
            'term_id' => $term_id,
            'meta_key' => $meta_key,
            'meta_value' => (string) $meta_value,
        ],
        ['%d', '%d', '%s', '%s']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply termmeta row: ' . $wpdb->last_error);
    }
}

function reprint_push_apply_comment_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    $comment_id = reprint_push_comment_row_id($id);
    $existing = $wpdb->get_row(
        $wpdb->prepare("SELECT comment_ID FROM {$wpdb->comments} WHERE comment_ID = %d", $comment_id),
        ARRAY_A
    );
    if (is_array($existing) && !reprint_push_is_fixture_comment($comment_id)) {
        throw new RuntimeException('Refusing to mutate non-fixture comment: ' . $id);
    }

    if ($is_delete) {
        if (is_array($existing)) {
            wp_delete_comment($comment_id, true);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Comment row payload must be an object');
    }
    if ((int) ($value['comment_ID'] ?? 0) !== $comment_id) {
        throw new RuntimeException('Comment row payload does not match row id: ' . $id);
    }
    $comment_post_id = (int) ($value['comment_post_ID'] ?? 0);
    if ($comment_post_id <= 0 || !reprint_push_is_fixture_post($comment_post_id)) {
        throw new RuntimeException('Comment row payload must point at a fixture post: ' . $id);
    }
    $comment_parent = (int) ($value['comment_parent'] ?? 0);
    if ($comment_parent < 0) {
        throw new RuntimeException('Comment row payload has an invalid parent id: ' . $id);
    }
    if ($comment_parent > 0) {
        $parent_exists = $wpdb->get_var(
            $wpdb->prepare("SELECT comment_ID FROM {$wpdb->comments} WHERE comment_ID = %d", $comment_parent)
        );
        if ($parent_exists !== null && !reprint_push_is_fixture_comment($comment_parent)) {
            throw new RuntimeException('Comment row payload points at a non-fixture parent comment: ' . $id);
        }
    }
    if ((string) ($value['comment_agent'] ?? '') !== reprint_push_comment_fixture_agent()) {
        throw new RuntimeException('Comment row payload must include the fixture comment agent: ' . $id);
    }

    $result = $wpdb->replace(
        $wpdb->comments,
        [
            'comment_ID' => $comment_id,
            'comment_post_ID' => $comment_post_id,
            'comment_author' => (string) ($value['comment_author'] ?? ''),
            'comment_author_email' => (string) ($value['comment_author_email'] ?? ''),
            'comment_author_url' => (string) ($value['comment_author_url'] ?? ''),
            'comment_author_IP' => (string) ($value['comment_author_IP'] ?? ''),
            'comment_date' => (string) ($value['comment_date'] ?? ''),
            'comment_date_gmt' => (string) ($value['comment_date_gmt'] ?? ''),
            'comment_content' => (string) ($value['comment_content'] ?? ''),
            'comment_karma' => (int) ($value['comment_karma'] ?? 0),
            'comment_approved' => (string) ($value['comment_approved'] ?? '1'),
            'comment_agent' => (string) ($value['comment_agent'] ?? ''),
            'comment_type' => (string) ($value['comment_type'] ?? 'comment'),
            'comment_parent' => $comment_parent,
            'user_id' => (int) ($value['user_id'] ?? 0),
        ],
        ['%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%d', '%d']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply comment row: ' . $wpdb->last_error);
    }
    clean_comment_cache($comment_id);
}

function reprint_push_apply_commentmeta_row(string $id, bool $is_delete, $value): void
{
    global $wpdb;

    $meta_id = reprint_push_commentmeta_row_id($id);
    $existing = $wpdb->get_row(
        $wpdb->prepare("SELECT meta_id, comment_id, meta_key FROM {$wpdb->commentmeta} WHERE meta_id = %d", $meta_id),
        ARRAY_A
    );
    if (is_array($existing) && !in_array((string) ($existing['meta_key'] ?? ''), reprint_push_fixture_commentmeta_export_keys(), true)) {
        throw new RuntimeException('Refusing to mutate non-fixture commentmeta: ' . $id);
    }

    if ($is_delete) {
        if (is_array($existing)) {
            $wpdb->delete($wpdb->commentmeta, ['meta_id' => $meta_id], ['%d']);
        }
        return;
    }

    if (!is_array($value)) {
        throw new RuntimeException('Commentmeta row payload must be an object');
    }
    if ((int) ($value['meta_id'] ?? 0) !== $meta_id) {
        throw new RuntimeException('Commentmeta row payload does not match row id: ' . $id);
    }
    $meta_key = (string) ($value['meta_key'] ?? '');
    if (!in_array($meta_key, reprint_push_fixture_commentmeta_export_keys(), true)) {
        throw new RuntimeException('Unsupported fixture commentmeta key: ' . $meta_key);
    }
    $comment_id = (int) ($value['comment_id'] ?? 0);
    if ($comment_id <= 0) {
        throw new RuntimeException('Commentmeta row payload must include a positive comment_id: ' . $id);
    }
    $comment_exists = $wpdb->get_var(
        $wpdb->prepare("SELECT comment_ID FROM {$wpdb->comments} WHERE comment_ID = %d", $comment_id)
    );
    if ($comment_exists !== null && !reprint_push_is_fixture_comment($comment_id)) {
        throw new RuntimeException('Refusing to mutate commentmeta for non-fixture comment: ' . $id);
    }

    $meta_value = $value['meta_value'] ?? '';
    if (is_array($meta_value) || is_object($meta_value)) {
        $meta_value = wp_json_encode(reprint_push_normalize_snapshot_value($meta_value));
    }

    $result = $wpdb->replace(
        $wpdb->commentmeta,
        [
            'meta_id' => $meta_id,
            'comment_id' => $comment_id,
            'meta_key' => $meta_key,
            'meta_value' => (string) $meta_value,
        ],
        ['%d', '%d', '%s', '%s']
    );
    if ($result === false) {
        throw new RuntimeException('Could not apply commentmeta row: ' . $wpdb->last_error);
    }
    wp_cache_delete($comment_id, 'comment_meta');
}

function reprint_push_apply_forms_lab_row(string $id, bool $is_delete, $value): void
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

function reprint_push_blog_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'blog_id');
    if ($row_id < 1 || $id !== 'blog_id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported blog row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_forms_lab_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'id');
    if ($row_id < 1 || $id !== 'id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_term_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'term_id');
    if ($row_id < 1 || $id !== 'term_id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported term row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_term_taxonomy_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'term_taxonomy_id');
    if ($row_id < 1 || $id !== 'term_taxonomy_id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported term taxonomy row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_parse_term_relationship_row_id(string $id): array
{
    if (!preg_match('/^object_id:([1-9]\d*)\|term_taxonomy_id:([1-9]\d*)$/', $id, $matches)) {
        throw new RuntimeException('Unsupported term relationship row id: ' . $id);
    }
    return [(int) $matches[1], (int) $matches[2]];
}

function reprint_push_term_relationship_row_id(int $object_id, int $term_taxonomy_id): string
{
    if ($object_id <= 0 || $term_taxonomy_id <= 0) {
        throw new RuntimeException('Unsupported term relationship ids.');
    }
    return 'object_id:' . $object_id . '|term_taxonomy_id:' . $term_taxonomy_id;
}

function reprint_push_termmeta_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'meta_id');
    if ($row_id < 1 || $id !== 'meta_id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported termmeta row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_comment_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'comment_ID');
    if ($row_id < 1 || $id !== 'comment_ID:' . (string) $row_id) {
        throw new RuntimeException('Unsupported comment row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_commentmeta_row_id(string $id): int
{
    $row_id = reprint_push_numeric_id($id, 'meta_id');
    if ($row_id < 1 || $id !== 'meta_id:' . (string) $row_id) {
        throw new RuntimeException('Unsupported commentmeta row id: ' . $id);
    }
    return $row_id;
}

function reprint_push_is_fixture_term(int $term_id, string $slug = ''): bool
{
    if ($term_id <= 0) {
        return false;
    }
    if ($slug !== '' && str_starts_with($slug, 'reprint-push-taxonomy-')) {
        return true;
    }
    return get_term_meta($term_id, reprint_push_taxonomy_fixture_meta_key(), true) !== '';
}

function reprint_push_is_fixture_comment(int $comment_id): bool
{
    global $wpdb;

    if ($comment_id <= 0) {
        return false;
    }
    $agent = $wpdb->get_var(
        $wpdb->prepare("SELECT comment_agent FROM {$wpdb->comments} WHERE comment_ID = %d", $comment_id)
    );
    if ((string) $agent === reprint_push_comment_fixture_agent()) {
        return true;
    }
    return get_comment_meta($comment_id, reprint_push_comment_fixture_meta_key(), true) !== '';
}

function reprint_push_is_fixture_blog(int $blog_id): bool
{
    global $wpdb;

    if ($blog_id <= 0 || !function_exists('is_multisite') || !is_multisite()) {
        return false;
    }
    $table_name = reprint_push_blogmeta_table_name();
    if (!reprint_push_table_exists($table_name)) {
        return false;
    }
    $count = $wpdb->get_var(
        $wpdb->prepare(
            'SELECT COUNT(*) FROM ' . reprint_push_quote_identifier($table_name) . ' WHERE blog_id = %d AND meta_key = %s AND meta_value <> %s',
            $blog_id,
            reprint_push_blog_fixture_meta_key(),
            ''
        )
    );
    return (int) $count > 0;
}

function reprint_push_blogmeta_row_count(int $blog_id, string $meta_key): int
{
    global $wpdb;

    $table_name = reprint_push_blogmeta_table_name();
    if (!reprint_push_table_exists($table_name)) {
        return 0;
    }
    return (int) $wpdb->get_var(
        $wpdb->prepare(
            'SELECT COUNT(*) FROM ' . reprint_push_quote_identifier($table_name) . ' WHERE blog_id = %d AND meta_key = %s',
            $blog_id,
            $meta_key
        )
    );
}

function reprint_push_validate_blogmeta_row_value(string $id, $value): array
{
    [$blog_id, $meta_key] = reprint_push_parse_blogmeta_row_id($id);
    if (!is_array($value) || !array_key_exists('meta_value', $value)) {
        throw new RuntimeException('Blogmeta row payload must include meta_value: ' . $id);
    }
    $allowed_keys = ['blog_id', 'meta_key', 'meta_value'];
    foreach (array_keys($value) as $key) {
        if (!in_array((string) $key, $allowed_keys, true)) {
            throw new RuntimeException('Unsupported blogmeta row column: ' . (string) $key);
        }
    }
    if ((int) ($value['blog_id'] ?? 0) !== $blog_id || (string) ($value['meta_key'] ?? '') !== $meta_key) {
        throw new RuntimeException('Blogmeta row payload does not match row id: ' . $id);
    }
    return [$blog_id, $meta_key];
}

function reprint_push_clean_blogmeta_cache(int $blog_id): void
{
    if (function_exists('wp_cache_delete')) {
        wp_cache_delete($blog_id, 'blog_meta');
    }
    if (function_exists('clean_site_cache')) {
        clean_site_cache($blog_id);
    }
}

function reprint_push_supported_fixture_taxonomies(): array
{
    return ['category', 'post_tag', 'post_format'];
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

function reprint_push_allowed_plugin_option_names(): array
{
    return array_keys(reprint_push_allowed_plugin_options());
}

function reprint_push_core_page_option_names(): array
{
    return [
        'page_on_front',
        'page_for_posts',
    ];
}

function reprint_push_assert_core_page_option_payload_supported(string $option_name, array $value): void
{
    if (!in_array($option_name, reprint_push_core_page_option_names(), true)) {
        return;
    }
    $option_value = $value['option_value'] ?? null;
    if ($option_value === '' || $option_value === '0' || $option_value === 0 || $option_value === null) {
        return;
    }
    if (is_int($option_value)) {
        $page_id = $option_value;
    } elseif (is_string($option_value) && preg_match('/^[1-9]\d*$/', $option_value) === 1) {
        $page_id = (int) $option_value;
    } else {
        throw new RuntimeException('Core page option payload must be a positive page id or empty value: ' . $option_name);
    }
    $post = get_post($page_id);
    if (!$post || $post->post_type !== 'page') {
        throw new RuntimeException('Core page option payload must point at an existing page: ' . $option_name);
    }
}

function reprint_push_allowed_plugin_options(): array
{
    return [
        'reprint_push_plugin_payload' => 'forms',
        'reprint_push_forms_fixture' => 'forms',
        'reprint_push_atomic_fixture_data' => 'reprint-push-atomic-dependent-fixture',
    ];
}

function reprint_push_production_owned_release_state_driver(): array
{
    return [
        'driver' => 'reprint-push-release-state',
        'table' => 'wp_reprint_push_release_state',
        'pluginOwner' => 'reprint-push',
        'supportsDelete' => false,
        'exportRowsCallback' => 'reprint_push_export_release_state_driver_rows',
        'applyRowCallback' => 'reprint_push_apply_release_state_driver_row',
        'validateMutationCallback' => 'reprint_push_validate_release_state_driver_mutation',
        'allowlist' => [
            'resourceKeys' => [
                'row:["wp_reprint_push_release_state","state_id:1"]',
            ],
            'rowIds' => [
                'state_id:1',
            ],
            'payloadModes' => [
                'base',
                'local-update',
                'remote-changed',
            ],
        ],
    ];
}

function reprint_push_registered_plugin_owned_row_drivers(): array
{
    $drivers = reprint_push_builtin_plugin_owned_row_drivers();
    foreach (reprint_push_plugin_owned_row_driver_registry() as $driver_name => $driver) {
        $drivers[$driver_name] = $driver;
    }
    $drivers = apply_filters('reprint_push_plugin_owned_row_drivers', $drivers);
    if (!is_array($drivers)) {
        return [];
    }

    return reprint_push_normalize_plugin_owned_row_drivers($drivers);
}

function reprint_push_register_plugin_owned_row_driver(array $driver): array
{
    $registered = reprint_push_normalize_plugin_owned_row_driver($driver, null);
    $registered_driver_name = (string) $registered['driver'];
    $registered_table = (string) $registered['table'];

    $existing_drivers = reprint_push_normalize_plugin_owned_row_drivers(
        reprint_push_builtin_plugin_owned_row_drivers() + reprint_push_plugin_owned_row_driver_registry()
    );
    if (array_key_exists($registered_driver_name, $existing_drivers)) {
        throw new RuntimeException('duplicate driver name: ' . $registered_driver_name);
    }
    foreach ($existing_drivers as $existing_driver) {
        if ((string) ($existing_driver['table'] ?? '') === $registered_table) {
            throw new RuntimeException('duplicate table mapping for table: ' . $registered_table);
        }
    }

    $GLOBALS['reprint_push_plugin_owned_row_driver_registry'][$registered_driver_name] = $registered;
    return $registered;
}

function reprint_push_plugin_owned_row_driver_registry(): array
{
    $registry = $GLOBALS['reprint_push_plugin_owned_row_driver_registry'] ?? [];
    return is_array($registry) ? $registry : [];
}

function reprint_push_builtin_plugin_owned_row_drivers(): array
{
    return [
        'reprint-push-release-state' => reprint_push_production_owned_release_state_driver(),
    ];
}

function reprint_push_normalize_plugin_owned_row_drivers(array $drivers): array
{
    $normalized = [];
    $table_map = [];
    foreach ($drivers as $key => $driver) {
        if (!is_array($driver)) {
            continue;
        }
        $driver = reprint_push_normalize_plugin_owned_row_driver($driver, is_string($key) ? $key : null);
        $driver_name = (string) $driver['driver'];
        $table = (string) $driver['table'];
        if (array_key_exists($driver_name, $normalized)) {
            throw new RuntimeException('duplicate driver name: ' . $driver_name);
        }
        if (array_key_exists($table, $table_map)) {
            throw new RuntimeException('duplicate table mapping for table: ' . $table);
        }
        $normalized[$driver_name] = $driver;
        $table_map[$table] = $driver_name;
    }

    return $normalized;
}

function reprint_push_normalize_plugin_owned_row_driver(array $driver, ?string $fallback_name): array
{
    $driver_name = (string) ($driver['driver'] ?? ($fallback_name ?? ''));
    $table = (string) ($driver['table'] ?? '');
    $plugin_owner = (string) ($driver['pluginOwner'] ?? '');
    if ($driver_name === '' || $table === '' || $plugin_owner === '') {
        if ($driver_name === '') {
            throw new RuntimeException('missing driver name for table: ' . $table);
        }
        if ($table === '') {
            throw new RuntimeException('missing table for driver: ' . $driver_name);
        }
        throw new RuntimeException('missing pluginOwner for driver: ' . $driver_name);
    }
    if (!isset($driver['exportRowsCallback']) || !is_callable($driver['exportRowsCallback'])) {
        throw new RuntimeException('missing exportRowsCallback for driver: ' . $driver_name);
    }
    if (!isset($driver['applyRowCallback']) || !is_callable($driver['applyRowCallback'])) {
        throw new RuntimeException('missing applyRowCallback for driver: ' . $driver_name);
    }
    if (!isset($driver['validateMutationCallback']) || !is_callable($driver['validateMutationCallback'])) {
        throw new RuntimeException('missing validateMutationCallback for driver: ' . $driver_name);
    }
    $normalized = $driver + [
        'driver' => $driver_name,
        'table' => $table,
        'pluginOwner' => $plugin_owner,
    ];
    if (array_key_exists('rowSchema', $driver)) {
        $normalized['rowSchema'] = reprint_push_normalize_plugin_owned_row_driver_row_schema($driver['rowSchema']);
    }
    if (array_key_exists('mergePolicy', $driver)) {
        $normalized['mergePolicy'] = reprint_push_normalize_plugin_owned_row_driver_merge_policy($driver['mergePolicy']);
    }
    if (array_key_exists('referenceFields', $driver) || array_key_exists('rowReferences', $driver)) {
        $reference_fields = $driver['referenceFields'] ?? $driver['rowReferences'];
        if (!is_array($reference_fields)) {
            throw new RuntimeException('Plugin-owned row driver referenceFields must be an object.');
        }
        $normalized['referenceFields'] = reprint_push_normalize_plugin_owned_row_driver_reference_fields($reference_fields);
    }
    return $normalized;
}

function reprint_push_plugin_owned_row_driver_for_table(string $table): ?array
{
    foreach (reprint_push_registered_plugin_owned_row_drivers() as $driver) {
        if ((string) ($driver['table'] ?? '') === $table) {
            return $driver;
        }
    }
    return null;
}

function reprint_push_plugin_owned_row_driver_by_name(string $name): ?array
{
    $drivers = reprint_push_registered_plugin_owned_row_drivers();
    return $drivers[$name] ?? null;
}

function reprint_push_export_registered_plugin_owned_rows(array &$snapshot): void
{
    foreach (reprint_push_registered_plugin_owned_row_drivers() as $driver) {
        $callback = $driver['exportRowsCallback'] ?? null;
        if (!is_string($callback) || $callback === '' || !is_callable($callback)) {
            continue;
        }
        $callback($snapshot, $driver);
    }
}

function reprint_push_export_release_state_driver_rows(array &$snapshot, array $driver): void
{
    global $wpdb;

    $table_name = reprint_push_release_state_driver_storage_table();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists !== $table_name) {
        return;
    }

    $snapshot_table = (string) ($driver['table'] ?? 'wp_reprint_push_release_state');
    if ($snapshot_table !== 'wp_reprint_push_release_state') {
        return;
    }
    if (!isset($snapshot['db'][$snapshot_table]) || !is_array($snapshot['db'][$snapshot_table])) {
        $snapshot['db'][$snapshot_table] = [];
    }

    $rows = $wpdb->get_results(
        "SELECT state_id, payload_json, updated_marker FROM {$table_name} WHERE state_id = 1 ORDER BY state_id ASC",
        ARRAY_A
    );

    foreach ($rows as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        $snapshot['db'][$snapshot_table]['state_id:' . (int) $row['state_id']] = [
            'state_id' => (int) $row['state_id'],
            'payload' => json_last_error() === JSON_ERROR_NONE && is_array($payload)
                ? reprint_push_normalize_snapshot_value($payload)
                : [],
            'updated_marker' => (string) $row['updated_marker'],
            '__pluginOwner' => 'reprint-push',
        ];
    }
}

function reprint_push_apply_release_state_driver_row(string $id, bool $is_delete, $value, array $driver): void
{
    global $wpdb;

    if ((string) ($driver['driver'] ?? '') !== 'reprint-push-release-state'
        || (string) ($driver['pluginOwner'] ?? '') !== 'reprint-push'
        || (string) ($driver['table'] ?? '') !== 'wp_reprint_push_release_state') {
        throw new RuntimeException('Unsupported release state driver registration.');
    }
    if ($id !== 'state_id:1') {
        throw new RuntimeException('Unsupported release state driver row id: ' . $id);
    }
    if ($is_delete) {
        throw new RuntimeException('Release state driver does not support deletes: ' . $id);
    }
    if (!is_array($value) || array_is_list($value)) {
        throw new RuntimeException('Release state driver payload must be an object.');
    }
    reprint_push_validate_release_state_driver_value($value);

    $table_name = reprint_push_release_state_driver_storage_table();
    $wpdb->query('CREATE TABLE IF NOT EXISTS ' . $table_name . ' (state_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (state_id)) ' . $wpdb->get_charset_collate());
    $payload_json = wp_json_encode(reprint_push_normalize_snapshot_value($value['payload']));
    if (!is_string($payload_json)) {
        throw new RuntimeException('Could not encode release state driver payload.');
    }

    $sql = $wpdb->prepare(
        'INSERT INTO ' . $table_name . ' (state_id, payload_json, updated_marker) VALUES (%d, %s, %s) ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), updated_marker = VALUES(updated_marker)',
        1,
        $payload_json,
        (string) $value['updated_marker']
    );
    if ($wpdb->query($sql) === false) {
        throw new RuntimeException('Could not apply release state driver row: ' . $wpdb->last_error);
    }
}

function reprint_push_validate_release_state_driver_mutation(array $mutation, array $snapshot, array $driver): bool
{
    $resource = is_array($mutation['resource'] ?? null) ? $mutation['resource'] : [];
    if ((string) ($driver['driver'] ?? '') !== 'reprint-push-release-state'
        || (string) ($driver['pluginOwner'] ?? '') !== 'reprint-push'
        || (string) ($driver['table'] ?? '') !== 'wp_reprint_push_release_state'
        || (string) ($resource['table'] ?? '') !== 'wp_reprint_push_release_state'
        || (string) ($resource['id'] ?? '') !== 'state_id:1'
        || (string) ($mutation['resourceKey'] ?? '') !== 'row:["wp_reprint_push_release_state","state_id:1"]') {
        return false;
    }
    if (!empty($mutation['value']['absent'])) {
        return false;
    }
    $value = is_array($mutation['value']['value'] ?? null) ? $mutation['value']['value'] : null;
    if (!is_array($value)) {
        return false;
    }

    reprint_push_validate_release_state_driver_value($value);
    return true;
}

function reprint_push_validate_release_state_driver_value(array $value): void
{
    $allowed_keys = ['state_id', 'payload', 'updated_marker', '__pluginOwner'];
    foreach (array_keys($value) as $key) {
        if (!in_array($key, $allowed_keys, true)) {
            throw new RuntimeException('Unsupported release state driver payload key: ' . (string) $key);
        }
    }
    if ((int) ($value['state_id'] ?? 0) !== 1) {
        throw new RuntimeException('Release state driver payload does not match state_id:1.');
    }
    if ((string) ($value['__pluginOwner'] ?? '') !== 'reprint-push') {
        throw new RuntimeException('Release state driver payload owner must be reprint-push.');
    }
    if (!is_array($value['payload'] ?? null) || array_is_list($value['payload'])) {
        throw new RuntimeException('Release state driver payload must include an object payload.');
    }
    $payload = $value['payload'];
    $payload_allowed_keys = ['owner', 'mode', 'version', 'releaseBoundaryProof'];
    foreach (array_keys($payload) as $key) {
        if (!in_array($key, $payload_allowed_keys, true)) {
            throw new RuntimeException('Unsupported release state driver nested payload key: ' . (string) $key);
        }
    }
    if ((string) ($payload['owner'] ?? '') !== 'reprint-push') {
        throw new RuntimeException('Release state driver nested payload owner must be reprint-push.');
    }
    if (!in_array((string) ($payload['mode'] ?? ''), ['base', 'local-update', 'remote-changed'], true)) {
        throw new RuntimeException('Unsupported release state driver payload mode.');
    }
    if (!in_array((int) ($payload['version'] ?? 0), [1, 2, 3], true)) {
        throw new RuntimeException('Unsupported release state driver payload version.');
    }
    if ((string) ($payload['releaseBoundaryProof'] ?? '') !== 'plugin-driver-boundary') {
        throw new RuntimeException('Release state driver payload proof marker is missing.');
    }
    if (!preg_match('/^(base|local-update|remote-changed)$/', (string) ($value['updated_marker'] ?? ''))) {
        throw new RuntimeException('Unsupported release state driver updated_marker.');
    }
}

function reprint_push_release_state_driver_storage_table(): string
{
    global $wpdb;

    $prefix = (string) $wpdb->prefix;
    if (!preg_match('/^[A-Za-z0-9_]+$/', $prefix)) {
        throw new RuntimeException('Unsupported WordPress table prefix for release state driver table.');
    }
    return $prefix . 'reprint_push_release_state';
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
    $policy = is_array($mutation['pluginOwnedResource'] ?? null)
        ? $mutation['pluginOwnedResource']
        : null;
    $registered_driver_for_table = reprint_push_plugin_owned_row_driver_for_table((string) ($resource['table'] ?? ''));
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
    if ($owner === null && is_array($policy)) {
        $owner = $policy['pluginOwner'] ?? null;
        if ($owner === null && is_array($policy['contractValidationEvidence'] ?? null)) {
            $owner = $policy['contractValidationEvidence']['pluginOwner'] ?? null;
        }
    }
    if ($owner === null && is_array($registered_driver_for_table)) {
        $owner = $registered_driver_for_table['pluginOwner'] ?? null;
    }
    if ($owner === null) {
        return;
    }

    $driver = is_array($policy) ? (string) ($policy['driver'] ?? '') : '';
    if ($driver === '' && is_array($registered_driver_for_table)) {
        $driver = (string) ($registered_driver_for_table['driver'] ?? '');
    }
    if ($driver === 'fixture-forms-lab-table'
        && (string) $owner === 'forms'
        && (string) ($resource['table'] ?? '') === 'wp_reprint_push_forms_lab'
        && preg_match('/^id:[1-9]\d*$/', (string) ($resource['id'] ?? ''))
        && empty($mutation['value']['absent'])
        && reprint_push_valid_fixture_forms_lab_driver_evidence($policy['driverEvidence'] ?? null, $snapshot)
    ) {
        return;
    }

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
    $registered_driver = reprint_push_plugin_owned_row_driver_by_name($driver);
    if (is_array($registered_driver)
        && (string) ($registered_driver['pluginOwner'] ?? '') === (string) $owner
        && (string) ($registered_driver['table'] ?? '') === (string) ($resource['table'] ?? '')
    ) {
        if (!empty($mutation['value']['absent']) && empty($registered_driver['supportsDelete'])) {
            throw new RuntimeException('Unsupported plugin-owned mutation delete for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
        }
        reprint_push_assert_plugin_owned_driver_contract_bound_mutation(
            $mutation,
            (string) $owner,
            $driver,
            $registered_driver,
            $planned,
            $snapshot
        );
        $callback = $registered_driver['validateMutationCallback'] ?? null;
        if (!is_string($callback) || $callback === '' || !is_callable($callback)) {
            throw new RuntimeException('Unsupported plugin-owned mutation driver for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
        }
        if (!$callback($mutation, $snapshot, $registered_driver)) {
            throw new RuntimeException('Unsupported plugin-owned mutation driver for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
        }
        return;
    }

    throw new RuntimeException('Unsupported plugin-owned mutation driver for ' . (string) ($mutation['resourceKey'] ?? 'unknown'));
}

function reprint_push_assert_plugin_owned_driver_contract_bound_mutation(
    array $mutation,
    string $owner,
    string $driver,
    array $registered_driver,
    array $planned,
    array $snapshot
): void {
    $resource_key = (string) ($mutation['resourceKey'] ?? '');
    $resource = is_array($mutation['resource'] ?? null) ? $mutation['resource'] : [];
    $policy = is_array($mutation['pluginOwnedResource'] ?? null) ? $mutation['pluginOwnedResource'] : [];
    $table = (string) ($resource['table'] ?? '');
    $supports_delete = !empty($policy['supportsDelete']);
    $registered_supports_delete = !empty($registered_driver['supportsDelete']);
    $action = !empty($mutation['value']['absent']) ? 'delete' : 'put';

    if ($resource_key === '' || ($resource['type'] ?? null) !== 'row') {
        throw new RuntimeException('Unsupported plugin-owned mutation contract for ' . ($resource_key !== '' ? $resource_key : 'unknown'));
    }
    if (reprint_push_resource_object_key($resource) !== $resource_key) {
        throw new RuntimeException('Unsupported plugin-owned mutation contract for ' . $resource_key);
    }
    if ((string) ($policy['pluginOwner'] ?? '') !== $owner
        || (string) ($policy['driver'] ?? '') !== $driver
        || (string) ($policy['table'] ?? '') !== $table
        || $supports_delete !== $registered_supports_delete) {
        throw new RuntimeException('Unsupported plugin-owned mutation contract for ' . $resource_key);
    }

    $contract = is_array($policy['contractValidationEvidence'] ?? null)
        ? $policy['contractValidationEvidence']
        : null;
    if (!reprint_push_plugin_driver_contract_evidence_accepted($contract, $resource_key, $owner, $driver, $table, $supports_delete)) {
        throw new RuntimeException('Unsupported plugin-owned mutation contract for ' . $resource_key);
    }

    $payload_evidence = is_array($policy['driverPayloadValidationEvidence'] ?? null)
        ? $policy['driverPayloadValidationEvidence']
        : null;
    if (!reprint_push_plugin_driver_payload_evidence_accepted(
        $payload_evidence,
        $contract,
        $resource_key,
        $owner,
        $driver,
        $table,
        $supports_delete,
        $action,
        $planned
    )) {
        throw new RuntimeException('Unsupported plugin-owned mutation payload evidence for ' . $resource_key);
    }

    if (is_array($payload_evidence['referenceValidation'] ?? null)) {
        $reference_target_evidence = is_array($policy['referenceTargetValidationEvidence'] ?? null)
            ? $policy['referenceTargetValidationEvidence']
            : null;
        if (!reprint_push_plugin_driver_reference_target_evidence_accepted(
            $reference_target_evidence,
            $contract,
            $payload_evidence,
            $resource_key,
            $owner,
            $driver,
            $table,
            $snapshot
        )) {
            throw new RuntimeException('Unsupported plugin-owned mutation reference target evidence for ' . $resource_key);
        }
    } elseif (array_key_exists('referenceTargetValidationEvidence', $policy)) {
        throw new RuntimeException('Unsupported plugin-owned mutation reference target evidence for ' . $resource_key);
    }
}

function reprint_push_plugin_driver_contract_evidence_accepted(
    ?array $evidence,
    string $resource_key,
    string $owner,
    string $driver,
    string $table,
    bool $supports_delete
): bool {
    if (!is_array($evidence)) {
        return false;
    }
    $expected_keys = [
        'schemaVersion',
        'operation',
        'contractKind',
        'contractVersion',
        'outcome',
        'reasonCode',
        'issueCodes',
        'issues',
        'source',
        'evidenceScope',
        'rawValuesIncluded',
        'resourceKey',
        'pluginOwner',
        'driver',
        'table',
        'supportsDelete',
        'contractHash',
    ];
    if (array_key_exists('rowSchema', $evidence)) {
        $expected_keys[] = 'rowSchema';
    }
    if (array_key_exists('mergePolicy', $evidence)) {
        $expected_keys[] = 'mergePolicy';
    }
    if (array_key_exists('referenceFields', $evidence)) {
        $expected_keys[] = 'referenceFields';
    }
    if (!reprint_push_array_has_exact_keys($evidence, $expected_keys)) {
        return false;
    }
    $row_schema = null;
    if (array_key_exists('rowSchema', $evidence)) {
        if (!is_array($evidence['rowSchema'] ?? null)) {
            return false;
        }
        try {
            $row_schema = reprint_push_normalize_plugin_owned_row_driver_row_schema($evidence['rowSchema']);
        } catch (Throwable $error) {
            return false;
        }
        if ($evidence['rowSchema'] !== $row_schema) {
            return false;
        }
    }
    $merge_policy = null;
    if (array_key_exists('mergePolicy', $evidence)) {
        if (!is_array($evidence['mergePolicy'] ?? null)) {
            return false;
        }
        try {
            $merge_policy = reprint_push_normalize_plugin_owned_row_driver_merge_policy($evidence['mergePolicy']);
        } catch (Throwable $error) {
            return false;
        }
        if ($evidence['mergePolicy'] !== $merge_policy) {
            return false;
        }
    }
    $reference_fields = null;
    if (array_key_exists('referenceFields', $evidence)) {
        if (!is_array($evidence['referenceFields'] ?? null)) {
            return false;
        }
        try {
            $reference_fields = reprint_push_normalize_plugin_owned_row_driver_reference_fields($evidence['referenceFields']);
        } catch (Throwable $error) {
            return false;
        }
        if ($evidence['referenceFields'] !== $reference_fields) {
            return false;
        }
    }
    return ($evidence['reasonCode'] ?? null) === 'PLUGIN_DRIVER_CONTRACT_ACCEPTED'
        && ($evidence['schemaVersion'] ?? null) === 1
        && ($evidence['operation'] ?? null) === 'plugin-driver-contract-validation'
        && ($evidence['contractKind'] ?? null) === REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_KIND
        && ($evidence['contractVersion'] ?? null) === REPRINT_PUSH_PLUGIN_OWNED_ROW_DRIVER_CONTRACT_VERSION
        && ($evidence['outcome'] ?? null) === 'accepted'
        && isset($evidence['issueCodes'])
        && is_array($evidence['issueCodes'])
        && count($evidence['issueCodes']) === 0
        && isset($evidence['issues'])
        && is_array($evidence['issues'])
        && count($evidence['issues']) === 0
        && ($evidence['rawValuesIncluded'] ?? null) === false
        && ($evidence['resourceKey'] ?? null) === $resource_key
        && ($evidence['pluginOwner'] ?? null) === $owner
        && ($evidence['driver'] ?? null) === $driver
        && ($evidence['table'] ?? null) === $table
        && ($evidence['supportsDelete'] ?? null) === $supports_delete
        && ($evidence['contractHash'] ?? null) === reprint_push_plugin_owned_row_driver_contract_hash(
            $resource_key,
            $owner,
            $driver,
            $table,
            $supports_delete,
            $row_schema,
            $merge_policy,
            $reference_fields
        );
}

function reprint_push_plugin_driver_payload_evidence_accepted(
    ?array $evidence,
    array $contract,
    string $resource_key,
    string $owner,
    string $driver,
    string $table,
    bool $supports_delete,
    string $action,
    array $planned
): bool {
    if (!is_array($evidence)) {
        return false;
    }
    $expected_payload_keys = [
        'schemaVersion',
        'operation',
        'validator',
        'reasonCode',
        'outcome',
        'issueCodes',
        'issues',
        'format',
        'rawValuesIncluded',
        'resourceKey',
        'pluginOwner',
        'driver',
        'table',
        'action',
        'supportsDelete',
        'contractSupportsDelete',
        'contractHash',
        'rowIdentity',
        'value',
        'contractValidationHash',
    ];
    $contract_row_schema = null;
    if (array_key_exists('rowSchema', $contract)) {
        if (!is_array($contract['rowSchema'] ?? null)) {
            return false;
        }
        try {
            $contract_row_schema = reprint_push_normalize_plugin_owned_row_driver_row_schema($contract['rowSchema']);
        } catch (Throwable $error) {
            return false;
        }
        $expected_payload_keys[] = 'schemaValidation';
    }
    $contract_reference_fields = null;
    if (array_key_exists('referenceFields', $contract)) {
        if (!is_array($contract['referenceFields'] ?? null)) {
            return false;
        }
        try {
            $contract_reference_fields = reprint_push_normalize_plugin_owned_row_driver_reference_fields($contract['referenceFields']);
        } catch (Throwable $error) {
            return false;
        }
        $expected_payload_keys[] = 'referenceValidation';
    }
    if (!reprint_push_array_has_exact_keys($evidence, $expected_payload_keys)) {
        return false;
    }
    $expected_state = !empty($planned['exists']) ? 'present' : 'absent';
    $expected_hash = !empty($planned['exists'])
        ? hash('sha256', reprint_push_stable_json($planned['value']))
        : hash('sha256', '"__REPRINT_PUSH_ABSENT__"');
    $value_evidence = is_array($evidence['value'] ?? null) ? $evidence['value'] : [];
    if (!reprint_push_array_has_exact_keys($value_evidence, ['state', 'hash'])) {
        return false;
    }
    $row_identity_evidence = is_array($evidence['rowIdentity'] ?? null) ? $evidence['rowIdentity'] : [];
    $expected_row_identity = reprint_push_plugin_driver_payload_row_identity_evidence(
        $resource_key,
        $action,
        $planned
    );
    if (!reprint_push_plugin_driver_payload_row_identity_evidence_matches($row_identity_evidence, $expected_row_identity)) {
        return false;
    }
    $schema_validation_evidence = null;
    if ($contract_row_schema !== null) {
        $schema_validation_evidence = is_array($evidence['schemaValidation'] ?? null)
            ? $evidence['schemaValidation']
            : [];
        $expected_schema_validation = reprint_push_plugin_driver_payload_row_schema_evidence(
            $contract_row_schema,
            $action,
            $planned
        );
        if (!reprint_push_plugin_driver_payload_row_schema_evidence_matches(
            $schema_validation_evidence,
            $expected_schema_validation
        )) {
            return false;
        }
    }
    if ($contract_reference_fields !== null) {
        $reference_validation_evidence = is_array($evidence['referenceValidation'] ?? null)
            ? $evidence['referenceValidation']
            : [];
        $expected_reference_validation = reprint_push_plugin_driver_payload_reference_fields_evidence(
            $contract_reference_fields,
            $action,
            $planned
        );
        if (!reprint_push_plugin_driver_payload_reference_fields_evidence_matches(
            $reference_validation_evidence,
            $expected_reference_validation
        )) {
            return false;
        }
    }
    $planned_owner_matches = $action === 'delete'
        || empty($planned['exists'])
        || (
            is_array($planned['value'] ?? null)
            && (string) ($planned['value']['__pluginOwner'] ?? '') === $owner
        );

    return ($evidence['reasonCode'] ?? null) === 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED'
        && ($evidence['schemaVersion'] ?? null) === 1
        && ($evidence['operation'] ?? null) === 'plugin-driver-payload-validation'
        && ($evidence['validator'] ?? null) === 'contract-bound-row-driver'
        && ($evidence['outcome'] ?? null) === 'accepted'
        && isset($evidence['issueCodes'])
        && is_array($evidence['issueCodes'])
        && count($evidence['issueCodes']) === 0
        && isset($evidence['issues'])
        && is_array($evidence['issues'])
        && count($evidence['issues']) === 0
        && ($evidence['rawValuesIncluded'] ?? null) === false
        && ($evidence['resourceKey'] ?? null) === $resource_key
        && ($evidence['pluginOwner'] ?? null) === $owner
        && ($evidence['driver'] ?? null) === $driver
        && ($evidence['table'] ?? null) === $table
        && ($evidence['action'] ?? null) === $action
        && ($evidence['supportsDelete'] ?? null) === $supports_delete
        && ($evidence['contractSupportsDelete'] ?? null) === ($contract['supportsDelete'] ?? null)
        && ($evidence['contractHash'] ?? null) === ($contract['contractHash'] ?? null)
        && ($evidence['rowIdentity'] ?? null) === $expected_row_identity
        && ($evidence['contractValidationHash'] ?? null) === hash('sha256', reprint_push_stable_json($contract))
        && ($value_evidence['state'] ?? null) === $expected_state
        && ($value_evidence['hash'] ?? null) === $expected_hash
        && $planned_owner_matches;
}

function reprint_push_plugin_driver_payload_row_identity_evidence(
    string $resource_key,
    string $action,
    array $planned
): array {
    [, $resource_id] = reprint_push_parse_wordpress_graph_row_resource_key($resource_key);
    if ($action === 'delete' || empty($planned['exists'])) {
        return [
            'resourceId' => $resource_id,
            'status' => 'not-required',
            'fields' => [],
        ];
    }

    $tokens = reprint_push_plugin_driver_payload_row_identity_tokens($resource_id);
    if (count($tokens) === 0) {
        return [
            'resourceId' => $resource_id,
            'status' => 'unsupported',
            'fields' => [],
        ];
    }

    $value = is_array($planned['value'] ?? null) ? $planned['value'] : [];
    $fields = [];
    foreach ($tokens as $token) {
        $field = $token['field'];
        $observed_exists = array_key_exists($field, $value);
        $observed = $observed_exists ? $value[$field] : null;
        $fields[] = [
            'field' => $field,
            'expected' => $token['expected'],
            'observedHash' => $observed_exists ? hash('sha256', reprint_push_stable_json((string) $observed)) : null,
            'matched' => $observed_exists && (string) $observed === $token['expected'],
        ];
    }

    $matched = true;
    foreach ($fields as $field) {
        if (empty($field['matched'])) {
            $matched = false;
            break;
        }
    }

    return [
        'resourceId' => $resource_id,
        'status' => $matched ? 'matched' : 'mismatch',
        'fields' => $fields,
    ];
}

function reprint_push_plugin_driver_reference_target_evidence_accepted(
    ?array $evidence,
    array $contract,
    array $payload_evidence,
    string $resource_key,
    string $owner,
    string $driver,
    string $table,
    array $snapshot
): bool {
    if (!is_array($evidence)) {
        return false;
    }

    $reference_validation = is_array($payload_evidence['referenceValidation'] ?? null)
        ? $payload_evidence['referenceValidation']
        : null;
    if (!is_array($reference_validation) || !is_array($reference_validation['fields'] ?? null)) {
        return false;
    }
    if (!is_array($evidence['fields'] ?? null)) {
        return false;
    }
    if (!reprint_push_array_has_exact_keys($evidence, [
        'schemaVersion',
        'operation',
        'validator',
        'reasonCode',
        'outcome',
        'format',
        'rawValuesIncluded',
        'resourceKey',
        'pluginOwner',
        'driver',
        'table',
        'contractHash',
        'contractValidationHash',
        'payloadValidationHash',
        'referenceValidationHash',
        'referenceFieldCount',
        'fields',
    ])) {
        return false;
    }

    $expected_fields = reprint_push_plugin_driver_reference_target_expected_fields($reference_validation);
    if (count($evidence['fields']) !== count($expected_fields)
        || ($evidence['referenceFieldCount'] ?? null) !== count($expected_fields)) {
        return false;
    }

    if (($evidence['schemaVersion'] ?? null) !== 1
        || ($evidence['operation'] ?? null) !== 'plugin-driver-reference-target-validation'
        || ($evidence['validator'] ?? null) !== 'contract-bound-row-driver-reference-targets'
        || ($evidence['reasonCode'] ?? null) !== 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED'
        || ($evidence['outcome'] ?? null) !== 'accepted'
        || ($evidence['format'] ?? null) !== 'hash-only'
        || ($evidence['rawValuesIncluded'] ?? null) !== false
        || ($evidence['resourceKey'] ?? null) !== $resource_key
        || ($evidence['pluginOwner'] ?? null) !== $owner
        || ($evidence['driver'] ?? null) !== $driver
        || ($evidence['table'] ?? null) !== $table
        || ($evidence['contractHash'] ?? null) !== ($contract['contractHash'] ?? null)
        || ($evidence['contractValidationHash'] ?? null) !== hash('sha256', reprint_push_stable_json($contract))
        || ($evidence['payloadValidationHash'] ?? null) !== hash('sha256', reprint_push_stable_json($payload_evidence))
        || ($evidence['referenceValidationHash'] ?? null) !== hash('sha256', reprint_push_stable_json($reference_validation))) {
        return false;
    }

    foreach ($expected_fields as $expected_field) {
        $carried_field = reprint_push_plugin_driver_reference_target_find_field(
            $evidence['fields'],
            $expected_field
        );
        if (!is_array($carried_field)
            || !reprint_push_plugin_driver_reference_target_field_evidence_accepted(
                $carried_field,
                $expected_field,
                $snapshot
            )) {
            return false;
        }
    }

    return true;
}

function reprint_push_plugin_driver_reference_target_expected_fields(array $reference_validation): array
{
    $fields = [];
    foreach ($reference_validation['fields'] ?? [] as $field) {
        if (!is_array($field)) {
            continue;
        }
        $fields[] = [
            'path' => $field['path'] ?? null,
            'targetTable' => $field['targetTable'] ?? null,
            'targetIdField' => $field['targetIdField'] ?? null,
            'scalarType' => $field['scalarType'] ?? null,
            'required' => $field['required'] ?? null,
            'state' => $field['state'] ?? null,
            'observedType' => $field['observedType'] ?? null,
            'observedHash' => $field['observedHash'] ?? null,
            'targetResourceKey' => $field['targetResourceKey'] ?? null,
        ];
    }
    usort($fields, static function (array $left, array $right): int {
        return strcmp(
            (string) ($left['path'] ?? '') . ':' . (string) ($left['targetResourceKey'] ?? ''),
            (string) ($right['path'] ?? '') . ':' . (string) ($right['targetResourceKey'] ?? '')
        );
    });
    return $fields;
}

function reprint_push_plugin_driver_reference_target_find_field(array $fields, array $expected): ?array
{
    foreach ($fields as $field) {
        if (!is_array($field)) {
            continue;
        }
        if (($field['path'] ?? null) === ($expected['path'] ?? null)
            && ($field['targetResourceKey'] ?? null) === ($expected['targetResourceKey'] ?? null)) {
            return $field;
        }
    }
    return null;
}

function reprint_push_plugin_driver_reference_target_field_evidence_accepted(
    array $field,
    array $expected,
    array $snapshot
): bool {
    foreach ([
        'path',
        'targetTable',
        'targetIdField',
        'scalarType',
        'required',
        'state',
        'observedType',
        'observedHash',
        'targetResourceKey',
    ] as $key) {
        if (($field[$key] ?? null) !== ($expected[$key] ?? null)) {
            return false;
        }
    }

    $target_resource_key = $expected['targetResourceKey'] ?? null;
    if ($target_resource_key === null) {
        if (!reprint_push_array_has_exact_keys($field, [
            'path',
            'targetTable',
            'targetIdField',
            'scalarType',
            'required',
            'state',
            'observedType',
            'observedHash',
            'targetResourceKey',
            'targetStable',
            'reasonCode',
        ])) {
            return false;
        }
        return ($field['targetStable'] ?? null) === true
            && ($field['required'] ?? null) !== true
            && ($field['reasonCode'] ?? null) === 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_NOT_REQUIRED';
    }
    if (!is_string($target_resource_key) || $target_resource_key === '') {
        return false;
    }
    if (!reprint_push_array_has_exact_keys($field, [
        'path',
        'targetTable',
        'targetIdField',
        'scalarType',
        'required',
        'state',
        'observedType',
        'observedHash',
        'targetResourceKey',
        'targetResource',
        'targetPrimaryRow',
        'targetBaseHash',
        'targetLocalHash',
        'targetRemoteHash',
        'targetRemotePresent',
        'targetStable',
        'reasonCode',
        'targetChange',
    ])) {
        return false;
    }
    if (($field['targetStable'] ?? null) !== true
        || ($field['targetRemotePresent'] ?? null) !== true
        || ($field['reasonCode'] ?? null) !== 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_ACCEPTED') {
        return false;
    }

    try {
        [$target_table, $target_id] = reprint_push_parse_wordpress_graph_row_resource_key($target_resource_key);
    } catch (Throwable $error) {
        return false;
    }
    $target_resource = [
        'type' => 'row',
        'table' => $target_table,
        'id' => $target_id,
    ];
    $target_resource_evidence = is_array($field['targetResource'] ?? null)
        ? $field['targetResource']
        : null;
    if ($target_resource_evidence !== [
        'type' => 'row',
        'key' => $target_resource_key,
        'table' => $target_table,
        'id' => $target_id,
    ]) {
        return false;
    }

    $current = reprint_push_get_resource($snapshot, $target_resource);
    if (($current['exists'] ?? false) !== true) {
        return false;
    }
    if (!reprint_push_plugin_driver_reference_target_primary_row_evidence_accepted(
        $field['targetPrimaryRow'] ?? null,
        $target_table,
        $target_id,
        $current['value'] ?? null
    )) {
        return false;
    }
    $current_hash = reprint_push_hash_resource($snapshot, $target_resource);
    return ($field['targetRemoteHash'] ?? null) === $current_hash
        && ($field['targetBaseHash'] ?? null) === ($field['targetChange']['base']['hash'] ?? null)
        && ($field['targetLocalHash'] ?? null) === ($field['targetChange']['local']['hash'] ?? null)
        && ($field['targetRemoteHash'] ?? null) === ($field['targetChange']['remote']['hash'] ?? null)
        && reprint_push_plugin_driver_reference_target_change_evidence_accepted(
            $field['targetChange'] ?? null,
            $current_hash
        );
}

function reprint_push_plugin_driver_reference_target_primary_row_evidence_accepted(
    $evidence,
    string $target_table,
    string $target_id,
    $current_value
): bool {
    if (!is_array($evidence)
        || !reprint_push_array_has_exact_keys($evidence, [
            'targetIdField',
            'expectedHash',
            'observedType',
            'observedHash',
            'matched',
        ])) {
        return false;
    }
    $target_id_field = reprint_push_plugin_driver_reference_target_primary_id_field($target_table);
    $expected_primary_id = reprint_push_plugin_driver_reference_target_primary_id(
        $target_id,
        $target_id_field
    );
    $observed_exists = is_array($current_value)
        && !array_is_list($current_value)
        && $target_id_field !== null
        && array_key_exists($target_id_field, $current_value);
    $observed = $observed_exists ? $current_value[$target_id_field] : null;
    $observed_primary_id = $observed_exists
        ? reprint_push_normalize_plugin_driver_reference_positive_integer($observed)
        : null;
    return ($evidence['targetIdField'] ?? null) === $target_id_field
        && ($evidence['expectedHash'] ?? null) === (
            $expected_primary_id === null
                ? null
                : hash('sha256', reprint_push_stable_json((string) $expected_primary_id))
        )
        && ($evidence['observedType'] ?? null) === (
            $observed_exists
                ? reprint_push_plugin_driver_payload_row_schema_value_type($observed)
                : null
        )
        && ($evidence['observedHash'] ?? null) === (
            $observed_exists
                ? hash('sha256', reprint_push_stable_json((string) $observed))
                : null
        )
        && ($evidence['matched'] ?? null) === true
        && $expected_primary_id !== null
        && $observed_primary_id === $expected_primary_id;
}

function reprint_push_plugin_driver_reference_target_primary_id_field(string $target_table): ?string
{
    $suffix = reprint_push_wordpress_graph_table_suffix($target_table);
    $fields = [
        'posts' => 'ID',
        'users' => 'ID',
        'comments' => 'comment_ID',
        'terms' => 'term_id',
        'term_taxonomy' => 'term_taxonomy_id',
        'blogs' => 'blog_id',
        'site' => 'id',
    ];
    return $suffix !== null ? ($fields[$suffix] ?? null) : null;
}

function reprint_push_plugin_driver_reference_target_primary_id(
    string $target_id,
    ?string $target_id_field
): ?int {
    if ($target_id_field === null) {
        return null;
    }
    $pattern = '/^' . preg_quote($target_id_field, '/') . ':([1-9][0-9]*)$/';
    if (!preg_match($pattern, $target_id, $matches)) {
        return null;
    }
    return (int) $matches[1];
}

function reprint_push_plugin_driver_reference_target_change_evidence_accepted(
    $evidence,
    string $current_remote_hash
): bool {
    if (!is_array($evidence)
        || !reprint_push_array_has_exact_keys($evidence, ['localChange', 'remoteChange', 'base', 'local', 'remote'])) {
        return false;
    }
    if (!is_string($evidence['localChange'] ?? null)
        || !is_string($evidence['remoteChange'] ?? null)) {
        return false;
    }
    foreach (['base', 'local', 'remote'] as $key) {
        $value = is_array($evidence[$key] ?? null) ? $evidence[$key] : null;
        if (!is_array($value)
            || !reprint_push_array_has_exact_keys($value, ['state', 'hash'])
            || !in_array($value['state'] ?? null, ['present', 'absent'], true)
            || !is_string($value['hash'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/', (string) $value['hash'])) {
            return false;
        }
    }
    return ($evidence['remote']['state'] ?? null) === 'present'
        && ($evidence['remote']['hash'] ?? null) === $current_remote_hash;
}

function reprint_push_plugin_driver_payload_row_identity_tokens(string $resource_id): array
{
    if ($resource_id === '') {
        return [];
    }
    $segments = explode('|', $resource_id);
    $tokens = [];
    foreach ($segments as $segment) {
        $separator = strpos($segment, ':');
        if ($separator === false || $separator === 0 || $separator === strlen($segment) - 1) {
            return [];
        }
        $field = substr($segment, 0, $separator);
        $expected = substr($segment, $separator + 1);
        if ($field === '' || $expected === '') {
            return [];
        }
        $tokens[] = [
            'field' => $field,
            'expected' => $expected,
        ];
    }
    return $tokens;
}

function reprint_push_plugin_driver_payload_row_identity_evidence_matches(
    array $evidence,
    array $expected
): bool {
    if (!reprint_push_array_has_exact_keys($evidence, ['resourceId', 'status', 'fields'])) {
        return false;
    }
    if (!is_array($evidence['fields'] ?? null)) {
        return false;
    }
    foreach ($evidence['fields'] as $field) {
        if (!is_array($field)
            || !reprint_push_array_has_exact_keys($field, ['field', 'expected', 'observedHash', 'matched'])) {
            return false;
        }
    }
    return $evidence === $expected
        && in_array($evidence['status'], ['matched', 'not-required'], true);
}

function reprint_push_plugin_driver_payload_row_schema_evidence(
    array $row_schema,
    string $action,
    array $planned
): array {
    $normalized_schema = reprint_push_normalize_plugin_owned_row_driver_row_schema($row_schema);
    $schema_hash = hash('sha256', reprint_push_stable_json($normalized_schema));
    if ($action === 'delete' || empty($planned['exists'])) {
        return [
            'schemaHash' => $schema_hash,
            'status' => 'not-required',
            'fields' => [],
        ];
    }

    $value = is_array($planned['value'] ?? null) ? $planned['value'] : [];
    $fields = reprint_push_plugin_driver_payload_row_schema_field_evidence(
        $normalized_schema['fields'],
        $value
    );
    if (($normalized_schema['additionalProperties'] ?? null) === false && is_array($value) && !array_is_list($value)) {
        $allowed = [];
        foreach ($normalized_schema['fields'] as $field) {
            $allowed[(string) $field['field']] = true;
        }
        $extra_count = 0;
        foreach (array_keys($value) as $observed_key) {
            if (!isset($allowed[(string) $observed_key])) {
                $extra_count++;
            }
        }
        if ($extra_count > 0) {
            $fields[] = [
                'field' => 'row',
                'expectedType' => 'object',
                'required' => true,
                'state' => 'unexpected',
                'observedType' => reprint_push_plugin_driver_payload_row_schema_value_type($value),
                'observedExtraPropertyCount' => $extra_count,
                'matched' => false,
            ];
        }
    }

    $matched = true;
    foreach ($fields as $field) {
        if (empty($field['matched'])) {
            $matched = false;
            break;
        }
    }

    return [
        'schemaHash' => $schema_hash,
        'status' => $matched ? 'matched' : 'mismatch',
        'fields' => $fields,
    ];
}

function reprint_push_plugin_driver_payload_row_schema_field_evidence(
    array $schema_fields,
    $value,
    string $path_prefix = ''
): array {
    $value_is_object = is_array($value) && !array_is_list($value);
    $fields = [];
    foreach ($schema_fields as $field) {
        $field_name = (string) $field['field'];
        $path = $path_prefix === '' ? $field_name : $path_prefix . '.' . $field_name;
        $observed_exists = $value_is_object && array_key_exists($field_name, $value);
        $observed = $observed_exists ? $value[$field_name] : null;
        $observed_type = $observed_exists ? reprint_push_plugin_driver_payload_row_schema_value_type($observed) : null;
        $type_matched = $observed_exists
            ? $observed_type === (string) $field['type']
            : empty($field['required']);
        $constraint_evidence = ($observed_exists && $type_matched)
            ? reprint_push_plugin_driver_payload_row_schema_constraint_evidence($field, $observed)
            : null;
        $matched = $type_matched && ($constraint_evidence === null || !empty($constraint_evidence['matched']));
        $evidence = [
            'field' => $field_name,
            'expectedType' => (string) $field['type'],
            'required' => !empty($field['required']),
            'state' => ($observed_exists && $type_matched && $constraint_evidence !== null && empty($constraint_evidence['matched']))
                ? 'constraint-mismatch'
                : ($observed_exists ? 'present' : 'missing'),
            'observedType' => $observed_type,
            'matched' => $matched,
        ];
        if ($path_prefix !== '') {
            $evidence['path'] = $path;
        }
        if ($constraint_evidence !== null) {
            $evidence['constraint'] = $constraint_evidence['constraint'];
            $evidence['constraintHash'] = $constraint_evidence['constraintHash'];
            $evidence['observedHash'] = $constraint_evidence['observedHash'];
        }
        $fields[] = $evidence;
        if ($matched && (string) $field['type'] === 'object' && is_array($field['properties'] ?? null)) {
            array_push(
                $fields,
                ...reprint_push_plugin_driver_payload_row_schema_field_evidence(
                    $field['properties'],
                    $observed,
                    $path
                )
            );
            if (array_key_exists('additionalProperties', $field) && $field['additionalProperties'] === false && is_array($observed) && !array_is_list($observed)) {
                $allowed = [];
                foreach ($field['properties'] as $property) {
                    $allowed[(string) $property['field']] = true;
                }
                $observed_keys = array_keys($observed);
                $extra_count = 0;
                foreach ($observed_keys as $observed_key) {
                    if (!isset($allowed[(string) $observed_key])) {
                        $extra_count++;
                    }
                }
                if ($extra_count > 0) {
                    $fields[] = [
                        'field' => $field_name,
                        'path' => $path,
                        'expectedType' => 'object',
                        'required' => !empty($field['required']),
                        'state' => 'unexpected',
                        'observedType' => reprint_push_plugin_driver_payload_row_schema_value_type($observed),
                        'observedExtraPropertyCount' => $extra_count,
                        'matched' => false,
                    ];
                }
            }
        }
    }
    return $fields;
}

function reprint_push_plugin_driver_payload_row_schema_constraint_evidence(
    array $field,
    $observed
): ?array {
    $observed_hash = hash('sha256', reprint_push_stable_json($observed));
    if (isset($field['constHash'])) {
        return [
            'constraint' => 'const',
            'constraintHash' => (string) $field['constHash'],
            'observedHash' => $observed_hash,
            'matched' => $observed_hash === (string) $field['constHash'],
        ];
    }
    if (is_array($field['enumHashes'] ?? null)) {
        return [
            'constraint' => 'enum',
            'constraintHash' => hash('sha256', reprint_push_stable_json($field['enumHashes'])),
            'observedHash' => $observed_hash,
            'matched' => in_array($observed_hash, $field['enumHashes'], true),
        ];
    }
    $range = [];
    if (array_key_exists('minimum', $field)) {
        $range['minimum'] = $field['minimum'];
    }
    if (array_key_exists('maximum', $field)) {
        $range['maximum'] = $field['maximum'];
    }
    if ($range !== []) {
        $matched = (is_int($observed) || is_float($observed)) && is_finite((float) $observed);
        if ($matched && array_key_exists('minimum', $range) && $observed < $range['minimum']) {
            $matched = false;
        }
        if ($matched && array_key_exists('maximum', $range) && $observed > $range['maximum']) {
            $matched = false;
        }
        return [
            'constraint' => 'range',
            'constraintHash' => hash('sha256', reprint_push_stable_json($range)),
            'observedHash' => $observed_hash,
            'matched' => $matched,
        ];
    }
    return null;
}

function reprint_push_plugin_driver_payload_row_schema_value_type($value): string
{
    if ($value === null) {
        return 'null';
    }
    if (is_array($value)) {
        return array_is_list($value) ? 'array' : 'object';
    }
    if (is_int($value)) {
        return 'integer';
    }
    if (is_float($value)) {
        return 'number';
    }
    if (is_bool($value)) {
        return 'boolean';
    }
    if (is_string($value)) {
        return 'string';
    }
    return gettype($value);
}

function reprint_push_plugin_driver_payload_row_schema_evidence_matches(
    array $evidence,
    array $expected
): bool {
    if (!reprint_push_array_has_exact_keys($evidence, ['schemaHash', 'status', 'fields'])) {
        return false;
    }
    if (!is_array($evidence['fields'] ?? null)) {
        return false;
    }
    foreach ($evidence['fields'] as $field) {
        $expected_keys = [
            'field',
            'expectedType',
            'required',
            'state',
            'observedType',
            'matched',
        ];
        if (array_key_exists('path', $field)) {
            $expected_keys[] = 'path';
        }
        if (array_key_exists('observedExtraPropertyCount', $field)) {
            $expected_keys[] = 'observedExtraPropertyCount';
        }
        if (array_key_exists('constraint', $field)) {
            $expected_keys[] = 'constraint';
        }
        if (array_key_exists('constraintHash', $field)) {
            $expected_keys[] = 'constraintHash';
        }
        if (array_key_exists('observedHash', $field)) {
            $expected_keys[] = 'observedHash';
        }
        if (!is_array($field)
            || !reprint_push_array_has_exact_keys($field, $expected_keys)) {
            return false;
        }
    }
    return $evidence === $expected
        && in_array($evidence['status'], ['matched', 'not-required'], true);
}

function reprint_push_plugin_driver_payload_reference_fields_evidence(
    array $reference_fields,
    string $action,
    array $planned
): array {
    $normalized = reprint_push_normalize_plugin_owned_row_driver_reference_fields($reference_fields);
    $reference_fields_hash = hash('sha256', reprint_push_stable_json($normalized));
    if ($action === 'delete' || empty($planned['exists'])) {
        return [
            'referenceFieldsHash' => $reference_fields_hash,
            'status' => 'not-required',
            'fields' => [],
        ];
    }

    $value = is_array($planned['value'] ?? null) ? $planned['value'] : [];
    $fields = [];
    foreach ($normalized['fields'] as $field) {
        $fields[] = reprint_push_plugin_driver_payload_reference_field_evidence($field, $value);
    }

    $matched = true;
    foreach ($fields as $field) {
        if (empty($field['matched'])) {
            $matched = false;
            break;
        }
    }

    return [
        'referenceFieldsHash' => $reference_fields_hash,
        'status' => $matched ? 'matched' : 'mismatch',
        'fields' => $fields,
    ];
}

function reprint_push_plugin_driver_payload_reference_field_evidence(array $field, array $value): array
{
    $resolved = reprint_push_plugin_driver_payload_reference_path_value($value, (string) $field['path']);
    if (empty($resolved['exists'])) {
        return [
            'path' => (string) $field['path'],
            'targetTable' => (string) $field['targetTable'],
            'targetIdField' => (string) $field['targetIdField'],
            'scalarType' => (string) $field['scalarType'],
            'required' => !empty($field['required']),
            'state' => 'missing',
            'observedType' => null,
            'matched' => empty($field['required']),
        ];
    }

    $observed = $resolved['value'];
    $target_id = reprint_push_normalize_plugin_driver_reference_positive_integer($observed);
    $evidence = [
        'path' => (string) $field['path'],
        'targetTable' => (string) $field['targetTable'],
        'targetIdField' => (string) $field['targetIdField'],
        'scalarType' => (string) $field['scalarType'],
        'required' => !empty($field['required']),
        'state' => $target_id === null ? 'invalid' : 'present',
        'observedType' => reprint_push_plugin_driver_payload_row_schema_value_type($observed),
        'observedHash' => hash('sha256', reprint_push_stable_json((string) $observed)),
        'matched' => $target_id !== null,
    ];
    if ($target_id !== null) {
        $evidence['targetResourceKey'] = 'row:' . wp_json_encode([
            (string) $field['targetTable'],
            (string) $field['targetIdField'] . ':' . $target_id,
        ], JSON_UNESCAPED_SLASHES);
    }
    return $evidence;
}

function reprint_push_plugin_driver_payload_reference_path_value(array $value, string $path): array
{
    $cursor = $value;
    foreach (explode('.', $path) as $segment) {
        if (!is_array($cursor) || array_is_list($cursor) || !array_key_exists($segment, $cursor)) {
            return ['exists' => false, 'value' => null];
        }
        $cursor = $cursor[$segment];
    }
    return ['exists' => true, 'value' => $cursor];
}

function reprint_push_normalize_plugin_driver_reference_positive_integer($value): ?int
{
    if (is_int($value) && $value > 0) {
        return $value;
    }
    if (is_string($value) && preg_match('/^[1-9][0-9]*$/', $value)) {
        return (int) $value;
    }
    return null;
}

function reprint_push_plugin_driver_payload_reference_fields_evidence_matches(
    array $evidence,
    array $expected
): bool {
    if (!reprint_push_array_has_exact_keys($evidence, ['referenceFieldsHash', 'status', 'fields'])) {
        return false;
    }
    if (!is_array($evidence['fields'] ?? null)) {
        return false;
    }
    foreach ($evidence['fields'] as $field) {
        if (!is_array($field)) {
            return false;
        }
        $expected_keys = [
            'path',
            'targetTable',
            'targetIdField',
            'scalarType',
            'required',
            'state',
            'observedType',
            'matched',
        ];
        if (array_key_exists('observedHash', $field)) {
            $expected_keys[] = 'observedHash';
        }
        if (array_key_exists('targetResourceKey', $field)) {
            $expected_keys[] = 'targetResourceKey';
        }
        if (!reprint_push_array_has_exact_keys($field, $expected_keys)) {
            return false;
        }
    }
    return $evidence === $expected
        && in_array($evidence['status'], ['matched', 'not-required'], true);
}

function reprint_push_array_has_exact_keys(array $value, array $expected_keys): bool
{
    $actual_keys = array_map('strval', array_keys($value));
    $expected = array_map('strval', $expected_keys);
    sort($actual_keys);
    sort($expected);
    return $actual_keys === $expected;
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

function reprint_push_featured_image_meta_key(): string
{
    return '_thumbnail_id';
}

function reprint_push_taxonomy_fixture_meta_key(): string
{
    return 'reprint_push_taxonomy_fixture';
}

function reprint_push_comment_fixture_meta_key(): string
{
    return 'reprint_push_comment_fixture';
}

function reprint_push_comment_fixture_agent(): string
{
    return 'reprint-push-comment-graph';
}

function reprint_push_blog_fixture_meta_key(): string
{
    return 'reprint_push_blog_fixture';
}

function reprint_push_blogmeta_graph_meta_key(): string
{
    return '_rpp0901_blog_id_reference_v6';
}

function reprint_push_fixture_postmeta_export_keys(): array
{
    return [
        reprint_push_forms_schema_meta_key(),
        reprint_push_featured_image_meta_key(),
    ];
}

function reprint_push_fixture_termmeta_export_keys(): array
{
    return [
        reprint_push_taxonomy_fixture_meta_key(),
    ];
}

function reprint_push_fixture_commentmeta_export_keys(): array
{
    return [
        reprint_push_comment_fixture_meta_key(),
    ];
}

function reprint_push_fixture_blogmeta_export_keys(): array
{
    return [
        reprint_push_blog_fixture_meta_key(),
        reprint_push_blogmeta_graph_meta_key(),
    ];
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
    if ($post_id <= 0 || !in_array($meta_key, reprint_push_fixture_postmeta_export_keys(), true)) {
        throw new RuntimeException('Unsupported postmeta id: ' . $id);
    }
    return [$post_id, $meta_key];
}

function reprint_push_blogmeta_row_id(int $blog_id, string $meta_key): string
{
    if ($blog_id <= 0 || !in_array($meta_key, reprint_push_fixture_blogmeta_export_keys(), true)) {
        throw new RuntimeException('Unsupported blogmeta row id.');
    }
    return 'blog_id:' . $blog_id . ':meta_key:' . $meta_key;
}

function reprint_push_parse_blogmeta_row_id(string $id): array
{
    if (!preg_match('/^blog_id:([1-9]\d*):meta_key:(.+)$/', $id, $matches)) {
        throw new RuntimeException('Unsupported blogmeta id: ' . $id);
    }
    $blog_id = (int) $matches[1];
    $meta_key = $matches[2];
    if (!in_array($meta_key, reprint_push_fixture_blogmeta_export_keys(), true)) {
        throw new RuntimeException('Unsupported blogmeta id: ' . $id);
    }
    return [$blog_id, $meta_key];
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
