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
        reprint_push_lab_db_journal_ensure_claim_schema();
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
        claim_key_hash char(64) NULL DEFAULT NULL,
        lab_scope varchar(191) NOT NULL DEFAULT 'local-playground-fixture',
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY claim_key_hash (claim_key_hash),
        KEY idempotency_key_hash (idempotency_key_hash),
        KEY request_hash (request_hash),
        KEY event (event),
        KEY created_at (created_at)
    ) {$charset_collate}";

    $previous_error_suppression = method_exists($wpdb, 'suppress_errors')
        ? $wpdb->suppress_errors(true)
        : null;
    try {
        $wpdb->query($sql);
    } finally {
        if ($previous_error_suppression !== null) {
            $wpdb->suppress_errors($previous_error_suppression);
        }
    }
    reprint_push_lab_db_journal_ensure_claim_schema();
}

function reprint_push_lab_db_journal_schema(): array
{
    reprint_push_lab_db_journal_ensure_table();

    $package_mode = defined('REPRINT_PUSH_DISABLE_LAB_ROUTES')
        && REPRINT_PUSH_DISABLE_LAB_ROUTES === true
        && defined('REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP')
        && REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP === true;

    return [
        'schemaVersion' => 1,
        'table' => reprint_push_lab_db_journal_table_name(),
        'scope' => $package_mode
            ? 'packaged production journal scope'
            : 'local Playground fixture only; not production durability',
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
            'claim_key_hash' => 'nullable unique idempotency/retry claim hash; idempotency-opened and lab retry-claim rows set it',
            'lab_scope' => 'fixture scope marker',
            'created_at' => 'UTC event timestamp',
            'updated_at' => 'UTC event timestamp',
        ],
        'redaction' => [
            'mutationEvidence' => 'per-mutation rows store order/id/resource key/type, before/planned/observed hashes, phase/status, and request/plan/receipt hashes only',
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
    return reprint_push_lab_db_journal_insert_event($event, $context);
}

function reprint_push_lab_db_journal_try_open_idempotency(array $context): array
{
    global $wpdb;

    $claim_key_hash = (string) ($context['idempotencyKeyHash'] ?? '');
    if ($claim_key_hash === '') {
        throw new RuntimeException('Cannot open DB idempotency claim without an idempotency key hash.');
    }

    $entry = reprint_push_lab_db_journal_insert_event('idempotency-opened', $context, $claim_key_hash, false);
    if (is_array($entry)) {
        return [
            'opened' => true,
            'entry' => $entry,
        ];
    }

    $claim_row = reprint_push_lab_db_journal_claim_row_for_key($claim_key_hash);
    if (is_array($claim_row)) {
        return [
            'opened' => false,
            'entry' => $claim_row,
            'lastError' => (string) $wpdb->last_error,
        ];
    }

    throw new RuntimeException('Could not open push lab DB idempotency claim.');
}

function reprint_push_lab_db_journal_stale_retry_claim_hash(
    string $idempotency_key_hash,
    string $request_hash,
    int $abandoned_sequence,
    int $previous_started_sequence
): string {
    return hash('sha256', reprint_push_stable_json([
        'claim' => 'stale-claim-retry',
        'idempotencyKeyHash' => $idempotency_key_hash,
        'requestHash' => $request_hash,
        'abandonedSequence' => $abandoned_sequence,
        'previousStartedSequence' => $previous_started_sequence,
    ]));
}

function reprint_push_lab_db_journal_try_open_stale_retry(array $context, array $retry_context): array
{
    global $wpdb;

    $idempotency_key_hash = (string) ($context['idempotencyKeyHash'] ?? '');
    $request_hash = (string) ($context['requestHash'] ?? '');
    $abandoned_sequence = (int) ($retry_context['abandonedSequence'] ?? 0);
    $previous_started_sequence = (int) ($retry_context['previousStartedSequence'] ?? 0);
    if ($idempotency_key_hash === '' || $request_hash === '' || $abandoned_sequence < 1 || $previous_started_sequence < 1) {
        throw new RuntimeException('Cannot open stale retry claim without key/request and source sequence evidence.');
    }

    $retry_claim_hash = reprint_push_lab_db_journal_stale_retry_claim_hash(
        $idempotency_key_hash,
        $request_hash,
        $abandoned_sequence,
        $previous_started_sequence
    );
    $entry = reprint_push_lab_db_journal_insert_event(
        'stale-claim-retry-started',
        $context + $retry_context,
        $retry_claim_hash,
        false
    );
    if (is_array($entry)) {
        return [
            'opened' => true,
            'entry' => $entry,
            'retryClaimHash' => $retry_claim_hash,
        ];
    }

    $claim_row = reprint_push_lab_db_journal_claim_row_for_key($retry_claim_hash);
    if (is_array($claim_row)) {
        return [
            'opened' => false,
            'entry' => $claim_row,
            'retryClaimHash' => $retry_claim_hash,
            'lastError' => (string) $wpdb->last_error,
        ];
    }

    throw new RuntimeException('Could not open push lab DB stale retry claim.');
}

function reprint_push_lab_db_journal_insert_event(
    string $event,
    array $context = [],
    ?string $claim_key_hash = null,
    bool $throw_on_failure = true
): ?array
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
        'claim_key_hash' => $claim_key_hash,
        'lab_scope' => 'local-playground-fixture',
        'created_at' => $now,
        'updated_at' => $now,
    ];

    $previous_error_suppression = null;
    if (!$throw_on_failure && method_exists($wpdb, 'suppress_errors')) {
        $previous_error_suppression = $wpdb->suppress_errors(true);
    }

    try {
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
    } finally {
        if ($previous_error_suppression !== null) {
            $wpdb->suppress_errors($previous_error_suppression);
        }
    }

    if ($inserted === false) {
        if (!$throw_on_failure) {
            return null;
        }
        throw new RuntimeException('Could not write push lab DB journal event.');
    }

    return reprint_push_lab_db_journal_row_by_id((int) $wpdb->insert_id);
}

function reprint_push_lab_db_journal_ensure_claim_schema(): void
{
    global $wpdb;

    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $columns = $wpdb->get_results("SHOW COLUMNS FROM {$quoted_table} LIKE 'claim_key_hash'", ARRAY_A) ?: [];
    if (count($columns) === 0) {
        $wpdb->query("ALTER TABLE {$quoted_table} ADD COLUMN claim_key_hash char(64) NULL DEFAULT NULL AFTER error_code");
    }

    $indexes = $wpdb->get_results("SHOW INDEX FROM {$quoted_table} WHERE Key_name = 'claim_key_hash'", ARRAY_A) ?: [];
    if (count($indexes) === 0) {
        $wpdb->query("ALTER TABLE {$quoted_table} ADD UNIQUE KEY claim_key_hash (claim_key_hash)");
    }
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

function reprint_push_lab_db_journal_terminal_row_for_key(string $idempotency_key_hash): ?array
{
    $rows = array_reverse(reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash));
    foreach ($rows as $row) {
        $event = (string) ($row['event'] ?? '');
        if ($event === 'apply-committed' || $event === 'apply-rejected') {
            return $row;
        }
    }
    return null;
}

function reprint_push_lab_db_journal_claim_row_for_key(string $idempotency_key_hash): ?array
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();

    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $row = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT * FROM {$quoted_table} WHERE claim_key_hash = %s ORDER BY id ASC LIMIT 1",
            $idempotency_key_hash
        ),
        ARRAY_A
    );
    return is_array($row) ? reprint_push_lab_db_journal_public_row($row) : null;
}

function reprint_push_lab_db_journal_key_has_different_request(string $idempotency_key_hash, string $request_hash): bool
{
    $claim_row = reprint_push_lab_db_journal_claim_row_for_key($idempotency_key_hash);
    if (is_array($claim_row)) {
        $claim_request_hash = (string) ($claim_row['requestHash'] ?? '');
        return $claim_request_hash !== '' && $claim_request_hash !== $request_hash;
    }

    foreach (reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash) as $row) {
        $event = (string) ($row['event'] ?? '');
        if ($event !== 'idempotency-opened' && $event !== 'apply-committed' && $event !== 'apply-rejected') {
            continue;
        }

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

    $limit = max(1, min(500, $limit));
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
        'claimKeyHash' => (string) ($row['claim_key_hash'] ?? ''),
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
    foreach (['mode', 'code', 'message', 'applied', 'verifiedKeys', 'verifiedPreconditions', 'recovery', 'storageGuard'] as $key) {
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

function reprint_push_lab_db_journal_replay_rejected_result(array $rejected_row): array
{
    $result = json_decode((string) ($rejected_row['result_json'] ?? ''), true);
    if (!is_array($result)) {
        $result = [
            'ok' => false,
            'code' => (string) ($rejected_row['error_code'] ?? 'PUSH_PROTOCOL_ERROR'),
            'mode' => 'apply',
            'applied' => (int) ($rejected_row['applied_count'] ?? 0),
        ];
    }
    $result = reprint_push_lab_db_journal_sanitize_value($result);
    $result['ok'] = false;
    $result['idempotency'] = [
        'replayed' => true,
        'freshMutationWork' => false,
        'idempotencyKeyHash' => (string) ($rejected_row['idempotency_key_hash'] ?? ''),
        'requestHash' => (string) ($rejected_row['request_hash'] ?? ''),
        'rejectedSequence' => (int) ($rejected_row['id'] ?? 0),
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

function reprint_push_lab_db_journal_planned_mutation_evidence(array $mutations, array $preconditions = []): array
{
    $preconditions_by_mutation = [];
    foreach ($preconditions as $precondition) {
        if (!is_array($precondition) || !isset($precondition['mutationId'])) {
            continue;
        }
        $preconditions_by_mutation[(string) $precondition['mutationId']] = $precondition;
    }

    $evidence = [];
    foreach (array_values($mutations) as $index => $mutation) {
        if (!is_array($mutation)) {
            continue;
        }
        $mutation_id = isset($mutation['id']) ? (string) $mutation['id'] : '';
        $precondition = $preconditions_by_mutation[$mutation_id] ?? [];
        $evidence[] = reprint_push_lab_db_journal_mutation_evidence([
            'index' => (int) $index,
            'mutationId' => $mutation_id,
            'resourceKey' => isset($mutation['resourceKey']) ? (string) $mutation['resourceKey'] : '',
            'resourceType' => isset($mutation['resource']) && is_array($mutation['resource'])
                ? (string) ($mutation['resource']['type'] ?? '')
                : '',
            'beforeHash' => (string) ($precondition['expectedHash'] ?? $mutation['remoteBeforeHash'] ?? $mutation['baseHash'] ?? ''),
            'plannedAfterHash' => (string) ($mutation['localHash'] ?? ''),
            'phase' => 'planned',
            'status' => 'planned',
        ]);
    }

    return $evidence;
}

function reprint_push_lab_db_journal_mutation_evidence(array $mutation, ?string $observed_hash = null): array
{
    $resource = isset($mutation['resource']) && is_array($mutation['resource']) ? $mutation['resource'] : [];
    $evidence = [
        'mutationOrder' => (int) ($mutation['mutationOrder'] ?? $mutation['index'] ?? 0),
        'mutationId' => isset($mutation['mutationId'])
            ? (string) $mutation['mutationId']
            : (isset($mutation['id']) ? (string) $mutation['id'] : ''),
        'resourceKey' => isset($mutation['resourceKey']) ? (string) $mutation['resourceKey'] : '',
        'resourceType' => isset($mutation['resourceType'])
            ? (string) $mutation['resourceType']
            : (string) ($resource['type'] ?? ''),
        'beforeHash' => (string) ($mutation['beforeHash'] ?? $mutation['expectedBeforeHash'] ?? $mutation['remoteBeforeHash'] ?? $mutation['baseHash'] ?? ''),
        'plannedAfterHash' => (string) ($mutation['plannedAfterHash'] ?? $mutation['afterHash'] ?? $mutation['localHash'] ?? ''),
        'phase' => (string) ($mutation['phase'] ?? ''),
        'status' => (string) ($mutation['status'] ?? ''),
    ];

    foreach (['idempotencyKeyHash', 'requestHash', 'planHash', 'receiptHash', 'planFingerprint', 'startedCursor'] as $key) {
        if (isset($mutation[$key])) {
            $evidence[$key] = (string) $mutation[$key];
        }
    }

    if (isset($mutation['appliedCount'])) {
        $evidence['appliedCount'] = max(0, (int) $mutation['appliedCount']);
    }
    foreach (['preWriteExpectedHash', 'preWriteActualHash', 'actualHash'] as $key) {
        if (isset($mutation[$key])) {
            $evidence[$key] = (string) $mutation[$key];
        }
    }
    if (isset($mutation['preconditionCheck'])) {
        $evidence['preconditionCheck'] = (string) $mutation['preconditionCheck'];
    }
    if (isset($mutation['preWriteStagingProof']) && is_array($mutation['preWriteStagingProof'])) {
        $evidence['preWriteStagingProof'] = $mutation['preWriteStagingProof'];
    }
    if (isset($mutation['storageGuard']) && is_array($mutation['storageGuard'])) {
        $evidence['storageGuard'] = $mutation['storageGuard'];
    }
    if ($observed_hash !== null) {
        $evidence['observedHash'] = $observed_hash;
    } elseif (isset($mutation['observedHash'])) {
        $evidence['observedHash'] = (string) $mutation['observedHash'];
    }

    return reprint_push_lab_db_journal_sanitize_value([
        'mutation' => $evidence,
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
