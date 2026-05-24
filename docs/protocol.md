# Reprint Push Protocol Extension

This document defines the production push protocol extension for Reprint. It is
designed as an extension of the existing exporter/importer pull API, not as a
separate synchronization system.

The core invariant is:

1. Dry-run and apply are separate remote operations.
2. Apply revalidates the live remote before every mutation batch.
3. A failed or interrupted apply leaves a durable journal that lets recovery
   prove whether the remote is old, new, or blocked with artifacts.

## Existing Pull Pipeline Mapping

Current Reprint pull is stage-oriented and resumable:

```text
preflight -> files-pull -> db-pull -> db-apply -> flat-docroot -> apply-runtime -> start
```

Push uses the same transport habits but reverses the direction and raises the
safety bar because it mutates the source site:

| Pull stage | Push mapping |
| --- | --- |
| `preflight` | `push_preflight` checks protocol support, auth scope, writable roots, database transaction support, resource budgets, and journal storage. |
| `file_index` / `file_fetch` | `push_snapshot_hashes` lists remote file hashes and metadata without returning bodies. Optional conflict drill-down may reuse pull fetch endpoints. |
| `sql_chunk` / `db_index` | `push_snapshot_hashes` lists database row, option, post, term, user, table-schema, and plugin-owned resource hashes. |
| local `db-apply` | Local push planner compares the saved pull base, edited local site, and live remote hash list to produce a dry-run plan. |
| runtime setup | Push executor validates runtime-sensitive mutations such as plugin/theme activation, generated files, object cache, cron, and maintenance mode gates before apply. |

The importer already persists pull state. Push requires the pull to persist a
base manifest: resource keys, hashes, schema fingerprints, WordPress paths, and
protocol metadata observed when the local site was created. That manifest is the
merge base for later push planning.

## Authentication

All push endpoints require authentication at least as strict as current Reprint
HMAC authentication.

The current HMAC floor is required on every push request:

- `X-Auth-Signature`
- `X-Auth-Nonce`
- `X-Auth-Timestamp`
- `X-Auth-Content-Hash`

The server verifies freshness, nonce length, content hash, and
`HMAC-SHA256(nonce + timestamp + content_hash, shared_secret)` exactly as the
current exporter does.

Mutating push endpoints also require a push canonical signature:

- `X-Reprint-Push-Signature`
- `X-Reprint-Push-Session`
- `X-Reprint-Push-Idempotency-Key`

The canonical signature is:

```text
HMAC-SHA256(
  method + "\n" +
  endpoint + "\n" +
  canonical_query + "\n" +
  content_hash + "\n" +
  push_session + "\n" +
  idempotency_key,
  shared_secret
)
```

Rules:

- `content_hash` must match `X-Auth-Content-Hash`.
- `push_session` is minted by `push_preflight` and expires quickly.
- `idempotency_key` is unique per dry-run upload or apply batch.
- Nonces must be rejected on replay within the timestamp window.
- The shared secret must be scoped for push. A read-only export secret must not
  authorize mutation endpoints.
- Apply endpoints must require TLS outside local-only test topologies.

If a server supports only the current export HMAC and not the canonical push
signature, it may serve pull endpoints and hash listing, but it must reject
dry-run upload, apply, journal repair, and recovery mutation.

### Current Playground Auth Lab

`npm run test:playground:authenticated-http-push` is lab HMAC evidence, not
this production auth protocol. It verifies authenticated local Playground
source-site mutation under
`/wp-json/reprint-push-lab/v1/authenticated/*` with Basic-auth-shaped
Application Password credentials for bootstrapped users, `manage_options`,
auth-bound receipts, `AUTH_RECEIPT_MISMATCH`, `AUTH_RECEIPT_EXPIRED`,
`X-Reprint-Push-Idempotency-Key`, stale no-data-loss, and replay with zero
fresh mutation work. Signed requests are required for
`/authenticated/preflight`, `/authenticated/dry-run`, and
`/authenticated/apply`.

The lab verifier checks signatures before JSON parsing, receipt validation,
idempotency lookup or claim, journal writes, or mutation. `X-Auth-Content-Hash`
is SHA-256 over the raw request body bytes. The auth signature covers
`X-Auth-Nonce`, `X-Auth-Timestamp`, and the content hash. The push signature
binds the method, actual path, canonical query, content hash, server-minted lab
push session, and idempotency key. Preflight mints short-lived lab push
sessions; dry-run and apply require the session plus
`X-Reprint-Push-Idempotency-Key`. Nonce replay rejects before idempotency
replay, while replay with a fresh nonce/signature still works with zero fresh
mutation work.

Tests cover unsigned, malformed, bad hash, body changed after signing,
stale/future timestamp, wrong method/path/query, wrong session, idempotency
mismatch, public-route signature attempts, nonce replay, and positive signed
preflight, dry-run, apply, and replay. Playground fallback caveat: core
Application Password auth did not establish `/wp-json/wp/v2/users/me`, so the
lab route validates stored hashed app-password entries and sets the current
user before capability checks. Public legacy lab routes remain public/mutable;
HMAC applies only to `/authenticated/*` aliases. Responses expose stable hash
evidence such as credential/signing-key hashes for lab proof and are not a
production response contract. Production Reprint auth still needs TLS
deployment, nonce/replay store cleanup, production session handling, real
exporter credential binding, durable production audit records, and full
production push.

### Current Fixture Plugin Atomicity Lab

`npm run test:playground:plugin-atomic-install` is protocol-shape evidence for
a hard-coded local Playground fixture plugin install, not production plugin
installation support. Through the local lab REST path it proves that a ready
plan can carry a dependency plugin, dependent plugin, exact fixture plugin
files, plugin resources, and allowlisted plugin-owned option data in one atomic
group; apply activates both fixture plugins and replay performs zero fresh
mutation work.

Negative protocol evidence covers missing dependency, dependency outside the
group, incompatible version, hash mismatch, activation requirement mismatch,
remote dependency drift, stale preconditions, stale live-remote dependency
evidence, forged ready plans missing dependency mutation/`atomicGroups`/
dependency requirements, and row-only plugin-owned data bypass attempts. The
row-only bypass rejects with `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`. The lab
keeps an exact fixture plugin file/resource allowlist and blocks arbitrary
plugin files, direct `active_plugins` row mutation, custom-table apply, and
arbitrary plugin-owned data. Failure injection classifies before-commit as
old-remote and during-publish/activation failure as blocked/non-complete
recovery evidence; it does not prove rollback.

## Resource Model

A push resource is the smallest unit that can be compared and guarded by a
precondition.

Resource keys are stable strings:

- `file:<normalized-path>`
- `row:<json-array [table, primary-key-shape]>`
- `schema:<table>`
- `option:<option-name>`
- `plugin:<plugin-slug>`
- `theme:<stylesheet>`
- `runtime:<capability-name>`

Every listed resource has:

- `resource_key`
- `resource_type`
- `hash`: canonical hash of the effective resource value
- `content_hash`: raw file or row payload hash when applicable
- `semantic_hash`: optional plugin/theme driver hash
- `owner`: plugin/theme/core ownership hint
- `size_bytes` or `row_bytes` when known
- `mtime` or database write watermark when known
- `capabilities`: operations the server can safely perform for that resource

The canonical resource hash must be independent of listing order, PHP array
iteration order, SQL dump formatting, and host-specific absolute paths.

## Endpoints

All endpoints use the existing Reprint API dispatch style:

```text
/?reprint-api&endpoint=<endpoint-name>
```

### `push_preflight`

Purpose: prove the remote can participate in push before planning begins.

Method: `POST`

Request body:

```json
{
  "client_protocol_version": 1,
  "client_min_protocol_version": 1,
  "requested_scopes": ["files", "database", "plugins", "themes"],
  "base_manifest_id": "pull-2026-05-24T00:00:00Z",
  "local_site_id": "local-dev-site",
  "client_features": [
    "canonical-push-hmac",
    "dry-run-plan-upload",
    "mutation-batches",
    "journal-recovery"
  ]
}
```

Response body:

```json
{
  "ok": true,
  "push_protocol_version": 1,
  "push_protocol_min_version": 1,
  "push_session": "psh_01j00000000000000000000000",
  "expires_at": "2026-05-24T00:10:00Z",
  "site": {
    "site_id": "remote-example",
    "home_url_hash": "sha256:...",
    "wp_version": "6.9.0",
    "table_prefix": "wp_",
    "multisite": false
  },
  "capabilities": {
    "hash_listing": true,
    "dry_run": true,
    "apply": true,
    "journal": true,
    "recovery": true,
    "db_transactions": true,
    "file_staging": true,
    "maintenance_mode": true
  },
  "limits": {
    "max_request_bytes": 8388608,
    "max_batch_mutations": 100,
    "max_batch_bytes": 4194304,
    "max_execution_seconds": 20
  },
  "journal": {
    "store": "database",
    "namespace": "reprint_push",
    "retention_days": 30
  }
}
```

The preflight response is not liveness proof for apply. It only proves that a
push session can start.

### `push_snapshot_hashes`

Purpose: list the live remote snapshot hashes used by the planner.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "cursor": null,
  "scope": {
    "files": ["wp-content/plugins", "wp-content/themes", "wp-content/uploads"],
    "tables": ["wp_options", "wp_posts", "wp_postmeta"],
    "plugins": true,
    "themes": true
  },
  "batch_size": 1000,
  "include_absent_for_base_keys": [
    "file:wp-content/plugins/forms/forms.php",
    "row:[\"wp_posts\",\"ID:1\"]"
  ]
}
```

Response body:

```json
{
  "ok": true,
  "snapshot_id": "snap_01j00000000000000000000000",
  "site_epoch": "epoch:remote-example:142",
  "cursor": "eyJwYWdlIjoyfQ==",
  "complete": false,
  "resources": [
    {
      "resource_key": "file:wp-content/plugins/forms/forms.php",
      "resource_type": "file",
      "hash": "sha256:0787...",
      "content_hash": "sha256:0787...",
      "size_bytes": 4096,
      "mtime": 1779571200,
      "owner": "forms",
      "capabilities": ["put", "delete", "stage"]
    },
    {
      "resource_key": "row:[\"wp_posts\",\"ID:1\"]",
      "resource_type": "row",
      "hash": "sha256:f98a...",
      "owner": "core",
      "capabilities": ["put", "delete", "transaction"]
    }
  ]
}
```

The client follows cursors until `complete` is true. The planner compares:

- saved pull base manifest
- local edited manifest
- live remote hash listing

The server may also expose `push_snapshot_hashes` for a narrow set of resource
keys during apply revalidation. That revalidation must read the live remote, not
reuse the earlier dry-run listing.

### `push_plan_dry_run`

Purpose: upload the client-computed plan so the remote validates it without
mutating the site.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "base_manifest_id": "pull-2026-05-24T00:00:00Z",
  "remote_snapshot_id": "snap_01j00000000000000000000000",
  "summary": {
    "mutations": 2,
    "conflicts": 0,
    "atomic_groups": 1
  },
  "preconditions": [
    {
      "resource_key": "file:index.php",
      "expected_remote_hash": "sha256:base-index",
      "base_hash": "sha256:base-index",
      "local_hash": "sha256:local-index"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "body_ref": "upload:body-1",
      "atomic_group_id": null
    }
  ],
  "atomic_groups": []
}
```

Response body:

```json
{
  "ok": true,
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "dry_run_id": "dry_01j00000000000000000000000",
  "status": "ready",
  "accepted_until": "2026-05-24T00:20:00Z",
  "server_checks": [
    "auth-scope",
    "plan-schema",
    "resource-addressability",
    "atomic-group-closure",
    "remote-precondition-readable",
    "journal-writable"
  ],
  "apply_requirements": {
    "must_revalidate": true,
    "must_use_dry_run_id": true,
    "max_batch_mutations": 100
  },
  "journal_cursor": "journal:dry_01j00000000000000000000000:1"
}
```

Dry-run validation must not write target resources. It may write a journal entry
recording the proposed plan, validation result, expiry, and client identity.

Dry-run statuses:

- `ready`: apply may be attempted.
- `blocked`: dependencies, permissions, or resource capabilities are missing.
- `conflict`: remote and local both changed one or more resources from base.
- `invalid`: malformed plan, bad hashes, unsupported resource type, or bad
  atomic group closure.

### `push_batch_apply`

Purpose: apply one mutation batch from an accepted dry-run.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "batch_id": "batch-1",
  "batch_index": 0,
  "last_batch": true,
  "preconditions": [
    {
      "resource_key": "file:index.php",
      "expected_remote_hash": "sha256:base-index"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "body": {
        "encoding": "base64",
        "data": "PD9waHAgZWNobyAibG9jYWwiOw=="
      }
    }
  ]
}
```

Required apply behavior:

1. Load the accepted dry-run by `dry_run_id`.
2. Reject if the dry-run expired, was superseded, or belongs to another push
   session.
3. Revalidate every batch precondition against the live remote.
4. Revalidate atomic group dependencies and plugin/theme validators.
5. Open a journal entry before staging.
6. Stage all file and database changes for the batch.
7. Commit the batch atomically when possible.
8. Record final hashes for every mutated resource.

Response body:

```json
{
  "ok": true,
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "status": "committed",
  "applied_mutations": ["mutation-1"],
  "final_hashes": [
    {
      "resource_key": "file:index.php",
      "hash": "sha256:local-index"
    }
  ],
  "journal_cursor": "journal:dry_01j00000000000000000000000:2"
}
```

Failure responses use stable error codes:

- `PRECONDITION_FAILED`: live remote hash no longer matches.
- `PLAN_NOT_READY`: dry-run status is not `ready`.
- `PLAN_EXPIRED`: accepted dry-run expired.
- `ATOMIC_GROUP_FAILED`: group dependency or validator failed.
- `BATCH_ALREADY_COMMITTED`: idempotency replay; return the original result.
- `RECOVERY_REQUIRED`: server cannot prove old or new state without recovery.

If any precondition fails, no target resource in that batch may be mutated. If a
failure occurs after staging begins, the journal must provide enough evidence
for recovery to finish, roll back, or block explicitly.

### `push_journal`

Purpose: inspect dry-runs, batches, and interrupted apply attempts.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "cursor": null,
  "include_artifacts": false
}
```

Response body:

```json
{
  "ok": true,
  "cursor": null,
  "complete": true,
  "entries": [
    {
      "journal_id": "jrnl_01j00000000000000000000000",
      "dry_run_id": "dry_01j00000000000000000000000",
      "batch_id": "batch-1",
      "state": "committed",
      "created_at": "2026-05-24T00:00:05Z",
      "updated_at": "2026-05-24T00:00:06Z",
      "resources": [
        {
          "resource_key": "file:index.php",
          "before_hash": "sha256:base-index",
          "staged_hash": "sha256:local-index",
          "after_hash": "sha256:local-index"
        }
      ],
      "artifacts": []
    }
  ]
}
```

Journal states:

- `dry_run_received`
- `dry_run_ready`
- `dry_run_blocked`
- `batch_opened`
- `batch_staged`
- `batch_committing`
- `committed`
- `rolled_back`
- `recovery_required`
- `blocked`

The journal is append-only for audit events. A compact current-state index may
exist for lookup speed, but recovery decisions must be reconstructable from the
append-only records and artifacts.

### `push_recover`

Purpose: resume or repair an interrupted dry-run or batch.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "mode": "auto"
}
```

Recovery modes:

- `inspect`: report what can be proven, mutate nothing.
- `auto`: finish or roll back only when the journal and live hashes prove the
  correct action.
- `finish`: complete a staged batch only when all preconditions and staged
  artifacts match the accepted plan.
- `rollback`: restore before-state only when before artifacts are complete and
  the live site still matches the staged or partial state.

Response body:

```json
{
  "ok": true,
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "state": "committed",
  "proof": "all-final-hashes-match-plan",
  "actions": ["inspected-live-hashes", "finalized-journal"],
  "next": null
}
```

Recovery must never invent success. If the server cannot prove a safe action, it
returns `RECOVERY_BLOCKED` with the resource keys, observed hashes, and artifact
references needed for manual repair.

## Planner Contract

The client planner creates a plan from:

- `base`: manifest and optional content from the last successful pull.
- `local`: current edited local site.
- `remote`: live remote hashes from `push_snapshot_hashes`.

Planner decisions:

- Local equals base and remote equals base: no-op.
- Local equals base and remote changed: keep remote.
- Local changed and remote equals base: mutation candidate.
- Local equals remote: already in sync.
- Local changed and remote changed differently: conflict.

Atomic groups are required for resource sets that must move together, including:

- plugin/theme install, update, activation, or deletion
- plugin-owned database rows plus plugin files
- schema changes plus dependent rows
- upload files plus attachment rows and metadata
- URL/domain rewrites across multiple tables

Every mutation candidate includes a remote precondition. A plan without
preconditions is invalid for apply unless it contains no mutations.

## Hashing Rules

File resources:

- Hash the exact bytes after resolving the canonical site-relative path.
- Reject paths outside allowed WordPress roots.
- Include symlink metadata separately; do not follow a symlink during mutation
  unless preflight advertised that capability.

Database row resources:

- Hash a canonical JSON object built from selected columns.
- Sort object keys.
- Preserve exact scalar types where the database driver can provide them.
- Include primary key shape and table name outside the value payload.
- For serialized PHP values, either hash the raw stored string or use a
  plugin/theme semantic driver. Do not generic-merge unknown serialized data.

Schema resources:

- Hash normalized `CREATE TABLE` details, indexes, collation, engine, and
  relevant WordPress table-prefix mapping.

Plugin/theme resources:

- Hash activation state, version, dependency declarations, and package files.
- Include semantic validator output when a plugin driver is installed.

## Error Envelope

Errors are JSON:

```json
{
  "ok": false,
  "code": "PRECONDITION_FAILED",
  "message": "Remote changed since dry-run for file:index.php.",
  "details": {
    "resource_key": "file:index.php",
    "expected_hash": "sha256:base-index",
    "actual_hash": "sha256:remote-edited-index"
  },
  "journal_cursor": "journal:dry_01j00000000000000000000000:2"
}
```

Clients must treat unknown error codes as fatal and inspect the journal before
retrying an apply batch.

## Compatibility

The push extension has its own version pair:

- `push_protocol_version`
- `push_protocol_min_version`

These are independent of the current export `protocol_version` because push can
change mutating semantics without breaking pull clients. Pull preflight may
advertise push support, but mutating push endpoints must still require
`push_preflight` and push-scoped authentication.
