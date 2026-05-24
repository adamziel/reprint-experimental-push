# Critic Audit

## 2026-05-25 Production Push Readiness Re-Audit

Verdict: the design still cannot claim production-grade push support.

The protocol is stronger than a generic sync sketch: it has dry-run/apply
separation, live-remote revalidation, idempotency keys, a recovery vocabulary,
and hash-only evidence for several lab slices. That is still not enough to
claim production push on a live WordPress source site. The missing proofs are
not cosmetic. They are the exact points where a partial write, hidden plugin
side effect, stale retry, or graph rewrite can silently lose remote state while
the system reports a plausible success.

The safest current wording is narrower: this repo contains executable safety
model evidence and lab-backed route-shape evidence. It does not yet prove a
production-safe push path, even when the route names, receipts, or fixture
smokes look production-shaped.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Live remote drift after dry-run | A plan is dry-run against one live remote snapshot, then the remote changes before apply starts or between apply batches. | The repo proves stale refusal in fixtures and lab routes, but not a production claim that every remote write boundary rechecks live state immediately before the write and preserves the drifted remote if the batch fails. | Dry-run evidence is planning evidence only. Without fresh live revalidation at each write boundary, apply can overwrite changes that were not part of the approved plan. |
| Identity remapping on create | A push creates a new post, attachment, term, menu item, or meta row whose identity must be remapped on the remote, but the remote already created or changed a matching object after pull. | The current proof blocks one narrow stale-reference case and explicitly says same-plan identity creation and general rewrite remain unsupported. There is no end-to-end proof for identity assignment, reference rewrite, or referential integrity across WordPress graph surfaces. | Creating the wrong identity is a silent corruption case: hashes can match while relationships point to the wrong object. |
| Plugin-owned state outside allowlists | A plugin stores state in a custom table, generated file, cron row, cache entry, schema table, or activation side effect that is not in the allowlist or semantic driver. | The current plan relies on fixture allowlists and a small set of driver checks. It does not define a complete plugin-owned resource graph, versioned semantics, rollback expectations, or a conservative fallback for unknown plugin state. | Production push must either prove ownership for each plugin-owned surface or refuse the mutation. Guessing is unsafe because plugin state often spans tables, files, options, cron, and runtime side effects. |
| Recovery after partial file/DB/plugin side effects | The apply path writes one surface, then dies before the related DB row, option, plugin activation state, or file publish is finalized. | The recovery evidence stops at classification in lab-backed and fixture-scoped paths. It does not prove durable production journals, kill-at-every-boundary replay, or repair across DB, filesystem, plugin activation, and stale-claim lease boundaries. | A partial side effect can leave the site in a mixed old/new state that looks successful until the next request, deploy, or retry. |
| Stale manual review artifacts | An operator reviews a conflict, chooses "take local", and later retries from a saved note or stale artifact after the remote changed again. | No reviewed-resolution artifact binds the approval to the exact base/local/remote hashes, reviewer identity, fresh live snapshot, and retry attempt. The docs say manual resolution is only acceptable if the remote is preserved for audit and retry starts from fresh evidence, but the enforcement path is still missing. | A stale manual decision becomes overwrite permission for a different remote state than the one the reviewer approved. |
| False reliability from lab-backed routes | A route looks production-shaped, returns live hashes, and accepts push-like requests, but the implementation still resolves to Playground internals or fixture-only paths. | The current evidence repeatedly distinguishes lab-backed route shape from production implementation, but the design does not yet provide a production endpoint that is not lab-backed. | A named endpoint is not production support if its success path still depends on copied lab code, fixture scopes, or route-shape smoke tests. |
| Coverage gaps can hide unknown remote state | The remote contains mu-plugin settings, WooCommerce HPOS data, Action Scheduler queues, custom tables, generated assets, or multisite data outside the scanner scope. | The design says unknown coverage should block, but no completed production coverage manifest exists that binds every affected surface into the apply evidence. | If the planner cannot prove it saw the resource, it cannot safely mutate it. |

## What Reprint, ZS-Sync, And ForkPress Actually Contribute

### Reprint

Reprint source notes prove a staged pull transport: preflight, files pull,
database pull, database apply, flat document root, runtime apply, and optional
start. They also prove protocol versioning and transport framing on the export
side. What they do not prove is safe source mutation. There is no evidence in
the notes for a production push endpoint, production-side write preconditions,
durable mutation journaling, or recovery across file, DB, and plugin
boundaries.

What this repo still must prove: a production mutation boundary with live
revalidation before every write, a durable recovery artifact, and a complete
coverage manifest that binds the pulled base to the live remote before apply.

### ZS-Sync

ZS-Sync source notes prove scanner composition, cursor-based rescans, bounded
changed-resource listing, and a provider model for enumerating selected
resources. They do not prove source mutation safety, ownership semantics, or a
push policy for unknown state.

What this repo still must prove: that scanner output becomes a complete
coverage manifest and that any unscanned plugin, custom-table, generated-file,
or multisite resource hard-blocks apply rather than being guessed into safety.

### ForkPress

ForkPress source notes prove the strongest reliability bar in this comparison:
three-way merge records, reviewed conflict resolution, plugin-specific
validators, and crash-consistency language that distinguishes old, new, and
blocked states with artifacts.

They do not prove that this repo already has equivalent behavior. The missing
proof here is a resolution artifact that preserves base/local/remote evidence,
binds the reviewer action to a fresh live revalidation, and forces replay from
current remote state on retry.

What this repo still must prove: reviewed conflict handling with durable
evidence, fresh revalidation on retry, and plugin-driver semantics that either
prove ownership or refuse the mutation.

## Changes Required Before A Production Claim

These are not optional hardening ideas. Each item closes a specific failure
mode where the current evidence still allows silent data loss, stale retries,
or an operator-facing success message that is stronger than the proof.

1. Ship a real production push endpoint whose implementation does not route to
   Playground or lab internals.
2. Separate lab credentials from production push credentials and prove
   production lifecycle behavior: issuance, scoping, rotation, revocation,
   replay rejection, and audit retention.
3. Introduce a complete production coverage manifest and make unknown plugin,
   custom-table, generated-file, cache, and multisite resources hard blocks.
4. Define plugin-owned resource contracts for tables, files, options, cron,
   cache, and activation hooks, with rollback or block behavior for unknown
   ownership.
5. Add graph identity mapping or broaden the hard block policy so every
   relationship-bearing WordPress row class that can silently rewire identity
   is either rewritten safely or rejected.
6. Add reviewed conflict-resolution artifacts that preserve base/local/remote
   evidence, reviewer identity, chosen action, and fresh revalidation data.
7. Extend storage-boundary checks to production write primitives, including
   inserts, deletes, schema changes, file publish/unlink, plugin activation
   side effects, and any write path that can expose mixed old/new state.
8. Build a durable production journal with kill-at-every-boundary tests across
   DB, filesystem, plugin activation, and stale-claim recovery.
9. Add tombstone and resurrection policy for delete/restore cases so a retry
   cannot silently revive intentionally deleted remote content.
10. Publish production audit/redaction schemas and a release gate that runs the
    full safety-critical suite before the project can use production-grade
    wording.

If any one of these remains unproved, the correct claim stays limited to
fixture-scoped or lab-backed push evidence.

## Current Bottom Line

The project still has credible lab evidence for no-overwrite behavior, staged
recovery, and some guarded writes. It does not yet have the proofs needed to
promise safe production push support for arbitrary live WordPress source sites.
The honest claim remains: fixture-scoped and lab-backed push evidence, blocked
for production until the missing proofs above exist.

## 2026-05-24 Auth And Graph Hardening Re-Audit

Verdict: the project still must not claim production-grade push support.

The current branch improves the lab: scoped push Application Password evidence,
unprovisioned and unscoped credential rejection, signed session and nonce
cleanup, stale WordPress graph-reference blocking, stale-claim fencing, guarded
storage-boundary fixture writes, and a benchmark gate that refuses production
throughput claims when production evidence is missing. Those are real
improvements. They are still not proof that an arbitrary live WordPress source
site can be mutated safely.

The strongest honest claim remains: executable safety-model and local
Playground evidence for push invariants. The packaged `/wp-json/reprint/v1/push/*`
path still reports `routeProfile.labBacked: true`, copies Playground
implementation files into the package, and applies a graph-safe fixture slice
after dropping the unmapped graph edge. That is route-shape evidence, not
production push support.

## Evidence Reviewed

- `docs/protocol.md`
- `docs/source-notes.md`
- `docs/scenario-matrix.md`
- `docs/invariants/no-overwrite.md`
- `docs/recovery/apply-journal.md`
- `docs/executor.md`
- `docs/fast-paths.md`
- `docs/progress-log.md`
- `docs/supervisor-feedback.md`
- `audits/objective-audit.md`
- `plugins/reprint-push/reprint-push.php`
- `scripts/playground/push-remote-rest-plugin.php`
- `scripts/playground/production-shaped-route-smoke.mjs`
- `scripts/playground/production-plugin-package-smoke.mjs`
- `test/push-planner.test.js`
- `test/recovery-journal.test.js`
- `test/guarded-executor-benchmark.test.js`

## Current Claim Traps

| Trap | Scenario | Missing proof | Required change |
| --- | --- | --- | --- |
| Production-shaped routes look production-ready while still lab-backed | A site installs the temporary `reprint-push` package, sees `/wp-json/reprint/v1/push/*`, rejects unscoped credentials, applies seven graph-safe fixture mutations, and reports `finalMatchesLocal: true`. | The package still loads copied Playground internals, the preflight route reports `labBacked: true`, and the smoke deliberately removes the unmapped graph postmeta before applying. No production auth, journal, storage, graph, or plugin implementation is exercised. | Make production routes fail if they are lab-backed or resolve to Playground files. Keep the smoke as route-shape evidence only. |
| Graph-safe route smokes prove exclusion, not identity mapping | Local wants to push a postmeta row that references a post identity created or changed on the remote after pull. Current ready smokes delete `post_id:2001:meta_key:_reprint_push_forms_schema` from the local snapshot to avoid the blocked edge. | The planner now blocks one stale `wp_postmeta.post_id` case, but there is no automatic ID allocation, identity map, reference rewrite, or referential-integrity proof for attachments, terms, menus, users, comments, orders, serialized blocks, GUIDs, upload paths, or same-plan creates. | Treat blocked graph edges as release blockers, not as evidence to omit from ready fixtures. Add graph identity mapping or block all graph-mutating pushes that need rewriting. |
| Scoped lab credentials can be mistaken for production credential lifecycle | Packaged preflight rejects an unprovisioned alternate user and an unscoped administrator Application Password, then accepts a provisioned lab push credential. | This proves fixture metadata checks, not production lifecycle. There is no production push credential issuance, rotation, revocation, replay retention, rate limiting, TLS deployment policy, multisite scoping, or durable audit ownership. | Define production push credentials separately from the lab HMAC/Application Password fixtures and test lifecycle, cleanup, replay, and revocation under concurrent requests. |
| Signed-store cleanup is hygiene, not durability | Preflight deletes seeded expired signed-session and nonce option rows while retaining unexpired rows. | No production nonce/session store proves crash durability, cleanup races, retention windows, replay windows, option bloat limits, or auditability. | Add a production session/nonce store with retention policy, concurrency tests, and recovery behavior. |
| Manual resolution can become stale overwrite permission | An operator manually resolves a conflict, chooses "take local", or fixes a resource in wp-admin, then retries after the live remote changed again or after a partial apply left recovery evidence. | No reviewed-resolution artifact preserves base/local/remote values, remote evidence, reviewer identity, selected action, retry state, and fresh remote hashes. | Manual resolution is success only when the remote evidence is preserved, the user can audit and retry safely, and retry creates a new plan from a fresh live remote snapshot. |
| Plugin allowlists can hide plugin data traps | A fixture plugin option or table row is allowed while the real plugin also depends on custom tables, serialized counters, cron rows, generated CSS, roles/caps, activation hooks, migrations, or external side effects. | Current forms and atomic-plugin paths are exact fixture allowlists. They prove conservative blocking and one hard-coded happy path, not general plugin semantics. | Define plugin validator/driver contracts with complete owned-resource graphs, side effects, version constraints, rollback/block behavior, and at least one real plugin proof. Unknown plugin-owned state must preserve remote and stop. |
| Coverage can be incomplete while a plan looks ready | The remote has WooCommerce HPOS tables, Action Scheduler queues, mu-plugin settings, generated files, media derivatives, multisite network tables, or plugin custom tables outside the scanner scope. | No completed coverage manifest proves every affected core, plugin, theme, upload, generated, custom-table, user/order, and multisite surface was scanned or explicitly blocked. | Make unknown or incomplete coverage a hard block. Bind completed coverage hashes into dry-run and apply evidence. |
| Fixture equality can hide hidden side effects | A smoke verifies the visible fixture surface matches local while preflight mutates auth/session option rows, plugin activation changes runtime state, or generated/cached data changes off-screen. | No side-effect manifest defines which auth stores, cron entries, generated files, object-cache state, roles/caps, plugin migration rows, or custom tables are allowed to change. | Production success must compare the planned target graph plus an explicit side-effect manifest. Any unlisted side effect blocks the claim. |
| Storage-boundary proof is still narrow | A remote edit lands after dry-run and JIT hash but before a MySQL update, insert, delete, schema change, plugin activation write, file rename, unlink, or generated-file write. | Current storage guards prove selected Playground fixture row updates and fixture upload file update/create/delete paths. They do not prove generic MySQL/InnoDB transactions, arbitrary inserts/deletes, schema writes, plugin file publish, activation side effects, locks, rollback, or target `fsync`. | Implement and test production storage guards for every supported write primitive, with race and kill tests that preserve remote state on stale writes. |
| Cross-store crash consistency is not production-proven | A plugin update publishes PHP files, changes `active_plugins`, runs migrations, updates options/custom tables, and the host dies between boundaries. | DB journal and file journal smokes are local Playground SQLite/host-mount and JSON-model evidence. They do not prove old/new/blocked classification across production DB, filesystem, activation, finalization, and replay boundaries. | Build a durable production journal and kill matrix across journal append, DB write, file write, activation, finalization, replay, stale-claim retry, and recovery inspect. |
| Stale-claim fencing remains lab/model evidence | One worker opens an apply claim, stalls, a retry advances the claim, then the old worker resumes under production load. | The all-old stale-claim smoke and JSONL stale-worker proof are deterministic lab/model paths. They do not prove production leases, fencing tokens, monotonic ownership, expiry rules, shared-DB locking, or stale-worker write prevention. | Add production lease/fencing semantics and multi-worker tests where stale workers attempt to resume after claim advancement. |
| Delete and restore policy is underspecified | The remote deleted a post for moderation, legal, editorial, or plugin reasons while local edited it; a later local push would resurrect it. Or local deletes a file while remote updates metadata for it. | The planner stops direct conflicts, but there is no tombstone model, retention window, intentional restore policy, or reviewed delete/restore evidence. | Preserve remote delete evidence, require explicit reviewed restore/delete plans, and revalidate the live remote before any resurrection or deletion. |
| Environment resources can leak or break production | A local clone contains `siteurl`, `home`, salts, SMTP/API keys, object-cache settings, cron schedules, absolute upload paths, or local-only plugin settings. | No production denylist/transform policy is proven across core and plugin resources. | Enforce deny-by-default environment-resource handling with tests for core options, secrets, paths, cron/cache/runtime data, and plugin-specific environment state. |
| Audit redaction is fixture-based | A recovery artifact includes order details, form entries, membership data, private upload paths, option payloads, API keys, or absolute paths while the operator still needs actionable recovery evidence. | Current redaction checks selected fixture strings, forbidden keys, and hash-only fields. There is no production allowlist schema, privacy review, retention policy, or operator report contract for arbitrary plugin payloads. | Define production audit schemas with stable hashes, redacted diffs, bounded retention, and useful operator-facing recovery reports. |
| Speed evidence can sound stronger than measured reliability | The guarded benchmark moves generated buffers and row payloads through the model and refuses a production throughput claim when blockers remain. | No benchmark mutates production storage with chunk cursors, retries, memory ceilings, recovery inspection, storage receipts, and safety checks enabled. | Publish speed limits only for measured production paths. Keep model and lab benchmarks labeled as non-production evidence. |
| Release tests do not match release claims | Documentation cites many passing smokes and the project sounds increasingly safe because route, auth, journal, storage, plugin, graph, and benchmark slices pass. | The strongest Playground smokes are still optional/manual and no single CI release gate runs production-shaped endpoint, auth, storage, recovery, plugin, graph, redaction, and performance evidence. | Create a release suite and CI gate. Production-grade wording must be blocked unless the full gate passes. |

## Source Comparison

### Reprint

The Reprint source notes support staged, resumable transport: preflight, files
pull, DB pull, DB apply, flat document root, runtime apply, and optional start.
Reprint source notes support the staged, resumable transport shape: preflight,
files pull, DB pull, DB apply, flat docroot, runtime apply, and start. That is
a good transport primitive for push, but it is not a mutation proof.

Scenario: push applies plugin files, then the process dies before the related
options, custom-table rows, or activation state are committed. The file side is
visible, the remote state is mixed, and the operator has no proof whether the
site is old, new, or blocked.

Missing proof: the current design still lacks a production Reprint mutation
boundary with per-chunk compare-and-swap, durable recovery state across each
write surface, and an auditable rollback/blocked artifact for every remote
write boundary. Pull resumability alone does not prove source mutation safety.

Required change: production push must extend Reprint with mutation-scoped auth,
coverage-bound planning, storage-boundary guards, and a durable journal that
survives file/DB/plugin boundaries separately.

### ZS-Sync

The ZS-Sync notes are useful for scanner composition, cursors, resource
providers, and bounded changed-resource listing. They are not a source-site
mutation policy.

Scenario: the scanner says the known tables and files are current, but a plugin
stores state in an unregistered custom table, a generated file, or a runtime
cache that the scanner never enumerated. The plan then looks complete while the
remote still has unscanned state that can be corrupted by the push.

Missing proof: no completed coverage manifest ties the scanner to every plugin,
mu-plugin, theme, upload derivative, generated artifact, custom table, and
multisite scope that push can affect.

Required change: use ZS-Sync-style scanning as planning input only. A ready
push must block on unknown or incomplete coverage.

### ForkPress

The ForkPress notes provide the closest production reliability bar:
three-way merge records, reviewed conflict resolution, plugin validators,
revalidation, and crash consistency where failure is old, new, or blocked with
artifacts.

Scenario: an operator reviews a conflict, picks "take local," and retries after
the source site changed again or after a partial apply left a mixed remote
state. If the retry accepts the old approval, the conflict review becomes
stale overwrite permission.

Missing proof: the current design does not yet show a reviewed-resolution
artifact that preserves base/local/remote evidence, binds the approval to a
fresh live snapshot, and forces the retry to rebuild the plan from current
remote hashes.

Required change: adopt the ForkPress-grade lifecycle before making
ForkPress-grade claims. Manual resolution is acceptable only when the remote is
preserved for audit and retry starts from fresh evidence.

## Reliability Language Gate

Allowed wording:

- "executable safety model"
- "local Playground lab evidence"
- "fixture-scoped proof"
- "production-shaped route names backed by lab internals"
- "blocked for production until the release gates pass"

Blocked wording until the required proofs exist:

- "production-grade push"
- "production no-data-loss push"
- "production atomic plugin install/update"
- "general plugin-safe push"
- "durable production recovery"
- "safe for arbitrary live WordPress source sites"
- "production throughput"

## Supervisor Release Gate Checklist

A supervisor should treat any production-readiness wording as blocked until all
of these can be checked off against current executable evidence:

- [ ] The push endpoint is not lab-backed and does not resolve to Playground or
  fixture internals.
- [ ] Production-scoped authentication, session handling, replay protection,
  and credential lifecycle are proven.
- [ ] The pull-base manifest and live remote coverage manifest are complete for
  the requested scope, with unknown resources hard-blocking apply.
- [ ] Dry-run is treated as planning-only evidence, and apply rechecks live
  remote state immediately before every write.
- [ ] Storage-boundary guards exist for every supported DB, file, plugin, and
  schema mutation kind.
- [ ] Plugin-owned state outside allowlists either has a semantic driver or
  hard-blocks the push.
- [ ] Recovery proves old/new/blocked classification across partial file,
  DB, and plugin side effects.
- [ ] Manual conflict resolution is tied to a durable reviewed artifact and
  fresh live revalidation on retry.
- [ ] Release claims are backed by the full safety, recovery, auth, storage,
  plugin, and performance suite, not by optional smoke tests alone.
- [ ] The wording being reviewed names only what the evidence proves, not what
  the architecture intends to prove later.

## Minimum Production Claim Gates

Before any production-grade push claim, the project needs all of these:

1. Production Reprint push endpoints whose implementation is not lab-backed.
2. Production-scoped auth, credential lifecycle, TLS policy, session storage,
   nonce/replay cleanup, operator identity, rate limits, and audit retention.
3. Complete pull-base and live remote coverage manifests, with unknown
   plugin/custom-table/generated resources as hard blockers.
4. Storage-boundary guarded writes for every supported DB and filesystem
   mutation kind, including inserts, deletes, schema changes, file publish,
   unlink, and activation side effects.
5. A durable production journal with kill-at-every-boundary recovery tests.
6. Reviewed conflict-resolution artifacts that preserve remote evidence and
   force fresh revalidation before retry.
7. WordPress graph identity mapping and reference rewriting, or explicit
   blocking for graph-mutating pushes.
8. Plugin semantic driver contracts with at least one real plugin proof and a
   conservative fallback for unknown plugin state.
9. Delete/restore tombstones and reviewed resurrection policy.
10. Production environment-resource denylist/transform policy.
11. Production audit/redaction schemas with retention and operator reports.
12. A release suite and CI gate that runs safety-critical unit, Playground,
    auth, storage, recovery, plugin, graph, redaction, and performance checks.
13. Measured large-file and large-table benchmarks through the guarded executor
    path intended for release.

Until then, the project is a strong lab for the right invariants, not
production-grade source-site push support.
