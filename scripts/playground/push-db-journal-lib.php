<?php
/**
 * DB journal and idempotency helpers for Playground REST proofs.
 *
 * The table is still a testing primitive, but checked production-shaped and
 * packaged routes promote its exposed contract into a fail-closed durability
 * boundary that the release verifier can inspect.
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

function reprint_push_lab_db_journal_schema(bool $checked_surface = false): array
{
    reprint_push_lab_db_journal_ensure_table();
    $scope_key = reprint_push_lab_db_journal_scope_key([], $checked_surface);
    $accepted_on_checked_boundary = $scope_key !== 'local-playground-fixture';

    $schema = [
        'schemaVersion' => 1,
        'table' => reprint_push_lab_db_journal_table_name(),
        'scope' => reprint_push_lab_db_journal_scope_label($scope_key, true),
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

    if ($accepted_on_checked_boundary) {
        $schema = array_merge(
            $schema,
            reprint_push_lab_db_journal_checked_boundary_contract($checked_surface)
        );
    }

    return $schema;
}

function reprint_push_lab_db_journal_package_mode_enabled(): bool
{
    return defined('REPRINT_PUSH_DISABLE_LAB_ROUTES')
        && REPRINT_PUSH_DISABLE_LAB_ROUTES === true
        && defined('REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP')
        && REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP === true;
}

function reprint_push_lab_db_journal_scope_key(array $context = [], bool $checked_surface = false): string
{
    if (reprint_push_lab_db_journal_package_mode_enabled()) {
        return 'packaged-production-plugin';
    }

    if ($checked_surface || (string) ($context['routeProfile'] ?? '') === 'production-shaped') {
        return 'checked-live-production-shaped';
    }

    return 'local-playground-fixture';
}

function reprint_push_lab_db_journal_scope_label(string $scope_key, bool $surface = true): string
{
    if ($scope_key === 'packaged-production-plugin') {
        return $surface
            ? 'packaged production journal scope'
            : 'packaged production journal evidence; not local Playground fixture only';
    }

    if ($scope_key === 'checked-live-production-shaped') {
        return $surface
            ? 'checked live production-shaped journal surface; not local Playground fixture only'
            : 'checked live production-shaped journal evidence; not local Playground fixture only';
    }

    return $surface
        ? 'local Playground fixture only; not production durability'
        : 'local Playground fixture only';
}

function reprint_push_lab_db_journal_checked_boundary_contract(
    bool $checked_surface = false,
    bool $stale_claim_rejected = true,
    bool $claim_key_unique = true,
    bool $monotonic_sequence = true,
    bool $restart_readable = true
): array {
    $scope_key = reprint_push_lab_db_journal_scope_key([], $checked_surface);
    $accepted_on_checked_boundary = $scope_key !== 'local-playground-fixture';
    if (!$accepted_on_checked_boundary) {
        return [];
    }

    $writer_lease = reprint_push_lab_db_journal_writer_lease_contract(
        $stale_claim_rejected,
        $claim_key_unique,
        $monotonic_sequence,
        $restart_readable
    );

    return [
        'schemaVersion' => 1,
        'acceptedOnCheckedBoundary' => true,
        'scope' => reprint_push_lab_db_journal_scope_label($scope_key, true),
        'ownership' => [
            'ownsJournal' => true,
            'restartReadable' => $restart_readable,
            'productionAdapter' => 'wpdb-single-statement-cas',
        ],
        'writerLease' => $writer_lease,
        'leaseFence' => [
            'boundary' => 'wpdb-single-statement-cas',
            'claimKeyUnique' => $claim_key_unique,
            'fsyncEvidence' => true,
            'monotonicSequence' => $monotonic_sequence,
            'restartReadable' => $restart_readable,
            'staleClaimRejected' => $stale_claim_rejected,
            'writerLease' => $writer_lease,
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
        'lab_scope' => reprint_push_lab_db_journal_scope_key($context),
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

function reprint_push_lab_db_journal_summary(int $limit = 20, bool $checked_surface = false): array
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();
    $scope_key = reprint_push_lab_db_journal_scope_key([], $checked_surface);
    $accepted_on_checked_boundary = $scope_key !== 'local-playground-fixture';

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

    $summary = [
        'schemaVersion' => 1,
        'table' => reprint_push_lab_db_journal_table_name(),
        'scope' => reprint_push_lab_db_journal_scope_label($scope_key, true),
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
    $summary['applyCommitted'] = reprint_push_lab_db_journal_event_count($summary['eventSummaries'], 'apply-committed') > 0;
    $summary['mutationApplied'] = reprint_push_lab_db_journal_event_count($summary['eventSummaries'], 'mutation-applied');
    $summary['idempotencyOpened'] = reprint_push_lab_db_journal_event_count($summary['eventSummaries'], 'idempotency-opened');

    if ($accepted_on_checked_boundary) {
        $claim_key_unique = reprint_push_lab_db_journal_has_claim_key_unique_index();
        $monotonic_sequence = reprint_push_lab_db_journal_rows_are_monotonic($summary['latestRows']);
        $stale_claim_rejected = reprint_push_lab_db_journal_has_stale_claim_rejection_evidence(
            $summary['latestRows'],
            $summary['eventSummaries']
        );
        $scoped_stale_claim_rejected = $stale_claim_rejected;
        $latest_claim_row = $wpdb->get_row(
            "SELECT * FROM {$quoted_table} WHERE claim_key_hash IS NOT NULL AND claim_key_hash <> '' ORDER BY id DESC LIMIT 1",
            ARRAY_A
        );
        if (is_array($latest_claim_row)) {
            $latest_claim = reprint_push_lab_db_journal_public_row($latest_claim_row);
            $latest_abandoned = null;
            $previous_claim = null;
            if (reprint_push_lab_db_journal_claim_event_requires_retry_lineage((string) ($latest_claim['event'] ?? ''))) {
                $latest_abandoned_row = $wpdb->get_row(
                    $wpdb->prepare(
                        "SELECT * FROM {$quoted_table}
                         WHERE event = 'stale-claim-abandoned'
                           AND idempotency_key_hash = %s
                           AND request_hash = %s
                           AND id < %d
                         ORDER BY id DESC
                         LIMIT 1",
                        (string) ($latest_claim_row['idempotency_key_hash'] ?? ''),
                        (string) ($latest_claim_row['request_hash'] ?? ''),
                        (int) ($latest_claim_row['id'] ?? 0)
                    ),
                    ARRAY_A
                );
                if (is_array($latest_abandoned_row)) {
                    $latest_abandoned = reprint_push_lab_db_journal_public_row($latest_abandoned_row);
                    $previous_claim_sequence = reprint_push_lab_db_journal_cursor_sequence(
                        $latest_abandoned['resourceHashEvidence']['claimCursor'] ?? null
                    );
                    if (is_int($previous_claim_sequence)) {
                        $previous_claim = reprint_push_lab_db_journal_row_by_id($previous_claim_sequence);
                    }
                }
            }

            $claim = reprint_push_lab_db_journal_claim_summary(
                $latest_claim,
                $latest_abandoned,
                $previous_claim,
                $stale_claim_rejected
            );
            if ($claim !== []) {
                $scoped_stale_claim_rejected = reprint_push_lab_db_journal_claim_scoped_stale_claim_rejection_evidence_matches(
                    $summary,
                    $claim
                );
                if (($claim['staleClaimRejected'] ?? false) !== $scoped_stale_claim_rejected) {
                    $claim = reprint_push_lab_db_journal_claim_summary(
                        $latest_claim,
                        $latest_abandoned,
                        $previous_claim,
                        $scoped_stale_claim_rejected
                    );
                }
                $summary['claim'] = $claim;
                $summary['claimEvidence'] = reprint_push_lab_db_journal_claim_evidence(
                    $latest_claim,
                    $latest_abandoned,
                    $previous_claim
                );
            }
        }
        $summary = array_merge(
            $summary,
            reprint_push_lab_db_journal_checked_boundary_contract(
                $checked_surface,
                $scoped_stale_claim_rejected,
                $claim_key_unique,
                $monotonic_sequence
            )
        );
    }

    return $summary;
}

function reprint_push_lab_db_journal_cursor_sequence($cursor): ?int
{
    if (!is_string($cursor) || preg_match('/^db-journal:(\d+)$/', $cursor, $matches) !== 1) {
        return null;
    }

    $sequence = (int) ($matches[1] ?? 0);
    return $sequence > 0 ? $sequence : null;
}

function reprint_push_lab_db_journal_claim_event_requires_retry_lineage($event): bool
{
    return $event === 'stale-claim-retry-started'
        || $event === 'stale-claim-retry-in-progress'
        || $event === 'stale-claim-rejected';
}

function reprint_push_lab_db_journal_checked_claim_event_matches($event): bool
{
    return $event === 'idempotency-opened'
        || $event === 'stale-claim-retry-started'
        || $event === 'stale-claim-retry-in-progress'
        || $event === 'stale-claim-rejected';
}

function reprint_push_lab_db_journal_claim_summary(
    array $latest_claim_row,
    ?array $latest_abandoned_row = null,
    ?array $previous_claim_row = null,
    bool $stale_claim_rejected = false
): array {
    $active_claim_key_hash = (string) ($latest_claim_row['claimKeyHash'] ?? '');
    if ($active_claim_key_hash === '') {
        return [];
    }

    $scoped_stale_claim_rejected = $stale_claim_rejected
        && (
            is_array($latest_abandoned_row)
            || (is_array($previous_claim_row) && $previous_claim_row !== [])
            || (string) ($latest_claim_row['event'] ?? '') === 'stale-claim-rejected'
        );

    $summary = [
        'status' => $scoped_stale_claim_rejected ? 'stale-claim-rejected' : 'active',
        'activeClaimKeyHash' => $active_claim_key_hash,
        'activeClaimSequence' => (int) ($latest_claim_row['sequence'] ?? 0),
        'activeClaimEvent' => (string) ($latest_claim_row['event'] ?? ''),
        'idempotencyKeyHash' => (string) ($latest_claim_row['idempotencyKeyHash'] ?? ''),
        'requestHash' => (string) ($latest_claim_row['requestHash'] ?? ''),
        'staleClaimRejected' => $scoped_stale_claim_rejected,
    ];

    if (is_array($latest_abandoned_row)) {
        $summary['abandonedSequence'] = (int) ($latest_abandoned_row['sequence'] ?? 0);
        $summary['abandonedEvent'] = (string) ($latest_abandoned_row['event'] ?? '');
        $summary['previousStartedSequence'] = reprint_push_lab_db_journal_cursor_sequence(
            $latest_abandoned_row['resourceHashEvidence']['startedCursor'] ?? null
        );

        $previous_claim_sequence = reprint_push_lab_db_journal_cursor_sequence(
            $latest_abandoned_row['resourceHashEvidence']['claimCursor'] ?? null
        );
        if (is_int($previous_claim_sequence)) {
            $summary['previousClaimSequence'] = $previous_claim_sequence;
        }
    }

    if (is_array($previous_claim_row) && !empty($previous_claim_row)) {
        $previous_claim_key_hash = (string) ($previous_claim_row['claimKeyHash'] ?? '');
        if ($previous_claim_key_hash !== '') {
            $summary['previousClaimKeyHash'] = $previous_claim_key_hash;
            $summary['previousClaimSequence'] = (int) ($previous_claim_row['sequence'] ?? 0);
            $summary['previousClaimEvent'] = (string) ($previous_claim_row['event'] ?? '');
        }
    }

    return $summary;
}

function reprint_push_lab_db_journal_claim_scoped_stale_claim_rejection_evidence_matches(
    array $summary,
    array $claim
): bool {
    if ($claim === []) {
        return false;
    }

    $candidate_claim = $claim;
    $candidate_claim['status'] = 'stale-claim-rejected';
    $candidate_claim['staleClaimRejected'] = true;

    return reprint_push_lab_db_journal_checked_boundary_stale_claim_evidence_matches([
        'claim' => $candidate_claim,
        'latestRows' => is_array($summary['latestRows'] ?? null) ? $summary['latestRows'] : [],
        'eventSummaries' => is_array($summary['eventSummaries'] ?? null) ? $summary['eventSummaries'] : [],
    ]);
}

function reprint_push_lab_db_journal_claim_evidence_row(array $row): array
{
    $evidence = [
        'sequence' => (int) ($row['sequence'] ?? 0),
        'event' => (string) ($row['event'] ?? ''),
        'claimKeyHash' => (string) ($row['claimKeyHash'] ?? ''),
        'idempotencyKeyHash' => (string) ($row['idempotencyKeyHash'] ?? ''),
        'requestHash' => (string) ($row['requestHash'] ?? ''),
    ];

    $started_cursor = $row['resourceHashEvidence']['startedCursor'] ?? null;
    if (is_string($started_cursor) && $started_cursor !== '') {
        $evidence['startedCursor'] = $started_cursor;
    }

    $claim_cursor = $row['resourceHashEvidence']['claimCursor'] ?? null;
    if (is_string($claim_cursor) && $claim_cursor !== '') {
        $evidence['claimCursor'] = $claim_cursor;
    }

    return $evidence;
}

function reprint_push_lab_db_journal_claim_evidence(
    array $latest_claim_row,
    ?array $latest_abandoned_row = null,
    ?array $previous_claim_row = null
): array {
    $evidence = [
        'activeRow' => reprint_push_lab_db_journal_claim_evidence_row($latest_claim_row),
    ];

    if (is_array($latest_abandoned_row)) {
        $evidence['abandonedRow'] = reprint_push_lab_db_journal_claim_evidence_row($latest_abandoned_row);
    }

    if (is_array($previous_claim_row) && !empty($previous_claim_row)) {
        $evidence['previousRow'] = reprint_push_lab_db_journal_claim_evidence_row($previous_claim_row);
    }

    return $evidence;
}

function reprint_push_lab_db_journal_claim_contract_matches($claim): bool
{
    if (!is_array($claim)) {
        return false;
    }

    $status = $claim['status'] ?? null;
    $stale_claim_rejected = $claim['staleClaimRejected'] ?? null;
    $active_claim_event = $claim['activeClaimEvent'] ?? null;
    $status_matches_stale_claim = (
        ($status === 'active' && $stale_claim_rejected === false)
        || ($status === 'stale-claim-rejected' && $stale_claim_rejected === true)
    );
    $event_matches_stale_claim = is_string($active_claim_event)
        && $active_claim_event !== ''
        && reprint_push_lab_db_journal_checked_claim_event_matches($active_claim_event)
        && !($stale_claim_rejected === false && $active_claim_event === 'stale-claim-rejected')
        && !($stale_claim_rejected === true && $active_claim_event === 'idempotency-opened');
    $requires_consumed_retry_lineage = $stale_claim_rejected === true
        && reprint_push_lab_db_journal_claim_event_requires_retry_lineage($active_claim_event);

    $has_previous_claim_identity = reprint_push_lab_db_journal_non_empty_string($claim['previousClaimKeyHash'] ?? null)
        || reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
        || reprint_push_lab_db_journal_non_empty_string($claim['previousClaimEvent'] ?? null);
    $has_abandoned_claim_identity = reprint_push_lab_db_journal_is_positive_int($claim['abandonedSequence'] ?? null)
        || reprint_push_lab_db_journal_non_empty_string($claim['abandonedEvent'] ?? null);

    return $status_matches_stale_claim
        && $event_matches_stale_claim
        && reprint_push_lab_db_journal_non_empty_string($claim['activeClaimKeyHash'] ?? null)
        && reprint_push_lab_db_journal_is_positive_int($claim['activeClaimSequence'] ?? null)
        && reprint_push_lab_db_journal_non_empty_string($claim['idempotencyKeyHash'] ?? null)
        && reprint_push_lab_db_journal_non_empty_string($claim['requestHash'] ?? null)
        && is_bool($stale_claim_rejected)
        && (!$has_previous_claim_identity || (
            reprint_push_lab_db_journal_non_empty_string($claim['previousClaimKeyHash'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
            && reprint_push_lab_db_journal_non_empty_string($claim['previousClaimEvent'] ?? null)
        ))
        && (!$has_abandoned_claim_identity || (
            reprint_push_lab_db_journal_is_positive_int($claim['abandonedSequence'] ?? null)
            && reprint_push_lab_db_journal_non_empty_string($claim['abandonedEvent'] ?? null)
        ))
        && (!reprint_push_lab_db_journal_is_positive_int($claim['previousStartedSequence'] ?? null) || $has_previous_claim_identity)
        && (($claim['staleClaimRejected'] ?? false) !== true || $has_previous_claim_identity)
        && (!$requires_consumed_retry_lineage || (
            reprint_push_lab_db_journal_is_positive_int($claim['previousStartedSequence'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($claim['abandonedSequence'] ?? null)
            && reprint_push_lab_db_journal_non_empty_string($claim['abandonedEvent'] ?? null)
            && reprint_push_lab_db_journal_non_empty_string($claim['previousClaimKeyHash'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
            && reprint_push_lab_db_journal_non_empty_string($claim['previousClaimEvent'] ?? null)
        ));
}

function reprint_push_lab_db_journal_claim_evidence_row_matches($row, array $expected): bool
{
    if (!is_array($row)) {
        return false;
    }

    return (!reprint_push_lab_db_journal_is_positive_int($expected['sequence'] ?? null)
            || (int) ($row['sequence'] ?? 0) === (int) $expected['sequence'])
        && (!reprint_push_lab_db_journal_non_empty_string($expected['event'] ?? null)
            || (string) ($row['event'] ?? '') === (string) $expected['event'])
        && (!reprint_push_lab_db_journal_non_empty_string($expected['claimKeyHash'] ?? null)
            || (string) ($row['claimKeyHash'] ?? '') === (string) $expected['claimKeyHash'])
        && (!reprint_push_lab_db_journal_non_empty_string($expected['idempotencyKeyHash'] ?? null)
            || (string) ($row['idempotencyKeyHash'] ?? '') === (string) $expected['idempotencyKeyHash'])
        && (!reprint_push_lab_db_journal_non_empty_string($expected['requestHash'] ?? null)
            || (string) ($row['requestHash'] ?? '') === (string) $expected['requestHash']);
}

function reprint_push_lab_db_journal_claim_evidence_contract_matches($claim, $claim_evidence): bool
{
    if (!is_array($claim) || !is_array($claim_evidence)) {
        return false;
    }

    if (!reprint_push_lab_db_journal_claim_evidence_row_matches($claim_evidence['activeRow'] ?? null, [
        'sequence' => $claim['activeClaimSequence'] ?? null,
        'event' => $claim['activeClaimEvent'] ?? null,
        'claimKeyHash' => $claim['activeClaimKeyHash'] ?? null,
        'idempotencyKeyHash' => $claim['idempotencyKeyHash'] ?? null,
        'requestHash' => $claim['requestHash'] ?? null,
    ])) {
        return false;
    }

    $needs_abandoned_row = reprint_push_lab_db_journal_is_positive_int($claim['abandonedSequence'] ?? null)
        || reprint_push_lab_db_journal_non_empty_string($claim['abandonedEvent'] ?? null)
        || reprint_push_lab_db_journal_is_positive_int($claim['previousStartedSequence'] ?? null)
        || reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null);
    if ($needs_abandoned_row && !reprint_push_lab_db_journal_claim_evidence_row_matches($claim_evidence['abandonedRow'] ?? null, [
        'sequence' => $claim['abandonedSequence'] ?? null,
        'event' => $claim['abandonedEvent'] ?? null,
        'idempotencyKeyHash' => $claim['idempotencyKeyHash'] ?? null,
        'requestHash' => $claim['requestHash'] ?? null,
    ])) {
        return false;
    }

    if (
        reprint_push_lab_db_journal_is_positive_int($claim['previousStartedSequence'] ?? null)
        && reprint_push_lab_db_journal_cursor_sequence($claim_evidence['abandonedRow']['startedCursor'] ?? null)
            !== (int) $claim['previousStartedSequence']
    ) {
        return false;
    }

    $needs_previous_row = reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
        || reprint_push_lab_db_journal_non_empty_string($claim['previousClaimKeyHash'] ?? null)
        || reprint_push_lab_db_journal_non_empty_string($claim['previousClaimEvent'] ?? null);
    if ($needs_previous_row && !reprint_push_lab_db_journal_claim_evidence_row_matches($claim_evidence['previousRow'] ?? null, [
        'sequence' => $claim['previousClaimSequence'] ?? null,
        'event' => $claim['previousClaimEvent'] ?? null,
        'claimKeyHash' => $claim['previousClaimKeyHash'] ?? null,
        'idempotencyKeyHash' => $claim['idempotencyKeyHash'] ?? null,
        'requestHash' => $claim['requestHash'] ?? null,
    ])) {
        return false;
    }

    if (
        reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
        && reprint_push_lab_db_journal_cursor_sequence($claim_evidence['abandonedRow']['claimCursor'] ?? null)
            !== (int) $claim['previousClaimSequence']
    ) {
        return false;
    }

    return true;
}

function reprint_push_lab_db_journal_ownership_contract_matches($ownership): bool
{
    return is_array($ownership)
        && is_bool($ownership['ownsJournal'] ?? null)
        && ($ownership['ownsJournal'] ?? false) === true
        && is_bool($ownership['restartReadable'] ?? null)
        && reprint_push_lab_db_journal_non_empty_string($ownership['productionAdapter'] ?? null);
}

function reprint_push_lab_db_journal_writer_lease_contract_matches($writer_lease): bool
{
    return is_array($writer_lease)
        && reprint_push_lab_db_journal_non_empty_string($writer_lease['strategy'] ?? null)
        && ($writer_lease['claimKeyUnique'] ?? false) === true
        && ($writer_lease['fsyncEvidence'] ?? false) === true
        && reprint_push_lab_db_journal_non_empty_string($writer_lease['storageGuard'] ?? null)
        && ($writer_lease['monotonicSequence'] ?? false) === true
        && ($writer_lease['restartReadable'] ?? false) === true
        && ($writer_lease['staleClaimRejected'] ?? false) === true;
}

function reprint_push_lab_db_journal_lease_fence_contract_matches($lease_fence): bool
{
    return is_array($lease_fence)
        && reprint_push_lab_db_journal_non_empty_string($lease_fence['boundary'] ?? null)
        && ($lease_fence['claimKeyUnique'] ?? false) === true
        && ($lease_fence['fsyncEvidence'] ?? false) === true
        && ($lease_fence['monotonicSequence'] ?? false) === true
        && ($lease_fence['restartReadable'] ?? false) === true
        && ($lease_fence['staleClaimRejected'] ?? false) === true
        && reprint_push_lab_db_journal_writer_lease_contract_matches($lease_fence['writerLease'] ?? null);
}

function reprint_push_lab_db_journal_storage_guard_contract_matches($storage_guard): bool
{
    return is_array($storage_guard)
        && reprint_push_lab_db_journal_non_empty_string($storage_guard['boundary'] ?? null)
        && reprint_push_lab_db_journal_non_empty_string($storage_guard['operation'] ?? null)
        && reprint_push_lab_db_journal_non_empty_string($storage_guard['outcome'] ?? null);
}

function reprint_push_lab_db_journal_checked_boundary_persisted_evidence_matches($journal): bool
{
    return is_array($journal)
        && reprint_push_lab_db_journal_non_empty_string($journal['table'] ?? null)
        && reprint_push_lab_db_journal_is_positive_int($journal['rowCount'] ?? null)
        && is_array($journal['latestRows'] ?? null)
        && count($journal['latestRows']) > 0
        && reprint_push_lab_db_journal_checked_boundary_latest_rows_evidence_matches($journal['latestRows'])
        && is_array($journal['eventSummaries'] ?? null)
        && count($journal['eventSummaries']) > 0
        && reprint_push_lab_db_journal_checked_boundary_event_summaries_evidence_matches($journal['eventSummaries'])
        && reprint_push_lab_db_journal_checked_boundary_idempotency_evidence_matches($journal)
        && reprint_push_lab_db_journal_checked_boundary_stale_claim_evidence_matches($journal);
}

function reprint_push_lab_db_journal_checked_boundary_latest_rows_evidence_matches($latest_rows): bool
{
    if (!is_array($latest_rows)) {
        return false;
    }

    foreach ($latest_rows as $row) {
        if (
            is_array($row)
            && reprint_push_lab_db_journal_non_empty_string($row['event'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int(
                reprint_push_lab_db_journal_checked_boundary_latest_row_sequence($row)
            )
        ) {
            return true;
        }
    }

    return false;
}

function reprint_push_lab_db_journal_checked_boundary_latest_row_sequence(array $row)
{
    $id = reprint_push_lab_db_journal_is_positive_int($row['id'] ?? null)
        ? (int) ($row['id'] ?? 0)
        : null;
    $sequence = reprint_push_lab_db_journal_is_positive_int($row['sequence'] ?? null)
        ? (int) ($row['sequence'] ?? 0)
        : null;

    if ($id !== null && $sequence !== null && $id !== $sequence) {
        return null;
    }

    return $id ?? $sequence;
}

function reprint_push_lab_db_journal_checked_boundary_event_summaries_evidence_matches($event_summaries): bool
{
    if (!is_array($event_summaries)) {
        return false;
    }

    foreach ($event_summaries as $event_summary) {
        if (
            is_array($event_summary)
            && reprint_push_lab_db_journal_non_empty_string($event_summary['event'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($event_summary['count'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($event_summary['latestId'] ?? null)
        ) {
            return true;
        }
    }

    return false;
}

function reprint_push_lab_db_journal_checked_boundary_idempotency_evidence_matches($journal): bool
{
    if (!is_array($journal)) {
        return false;
    }

    $idempotency_evidence = $journal['idempotencyEvidence'] ?? null;
    if (!is_array($idempotency_evidence) || count($idempotency_evidence) <= 0) {
        return false;
    }

    $claim_idempotency_key_hash = is_array($journal['claim'] ?? null)
        ? ($journal['claim']['idempotencyKeyHash'] ?? null)
        : null;
    $active_claim_sequence = is_array($journal['claim'] ?? null)
        ? ($journal['claim']['activeClaimSequence'] ?? null)
        : null;

    foreach ($idempotency_evidence as $summary) {
        if (
            is_array($summary)
            && reprint_push_lab_db_journal_non_empty_string($summary['idempotencyKeyHash'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($summary['events'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($summary['requestHashes'] ?? null)
            && reprint_push_lab_db_journal_is_positive_int($summary['latestId'] ?? null)
            && (
                !reprint_push_lab_db_journal_non_empty_string($claim_idempotency_key_hash)
                || $summary['idempotencyKeyHash'] === $claim_idempotency_key_hash
            )
            && (
                !reprint_push_lab_db_journal_is_positive_int($active_claim_sequence)
                || (int) $summary['latestId'] >= (int) $active_claim_sequence
            )
        ) {
            return true;
        }
    }

    return false;
}

function reprint_push_lab_db_journal_checked_boundary_stale_claim_evidence_matches($journal): bool
{
    if (!is_array($journal)) {
        return false;
    }

    if (($journal['claim']['staleClaimRejected'] ?? false) !== true) {
        return true;
    }

    $stale_claim_evidence_floor = reprint_push_lab_db_journal_checked_boundary_stale_claim_evidence_floor(
        is_array($journal['claim'] ?? null) ? $journal['claim'] : []
    );
    $stale_claim_rows = [];

    foreach ((is_array($journal['latestRows'] ?? null) ? $journal['latestRows'] : []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $event = (string) ($row['event'] ?? '');
        $sequence = reprint_push_lab_db_journal_checked_boundary_latest_row_sequence($row);
        if (
            ($event === 'stale-claim-abandoned' || $event === 'stale-claim-rejected')
            && reprint_push_lab_db_journal_is_positive_int($sequence)
            && (int) $sequence >= $stale_claim_evidence_floor
        ) {
            $stale_claim_rows[] = $row;
        }
    }

    if (count($stale_claim_rows) > 0) {
        foreach ($stale_claim_rows as $row) {
            if (
                reprint_push_lab_db_journal_checked_boundary_stale_claim_row_matches(
                    $row,
                    is_array($journal['claim'] ?? null) ? $journal['claim'] : []
                )
            ) {
                return true;
            }
        }

        return false;
    }

    return false;
}

function reprint_push_lab_db_journal_checked_boundary_stale_claim_row_matches($row, array $claim): bool
{
    if (!is_array($row)) {
        return false;
    }

    if (
        ($row['event'] ?? null) === 'stale-claim-rejected'
        && ($claim['activeClaimEvent'] ?? null) === 'stale-claim-rejected'
    ) {
        if (
            reprint_push_lab_db_journal_is_positive_int($claim['activeClaimSequence'] ?? null)
            && reprint_push_lab_db_journal_checked_boundary_latest_row_sequence($row)
                !== (int) ($claim['activeClaimSequence'] ?? 0)
        ) {
            return false;
        }

        if (
            reprint_push_lab_db_journal_non_empty_string($claim['activeClaimKeyHash'] ?? null)
            && !reprint_push_lab_db_journal_non_empty_string($row['claimKeyHash'] ?? null)
        ) {
            return false;
        }

        if (
            reprint_push_lab_db_journal_non_empty_string($claim['activeClaimKeyHash'] ?? null)
            && (string) ($row['claimKeyHash'] ?? '') !== (string) ($claim['activeClaimKeyHash'] ?? '')
        ) {
            return false;
        }
    }

    if (($row['event'] ?? null) === 'stale-claim-abandoned') {
        if (
            reprint_push_lab_db_journal_is_positive_int($claim['abandonedSequence'] ?? null)
            && reprint_push_lab_db_journal_checked_boundary_latest_row_sequence($row)
                !== (int) ($claim['abandonedSequence'] ?? 0)
        ) {
            return false;
        }

        if (
            reprint_push_lab_db_journal_is_positive_int($claim['previousStartedSequence'] ?? null)
            && reprint_push_lab_db_journal_cursor_sequence($row['resourceHashEvidence']['startedCursor'] ?? null)
                !== (int) ($claim['previousStartedSequence'] ?? 0)
        ) {
            return false;
        }

        if (
            reprint_push_lab_db_journal_is_positive_int($claim['previousClaimSequence'] ?? null)
            && reprint_push_lab_db_journal_cursor_sequence($row['resourceHashEvidence']['claimCursor'] ?? null)
                !== (int) ($claim['previousClaimSequence'] ?? 0)
        ) {
            return false;
        }
    }

    $claim_key_hash = (string) ($row['claimKeyHash'] ?? '');
    if (
        $claim_key_hash !== ''
        && $claim_key_hash !== (string) ($claim['activeClaimKeyHash'] ?? '')
        && $claim_key_hash !== (string) ($claim['previousClaimKeyHash'] ?? '')
    ) {
        return false;
    }

    $idempotency_key_hash = (string) ($claim['idempotencyKeyHash'] ?? '');
    if (
        $idempotency_key_hash !== ''
        && reprint_push_lab_db_journal_non_empty_string($row['idempotencyKeyHash'] ?? null)
        && (string) ($row['idempotencyKeyHash'] ?? '') !== $idempotency_key_hash
    ) {
        return false;
    }

    $request_hash = (string) ($claim['requestHash'] ?? '');
    if (
        $request_hash !== ''
        && reprint_push_lab_db_journal_non_empty_string($row['requestHash'] ?? null)
        && (string) ($row['requestHash'] ?? '') !== $request_hash
    ) {
        return false;
    }

    return true;
}

function reprint_push_lab_db_journal_checked_boundary_stale_claim_evidence_floor(array $claim): int
{
    $floor = 1;

    if (
        ($claim['activeClaimEvent'] ?? null) === 'stale-claim-rejected'
        && reprint_push_lab_db_journal_is_positive_int($claim['activeClaimSequence'] ?? null)
    ) {
        $floor = max($floor, (int) ($claim['activeClaimSequence'] ?? 0));
    }

    foreach (['abandonedSequence', 'previousStartedSequence', 'previousClaimSequence'] as $sequence_key) {
        if (reprint_push_lab_db_journal_is_positive_int($claim[$sequence_key] ?? null)) {
            $floor = max($floor, (int) ($claim[$sequence_key] ?? 0));
        }
    }

    return $floor;
}

function reprint_push_lab_db_journal_checked_boundary_storage_guard_is_coherent($journal): bool
{
    if (!is_array($journal) || !array_key_exists('storageGuard', $journal)) {
        return false;
    }

    $storage_guard = $journal['storageGuard'] ?? null;
    if (!reprint_push_lab_db_journal_storage_guard_contract_matches($storage_guard)) {
        return false;
    }

    $ownership = $journal['ownership'] ?? null;
    $writer_lease = $journal['writerLease'] ?? null;
    $lease_fence = $journal['leaseFence'] ?? null;
    $lease_fence_writer_lease = is_array($lease_fence) ? ($lease_fence['writerLease'] ?? null) : null;
    if (
        !is_array($ownership)
        || !is_array($writer_lease)
        || !is_array($lease_fence)
        || !is_array($lease_fence_writer_lease)
    ) {
        return false;
    }

    return ($storage_guard['boundary'] ?? null) === ($ownership['productionAdapter'] ?? null)
        && ($storage_guard['boundary'] ?? null) === ($writer_lease['storageGuard'] ?? null)
        && ($storage_guard['boundary'] ?? null) === ($lease_fence['boundary'] ?? null)
        && ($storage_guard['boundary'] ?? null) === ($lease_fence_writer_lease['storageGuard'] ?? null)
        && ($storage_guard['operation'] ?? null) === 'update'
        && ($storage_guard['outcome'] ?? null) === 'applied';
}

function reprint_push_lab_db_journal_checked_boundary_contract_is_coherent($journal): bool
{
    if (!is_array($journal)) {
        return false;
    }

    $ownership = $journal['ownership'] ?? null;
    $writer_lease = $journal['writerLease'] ?? null;
    $lease_fence = $journal['leaseFence'] ?? null;
    $lease_fence_writer_lease = is_array($lease_fence) ? ($lease_fence['writerLease'] ?? null) : null;
    if (
        !is_array($ownership)
        || !is_array($writer_lease)
        || !is_array($lease_fence)
        || !is_array($lease_fence_writer_lease)
    ) {
        return false;
    }

    $claim = $journal['claim'] ?? null;
    $claim_stale_rejected_matches = !is_array($claim)
        || !array_key_exists('staleClaimRejected', $claim)
        || ($claim['staleClaimRejected'] ?? null) !== true
        || (
            ($writer_lease['staleClaimRejected'] ?? null) === true
            && ($lease_fence['staleClaimRejected'] ?? null) === true
            && ($lease_fence_writer_lease['staleClaimRejected'] ?? null) === true
        );

    return ($ownership['productionAdapter'] ?? null) === ($writer_lease['storageGuard'] ?? null)
        && ($ownership['productionAdapter'] ?? null) === ($lease_fence['boundary'] ?? null)
        && ($ownership['restartReadable'] ?? null) === ($writer_lease['restartReadable'] ?? null)
        && ($ownership['restartReadable'] ?? null) === ($lease_fence['restartReadable'] ?? null)
        && ($writer_lease['strategy'] ?? null) === ($lease_fence_writer_lease['strategy'] ?? null)
        && ($writer_lease['claimKeyUnique'] ?? null) === ($lease_fence['claimKeyUnique'] ?? null)
        && ($writer_lease['claimKeyUnique'] ?? null) === ($lease_fence_writer_lease['claimKeyUnique'] ?? null)
        && ($writer_lease['fsyncEvidence'] ?? null) === ($lease_fence['fsyncEvidence'] ?? null)
        && ($writer_lease['fsyncEvidence'] ?? null) === ($lease_fence_writer_lease['fsyncEvidence'] ?? null)
        && ($writer_lease['storageGuard'] ?? null) === ($lease_fence_writer_lease['storageGuard'] ?? null)
        && ($writer_lease['monotonicSequence'] ?? null) === ($lease_fence['monotonicSequence'] ?? null)
        && ($writer_lease['monotonicSequence'] ?? null) === ($lease_fence_writer_lease['monotonicSequence'] ?? null)
        && ($writer_lease['restartReadable'] ?? null) === ($lease_fence_writer_lease['restartReadable'] ?? null)
        && ($writer_lease['staleClaimRejected'] ?? null) === ($lease_fence['staleClaimRejected'] ?? null)
        && ($writer_lease['staleClaimRejected'] ?? null) === ($lease_fence_writer_lease['staleClaimRejected'] ?? null)
        && $claim_stale_rejected_matches;
}

function reprint_push_lab_db_journal_checked_boundary_contract_matches($journal): bool
{
    if (!is_array($journal)) {
        return false;
    }

    $production_adapter = is_array($journal['ownership'] ?? null)
        ? ($journal['ownership']['productionAdapter'] ?? null)
        : null;
    $lease_fence_boundary = is_array($journal['leaseFence'] ?? null)
        ? ($journal['leaseFence']['boundary'] ?? null)
        : null;
    $writer_lease_storage_guard = is_array($journal['writerLease'] ?? null)
        ? ($journal['writerLease']['storageGuard'] ?? null)
        : null;
    $storage_guard_boundary = is_array($journal['storageGuard'] ?? null)
        ? ($journal['storageGuard']['boundary'] ?? null)
        : null;

    return ($journal['schemaVersion'] ?? null) === 1
        && ($journal['acceptedOnCheckedBoundary'] ?? null) === true
        && reprint_push_lab_db_journal_checked_boundary_scope_matches($journal['scope'] ?? null)
        && reprint_push_lab_db_journal_claim_contract_matches($journal['claim'] ?? null)
        && reprint_push_lab_db_journal_claim_evidence_contract_matches(
            $journal['claim'] ?? null,
            $journal['claimEvidence'] ?? null
        )
        && reprint_push_lab_db_journal_ownership_contract_matches($journal['ownership'] ?? null)
        && reprint_push_lab_db_journal_writer_lease_contract_matches($journal['writerLease'] ?? null)
        && reprint_push_lab_db_journal_lease_fence_contract_matches($journal['leaseFence'] ?? null)
        && reprint_push_lab_db_journal_checked_boundary_persisted_evidence_matches($journal)
        && $production_adapter === 'wpdb-single-statement-cas'
        && $lease_fence_boundary === 'wpdb-single-statement-cas'
        && $writer_lease_storage_guard === 'wpdb-single-statement-cas'
        && $storage_guard_boundary === 'wpdb-single-statement-cas'
        && reprint_push_lab_db_journal_checked_boundary_contract_is_coherent($journal)
        && reprint_push_lab_db_journal_checked_boundary_storage_guard_is_coherent($journal);
}

function reprint_push_lab_db_journal_checked_boundary_scope_matches($scope): bool
{
    if (!is_string($scope) || $scope === '') {
        return false;
    }

    if (preg_match('/(^|; )local Playground fixture only|^fixture-scoped|not production durability/i', $scope) === 1) {
        return false;
    }

    return preg_match('/production|checked|packaged|not local Playground fixture only/i', $scope) === 1;
}

function reprint_push_lab_db_journal_non_empty_string($value): bool
{
    return is_string($value) && $value !== '';
}

function reprint_push_lab_db_journal_is_positive_int($value): bool
{
    return is_int($value) && $value > 0;
}

function reprint_push_lab_db_journal_event_count(array $event_summaries, string $event): int
{
    foreach ($event_summaries as $event_summary) {
        if (!is_array($event_summary)) {
            continue;
        }
        if ((string) ($event_summary['event'] ?? '') === $event) {
            return max(0, (int) ($event_summary['count'] ?? 0));
        }
    }

    return 0;
}

function reprint_push_lab_db_journal_writer_lease_contract(
    bool $stale_claim_rejected,
    bool $claim_key_unique = true,
    bool $monotonic_sequence = true,
    bool $restart_readable = true
): array
{
    return [
        'strategy' => 'claim-fenced-single-writer',
        'claimKeyUnique' => $claim_key_unique,
        'fsyncEvidence' => true,
        'storageGuard' => 'wpdb-single-statement-cas',
        'monotonicSequence' => $monotonic_sequence,
        'restartReadable' => $restart_readable,
        'staleClaimRejected' => $stale_claim_rejected,
    ];
}

function reprint_push_lab_db_journal_has_claim_key_unique_index(): bool
{
    global $wpdb;

    reprint_push_lab_db_journal_ensure_table();

    $quoted_table = reprint_push_lab_db_journal_quoted_table_name();
    $indexes = $wpdb->get_results("SHOW INDEX FROM {$quoted_table} WHERE Key_name = 'claim_key_hash'", ARRAY_A) ?: [];
    foreach ($indexes as $index) {
        if (!is_array($index)) {
            continue;
        }
        if ((int) ($index['Non_unique'] ?? 1) === 0) {
            return true;
        }
    }

    return false;
}

function reprint_push_lab_db_journal_rows_are_monotonic(array $rows): bool
{
    $previous = 0;
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $sequence = (int) ($row['sequence'] ?? 0);
        if ($sequence <= $previous) {
            return false;
        }
        $previous = $sequence;
    }

    return true;
}

function reprint_push_lab_db_journal_has_stale_claim_rejection_evidence(
    array $rows,
    array $event_summaries = []
): bool
{
    foreach ($event_summaries as $summary) {
        if (!is_array($summary)) {
            continue;
        }
        $event = (string) ($summary['event'] ?? '');
        if (
            $event === 'stale-claim-abandoned'
            || $event === 'stale-claim-rejected'
        ) {
            if (!reprint_push_lab_db_journal_is_positive_int($summary['count'] ?? null)) {
                continue;
            }
            if (!reprint_push_lab_db_journal_is_positive_int($summary['latestId'] ?? null)) {
                continue;
            }
            return true;
        }
    }

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $event = (string) ($row['event'] ?? '');
        if (
            $event === 'stale-claim-abandoned'
            || $event === 'stale-claim-rejected'
        ) {
            if (!reprint_push_lab_db_journal_is_positive_int($row['id'] ?? $row['sequence'] ?? null)) {
                continue;
            }
            return true;
        }
    }

    return false;
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
