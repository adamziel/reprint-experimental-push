# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

## Executor Responsibilities

The executor is the client-side orchestrator. It runs after a site was pulled,
edited locally, and the user asks to push changes back to the original source.

Responsibilities:

- Load the saved pull base manifest and verify it belongs to the remote.
- Run `push_preflight` and negotiate protocol, limits, and auth scope.
- List the live remote hashes with `push_snapshot_hashes`.
- Build a three-way plan from base, local, and live remote.
- Upload the plan with `push_plan_dry_run`.
- Apply ready plans in bounded `push_batch_apply` calls.
- Inspect `push_journal` after any timeout, process crash, or ambiguous error.
- Run `push_recover` only when the journal says recovery is required.

The executor must not mutate the remote during planning. It may fetch remote
content for conflict display, but mutation starts only at `push_batch_apply`.

## State Machine

```text
idle
  -> preflight
  -> remote-hash-list
  -> local-scan
  -> plan
  -> dry-run-upload
  -> ready | blocked | conflict
  -> apply-batches
  -> journal-confirm
  -> complete
```

Failure states:

```text
dry-run-upload -> blocked | conflict | invalid
apply-batches -> precondition-failed | recovery-required | failed
recovery-required -> recovered | recovery-blocked
```

The executor persists its state after every remote response. Re-running the same
push resumes from the last safe state:

- If only planning completed, rebuild or re-upload dry-run.
- If dry-run was accepted, inspect its journal before applying.
- If a batch response was lost, retry with the same idempotency key.
- If the server reports `RECOVERY_REQUIRED`, inspect then recover.

## Mapping To Existing Reprint Pull

The existing pull command already knows how to run stages, save state, retry
timeouts, and resume after interruption. Push should reuse that orchestration
style with different stage semantics.

| Pull concept | Push executor equivalent |
| --- | --- |
| `run_preflight()` | `run_push_preflight()` stores push capabilities and session. |
| `run_files_sync()` | `run_remote_hash_listing()` lists remote file hashes instead of fetching file bodies. |
| `run_db_sync()` | `run_remote_hash_listing()` lists row/schema hashes instead of streaming SQL chunks. |
| local `db-apply` | `run_local_scan()` and `createPushPlan()` compare base/local/remote. |
| pull retry on timeout | Push retries only idempotent stages automatically; apply retry first checks journal. |
| pull state directory | Push state directory stores base manifest, live hash listing, plan, dry-run receipt, batch receipts, and journal cursors. |

The push executor should not reuse the pull streaming SQL dump as a mutation
format. SQL replay is too coarse for a live remote. It can reuse pull transport,
budgeting, cursoring, multipart handling, and HMAC helpers.

## Execution Flow

### 1. Load Base

Read the manifest created by the successful pull:

- remote URL and site identity
- export protocol metadata
- WordPress version, paths, table prefix, multisite state
- resource keys and base hashes
- optional base bodies for files/rows needed by merge drivers

Abort if the base manifest is missing. A push without a base is a blind
overwrite risk.

### 2. Preflight

Call `push_preflight` with the requested scopes. Store:

- `push_session`
- expiry
- limits
- journal capabilities
- hash listing capabilities
- database and filesystem mutation capabilities

Abort if push auth is not scoped for mutation or the server cannot write a
journal.

Current lab note: `npm run test:playground:authenticated-http-push` verifies a
local Playground preflight at
`/wp-json/reprint-push-lab/v1/authenticated/preflight`. It returns identity,
`manage_options`, scope, session, expiry, idempotency, and journal evidence, and
the matching authenticated dry-run/apply routes bind receipts to auth/session
and request data before DB idempotency claim/mutation. The signed-request lab
requires HMAC signatures on `/authenticated/preflight`,
`/authenticated/dry-run`, and `/authenticated/apply`; it verifies
`X-Auth-Content-Hash` as SHA-256 over the raw request body bytes and rejects bad
signatures before JSON parsing, receipt checks, idempotency lookup, journal
write, or mutation. Dry-run/apply also bind `X-Reprint-Push-Signature` to the
method, actual path, canonical query, content hash, lab session, and
idempotency key. This is authenticated local Playground source-site mutation
evidence only. Playground fallback caveat: the lab verifier validates stored
hashed app-password entries and sets the current user because local Playground
core did not establish `/wp-json/wp/v2/users/me`; it is not production Reprint
auth or production Application Password integration.

### 3. Remote Snapshot Hash Listing

Call `push_snapshot_hashes` until complete. Include base resource keys so
deletions on the remote are represented as absent resources.

Store the full listing and its `snapshot_id`, but do not treat it as an apply
lock. The remote remains live.

### 4. Local Scan

Scan the local site into the same resource model. The scan must use the current
local paths, table prefix, plugin state, and WordPress constants, then normalize
them back to the base manifest's resource keys.

Generated caches, object-cache data, transients, and runtime artifacts should be
excluded unless a plugin/theme driver explicitly declares them pushable.

### 5. Plan

Create the three-way plan:

```text
base manifest + local scan + remote hash listing -> push plan
```

Plan statuses:

- `ready`: safe to ask the remote for a dry-run receipt.
- `blocked`: executor must stop until dependencies or capabilities exist.
- `conflict`: executor must preserve remote and require user resolution.

Ready means "ready for dry-run upload", not "guaranteed to apply". The apply
stage still revalidates live remote hashes.

### 6. Dry-Run Upload

Upload the plan to `push_plan_dry_run`. The remote validates:

- auth scope
- plan schema
- resource addressability
- every mutation has a precondition
- atomic group closure
- plugin/theme validators
- journal writeability
- request and batch size limits

The remote may return `ready`, `blocked`, `conflict`, or `invalid`. The executor
must persist the response and stop unless it is `ready`.

Current lab note: `npm run test:playground:plugin-atomic-install` proves a
hard-coded fixture plugin install atomicity path where JavaScript and PHP both
validate fixture atomic dependency closure before mutation/preconditions where
relevant. Forged ready plans that omit the dependency mutation, omit
`atomicGroups`, omit dependency requirements, use stale live-remote dependency
evidence, or try a row-only plugin-owned data bypass reject before mutation.
The row-only bypass is classified as `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`.
This is exact fixture plugin allowlist evidence only; arbitrary plugin files,
direct `active_plugins` row mutation, custom-table apply, and arbitrary
plugin-owned data remain blocked.

### 7. Apply Batches

Split mutations into batches within remote limits. Atomic groups must not be
split unless the group declares explicit safe sub-batches.

For each batch:

1. Send `push_batch_apply` with the accepted `dry_run_id`.
2. Include all live preconditions for the batch.
3. Include the same idempotency key when retrying after a lost response.
4. Persist the response before starting the next batch.
5. On `PRECONDITION_FAILED`, stop and report the changed resource keys.
6. On timeout or connection loss, inspect `push_journal` before retrying.

The executor never assumes that a missing HTTP response means failure. It asks
the journal.

### 8. Journal Confirm

After the last batch, call `push_journal` and verify:

- every batch is `committed`
- final hashes match the plan
- no entry is `recovery_required` or `blocked`
- the dry-run is marked complete

Only then mark local push state complete.

## Remote Apply Semantics

The remote executor should apply each batch with this order:

1. Authenticate and authorize.
2. Load accepted dry-run and idempotency record.
3. Recompute live hashes for every precondition.
4. Reject without mutation on any mismatch.
5. Open journal entry with before hashes and artifact references.
6. Stage file writes under a private temp directory.
7. Start database transaction or acquire the advertised write lock.
8. Recheck rows under transaction locks where supported.
9. Perform database mutations.
10. Move staged files into place.
11. Run plugin/theme validators and activation hooks that are part of the plan.
12. Compute final hashes.
13. Commit transaction or finalize the durable batch marker.
14. Mark journal committed.

MySQL row mutations should use transactions and row locks when possible. SQLite
sites should use `BEGIN IMMEDIATE` for database batches. File mutations should
write temp files, fsync where available, then rename. File and database changes
cannot be a single native transaction on typical WordPress hosts, so the journal
and recovery artifacts are mandatory.

## Journal And Recovery

The journal must let the executor answer one question after a crash:

```text
Is each resource definitely old, definitely new, or blocked with evidence?
```

Journal entries include:

- dry-run ID and plan ID
- batch ID and idempotency key
- authenticated client identity
- before hashes
- staged artifact hashes and locations
- after hashes
- current state
- error code and details

Recovery rules:

- If no target resource changed and before hashes still match, mark rolled back.
- If all final hashes match the plan, mark committed.
- If staged artifacts exist and live hashes still satisfy preconditions, finish
  only when `push_recover` mode allows it.
- If live hashes are mixed or unexpected, mark `recovery_blocked` and return
  exact evidence.

Recovery must never silently discard a remote edit made after the dry-run. It
must revalidate live hashes just like apply.

## Conflict And Blocker Policy

The reliable executor preserves remote changes by default.

Stop conditions:

- local and remote changed the same resource differently
- unknown plugin-owned serialized data changed
- plugin/theme dependency is missing
- schema driver is missing for a schema mutation
- remote journal cannot be written
- remote cannot revalidate a resource precondition
- batch would exceed remote request limits and cannot be split safely

The executor may offer conflict artifacts for review, but it must not auto-merge
plugin-owned data unless a plugin driver returns a deterministic resolution.

## Docker Test Topology

The minimum integration topology has one remote WordPress site, one local
WordPress site, and a runner. No remote tunneling service is used.

```text
docker network: reprint-push

remote-db      MySQL or MariaDB for the source site
remote-wp      WordPress with Reprint exporter and push extension
local-db       MySQL, MariaDB, or SQLite for the edited local site
local-wp       WordPress created from a Reprint pull of remote-wp
runner         Node/PHP test runner with Reprint importer and push client
proxy-8080     Optional local-only reverse proxy for browser inspection
```

Port rules:

- Publish only `127.0.0.1:8080` from `proxy-8080` when browser inspection is
  needed.
- Keep `remote-wp`, `local-wp`, and databases on the Docker network only.
- The runner calls `http://remote-wp/` and `http://local-wp/` by service name.
- Do not use ngrok, cloudflared tunnels, localtunnel, serveo, localhost.run,
  Tailscale Funnel, or equivalent remote tunnel services.

Test sequence:

1. Start remote WordPress and install the exporter/push extension.
2. Pull remote into local WordPress and save the base manifest.
3. Edit local content and files.
4. Optionally edit a different remote resource to prove remote-only changes are
   preserved.
5. Run push preflight, hash listing, plan, dry-run upload, apply, and journal
   confirm.
6. Assert remote contains local non-conflicting changes and remote-only changes.
7. Repeat with a remote edit between dry-run and apply; expect
   `PRECONDITION_FAILED`.
8. Inject a process kill after staging; run `push_journal` and `push_recover`.

Suggested assertions:

- Dry-run does not mutate remote files or database rows.
- Apply revalidates live remote hashes.
- A direct conflict leaves the remote unchanged.
- Atomic plugin install cannot partially apply.
- Lost HTTP response is resolved by idempotency plus journal inspect.
- Recovery can prove committed, rolled back, or blocked.

## Playground Test Topology

WordPress Playground can run the same shape with faster setup:

```text
playground-remote  local-only Playground server for the source site
playground-local   local-only Playground server for the edited pulled site
runner             push protocol test runner
proxy-8080         optional local-only ingress to inspect either site
```

Recommended usage:

- Mount the Reprint exporter/push extension into `playground-remote`.
- Pull from `playground-remote` into `playground-local`.
- Store the base manifest in the runner workspace.
- Bind Playground servers to loopback or container-internal addresses.
- Route browser access through the single local 8080 proxy if needed.

Playground is best for protocol, planner, and recovery fixtures. Docker with
MySQL/MariaDB remains necessary for transaction and lock behavior that differs
from SQLite.

## Test Fixtures

Protocol fixtures live under `fixtures/protocol/`.

They are not complete site exports. They are wire-contract examples for:

- preflight response shape
- remote hash listing
- dry-run upload and receipt
- apply batch request and response
- journal and recovery states

Executable integration tests should use these fixtures as schema examples, then
run against real Docker or Playground sites for filesystem and database
semantics.
