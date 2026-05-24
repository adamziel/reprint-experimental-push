# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The repository has useful executable evidence: a three-way JSON snapshot
planner, fixture-scoped Playground mutation paths, authenticated local routes,
DB journal/idempotency slices, guarded fixture DB/file writes, process-kill and
stale-claim recovery smokes, a guarded executor benchmark harness, and a
production-shaped `/wp-json/reprint/v1/push/*` route packaged as a temporary
plugin. That is still not direct proof for the stated objective: safely pushing
local edits back to the original live WordPress source site while that source
may have changed.

The honest release claim remains narrow: **this is an executable safety model
and local Playground lab for push invariants, not production-safe live source
mutation**.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof.

Model tests, design docs, fixture smokes, and route names are useful leads, but
they are indirect for production claims unless they exercise the same
authentication, coverage, storage, journal, crash, concurrency, WordPress graph,
plugin, and filesystem semantics that production will depend on. A packaged
route that reports `labBacked: true` is route-shape evidence. A fixture custom
table driver is plugin-driver evidence for that fixture only. A benchmark that
fails closed on production claims is not production throughput evidence.

## Fresh Verification

Fresh local verification on 2026-05-24:

- `npm test` passed: 82 tests, 82 pass, 0 fail, 0 skip.
- `npm run test:playground:production-plugin-package` passed. It disabled the
  public lab namespace, rejected an unprovisioned alternate credential with
  `401`, rejected an unscoped administrator Application Password with `401`,
  cleaned one expired lab session and one expired lab nonce, applied 7
  graph-safe fixture mutations through `/wp-json/reprint/v1/push/*`, committed
  the DB journal row, and ended with `finalMatchesLocal: true`.

The same packaged smoke also proves the uncomfortable part: the production
namespace is still backed by copied Playground implementation files, the route
profile still reports `labBacked: true`, and the successful seven-mutation
package run excludes the unmapped graph postmeta edge from the local snapshot
instead of proving WordPress graph identity remapping.

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source
site after a pull, while that source may still be live and may have changed.
The README priorities are no data loss, no data loss, reliable, and fast. That
implies these release requirements:

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete pull-base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, graph references, and protocol metadata. |
| R2 | Read the current live source state before planning and compare base, local, and remote in a three-way plan. |
| R3 | Preserve remote-only changes by default, including deletes, plugin state, files, rows, related resources, and unknown resources. |
| R4 | Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect. |
| R5 | Apply every mutation only behind a live precondition rechecked immediately before the storage write. |
| R6 | Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every supported production DB and filesystem mutation. |
| R7 | Treat coupled file, DB, plugin, option, activation, schema, generated-file, and graph changes as atomic groups. |
| R8 | Reject plugin-owned, serialized, custom-table, schema-sensitive, or environment-specific data unless a semantic driver proves the mutation. |
| R9 | Authenticate and authorize source-site mutation with production push-scoped credentials, replay protection, session lifecycle, durable nonce storage, and TLS assumptions. |
| R10 | Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed source state. |
| R11 | Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery. |
| R12 | Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, concurrent workers, and operator retries. |
| R13 | Prove WordPress graph identity and reference safety for posts, postmeta, attachments, terms, users, comments, menus, serialized blocks, and generated IDs, or block those pushes. |
| R14 | Prove behavior against real WordPress data shapes: uploads, options, plugin tables, plugin activation, schemas, object-cache/runtime side effects, and multisite if in scope. |
| R15 | Redact raw private data from plans, journals, conflict reports, recovery reports, auth/session evidence, and benchmark artifacts. |
| R16 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard. |
| R17 | Provide a release test suite and CI gate that runs the safety, recovery, auth, storage, graph, plugin, redaction, and performance proof intended to support public claims. |

## Evidence Table

| Req | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | JSON snapshots carry stable resource keys and hashes. Playground exporters cover fixture posts, options, files, selected postmeta, a forms lab custom table, and narrow plugin metadata. | No production Reprint pull-base manifest contract. No complete identity mapping for generated IDs, attachments, taxonomies, menus, users, multisite, schemas, runtime state, arbitrary plugin ownership, or coverage gaps. | Yes |
| R2 three-way planning | `createPushPlan()` compares base/local/remote hashes. The 82-test suite covers local changes, remote-only preservation, matching edits, direct conflicts, deletes, topology blockers, plugin context blockers, stale graph references, and stale preconditions. | No production live source hash listing contract. No test starts from a real Reprint pull, edits a local WordPress site, and pushes through non-lab production source mutation internals. | Yes |
| R3 preserve remote changes | Unit tests preserve remote-only rows/plugin changes, stop delete/update conflicts, stop directory and file-type topology overwrites, and block a stale postmeta reference to a remote-created post. Fixture smokes preserve selected drift. | No broad semantic preservation proof for posts plus postmeta plus attachments plus terms, menus, users, comments, plugin tables, generated files, object caches, or remote-only resources coupled to local code/content changes. | Yes |
| R4 conflict stop and evidence | Conflicts, blockers, hashes, change kinds, plugin-owner classes, stale graph references, and selected redaction checks are represented in tests. | No durable production conflict artifact, reviewed resolution workflow, fresh revalidation rule, complete redaction schema, retention policy, or operator report contract. | Yes |
| R5 immediate preconditions | Model apply validates preconditions. Playground smokes exercise stale dry-run/apply refusal and selected just-in-time pre-write hash rejection. | The production-shaped route is still lab-backed. No proof every production mutation rechecks liveness immediately before its actual DB/file/plugin write under real source-site concurrency. | Yes |
| R6 storage-boundary guards | Existing smokes cover selected fixture `wp_posts`, allowlisted `wp_options`, selected `wp_postmeta`, exact forms lab rows, and accepted fixture upload file update/create/delete paths. | No production MySQL/InnoDB transaction/lock/CAS proof, arbitrary insert/delete proof, schema-change proof, filesystem `fsync` proof, plugin file publish proof, activation side-effect guard, rollback, or path/symlink policy. | Yes |
| R7 atomic groups | Unit tests cover plugin dependency metadata, same-group dependencies, outside-group blocking, dependency hash/version/activation checks, and forged ready-plan rejection. The fixture plugin atomic smoke exists for one hard-coded shape. | No general plugin install/update/activation engine, no production atomic visibility boundary across files/DB/activation, and no rollback or blocked-recovery proof for arbitrary plugin side effects. | Yes |
| R8 plugin-owned data | Unknown plugin-owned rows block. Exact forms fixture option/postmeta/custom-table policies can pass only with active unchanged fixture plugin evidence. Direct `active_plugins` mutation remains blocked. | No production plugin validator contract, serialized PHP value validator, generic custom-table driver, schema migration driver, generated-file contract, or proof arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 auth and authorization | Authenticated lab routes use Basic/Application-Password-shaped credentials, `manage_options`, signed lab requests, nonce replay checks, auth-bound receipts, sessions, and idempotency. The packaged smoke now rejects unprovisioned alternate credentials and unscoped administrator Application Passwords with `401`. | The accepted credential scope is still `reprint-push-lab:authenticated-http-push`. The verifier, signing keys, nonce/session store, cleanup, and audit rows are lab internals. No production credential lifecycle, TLS deployment proof, revocation, rotation, retention, rate limits, multisite scoping, or real exporter credential binding. | Yes |
| R10 honest dry-run | Protocol and auth smokes require receipts, reject missing/tampered receipts, bind receipts to plan/preconditions/request/session data, and reject stale source state in fixtures. | No production UI/operator warnings. No proof for changes between production chunks or between every production write boundary. No proof that manual conflict resolution forces a fresh plan. | Yes |
| R11 durable recovery | Model recovery tests classify old/updated/blocked states. JSONL tests prove monotonic append, hash records, restart inspection, corrupt/truncated journal blocking, and stale-claim advancement in the model. Playground DB journal, process-kill, missing-commit, and stale-claim smokes exist as fixture evidence. | No durable production DB-table journal, target write `fsync`, shared storage lock, lease/fencing token, exactly-once production write proof, rollback policy, or kill-at-every-boundary matrix across journal, DB, file, plugin activation, finalization, replay, and stale retry. | Yes |
| R12 idempotent resumability | DB journal smokes require idempotency keys, replay same-key committed/rejected results, reject same-key different-body requests, claim one concurrent same-key executor, finalize a missing commit, and exercise one all-old stale-claim retry path. | No production chunk cursor, duplicate first-apply test on shared durable storage, multi-worker fencing proof, stale-plan invalidation across chunks, retry retention policy, or production stale-worker write prevention. | Yes |
| R13 WordPress graph identity | The default suite now blocks a local `wp_postmeta.post_id` mutation that references a stale remote-created post identity and redacts raw values. The guarded benchmark records graph identity evidence for synthetic stable targets. | This is mostly blocking, not mapping. No ID allocation, remapping, reference rewrite, tombstone, GUID/path, serialized block, attachment, taxonomy, menu, user/comment/order, or referential-integrity proof. The packaged smoke gets to seven mutations by excluding an unmapped graph edge. | Yes |
| R14 real WordPress shapes | Playground fixtures exercise real WordPress-visible posts, options, files, selected postmeta, one custom table, fixture plugin metadata, and a packaged temporary route. | Coverage is narrow and fixture-controlled. No large live WordPress matrix, no arbitrary plugins, no multisite, no media derivative graph, no generated resources, no object-cache/runtime side effects, and no production-backed source mutation endpoint. | Yes |
| R15 redaction | Tests assert selected conflicts, journals, storage evidence, dependency blockers, stale graph blockers, and recovery reports omit raw fixture values. | Redaction is assertion-by-fixture and forbidden-string oriented. No formal production allowlist schema covers every future plan, journal, conflict, recovery, auth/session, credential, and benchmark artifact. | Yes |
| R16 speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a safety model for chunk staging, DB batching, preconditions, atomic visibility, backpressure, durable evidence, and fail-closed production throughput claims. | No production throughput is claimed or measured. No real source site moves large uploads/tables through the production executor with memory ceilings, retries, chunk cursors, journals, recovery inspection, and safety checks enabled. | Yes |
| R17 release suite | `npm test` passed 82 tests locally. The packaged production-shaped smoke passed when invoked explicitly. `package.json` exposes many stronger standalone smokes. | No CI workflow was found. `npm test` does not run the Playground/auth/storage/recovery/plugin/package smokes. No single release gate runs the evidence needed for production no-data-loss, reliability, and speed claims. | Yes |

## Test Audit

### No-Data-Loss Claims

The default suite proves useful no-overwrite behavior for simplified resources:
three-way hash comparison, remote-only preservation, delete/update conflicts,
unsafe directory and file-type topology blockers, plugin context blockers,
explicit fixture plugin-data policies, forged-plan rejection, stale
preconditions, and one stale WordPress graph-reference blocker.

That is not enough for a production no-data-loss claim. The tests still do not
prove complete resource coverage, graph identity remapping, arbitrary plugin
semantics, generated resources, multisite scope, environment-specific data
handling, or real source-site concurrency. The current graph work is properly
conservative because it blocks stale references. It does not yet make those
pushes safe.

### Reliability Claims

The reliability evidence is meaningful but lab-bound. The default suite covers
model recovery classifications, durable JSONL journal append/read behavior,
completed replay, stale-claim advancement, missing target blocking, corrupt
journal blocking, and partial remote mutation as blocked recovery. Standalone
Playground smokes add useful DB idempotency, process-kill, missing-commit, and
stale-claim retry slices.

The release problem is that none of this proves production storage durability.
The DB journal library identifies itself as local Playground fixture scope, and
the packaged route copies Playground implementation files into the plugin. There
is no production lease/fencing model, no shared-DB multi-worker proof, no
kill-at-every-boundary matrix for every DB/file/plugin transition, and no proof
that a stale worker cannot resume after another worker advances a claim in
production.

### Speed Claims

The speed tests are valuable because they prevent overclaiming. They model
chunk staging, per-row preconditions, bounded batches, backpressure, atomic
visibility, durable evidence, and production claim blockers. The guarded
benchmark moves synthetic buffers and row payloads through local evidence and
throws if asked to claim production throughput before production gaps are
measured.

That is not speed proof. It does not push a large WordPress site, move large
uploads or tables through production mutation endpoints, measure memory,
measure throughput, exercise network/TLS behavior, or prove retry/recovery
under load.

### Release-Suite Gap

The strongest evidence is not wired into the default suite. `npm test` is fast
and useful, but it omits the long Playground/auth/storage/recovery/plugin
package smokes that carry most of the integration story. Optional scripts are
not a release gate. A production claim needs a CI-backed release command that
runs or explicitly accounts for the safety-critical smokes, and it must fail if
the production namespace is lab-backed.

## Required Release Gates

Before any production no-data-loss push claim, the project needs these direct
proof gates:

1. Production Reprint push endpoints whose implementation is not lab-backed and
   whose route profile fails if lab internals are mounted under production
   names.
2. Production-scoped auth, credential lifecycle, TLS policy, session storage,
   nonce/replay cleanup, operator identity, revocation, rotation, and audit
   retention.
3. Complete pull-base and live source coverage manifests, with unknown plugin,
   generated, custom-table, and multisite resources treated as hard blockers.
4. Storage-boundary guarded writes for every supported DB and filesystem
   mutation kind, including inserts, deletes, schema changes, plugin files, and
   activation-sensitive state.
5. A durable production journal with kill-at-every-boundary tests across
   journal writes, DB writes, file writes, plugin activation, commit
   finalization, replay, stale-claim retry, and recovery inspection.
6. WordPress graph identity and reference rewriting, or explicit blocking for
   graph-mutating pushes that cannot prove safe remapping.
7. Plugin validator/semantic-driver contracts with at least one real plugin
   proof and a conservative fallback for unknown plugin-owned state.
8. Reviewed conflict-resolution artifacts that preserve remote evidence and
   force fresh live-source revalidation before retry.
9. Production audit/redaction schemas with bounded retention and useful
   operator reports that do not leak raw private data.
10. A release suite and CI gate that runs the safety-critical unit,
    Playground, auth, storage, recovery, plugin, graph, redaction, and
    performance checks.
11. Runtime benchmarks for large uploads and large DB changes through the same
    guarded production executor intended for release.

Until those gates exist, public documentation should keep the claim scoped to:
**lab evidence for push safety invariants, not production-safe live WordPress
push.**
