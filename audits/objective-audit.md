# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

Derived release requirements from the objective:

1. One-way pull from the base, then one-way push back to the live source.
2. No silent data loss across the live WordPress graph, including related and plugin-owned data.
3. Recovery that survives crashes, retries, replay, stale claims, duplicate requests, and mid-apply restarts without dropping, duplicating, or reordering writes.
4. Auth, session, lease, fencing, durable journal, storage, graph-identity, and plugin-data-driver checks enforced at the release boundary.
5. Evidence for the real remote/local topology, not only lab-backed or fixture-scoped route shapes.
6. A measured, documented speed claim, or an explicit refusal to make one.
7. One required release command that fails closed if any safety gate still reports `labBacked: true`, fixture-only scope, or missing live-source evidence.

Release interpretation:

- The objective requires proof at the live-source push boundary, not just proof that the planner or lab smokes are conservative.
- Indirect evidence is useful only when it points to a concrete executable check; it is not itself a release pass.
- A claim is not releasable if the best available evidence is still fixture-scoped, lab-backed, or opt-in only.

The repository now has meaningful lab evidence: three-way JSON snapshot
planning, fixture-scoped Playground apply paths, authenticated local Playground
routes, DB journal/idempotency slices, process-kill and stale-claim smokes,
narrow storage-boundary guards for selected fixture DB rows and upload files,
and a production-shaped `/wp-json/reprint/v1/push/*` route mounted through a
temporary plugin package. That route still reports `labBacked: true`. This is
good negative evidence, but it is still not direct proof for the objective:
pushing local edits back to a live source WordPress site without losing
concurrent source changes, while remaining reliable and fast.

The weakest current claim is still speed, but the more important release
blocker is structural: the repository still lacks one enforced release gate
that runs the auth/session, durable journal, storage, graph identity,
plugin-data-driver, real remote/local topology, crash-boundary, recovery, and
benchmark checks in a single required command and fails closed when any of
them are still fixture-scoped or lab-backed. The benchmark code already
refuses an unsupported throughput claim by listing blockers such as missing
durable chunk receipts, missing live remote preconditions, missing durable
journal integrity, missing graph-identity evidence, missing recovery evidence,
and non-production storage or row-apply capabilities. That is useful refusal
logic, but it is still only refusal logic: it does not measure a production-
shaped runtime or memory ceiling, and it cannot substitute for a required
release command. `npm test` and `npm run test:playground` remain green even
when the strongest checks are skipped, so the repo can look healthy while the
objective remains unproven. The current test story is therefore strongest as a
blocker generator, not as release-grade proof of no data loss, reliability, or
speed.
The next actionable gap is a required `verify:release`-style command, wired
into CI or an equivalent enforced entrypoint, that fails closed on
`labBacked: true`, fixture-only scope, missing live-topology evidence, or an
unmeasured speed claim instead of leaving those checks as optional scripts.
Until that command exists, the honest speed statement is "speed is unproven
and should not be claimed."

The more actionable blocker is the live-source no-data-loss claim. It still
needs a crash matrix that covers every guarded write boundary with before and
after state plus journal evidence. Until the repo can show DB row
update/insert/delete, file create/update/delete, plugin activation or package
publish, finalization or commit write, replay after restart or duplicate
request, and stale claim or lease expiry on the production-backed path, the
no-data-loss claim remains blocked even if the model and fixtures keep
passing.

The current test story also fails a simpler release-bar test: the repository
does not define one required release command that chains the stronger checks.
`package.json` exposes `npm test`, the bundled lab chain `npm run test:playground`,
and a set of opt-in smokes such as `test:playground:authenticated-http-push`,
`test:playground:db-journal-idempotency`, `test:playground:storage-guarded-db-write`,
`test:playground:storage-guarded-file-write`, `test:playground:production-shaped-push`,
and `test:playground:production-plugin-package`. Those commands are evidence
sources, not a release gate. A green default run can still omit auth/session,
durable journal, lease/fencing, graph-identity, plugin-data-driver, real
topology, crash-boundary, and benchmark evidence. The missing artifact is not
another optional smoke. It is a required gate that fails closed unless those
checks all run in the same release path.

The honest release claim is narrower: this repository is an executable safety
model and local Playground lab for push invariants. It does **not** yet prove
production no-data-loss, production reliability, or measured speed.
It also does not yet have one enforced release gate that makes those claims
non-optional before a public or production push, so the release bar is still
procedural rather than enforced.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof.

Design docs, model tests, and fixture smokes are useful, but they are indirect
for production claims unless they exercise the same authentication, storage,
journal, crash, concurrency, and WordPress data semantics that production will
depend on. A test that proves a local Playground fixture row is guarded does
not prove arbitrary MySQL/InnoDB rows are guarded. A test that proves a JSON
object is not mutated does not prove a source site can recover after a process
dies between file and database writes.

For this audit, indirect evidence also includes planner-only coverage,
fixture-scoped Playground smokes, route-shape tests that still run a lab-backed
implementation, benchmark models that do not measure wall-clock throughput or
memory, and README claims that are stronger than the executed proof.

## Evidence Ledger Rules

Every requirement below is tracked in four buckets:

- `Executable proof` means the test or command exercises the claimed behavior
  directly.
- `Lab/fixture proof` means the check is useful but still scoped to fixtures,
  local Playground, or a temporary package route.
- `Docs-only proof` means the claim appears in prose, script names, or
  diagrams, but not in a required executable gate.
- `Release blocker` means the objective still fails closed until stronger
  proof exists.

## Follow-up Audit Pass

This pass treats docs and script names as leads, not proof. Fresh local
verification on 2026-05-25:

- `npm test` passed with 89 tests, 0 failures, and 0 skips.
- `npm run test:playground:production-shaped-push` is a stronger route smoke,
  but it is still lab-backed by design and therefore remains evidence, not a
  release gate.
- `npm run test:playground:production-shaped-push` passed against
  `/wp-json/reprint/v1/push/*`, reported `labBacked: true`, applied 7 fixture
  mutations, replayed with zero fresh mutation work, rejected cross-route
  receipts before mutation, and classified recovery as `fully-updated-remote`.
- `npm run test:playground:production-plugin-package` passed with the temporary
  `reprint-push` plugin mounted as a normal plugin, the public lab namespace
  disabled, 8 fixture mutations applied, and the final visible fixture surface
  matching local.

A release claim still needs retained run artifacts for the full long smoke set
and, more importantly, proof at the production-backed Reprint source-mutation
boundary.
Without that boundary proof, the current test suite cannot support a claim of
no data loss, reliability, or speed for a live source WordPress push.

The default suite passed locally on 2026-05-25, but it is still mostly model
proof plus fixture-scoped lab evidence. Passing it does not close the
production release gap. The strongest available proofs are split across
separate entrypoints, and that split is itself part of the problem:

- Executable default proof: `npm test`
- Light Playground chain: `npm run test:playground`
- Stronger manual opt-ins: authenticated HTTP/CLI, DB journal, storage guard,
  process-kill recovery, stale-claim recovery, plugin atomicity, production-
  shaped route/package, mid-apply drift, and benchmark smokes

The unresolved release issue is not the absence of interesting tests. It is the
absence of one enforced command that composes the strongest checks and fails
closed when any required proof remains lab-backed, fixture-scoped, or missing.
That missing command is a procedural blocker even if every optional smoke stays
green.

## Test Audit

The current tests are strongest where they reject unsafe claims, and weakest
where they are asked to prove production release safety.

- `npm test` proves the model and selected fixture logic are internally
  consistent. It does not prove live source mutation, production storage, or a
  live WordPress graph.
- `npm run test:playground` proves a bundled lab path through plan/apply/push
  protocol. It does not invoke the stronger auth, journal, storage, recovery,
  plugin, graph, or benchmark gates.
- `npm run test:playground:production-shaped-push` and
  `npm run test:playground:production-plugin-package` prove route shape and
  packaging behavior. They still report `labBacked: true`, so they are
  explicitly not production proof.
- `scripts/bench/guarded-executor-benchmark.js` proves the benchmark can block
  unsupported throughput claims. It does not itself measure a live push path,
  set a required threshold, or enforce a release decision unless the claim
  gate is explicitly invoked. That makes it a refusal test, not speed proof.

That splits the suite into three evidence classes:

- `Executable proof` for model invariants, selected fixture guards, and
  refusal logic.
- `Lab/fixture proof` for local Playground routes, journal behavior, and
  production-shaped lab packaging.
- `Release blocker` for every live-source claim that still depends on a manual
  script bundle instead of one enforced gate.

The practical consequence is that the suite is good at proving "do not claim
release yet." It is not yet good enough to prove "release is safe."

That split matters because a green default run still does not mean the release
gates were exercised.

| Area | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| No-overwrite planner | Executable proof: unit tests cover unchanged remote mutations, remote-only preservation, deletion behind preconditions, delete/update conflict, directory deletion that would hide a remote-only descendant, file type swap that would hide a remote-only descendant, matching independent edits, plugin dependency drift, stale precondition refusal, and redacted plugin-data conflict evidence. Lab/fixture proof: the Playground and route smokes exercise the same planner shape against fixtures. Docs-only proof: README and audit text describe graph safety intentions. | These proofs are still mostly JSON-model resources plus fixture policy, not WordPress graph semantics. They do not prove post/postmeta/attachment/taxonomy/menu/plugin relationships are complete, nor do they prove arbitrary plugin-owned data is safe. | Add one real WordPress graph fixture where local and remote edit different related resources, then prove the planner blocks or preserves every relationship explicitly. |
| Recovery and idempotency | Executable proof: unit tests cover JSONL journal creation, monotonic sequences, per-record `fsync` evidence, old/new/blocked classification, corrupt/truncated journal blocking, missing-target blocking, completed replay, journal envelope mismatch, and partial remote mutation as blocked recovery. Lab/fixture proof: Playground smokes cover DB journal, same-key replay, conflict refusal, process kill, missing-commit finalization, and all-old stale-claim retry. Lab/fixture proof: the production-shaped route smoke proves committed replay and recovery inspect for the fixture route profile. Docs-only proof: script names and comments describe durability intent. | JSONL recovery is still a model. Playground DB recovery is fixture-scoped local storage evidence. The production-shaped route is still lab-backed. None of this proves production MySQL/InnoDB, filesystem durability, leases/fencing, rollback, or every WordPress write boundary. The current suite can demonstrate blocked recovery states, but it does not prove that a live source site survives crash/retry cycles without data loss or duplicate mutation at each guarded boundary. | Kill the production-backed executor at every guarded DB/file/plugin boundary and retain DB journal plus live hash evidence for old/new/blocked classification. |
| Speed | Executable proof: `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a deterministic model for chunk staging, bounded DB batches, preconditions, atomic group visibility, backpressure, and benchmark evidence gates. Lab/fixture proof: the benchmark harness can express production-claim blockers and currently refuses a throughput claim when the required evidence is missing. Docs-only proof: scripts and audit text explain why the claim is blocked. | No bytes move in a production executor, no live source site is mutated, and no benchmark runs against the real push path or a production-shaped substitute with measured runtime and memory ceilings. The current benchmark can only prove that unsupported speed claims are rejected; it cannot prove that the path is fast or production-scaled. Until that measured runtime is wired into one required release command, speed remains a blocked release claim rather than a supported production fact. | Run a large-file and large-table benchmark through the executor with durable chunk receipts, live remote preconditions, journal cursors, retries, measured runtime and memory, and an explicit pass/fail threshold tied to the production push path. |

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source
site after a pull, while that source may still be live and may have changed.
The pull base is one-way and the push back to the source is one-way. The
priorities are no data loss, reliable, and fast. That implies
these release requirements:

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete one-way pull base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, protocol metadata, and enough scope evidence to prove what was and was not scanned. |
| R2 | Read the current live remote state before planning and compare base, local, and remote in a three-way plan before any one-way push back to the live source. |
| R3 | Preserve remote-only changes by default, including deletes, plugin state, files, rows, and related resources. |
| R4 | Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect and replay against the same pull base. |
| R5 | Apply every mutation only behind a live precondition that is rechecked immediately before the write and again after any staging boundary that can change the target. |
| R6 | Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every production DB and filesystem mutation. |
| R7 | Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. Never report success for a split plugin/application state. |
| R8 | Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless an explicit validator or semantic driver proves the mutation and its ownership scope. |
| R9 | Authenticate and authorize source-site mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests. |
| R10 | Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state and cannot rely on dry-run receipts as locks. |
| R11 | Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery, and retain enough boundary evidence to explain every partially applied write. |
| R12 | Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries. |
| R13 | Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope. |
| R14 | Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts. |
| R15 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard, with explicit runtime and memory targets, a documented measurement environment, and a release threshold that cannot be skipped by accident. A model that only refuses unsupported claims is not enough. |
| R16 | Provide one enforced release gate that runs the safety, recovery, auth/session, storage, plugin-data-driver, graph-identity, real topology, crash-boundary, and performance checks in a required order before any public or production claim is allowed. Optional helper scripts are not enough, and a green default suite is not a substitute. A release path that requires manual script assembly, or that is not wired into CI or another enforced entrypoint, is still not a release gate. |

The most important release requirement is not one individual check; it is the
end-to-end enforcement of the full safety matrix before any live-source push is
allowed. Without that, the remaining proof stays advisory, even when several
individual smokes pass. The repo currently does not enforce that matrix, so
the release blocker is a missing required gate, not just a missing test case.

### Claim Audit

| Claim | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| No data loss | The repo proves selected planner rules, fixture-scoped protected writes, replay refusal, and a production-shaped lab route that still reports `labBacked: true`. | It does not prove a live WordPress graph survives a failed push without losing or duplicating posts, postmeta, attachments, taxonomy links, menus, users, plugin-owned rows, or serialized plugin payloads. | Missing live crash coverage at every guarded DB/file/plugin boundary. |
| Reliability | The repo proves some journal, replay, stale-claim, and process-kill states are classified and blocked in local Playground fixtures. | It does not prove restart safety, leases, fencing, rollback, or exactly-once behavior on a live source site across all mutation types. | Missing production-backed kill matrix plus durable journal evidence. |
| Speed | The repo proves benchmark guards and model checks exist, and the benchmark harness fails closed on unsupported throughput claims. | It does not measure throughput or memory on a production-shaped executor or on a production-backed push path, so it cannot support a release claim that the path is fast. | Missing measured end-to-end benchmark on the real push path with a release threshold. |
| Release gate | The repo has many targeted smoke scripts, and some docs describe a desired release sequence. | It does not have one required command that chains auth/session, durable journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and performance checks and fails closed when any one is still lab-backed or fixture-scoped. | Missing enforced release gate. |
## Evidence Table

Evidence classes used below:

- `Executable proof`: runs at the claimed boundary and fails closed when the invariant is broken.
- `Lab/fixture proof`: useful, but only for disposable fixtures, local routes, or Playground storage.
- `Docs-only proof`: naming, diagrams, or README claims that do not execute the production path.
- `Missing proof`: the claim is not yet exercised at the required boundary.
- `Release blocker`: the missing proof prevents a production release claim.

| Req | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | Executable proof: the JSON model carries base/local/remote snapshots with stable resource keys and hashes. Lab/fixture proof: Playground exporters produce fixture snapshots for posts, options, files, postmeta, a forms lab table, and narrow plugin metadata. | No production Reprint pull-base manifest contract. No proof for complete WordPress identity mapping, table schemas, generated data, object cache state, media metadata, taxonomies, users, multisite, or arbitrary plugin ownership. | Yes |
| R2 one-way planning | Executable proof: `createPushPlan()` compares base/local/remote hashes and `npm test` covers local-only changes, remote-only changes, matching independent edits, direct conflicts, deletes, file topology conflicts, plugin state, and atomic dependency metadata. Lab/fixture proof: the production-shaped CLI smoke plans from exported fixture snapshots and targets `/wp-json/reprint/v1/push/*`. | No production remote hash listing contract. No test starts from a real Reprint pull base and then pushes back through production-backed source mutation internals. | Yes |
| R3 preserve remote changes | Unit tests keep remote-only row and plugin changes, block local deletion versus remote update, stop local directory deletion that would hide a remote-only descendant, and stop file type swaps that would hide remote-only descendants. Playground stale apply smokes preserve fixture drift. | No proof for semantic graph preservation across posts/postmeta/attachments/terms/menus/options/plugin tables. No proof for remote changes to resources that are not directly mutated but are semantically coupled to local changes. | Yes |
| R4 conflict stop and evidence | Conflicts, blockers, hashes, change kinds, and plugin-owned conflict classes are represented. Raw fixture values are checked out of selected conflict/journal/recovery paths. | No durable production conflict artifact, operator workflow, reviewed resolution path, complete redaction schema, or production audit report. | Yes |
| R5 immediate preconditions | Executable proof: `applyPlan()` validates preconditions before model apply. Lab/fixture proof: Playground smokes verify stale dry-run/apply refusal and just-in-time pre-write hash rejection for selected fixtures. Lab/fixture proof: the production-shaped route smoke applies the same ready fixture plan through `/wp-json/reprint/v1/push/*`. | The production-shaped write path is still lab-backed. No proof that every production mutation rechecks liveness immediately before its write under real source-site concurrency, and no proof that a post-staging boundary is revalidated where the storage layer can diverge. | Yes |
| R6 storage-boundary guards | Executable proof: `test:playground:storage-guarded-db-write` proves guarded single-statement `UPDATE` behavior for existing fixture `wp_posts`, allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact forms lab rows. Lab/fixture proof: `test:playground:storage-guarded-file-write` proves guarded update/create/delete for accepted fixture upload files. Lab/fixture proof: the production-shaped route smoke carries those fixture internals behind the `/reprint/v1` route shape. | No production MySQL/InnoDB CAS proof, transactions, locks, rollback, filesystem `fsync`, filesystem lock/CAS proof, arbitrary file guarding, arbitrary create/delete DB guarding, schema changes, plugin activation guarding, or production-backed Reprint HTTP mutation. | Yes |
| R7 atomic groups | Planner tests cover dependency presence, same-group dependencies, outside-group blocking, dependency hash/version/activation checks, and forged ready-plan rejection. `test:playground:plugin-atomic-install` adds a hard-coded fixture plugin install path and failure classification. | No general plugin install/update/activation support, no production rollback, no production atomic visibility boundary across files/DB/plugin activation, and no proof for arbitrary plugin side effects. | Yes |
| R8 plugin-owned data | Unknown plugin-owned rows block. The forms fixture allows only explicit `wp-option`, `wp-postmeta`, and exact `fixture-forms-lab-table` policies with active unchanged fixture plugin evidence. Unit tests now also block plugin-owned data when the owner plugin files changed only on remote, while allowing it when the owner plugin context independently matches remote. Unsupported custom tables and direct `active_plugins` mutation remain blocked. | No production plugin validator contract, serialized PHP data parser/validator, generic custom-table driver, schema migration driver, or proof that arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 auth and authorization | Lab/fixture proof: `test:playground:authenticated-http-push` and `test:playground:authenticated-cli-push` prove authenticated local Playground aliases, Basic-auth-shaped Application Password credentials, `manage_options`, signed lab requests, nonce replay rejection, auth-bound receipts, idempotency keys, stale refusal, and replay with zero fresh mutation work. Lab/fixture proof: `test:playground:production-shaped-push` proves the same route binding shape under `/wp-json/reprint/v1/push/*`, including cross-route receipt rejection before mutation. Lab/fixture proof: `test:playground:production-plugin-package` proves the public lab namespace is disabled when the temporary plugin package is activated. | It still uses lab-backed implementation, lab signing key derivation, and a Playground fallback verifier. No production Reprint auth integration, TLS deployment, push credential scoping, nonce/replay store cleanup, session lifecycle, rate limiting, or real exporter credential binding. | Yes |
| R10 honest dry-run | Protocol smokes require receipts, reject missing/tampered receipts, bind receipts to plan/preconditions, and reject stale remote state. Authenticated lab routes bind receipts to auth/session/request data. | No production UI/operator warning tests. No proof for remote changes between production chunks or between individual production writes beyond fixture hooks, and no proof that a dry-run receipt itself is rejected as a lock substitute during production apply. | Yes for production UX and source mutation |
| R11 durable recovery | Model recovery tests classify old/updated/blocked states. JSONL journal tests append with monotonic sequences and `fsync` calls, and now block missing target records plus corrupt/truncated journals. Playground recovery, DB journal, process-kill, missing-commit finalization, stale-claim, and production-shaped route recovery-inspect smokes add useful fixture evidence. | No production DB-table journal, no storage-level crash matrix, no target write `fsync` proof, no exactly-once production writes, no production leases/fencing/claim expiry, no rollback, and no automatic repair policy. The suite still cannot show that a live source site survives a crash at every guarded boundary without losing a mutation, reordering replay, or duplicating side effects. | Yes |
| R12 idempotent resumability | DB journal smokes require `X-Reprint-Push-Idempotency-Key`, reject same-key/different-body requests, replay committed or rejected results, claim one concurrent same-key executor, finalize missing commits, and handle one all-old stale-claim retry path. Production-shaped route smoke also proves same-key replay and same-key/different-body conflict under `/reprint/v1`. | No chunk cursor, production retry contract, production duplicate first-apply test, shared-DB multi-worker proof, stale-plan invalidation across chunks, or production stale-claim lease/fencing/expiry behavior. | Yes |
| R13 real WordPress shapes | Playground fixtures exercise real WordPress-visible posts, options, files, selected postmeta, one custom table, fixture plugin metadata, and a packaged temporary plugin route under `/wp-json/reprint/v1/push/*`. Local REST smokes mutate disposable Playground source sites. | Coverage is narrow. No production-backed Reprint source mutation endpoint, no large live WordPress fixture matrix, no media attachment graph, taxonomy/menu/user/meta coverage, no arbitrary plugin tables, no multisite, no object cache/runtime side effects. | Yes |
| R14 redaction | Several unit and smoke tests assert no raw fixture strings in conflicts, journals, storage evidence, and recovery reports. DB/file storage guard evidence is hash-only. | Redaction is checked through selected fixture strings, forbidden field names, and scoped assertions. No formal allowlist schema for all future plan, journal, conflict, recovery, auth, or benchmark artifacts. | Yes for production |
| R15 speed | Executable proof: `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a deterministic model for large uploads, chunk staging, bounded DB batches, atomic visibility, parallelism limits, backpressure triggers, and benchmark evidence gates. | The benchmark still does not move bytes through a production executor, mutate a live source site, or measure a live-path runtime or memory ceiling. It is refusal evidence only. Until the claim is attached to a documented environment and a required pass/fail threshold on the real push path, speed remains unproven and should not be advertised. | Yes for any speed claim |
| R16 release suite | Executable proof: `npm test` passed with 89 tests, 0 failures, and 0 skips. Lab/fixture proof: `npm run test:playground:production-shaped-push` and `npm run test:playground:production-plugin-package` also passed when run explicitly. Docs-only proof: `package.json`, README, and topology docs list the auth, storage, journal, recovery, plugin, and benchmark entrypoints. | No CI workflow or release aggregator was found, and the repo does not define `npm run release`, `npm run verify`, or `npm run verify:release`. The only bundled release-like script is `npm run test:playground`, and it still stops after plan/apply/push-protocol. The stronger gates are not chained into any enforced command, so release evidence is still a manual assembly of optional scripts. The production-shaped smoke itself still reports `labBacked: true`, so route-shaped success is not production proof. There is no single enforced command that proves auth/session, durable journal, leases/fencing, graph identity, plugin-data-drivers, real remote/local topology, crash boundaries, safety, and performance together before release. | Yes |

### Release Gate Gap

The repository currently has optional proof commands, not an enforced release
gate. `package.json` confirms the split: the default suite is `npm test`, the
bundled lab chain is `npm run test:playground`, and the stronger auth,
journal, storage, recovery, plugin, and benchmark checks are only available
as separate opt-ins. There is no `npm run release`, `npm run verify`, or CI
workflow that chains those checks into one required release path, so a green
run can still omit the exact proof the objective needs. This is a release
blocker, not a documentation gap: until one required command exists, the
project can keep producing passing lab runs without proving production safety.
The strongest route smokes still report `labBacked: true`, which is a direct
signal that route-shaped success is not production proof. The benchmark suite
is in the same category: it can refuse unsupported throughput claims, but it
does not prove a production speed claim until that refusal gate is replaced or
supplemented by a measured end-to-end release command.

- `npm test` is the default automated suite, but it only covers the model and
  selected fixture logic.
- `npm run test:playground` is bundled, but it stops after plan/apply/protocol
  and does not invoke the stronger auth, storage, recovery, plugin, graph, or
  benchmark smokes.
- The repository does not expose a single required release command such as
  `npm run release` or `npm run verify`, and no workflow file was found to
  enforce one; the safety matrix is still assembled manually from independent
  scripts.
- The strongest checks remain opt-in entrypoints such as
  `test:playground:authenticated-http-push`,
  `test:playground:authenticated-cli-push`,
  `test:playground:db-journal-idempotency`,
  `test:playground:storage-guarded-db-write`,
  `test:playground:storage-guarded-file-write`,
  `test:playground:db-journal-process-kill`, and
  `test:playground:production-shaped-push`.
- None of the existing commands fail the release if `labBacked: true`,
  fixture-only scope, missing live-remote preconditions, missing journal
  durability, missing graph-identity evidence, or missing benchmark evidence
  are present in the strongest path.

Actionable release gate requirement:

1. Add one required command, such as `npm run verify:release`, that runs the
   auth/session, durable journal, leases/fencing, graph identity,
   plugin-data-driver, real topology, crash-boundary, and benchmark checks in
   a fixed order.
2. Make that command exit non-zero if any step reports `labBacked: true`,
   fixture-only scope, skipped live-source proof, or an unsupported throughput
   claim.
3. Wire that command into CI or the release pipeline as the only accepted
   release entrypoint, and keep the optional smokes as contributors to that
   gate rather than as substitute release evidence.
- The stronger checks are available only as separate opt-ins such as
  `npm run test:playground:authenticated-http-push`,
  `npm run test:playground:db-journal-idempotency`,
  `npm run test:playground:storage-guarded-db-write`,
  `npm run test:playground:production-shaped-push`, and
  `npm run test:playground:production-plugin-package`.
  Those commands are individually useful, but they are not chained into one
  required release command.
- There is no `npm run release`, `npm run verify`, or checked-in CI workflow
  in the repository tree that forces the full safety matrix before a push
  claim. The existing bundled entrypoint stops at
  `npm run test:playground:push-protocol`, so the auth/session, durable
  journal, storage-boundary, graph-identity, plugin-driver, real-topology,
  crash-boundary, and benchmark gates remain manual add-ons. That absence
  matters because the repo can still look healthy while the strongest proof
  remains opt-in.

Actionable release-gate requirement:

- create one required release command that runs the safety-critical auth,
  journal, storage, recovery, plugin, graph, and benchmark checks in a single
  failure path
- fail that command when any production-shaped proof still reports
  `labBacked: true`, fixture-only scope, or missing live-source evidence
- wire the same command into CI so the release bar is enforced, not merely
  documented

That means the repo can still look healthy while the exact proof needed for a
release claim has not been run. For this objective, that is a release blocker,
not a release caveat. It is also more than a documentation gap, because the
strongest checks are still split across optional commands instead of one
enforced release path.

### Test Verdict

The current tests are good at proving guardrails:

- planner rules reject unsafe overwrite and stale-state cases in the model
- local Playground smokes prove fixture-scoped auth, storage, journal, and
  route-shape behavior
- the benchmark harness refuses unsupported speed claims

They do not yet prove the release claim:

- no live source site mutation boundary is exercised end-to-end
- no production-backed crash, replay, lease, or fencing matrix is enforced
- no measured throughput or memory threshold is required before release
- no single command fails the build when those stronger checks are omitted
- no release job proves the live-source push path under crash, replay, and
  lease-fencing failure modes
- no current test proves that the live source can survive a guarded write at
  every DB/file/plugin boundary without silent loss or duplication
- no current benchmark proves throughput or memory on the real push path, so
  speed remains a blocked claim rather than a measured release fact
- no single release command in `package.json` runs the whole safety matrix in
  one required path, so the strongest evidence can still be skipped while the
  default suite stays green

Highest-value interpretation:

- no-data-loss is still inferred from fixture and model coverage, not proven
  at a live WordPress graph boundary
- reliability is still inferred from lab crash/replay examples, not proven
  across production auth, storage, lease, and fencing boundaries
- speed is still refused as an unsupported claim, not proven with a measured
  end-to-end run against the release path

Bottom line:

- `npm test` is useful executable evidence for the model and selected fixtures
- the Playground smokes are useful lab evidence for local safety checks
- neither is a release gate for the objective, because the objective needs a
  single enforced command that proves or blocks the live-source release claim
  before shipping

The uncomfortable interpretation is that the suite is currently better at
preventing false confidence than at proving live-source safety. A green run
can mean the repository still has no production-backed crash matrix, no live
lease/fencing proof, and no measured speed threshold, because the strongest
proofs remain opt-in commands rather than a required release boundary.

## Test Audit

### What The Default Tests Prove

`npm test` passed during this audit:

- 89 passing tests.
- Executable proof for planner no-overwrite invariants on simplified JSON snapshots, including
  deletion preconditions, delete/update conflicts, directory-descendant
  topology conflicts, and file type swap conflicts.
- Executable proof for plugin-owned resource blocking, stale owner-plugin context blocking, and the
  exact forms lab driver checks in the JavaScript model.
- Executable proof for atomic dependency metadata and forged-plan rejection in the model executor.
- Executable proof for JSON-model recovery journal classification, append/`fsync` calls, missing
  target blocking, and corrupt/truncated journal blocking.
- Lab/fixture proof for snapshot apply gates on named lab plugin resources, named lab plugin file paths, and exact forms lab custom-table rows when PHP is available.
- Executable proof for a deterministic performance model, not measured performance.
- Executable proof that the benchmark harness can block a production throughput
  claim when the required production evidence is absent; it still does not
  measure throughput or memory on the live push path.

This is useful evidence, but it is not production proof. It does not exercise a
production source site, a production push endpoint, real production
credentials, production DB/file durability, real concurrent WordPress traffic,
or arbitrary plugin data. It also does not prove no-data-loss at the WordPress
graph boundary: the default suite can show that selected modeled resources are
preserved, but not that a live posts/postmeta/attachment/taxonomy/plugin graph
survives a failed push without silent loss or duplication. It does not prove
reliability at the live boundary because it lacks production crash, restart,
lease, and fencing evidence. It does not prove speed because the benchmark
tests refuse unsupported claims rather than measure a production path.
In release terms, the default suite is a safety filter, not a production-safe
proof. It can justify blocking bad changes; it cannot justify shipping the
live-source no-data-loss, reliability, or speed claims by itself.

The stronger smoke commands are better, but they are still not release proof.
`npm run test:playground:production-shaped-push` and
`npm run test:playground:production-plugin-package` both exercise the
`/wp-json/reprint/v1/push/*` shape, replay behavior, and cross-route receipt
rejection, yet they still report `labBacked: true`. That means they prove
route shape and lab packaging, not production-backed auth, storage, journal,
crash, or graph safety.

`npm run test:playground` is also evidence, but it is only a partial lab chain:
it runs plan/apply/push-protocol and then stops. The stronger auth, DB journal,
storage-guard, process-kill, stale-claim, production-shaped route, plugin
package, and benchmark checks remain separate commands. A passing default suite
therefore leaves the release bar procedural instead of enforced.

Concrete limitation: the default suite can prove a planner rule such as "do not
drop a remote-only descendant when a local directory disappears" in a model, but
that is still not the same as proving arbitrary WordPress object graphs survive
production writes. The same gap applies to the DB journal and performance
tests: they are evidence for the design, not proof that live source mutation is
safe, durable, and fast.

### What The Standalone Smokes Prove

The standalone Playground smokes materially improve the lab story:

- Local REST protocol routes prove dry-run/apply receipt behavior, stale
  refusal, and journal readback for fixture resources.
- Authenticated local Playground routes prove a lab auth/signature floor,
  nonce replay rejection, auth-bound receipts, capability checks, idempotency,
  and replay semantics.
- DB journal smokes prove fixture-scoped idempotency, DB-native claiming,
  rejected replay, one process-kill blocked recovery path, missing-commit
  finalization, and an all-old stale-claim retry path.
- Storage guard smokes prove selected fixture DB row updates and accepted
  fixture upload file update/create/delete paths reject drift after the JIT
  hash check and before the storage write.
- Plugin atomic smokes prove one hard-coded fixture plugin dependency/install
  shape, selected forged-plan negatives, replay behavior, and failure
  classification.
- Forms lab smokes prove one exact fixture custom-table semantic driver.
- Production-shaped route/package smokes prove that the fixture implementation
  can be reached through `/wp-json/reprint/v1/push/*`, that cross-route receipts
  are rejected before mutation, that same-key replay does no fresh mutation
  work, and that a temporary plugin package disables the public lab namespace.

These tests are still lab-bound. They mostly prove carefully controlled
fixtures, deterministic failure hooks, and production-shaped routing. They do
not prove production durability, arbitrary WordPress resources, arbitrary
plugins, real MySQL/InnoDB behavior, real filesystem crash semantics,
production auth, or measured speed.
They are also not yet a release gate; the strongest scripts still need manual
invocation and can be skipped while `npm test` remains green.

### Test Gaps That Block Release Claims

1. **The strongest evidence is not wired into a release gate.** There is no
   checked-in CI workflow or release wrapper in the repository, and
   `package.json` does not define a top-level command that chains the stronger
   proof steps. The default `npm test` command does not run any Playground
   smoke, and the shorter `npm run test:playground` path stops at
   plan/apply/protocol even though the repo already exposes separate commands
   for auth, HTTP, DB journal, storage guards, process kill, stale claim,
   plugin atomic, forms lab, authenticated CLI, production-shaped
   route/package, mid-apply drift, and recovery. That means the strongest
   proof is still manual opt-in, not release-gated. There is no single
   enforced command that fails closed when mandatory auth, storage, recovery,
   plugin, graph, performance, and crash-boundary checks are skipped.
   A release claim cannot rely on tests that only pass when somebody remembers
   to run the right scripts, and the current suite therefore cannot function as
   the final release gate for the objective.

2. **The default suite is proof of invariants, not proof of release readiness.**
   `npm test` is useful because it proves the model and several fixture
   assumptions fail closed, but it still does not exercise the production-backed
   push path or the strongest smoke scripts. A green default suite is therefore
   necessary evidence, not sufficient evidence, for any live-source claim. It
   proves that some unsafe states are rejected; it does not prove the absence of
   data loss or the presence of production reliability.

3. **The lab smokes are still boundary-specific, not end-to-end production proof.**
   `npm run test:playground:production-shaped-push` and
   `npm run test:playground:production-plugin-package` prove route shape,
   replay behavior, and plugin packaging in the lab. They still report
   `labBacked: true`, so they are not proof that the live source mutation path
   runs against production auth, storage, journaling, crash boundaries, or
   graph semantics. A release gate must reject those lab-backed successes
   rather than treating them as final evidence.

4. **Speed is the clearest unreleased claim, and the benchmark code already
   agrees.** `test/guarded-executor-benchmark.test.js` exercises the benchmark
   harness as a claim filter, not as a claim grant. The script blocks any
   production throughput assertion unless the report can prove durable chunk
   receipts, live remote preconditions, durable journal integrity, redaction,
   graph identity, recovery evidence, atomic-group commit measurement, and
   production storage and row-apply capabilities. That makes the current speed
   story stricter than the docs, but still not releasable: the repository lacks
   the measured end-to-end run, documented environment, and release threshold
   that would clear those blockers.

5. **No test proves the no-data-loss claim across the whole WordPress graph.**
   The current evidence can preserve selected posts, options, files, postmeta,
   and one custom table in fixtures. It does not prove that attachments,
   taxonomy links, menus, users, plugin tables, or plugin-owned serialized
   payloads survive a failed or retried live push without loss or duplication.
   Until a live-source graph matrix exists, every no-data-loss statement is a
   blocked claim, not a proven one.

6. **Reliability evidence is narrower than the claim.**
   The recovery and idempotency smokes classify events and replay fixture
   results, but they do not prove crash survival at every guarded boundary in a
   production executor, nor do they prove leases, fencing, or exactly-once
   behavior on a live source site. Passing them only proves that some failure
   states are detected; it does not prove the live write path is restart-safe.

7. **The strongest route proof is still lab-backed.** The production-shaped
   smoke and plugin package smoke are the best route-shaped evidence in the
   repo, but both still report `labBacked: true` and rely on temporary
   Playground plumbing. They are necessary protocol evidence, not proof of
   live source mutation.

8. **This audit is not a release checklist.** The current scripts prove slices
   of the safety matrix, but they do not compose into one required gate that a
   release must pass.

9. **Speed evidence is modeled, not measured for release.**
   The benchmark tests are useful because they reject unsupported speed claims
   and encode guardrails, but they do not move bytes through a production
   executor, measure a live source site, or establish a release throughput or
   memory threshold on a documented environment. The suite can block a false
   "fast" claim, but it cannot authorize a real one. Until the release gate
   requires a measured run, speed remains the weakest claim and an explicit
   blocker.

10. **No test exercises the complete production-backed path.** The
   production-shaped smoke proves route shape and packaging, but the route is
   still lab-backed. There is no single test that starts with a Reprint pull
   base, edits a local WordPress site, fetches a live source snapshot through
   production Reprint internals, performs authenticated production dry-run,
   applies production mutations, and then verifies the live source site.

11. **No-data-loss proof is resource-narrow.** The tests are strongest for
   simplified resources and named fixtures. They do not prove semantic
   no-loss behavior for WordPress data graphs such as posts plus postmeta plus
   attachments plus taxonomy relationships, or for arbitrary plugin tables and
   serialized options. That means the suite can show selected resources are
   preserved in a lab run, but not that a live source site keeps every related
   object intact after a failed or retried production push.

12. **Storage safety is partial.** The DB guard smoke covers existing fixture
   row updates only. The file guard smoke covers accepted fixture upload
   update/create/delete paths. There is no production storage proof for
   arbitrary files, plugin file publish, DB inserts/deletes, schema changes,
   activation side effects, transactions, locks, rollback, or target `fsync`.

12. **Crash recovery coverage is sparse relative to the claim.** The process
   kill smoke is valuable but covers one local Playground path. There is no
   kill-at-every-boundary matrix across DB writes, file writes, plugin
   activation, journal writes, finalization, stale claims, and replay. The
   current recovery evidence can show that some interruptions are detected and
   classified, but not that the production executor restarts without losing or
   duplicating live source changes.

13. **Reliability assertions often count events rather than prove every hash
    transition.** Several smokes verify expected event names, counts, and coarse
    replay behavior. Release-grade recovery needs deeper assertions that each
    journaled before/after/observed hash corresponds to the live storage state
    at every recovery boundary.

14. **Auth is lab-auth, not production-auth.** The authenticated and
    production-shaped Playground tests are good protocol-shape evidence, but the
    fallback Application Password verifier and lab HMAC/session store do not
    prove production credentials, TLS, secret scoping, nonce cleanup, replay
    retention, or source-site authorization.

13. **Plugin safety is intentionally hard-coded.** The tests prove that the lab
   blocks arbitrary plugin data and allows exact fixtures. That is the right
   conservative behavior, but it means production plugin-owned data remains a
   release blocker until validator contracts and real plugin fixtures exist.

14. **Speed has no measured evidence at the production boundary.** The
   performance tests prove a model, claim gates, and guardrails. They do not
   move bytes, mutate a source site, measure memory, measure throughput, or
   pin those numbers to a documented benchmark environment with a release
   threshold. The current proof is enough to block unsupported speed claims,
   not to justify a "fast" release claim. If the release path cannot run this
   measurement automatically, the speed claim stays blocked.

15. **The release surface is real but fragmented.** The repository already
    exposes high-value smokes for auth, journal durability, storage guards,
    and production-shaped routing, but they are not collected under one
    enforced gate. That means the current proof set is larger than `npm test`
    alone, yet still weaker than a release-ready matrix because the strongest
    claims stay manual and easy to skip. The blocker is specific: without one
    required command or CI job that fails when auth, storage, recovery,
    plugin, graph, and performance gates are omitted, release readiness is
    still a manual judgment, not an enforced property. The missing evidence is
    not another opt-in smoke; it is a single mandatory command that composes
    the existing ones into release-proof order and fails closed if any step is
    skipped or downgraded to lab-only proof.

16. **The highest-value missing edge case is a real crash matrix on the live
    write boundaries.** The current smoke suite can show one process-kill path
    and one stale-claim path, but it does not kill the executor at each
    production-grade boundary for DB writes, filesystem writes, plugin
    activation, finalization, and replay. Without that matrix, the "no data
    loss" claim still rests on selective fixtures and model state, not on the
    exact places the source site can lose or duplicate work. That is still a
    blocker for any live-source no-data-loss claim.

17. **The release suite is fragmented and unenforced.** The highest-value
   evidence is split across manually invoked scripts. A green default test run
   still leaves the strongest claims unproven unless the full matrix is run
   deliberately, and nothing in the repository currently enforces that matrix
   before release. There is also no checked-in CI workflow or release wrapper
   that fails the build when the strongest auth, storage, recovery, plugin,
   graph, and performance smokes are skipped. Until that changes, release
   readiness remains a manual judgment, not an evidence-backed property of
   the repo. The actionable fix is a single release gate command plus CI that
   runs it in order and fails closed on any skipped mandatory smoke.

18. **The live-source no-data-loss claim is still blocked by missing crash
    coverage at the actual write boundaries.** The current smoke suite can
    show one process-kill path and one stale-claim path, but it does not kill
    the executor at each production-grade boundary for DB writes, filesystem
    writes, plugin activation, finalization, and replay. Without that matrix,
    the claim still rests on selective fixtures and model state, not on the
    exact places the source site can lose or duplicate work.

19. **The speed claim is still only a model.** The benchmark tests verify
    evidence structure, guardrail placement, and failure gates, but they do
    not measure a real push path against a live WordPress site, do not report
    a throughput target, do not establish a memory ceiling under load, and do
    not enforce a benchmark environment that can fail release automatically.
    Until a production-shaped benchmark runs the executor end to end with a
    non-bypassable threshold, "fast" remains blocked as a release claim, not
    merely unproven. The current benchmark harness is therefore a refusal
    filter, not a release authorization.

## Test Verdict

The current test suite is good at proving local invariants and blocking bad
states. It is not good enough to certify a live WordPress push path, and it
should not be described that way in release-facing text.

The important distinction is enforcement: `npm test` is a useful filter, but it
is not a release gate. The stronger auth, storage, recovery, plugin, and
performance smokes remain opt-in commands that can be skipped without causing a
failure, so the repository still lacks one required command that proves the
full safety matrix before any production claim is made.

Specifically:

- `npm test` proves model-level safety, not production no-data-loss.
- The Playground smokes prove fixture behavior, not real source-site
  durability or graph integrity.
- The benchmark checks prove guardrails, not release-grade speed.
- Because the strongest gates are still manual, a green run does not imply
  release readiness, and it does not justify any production claim that the
  repo currently blocks.

The actionable next proof is a non-bypassable release gate plus a kill matrix
at every guarded write boundary on the production-backed path. Until then, the
repository can truthfully claim lab evidence for push-safety invariants, but
not a production-safe live WordPress push or a measured fast path.

### Release Gate Gap

The repo still lacks a mandatory release command that makes the safety matrix
non-optional. Today, the strongest checks are available only as separate
opt-in scripts:

- `npm test`
- `npm run test:playground`
- `npm run test:playground:authenticated-http-push`
- `npm run test:playground:authenticated-cli-push`
- `npm run test:playground:db-journal-idempotency`
- `npm run test:playground:storage-guarded-db-write`
- `npm run test:playground:storage-guarded-file-write`
- `npm run test:playground:db-journal-process-kill`
- `npm run test:playground:db-journal-missing-commit-finalization`
- `npm run test:playground:db-journal-stale-claim-all-old`
- `npm run test:playground:production-shaped-push`
- `npm run test:playground:production-plugin-package`
- `package.json` does not define a top-level `release` or `verify:release`
  command that chains the stronger proof steps.

That is not a release gate. It is a menu of optional proofs. The release
blocker is the absence of one top-level command or CI workflow that chains the
required auth, storage, recovery, plugin, graph, and performance checks in a
fixed order and fails if any mandatory step is absent or only lab-backed.
No checked-in CI workflow was found in the repository tree, so there is no
automated backstop that would fail a release when the stronger gates are
skipped. The next actionable proof is a `verify:release`-style command that
refuses release whenever any required step still reports `labBacked: true`,
fixture-only scope, missing live-topology evidence, or an unmeasured speed
claim.

## Required Release Gates

Before any production no-data-loss push claim, the project needs these direct
proof gates:

1. A production Reprint push endpoint with production authentication, scoped
   push credentials, TLS assumptions, nonce/replay/session storage, and source
   mutation authorization.
2. A complete pull-base manifest and live remote hash listing contract covering
   the WordPress data shapes in scope.
3. Storage-boundary guarded writes, or equivalent CAS, for every production DB
   and filesystem mutation type, including inserts, deletes, schema changes,
   plugin files, and activation-sensitive changes.
4. A durable production journal with kill-at-every-boundary tests across
   journal writes, DB writes, file writes, plugin activation, commit
   finalization, replay, and stale-claim paths.
5. A broader WordPress fixture suite covering posts, postmeta, attachments,
   terms, menus, users, options, serialized data, uploads, plugin tables,
   plugin activation, schema changes, and multisite if in scope.
6. A plugin validator/semantic-driver contract with at least one real plugin
   fixture and a conservative fallback that preserves remote state and blocks.
7. A release test aggregator and CI workflow that run the safety-critical
   unit, Playground, auth, storage, recovery, idempotency, plugin, and
   performance gates in a required order or explicitly label excluded tests
   as non-release proof. Right now `npm test` plus `npm run test:playground`
   still stop at the lighter plan/apply/protocol path, while the stronger
   auth, HTTP, DB journal, storage, recovery, production-shaped route/package,
   and plugin smokes remain manual opt-ins. The repository cannot yet claim
   that release evidence is enforced. Release readiness remains a manual
   judgment call until that aggregator exists, and that missing aggregator is
   the current top release blocker. The gate must fail if any mandatory smoke
   is omitted, not merely document that it could have been run.
8. Runtime benchmarks for large uploads and large DB changes with concrete
   throughput, memory, retry, and recovery measurements, plus a documented
   environment that the release gate can refuse if it is missing.

Until these gates exist, public documentation should keep the claim scoped to:
**lab evidence for push safety invariants, not production-safe live WordPress
push.** Anything stronger is a blocked claim, not a conservative phrasing.

## Weakest Current Claim

The weakest surviving claim is the one that sounds simplest: that a live
source WordPress site can be pushed back without data loss. Speed is also
blocked, but the no-data-loss claim is the broader release blocker because it
depends on the same write-boundary evidence the repo still lacks. Right now the
repo only proves that selected fixtures survive selected lab paths, and those
paths do not yet cover the same auth, storage, journal, and graph boundaries
as a real source mutation. This means the current evidence is enough to reject
unsafe optimism, but not enough to authorize a release.

To make the claim release-grade, the next proof must be a kill matrix that
covers every guarded write boundary on a real push path, with live before/after
state and journal evidence for each case. The claim should stay blocked until
all of the following are shown on the production-backed path, not just in a
fixture or model:

- DB row update, insert, and delete
- file create, update, and delete
- plugin activation or package publish
- finalization/commit record write
- replay after restart or duplicate request
- stale claim or lease expiry

If any one of these boundaries is still only covered by a model or fixture
smoke, the no-data-loss claim stays blocked and should not be softened in the
README, release notes, status comments, or branch descriptions.

The release gate should therefore fail closed on two separate conditions:

- any missing live write-boundary proof for the no-data-loss claim
- any unmeasured or undocumented benchmark environment for the speed claim

The current suite is therefore good at rejecting regressions, but it is not
yet good enough to justify the live-source production claims. The most
actionable next step is not more wording; it is live evidence for each guarded
write class, retained with hashes and crash state.

Current bottom line:

- the default suite is a proof filter, not a release gate
- the lab smokes are useful evidence, but they remain opt-in and lab-backed
- the repo cannot yet authorize a production no-data-loss, reliability, or
  speed claim
