<?php
/**
 * Lab-only DB journal and idempotency helpers for Playground REST proofs.
 *
 * This table is intentionally fixture-scoped. It is not a production durability
 * contract; it only records hash evidence for local Playground push experiments.
 */

function reprint_push_lab_db_journal_table_name(): string
{
    global $wpdb;

    $table_name = $wpdb->prefix . 'reprint_push_lab_push_journal';
    if (!preg_match('/^[A-Za-z0-9_]+$/', $table_name)) {
        throw new RuntimeException('Unexpected push lab journal table name.');
    }
    return $table_name;
}

function reprint_push_lab_db_journal_quoted_table_name(): string
{
    return '`' . reprint_push_lab_db_journal_table_name() . '`';
}

function reprint_push_lab_db_journal_ensure_table(): void
{
    global $wpdb;

    $table_name = reprint_push_lab_db_journal_table_name();
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_name));
    if ($exists === $table_name) {
        return;
    }

    $charset_collate = $wpdb->get_charset_collate();
    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $sql = "CREATE TABLE {$quoted_table} (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        event varchar(64) NOT NULL,
        idempotency_key_hash char(64) NOT NULL DEFAULT '',
        request_hash char(64) NOT NULL DEFAULT '',
        plan_hash char(64) NOT NULL DEFAULT '',
        receipt_hash char(64) NOT NULL DEFAULT '',
        plan_fingerprint char(64) NOT NULL DEFAULT '',
        mutation_count int unsigned NOT NULL DEFAULT 0,
        applied_count int unsigned NOT NULL DEFAULT 0,
        result_hash char(64) NOT NULL DEFAULT '',
        result_json longtext NULL,
        resource_hash_evidence_json longtext NULL,
        error_code varchar(80) NOT NULL DEFAULT '',
        lab_scope varchar(191) NOT NULL DEFAULT 'local-playground-fixture',
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (id),
        KEY idempotency_key_hash (idempotency_key_hash),
        KEY request_hash (request_hash),
        KEY event (event),
        KEY created_at (created_at)
    ) {$charset_collate}";

    $wpdb->query($sql);
}

function reprint_push_lab_db_journal_schema(): array
{
    reprint_push_lab_db_journal_ensure_table();

    return [
        'schemaVersion' => 1,
        'table' => reprint_push_lab_db_journal_table_name(),
        'scope' => 'local Playground fixture only; not production durability',
        'appendOnlyEvents' => true,
        'columns' => [
            'id' => 'append-only event sequence',
            'event' => 'journal event name',
            'idempotency_key_hash' => 'sha256 hash of X-Reprint-Push-Idempotency-Key',
            'request_hash' => 'sha256 hash of canonical request body',
            'plan_hash' => 'sha256 plan hash when available',
            'receipt_hash' => 'dry-run receipt hash when available',
            'plan_fingerprint' => 'compact plan evidence hash when available',
            'mutation_count' => 'planned mutation count',
            'applied_count' => 'committed/applied mutation count recorded by the endpoint',
            'result_hash' => 'sha256 hash of sanitized compact result JSON',
            'result_json' => 'sanitized compact result JSON; no raw payload/content/snapshots/option journal',
            'resource_hash_evidence_json' => 'sanitized DB-native resource/hash evidence only',
            'error_code' => 'compact error code for rejected/conflict events',
            'lab_scope' => 'fixture scope marker',
            'created_at' => 'UTC event timestamp',
            'updated_at' => 'UTC event timestamp',
        ],
        'redaction' => [
            'omits' => [
                'value',
                'content',
                'payload',
                'payloads',
                'post_content',
                'option_value',
                'meta_value',
                'currentSnapshot',
                'afterSnapshot',
                'beforeSnapshot',
            ],
        ],
    ];
}

function reprint_push_lab_db_journal_key_hash(string $key): string
{
    return hash('sha256', $key);
}

function reprint_push_lab_db_journal_request_hash(array $payload): string
{
    return hash('sha256', reprint_push_stable_json($payload));
}

function reprint_push_lab_db_journal_plan_hash_from_payload(array $payload): string
{
    $plan = isset($payload['plan']) && is_array($payload['plan']) ? $payload['plan'] : $payload;
    return is_array($plan) ? hash('sha256', reprint_push_stable_json($plan)) : '';
}

function reprint_push_lab_db_journal_receipt_hash_from_payload(array $payload): string
{
    if (!isset($payload['receipt']) || !is_array($payload['receipt'])) {
        return '';
    }
    $receipt = isset($payload['receipt']['receipt']) && is_array($payload['receipt']['receipt'])
        ? $payload['receipt']['receipt']
        : $payload['receipt'];
    if (isset($receipt['receiptHash']) && is_string($receipt['receiptHash'])) {
        return (string) $receipt['receiptHash'];
    }
    return hash('sha256', reprint_push_stable_json($receipt));
}

function reprint_push_lab_db_journal_plan_fingerprint_from_payload(array $payload): string
{
    $plan = isset($payload['plan']) && is_array($payload['plan']) ? $payload['plan'] : $payload;
    if (!is_array($plan)) {
        return '';
    }
    return hash('sha256', reprint_push_stable_json([
        'id' => $plan['id'] ?? null,
        'status' => $plan['status'] ?? null,
        'summary' => $plan['summary'] ?? null,
        'mutationCount' => isset($plan['mutations']) && is_array($plan['mutations']) ? count($plan['mutations']) : 0,
        'preconditionCount' => isset($plan['preconditions']) && is_array($plan['preconditions']) ? count($plan['preconditions']) : 0,
    ]));
}

function reprint_push_lab_db_journal_mutation_count_from_payload(array $payload): int
{
    $plan = isset($payload['plan']) && is_array($payload['plan']) ? $payload['plan'] : $payload;
    return isset($plan['mutations']) && is_array($plan['mutations']) ? count($plan['mutations']) : 0;
}

function reprint_push_lab_db_journal_append_event(string $event, array $context = []): array
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();

    $result_json = isset($context['result']) && is_array($context['result'])
        ? reprint_push_stable_json(reprint_push_lab_db_journal_sanitize_value($context['result']))
        : null;
    $result_hash = $result_json === null ? '' : hash('sha256', $result_json);

    $resource_evidence_json = isset($context['resourceHashEvidence']) && is_array($context['resourceHashEvidence'])
        ? reprint_push_stable_json(reprint_push_lab_db_journal_sanitize_value($context['resourceHashEvidence']))
        : null;

    $now = gmdate('Y-m-d H:i:s');
    $row = [
        'event' => $event,
        'idempotency_key_hash' => (string) ($context['idempotencyKeyHash'] ?? ''),
        'request_hash' => (string) ($context['requestHash'] ?? ''),
        'plan_hash' => (string) ($context['planHash'] ?? ''),
        'receipt_hash' => (string) ($context['receiptHash'] ?? ''),
        'plan_fingerprint' => (string) ($context['planFingerprint'] ?? ''),
        'mutation_count' => max(0, (int) ($context['mutationCount'] ?? 0)),
        'applied_count' => max(0, (int) ($context['appliedCount'] ?? 0)),
        'result_hash' => $result_hash,
        'result_json' => $result_json,
        'resource_hash_evidence_json' => $resource_evidence_json,
        'error_code' => (string) ($context['errorCode'] ?? ''),
        'lab_scope' => 'local-playground-fixture',
        'created_at' => $now,
        'updated_at' => $now,
    ];

    $inserted = $wpdb->insert(
        reprint_push_lab_db_journal_table_name(),
        $row,
        [
            '%s',
            '%s',
            '%s',
            '%s',
            '%s',
            '%s',
            '%d',
            '%d',
            '%s',
            '%s',
            '%s',
            '%s',
            '%s',
            '%s',
            '%s',
        ]
    );

    if ($inserted === false) {
        throw new RuntimeException('Could not write push lab DB journal event.');
    }

    return reprint_push_lab_db_journal_row_by_id((int) $wpdb->insert_id);
}

function reprint_push_lab_db_journal_rows_for_key(string $idempotency_key_hash): array
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();

    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    return $wpdb->get_results(
        $wpdb->prepare(
            "SELECT * FROM {$quoted_table} WHERE idempotency_key_hash = %s ORDER BY id ASC",
            $idempotency_key_hash
        ),
        ARRAY_A
    ) ?: [];
}

function reprint_push_lab_db_journal_committed_row_for_key(string $idempotency_key_hash): ?array
{
    $rows = array_reverse(reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash));
    foreach ($rows as $row) {
        if ((string) ($row['event'] ?? '') === 'apply-committed') {
            return $row;
        }
    }
    return null;
}

function reprint_push_lab_db_journal_key_has_different_request(string $idempotency_key_hash, string $request_hash): bool
{
    foreach (reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash) as $row) {
        $row_request_hash = (string) ($row['request_hash'] ?? '');
        if ($row_request_hash !== '' && $row_request_hash !== $request_hash) {
            return true;
        }
    }
    return false;
}

function reprint_push_lab_db_journal_row_by_id(int $id): array
{
    global $wpdb;

    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$quoted_table} WHERE id = %d", $id), ARRAY_A);
    return is_array($row) ? reprint_push_lab_db_journal_public_row($row) : [];
}

function reprint_push_lab_db_journal_summary(int $limit = 20): array
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();

    $limit = max(1, min(80, $limit));
    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $row_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$quoted_table}");
    $latest = $wpdb->get_results(
        $wpdb->prepare("SELECT * FROM {$quoted_table} ORDER BY id DESC LIMIT %d", $limit),
        ARRAY_A
    ) ?: [];
    $events = $wpdb->get_results(
        "SELECT event, COUNT(*) AS count, MAX(id) AS latestId FROM {$quoted_table} GROUP BY event ORDER BY latestId DESC",
        ARRAY_A
    ) ?: [];
    $idempotency = $wpdb->get_results(
        "SELECT idempotency_key_hash, COUNT(*) AS events, COUNT(DISTINCT request_hash) AS requestHashes, MAX(id) AS latestId
         FROM {$quoted_table}
         WHERE idempotency_key_hash <> ''
         GROUP BY idempotency_key_hash
         ORDER BY latestId DESC
         LIMIT 20",
        ARRAY_A
    ) ?: [];

    return [
        'schemaVersion' => 1,
        'table' => reprint_push_lab_db_journal_table_name(),
        'scope' => 'local Playground fixture only; not production durability',
        'rowCount' => $row_count,
        'latestRows' => array_map('reprint_push_lab_db_journal_public_row', array_reverse($latest)),
        'eventSummaries' => array_map(static function (array $row): array {
            return [
                'event' => (string) $row['event'],
                'count' => (int) $row['count'],
                'latestId' => (int) $row['latestId'],
            ];
        }, $events),
        'idempotencyEvidence' => array_map(static function (array $row): array {
            return [
                'idempotencyKeyHash' => (string) $row['idempotency_key_hash'],
                'events' => (int) $row['events'],
                'requestHashes' => (int) $row['requestHashes'],
                'latestId' => (int) $row['latestId'],
            ];
        }, $idempotency),
    ];
}

function reprint_push_lab_db_journal_public_row(array $row): array
{
    $result = json_decode((string) ($row['result_json'] ?? ''), true);
    $resource_evidence = json_decode((string) ($row['resource_hash_evidence_json'] ?? ''), true);

    return [
        'sequence' => (int) ($row['id'] ?? 0),
        'event' => (string) ($row['event'] ?? ''),
        'idempotencyKeyHash' => (string) ($row['idempotency_key_hash'] ?? ''),
        'requestHash' => (string) ($row['request_hash'] ?? ''),
        'planHash' => (string) ($row['plan_hash'] ?? ''),
        'receiptHash' => (string) ($row['receipt_hash'] ?? ''),
        'planFingerprint' => (string) ($row['plan_fingerprint'] ?? ''),
        'mutationCount' => (int) ($row['mutation_count'] ?? 0),
        'appliedCount' => (int) ($row['applied_count'] ?? 0),
        'resultHash' => (string) ($row['result_hash'] ?? ''),
        'result' => is_array($result) ? reprint_push_lab_db_journal_sanitize_value($result) : null,
        'resourceHashEvidence' => is_array($resource_evidence)
            ? reprint_push_lab_db_journal_sanitize_value($resource_evidence)
            : null,
        'errorCode' => (string) ($row['error_code'] ?? ''),
        'labScope' => (string) ($row['lab_scope'] ?? ''),
        'createdAt' => (string) ($row['created_at'] ?? ''),
        'updatedAt' => (string) ($row['updated_at'] ?? ''),
    ];
}

function reprint_push_lab_db_journal_compact_result(array $result): array
{
    $compact = [
        'ok' => (bool) ($result['ok'] ?? false),
    ];
    foreach (['mode', 'code', 'message', 'applied', 'verifiedKeys', 'verifiedPreconditions', 'recovery'] as $key) {
        if (array_key_exists($key, $result)) {
            $compact[$key] = $result[$key];
        }
    }
    if (isset($result['receipt']) && is_array($result['receipt'])) {
        $compact['receiptHash'] = isset($result['receipt']['receiptHash'])
            ? (string) $result['receipt']['receiptHash']
            : hash('sha256', reprint_push_stable_json($result['receipt']));
    }
    if (isset($result['idempotency']) && is_array($result['idempotency'])) {
        $compact['idempotency'] = $result['idempotency'];
    }
    if (isset($result['dbJournal']) && is_array($result['dbJournal'])) {
        $compact['dbJournal'] = [
            'table' => isset($result['dbJournal']['table']) ? (string) $result['dbJournal']['table'] : null,
            'cursor' => isset($result['dbJournal']['cursor']) ? (string) $result['dbJournal']['cursor'] : null,
            'event' => isset($result['dbJournal']['event']) ? (string) $result['dbJournal']['event'] : null,
            'sequence' => isset($result['dbJournal']['sequence']) ? (int) $result['dbJournal']['sequence'] : null,
        ];
    }
    if (isset($result['audit']) && is_array($result['audit'])) {
        $compact['audit'] = $result['audit'];
    }
    return reprint_push_lab_db_journal_sanitize_value($compact);
}

function reprint_push_lab_db_journal_replay_result(array $committed_row): array
{
    $result = json_decode((string) ($committed_row['result_json'] ?? ''), true);
    if (!is_array($result)) {
        $result = [
            'ok' => true,
            'mode' => 'apply',
            'applied' => (int) ($committed_row['applied_count'] ?? 0),
        ];
    }
    $result = reprint_push_lab_db_journal_sanitize_value($result);
    $result['ok'] = true;
    $result['code'] = 'BATCH_ALREADY_COMMITTED';
    $result['idempotency'] = [
        'replayed' => true,
        'freshMutationWork' => false,
        'idempotencyKeyHash' => (string) ($committed_row['idempotency_key_hash'] ?? ''),
        'requestHash' => (string) ($committed_row['request_hash'] ?? ''),
        'committedSequence' => (int) ($committed_row['id'] ?? 0),
    ];
    return $result;
}

function reprint_push_lab_db_journal_resource_hash_evidence(array $result): array
{
    $evidence = [];
    foreach (['verifiedKeys', 'verifiedPreconditions', 'recovery'] as $key) {
        if (isset($result[$key])) {
            $evidence[$key] = $result[$key];
        }
    }
    return reprint_push_lab_db_journal_sanitize_value($evidence);
}

function reprint_push_lab_db_journal_mutation_evidence(array $mutation, string $observed_hash): array
{
    return reprint_push_lab_db_journal_sanitize_value([
        'mutationId' => isset($mutation['id']) ? (string) $mutation['id'] : '',
        'resourceKey' => isset($mutation['resourceKey']) ? (string) $mutation['resourceKey'] : '',
        'observedHash' => $observed_hash,
    ]);
}

function reprint_push_lab_db_journal_sanitize_value($value)
{
    $blocked = [
        'value',
        'content',
        'payload',
        'payloads',
        'post_content',
        'option_value',
        'meta_value',
        'currentSnapshot',
        'afterSnapshot',
        'beforeSnapshot',
    ];

    if (is_array($value)) {
        $safe = [];
        foreach ($value as $key => $inner_value) {
            $key = (string) $key;
            if (in_array($key, $blocked, true)) {
                continue;
            }
            $safe[$key] = reprint_push_lab_db_journal_sanitize_value($inner_value);
        }
        return $safe;
    }
    if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
        return $value;
    }
    return (string) $value;
}
