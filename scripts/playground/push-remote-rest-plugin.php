<?php
/**
 * Plugin Name: Reprint Push Lab REST Endpoint
 * Description: Lab-only WordPress REST surface for the local Playground push protocol fixture.
 * Version: 0.0.0
 * License: GPL-2.0-or-later
 *
 * This file is intentionally public and unauthenticated only for local
 * Playground proof runs. It must be loaded as an ordinary plugin or mu-plugin
 * inside a disposable local WordPress instance; it is not production auth.
 */

if (!defined('ABSPATH')) {
    exit;
}

$reprint_push_lab_dir = getenv('REPRINT_PUSH_LAB_DIR') ?: __DIR__;
if (!is_file($reprint_push_lab_dir . '/snapshot-lib.php') && is_file('/workspace/scripts/playground/snapshot-lib.php')) {
    $reprint_push_lab_dir = '/workspace/scripts/playground';
}

require_once $reprint_push_lab_dir . '/snapshot-lib.php';
require_once $reprint_push_lab_dir . '/push-remote-lib.php';
require_once $reprint_push_lab_dir . '/push-db-journal-lib.php';

const REPRINT_PUSH_LAB_REST_NAMESPACE = 'reprint-push-lab/v1';

add_action('rest_api_init', 'reprint_push_lab_rest_register_routes');

function reprint_push_lab_rest_register_routes(): void
{
    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/dry-run', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_dry_run',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/apply', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_apply',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/recovery/inspect', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'reprint_push_lab_rest_recovery_inspect',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/snapshot', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_snapshot',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_journal',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
        'args' => [
            'limit' => [
                'type' => 'integer',
                'default' => 20,
                'minimum' => 1,
                'maximum' => 80,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/db-journal', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
        'args' => [
            'limit' => [
                'type' => 'integer',
                'default' => 20,
                'minimum' => 1,
                'maximum' => 80,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route(REPRINT_PUSH_LAB_REST_NAMESPACE, '/db-journal/schema', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'reprint_push_lab_rest_db_journal_schema',
        'permission_callback' => 'reprint_push_lab_rest_public_lab_permission',
    ]);
}

function reprint_push_lab_rest_public_lab_permission(): bool
{
    return true;
}

function reprint_push_lab_rest_dry_run(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_protocol_response('dry-run', $request);
}

function reprint_push_lab_rest_apply(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_apply_with_db_journal($request);
}

function reprint_push_lab_rest_recovery_inspect(WP_REST_Request $request): WP_REST_Response
{
    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'inspect');
        $receipt = reprint_push_lab_rest_receipt_payload($payload);

        $result = reprint_push_protocol_inspect_recovery($plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
            'restRoute' => '/recovery/inspect',
        ]);
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_protocol_response(string $mode, WP_REST_Request $request): WP_REST_Response
{
    try {
        $payload = reprint_push_lab_rest_json_payload($request);
        $plan = reprint_push_lab_rest_plan_payload($payload, $mode);
        $receipt = $mode === 'apply' ? reprint_push_lab_rest_receipt_payload($payload) : null;

        $result = reprint_push_protocol_run_payload($mode, $plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
        ], reprint_push_lab_rest_lab_options($payload));
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_apply_with_db_journal(WP_REST_Request $request): WP_REST_Response
{
    $context = null;
    $received_entry = null;

    try {
        $idempotency_key = trim((string) $request->get_header('x-reprint-push-idempotency-key'));
        if ($idempotency_key === '') {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'MISSING_IDEMPOTENCY_KEY',
                'message' => 'POST /apply requires X-Reprint-Push-Idempotency-Key for the DB journal idempotency path.',
                'mode' => 'apply',
            ]);
        }

        $payload = reprint_push_lab_rest_json_payload($request);
        $context = reprint_push_lab_rest_db_journal_context($payload, $idempotency_key);
        $committed = reprint_push_lab_db_journal_committed_row_for_key($context['idempotencyKeyHash']);

        if (is_array($committed) && (string) ($committed['request_hash'] ?? '') === $context['requestHash']) {
            $replay_result = reprint_push_lab_db_journal_replay_result($committed);
            $replay_entry = reprint_push_lab_db_journal_append_event('apply-replayed', $context + [
                'appliedCount' => 0,
                'result' => $replay_result,
                'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($replay_result),
            ]);
            $replay_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($replay_entry);
            return reprint_push_lab_rest_json_response($replay_result);
        }

        if (reprint_push_lab_db_journal_key_has_different_request($context['idempotencyKeyHash'], $context['requestHash'])) {
            return reprint_push_lab_rest_json_response(
                reprint_push_lab_rest_idempotency_conflict_result($context)
            );
        }

        $claim = reprint_push_lab_db_journal_try_open_idempotency($context);
        if (($claim['opened'] ?? false) !== true) {
            $claim_entry = is_array($claim['entry'] ?? null) ? $claim['entry'] : [];
            if ((string) ($claim_entry['requestHash'] ?? '') !== $context['requestHash']) {
                return reprint_push_lab_rest_json_response(
                    reprint_push_lab_rest_idempotency_conflict_result($context)
                );
            }

            $terminal = reprint_push_lab_db_journal_terminal_row_for_key($context['idempotencyKeyHash']);
            if (is_array($terminal) && (string) ($terminal['request_hash'] ?? '') === $context['requestHash']) {
                $replay_result = (string) ($terminal['event'] ?? '') === 'apply-committed'
                    ? reprint_push_lab_db_journal_replay_result($terminal)
                    : reprint_push_lab_db_journal_replay_rejected_result($terminal);
                $replay_entry = reprint_push_lab_db_journal_append_event('apply-replayed', $context + [
                    'appliedCount' => 0,
                    'result' => $replay_result,
                    'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($replay_result),
                ]);
                $replay_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($replay_entry);
                return reprint_push_lab_rest_json_response($replay_result);
            }

            $missing_commit_result = reprint_push_lab_rest_maybe_finalize_missing_commit($payload, $context, $claim_entry);
            if (is_array($missing_commit_result)) {
                return reprint_push_lab_rest_json_response($missing_commit_result);
            }

            $in_progress_result = [
                'ok' => false,
                'code' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
                'message' => 'An apply request for this idempotency key is already in progress. Retry the same canonical request.',
                'mode' => 'apply',
                'idempotency' => [
                    'replayed' => false,
                    'conflict' => false,
                    'inProgress' => true,
                    'freshMutationWork' => false,
                    'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                    'requestHash' => $context['requestHash'],
                    'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
                ],
            ];
            $in_progress_entry = reprint_push_lab_db_journal_append_event('idempotency-in-progress', $context + [
                'errorCode' => 'IDEMPOTENCY_KEY_IN_PROGRESS',
                'result' => $in_progress_result,
                'resourceHashEvidence' => [
                    'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                    'requestHash' => $context['requestHash'],
                ],
            ]);
            $in_progress_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($in_progress_entry);
            return reprint_push_lab_rest_json_response($in_progress_result);
        }

        $opened_entry = $claim['entry'];
        reprint_push_lab_rest_delay_after_idempotency_open($payload);
        $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
        $receipt = reprint_push_lab_rest_receipt_payload($payload);
        $accepted = reprint_push_lab_rest_validate_apply_for_db_journal($plan, $receipt, $context);
        $mutations = $accepted['mutations'];

        $started_entry = reprint_push_lab_db_journal_append_event('apply-started', $context + [
            'resourceHashEvidence' => [
                'openedCursor' => 'db-journal:' . (int) ($opened_entry['sequence'] ?? 0),
                'mutationCount' => count($mutations),
                'acceptedPlanEvidence' => [
                    'planHash' => $accepted['planEvidence']['planHash'] ?? '',
                    'receiptHash' => (string) ($accepted['receipt']['receiptHash'] ?? ''),
                    'preconditionSetHash' => $accepted['planEvidence']['preconditionSetHash'] ?? '',
                    'mutationSetHash' => $accepted['planEvidence']['mutationSetHash'] ?? '',
                ],
                'verifiedPreconditions' => reprint_push_lab_db_journal_sanitize_value($accepted['verifiedPreconditions']),
                'recoveryTargets' => $accepted['recoveryTargets'],
                'plannedMutations' => reprint_push_lab_db_journal_planned_mutation_evidence($mutations, $accepted['preconditions']),
                'resourceKeys' => array_values(array_map(
                    static fn (array $mutation): string => (string) ($mutation['resourceKey'] ?? ''),
                    $mutations
                )),
            ],
        ]);

        $options = reprint_push_lab_rest_lab_options($payload);
        $options['mutationEventCallback'] = reprint_push_lab_rest_db_journal_mutation_callback($context, $started_entry);
        $result = reprint_push_protocol_run_payload('apply', $plan, $receipt, [
            'transport' => 'wordpress-rest',
            'restNamespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'dbJournalCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
        ], $options);

        $result['idempotency'] = [
            'replayed' => false,
            'freshMutationWork' => true,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
        ];
        if (reprint_push_lab_rest_should_simulate_missing_db_commit($payload)) {
            $result = [
                'ok' => false,
                'code' => 'LAB_SIMULATED_MISSING_DB_COMMIT',
                'message' => 'Lab-only hook stopped after target hashes reached planned after hashes and before DB apply-committed was written.',
                'mode' => 'apply',
                'applied' => (int) ($result['applied'] ?? count($mutations)),
                'idempotency' => [
                    'replayed' => false,
                    'freshMutationWork' => true,
                    'idempotencyKeyHash' => $context['idempotencyKeyHash'],
                    'requestHash' => $context['requestHash'],
                    'missingCommitSimulated' => true,
                ],
                'recovery' => [
                    'required' => true,
                    'state' => 'missing-db-commit-simulated',
                    'scope' => 'lab-only deterministic missing-commit hook; no production durability claim',
                ],
                'dbJournal' => reprint_push_lab_rest_db_journal_evidence($started_entry),
            ];
            return reprint_push_lab_rest_json_response($result);
        }

        $committed_entry = reprint_push_lab_db_journal_append_event('apply-committed', $context + [
            'appliedCount' => (int) ($result['applied'] ?? 0),
            'result' => reprint_push_lab_db_journal_compact_result($result),
            'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($result),
        ]);
        $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($committed_entry);
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
        if (is_array($context)) {
            $rejected_entry = reprint_push_lab_db_journal_append_event('apply-rejected', $context + [
                'appliedCount' => (int) ($result['applied'] ?? 0),
                'errorCode' => (string) ($result['code'] ?? 'PUSH_PROTOCOL_ERROR'),
                'result' => reprint_push_lab_db_journal_compact_result($result),
                'resourceHashEvidence' => reprint_push_lab_db_journal_resource_hash_evidence($result),
            ]);
            $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($rejected_entry);
        }
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
        if (is_array($context)) {
            $error_entry = reprint_push_lab_db_journal_append_event('apply-rejected', $context + [
                'errorCode' => 'PUSH_PROTOCOL_ERROR',
                'result' => reprint_push_lab_db_journal_compact_result($result),
            ]);
            $result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($error_entry);
        }
    }

    return reprint_push_lab_rest_json_response($result);
}

function reprint_push_lab_rest_validate_apply_for_db_journal(array $plan, ?array $receipt_payload, array $context): array
{
    $plan_hash = reprint_push_protocol_plan_hash($plan);
    reprint_push_protocol_assert_plan_ready($plan, 'apply', $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);
    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);

    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);
    if ($receipt_payload === null) {
        $journal_entry = reprint_push_protocol_append_journal_event('receipt-required', $context + [
            'mode' => 'apply',
            'planId' => $plan['id'] ?? null,
            'planHash' => $plan_hash,
        ]);

        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON.',
            'mode' => 'apply',
            'journal' => reprint_push_protocol_journal_evidence($journal_entry),
        ]);
    }

    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);

    $verified_preconditions = reprint_push_protocol_verify_preconditions(
        reprint_push_export_snapshot(),
        $precondition_entries,
        $context + $plan_evidence + ['receiptHash' => (string) ($receipt['receiptHash'] ?? '')]
    );

    return [
        'mutations' => $mutations,
        'preconditions' => $precondition_entries,
        'planEvidence' => $plan_evidence,
        'receipt' => $receipt,
        'verifiedPreconditions' => $verified_preconditions,
        'recoveryTargets' => reprint_push_lab_rest_recovery_targets_for_db_journal($mutations, $precondition_entries),
    ];
}

function reprint_push_lab_rest_db_journal_mutation_callback(array $context, array $started_entry): callable
{
    return static function (string $event, array $evidence) use ($context, $started_entry): void {
        if (!in_array($event, ['mutation-prepared', 'mutation-applied'], true)) {
            return;
        }

        $event_context = $context + [
            'planHash' => (string) ($evidence['planHash'] ?? ''),
            'receiptHash' => (string) ($evidence['receiptHash'] ?? ''),
            'planFingerprint' => (string) ($evidence['planFingerprint'] ?? ''),
            'mutationCount' => (int) ($evidence['mutationCount'] ?? 0),
            'appliedCount' => max(0, (int) ($evidence['appliedCount'] ?? 0)),
            'resourceHashEvidence' => reprint_push_lab_db_journal_mutation_evidence(array_merge($evidence, [
                'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
            ])),
        ];

        reprint_push_lab_db_journal_append_event($event, $event_context);
    };
}

function reprint_push_lab_rest_recovery_targets_for_db_journal(array $mutations, array $preconditions): array
{
    $preconditions_by_mutation = [];
    foreach ($preconditions as $precondition) {
        if (is_array($precondition) && isset($precondition['mutationId'])) {
            $preconditions_by_mutation[(string) $precondition['mutationId']] = $precondition;
        }
    }

    $targets = [];
    foreach ($mutations as $index => $mutation) {
        if (!is_array($mutation) || !isset($mutation['resource']) || !is_array($mutation['resource'])) {
            continue;
        }
        $mutation_id = (string) ($mutation['id'] ?? '');
        $precondition = $preconditions_by_mutation[$mutation_id] ?? [];
        $targets[] = reprint_push_lab_db_journal_sanitize_value([
            'index' => (int) $index,
            'mutationId' => $mutation_id,
            'resourceKey' => (string) ($mutation['resourceKey'] ?? ''),
            'resource' => $mutation['resource'],
            'beforeHash' => (string) ($precondition['expectedHash'] ?? $mutation['remoteBeforeHash'] ?? ''),
            'afterHash' => (string) ($mutation['localHash'] ?? ''),
        ]);
    }
    return $targets;
}

function reprint_push_lab_rest_maybe_finalize_missing_commit(array $payload, array $context, array $claim_entry): ?array
{
    $started_entry = reprint_push_lab_rest_latest_db_row_for_key_event(
        $context['idempotencyKeyHash'],
        $context['requestHash'],
        'apply-started'
    );
    if (!is_array($started_entry)) {
        return null;
    }

    $plan = reprint_push_lab_rest_plan_payload($payload, 'apply');
    $receipt_payload = reprint_push_lab_rest_receipt_payload($payload);
    $validated = reprint_push_lab_rest_validate_plan_receipt_for_missing_commit($plan, $receipt_payload);
    $planned_targets = reprint_push_lab_rest_planned_targets_from_started_entry($started_entry);
    $target_validation = reprint_push_lab_rest_validate_started_targets($planned_targets, $validated['recoveryTargets']);

    if (($target_validation['ok'] ?? false) !== true) {
        return reprint_push_lab_rest_blocked_missing_commit_result(
            $context,
            $claim_entry,
            $started_entry,
            reprint_push_lab_rest_missing_commit_recovery_from_targets($planned_targets, $validated['planEvidence'], $validated['receipt'], [
                'blockedReason' => (string) ($target_validation['reason'] ?? 'missing durable target evidence'),
            ])
        );
    }

    $recovery = reprint_push_lab_rest_missing_commit_recovery_from_targets(
        $planned_targets,
        $validated['planEvidence'],
        $validated['receipt']
    );

    if (($recovery['state'] ?? '') !== 'fully-updated-remote') {
        return reprint_push_lab_rest_blocked_missing_commit_result($context, $claim_entry, $started_entry, $recovery);
    }

    $verified_keys = array_values(array_map(
        static fn (array $target): string => (string) ($target['resourceKey'] ?? ''),
        $planned_targets
    ));
    $finalized_result = [
        'ok' => true,
        'mode' => 'apply',
        'code' => 'BATCH_RECOVERY_FINALIZED',
        'message' => 'Missing DB apply commit finalized after every target hash matched the durable planned after hash.',
        'applied' => count($planned_targets),
        'verifiedKeys' => $verified_keys,
        'receiptHash' => (string) ($validated['receipt']['receiptHash'] ?? ''),
        'recovery' => $recovery + ['finalized' => true],
        'idempotency' => [
            'replayed' => true,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'finalizedMissingCommit' => true,
        ],
        'audit' => [
            'scope' => 'Playground lab DB journal evidence only; no production durability or rollback guarantee',
            'durableEvidence' => [
                'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
                'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
                'requestHash' => $context['requestHash'],
                'planHash' => $context['planHash'],
                'receiptHash' => $context['receiptHash'],
                'plannedTargetCount' => count($planned_targets),
            ],
        ],
    ];

    $committed_entry = reprint_push_lab_db_journal_append_event('apply-committed', $context + [
        'appliedCount' => count($planned_targets),
        'result' => reprint_push_lab_db_journal_compact_result($finalized_result),
        'resourceHashEvidence' => [
            'recoveryFinalized' => true,
            'verifiedKeys' => $verified_keys,
            'recovery' => $recovery,
        ],
    ]);
    $finalized_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($committed_entry);

    return $finalized_result;
}

function reprint_push_lab_rest_validate_plan_receipt_for_missing_commit(array $plan, ?array $receipt_payload): array
{
    $plan_hash = reprint_push_protocol_plan_hash($plan);
    reprint_push_protocol_assert_plan_ready($plan, 'apply', $plan_hash);

    $mutations = reprint_push_protocol_plan_array($plan, 'mutations');
    $precondition_entries = reprint_push_protocol_plan_array($plan, 'preconditions');
    $preconditions = reprint_push_protocol_preconditions_by_mutation($precondition_entries);
    reprint_push_protocol_validate_mutations_and_preconditions($mutations, $preconditions, $precondition_entries);
    $plan_evidence = reprint_push_protocol_plan_evidence($plan, $plan_hash, $mutations, $precondition_entries);

    if ($receipt_payload === null) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'MISSING_DRY_RUN_RECEIPT',
            'message' => 'Apply requires a supplied dry-run receipt JSON.',
            'mode' => 'apply',
        ]);
    }

    $receipt = reprint_push_protocol_extract_receipt($receipt_payload);
    reprint_push_protocol_assert_receipt_binds_to_plan($receipt, $plan, $plan_evidence, $mutations, $precondition_entries);

    return [
        'mutations' => $mutations,
        'preconditions' => $precondition_entries,
        'planEvidence' => $plan_evidence,
        'receipt' => $receipt,
        'recoveryTargets' => reprint_push_lab_rest_recovery_targets_for_db_journal($mutations, $precondition_entries),
    ];
}

function reprint_push_lab_rest_latest_db_row_for_key_event(string $idempotency_key_hash, string $request_hash, string $event): ?array
{
    $rows = array_reverse(reprint_push_lab_db_journal_rows_for_key($idempotency_key_hash));
    foreach ($rows as $row) {
        if ((string) ($row['event'] ?? '') !== $event) {
            continue;
        }
        if ((string) ($row['request_hash'] ?? '') !== $request_hash) {
            continue;
        }
        return reprint_push_lab_db_journal_public_row($row);
    }
    return null;
}

function reprint_push_lab_rest_planned_targets_from_started_entry(array $started_entry): array
{
    $evidence = isset($started_entry['resourceHashEvidence']) && is_array($started_entry['resourceHashEvidence'])
        ? $started_entry['resourceHashEvidence']
        : [];
    $targets = isset($evidence['recoveryTargets']) && is_array($evidence['recoveryTargets'])
        ? $evidence['recoveryTargets']
        : [];

    return array_values(array_filter($targets, static function ($target): bool {
        return is_array($target)
            && isset($target['resource'])
            && is_array($target['resource'])
            && isset($target['mutationId'], $target['resourceKey'], $target['beforeHash'], $target['afterHash']);
    }));
}

function reprint_push_lab_rest_validate_started_targets(array $started_targets, array $request_targets): array
{
    if (count($started_targets) === 0 || count($started_targets) !== count($request_targets)) {
        return [
            'ok' => false,
            'reason' => 'missing or incomplete DB apply-started recoveryTargets evidence',
        ];
    }

    foreach ($started_targets as $index => $target) {
        $request_target = $request_targets[$index] ?? null;
        if (!is_array($request_target)
            || reprint_push_stable_json($target) !== reprint_push_stable_json($request_target)
        ) {
            return [
                'ok' => false,
                'reason' => 'DB apply-started target evidence does not match the retried canonical request',
            ];
        }
    }

    return ['ok' => true];
}

function reprint_push_lab_rest_missing_commit_recovery_from_targets(
    array $targets,
    array $plan_evidence,
    array $receipt,
    array $extra = []
): array {
    $snapshot = reprint_push_export_snapshot();
    $recovery_targets = [];
    $current_hashes = [];
    $old = 0;
    $new = 0;
    $unknown = 0;

    foreach ($targets as $index => $target) {
        $current_hash = isset($target['resource']) && is_array($target['resource'])
            ? reprint_push_hash_resource($snapshot, $target['resource'])
            : '';
        $old_hash = (string) ($target['beforeHash'] ?? '');
        $new_hash = (string) ($target['afterHash'] ?? '');
        if ($current_hash !== '' && $current_hash === $old_hash) {
            $classification = 'old';
            $old++;
        } elseif ($current_hash !== '' && $current_hash === $new_hash) {
            $classification = 'new';
            $new++;
        } else {
            $classification = 'blocked-unknown';
            $unknown++;
        }

        $current_hashes[] = [
            'index' => (int) $index,
            'mutationId' => (string) ($target['mutationId'] ?? ''),
            'resourceKey' => (string) ($target['resourceKey'] ?? ''),
            'hash' => $current_hash,
        ];
        $recovery_targets[] = [
            'index' => (int) $index,
            'mutationId' => (string) ($target['mutationId'] ?? ''),
            'resourceKey' => (string) ($target['resourceKey'] ?? ''),
            'resource' => $target['resource'] ?? null,
            'expectedOldHash' => $old_hash,
            'expectedNewHash' => $new_hash,
            'currentHash' => $current_hash,
            'classification' => $classification,
        ];
    }

    $state = 'blocked-recovery';
    if (count($recovery_targets) > 0 && $old === count($recovery_targets)) {
        $state = 'old-remote';
    } elseif (count($recovery_targets) > 0 && $new === count($recovery_targets)) {
        $state = 'fully-updated-remote';
    }

    return [
        'schemaVersion' => 1,
        'scope' => 'Playground lab DB journal missing-commit evidence only; no production durability or rollback guarantee',
        'state' => $state,
        'counts' => [
            'old' => $old,
            'new' => $new,
            'blockedUnknown' => $unknown,
            'total' => count($recovery_targets),
        ],
        'targets' => $recovery_targets,
        'currentHashes' => $current_hashes,
        'currentSnapshotHash' => hash('sha256', reprint_push_stable_json($snapshot)),
        'planEvidence' => $plan_evidence,
        'receiptEvidence' => [
            'receiptHash' => isset($receipt['receiptHash']) ? (string) $receipt['receiptHash'] : null,
            'planHash' => isset($receipt['planHash']) ? (string) $receipt['planHash'] : null,
            'mutationCount' => isset($receipt['mutationCount']) ? (int) $receipt['mutationCount'] : null,
        ],
    ] + $extra;
}

function reprint_push_lab_rest_blocked_missing_commit_result(
    array $context,
    array $claim_entry,
    array $started_entry,
    array $recovery
): array {
    $blocked_result = [
        'ok' => false,
        'code' => 'RECOVERY_BLOCKED',
        'message' => 'Missing DB apply commit cannot be finalized because live target hashes are not all at the durable planned after hashes.',
        'mode' => 'apply',
        'recovery' => $recovery + [
            'required' => true,
            'finalized' => false,
        ],
        'idempotency' => [
            'replayed' => false,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
            'claimSequence' => (int) ($claim_entry['sequence'] ?? 0),
            'startedSequence' => (int) ($started_entry['sequence'] ?? 0),
            'finalizedMissingCommit' => false,
        ],
    ];

    $blocked_entry = reprint_push_lab_db_journal_append_event('recovery-blocked', $context + [
        'errorCode' => 'RECOVERY_BLOCKED',
        'result' => reprint_push_lab_db_journal_compact_result($blocked_result),
        'resourceHashEvidence' => [
            'recovery' => $recovery,
            'claimCursor' => 'db-journal:' . (int) ($claim_entry['sequence'] ?? 0),
            'startedCursor' => 'db-journal:' . (int) ($started_entry['sequence'] ?? 0),
        ],
    ]);
    $blocked_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($blocked_entry);

    return $blocked_result;
}

function reprint_push_lab_rest_idempotency_conflict_result(array $context): array
{
    $conflict_result = [
        'ok' => false,
        'code' => 'IDEMPOTENCY_KEY_CONFLICT',
        'message' => 'Idempotency key was already used for a different canonical apply request.',
        'mode' => 'apply',
        'idempotency' => [
            'replayed' => false,
            'conflict' => true,
            'freshMutationWork' => false,
            'idempotencyKeyHash' => $context['idempotencyKeyHash'],
            'requestHash' => $context['requestHash'],
        ],
    ];
    $conflict_entry = reprint_push_lab_db_journal_append_event('idempotency-key-conflict', $context + [
        'errorCode' => 'IDEMPOTENCY_KEY_CONFLICT',
        'result' => $conflict_result,
    ]);
    $conflict_result['dbJournal'] = reprint_push_lab_rest_db_journal_evidence($conflict_entry);
    return $conflict_result;
}

function reprint_push_lab_rest_db_journal_context(array $payload, string $idempotency_key): array
{
    return [
        'idempotencyKeyHash' => reprint_push_lab_db_journal_key_hash($idempotency_key),
        'requestHash' => reprint_push_lab_db_journal_request_hash($payload),
        'planHash' => reprint_push_lab_db_journal_plan_hash_from_payload($payload),
        'receiptHash' => reprint_push_lab_db_journal_receipt_hash_from_payload($payload),
        'planFingerprint' => reprint_push_lab_db_journal_plan_fingerprint_from_payload($payload),
        'mutationCount' => reprint_push_lab_db_journal_mutation_count_from_payload($payload),
    ];
}

function reprint_push_lab_rest_plan_mutations_for_db_journal(array $plan): array
{
    if (!isset($plan['mutations'])) {
        return [];
    }
    if (!is_array($plan['mutations'])) {
        return [];
    }
    return array_values(array_filter($plan['mutations'], static function ($mutation): bool {
        return is_array($mutation)
            && isset($mutation['resource'])
            && is_array($mutation['resource']);
    }));
}

function reprint_push_lab_rest_json_payload(WP_REST_Request $request): array
{
    $payload = $request->get_json_params();
    if (!is_array($payload)) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'Request body must be a JSON object.',
        ]);
    }
    return $payload;
}

function reprint_push_lab_rest_plan_payload(array $payload, string $mode): array
{
    if (isset($payload['plan'])) {
        if (!is_array($payload['plan'])) {
            reprint_push_protocol_fail([
                'ok' => false,
                'code' => 'INVALID_ARGUMENT',
                'message' => 'Request plan must be a JSON object.',
            ]);
        }
        return $payload['plan'];
    }

    if ($mode === 'dry-run') {
        return $payload;
    }

    reprint_push_protocol_fail([
        'ok' => false,
        'code' => 'INVALID_ARGUMENT',
        'message' => 'Apply requires a plan JSON object.',
    ]);
}

function reprint_push_lab_rest_receipt_payload(array $payload): ?array
{
    if (!array_key_exists('receipt', $payload)) {
        return null;
    }
    if (!is_array($payload['receipt'])) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_RECEIPT',
            'message' => 'Receipt JSON must be an object.',
        ]);
    }
    return $payload['receipt'];
}

function reprint_push_lab_rest_lab_options(array $payload): array
{
    $options = [];
    if (array_key_exists('labFailAfterMutations', $payload)) {
        $options['labFailAfterMutations'] = $payload['labFailAfterMutations'];
    }
    return $options;
}

function reprint_push_lab_rest_should_simulate_missing_db_commit(array $payload): bool
{
    if (!array_key_exists('labSimulateMissingDbCommit', $payload)) {
        return false;
    }
    return $payload['labSimulateMissingDbCommit'] === true
        || $payload['labSimulateMissingDbCommit'] === 1
        || $payload['labSimulateMissingDbCommit'] === '1';
}

function reprint_push_lab_rest_delay_after_idempotency_open(array $payload): void
{
    if (!array_key_exists('labDelayAfterIdempotencyOpenMs', $payload)) {
        return;
    }

    $delay = $payload['labDelayAfterIdempotencyOpenMs'];
    if (!is_int($delay) && !(is_string($delay) && preg_match('/^\d+$/', $delay))) {
        reprint_push_protocol_fail([
            'ok' => false,
            'code' => 'INVALID_ARGUMENT',
            'message' => 'labDelayAfterIdempotencyOpenMs must be a non-negative integer when supplied.',
        ]);
    }

    $milliseconds = max(0, min(5000, (int) $delay));
    if ($milliseconds > 0) {
        $deadline = microtime(true) + ($milliseconds / 1000);
        while (microtime(true) < $deadline) {
            // Lab-only overlap hook for concurrency smoke tests.
            if (function_exists('usleep')) {
                $remaining_microseconds = max(1, (int) (($deadline - microtime(true)) * 1000000));
                usleep(min(50000, $remaining_microseconds));
            }
        }
    }
}

function reprint_push_lab_rest_snapshot(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'snapshot' => reprint_push_export_snapshot(),
    ]);
}

function reprint_push_lab_rest_journal(WP_REST_Request $request): WP_REST_Response
{
    $limit = max(1, min(80, (int) $request->get_param('limit')));
    $journal = get_option('reprint_push_protocol_journal', null);
    $entries = is_array($journal) && isset($journal['entries']) && is_array($journal['entries'])
        ? $journal['entries']
        : [];

    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'journal' => [
            'option' => 'reprint_push_protocol_journal',
            'nextSequence' => is_array($journal) ? (int) ($journal['nextSequence'] ?? 1) : 1,
            'entries' => array_slice($entries, -$limit),
        ],
    ]);
}

function reprint_push_lab_rest_db_journal(WP_REST_Request $request): WP_REST_Response
{
    $limit = max(1, min(500, (int) $request->get_param('limit')));
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'dbJournal' => reprint_push_lab_db_journal_summary($limit),
    ]);
}

function reprint_push_lab_rest_db_journal_schema(WP_REST_Request $request): WP_REST_Response
{
    return reprint_push_lab_rest_json_response([
        'ok' => true,
        'dbJournalSchema' => reprint_push_lab_db_journal_schema(),
    ]);
}

function reprint_push_lab_rest_db_journal_evidence(array $entry): array
{
    return [
        'table' => reprint_push_lab_db_journal_table_name(),
        'cursor' => 'db-journal:' . (int) ($entry['sequence'] ?? 0),
        'event' => (string) ($entry['event'] ?? ''),
        'sequence' => (int) ($entry['sequence'] ?? 0),
        'idempotencyKeyHash' => (string) ($entry['idempotencyKeyHash'] ?? ''),
        'requestHash' => (string) ($entry['requestHash'] ?? ''),
        'resultHash' => (string) ($entry['resultHash'] ?? ''),
        'scope' => 'local Playground fixture only',
    ];
}

function reprint_push_lab_rest_json_response(array $result): WP_REST_Response
{
    $result['lab'] = reprint_push_lab_rest_lab_notice();
    $response = new WP_REST_Response($result, reprint_push_lab_rest_status_for_result($result));
    $response->header('X-Reprint-Push-Lab', 'local-only-public-playground');
    return $response;
}

function reprint_push_lab_rest_lab_notice(): array
{
    return [
        'surface' => 'wordpress-rest',
        'namespace' => REPRINT_PUSH_LAB_REST_NAMESPACE,
        'scope' => 'local Playground fixture only',
        'permission' => 'public lab route; not production auth',
    ];
}

function reprint_push_lab_rest_status_for_result(array $result): int
{
    if (($result['ok'] ?? false) === true) {
        return 200;
    }

    switch ((string) ($result['code'] ?? '')) {
        case 'MISSING_IDEMPOTENCY_KEY':
            return 400;
        case 'IDEMPOTENCY_KEY_CONFLICT':
        case 'IDEMPOTENCY_KEY_IN_PROGRESS':
        case 'RECOVERY_BLOCKED':
            return 409;
        case 'MISSING_DRY_RUN_RECEIPT':
            return 428;
        case 'INVALID_ARGUMENT':
        case 'INVALID_PLAN':
        case 'INVALID_RECEIPT':
            return 400;
        case 'PRECONDITION_FAILED':
            return 412;
        case 'PLAN_NOT_READY':
        case 'RECEIPT_MISMATCH':
            return 409;
        default:
            return 500;
    }
}
