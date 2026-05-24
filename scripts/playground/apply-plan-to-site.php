<?php
/**
 * Guardedly apply a ready Reprint Push Lab plan to a Playground site.
 *
 * This entrypoint is intentionally fixture-scoped. It only supports the
 * resources exported by snapshot-lib.php: marked posts, the lab plugin option,
 * and files under wp-content/uploads/reprint-push.
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

$exit_code = 0;

try {
    $plan_path = $argv[1] ?? null;
    if (!$plan_path) {
        throw new RuntimeException('Missing plan JSON path argument.');
    }

    $plan = reprint_push_read_json_file($plan_path);
    if (($plan['status'] ?? null) !== 'ready') {
        throw new RuntimeException('Refusing to apply a non-ready plan: ' . (string) ($plan['status'] ?? 'unknown'));
    }
    if (!empty($plan['conflicts'])) {
        throw new RuntimeException('Refusing to apply a plan with conflicts.');
    }
    if (!empty($plan['blockers'])) {
        throw new RuntimeException('Refusing to apply a plan with blockers.');
    }

    $mutations = $plan['mutations'] ?? [];
    if (!is_array($mutations)) {
        throw new RuntimeException('Plan mutations must be an array.');
    }

    $precondition_entries = $plan['preconditions'] ?? [];
    if (!is_array($precondition_entries)) {
        throw new RuntimeException('Plan preconditions must be an array.');
    }

    $preconditions = reprint_push_preconditions_by_mutation($precondition_entries);
    $before = reprint_push_export_snapshot();

    foreach ($mutations as $mutation) {
        reprint_push_validate_mutation_shape($mutation);
        reprint_push_assert_supported_apply_resource($mutation['resource']);

        $mutation_id = (string) $mutation['id'];
        if (!array_key_exists($mutation_id, $preconditions)) {
            throw new RuntimeException('Missing precondition for mutation: ' . $mutation_id);
        }
        reprint_push_validate_precondition_shape($preconditions[$mutation_id]);
        reprint_push_assert_precondition_binds_to_mutation($preconditions[$mutation_id], $mutation);
    }

    foreach ($precondition_entries as $precondition) {
        reprint_push_validate_precondition_shape($precondition);
        reprint_push_assert_supported_apply_resource($precondition['resource']);
        $actual_hash = reprint_push_hash_resource($before, $precondition['resource']);
        if ($actual_hash !== $precondition['expectedHash']) {
            throw new RuntimeException(
                'Precondition failed for ' . $precondition['resourceKey']
                . ': expected ' . $precondition['expectedHash']
                . ', got ' . $actual_hash
            );
        }
    }

    foreach (reprint_push_order_apply_mutations($mutations) as $mutation) {
        reprint_push_apply_resource($mutation['resource'], $mutation['value']);
    }

    $after = reprint_push_export_snapshot();
    $verified = [];

    foreach ($mutations as $mutation) {
        $actual_hash = reprint_push_hash_resource($after, $mutation['resource']);
        if ($actual_hash !== ($mutation['localHash'] ?? null)) {
            throw new RuntimeException(
                'Post-apply verification failed for ' . ($mutation['resourceKey'] ?? $mutation['id'])
                . ': expected ' . (string) ($mutation['localHash'] ?? '')
                . ', got ' . $actual_hash
            );
        }
        $verified[] = (string) $mutation['resourceKey'];
    }

    $result = [
        'ok' => true,
        'applied' => count($mutations),
        'verified' => $verified,
        'after' => $after,
    ];
} catch (Throwable $error) {
    $exit_code = 1;
    $result = [
        'ok' => false,
        'error' => [
            'class' => get_class($error),
            'message' => $error->getMessage(),
        ],
    ];
}

echo "REPRINT_PUSH_APPLY_JSON_BEGIN\n";
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
echo "REPRINT_PUSH_APPLY_JSON_END\n";

exit($exit_code);

function reprint_push_read_json_file(string $path): array
{
    if (!is_file($path)) {
        throw new RuntimeException('Plan JSON file does not exist: ' . $path);
    }

    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException('Could not read plan JSON file: ' . $path);
    }

    $decoded = json_decode($contents, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Plan JSON did not decode to an object.');
    }

    return $decoded;
}

function reprint_push_preconditions_by_mutation(array $preconditions): array
{
    $indexed = [];
    foreach ($preconditions as $precondition) {
        if (!is_array($precondition) || empty($precondition['mutationId'])) {
            throw new RuntimeException('Invalid precondition entry.');
        }
        $indexed[(string) $precondition['mutationId']] = $precondition;
    }
    return $indexed;
}

function reprint_push_validate_mutation_shape(array $mutation): void
{
    foreach (['id', 'resource', 'resourceKey', 'value', 'localHash'] as $key) {
        if (!array_key_exists($key, $mutation)) {
            throw new RuntimeException('Mutation is missing ' . $key . '.');
        }
    }
    if (!is_array($mutation['resource']) || !is_array($mutation['value'])) {
        throw new RuntimeException('Mutation resource and value must be objects.');
    }
}

function reprint_push_validate_precondition_shape(array $precondition): void
{
    foreach (['mutationId', 'resource', 'resourceKey', 'expectedHash'] as $key) {
        if (!array_key_exists($key, $precondition)) {
            throw new RuntimeException('Precondition is missing ' . $key . '.');
        }
    }
    if (!is_array($precondition['resource'])) {
        throw new RuntimeException('Precondition resource must be an object.');
    }
}

function reprint_push_assert_precondition_binds_to_mutation(array $precondition, array $mutation): void
{
    if ((string) $precondition['mutationId'] !== (string) $mutation['id']) {
        throw new RuntimeException('Precondition mutationId does not match mutation id: ' . (string) $mutation['id']);
    }
    if ((string) $precondition['resourceKey'] !== (string) $mutation['resourceKey']) {
        throw new RuntimeException('Precondition resourceKey does not match mutation: ' . (string) $mutation['id']);
    }
    if (reprint_push_stable_json($precondition['resource']) !== reprint_push_stable_json($mutation['resource'])) {
        throw new RuntimeException('Precondition resource does not match mutation: ' . (string) $mutation['id']);
    }
}

function reprint_push_order_apply_mutations(array $mutations): array
{
    $ordered = $mutations;
    usort($ordered, static function (array $left, array $right): int {
        return reprint_push_apply_mutation_priority($left) <=> reprint_push_apply_mutation_priority($right);
    });
    return $ordered;
}

function reprint_push_apply_mutation_priority(array $mutation): int
{
    $resource = $mutation['resource'] ?? [];
    if (($resource['type'] ?? null) !== 'row') {
        return 10;
    }

    $table = (string) ($resource['table'] ?? '');
    if ($table === 'wp_posts') {
        return 20;
    }
    if ($table === 'wp_postmeta') {
        return !empty($mutation['value']['absent']) ? 15 : 30;
    }
    return 40;
}
