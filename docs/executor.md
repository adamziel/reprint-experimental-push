# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

## Executor Responsibilities

The executor is the client-side orchestrator. It runs after a site was pulled,
edited locally, and the user asks to push changes back to the original source.

Responsibilities:

- Load the saved pull base manifest and verify it belongs to the remote.
- Run `push_preflight` and negotiate protocol, limits, auth scope, and push session.
- List the live remote hashes with `push_snapshot_hashes`.
- Verify the remote coverage manifest is complete for the requested push scope.
- Build a three-way plan from base, local, and live remote.
- Upload the plan with `push_plan_dry_run`.
- Apply ready plans in bounded `push_batch_apply` calls.
- Inspect `push_journal` after any timeout, process crash, or ambiguous error.
- Run `push_recover` in `inspect` mode first, then in a mutating mode only when the journal says recovery is required and the live remote can prove the action.

The executor must not mutate the remote during planning. It may fetch remote
content for conflict display, but mutation starts only at `push_batch_apply`.
Dry-run success is a permission and eligibility receipt, not a liveness lock.
The executor must expect apply to fail if the remote changes between dry-run and
the storage-boundary guard, and it must treat the dry-run response as stale as
soon as a fresh remote listing shows new live state.

The executor treats the push protocol as a three-sided merge:

- local edited site
- persisted pull base
- live remote hash listing

It must never use the remote listing as a replacement for the pull base, and it
must never treat a dry-run receipt as proof that apply is still safe.

Acceptance criteria for the reliable executor:

- It never calls `push_batch_apply` without a persisted pull base, completed
  remote hash listing, ready local plan, accepted dry-run receipt, and active
  push session.
- It treats `dry_run_id`, `snapshot_id`, and `coverage_hash` as evidence, not as
  locks.
- It reuses idempotency keys only with byte-identical request bodies.
- It stops on `PRECONDITION_FAILED` and replans from a fresh remote listing.
- It asks `push_journal` before retrying any apply whose HTTP response was lost.
- It marks a push complete only after journal confirmation proves all batches
  committed.
- It refuses to run against a remote that only has read-only export HMAC scope.

Executor gates:

| Gate | Next remote call allowed | Pass condition | Fail action |
| --- | --- | --- | --- |
| Base loaded | `push_preflight` | Base manifest, coverage hash, remote site identity, and resource hashes are present and match the selected remote. | Stop and require a fresh pull. |
| Preflight accepted | `push_snapshot_hashes` | Push-scoped HMAC credential, active session, journal support, hash listing, idempotency, and required storage guards are advertised. | Stop before planning. |
| Remote listing complete | `push_plan_dry_run` | All requested scopes are complete, blocked resources are absent or irrelevant, and the coverage hash is persisted. | Mark blocked; do not upload a ready plan. |
| Local plan ready | `push_plan_dry_run` | Every mutation has base, local, and live remote hashes plus a storage guard or semantic driver. | Report conflict or blocker. |
| Dry-run ready | `push_batch_apply` | Remote accepted the same canonical plan hash and returned a ready dry-run receipt. | Stop unless status is `ready`; re-read live hashes before each batch. |
| Apply ambiguous | `push_journal` | Any timeout, closed connection, process restart, or `RECOVERY_REQUIRED` happens before a committed receipt is persisted. | Inspect journal before retrying. |
| Journal complete | none | Every planned batch is committed and final hashes match the plan. | Mark the local attempt complete. |

## State Machine

```text
idle
  -> preflight
  -> remote-hash-list
  -> coverage-verified
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
- If a batch response was lost, call `push_journal` first and retry only if the journal still proves the same request is open.
- If the server reports `RECOVERY_REQUIRED`, inspect then recover.

Resume decisions are conservative:

| Persisted state | First action on restart | Reason |
| --- | --- | --- |
| `preflight` only | Re-run preflight. | Sessions expire and carry no liveness proof. |
| Complete remote hashes, no dry-run | Re-list remote hashes, then rebuild the plan. | Hash listings are snapshots, not locks. |
| Dry-run ready, no apply receipts | Call `push_journal`, then apply only if the dry-run is still ready and no batch is open. | A prior process may have applied after persisting the dry-run. |
| Batch request persisted, no response | Call `push_journal` before replay. | The HTTP response may have been lost after mutation. |
| `PRECONDITION_FAILED` persisted | Start a new attempt from fresh remote hashes. | Editing the old batch would break idempotency and stale liveness evidence. |
| `RECOVERY_REQUIRED` persisted | Call `push_journal`, then `push_recover` in `inspect` mode before any mutating recovery mode. | Recovery needs journal artifacts and live hashes, not local guesses. |

The executor also persists the last seen journal cursor and recovery proof so a
restart can distinguish "lost HTTP response" from "server committed but client
did not observe it". This is the boundary that prevents accidental double
mutation when the process crashes mid-apply.

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

Mapping summary:

- pull preflight becomes push preflight plus capability negotiation for write
  paths
- pull listing stages become remote hash listing instead of body fetches
- pull apply becomes the local three-way planner that builds a dry-run plan
- pull state persistence becomes the push attempt state directory and journal
- pull retry semantics remain for read-only stages, while apply retries are
  gated by journal inspection and idempotency proof

The pull importer must persist a push base package so later pushes can prove
the merge base, and it must also preserve the additional pull evidence needed
for later recovery decisions:

```text
push-base/
  base-manifest.json        remote identity, paths, table prefix, multisite map
  base-coverage.json        pull scanner coverage and excluded resources
  resources.jsonl           resource keys and base hashes
  schema-fingerprints.json  normalized table/schema hashes
  bodies/                   optional base bodies needed for merge drivers
```

The executor treats this package as read-only evidence. If it is missing,
corrupt, or from a different remote identity, push planning stops before
preflight can become a mutation path.

## One-Remote, One-Local Test Topology

The recommended integration test topology is one live remote site, one local
edited site, and one runner. That is the minimum one-remote, one-local shape
the protocol is expected to support. The remote remains the source of truth
for the push protocol; the local site is the pull target that was edited after
import. The runner owns the protocol flow and is the only process that talks
to both sites. The test must prove remote drift, meaning the remote can change
independently between dry-run and apply and the executor still rejects stale
work.

### Docker Topology

Use Docker when you want the clearest separation between the two sites and the
runner:

```text
docker network: reprint-push

remote-db      source site database
remote-wp      source WordPress site with the push extension
local-db       edited local site database
local-wp       edited local WordPress site created from the pull base
runner         Node/PHP runner that orchestrates pull, plan, dry-run, apply
```

Only the runner talks to both sites. No WordPress container publishes a public
port. If browser inspection is needed, expose at most the sandbox-provided
`8080` ingress through an optional local-only proxy. Do not use ngrok,
cloudflared, localtunnel, serveo, localhost.run, Tailscale Funnel, or any
equivalent tunnel.

The intended Docker data flow is:

- `remote-wp` is pulled first and acts as the merge base source.
- `local-wp` is restored from that pull base, then edited independently.
- `runner` calls `push_preflight`, `push_snapshot_hashes`, `push_plan_dry_run`,
  `push_batch_apply`, `push_journal`, and `push_recover` against `remote-wp`.
- `remote-db` and `local-db` are kept separate so remote drift can be observed
  without contaminating the local edit history.

Suggested Docker wiring:

- remote site uses a dedicated WordPress + DB pair and serves as the source of
  truth for `push_preflight`, `push_snapshot_hashes`, `push_plan_dry_run`,
  `push_batch_apply`, `push_journal`, and `push_recover`
- local site uses a separate WordPress + DB pair imported from the pull base
  and represents the edited source material used to build the plan
- the runner attaches to both container networks, performs the pull/export,
  computes the three-way plan, uploads the dry-run, and drives apply/recovery
- no service outside the sandbox should be reachable; if a browser is needed,
  the optional proxy binds to `127.0.0.1:8080` only

### Playground Topology

Use WordPress Playground when Docker or WP-CLI is unavailable in the sandbox.
The local and remote sites can be represented by separate disposable blueprint
runs:

| Site | Blueprint | Role |
| --- | --- | --- |
| Remote base | `fixtures/playground/remote-base.blueprint.json` | Pulled source base and push source of truth. |
| Local edited | `fixtures/playground/local-edited.blueprint.json` | Pulled local site after local edits. |
| Remote changed | `fixtures/playground/remote-changed.blueprint.json` | Live remote after independent edits. |

The runner executes the blueprints without opening a network port, exports the
base manifest from `remote-base`, builds the local plan from `local-edited`,
and uses `remote-changed` as the liveness drift case for `PRECONDITION_FAILED`
and recovery coverage. This topology proves the one-remote, one-local shape
without requiring external network exposure.
The Playground harness should keep the same role split as Docker:

- `remote-base` seeds the pull base and push identity evidence.
- `local-edited` produces the local delta and the candidate dry-run plan.
- `remote-changed` simulates live remote drift between dry-run and apply.
- the runner remains the only actor allowed to compare, upload, and recover.
Use only the sandbox-provided `8080` ingress if a browser-visible proxy is
needed for inspection, and keep the WordPress blueprints isolated from each
other.

The preferred Playground topology keeps the same role split:

- remote base blueprint is the source truth used to create the pull base
- local edited blueprint is the imported site after user modifications
- remote changed blueprint is a separately booted live remote that exercises
  stale plan rejection, journal inspection, and recovery outcomes

The runner should treat these as three snapshots of one logical site lineage,
not as three independent targets. The important proof is that apply revalidates
against the live remote, not that dry-run and apply see the same snapshot.

For production-facing checks, keep the topology constrained to a single remote
source, a single edited local clone, and a single executor process. That keeps
the base binding, snapshot listing, dry-run receipt, apply revalidation, and
recovery journal path observable end to end.

## Durable Push State

Each push attempt gets its own state directory next to the saved pull state.
The directory is append-only except for a small current-state pointer:

```text
push-state/<attempt-id>/
  base-ref.json                 copied hashes and identifiers from push-base
  preflight-response.json       push session, capability, limits, auth scope
  remote-hashes.jsonl           complete paged hash listing
  remote-coverage.json          accepted coverage manifest
  local-scan.jsonl              normalized local resource hashes
  plan.json                     canonical plan uploaded to dry-run
  dry-run-response.json         accepted, blocked, conflict, or invalid
  batches/<batch-id>.json       exact apply request body for each batch
  receipts/<batch-id>.json      apply responses and idempotency evidence
  journal.jsonl                 inspected remote journal pages
  recovery.jsonl                recovery inspections or repair attempts
  state.json                    latest resumable executor state
```

The executor never rewrites an apply batch after assigning its idempotency key.
If the remote returns `PRECONDITION_FAILED`, the executor creates a new push
attempt after refreshing remote hashes and replanning. If the response is lost,
the executor first calls `push_journal`; only a journal state that proves the
same request is still open may be retried with the same key and body.

Recovery handling:

- `inspect` is always the first recovery call after an ambiguous apply state
- `finish` is only allowed when the journal proves the batch already committed
- `rollback` is only allowed when the journal and live hashes prove the remote
  can be restored to a safe pre-batch state
- `auto` is a server-side choice between finish, rollback, or block; the
  executor still records the proof it received

The state directory is also the audit boundary between the existing pull
pipeline and push. Pull may refresh or replace `push-base/` only after a
successful pull. A push attempt may copy hashes and identifiers from
`push-base/`, but it must not rewrite the base package to make a stale plan
look current. A conflict resolution, URL retarget confirmation, or recovery
action creates a new attempt record with its own plan and request hashes.

## Execution Flow

### 1. Load Base

Read the manifest created by the successful pull:

- remote URL and site identity
- base manifest hash and scanner coverage hash
- export protocol metadata
- WordPress version, paths, table prefix, multisite state
- resource keys and base hashes
- optional base bodies for files/rows needed by merge drivers

Abort if the base manifest is missing. A push without a base is a blind
overwrite risk. Abort if the manifest predates push-compatible scanner
coverage; the user must pull again to create a base that can participate in
three-way planning.

### 2. Preflight

Call `push_preflight` with the requested scopes. Store:

- `push_session`
- expiry
- remote identity hash and server clock skew estimate
- limits
- journal capabilities
- hash listing capabilities
- database and filesystem mutation capabilities
- storage guards and semantic driver versions

Abort if push auth is not scoped for mutation or the server cannot write a
journal. Abort on `SITE_IDENTITY_MISMATCH`; the executor may ask the user to
confirm a remote URL change, but confirmation must result in a fresh preflight
against the same `site_id`.

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
lab domain separator, method, actual path, canonical query, content hash, lab
session, and idempotency key. This is authenticated local Playground
source-site mutation evidence only. Playground fallback caveat: the lab
verifier validates stored hashed app-password entries and sets the current user
because local Playground core did not establish `/wp-json/wp/v2/users/me`; it
is not production Reprint auth or production Application Password integration.

Current production-shaped route note:
`npm run test:playground:production-shaped-push` verifies signed
preflight/dry-run/apply plus authenticated snapshot, replay, DB journal, and
recovery inspect through `/wp-json/reprint/v1/push/*`. The CLI can target that
profile with `--route-profile production-shaped`. This proves route shape and
request binding over a real local Playground source site, including guarded
DB/file mutations, same-key different-body conflict refusal, and unmodified
cross-route receipt refusal before mutation. It is still lab-backed route-shape
evidence: the route is mounted by the Playground mu-plugin, uses the lab
signing key derivation, and does not prove tamper-resistant production receipt
security, credential lifecycle, production nonce/replay retention, durable
production journal storage, leases/fencing, WordPress graph identity, or
arbitrary plugin drivers.

Current packaged-plugin note:
`npm run test:playground:production-plugin-package` builds a temporary
`reprint-push` plugin package from [plugins/reprint-push](../plugins/reprint-push),
mounts it as a normal plugin, activates it through a Blueprint step, confirms
the public `reprint-push-lab/v1` namespace is disabled, and applies seven
graph-safe fixture mutations through `/wp-json/reprint/v1/push/*`. The package
sets `REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP` by default, so the smoke explicitly
provisions only the primary push-scoped Application Password fixture and
verifies both an unprovisioned alternate credential and an unscoped
administrator Application Password are rejected with `401`. It also seeds
expired and unexpired signed session/nonce option artifacts and proves preflight
deletes the expired artifacts while retaining unexpired ones. This improves the
packaging, scoped-credential, and signed-store hygiene proof but is still not
production readiness: the endpoint internals remain lab-backed until production
auth, credential lifecycle, durable journal storage, leases/fencing, WordPress
graph identity, and plugin drivers replace the fixture implementation.

### 3. Remote Snapshot Hash Listing

Call `push_snapshot_hashes` until complete. Include base resource keys so
deletions on the remote are represented as absent resources.

Store the full listing, `snapshot_id`, `coverage_id`, and `coverage_hash`, but
do not treat them as an apply lock. The remote remains live. If any requested
scope has incomplete coverage, unknown plugin-owned data, unsupported custom
tables, or unguarded resources that the local changes depend on, the executor
marks the plan blocked instead of building a ready mutation.

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

Conflict resolution creates a new auditable plan. The executor records the
base/local/remote hashes and reviewed choice, refreshes the remote hash listing,
then replans. It must not attach a manual approval to an older dry-run receipt
to skip current remote preconditions.

### 6. Dry-Run Upload

Upload the plan to `push_plan_dry_run`. The remote validates:

- auth scope
- plan schema
- base manifest and remote identity binding
- remote coverage hash from the completed hash listing
- resource addressability
- every mutation has a precondition
- every mutation has a supported storage guard or semantic driver
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
direct `active_plugins` row mutation, custom tables outside the exact forms lab
driver, and arbitrary plugin-owned data remain blocked. The one current
custom-table exception is the fixture-only `wp_reprint_push_forms_lab` semantic
driver `fixture-forms-lab-table`: owner `forms`, positive `id:N`, explicit
policy, unchanged active `reprint-push-forms-fixture` evidence, live
precondition hashes, exact PHP table/column/payload validation, delete blocked,
idempotent replay with zero fresh mutation work, and redacted hash-only
journal/recovery evidence.

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

Apply requests are single-use by body hash and idempotency key. If a batch must
be retried after `PRECONDITION_FAILED`, the executor discards the dry-run
receipt, refreshes the remote hash listing, and replans. It never edits the
batch body under the same idempotency key.

Retry policy:

- `5xx`, network close, timeout before response body: inspect `push_journal`,
  then retry only if the same request is open or absent.
- `BATCH_ALREADY_COMMITTED`: persist the replay receipt and continue with the
  next batch after journal confirmation.
- `PRECONDITION_FAILED`: stop, preserve the remote, and replan from a fresh
  hash listing.
- `RECOVERY_REQUIRED`: call `push_journal`, then `push_recover` in `inspect`
  or `auto` mode according to the user's recovery policy.
- `IDEMPOTENCY_KEY_CONFLICT`: stop; this means the local state directory no
  longer matches the remote idempotency record.

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
3. Verify the request hash matches any prior idempotency claim.
4. Recompute live hashes for every batch precondition.
5. Reject without mutation on any mismatch.
6. Open journal entry with before hashes and artifact references.
7. Stage file writes under a private temp directory.
8. Start database transaction or acquire the advertised write lock.
9. Recheck each target at its storage boundary under the advertised guard.
10. Perform database mutations.
11. Move staged files into place through compare-and-rename/unlink guards.
12. Run plugin/theme validators and activation hooks that are part of the plan.
13. Compute final hashes.
14. Commit transaction or finalize the durable batch marker.
15. Mark journal committed.

MySQL row mutations should use transactions and row locks when possible. SQLite
sites should use `BEGIN IMMEDIATE` for database batches. File mutations should
write temp files, fsync where available, then rename. File and database changes
cannot be a single native transaction on typical WordPress hosts, so the journal
and recovery artifacts are mandatory.

If plugin/theme code can run during apply, the driver must declare side effects
as resources in the same atomic group. Activation or migration hooks that may
write undeclared options, tables, files, roles, cron, rewrite rules, or caches
block the group until a semantic driver can validate them.

## Journal And Recovery

The journal must let the executor answer one question after a crash:

```text
Is each resource definitely old, definitely new, or blocked with evidence?
```

Journal entries include:

- dry-run ID and plan ID
- batch ID and idempotency key
- canonical request hash and authenticated identity
- before hashes
- staged artifact hashes and locations
- after hashes
- storage guard observations
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

## Test Topology

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
- The runner should be the only container that talks to both sites.

### Playground Topology

Use Playground when the test environment needs a disposable local-only pair of
sites. Keep the same one-remote, one-local shape:

| Site | Blueprint role | Purpose |
| --- | --- | --- |
| Remote site | `fixtures/playground/remote-base.blueprint.json` | Pulled source truth that the push session was derived from. |
| Local site | `fixtures/playground/local-edited.blueprint.json` | Edited local site that produced the push plan. |
| Drift site | `fixtures/playground/remote-changed.blueprint.json` | Independent live-remote edit used to prove apply-time revalidation and recovery. |

The runner launches the blueprints separately, exports the remote base
manifest, imports it into the local site, applies local edits, and then compares
the local plan against the drift site for `PRECONDITION_FAILED` and recovery
coverage. The remote and local sites must stay distinct throughout the test:
the remote is never repurposed as the edited site, and the edited site never
becomes the source of truth.
In the Docker topology, the runner calls `http://remote-wp/` and
`http://local-wp/` by service name, and the environment must not use ngrok,
cloudflared tunnels, localtunnel, serveo, localhost.run, Tailscale Funnel, or
equivalent remote tunnel services.

The same shape can also be expressed with WordPress Playground when Docker or
WP-CLI is unavailable in the sandbox. In both cases, the remote and local
sites stay distinct: one remote source of truth, one edited local pull target.

Minimal Compose shape:

```yaml
services:
  remote-db:
    image: mariadb:11
    networks: [reprint-push]
  remote-wp:
    image: wordpress:php8.3-apache
    depends_on: [remote-db]
    networks: [reprint-push]
    volumes:
      - ./plugins/reprint-push:/var/www/html/wp-content/plugins/reprint-push:ro
  local-db:
    image: mariadb:11
    networks: [reprint-push]
  local-wp:
    image: wordpress:php8.3-apache
    depends_on: [local-db]
    networks: [reprint-push]
  runner:
    image: node:22-bookworm
    working_dir: /workspace
    networks: [reprint-push]
    volumes:
      - .:/workspace
    command: ["sleep", "infinity"]
  proxy-8080:
    image: caddy:2
    networks: [reprint-push]
    ports:
      - "127.0.0.1:8080:8080"

networks:
  reprint-push: {}
```

The sketch intentionally omits public ports on both WordPress containers. The
runner and optional proxy are the only cross-service entry points; the proxy is
local-only and exists only for inspection.

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

- Preflight rejects a read-only export secret and accepts only push-scoped HMAC.
- Hash listing returns complete coverage or the plan is blocked.
- Dry-run does not mutate remote files or database rows.
- Apply revalidates live remote hashes.
- Apply proves storage-boundary guards for one row and one file.
- A direct conflict leaves the remote unchanged.
- Atomic plugin install cannot partially apply.
- Lost HTTP response is resolved by idempotency plus journal inspect.
- Recovery must start with `push_recover` in `inspect` mode and only then may
  advance to `auto`, `finish`, or `rollback` when the journal proves the state.
- Recovery can prove committed, rolled back, or blocked.

Minimum topology matrix:

| Case | Remote action | Expected result |
| --- | --- | --- |
| Clean push | Remote unchanged since pull | Dry-run ready, apply committed, journal complete. |
| Remote-only edit | Remote changed a different resource | Planner keeps remote edit and applies local non-conflicting edits. |
| Direct conflict | Remote changed the same resource differently | Planner reports conflict; no dry-run apply path. |
| Drift after dry-run | Remote changes a planned target before apply | Apply returns `PRECONDITION_FAILED`; remote edit survives. |
| Lost apply response | Runner drops connection after request | Executor inspects journal first, then replays or resumes by idempotency only if the journal shows the same request is still open. |
| Interrupted batch | Server exits after staging or partial write | Recovery reports committed, rolled back, or blocked with resource evidence. |
| Read-only credential | Export secret lacks push scope | Preflight or dry-run rejects before mutation. |

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
- Run signed preflight/dry-run/apply plus authenticated snapshot, journal, and
  recovery inspect through the production route names even when the backing
  implementation is a Playground fixture.

Playground is best for protocol, planner, and recovery fixtures. Docker with
MySQL/MariaDB remains necessary for transaction and lock behavior that differs
from SQLite.

## Test Fixtures

Protocol fixtures live under `fixtures/protocol/`.

They are not complete site exports. They are wire-contract examples for:

- required auth header families and signature inputs
- preflight request and response shape
- remote hash listing request and response
- dry-run upload and receipt
- apply batch request and response
- journal inspect request and response
- recovery request and committed or blocked recovery states

Executable integration tests should use these fixtures as schema examples, then
run against real Docker or Playground sites for filesystem and database
semantics.
