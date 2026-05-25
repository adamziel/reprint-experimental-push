# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-25 - Current Supervisor Snapshot

- Last update: 2026-05-25 09:54:02 CEST.
- Status: blocked; the visible page, log, and latest audit note still agree.
- Trend: no release-state change; the newest supervisor note only keeps the gate explicit while integration still lacks the real-site command.
- Supervision: 8 fast/low worker lanes plus the dedicated live progress watcher remain active.
- Blocker: auth/session, durable journal writes, leases/fencing, graph identity, integration, and plugin drivers remain unproven.
- Visible page: [progress.html](../progress.html) stays compact and keeps the proof trail linked.
- Pending proof gates: auth/session, durable journal writes, leases/fencing, graph identity, integration, and plugin drivers.
- Next nudge: integration owns the next real-site release command; invariants/recovery should align to that same command, and reliable-executor should keep the gate bound to a real URL/topology.
- Public page: [progress.html](../progress.html) carries the visible update date and proof links. This lane-local copy reaches GitHub Pages only after merge to `main`; the deployed copy lags until then.
- Audit note: [audits/supervisor-note-20260525-095321.md](../audits/supervisor-note-20260525-095321.md) captures the newest scan pass; the release state still does not move.

## 2026-05-25 - Supervisor Follow-up

- Last update: 2026-05-25 05:23:41 CEST.
- Status: still blocked; no production evidence delta landed in this pass.
- Trend: the surfaces are cleaner, but the proof gaps are unchanged.
- Supervision: keep the next pass narrow and evidence-driven.
- Blocker: auth/session, durable journal writes, leases/fencing, WordPress graph identity, Playground integration, and plugin drivers are still missing proof.
- Visible page: [progress.html](../progress.html) remains scan-first and keeps the detailed trail in linked docs.
- Pending proof gates: one gap at a time, starting with auth/session or crash-safe journal evidence.
- Next nudge: do not expand scope until one lane can show a concrete production-backed check.
- Public page: [progress.html](../progress.html) still reaches GitHub Pages only after merge to `main`; the deployed copy lags until then.

<details>
<summary>Earlier progress entries</summary>

## 2026-05-24 - Integrated Feedback And Verification Refresh

- Integrated the feedback supervisor progress refresh into `main`.
  [progress.html](../progress.html) now shows a visible "Last updated:
  May 24, 2026" marker, a short supervisor feedback panel, and concise lane
  summaries.
- Fresh post-merge verification passed: `npm test` reported `64` Node scenarios,
  and the no-server Playground, authenticated CLI/HTTP push, file-journal
  recovery, storage-guarded DB/file write, DB process-kill, missing-commit
  finalization, stale-claim retry, forms table, and plugin atomic-install smokes
  all passed.
- Production readiness is unchanged. The next useful proof is still a
  production-shaped Reprint endpoint/auth/audit/recovery contract.

## 2026-05-24 - Progress Publisher Verification Refresh

- `npm test` passed in the integrated tree with `64` Node scenarios. Evidence:
  [package.json](../package.json),
  [test/push-planner.test.js](../test/push-planner.test.js),
  [test/recovery-journal.test.js](../test/recovery-journal.test.js), and
  [test/performance-model.test.js](../test/performance-model.test.js).
- `npm run test:playground` passed in this lane. Its three no-server
  Playground legs verified snapshot planning, guarded apply, and fixture
  protocol behavior. The plan leg reported the expected row, file, and
  plugin-data conflict classes; the apply leg verified eight fixture mutations;
  the protocol leg verified dry-run receipts, receipt mismatch refusal, stale
  precondition refusal, and conflict refusal. Evidence:
  [docs/playground-topology.md](playground-topology.md),
  [scripts/playground/plan-from-blueprints.mjs](../scripts/playground/plan-from-blueprints.mjs),
  [scripts/playground/apply-ready-plan.mjs](../scripts/playground/apply-ready-plan.mjs), and
  [scripts/playground/push-protocol-smoke.mjs](../scripts/playground/push-protocol-smoke.mjs).
- [progress.html](../progress.html) now separates the currently verified slice
  from linked standalone local-server lab evidence. It keeps percentages flat
  because the production gates did not move in this pass.
- Explicit pending gates remain: real WordPress push executor, production
  recovery journal, Docker/full Playground integration beyond disposable
  fixtures, and arbitrary plugin drivers. Current Playground proof is useful
  fixture evidence, not a production executor or recovery claim.

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
  MySQL/InnoDB behavior. Tests mostly count mutation evidence rows rather than
  deeply asserting every observed hash, and production auth, live source
  mutation, and full push remain pending.

## 2026-05-24 - DB Journal All-Old Stale-Claim Retry Smoke

- `npm run test:playground:db-journal-stale-claim-all-old` passed as a
  local-only Playground SQLite/host-mount lab smoke for deterministic all-old
  stale-claim safe retry.
- The first lab hook writes `idempotency-opened`, `apply-started`, and
  `stale-claim-abandoned`, then returns
  `LAB_SIMULATED_STALE_CLAIM_ALL_OLD` with no mutation rows, no terminal row,
  and no target mutation.
- Same idempotency key with a different body still returns
  `409 IDEMPOTENCY_KEY_CONFLICT` before retry work.
- Exact same key/body retry requires abandonment evidence tied to the started
  row being retried, validated started targets, zero mutation evidence, and all
  live target hashes at old values. It then appends the derived unique
  `stale-claim-retry-started`, performs exactly one fresh mutation set,
  commits, and later replays as `BATCH_ALREADY_COMMITTED`.
- The smoke also proves the derived retry-claim guard: when that retry claim
  already exists before retry `apply-started` or mutation, a later exact retry
  returns `IDEMPOTENCY_KEY_IN_PROGRESS` and does not mutate.
- The retry-start negative proves a retry `apply-started` without matching
  abandonment evidence blocks with `RECOVERY_BLOCKED` instead of reusing older
  abandonment evidence.
- Residual risks remain explicit: this is lab evidence only, not production
  DB durability, storage `fsync`, rollback, exactly-once production writes,
  MySQL/InnoDB behavior, cross-process/shared-DB lock proof, stale-claim
  leases/fencing/claim expiry, arbitrary production repair, or production retry
  policy.

## 2026-05-24 - Supervisor Feedback Loop And Concise Progress Page

- Added a dedicated `feedback-supervisor` lane and
  `scripts/supervision/start-feedback-session.sh` so a separate session can
  keep nudging the supervisor on what is going well, what is not, progress
  deltas, and the next proof gap.
- Added [supervisor feedback](supervisor-feedback.md) with a dated short status
  entry. The current nudge is to prioritize a production-shaped source-site
  mutation slice: authenticated dry-run, one guarded DB row, one guarded file,
  DB journal, replay, and conflict refusal.
- Updated [progress.html](../progress.html) to show a prominent visible
  "Last updated: May 24, 2026" marker and to move detailed proof text into
  linked Markdown docs. The page now has a short supervisor feedback panel and
  shorter lane summaries.
- This is a visibility/process improvement only. It does not change the core
  production proof status: production Reprint HTTP mutation, production auth,
  durable production journal, and arbitrary plugin data safety are still
  pending.

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
  now passes with 64 Node test scenarios.
- Caveats remain explicit: this is lab-scoped JIT pre-write evidence, not
  storage-level compare-and-swap, locking, production DB durability, rollback,
  production Reprint push, generic plugin/custom-table safety, or arbitrary
  production plugin install/update/activation support.

## 2026-05-24 - Storage-Boundary Guarded DB Update Slice

- `npm run test:playground:storage-guarded-db-write` passed as a standalone
  local-only Playground/SQLite smoke for fixture-scoped update-only guarded DB
  row writes.
- The existing JIT pre-write resource hash still runs first. After it passes,
  supported update mutations use one guarded
  `$wpdb->query($wpdb->prepare(...))` SQL `UPDATE` with `WHERE` predicates over
  the expected storage representation observed after JIT.
- Positive coverage exists for existing fixture `wp_posts` rows, allowlisted
  `wp_options` rows, allowlisted single-row `wp_postmeta` rows, and exact
  positive-id `wp_reprint_push_forms_lab` fixture rows.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary, driver, logical table, physical table, operation,
  compared column names, expected resource hash, expected storage hash, rows
  affected, outcome, and SQL shape hash. It does not include raw SQL values,
  post content, option values, meta values, forms payloads, snapshots, or
  plugin payloads.
- Drift after JIT but before SQL fails closed with
  `PRECONDITION_FAILED`, including value drift for each supported table,
  marker-empty ownership drift for posts/postmeta parents, and absent/delete
  drift. The drifted target is preserved, the guarded write reports rows
  affected `0` and outcome `stale-at-write`, no `mutation-applied` is written
  for the failed target, no later mutations run, and no `apply-committed` is
  written.
- Same key/body replay after a storage-boundary rejection is non-mutating with
  no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`. Failure/recovery evidence keeps the JIT proof
  (`preWriteActualHash === expectedHash`) while using the fresh post-failure
  current hash for actual/observed/recovery state.
- Caveats remain explicit: this is local Playground/SQLite fixture evidence
  only. It is not production DB durability, production Reprint HTTP mutation,
  generic MySQL/InnoDB CAS proof, transactions, locking, rollback,
  inserts/deletes/files/plugin activation storage guarding, arbitrary
  plugin/custom-table semantic safety, or a production crash/fsync proof.

## 2026-05-24 - Storage-Boundary Guarded Fixture File Write Slice

- `npm run test:playground:storage-guarded-file-write` passed as a standalone
  local-only Playground smoke for fixture-scoped upload file update, create,
  and delete writes.
- The existing JIT pre-write resource hash still runs first. In the standalone
  smoke, fixture upload-file update/create mutations compare live file
  bytes/hash against the storage value observed after JIT, write planned
  content to a temp file in the same directory, and rename after the boundary
  comparison. Fixture upload-file deletes compare the same storage value before
  unlinking.
- Positive coverage exists for an existing fixture upload file update, a
  fixture upload file create, and a fixture upload file delete with
  `storageGuard` outcome `applied`. The code path also supports named fixture
  plugin file update paths, but this standalone smoke exercises upload-file
  update/create/delete only.
- Drift after JIT but before update, create, or delete fails closed with
  `PRECONDITION_FAILED`. The drifted file state is preserved, no
  `mutation-applied` is written for the failed file, no later mutations run,
  and no `apply-committed` is written.
- Same key/body replay after a storage-boundary file rejection is non-mutating
  with no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary `filesystem-compare-rename` for update/create or
  `filesystem-compare-unlink` for delete, driver, operation, logical fixture
  path, compared fields, expected resource/storage hashes, actual/planned
  storage hashes, physical path hash, and outcome. It does not expose raw file
  contents or absolute host paths.
- Caveats remain explicit: this is local Playground fixture evidence only. It
  is not production filesystem durability, storage `fsync`, a production
  filesystem CAS/lock, rollback, arbitrary file guarding, production Reprint
  HTTP mutation, generic WordPress filesystem safety proof, or a production
  crash proof.

## 2026-05-24 - Authenticated CLI Push Smoke

- `npm run test:playground:authenticated-cli-push` passed as a standalone
  local-only Playground smoke for the `reprint-push-lab push-authenticated`
  command.
- The command fetches a source snapshot over the authenticated lab REST route,
  builds the three-way push plan from `base` and `local` snapshot files, signs
  preflight/dry-run/apply requests, and applies with an idempotency key.
- Positive proof covers a non-mutating dry-run, then an apply of the eight
  current fixture mutations with DB journal `apply-committed` evidence and a
  final source snapshot matching the local fixture surface.
- Negative proof covers a changed source site: the CLI reports
  `PLAN_NOT_READY_LOCALLY` with conflict evidence and does not call dry-run or
  apply.
- Live-source drift proof covers the source changing after the CLI fetches its
  snapshot but before dry-run. A lab-only post-snapshot drift hook changes a
  fixture post title; the CLI-built plan is locally `ready`, authenticated
  dry-run returns `412 PRECONDITION_FAILED`, apply is not called, and the
  concurrent source change is preserved.
- The authenticated CLI client now retries transient socket failures only for
  unsigned read-only GET routes without side-effect lab query parameters and
  sends `Connection: close`; signed requests remain single-shot so nonce replay
  protections are not weakened.
- Caveat: this makes the lab source-site flow usable from the CLI, but it still
  targets the lab endpoint. It is not a production Reprint endpoint, production
  credential binding, or production durability proof.

## 2026-05-24 - Supervisor Feedback Refresh

- The feedback supervisor lane pushed
  `origin/lane/feedback-supervisor` with a refreshed dated status entry,
  concise blocked-by-evidence language, and audit links.
- The main progress page keeps the same linked evidence trail:
  reliable executor moved up in the lab, while production endpoint/auth/journal
  claims remain blocked.
- The current pass kept the visible progress page aligned with the log, but it
  did not add new production evidence. The page still stays scan-only and
  becomes live only after merge to `main`.

## 2026-05-24 - Supervisor Evidence Checkpoint

- The current checkpoint found no newer merged executable evidence after the
  authenticated CLI push smoke and feedback refresh. The visible trend is
  flat, not a readiness increase.
- [progress.html](../progress.html) keeps the current status to a concise
  one-screen summary with a visible May 25, 2026 update date and links to the
  detailed evidence instead of embedding long audit text.
- [supervisor feedback](supervisor-feedback.md) now names the next nudge per
  lane: production-shaped Reprint endpoint/auth/audit proof for reliable
  executor, WordPress graph identity for invariants, production crash-boundary
  durability for recovery, real plugin validator coverage for plugin data,
  executable chunking benchmarks for fast paths, and live-integration re-audit
  for audit lanes.
- Production readiness is unchanged. The repository still lacks a production
  Reprint source-site mutation endpoint, production credential binding,
  nonce/session cleanup proof, durable production audit/recovery records,
  production filesystem/DB durability proof, and arbitrary plugin data safety.

## 2026-05-24 - Status By Area

| Area | Progress | What changed | Next proof |
| --- | ---: | --- | --- |
| Merge invariants | 42% | Planner/apply tests, Playground snapshots, fixture plugin/data checks, unsafe topology mutation suppression, stale owner-plugin context blocking, JIT drift refusal, and storage-boundary DB/file guards are passing. | Production resource identity, semantic preservation, and storage-level guards over real WordPress data. |
| Recovery boundaries | 27% | DB journal idempotency, process-kill, missing-commit finalization, all-old stale-claim retry, durable old-remote retry evidence, durable replay envelopes, journal-write failure recovery artifacts, and stale-at-write refusal are lab/model-proved. | Production DB journal durability, `fsync`/locking/leases/fencing, and crash-boundary behavior. |
| Reliable executor and protocol | 40% | Lab preflight, dry-run receipts, signed auth routes, idempotency, replay, conflict refusal, hash-only guard evidence, authenticated CLI push, post-snapshot drift refusal, production transport binding docs, production-shaped route smoke, packaged-plugin route activation, and signed session/nonce cleanup evidence exist. | Production auth/TLS/session/nonce lifecycle, real exporter credentials, durable audit records, leases/fencing, and arbitrary plugin drivers. |
| Fast path and chunking | 17% | Performance model now records safe fast-path proof obligations for each speedup area, plus staged chunks, group finalization, idempotency, missing receipts, pressure budgets, and rejected unsafe shortcuts. | Transfer benchmarks, streaming/chunking implementation, and large-site runtime evidence. |
| Independent evidence and critique | 30% | Objective audit, critic production gate, source notes, and supervisor feedback were refreshed against the production-shaped/package evidence. | External review against live integration behavior. |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress push executor: still pending. A real source site must be
  mutated through the intended production-shaped Reprint protocol and verified
  after apply, with persisted executor state and no lab-only route assumptions.
- Production recovery journal: still pending. Lab JSONL/DB journals prove
  useful slices, but not production DB durability, `fsync`, locks, leases,
  rollback, or exactly-once writes.
- Docker/full Playground integration: still pending. No-server and localhost
  Playground fixtures prove useful WordPress-facing behavior, but Docker is
  unavailable in this sandbox and the full integration path is not production
  proof.
- Plugin drivers: still pending. Current safety is limited to allowlisted
  fixture data, one forms custom-table driver, detection-only plugin metadata,
  and hard-coded fixture plugin install atomicity; arbitrary plugin-owned
  options, postmeta, custom tables, activation hooks, and rollback are not
  solved.

</details>
