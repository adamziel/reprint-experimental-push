# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 42 Node test scenarios covering the deterministic JSON
  snapshot planner, applicator, and file-backed recovery journal. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js) and
  [test/performance-model.test.js](../test/performance-model.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, dependency version/hash
  checks, stale remote dependency blocking, and precondition hashes. Evidence:
  [src/planner.js](../src/planner.js).
- The current applicator validates preconditions, stages mutations, rejects
  non-ready plans, and returns in-memory lab journal/recovery evidence for old
  remote, fully updated remote, and blocked recovery cases. Evidence:
  [src/apply.js](../src/apply.js) and
  [docs/recovery/apply-journal.md](recovery/apply-journal.md).
- `scripts/playground/smoke-blueprints.sh` passed with three no-server
  WordPress Playground blueprints for remote base, local edited, and remote
  changed fixture states. Evidence:
  [docs/playground-topology.md](playground-topology.md).
- `npm run test:playground` passed. It mounts this repository into three
  Playground runtimes, exports real WordPress posts/options/files with
  [scripts/playground/export-site-snapshot.php](../scripts/playground/export-site-snapshot.php),
  and asserts the planner sees the expected row, file, and plugin-data
  conflicts plus local-only mutations and remote-only preservation.
- Protocol, executor, fast-path, objective-audit, and critic documents have
  landed from supervised lanes. Evidence: [docs/protocol.md](protocol.md),
  [docs/executor.md](executor.md), [docs/fast-paths.md](fast-paths.md),
  [audits/objective-audit.md](../audits/objective-audit.md), and
  [audits/critic.md](../audits/critic.md).
- The page at [progress.html](../progress.html) reports this as a safety model,
  not a production WordPress transport.

## 2026-05-24 - Lab Recovery Inspection Slice

- `npm run test:playground:recovery` passed as a standalone local-only
  Playground recovery harness against a server bound to `127.0.0.1`.
- The harness verifies the PHP protocol failpoint
  `REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
  fail-after-2 case, apply returns `LAB_INJECTED_APPLY_FAILURE` after two
  successful whole-resource mutations.
- The bounded option journal records planned recovery entries,
  `mutation-applied`, `apply-failed`, `recovery-required`, and current hashes
  without raw values. CLI inspect and REST `GET /recovery/inspect` classify the
  target as `blocked-recovery`, with `2 new` targets and `6 old` targets; retry
  refuses with `PRECONDITION_FAILED`.
- This is lab recovery inspection evidence only. It is not a durable production
  recovery journal, not a hard-kill or `fsync` path, and not auto-repair.
  Evidence: [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - File-Backed JSONL Recovery Journal Slice

- `npm run test:recovery:file-journal` passed as a JSON-model restart smoke for
  file-backed recovery journal evidence.
- `src/recovery-journal.js` writes append-only JSONL records with monotonic
  sequences and `fsync` evidence after each append; `src/recovery-inspect.js`
  performs restart-style inspection over the persisted journal plus the current
  JSON snapshot.
- The smoke verifies old-remote before mutation; fail-after-2
  `blocked-recovery` with `2 new`, `6 old`, and `0` unknown targets; retry
  refusal with `PRECONDITION_FAILED` and no remote change; completed replay
  applying `0` additional mutations; drift outside before/after hashes with
  `blockedUnknown > 0`; and journal files with no raw fixture fields/data.
- Caveats remain explicit: this is JSON-model lab evidence, not production
  WordPress recovery. It does not replace a production DB table journal or
  the local Playground process-kill smoke. Journal paths must be unique or
  reset intentionally because opening a plan recovery journal defaults to
  `truncate`, and raw-value prevention is forbidden-key/fixture-string based
  rather than a full allowlist schema. Evidence:
  [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - Playground Guarded Apply Target

- `npm run test:playground` passed as a two-leg Playground harness: first it
  exported real WordPress Playground snapshots and asserted conflict planning,
  then it created a separate ready plan with `remote=base`, applied it inside a
  fresh Playground source site, and verified WordPress-visible posts, options,
  and files after the apply.
- The apply leg reports `status: ready` and verifies the exact ready mutations,
  including shared and local-only upload files, plugin-owned options, edited
  shared/local-only posts, and the allowlisted forms fixture resources.
- This target remains lab-scoped. It does not claim production Reprint HTTP
  source mutation support; the real HTTP transport/source mutation endpoint is
  still a pending proof gate.

## 2026-05-24 - Playground Fixture Protocol Smoke

- `npm run test:playground` now includes
  `scripts/playground/push-protocol-smoke.mjs`, which mounts the lab-only
  `scripts/playground/push-remote-endpoint.php` and
  `scripts/playground/push-remote-lib.php` files into no-server Playground.
- The smoke proves dry-run is read-only by same-process WordPress before/after
  readback, applies a ready fixture plan with a supplied dry-run receipt,
  verifies eight fixture mutations and hashes, rejects missing receipts with
  `MISSING_DRY_RUN_RECEIPT`, rejects tampered receipts with
  `RECEIPT_MISMATCH`, rejects stale apply with `PRECONDITION_FAILED`, and
  preserves the drifted remote fixture.
- Conflict dry-run and apply both refuse with `PLAN_NOT_READY` and return audit
  evidence for row, file, and plugin-data conflict classes.
- Receipts are bound to the plan fingerprint/hash, mutation and precondition
  sets, ordered resource keys, and dry-run actual hashes. The PHP endpoint
  records bounded fixture-scoped lab journal/audit option events for dry-run,
  apply, stale, non-ready, missing-receipt, and mismatch outcomes. This remains
  fixture-scoped lab evidence, not durable production journaling. Production
  Reprint HTTP source mutation support remains pending.

## 2026-05-24 - Local-Only Playground REST Lab Slice

- `npm run test:playground:http-push` passed as a standalone harness that
  starts disposable WordPress Playground servers bound only to `127.0.0.1` and
  exercises real HTTP against a local lab REST namespace,
  `reprint-push-lab/v1`.
- The lab routes are `GET /snapshot`, `GET /journal`, `POST /dry-run`, and
  `POST /apply`. The script verifies namespace discovery, snapshot readback,
  journal readback, dry-run read-only behavior, missing receipt refusal with
  `428 MISSING_DRY_RUN_RECEIPT`, dry-run receipt creation, and successful apply
  of the eight expected fixture mutations.
- Negative HTTP-style cases are also covered: tampered receipts fail with
  `409 RECEIPT_MISMATCH`, stale remote state fails with
  `412 PRECONDITION_FAILED`, and conflict dry-run/apply fail with
  `409 PLAN_NOT_READY` while reporting row, file, and plugin-data conflict
  classes.
- This is still lab-only and fixture-scoped. The REST plugin is public only
  because it is mounted into local disposable Playground. It does not prove
  production auth, sessions, nonce checks, signed receipts, durable journals,
  crash recovery, or production source mutation. The script is intentionally
  outside `npm run test:playground` because it starts real servers and takes
  around two minutes.

## 2026-05-24 - Authenticated Local Playground Source Mutation Slice

- `npm run test:playground:authenticated-http-push` passed as a standalone
  local-only Playground REST harness for authenticated source-site mutation
  evidence under `/wp-json/reprint-push-lab/v1/authenticated/*`.
- The authenticated aliases use Basic-auth-shaped WordPress Application
  Password credentials for bootstrapped Playground users and require
  `manage_options`. Playground fallback caveat: core Application Password auth
  did not establish `/wp-json/wp/v2/users/me` in this local Playground run, so
  the lab route validates stored hashed app-password entries, sets the current
  WordPress user, and then runs the capability check.
- Preflight returns identity, capability, scope, session, expiry, and journal
  evidence. Authenticated dry-run is read-only by authenticated snapshot
  comparison and mints auth-bound receipts.
- Authenticated apply validates receipt scope, expiry, identity, session,
  route/request binding, and request body binding before DB idempotency claim
  and mutation; requires `X-Reprint-Push-Idempotency-Key`; applies over real
  local HTTP; and verifies the source changes through a fresh authenticated
  snapshot.
- Negative proof covers missing, bad, and malformed auth; insufficient
  capability; forged `reprint_push_lab_auth` query/body/header values;
  `AUTH_RECEIPT_MISMATCH` for tampered or wrong-identity receipts;
  `AUTH_RECEIPT_EXPIRED` for expired receipts; missing idempotency key; stale
  remote no-data-loss with no idempotency claim; and replay with zero fresh
  mutation work.
- Public legacy lab routes remain intentionally public for old smokes. This
  authenticated evidence applies only to `/authenticated/*` and remains
  authenticated local Playground source-site mutation evidence, not production
  Reprint auth.
- The same smoke now requires lab HMAC/signed requests for
  `/authenticated/preflight`, `/authenticated/dry-run`, and
  `/authenticated/apply`, with signature verification before JSON parsing,
  receipt validation, idempotency lookup/claim, journal writes, or mutation.
  `X-Auth-Content-Hash` is SHA-256 over raw request body bytes,
  `X-Auth-Signature` covers nonce/timestamp/content hash, and
  `X-Reprint-Push-Signature` binds method, actual path, canonical query,
  content hash, server-minted session, and idempotency key.
- Preflight mints short-lived lab push sessions; dry-run/apply require the
  session plus `X-Reprint-Push-Idempotency-Key`. Nonce replay rejects before
  idempotency replay, while replay with a fresh nonce/signature performs zero
  fresh mutation work.
- New negative signature proof covers unsigned, malformed, bad hash, body
  changed after signing, stale/future timestamp, wrong method/path/query, wrong
  session, idempotency mismatch, public-route signature attempts, and nonce
  replay. Positive proof covers signed preflight, dry-run, apply, and replay.
- Caveats remain explicit: this is lab HMAC evidence only. Public legacy lab
  routes remain public/mutable; HMAC applies only to `/authenticated/*`
  aliases. Responses expose stable hash evidence such as
  credential/signing-key hashes for lab proof, not a production response
  contract. No production TLS deployment, nonce/replay store cleanup,
  production session handling, real exporter credential binding, durable
  production audit records, or full production push exists yet.

## 2026-05-24 - DB Journal Idempotency Slice

- `npm run test:playground:db-journal-idempotency` passed as a standalone
  local-only Playground REST harness for DB-native apply journal and
  idempotency behavior.
- `POST /apply` now requires `X-Reprint-Push-Idempotency-Key`; missing keys
  return `400 MISSING_IDEMPOTENCY_KEY` before mutation.
- The table `wp_reprint_push_lab_push_journal` records DB-native events:
  `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`
  before each target write, per-mutation `mutation-applied` after observed hash
  calculation, `apply-committed`, `apply-replayed`, and conflict evidence.
  Compact mutation evidence stores hashes/metadata only: mutation
  order/id/resource key/type, before hash, planned after hash, observed hash,
  phase/status, and request/plan/receipt/idempotency hashes.
- Same key plus same body returns `BATCH_ALREADY_COMMITTED` with
  `idempotency.replayed: true`, performs no fresh mutation work, writes no
  extra per-mutation events, and leaves the snapshot unchanged. Same key plus a
  different body returns `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- The same harness now covers concurrent duplicate first applies. The unique
  `claim_key_hash` column opens exactly one `idempotency-opened` claim before
  mutation; concurrent same-key/same-body requests produce exactly one fresh
  mutation executor, and the duplicate returns safe in-progress/retry/replay
  behavior without mutation. Concurrent same-key/different-body requests reject
  the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- This DB journal is separate from the legacy `wp_options` lab journal read by
  `GET /journal`; the legacy `/journal` route still exists. Caveats remain:
  fixture-scoped local Playground evidence only, no production durability, and
  redaction checks are key-based plus fixture-value smoke checks rather than a
  full sanitizer for arbitrary future messages.

## 2026-05-24 - DB Journal Process-Kill Smoke

- `npm run test:playground:db-journal-process-kill` passed as a local-only
  Playground SQLite/host-mount process-kill smoke.
- The harness starts a localhost Playground server against a host-mounted
  WordPress directory, begins a DB-journaled REST apply, waits for
  `idempotency-opened` and `apply-started`, sends a real `SIGKILL` to the
  Playground server process group, and restarts against the same mount.
- After restart, DB opened/started rows and target data persist, the DB journal
  does not falsely report `apply-committed` or replay, live target hashes are
  explainable as old/new from DB planned evidence plus live hashes, recovery
  inspection returns non-mutating `RECOVERY_BLOCKED`, and retry over the same
  key is blocked without overwriting the partial state. This path no longer
  relies on the legacy option journal for recovery classification.
- Caveats remain: this is local Playground lab evidence, not production
  durability, storage `fsync`, rollback, exactly-once production writes,
  arbitrary plugin data safety, or full MySQL/InnoDB behavior.

## 2026-05-24 - DB Journal Missing-Commit Finalization Smoke

- `npm run test:playground:db-journal-missing-commit-finalization` passed as a
  local-only Playground smoke for DB-native missing-commit finalization.
- The smoke uses a deterministic lab hook to apply fixture target writes and DB
  mutation evidence while omitting the terminal `apply-committed` row. It then
  verifies every live target hash is already at the planned after hash.
- Before finalization, the same idempotency key with a different body still
  rejects with `409 IDEMPOTENCY_KEY_CONFLICT` and does not mutate or finalize.
- Replaying the same key/body returns `BATCH_RECOVERY_FINALIZED`, appends the
  missing commit row, reports `fully-updated-remote`, performs zero fresh
  mutation work, and does not add new mutation rows. A later replay returns
  `BATCH_ALREADY_COMMITTED`.
- Residual risks remain explicit: this is Playground/local DB lab evidence only
  and not proof of production durability, storage `fsync`, rollback,
  exactly-once production writes, arbitrary plugin data safety, or full
  MySQL/InnoDB behavior. The all-old stale-claim safe retry case remains
  conservative/not fully solved, tests mostly count mutation evidence rows
  rather than deeply asserting every observed hash, and production auth, live
  source mutation, and full push remain pending.

## 2026-05-24 - Plugin-Owned Forms Fixture Slice

- A verified fixture-scoped plugin-owned data slice now covers nested
  `reprint_push_forms_fixture` option data, fixture-marked parent posts with
  `_reprint_push_forms_schema` postmeta, exact
  `wp_reprint_push_forms_lab` custom-table rows through driver
  `fixture-forms-lab-table`, and detection-only
  `reprint-push-forms-fixture` plugin metadata.
- Snapshot/apply is intentionally allowlist-based. Safe apply covers only the
  allowlisted option, the allowlisted postmeta key when the parent post is
  fixture-marked, and the exact forms lab table driver with owner `forms`,
  positive `id:N`, explicit policy, unchanged active
  `reprint-push-forms-fixture` evidence, precondition hashes, exact PHP
  table/column/payload validation, delete blocked, idempotent replay with zero
  fresh mutation work, and redacted hash-only journal/recovery evidence. Plugin
  metadata is exported/detected but not applied.
- The planner requires an explicit row driver policy for plugin-owned rows.
  Unknown plugin-owned custom-table rows block as
  `unsupported-plugin-owned-resource`. Conflict evidence exposes hashes and
  resource evidence, not raw plugin values.
- The smokes verify eight exact ready mutations for the base apply path, one
  exact forms lab table mutation in `npm run test:playground:forms-lab-table`,
  and detection-only plugin metadata is not a ready mutation. Caveat: this is
  still not a claim about arbitrary production plugin semantics; real plugin
  activation, generic custom-table drivers, recovery, auth/session/nonce proof,
  and production source mutation remain pending.

## 2026-05-24 - Playground Fixture Plugin Install Atomicity Slice

- `npm run test:playground:plugin-atomic-install` is the standalone local-only
  Playground REST smoke for hard-coded fixture plugin install atomicity.
- Positive proof: the base/remote fixture lacks the atomic fixture plugins; the
  local fixture includes `reprint-push-atomic-dependency-fixture`,
  `reprint-push-atomic-dependent-fixture`, and
  `reprint_push_atomic_fixture_data` in the same atomic group. Apply activates
  both fixture plugins, writes only the exact fixture plugin file/resource
  allowlist plus allowlisted plugin-owned option data, and WordPress-visible
  readback verifies versions, activation state, plugin files, and option data.
  Replay with the same idempotency key/body returns
  `BATCH_ALREADY_COMMITTED`, performs zero fresh mutation work, and adds no
  fresh mutation events.
- Negative proof: missing dependency, dependency outside group, incompatible
  version, hash mismatch, activation requirement mismatch, remote dependency
  drift, stale precondition, stale live-remote dependency evidence, forged
  ready plans omitting dependency mutation/`atomicGroups`/dependency
  requirements, and row-only plugin-owned data bypass attempts all reject
  before mutation or preserve/classify safely. The row-only bypass is rejected
  as `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`.
- Executor-side validation now runs in JavaScript and PHP before mutation or
  preconditions where relevant. The lab keeps an exact fixture plugin file
  allowlist; arbitrary plugin files, direct `active_plugins` row mutation,
  custom tables outside the exact forms lab driver, and arbitrary plugin-owned
  data remain blocked.
- Failure injection remains classification evidence, not rollback. A
  before-commit failure preserves the old remote. During-publish and activation
  failures classify blocked recovery and prevent fresh retry mutation work.
- Caveat: this is hard-coded Playground fixture plugin install atomicity
  evidence only. It is not arbitrary production plugin installation/update,
  production activation support, production rollback, plugin semantic drivers,
  generic custom-table drivers, arbitrary plugin-owned data safety, or production
  durability/auth proof.

## 2026-05-24 - Lab JIT Pre-Write Drift Guard Slice

- `npm run test:playground:mid-apply-drift` passed as a standalone local-only
  Playground REST smoke for the just-in-time per-mutation pre-write check.
- The smoke drifts one target after dry-run and after initial apply validation,
  but after that mutation's `mutation-prepared` event and before its write.
  The PHP apply path re-hashes that mutation's own target immediately before
  `reprint_push_apply_resource()`, returns `412 PRECONDITION_FAILED`, preserves
  the drifted value, writes no `mutation-applied` event for the failed mutation,
  writes no later mutations, and writes no `apply-committed`.
- DB journal evidence is hash-only: `preWriteExpectedHash`,
  `preWriteActualHash`, `preconditionCheck`, mutation metadata, recovery counts,
  and redacted recovery targets. Same key/body replay after the rejected JIT
  failure returns the rejected result with `idempotency.replayed: true` and no
  fresh mutation work; same key/different body remains
  `409 IDEMPOTENCY_KEY_CONFLICT`; recovery inspect is non-mutating.
- `npm run test:playground:plugin-atomic-install` now also verifies the
  positive `same-apply-staged` plugin activation proof and negative staged
  shortcut cases. The inactive staged plugin hash is accepted only when the
  planned plugin value is activation-style (`active: true`), an earlier
  same-apply fixture plugin file mutation already applied, and the declared
  ready atomic group covers both mutations by `mutationIds` and `resources`.
  Forged mutation-local group ids without declared coverage and planned
  inactive plugin mutations reject before activation/commit.
- `npm run test:playground:db-journal-idempotency` passed after the smoke's
  different-body concurrency request was made deterministic by waiting for the
  winning idempotency claim before sending the conflicting request. `npm test`
  still passes with 55 Node test scenarios.
- Caveats remain explicit: this is lab-scoped JIT pre-write evidence, not
  storage-level compare-and-swap, locking, production DB durability, rollback,
  production Reprint push, generic plugin/custom-table safety, or arbitrary
  production plugin install/update/activation support.

## 2026-05-24 - Status By Area

| Area | Progress | Evidence | Still pending |
| --- | ---: | --- | --- |
| Merge invariants | 35% | Planner/apply tests; [scenario matrix](scenario-matrix.md); Playground snapshot planner/apply/protocol harness in [playground topology](playground-topology.md), including allowlisted plugin-owned fixture option/postmeta handling, the exact `wp_reprint_push_forms_lab` driver through `npm run test:playground:forms-lab-table`, detection-only plugin metadata, JIT pre-write drift rejection through `npm run test:playground:mid-apply-drift`, and `npm run test:playground:plugin-atomic-install` fixture plugin install atomicity/staged-proof evidence | SQL/file mutation semantics beyond the fixture harness, live-site mutation checks, storage-level CAS/locking, production plugin semantics |
| Recovery boundaries | 22% | In-memory applicator evidence; Playground lab fail-after-2 inspection through `npm run test:playground:recovery`; JSON-model file-backed JSONL journal through `npm run test:recovery:file-journal` with per-append `fsync` evidence, `blocked-recovery` at `2 new`/`6 old`, retry refusal, no-op completed replay, and drift detection; fixture-scoped DB apply journal events in `wp_reprint_push_lab_push_journal`; local Playground DB-only process-kill recovery block through `npm run test:playground:db-journal-process-kill`; DB-only missing-commit finalization through `npm run test:playground:db-journal-missing-commit-finalization`; rejected JIT replay with no fresh mutation work through `npm run test:playground:mid-apply-drift` | Production DB table journal durability, production WordPress crash-boundary proof, storage-level `fsync`, all-old stale-claim safe retry, auto-repair policy |
| Reliable executor and protocol | 22% | [protocol](protocol.md), [executor](executor.md), protocol fixtures, Playground snapshot extraction, guarded Playground apply, fixture-scoped Playground protocol smoke, standalone local-only REST lab harness, authenticated local Playground source-site mutation slice under `/authenticated/*`, DB idempotency harness requiring `X-Reprint-Push-Idempotency-Key`, and per-mutation pre-write hash evidence | Production Reprint protocol extension, production Reprint auth/HMAC/TLS/session/nonce proof, real exporter credential binding, real WordPress mutation executor, remote audit records, storage-level compare-and-swap/locking |
| Fast path and chunking | 12% | [fast paths](fast-paths.md) and [performance model tests](../test/performance-model.test.js) | Real transfer benchmarks, streaming implementation, large-site runtime evidence |
| Independent evidence and critique | 25% | [objective audit](../audits/objective-audit.md), [critic audit](../audits/critic.md), [source notes](source-notes.md) | External audit of live integration behavior |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress executor: pending until a source site is mutated through the
  intended production protocol and verified after apply. The current Playground
  protocol smoke is a fixture-scoped lab endpoint only.
- Durable production recovery journal: pending until a production DB table
  journal or equivalent source-site artifact survives process failure and
  classifies the target as old, new, or blocked across WordPress write
  boundaries. The current JSONL lab slice has per-append `fsync` evidence and
  restart-style classification, the Playground fail-after lab slice classifies
  old/new/blocked-recovery after injected PHP failure, the DB idempotency slice
  records fixture-scoped apply/replay/conflict events and concurrent duplicate
  first-apply behavior in `wp_reprint_push_lab_push_journal`, and the
  process-kill smoke proves local Playground opened/started rows survive
  `SIGKILL`/restart without false commit while DB planned evidence plus live
  hashes returns `RECOVERY_BLOCKED`. The missing-commit finalization smoke
  proves `BATCH_RECOVERY_FINALIZED` for same key/body when all live target
  hashes already match planned after hashes and `apply-committed` is missing.
  The JIT drift smoke proves a mid-apply `PRECONDITION_FAILED` rejection is
  replayed without fresh mutation work rather than finalized as a commit.
  This still does not prove production durability, storage `fsync`, rollback,
  exactly-once production writes, arbitrary plugin data safety, full
  MySQL/InnoDB behavior, all-old stale-claim safe retry, or production repair.
- WordPress integration: Playground base/local/remote fixtures now smoke-test,
  export planner snapshots, run guarded apply into a fresh Playground source,
  exercise a lab-only fixture protocol endpoint with WordPress-visible readback,
  verify a standalone local-only REST lab namespace over real HTTP, and verify
  authenticated local Playground source-site mutation under `/authenticated/*`
  with auth-bound receipts, `manage_options`, idempotency, stale refusal, and
  fresh authenticated snapshot readback. The mid-apply drift smoke verifies
  per-mutation pre-write target rehashing in the lab apply path. The fixture
  plugin install atomicity
  smoke adds hard-coded Playground evidence for exact allowlisted fixture plugin
  file/resource writes, dependency/dependent activation in one atomic group,
  row-only bypass rejection, forged ready-plan rejection, stale dependency
  evidence rejection, staged-plugin proof negatives, and blocked recovery
  classification after publish or activation failure. Production push behavior
  remains pending until mutations
  flow through the intended production source endpoint with production Reprint
  auth, HMAC/TLS/session/nonce handling, real exporter credential binding, and
  durable production audit/recovery records.
- Plugin validators or drivers: pending until plugin-specific semantics are
  implemented and tested against real plugin-owned data. Current evidence is
  limited to allowlisted fixture option/postmeta apply, the exact
  `wp_reprint_push_forms_lab` driver `fixture-forms-lab-table`, detection-only
  plugin metadata export, and hard-coded fixture plugin install atomicity. The
  forms lab driver is owner `forms`, positive `id:N`, explicit policy,
  unchanged active `reprint-push-forms-fixture` evidence, precondition hashes,
  exact PHP table/column/payload validation, delete blocked, idempotent replay
  with zero fresh mutation work, and redacted hash-only journal/recovery
  evidence. The staged plugin proof is limited to activation-style fixture
  plugin mutations with declared ready atomic-group coverage and earlier
  same-apply file evidence. It is not arbitrary production plugin
  installation/update, activation, rollback, generic custom-table driver, or
  plugin-owned data safety proof.
