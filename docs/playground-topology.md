# Playground Test Topology

Docker and WP-CLI are not available in the current sandbox. The first real
WordPress topology therefore uses WordPress Playground CLI in no-server mode.
This avoids opening any local network ports and keeps the test state disposable.

## Sites

| Site | Blueprint | Purpose |
| --- | --- | --- |
| Remote base | `fixtures/playground/remote-base.blueprint.json` | Represents the source site at pull time. |
| Local edited | `fixtures/playground/local-edited.blueprint.json` | Represents the pulled local site after local edits. |
| Remote changed | `fixtures/playground/remote-changed.blueprint.json` | Represents the live source site after independent remote edits. |

The blueprints use `runPHP` to create WordPress posts, plugin-owned options,
fixture-marked plugin-owned postmeta, fixture-only plugin-owned custom-table
rows, plugin metadata, and upload files with stable fixture markers. The
plugin-owned forms fixture covers the `reprint_push_forms_fixture` option,
`_reprint_push_forms_schema` postmeta, `wp_reprint_push_forms_lab` custom-table
rows, and `reprint-push-forms-fixture` plugin metadata. They are intentionally
small because this topology proves snapshot extraction and planning, not the
final transport.

## Smoke Command

```bash
scripts/playground/smoke-blueprints.sh
```

The script runs each blueprint with:

```bash
npx --yes @wp-playground/cli@latest run-blueprint --blueprint=<file>
```

It does not start a server.

## Playground Harness Command

```bash
npm run test:playground
```

The script mounts this repository into each Playground runtime, runs
`scripts/playground/export-site-snapshot.php`, passes the exported WordPress
posts/options/files through the JSON push planner, applies a ready fixture plan,
and runs a fixture-scoped protocol smoke. It currently asserts:

- the shared post is a real WordPress row conflict;
- the shared upload file is a file conflict;
- the `reprint_push_plugin_payload` option is a plugin-data conflict;
- the nested `reprint_push_forms_fixture` option is treated as allowlisted
  plugin-owned fixture data;
- `_reprint_push_forms_schema` postmeta is exported only for fixture-marked
  parent posts;
- `wp_reprint_push_forms_lab` rows are fixture-only semantic-driver resources:
  owner `forms`, driver `fixture-forms-lab-table`, positive `id:N`, explicit
  policy, unchanged active `reprint-push-forms-fixture` evidence, matching
  precondition hashes, and delete blocked;
- `reprint-push-forms-fixture` plugin metadata is detected but not applied;
- unknown plugin-owned custom-table rows block as
  `unsupported-plugin-owned-resource`;
- local-only post and file resources become guarded mutations;
- remote-only post and file resources are preserved as remote decisions.

## Guarded Apply Harness

The apply leg for `npm run test:playground` uses the same no-server Playground
boundary. It:

- exports real WordPress snapshots from the base, local edited, and remote
  changed fixtures;
- keeps the conflict-planning assertions above;
- builds a separate ready plan with `remote=base`, so local-only mutations are
  safe to apply against an unchanged source fixture;
- applies that ready plan inside a fresh Playground source site; and
- verifies the result through WordPress-visible posts, options, and files, not by
  trusting only the JSON applicator output.

The guarantee is intentionally narrow: the harness proves that guarded lab
mutations derived from real Playground snapshots can be applied to a disposable
Playground source and read back through WordPress. It does not prove the
production Reprint HTTP transport, a live source-site mutation endpoint,
durable remote journaling, authentication, or plugin-specific semantic merge
drivers.

## Fixture Forms Lab Custom-Table Driver

```bash
npm run test:playground:forms-lab-table
```

This focused smoke is the only custom-table apply proof in the repository. It
mutates a cloned exported local snapshot row for `wp_reprint_push_forms_lab`,
plans exactly one ready row mutation using driver `fixture-forms-lab-table`,
applies it to a fresh base Playground source, reads the row back through the
snapshot exporter, and verifies replay performs zero fresh mutation work.

The driver is exact by design: table `wp_reprint_push_forms_lab`, physical table
`$wpdb->prefix . 'reprint_push_forms_lab'`, owner `forms`, positive `id:N`
primary keys, known columns only, object payloads with `payload.owner ===
"forms"`, fixture slug/marker validation, unchanged active
`reprint-push-forms-fixture` evidence, and matching row preconditions. PHP
validates the table name through a prefix-safe helper before interpolating it
into prepared SQL. Deletes are not implemented and remain blocked.

Negative proof covers missing driver evidence, forged generic `wp-option`
driver evidence on the custom table, forged/stale JavaScript plugin evidence,
divergent local/remote rows as `plugin-data-conflict`, stale precondition
preservation, and redacted hash-only forms-lab journal/recovery evidence. This
does not prove generic custom-table support, arbitrary plugin-owned data safety,
a production plugin semantic driver, production rollback, production
transactionality, or production durability.

## Fixture-Scoped Protocol Smoke

`scripts/playground/push-protocol-smoke.mjs` mounts
`scripts/playground/push-remote-endpoint.php` and
`scripts/playground/push-remote-lib.php` into no-server Playground runtimes.
This endpoint is intentionally lab-only and fixture-scoped. It is not the
production Reprint HTTP mutation endpoint.

The smoke verifies:

- dry-run validates all ready-plan mutation preconditions and reports
  `applied: 0`;
- same-process WordPress readback proves dry-run leaves the source fixture
  unchanged;
- apply with a supplied dry-run receipt applies the eight expected fixture
  mutations and verifies the resulting hashes and WordPress-visible surface;
- apply without a supplied receipt fails with `MISSING_DRY_RUN_RECEIPT` before
  mutation;
- tampered receipts fail with `RECEIPT_MISMATCH` before mutation;
- stale apply against the changed remote fixture fails with
  `PRECONDITION_FAILED` and preserves the drifted remote state;
- conflict dry-run and conflict apply refuse with `PLAN_NOT_READY` and include
  audit evidence for row, file, and plugin-data conflict classes.

The lab receipt is bound to the plan fingerprint/hash, mutation and
precondition sets, ordered resource keys, and dry-run actual hashes. The
endpoint also records bounded fixture-scoped lab journal/audit option events:
`dry-run-recorded`, `apply-started`, `apply-committed`,
`precondition-failed`, `plan-not-ready`, `receipt-required`, and
`receipt-mismatch`. These records are lab audit evidence only, not durable
production journals.

## Local-Only REST Lab Harness

```bash
npm run test:playground:http-push
```

This standalone script starts disposable WordPress Playground servers bound
only to `127.0.0.1` and talks to them over real HTTP. It is not included in
`npm run test:playground` because it takes around two minutes and starts real
servers.

The lab REST surface is mounted under the namespace `reprint-push-lab/v1` with:

- `GET /snapshot`
- `GET /journal`
- `POST /dry-run`
- `POST /apply`

The HTTP-style harness verifies namespace discovery, snapshot export, journal
readback, read-only dry-run, `MISSING_DRY_RUN_RECEIPT` before mutation when a
receipt is missing, dry-run receipt creation, ready apply success with eight
fixture mutations, `RECEIPT_MISMATCH` before mutation when the receipt is
tampered, stale remote refusal with `PRECONDITION_FAILED`, and conflict refusal
with `PLAN_NOT_READY` for row, file, and plugin-data classes.

This is stronger protocol-shape evidence than the no-server smoke because it
uses real local HTTP against disposable Playground servers. It remains
lab-only and fixture-scoped: the REST plugin is public only inside the local
Playground runtime, and it does not prove production auth, sessions, nonce
checks, signed receipts, durable journals, crash recovery, or live source-site
mutation safety.

## Authenticated Local-Only REST Lab Harness

```bash
npm run test:playground:authenticated-http-push
```

This standalone script verifies authenticated lab aliases under
`/wp-json/reprint-push-lab/v1/authenticated/*` over real local HTTP. The public
legacy lab routes under `reprint-push-lab/v1` remain intentionally public for
the older smokes; authenticated evidence applies only to `/authenticated/*`.

The authenticated routes include:

- `GET /authenticated/preflight`
- `POST /authenticated/dry-run`
- `POST /authenticated/apply`
- `GET /authenticated/snapshot`
- `GET /authenticated/journal`
- `GET /authenticated/db-journal`
- `GET /authenticated/db-journal/schema`
- `POST /authenticated/recovery/inspect`

The auth shape uses Basic-auth-shaped WordPress Application Password
credentials for bootstrapped Playground users. The route permission callback
requires a verified WordPress identity and `manage_options`. Playground
fallback caveat: core Application Password authentication did not establish
`/wp-json/wp/v2/users/me` in this local Playground run, so the lab plugin also
contains a fallback verifier that reads the stored hashed Application Password
entries, validates the supplied password, sets the current WordPress user, and
then runs the same capability check. This fallback is lab-only Playground
auth evidence, not production Application Password integration.

The preflight response returns identity, capability, scope, session, expiry,
and journal details, including the `reprint-push-lab:authenticated-http-push`
scope and `X-Reprint-Push-Idempotency-Key` requirement. Authenticated dry-run
is read-only, verified by a before/after authenticated snapshot, and returns an
auth-bound receipt. Authenticated apply validates receipt scope, expiry,
identity, session, route/request binding, and request body binding before the
DB idempotency claim and mutation. Successful apply mutates the disposable
source over real local HTTP, then a fresh authenticated snapshot verifies the
WordPress-visible source changes. Replaying the same idempotency key/body
returns `BATCH_ALREADY_COMMITTED` with zero fresh mutation work.

The authenticated smoke also requires signed lab requests for
`/authenticated/preflight`, `/authenticated/dry-run`, and
`/authenticated/apply`. The existing Basic/Application-Password-shaped auth and
`manage_options` permission check remain in place. HMAC verification runs
before JSON parsing, receipt validation, idempotency lookup/claim, journal
write, or mutation. `X-Auth-Content-Hash` is SHA-256 over the raw request body
bytes; `X-Auth-Signature` covers nonce, timestamp, and that content hash.
`X-Reprint-Push-Signature` covers method, actual path, canonical query, content
hash, the server-minted lab push session, and idempotency key. Preflight mints
the short-lived lab session, while dry-run/apply require the session and
idempotency key.

Negative proof covers missing, bad, and malformed auth; insufficient
capability; forged `reprint_push_lab_auth` query/body/header values;
`AUTH_RECEIPT_MISMATCH` for tampered or wrong-identity receipts;
`AUTH_RECEIPT_EXPIRED` for expired receipts; missing
`X-Reprint-Push-Idempotency-Key`; stale remote refusal with no data loss before
idempotency claim; unsigned or malformed signature data; bad content hash; body
changed after signing; stale or future timestamp; wrong method, path, canonical
query, session, or idempotency binding; signed public-route attempts; nonce
replay before idempotency replay; and replay with a fresh nonce/signature and
zero fresh mutation work.

This is authenticated local Playground source-site mutation evidence only. It
does not prove production Reprint auth, TLS deployment, nonce/replay store
cleanup, production auth/session handling, real exporter credential binding,
production Application Password integration, durable production audit records,
or full production push. The public legacy lab routes remain public/mutable;
HMAC applies only to `/authenticated/*` aliases. Responses expose stable hash
evidence such as credential/signing-key hashes for lab proof and are not a
production response contract.

## DB Journal and Idempotency Lab

```bash
npm run test:playground:db-journal-idempotency
npm run test:playground:mid-apply-drift
npm run test:playground:db-journal-missing-commit-finalization
```

This standalone local-only REST harness verifies a DB-native apply journal in
the disposable Playground source site. It is separate from the legacy
`wp_options` journal exposed through `GET /journal`.

`POST /apply` requires `X-Reprint-Push-Idempotency-Key`. A missing key returns
`400 MISSING_IDEMPOTENCY_KEY` before mutation. When the key is present, the lab
table `wp_reprint_push_lab_push_journal` records `idempotency-opened`,
`apply-started`, per-mutation `mutation-prepared`, per-mutation
`mutation-applied`, `apply-committed`, `apply-replayed`, and conflict
evidence. Compact mutation rows store hashes and metadata only: mutation
order/id/resource key/type, before hash, planned after hash, observed hash,
phase/status, and request/plan/receipt/idempotency hashes.

The harness verifies that replaying the same body with the same idempotency key
returns `BATCH_ALREADY_COMMITTED` and `idempotency.replayed: true`, does not run
fresh mutation work, does not add extra per-mutation journal events, and leaves
the snapshot unchanged. Reusing the same key with a different body returns
`409 IDEMPOTENCY_KEY_CONFLICT` before mutation.

The harness also covers concurrent duplicate first applies. The DB-native claim
uses the unique nullable `claim_key_hash` column so only one
`idempotency-opened` row can win before mutation. Concurrent same-key/same-body
requests produce exactly one fresh mutation executor and one opened claim; the
duplicate request returns safe in-progress/retry/replay behavior without running
mutations. Concurrent same-key/different-body requests reject the conflicting
request before mutation.

The mid-apply drift smoke is a standalone local-only REST harness for the
just-in-time pre-write check. It performs dry-run, starts apply, then uses a lab
hook to drift one target after `mutation-prepared` and before that mutation's
write. The PHP apply path re-hashes that mutation's own resource immediately
before `reprint_push_apply_resource()`, returns
`412 PRECONDITION_FAILED`, preserves the drifted value, records hash-only
`mutation-precondition-failed`/`apply-rejected` evidence, writes no
`mutation-applied` for the failed mutation, writes no later mutations, and
writes no `apply-committed`. Same key/body replay is non-mutating and replays
the rejection; same key/different body conflicts. This proves the lab gap is
closed for the fixture path, not storage-level compare-and-swap, locking, or
production durability.

```bash
npm run test:playground:db-journal-process-kill
```

The process-kill smoke uses a localhost Playground server with a host-mounted
WordPress directory. It starts an in-flight DB-journaled REST apply, waits for
`idempotency-opened` and `apply-started`, sends a real `SIGKILL` to the
Playground server process group, restarts against the same mounted WordPress
directory, and verifies that DB rows and target data persisted.

After restart the DB journal must not contain `apply-committed` or replay
evidence. Live target hashes are classified as old/new with no blocked-unknown
targets from DB planned evidence plus live hashes, recovery inspection returns
non-mutating `RECOVERY_BLOCKED`, and retry over the same idempotency key is
blocked without changing the partial target state. The smoke does not rely on
the legacy option journal for this recovery classification.

The missing-commit finalization smoke uses a deterministic lab hook, not a hard
kill, to leave target writes visible and DB mutation evidence present while
omitting the terminal `apply-committed` row. Before finalization, the same key
with a different body still rejects with `409 IDEMPOTENCY_KEY_CONFLICT`. The
same key with the same body observes all live target hashes at their planned
after hashes, appends the missing commit row, returns
`BATCH_RECOVERY_FINALIZED`, and performs zero fresh mutation work; later replay
returns `BATCH_ALREADY_COMMITTED`.

These smokes intentionally stay local Playground SQLite/host-mount evidence:
they do not prove production durability, storage-level `fsync`, rollback,
exactly-once production writes, arbitrary plugin data safety, or full
MySQL/InnoDB behavior. The all-old stale-claim safe retry case remains
conservative/not fully solved, tests mostly count mutation evidence rows rather
than deeply asserting every observed hash, and production auth/live source
mutation/full push remains pending. Redaction checks are key-based plus
fixture-value smoke checks, not a formal sanitizer for arbitrary future
messages.

## Fixture Plugin Install Atomicity Lab

```bash
npm run test:playground:plugin-atomic-install
```

This standalone local-only REST smoke verifies a hard-coded Playground fixture
plugin install atomicity slice. The base and remote fixture snapshots lack the
atomic fixture plugins. The local fixture contains
`reprint-push-atomic-dependency-fixture` and
`reprint-push-atomic-dependent-fixture`, plus the allowlisted
`reprint_push_atomic_fixture_data` option, in one atomic install group.

The positive path proves:

- dry-run is read-only and returns a receipt;
- apply installs and activates both fixture plugins in the same atomic group;
- apply writes only the exact fixture plugin file allowlist, the matching
  plugin resources, and the allowlisted plugin-owned option data;
- WordPress-visible snapshot readback verifies the plugin versions, activation
  state, plugin files, and option payload; and
- replay with the same idempotency key/body returns `BATCH_ALREADY_COMMITTED`,
  performs zero fresh mutation work, and adds no fresh mutation events.

Negative proof covers missing dependency, dependency mutation outside the
atomic group, incompatible version, dependency hash mismatch, activation
requirement mismatch, remote dependency drift, stale apply preconditions, stale
live-remote dependency evidence, forged ready plans that omit the dependency
mutation, omit `atomicGroups`, or omit dependency requirements, and row-only
plugin-owned data bypass attempts. The planner/executor rejects the forged
row-only case with `ATOMIC_GROUP_DEPENDENCY_UNDECLARED` before it can treat
dependent plugin-owned option data as an independent safe row.

The positive path also records explicit `same-apply-staged` proof when an
activation-style plugin mutation sees the inactive staged plugin hash produced
by an earlier same-apply plugin file mutation. That exception is fixture-scoped
and requires the declared ready atomic group to cover both mutations by
`mutationIds` and `resources`. Negative cases verify that external staged files
without valid same-apply proof, forged mutation-local group ids without
declared group coverage, and planned inactive plugin mutations reject with
`PRECONDITION_FAILED` before activation or commit.

Validation exists on both executor sides used by this repository:
`src/apply.js` validates atomic dependency closure in JavaScript before staged
mutation, and `scripts/playground/push-remote-lib.php` validates the submitted
plan in PHP before mutation/preconditions where relevant. The snapshot/apply
library enforces an exact fixture plugin allowlist. Arbitrary plugin files,
direct `active_plugins` row mutation, custom tables outside the exact forms lab
driver, and arbitrary plugin-owned data remain blocked.

Failure injection is deliberately classified, not rolled back. A failure before
the group commit preserves the old remote. A failure during group publish and a
fixture activation failure return blocked recovery/no fresh retry mutation
evidence; they do not prove production rollback.

This is fixture plugin install atomicity evidence only. It is not arbitrary
production plugin installation, update, activation, semantic driver,
generic custom-table driver, arbitrary plugin-owned data safety, production rollback,
or production durability/auth proof.

## Lab Recovery Harness

```bash
npm run test:playground:recovery
```

This standalone script starts a disposable Playground server bound only to
`127.0.0.1` and exercises the lab failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. It verifies
the fail-after-2 case: the PHP protocol returns
`LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations, the
bounded option journal records planned recovery entries, `mutation-applied`,
`apply-failed`, `recovery-required`, and current hashes without raw values, and
inspection reports `2 new` targets plus `6 old` targets.

The recovery inspection path is available through the CLI and through
`GET /recovery/inspect` on the local REST server. Both classify the remote as
`blocked-recovery`, with individual targets classified as old, new, or
blocked-unknown. A retry refuses with `PRECONDITION_FAILED` instead of applying
over the partial state.

This is lab recovery inspection only. It proves bounded journal evidence and
classification after an injected apply failure, not production durable recovery,
process-kill safety, `fsync` safety, or automatic repair.

## File-Backed JSONL Recovery Journal

```bash
npm run test:recovery:file-journal
```

This standalone JSON-model smoke is separate from the WordPress Playground
topology. It verifies `src/recovery-journal.js` append-only JSONL files with
monotonic sequence numbers and `fsync` evidence after each append, plus
restart-style inspection through `src/recovery-inspect.js` over the persisted
journal and the current JSON snapshot.

The smoke proves old-remote classification before mutation, fail-after-2
`blocked-recovery` with `2 new`, `6 old`, and `0` unknown targets, retry
refusal with `PRECONDITION_FAILED` and no remote change, completed replay with
`0` additional mutations, and drift outside the journaled before/after envelope
as `blockedUnknown > 0`. It also verifies that journal files do not contain raw
fixture fields/data.

This file-backed journal is lab evidence for the JSON safety model, not
production WordPress recovery. It does not replace a production DB table
journal, the local Playground process-kill smoke, source-site crash testing, or
automatic repair. Journal paths must be unique or reset intentionally because
opening a plan recovery journal defaults to `truncate`; raw-value prevention is
forbidden-key/fixture-string based rather than a full allowlist schema.

## Next Proofs Needed

- Replace the fixture-scoped PHP lab endpoint with a real Reprint push HTTP
  endpoint, authentication, sessions, and source-site capability checks.
- Revalidate live remote hashes immediately before production apply.
- Add production-grade receipt expiry, signing/auth binding, and durable audit
  storage around the accepted remote snapshot.
- Promote the fixture-scoped DB journal/idempotency slice into a production
  DB-table journal with production storage-level recovery proof,
  stale-claim retry coverage, and WordPress commit-boundary coverage before
  claiming durable production recovery.
  The JSONL lab journal has per-append `fsync` evidence, but no production
  WordPress crash boundary.
- Add real plugin activation, generic custom-table driver, recovery, and auth
  proof before making claims about arbitrary production plugin-owned data.
