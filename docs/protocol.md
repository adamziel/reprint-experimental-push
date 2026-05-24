# Reprint Push Protocol Extension

This document defines the production push protocol extension for Reprint. It is
designed as an extension of the existing exporter/importer pull API, not as a
separate synchronization system.

The core invariant is:

1. Dry-run and apply are separate remote operations.
2. Apply revalidates the live remote before every mutation batch and, in the
   production contract, immediately before each storage-boundary write. The
   earlier snapshot and dry-run receipt are evidence, not locks.
3. A failed or interrupted apply leaves a durable journal that lets recovery
   prove whether the remote is old, new, or blocked with artifacts.

Push is intentionally conservative. A server that cannot prove complete
coverage for the requested scopes, cannot bind the push to the pull base, or
cannot guard a mutation at its storage boundary must refuse that part of the
plan instead of accepting a best-effort overwrite.

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
base manifest: remote identity, export protocol metadata, scanner coverage,
resource keys, hashes, schema fingerprints, WordPress paths, table prefix,
multisite mapping, and hash algorithm metadata observed when the local site was
created. That manifest is the merge base for later push planning.

The base manifest is bound into every push through:

- `base_manifest_id`: stable local identifier for the pulled base.
- `base_manifest_hash`: canonical hash of the base manifest.
- `remote_site_id`: remote identity observed during pull.
- `pull_protocol_version`: exporter/importer protocol used to create the base.
- `base_coverage_hash`: canonical hash of the pull scanner coverage manifest.

If the remote cannot recognize the site identity or the plan cannot prove which
base it was built from, `push_preflight` or `push_plan_dry_run` must reject.

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

## Identity, Idempotency, And Coverage

### Site Identity

Push must target the same remote that produced the local base. The remote
identity is not the raw URL alone because domain names can change between pull
and push. The server should expose a stable `site_id` plus hashed evidence:

- canonical home/site URL hashes
- WordPress install salt or generated Reprint site identity hash
- table prefix and multisite mapping
- exporter protocol and push protocol versions
- scanner coverage hash from the pull base when available

The executor may update stored remote URLs after an explicit user action, but it
must not silently retarget a push to a different `site_id`.

### Idempotency

`X-Reprint-Push-Idempotency-Key` is required for `push_plan_dry_run`,
`push_batch_apply`, and mutating recovery modes. The body may repeat the
`idempotency_key`; if present, it must match the header. The remote stores a
hash of the canonical request body and authenticated identity with each key.

Server behavior:

- Same key, same body, same authenticated identity: return the original result
  or current in-progress journal state without fresh mutation work.
- Same key, different body or different identity: reject with
  `IDEMPOTENCY_KEY_CONFLICT` before mutation.
- Lost response during apply: the executor inspects `push_journal` before
  retrying and retries only with the same key and same body.

### Snapshot Coverage

`push_snapshot_hashes` returns a coverage manifest as well as resources. The
coverage manifest describes what was scanned, which scanner or semantic driver
owned each scope, which resources were excluded, and whether unknown plugin or
environment-specific data forced a block.

A coverage manifest includes:

- `coverage_id` and `coverage_hash`
- scanner version and hash algorithm
- included roots, tables, plugins, themes, and multisite blog IDs
- cursor completion proof for every requested scope
- excluded generated/cache/runtime resources with policy reasons
- blocked unknown resources that make the plan ineligible for apply

Dry-run must reject a plan whose `remote_coverage_hash` does not match the
accepted remote hash listing or whose requested mutations depend on resources
outside covered scopes. Apply must still revalidate the live resources; coverage
only proves the planner had a complete enough view to propose a plan.

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

`npm run test:playground:authenticated-cli-push` now verifies the same lab
protocol through the `reprint-push-lab push-authenticated` command. That CLI
fetches the source snapshot, builds a fresh three-way plan from base/local
snapshot files, signs preflight/dry-run/apply, applies with an idempotency key,
refuses a changed source as `PLAN_NOT_READY_LOCALLY` before mutation, and
refuses post-snapshot source drift as `PRECONDITION_FAILED` before apply.

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
plugin files, direct `active_plugins` row mutation, custom tables outside the
exact forms lab driver, and arbitrary plugin-owned data. The exact
`wp_reprint_push_forms_lab` driver `fixture-forms-lab-table` is fixture-only:
owner `forms`, positive `id:N`, explicit policy, unchanged active
`reprint-push-forms-fixture` evidence, precondition hashes, exact PHP
table/column/payload validation, delete blocked, idempotent replay with zero
fresh mutation work, and redacted hash-only journal/recovery evidence. Failure
injection classifies before-commit as
old-remote and during-publish/activation failure as blocked/non-complete
recovery evidence; it does not prove rollback.

The same lab path now performs a just-in-time pre-write hash check for each
mutation target. A live target drift after dry-run and after initial apply
validation, but before mutation `N` writes, returns `PRECONDITION_FAILED`,
preserves the drifted target, writes no `mutation-applied` event for `N`,
writes no later mutations, and writes no `apply-committed`. Plugin atomic
activation has one fixture-scoped exception: an activation-style plugin
mutation whose planned value has `active: true` may see the inactive staged
plugin hash if a prior same-apply fixture plugin file mutation already applied
and the declared ready atomic group explicitly covers both the file mutation
and plugin mutation. The journal marks that case with
`preconditionCheck: same-apply-staged` and `preWriteStagingProof`. Forged
mutation-local group ids without declared group coverage and planned inactive
plugin mutations do not use the exception. This is lab protocol evidence, not
generic production plugin support.

For the accepted storage-boundary DB update slice, that JIT hash check still
runs first. If it passes, existing fixture row updates for `wp_posts`,
allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact
positive-id `wp_reprint_push_forms_lab` rows use one guarded
`$wpdb->query($wpdb->prepare(...))` `UPDATE` with expected stored-column
predicates at the SQL write boundary. The evidence is hash-only
`storageGuard` data: boundary, driver, logical and physical table, operation,
compared column names, expected resource hash, expected storage hash, rows
affected, outcome, and SQL shape hash. If the row storage drifts after JIT but
before SQL, including marker-empty ownership drift for posts or postmeta parent
posts, the guarded update affects zero rows and apply returns
`PRECONDITION_FAILED` without `mutation-applied` for that failed target,
without later mutations, and without `apply-committed`. This is local
Playground/SQLite fixture evidence only. It is not production DB durability,
not production Reprint HTTP mutation, not generic MySQL/InnoDB CAS proof, not
transactions or locking, not rollback, and not storage guarding for
inserts/deletes/files/plugin activation or arbitrary plugin/custom-table
semantics.

For the accepted storage-boundary file update slice, the same JIT hash check
still runs first. If it passes for an existing fixture file update under an
accepted fixture upload path or named fixture plugin file path, the apply path
compares the live file bytes/hash against the storage value observed after JIT,
writes the planned content to a temp file in the same directory, then renames
after the boundary comparison. Existing fixture upload file deletes compare the
same storage value before unlinking. Positive evidence from
`npm run test:playground:storage-guarded-file-write` covers an existing fixture
upload file update, a fixture upload file create, and a fixture upload file
delete with `storageGuard.outcome: applied`. The failure path injects drift
after JIT but before update/create/delete and returns `PRECONDITION_FAILED`,
preserves the drifted file state, records no `mutation-applied` for the failed
file, runs no later mutations, and records no `apply-committed`; same key/body
replay does no fresh mutation work and same key/different body conflicts.
Evidence is hash-only: boundary `filesystem-compare-rename` for update/create
or `filesystem-compare-unlink` for delete, driver, operation, logical fixture
path, compared fields, expected resource/storage hashes, actual/planned storage
hashes, physical path hash, and outcome. It exposes neither raw file contents
nor absolute host paths. This is local Playground fixture evidence only, not
production filesystem durability, not `fsync`, not a production filesystem
CAS/lock, not rollback, not arbitrary files, not production Reprint HTTP
mutation, and not a generic WordPress filesystem safety proof. The code path
supports named fixture plugin file update paths, but the standalone smoke
exercises upload-file update/create/delete only.

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
- `storage_guard`: how the server can recheck and write the resource at the
  storage boundary, such as `mysql-transaction-row-lock`,
  `sqlite-immediate-guarded-update`, `filesystem-compare-rename`, or
  `semantic-driver`

The canonical resource hash must be independent of listing order, PHP array
iteration order, SQL dump formatting, and host-specific absolute paths.

Resources without a usable storage guard may be listed for conflict display,
but they are not eligible for automatic mutation. The planner must preserve
remote state or require a plugin/theme driver that can prove semantic safety.

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
  "base_manifest_hash": "sha256:base-manifest",
  "base_coverage_hash": "sha256:base-coverage",
  "remote_site_id": "remote-example",
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
    "identity_hash": "sha256:remote-identity",
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
    "maintenance_mode": true,
    "coverage_manifest": true,
    "idempotency": true,
    "storage_guards": [
      "mysql-transaction-row-lock",
      "sqlite-immediate-guarded-update",
      "filesystem-compare-rename"
    ]
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
  },
  "auth": {
    "required": ["export-hmac", "canonical-push-hmac"],
    "idempotency_header": "X-Reprint-Push-Idempotency-Key",
    "nonce_window_seconds": 300
  }
}
```

The preflight response is not liveness proof for apply. It only proves that a
push session can start. It must reject when the requested push scope needs a
capability the remote cannot provide, when the supplied `remote_site_id` does
not match the current site, or when the server cannot persist nonce/session and
journal state for the session lifetime.

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
  "coverage": {
    "coverage_id": "cov_01j00000000000000000000000",
    "coverage_hash": "sha256:remote-coverage",
    "scanner_version": "reprint-push-scanner/1",
    "hash_algorithm": "sha256",
    "complete": false,
    "scopes": {
      "files": ["wp-content/plugins", "wp-content/themes", "wp-content/uploads"],
      "tables": ["wp_options", "wp_posts", "wp_postmeta"],
      "plugins": "metadata-and-declared-drivers",
      "themes": "metadata-and-declared-drivers"
    },
    "excluded": [
      {
        "resource_key": "runtime:transients",
        "reason": "generated-cache"
      }
    ],
    "blocked": []
  },
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
      "capabilities": ["put", "delete", "stage"],
      "storage_guard": "filesystem-compare-rename"
    },
    {
      "resource_key": "row:[\"wp_posts\",\"ID:1\"]",
      "resource_type": "row",
      "hash": "sha256:f98a...",
      "owner": "core",
      "capabilities": ["put", "delete", "transaction"],
      "storage_guard": "mysql-transaction-row-lock"
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

For paged listings, every page repeats the same `coverage_id` and the final page
sets both response `complete` and `coverage.complete` to true. A client must not
build a ready plan from an incomplete listing.

### `push_plan_dry_run`

Purpose: upload the client-computed plan so the remote validates it without
mutating the site.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "idempotency_key": "idem_dry_01j00000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "plan_hash": "sha256:plan",
  "base_manifest_id": "pull-2026-05-24T00:00:00Z",
  "base_manifest_hash": "sha256:base-manifest",
  "remote_snapshot_id": "snap_01j00000000000000000000000",
  "remote_coverage_hash": "sha256:remote-coverage",
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
      "local_hash": "sha256:local-index",
      "storage_guard": "filesystem-compare-rename"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "body_ref": "upload:body-1",
      "storage_guard": "filesystem-compare-rename",
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
  "plan_hash": "sha256:plan",
  "dry_run_id": "dry_01j00000000000000000000000",
  "status": "ready",
  "accepted_until": "2026-05-24T00:20:00Z",
  "server_checks": [
    "auth-scope",
    "plan-schema",
    "resource-addressability",
    "atomic-group-closure",
    "coverage-complete",
    "storage-guards-supported",
    "remote-precondition-readable",
    "journal-writable"
  ],
  "coverage": {
    "remote_coverage_hash": "sha256:remote-coverage",
    "status": "accepted"
  },
  "apply_requirements": {
    "must_revalidate": true,
    "must_revalidate_at_storage_boundary": true,
    "must_use_dry_run_id": true,
    "max_batch_mutations": 100
  },
  "idempotency": {
    "key": "idem_dry_01j00000000000000000000",
    "replayed": false,
    "request_hash": "sha256:dry-run-request"
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

Dry-run validates that the proposed plan is well-formed and eligible to attempt.
It must not reserve resource values as if the remote were locked. Any remote
change after dry-run and before apply is expected to be caught by apply
revalidation and returned as `PRECONDITION_FAILED` or a more specific blocked
state.

### `push_batch_apply`

Purpose: apply one mutation batch from an accepted dry-run.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "idempotency_key": "idem_apply_01j000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "plan_hash": "sha256:plan",
  "batch_id": "batch-1",
  "batch_index": 0,
  "last_batch": true,
  "dry_run_receipt_hash": "sha256:dry-run-receipt",
  "preconditions": [
    {
      "resource_key": "file:index.php",
      "expected_remote_hash": "sha256:base-index",
      "storage_guard": "filesystem-compare-rename"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "storage_guard": "filesystem-compare-rename",
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
7. Revalidate each target at its storage boundary immediately before write.
8. Commit the batch atomically when possible.
9. Record final hashes for every mutated resource.

Production storage-boundary guards must be coupled to the write primitive:

- Database updates use transactions and predicates or locks that compare the
  expected stored value in the same boundary that performs the update.
- File updates compare the live bytes or metadata immediately before a
  same-directory temp-file rename, and deletes compare immediately before
  unlink.
- Semantic plugin/theme drivers must declare every side effect they can cause
  and revalidate those resources before activation, migration, or generated
  output is allowed.
- If a guard cannot run for a target, that target is blocked before mutation.

The current Playground/REST lab apply path also re-hashes the specific target
resource immediately before calling the target write for each mutation. That
just-in-time check uses the mutation's own bound expected hash, not an earlier
batch snapshot, dry-run receipt, or accepted precondition list. If the live hash
differs, apply rejects with `PRECONDITION_FAILED` and stops before that
mutation write. Earlier landed mutations, if any, are recovery evidence for a
partial state; retry of the same DB idempotency key/body replays the rejection
or stays blocked with no fresh mutation work rather than continuing the batch.
This protects the lab path against the known window, but it is not
storage-level compare-and-swap, locking, transaction isolation, or a production
WordPress durability guarantee.

Response body:

```json
{
  "ok": true,
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "status": "committed",
  "idempotency": {
    "key": "idem_apply_01j000000000000000000",
    "replayed": false,
    "request_hash": "sha256:apply-request"
  },
  "applied_mutations": ["mutation-1"],
  "final_hashes": [
    {
      "resource_key": "file:index.php",
      "hash": "sha256:local-index"
    }
  ],
  "storage_guards": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "guard": "filesystem-compare-rename",
      "expected_hash": "sha256:base-index",
      "observed_hash": "sha256:base-index",
      "outcome": "applied"
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

If any initial batch precondition fails before staging, no target resource in
that batch may be mutated. If a storage-boundary guard or other failure occurs
after staging or after earlier mutations, the journal must provide enough
evidence for recovery to finish, roll back, or block explicitly.

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
      "plan_id": "plan_2026-05-24T00:00:00Z_001",
      "batch_id": "batch-1",
      "idempotency_key": "idem_apply_01j000000000000000000",
      "request_hash": "sha256:apply-request",
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
      "storage_guards": [
        {
          "resource_key": "file:index.php",
          "guard": "filesystem-compare-rename",
          "expected_hash": "sha256:base-index",
          "observed_hash": "sha256:base-index",
          "outcome": "applied"
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
  "idempotency_key": "idem_recover_01j0000000000000000",
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
  "target_state_counts": {
    "old": 0,
    "new": 1,
    "blocked": 0,
    "unknown": 0
  },
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

A reviewed conflict resolution is a new plan, not a flag on an old plan. The
resolution artifact records the base hash, local hash, remote hash, chosen
value hash, reviewer identity, and reason. The executor must fetch a fresh
remote hash listing and rebuild the plan after the review. Apply never accepts a
stale manual approval that bypasses current remote preconditions.

Atomic groups are required for resource sets that must move together, including:

- plugin/theme install, update, activation, or deletion
- plugin-owned database rows plus plugin files
- schema changes plus dependent rows
- upload files plus attachment rows and metadata
- URL/domain rewrites across multiple tables

Every mutation candidate includes a remote precondition. A plan without
preconditions is invalid for apply unless it contains no mutations.

Environment-specific resources are denied by default, including `siteurl`,
`home`, salts, secrets, SMTP credentials, local-only object-cache configuration,
absolute paths, and runtime-only cron/cache/transient data. A semantic driver
may transform or allow a resource only when it can prove the source-site value
and side effects remain valid after push.

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

Stable production error codes include:

- `AUTH_REQUIRED`, `AUTH_SCOPE_DENIED`, `SIGNATURE_INVALID`,
  `NONCE_REPLAYED`
- `SITE_IDENTITY_MISMATCH`, `BASE_MANIFEST_MISMATCH`
- `COVERAGE_INCOMPLETE`, `RESOURCE_UNSUPPORTED`, `STORAGE_GUARD_UNSUPPORTED`
- `PLAN_NOT_READY`, `PLAN_EXPIRED`, `PLAN_INVALID`
- `PRECONDITION_FAILED`, `ATOMIC_GROUP_FAILED`, `VALIDATOR_FAILED`
- `IDEMPOTENCY_KEY_CONFLICT`, `BATCH_ALREADY_COMMITTED`
- `RECOVERY_REQUIRED`, `RECOVERY_BLOCKED`

## Compatibility

The push extension has its own version pair:

- `push_protocol_version`
- `push_protocol_min_version`

These are independent of the current export `protocol_version` because push can
change mutating semantics without breaking pull clients. Pull preflight may
advertise push support, but mutating push endpoints must still require
`push_preflight` and push-scoped authentication.
