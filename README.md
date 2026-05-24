# Reprint Experimental Push

This repository is the push-back lab for
[`adamziel/reprint`](https://github.com/adamziel/reprint). Reprint already has a
pull path for cloning a WordPress site over HTTP. The open problem here is the
reverse direction: after a local site was pulled and edited, safely push local
changes back to the original source site even though that source may still be
live and may have changed.

The priorities are deliberately repetitive:

1. No data loss.
2. No data loss.
3. Reliable.
4. Fast.

The current code is not a production WordPress push transport. It is an
executable safety model: a deterministic JSON-snapshot planner, an atomic
applicator, lab-only Playground fixture endpoints, and scenario tests that
define the invariants the production transport must satisfy.

## Current Prototype

```bash
npm test
```

Run the no-server WordPress Playground integration harness:

```bash
npm run test:playground
```

Run the standalone local-only HTTP REST lab harness:

```bash
npm run test:playground:http-push
```

Run the authenticated local-only HTTP REST lab harness:

```bash
npm run test:playground:authenticated-http-push
```

Run the DB-backed journal/idempotency REST lab harness:

```bash
npm run test:playground:db-journal-idempotency
```

Run the mid-apply drift JIT pre-write smoke:

```bash
npm run test:playground:mid-apply-drift
```

Run the storage-boundary guarded DB update smoke:

```bash
npm run test:playground:storage-guarded-db-write
```

Run the DB-backed process-kill/restart smoke:

```bash
npm run test:playground:db-journal-process-kill
```

Run the DB-backed missing-commit finalization smoke:

```bash
npm run test:playground:db-journal-missing-commit-finalization
```

Run the fixture plugin install atomicity smoke:

```bash
npm run test:playground:plugin-atomic-install
```

Run the fixture-only forms lab custom-table semantic driver smoke:

```bash
npm run test:playground:forms-lab-table
```

Run the lab recovery inspection harness:

```bash
npm run test:playground:recovery
```

Run the file-backed JSON recovery journal restart smoke:

```bash
npm run test:recovery:file-journal
```

The Playground target is the lab proof for real WordPress fixture state. It
exports snapshots from Playground sites, exercises conflict planning from those
snapshots, creates a ready plan with `remote=base`, applies that plan inside a
fresh Playground source site, and verifies WordPress-visible posts, options, and
files after apply. The Playground protocol smoke also exercises a fixture-scoped
dry-run/apply endpoint: dry-run is read-only by same-process before/after
readback, apply requires a supplied dry-run receipt before it can mutate the
eight expected fixture resources, and the endpoint verifies hashes after apply.
Missing receipts fail before mutation with `MISSING_DRY_RUN_RECEIPT`, tampered
receipts fail before mutation with `RECEIPT_MISMATCH`, stale apply fails with
`PRECONDITION_FAILED`, and non-ready conflict plans fail with `PLAN_NOT_READY`.
The verified plugin-owned data slice is narrow: blueprints include the
`reprint_push_forms_fixture` option, fixture-marked parent posts with
`_reprint_push_forms_schema` postmeta, fixture-only
`wp_reprint_push_forms_lab` custom-table rows, and
`reprint-push-forms-fixture` plugin metadata. Apply is allowed for allowlisted
fixture option/postmeta resources and for the exact forms lab custom-table
semantic driver only: table `wp_reprint_push_forms_lab`, driver
`fixture-forms-lab-table`, owner `forms`, positive `id:N` rows, explicit
snapshot policy, unchanged active `reprint-push-forms-fixture` evidence,
matching precondition hashes, exact PHP table/column/payload validation, and
delete blocked. Unknown custom tables, arbitrary plugin-owned data, direct
`active_plugins` mutation, and production plugin semantic drivers remain
blocked or unproven.
This remains a lab harness, not production Reprint HTTP source mutation support.
Its receipts are hash-bound to plan, mutation, precondition, and resource
evidence, and its journal checks are fixture-scoped lab audit evidence, not a
durable production journal, auth model, or signing scheme.

The `test:playground:http-push` script starts disposable Playground servers
bound only to `127.0.0.1` and verifies a local-only REST lab namespace,
`reprint-push-lab/v1`, with `GET /snapshot`, `GET /journal`, `POST /dry-run`,
and `POST /apply`. It covers namespace discovery, snapshots, journal readback,
read-only dry-run, required dry-run receipts, successful apply of the current
eight ready mutations, tampered receipt refusal, stale remote refusal, and
row/file/plugin-data conflict classes. It is intentionally standalone because it
starts real HTTP servers and takes around two minutes; it is not included in
`test:playground`.

The `test:playground:authenticated-http-push` script verifies authenticated
aliases under `/wp-json/reprint-push-lab/v1/authenticated/*` over real local
HTTP. The routes use Basic-auth-shaped WordPress Application Password
credentials for bootstrapped Playground users and require `manage_options`.
Playground fallback caveat: in this environment, core Application Password
authentication did not establish `/wp-json/wp/v2/users/me`, so the lab route
uses a plugin fallback verifier that validates the stored hashed
`_application_passwords` entry, sets the current WordPress user, and then runs
the capability check. Preflight returns identity, capability, scope, session,
expiry, and journal evidence. Authenticated dry-run is read-only and mints
auth-bound receipts. Authenticated apply validates receipt scope, expiry,
identity, session, route/request binding, and the request body before the DB
idempotency claim and mutation; it requires
`X-Reprint-Push-Idempotency-Key`, applies over real local HTTP, and a fresh
authenticated snapshot verifies the source changes. Negative proof covers
missing, bad, and malformed auth; insufficient capability; forged
`reprint_push_lab_auth` query/body/header data; tampered, expired, and
wrong-identity receipts; missing idempotency key; stale remote no-data-loss; and
replay with zero fresh mutation work. The public legacy lab routes remain
intentionally public for old smokes; this authenticated evidence applies only to
`/authenticated/*`.

The same authenticated Playground smoke now also proves a lab HMAC/signed
request integrity floor for `/authenticated/preflight`,
`/authenticated/dry-run`, and `/authenticated/apply`. Basic/Application
Password-shaped auth and the `manage_options` capability check remain in place,
but the route rejects bad request signatures before JSON parsing, receipt
validation, idempotency lookup or claim, journal writes, or mutation. The
`X-Auth-Content-Hash` value is SHA-256 over the raw request body bytes.
`X-Auth-Signature` covers `X-Auth-Nonce`, `X-Auth-Timestamp`, and the content
hash. Dry-run/apply also require `X-Reprint-Push-Signature`, binding the HTTP
method, actual path, canonical query, content hash, server-minted push session,
and `X-Reprint-Push-Idempotency-Key`. Preflight mints the short-lived lab push
session; dry-run and apply require both that session and an idempotency key.
Nonce replay rejects before idempotency replay, while a replay with a fresh
nonce/signature and the same idempotency key/body still returns the committed
result with zero fresh mutation work. Signature tests cover unsigned,
malformed, bad content hash, body changed after signing, stale/future
timestamp, wrong method/path/query, wrong session, idempotency mismatch,
public-route signature attempts, nonce replay, and positive signed preflight,
dry-run, apply, and replay. This is lab HMAC evidence only, not production
Reprint auth; responses intentionally expose stable hash evidence such as
credential/signing-key hashes for lab proof and are not a production response
contract.

The `test:playground:db-journal-idempotency` script verifies a separate
DB-native lab journal for `POST /apply`. Apply now requires
`X-Reprint-Push-Idempotency-Key`; a missing key returns
`400 MISSING_IDEMPOTENCY_KEY` before mutation. The table
`wp_reprint_push_lab_push_journal` records DB-native events including
`idempotency-opened`, `apply-started`, `mutation-prepared` before each target
write, `mutation-applied` after observed hash calculation, `apply-committed`,
replay evidence, and conflict evidence. Compact DB mutation evidence stores
hashes and metadata only: mutation order/id/resource key/type, before hash,
planned after hash, observed hash, phase/status, and
request/plan/receipt/idempotency hashes. Same key plus same
body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, no
fresh mutation work, no extra mutation events, and an unchanged snapshot. Same
key plus a different body returns `409 IDEMPOTENCY_KEY_CONFLICT` before
mutation. The same harness also verifies the DB-native claim path: a unique
`claim_key_hash` opens exactly one first-apply claim before mutation, concurrent
same-key/same-body first applies produce exactly one fresh mutation executor,
and the duplicate request returns safe in-progress/retry/replay behavior without
running mutations. Concurrent same-key/different-body applies reject the loser
with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation. Stale precondition failures
are journaled as rejected terminal results, and same key/body replay returns the
same rejection with `idempotency.replayed: true` and no fresh mutation work.
This DB journal is separate from the legacy `wp_options` lab journal read by
`GET /journal`; both are fixture-scoped evidence.

The `test:playground:mid-apply-drift` script verifies the current lab
just-in-time pre-write guard. After dry-run and initial apply validation, a lab
hook changes one target after `mutation-prepared` but before that mutation's
write. Apply re-hashes that mutation's own resource immediately before writing,
returns `412 PRECONDITION_FAILED`, preserves the drifted target, writes no
`mutation-applied` event for the failed mutation, writes no later mutations,
and writes no `apply-committed`. DB replay of the same key/body returns the
same rejected result with `idempotency.replayed: true` and no fresh mutation
work; the same key with a different body conflicts. The evidence is hash-only
and lab-scoped, not storage-level compare-and-swap or locking.

The `test:playground:storage-guarded-db-write` script verifies the accepted
lab storage-boundary guarded DB update slice. The existing JIT pre-write hash
still runs first. For existing fixture DB row update mutations in `wp_posts`,
allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact
fixture `wp_reprint_push_forms_lab` positive rows, apply then uses one guarded
`$wpdb->query($wpdb->prepare(...))` `UPDATE` whose `WHERE` compares expected
stored columns at the SQL write boundary. Hash-only `storageGuard` evidence
records boundary, driver, logical and physical table, operation, compared
column names, expected resource and storage hashes, rows affected, outcome, and
SQL shape hash. Drift after JIT but before SQL, including marker-empty
ownership drift for posts and postmeta parents, returns
`PRECONDITION_FAILED`, preserves the drifted target, writes no
`mutation-applied` for the failed target, writes no later mutations, and writes
no `apply-committed`. This is local Playground/SQLite fixture evidence only:
not production DB durability, production Reprint HTTP mutation, generic
MySQL/InnoDB compare-and-swap proof, transactions, locking, rollback,
inserts/deletes/files/plugin activation guarding, or arbitrary
plugin/custom-table semantic safety.

The `test:playground:db-journal-process-kill` script runs a local-only
Playground process-kill smoke over a host-mounted WordPress directory. It sends
a real `SIGKILL` to the localhost Playground server during an in-flight
DB-journaled REST apply, restarts against the same mount, and verifies DB
`idempotency-opened`/`apply-started` rows persist without a false
`apply-committed`, live target hashes are explainable as old/new with no silent
divergence, `GET /recovery/inspect` returns non-mutating `RECOVERY_BLOCKED`,
and retry does not overwrite the partial state. Recovery uses DB planned
evidence plus live hashes and does not rely on the legacy option journal.

The `test:playground:db-journal-missing-commit-finalization` script verifies
the DB-only missing-commit finalization path. A lab hook applies the same ready
fixture target writes and records DB mutation evidence, but leaves the
`apply-committed` row missing. The same key with a different body still rejects
with `409 IDEMPOTENCY_KEY_CONFLICT` before finalization. The same key with the
same body sees all live target hashes already at the planned after hashes,
returns `BATCH_RECOVERY_FINALIZED`, appends the missing commit row, and performs
zero fresh mutation work; a later replay returns `BATCH_ALREADY_COMMITTED`.

These DB journal smokes are local Playground SQLite/host-mount lab evidence
only, not production durability. They do not prove storage fsync, rollback,
exactly-once production writes, arbitrary plugin data safety, or full
MySQL/InnoDB behavior. The all-old stale-claim safe retry case remains
conservative/not fully solved, tests mostly count mutation evidence rows rather
than deeply asserting every observed hash, and production auth, live source
mutation, and the full push path remain pending. The authenticated Playground
slice is authenticated local Playground source-site mutation evidence, not
production Reprint auth. No production TLS deployment, nonce/replay store
cleanup, production session handling, production Application Password
integration, real exporter credential binding, durable production audit records,
or full production push exists yet.

The `test:playground:plugin-atomic-install` script verifies a hard-coded
Playground fixture plugin install atomicity slice through the local lab REST
surface. The base/remote fixture lacks the atomic fixture plugins, while the
local fixture includes a dependency plugin and a dependent plugin in the same
atomic group. Apply activates both, writes only the exact fixture plugin files,
plugin resources, and allowlisted plugin-owned option data, and replay performs
zero fresh mutation work. Negative proof covers missing dependency, dependency
outside the group, incompatible version, hash mismatch, activation requirement
mismatch, remote dependency drift, stale preconditions, forged ready plans that
omit dependency mutation, `atomicGroups`, or dependency requirements, stale
live-remote dependency evidence, and row-only plugin-owned data bypass attempts.
The plugin atomic positive path may accept the inactive staged plugin hash only
for activation-style plugin mutations, and only when hash-only journal evidence
shows a prior same-apply fixture plugin file mutation covered by the declared
ready atomic group. Negative proof covers staged shortcut attempts without that
same-apply proof, forged mutation-local group coverage without declared group
coverage, and planned inactive plugin mutations trying to use the staged
shortcut.
Executor-side validation runs in both JavaScript and PHP before mutation or
preconditions where relevant. Arbitrary plugin files, direct `active_plugins`
row mutation, arbitrary plugin-owned data, and custom tables outside the exact
forms lab driver remain blocked. Failure injection proves a before-commit
failure preserves the old remote, while during-publish and activation failures
classify blocked recovery instead of proving rollback.
The row-only bypass case rejects with `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`;
this is not arbitrary production plugin install/update/activation, and it
provides no production rollback, no generic custom-table/plugin semantic
drivers, and no arbitrary plugin-owned data safety.

The `test:playground:forms-lab-table` script verifies the one custom-table
semantic driver currently allowed in the lab. The positive path mutates a cloned
exported local snapshot row for `wp_reprint_push_forms_lab`, plans exactly one
ready mutation with driver `fixture-forms-lab-table`, applies it to a real base
Playground target, reads it back through the snapshot exporter, and verifies
idempotent replay with zero fresh mutation work. Negative proof covers missing
driver evidence and a forged `wp-option` driver on the custom table before
mutation. The JavaScript model also rejects forged non-hex/stale plugin evidence,
keeps divergent local/remote rows as redacted `plugin-data-conflict`, preserves
the target on stale preconditions, and redacts forms-lab row values from
hash-only journal/recovery evidence. This is exact fixture evidence only: no
generic custom-table support, no arbitrary plugin-owned data safety, no
production plugin semantic driver, and no production rollback, transaction, or
durability guarantee.

The `test:playground:recovery` script exercises the lab-only failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. The
verified fail-after-2 case records `LAB_INJECTED_APPLY_FAILURE` after two
successful whole-resource mutations, classifies the remote as
`blocked-recovery`, reports `2 new` and `6 old` targets through CLI/REST
inspection, and refuses retry with `PRECONDITION_FAILED`. This is bounded lab
inspection over option-journal evidence with hashes only; it is not
durable production recovery or auto-repair.

The `test:recovery:file-journal` script verifies the JSON-model file-backed
recovery journal. It writes append-only JSONL records with monotonic sequences,
includes `fsync` evidence after each append, inspects persisted journal files
after restart-style module reloads, verifies old-remote before mutation,
`blocked-recovery` after fail-after-2 with `2 new` and `6 old` targets, retry
refusal with `PRECONDITION_FAILED` and no remote change, completed replay with
`0` additional mutations, drift outside before/after hashes as
`blockedUnknown > 0`, and no raw fixture fields/data in journal files. This is
still JSON-model lab evidence, not production WordPress recovery: it does not
replace the DB table journal or the local Playground process-kill smoke, and
the per-append `fsync` evidence is lab evidence rather than full production
durability. Journal paths must be unique or reset intentionally because plan
journal open defaults to `truncate`, and raw-value prevention is
forbidden-key/fixture-string based rather than a complete allowlist schema.

The lab CLI works on three snapshots:

```bash
reprint-push-lab plan \
  --base pulled-base.json \
  --local local-edited.json \
  --remote live-remote.json \
  --out push-plan.json

reprint-push-lab apply \
  --remote live-remote.json \
  --plan push-plan.json \
  --out remote-after.json
```

The model uses a three-way base/local/remote comparison. A plan may be:

- `ready`: safe to apply if all remote preconditions still match.
- `blocked`: dependencies or other hard gates are missing.
- `conflict`: local and remote both changed the same resource differently.

Apply revalidates remote preconditions before mutation and, in the current lab
REST path, re-hashes each mutation target immediately before that target write.
If the live remote changed after the dry run or between initial apply
validation and a specific mutation write, apply refuses with
`PRECONDITION_FAILED` instead of overwriting the changed target. This remains
lab evidence, not storage-level compare-and-swap or locking.

## Research Inputs

- Reprint pull pipeline: resumable preflight, file pull, database pull, database
  apply, runtime setup.
- ZS-Sync: authoritative-site scanners, resource metadata, cursoring, and
  resource fetch APIs.
- ForkPress: branch merge, audit logs, conflict lifecycle, plugin validators,
  rollback, and crash-recovery model.

See [docs/source-notes.md](docs/source-notes.md) and
[docs/approach-scorecard.md](docs/approach-scorecard.md).

## Progress

The public status page lives at [progress.html](progress.html). It is designed
to be served through GitHub Pages from this repository.
