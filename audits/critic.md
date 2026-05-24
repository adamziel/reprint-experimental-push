# Critic Audit

## 2026-05-24 Production Push Claim Gate

Verdict: the project must not claim production-grade push support yet.

The current repository has real progress: JSON-model planning, Playground
source mutation, authenticated lab routes, DB journal/idempotency smokes,
process-kill recovery inspection, storage-boundary fixture guards, a
production-shaped `/wp-json/reprint/v1/push/*` route profile, and a packaged
prototype plugin. That is still not proof that an arbitrary live WordPress
source site can be mutated without data loss.

The packaged endpoint is especially easy to overstate. `plugins/reprint-push`
does disable the public lab namespace when packaged, but it still loads the
Playground implementation files. The production-shaped routes are registered
to the same authenticated lab callbacks, the route profile explicitly reports
`labBacked: true`, and the DB journal schema says its scope is local Playground
fixture evidence, not production durability. This is useful route-shape proof,
not production push support.

## Evidence Boundary

This audit reviewed the design and current proof surface in:

- `docs/protocol.md`
- `docs/source-notes.md`
- `docs/scenario-matrix.md`
- `docs/recovery/apply-journal.md`
- `docs/invariants/no-overwrite.md`
- `docs/progress-log.md`
- `docs/supervisor-feedback.md`
- `plugins/reprint-push/reprint-push.php`
- `scripts/playground/push-remote-rest-plugin.php`
- `scripts/playground/push-db-journal-lib.php`
- `scripts/playground/production-shaped-route-smoke.mjs`
- `scripts/playground/production-plugin-package-smoke.mjs`

The strongest current claim should remain: executable safety-model and local
Playground evidence for push invariants.

## Current Branch Re-Audit

The auth and packaging hardening in this cycle improves route shape and
misconfiguration resistance, but it does not close the production push gate.

| Claim trap | Scenario | Missing proof | Required change |
| --- | --- | --- | --- |
| Packaged plugin can look production-ready while still using lab internals | The temporary `reprint-push` package mounts `/wp-json/reprint/v1/push/*`, disables the public lab namespace, applies eight fixture mutations, and reports `finalMatchesLocal: true`. A release note could present that as production push. | The package still copies Playground files into `includes/`, and preflight still advertises `routeProfile.labBacked: true`. The smoke proves route names, cross-route receipt binding, signed-store cleanup, and fixture apply only. | Make the packaged production namespace fail if any route profile is lab-backed or any implementation path resolves to Playground internals. Keep the smoke as route-shape evidence, but require separate production-backed auth, journal, storage, and recovery tests for readiness claims. |
| Signed-store cleanup is hygiene, not credential lifecycle | Preflight deletes one expired lab session and one expired lab nonce while retaining unexpired records, then the push applies fixtures. | No production credential model proves push-only scope, rotation, revocation, replay-window retention, nonce/session cleanup under concurrency, multisite scoping, rate limits, TLS deployment, or durable audit ownership. The Application Password path still grants broad admin capability in the lab. | Define production push credentials and lifecycle separately from the lab HMAC store. Prove replay cleanup and active-session behavior under concurrent requests before treating auth as production evidence. |
| Graph hardening is still resource-key hardening | Local creates or edits posts, attachments, terms, users, comments, menus, orders, or serialized blocks while the live remote created related objects after pull. A row/file hash plan can appear clean while references point to the wrong remote entity after apply. | No WordPress graph fixture proves identity allocation, tombstones, postmeta/term/menu/attachment relationships, GUID/path rewriting, serialized block references, user/comment ownership, order IDs, or referential-integrity validation. | Add graph-aware planning and tests, or block graph-mutating pushes until identity mapping and reference rewriting are proven against real WordPress data shapes. |
| Visible fixture equality can hide side effects | A smoke says the final visible fixture surface matches local, while preflight intentionally mutates signed-session and nonce option rows and plugin activation can change unrelated runtime state. | No success criterion enumerates all permitted side effects and all hidden resource classes that must be preserved, redacted, or journaled. Fixture equality does not cover auth stores, cron, generated files, object cache state, plugin migration rows, roles/caps, or custom tables outside the fixture allowlist. | Production success must compare the planned target graph plus a declared side-effect manifest. Any side effect outside that manifest must block or become explicit audited evidence. |
| Conflict resolution language can still become stale overwrite permission | An operator manually reviews a conflict, then retries after the source changes again or after a prior partial apply left blocked recovery evidence. | No reviewed-resolution artifact proves base/local/remote values were preserved, who approved the action, what remote evidence was retained, and that retry rebuilt the plan from fresh live remote hashes. | Treat every manual resolution as a new plan. Preserve remote evidence, bind approval to a fresh snapshot, and reject retries that skip current storage-boundary preconditions. |

## Release-Blocking Critic Findings

| Blocker | Scenario | Missing proof | Required change before production-grade claim |
| --- | --- | --- | --- |
| Production-shaped endpoint is still lab-backed | A packaged plugin exposes `/wp-json/reprint/v1/push/apply`, a user or status page treats the route name as production, and a live site mutates through callbacks and journals built for local Playground fixtures. | No production Reprint push implementation proves push-scoped credentials, durable sessions, nonce cleanup, replay retention, TLS deployment policy, production audit rows, or non-lab journal/apply internals. The current route profile says `labBacked: true`. | Replace lab callbacks and lab journal internals under the production namespace with production implementations. Keep the route-shape test, but add a test that fails if production routes report lab-backed scope or use lab-only storage. |
| Coverage can be incomplete while the plan says ready | The remote has WooCommerce HPOS tables, Action Scheduler rows, mu-plugin settings, generated CSS, media derivatives, multisite network tables, or plugin custom tables that are not listed, while local pushes related code, content, or options. | No signed completed coverage manifest proves every affected core, plugin, theme, upload, generated-file, custom-table, user/order, and multisite surface was scanned or explicitly blocked. A ZS-Sync-style scan cursor only proves what the scanner knows how to enumerate. | Make unknown or incomplete coverage a hard block. Bind completed coverage hashes into dry-run and apply evidence, and require semantic drivers to declare the resource graph they cover. |
| Manual resolution is not a safe conflict policy yet | A user resolves a conflict in wp-admin, or chooses "take local" for a resource changed on the source after pull, then retries from an older plan or receipt. | No reviewed-resolution artifact preserves the remote value, base/local/remote diffs, reviewer identity, selected action, retry state, and fresh live-remote revalidation. Without that, manual resolution can become a stale overwrite permission. | Treat conflict resolution as a new auditable plan. Preserve remote evidence, fetch a fresh remote snapshot, rebuild the plan, and reject stale approvals that bypass current preconditions. |
| Storage-boundary guards are fixture slices | A remote edit lands after dry-run and after the JIT hash check but before the actual MySQL update, insert, delete, schema change, plugin activation write, file rename, or unlink. | Current proof covers selected fixture row updates and accepted fixture upload file writes. It does not prove MySQL/InnoDB transactions or locks, arbitrary inserts/deletes, schema writes, plugin file publish, symlink/path policy, target `fsync`, rollback, or storage guards for activation side effects. | Implement production storage guards for each supported write primitive and run race/kill tests proving stale writes affect zero targets and preserve the remote at the storage boundary. |
| Cross-store crash consistency is not production-proven | A plugin update publishes PHP files, changes `active_plugins`, runs migrations, updates options/custom tables, refreshes generated files, and the host dies between boundaries. | No production journal proves every file, row, activation state, generated artifact, and commit marker is old, new, or blocked after hard crashes at each durable boundary. Current DB and file journal smokes are local Playground SQLite/host-mount evidence. | Build a durable production journal and kill matrix across journal append, DB write, file write, activation, finalization, replay, stale-claim retry, and recovery inspect. Never report success unless final hashes and durable commit records agree. |
| Stale-claim retry lacks production fencing | One worker opens an apply claim, stalls under load, another worker marks it stale and retries, then the first worker resumes and writes with older evidence. | The all-old stale-claim smoke proves one deterministic lab path. It does not prove production leases, fencing tokens, monotonic claim ownership, expiry rules, shared-DB race behavior, or stale-worker write prevention. | Add a production lease/fencing model and multi-worker tests where stale workers try to resume after a retry claim advances. |
| Plugin allowlists are not semantic closure | An allowlisted plugin option or postmeta value is pushed while the plugin also depends on serialized counters, cron rows, generated CSS, custom tables, roles/capabilities, activation hooks, or versioned migrations. | No plugin validator contract declares the complete resource graph, supported create/update/delete operations, side effects, version constraints, post-apply checks, rollback/block behavior, and redaction schema. Fixture forms and fixture atomic-install paths prove only exact allowlists. | Define plugin validator/driver contracts and prove at least one real plugin beyond fixtures. Unknown plugin-owned state must preserve remote and stop. |
| "Non-overlapping" resources can still corrupt meaning | Local changes plugin code or theme templates while the remote preserves a changed option, attachment metadata row, taxonomy relation, rewrite rule, block pattern, or generated cache that the new code will reinterpret on next load. | No dependency graph or compatibility validator proves remote-only resources remain valid after local code/content changes. Separate resource keys are not enough to prove semantic independence. | Promote coupled resources into atomic groups or require validators that explicitly approve preserved remote-only state under the new code/content. |
| WordPress identity and reference rewriting are unresolved | Local creates posts, attachments, terms, users, comments, orders, or upload paths that collide with remote objects created after pull; serialized blocks, GUIDs, postmeta, menus, and relationships then point at the wrong entity. | No ID allocation, remapping, reference rewrite, or referential-integrity validator exists across the WordPress graph. Row-level compare/write cannot prove no data loss for newly created entities. | Add graph-aware identity and reference handling, or block graph-mutating pushes that cannot prove safe remapping and relationship integrity. |
| Delete/restore policy is under-specified | The remote deleted a post for moderation, legal, or editorial reasons while local edited it; a later "take local" operation would recreate it. Another case: local deletes a file while remote changes metadata for it. | The design stops conflicts, but does not define tombstones, retention windows, reviewed restore/delete policy, or required evidence for intentional resurrection. | Preserve remote delete evidence, require explicit reviewed restore plans, and revalidate the live remote before any restore/delete mutation. |
| Environment-specific resources can leak or break production | Local clone state includes `siteurl`, `home`, salts, SMTP/API keys, object-cache configuration, absolute upload paths, cron schedules, or local-only plugin settings. | No production denylist/transform policy is proven across core and plugin resources. The protocol describes defaults, but the executor does not prove these resources are blocked or transformed safely in production. | Enforce deny-by-default environment resource handling with tests for core options, secrets, paths, cron/cache/runtime data, and plugin-specific environment state. |
| Audit and redaction are not a production policy | A blocked recovery artifact includes order details, form entries, membership data, private upload paths, option payloads, API keys, or absolute paths while the operator still needs enough detail to audit and retry. | Current redaction is fixture/forbidden-string oriented. There is no production allowlist schema, privacy review, retention policy, operator report contract, or proof for arbitrary plugin payloads. | Define production audit schemas with stable hashes, redacted diffs, bounded retention, and operator-facing recovery reports that are useful without leaking private data. |
| Release tests do not match release claims | Documentation cites passing smokes and the project gradually sounds production-safe because route, auth, journal, storage guard, and fixture plugin tests pass. | The strongest Playground smokes remain optional/manual, and no single release gate runs production-shaped endpoint, auth, storage, recovery, plugin, graph, redaction, and performance proof. | Create a release suite and CI gate. Any excluded smoke must be labeled non-release evidence, and production-grade wording must be blocked unless the full gate passes. |
| Speed remains a model, not measured reliability | Large-site push is described through performance models while real mutation still needs receipts, coverage, journals, storage guards, and retries. | No benchmark moves large files/tables through the executor with memory ceilings, chunk cursors, retries, recovery inspection, and safety checks enabled. | Run large-file and large-table benchmarks through the same guarded executor path intended for release, and publish limits only for the measured path. |

## Source Comparison

### Reprint

Reprint source notes support the staged, resumable transport shape: preflight,
files pull, DB pull, DB apply, flat docroot, runtime apply, and start. That
helps push with chunking and budgets, but it does not prove mutation safety.

Scenario: push applies plugin files and then related rows, but the process dies
after files are visible and before the DB commit or journal finalization.

Missing proof: the production Reprint boundary does not yet show guarded
per-chunk mutation, durable recovery state, rollback/blocked artifacts, and
operator audit records for every remote write boundary.

Required change: production push must extend Reprint with mutation-scoped auth,
coverage-bound planning, storage-boundary guards, and a durable journal. Pull
resumability cannot be treated as push reliability.

### ZS-Sync

ZS-Sync source notes are valuable for scanner composition, cursors, resource
providers, and bounded changed-resource listing. They are not a source-site
mutation policy.

Scenario: a scanner cursor completes for known core files and tables while an
active plugin stores state in an unregistered custom table or generated file.

Missing proof: no source-site coverage contract binds scanner cursors to all
active plugins, mu-plugins, themes, uploads, generated artifacts, custom
tables, and multisite scopes that can be affected by the push.

Required change: use ZS-Sync-style scanning as planning input only. A ready push
requires complete coverage for the affected scope, or the unknown scope must
block apply.

### ForkPress

ForkPress source notes provide the closest production reliability target:
three-way merge records, reviewed conflict resolution, plugin validators,
revalidation, and crash consistency where failure is old, new, or blocked with
artifacts.

Scenario: a user manually resolves a conflict and retries, or a plugin publish
fails during activation.

Missing proof: the current design borrows the invariants but not the full
production lifecycle: reviewed resolution artifacts, semantic validator
contracts, production storage durability, and old/new/blocked proof for every
visible boundary.

Required change: adopt the ForkPress-grade lifecycle before making
ForkPress-grade claims. Manual resolution is success only when the remote is
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

## Minimum Production Claim Gates

Before any production-grade push claim, the project needs all of these:

1. Production Reprint push endpoints whose implementation is not lab-backed.
2. Production-scoped auth, credential lifecycle, TLS policy, session storage,
   nonce/replay cleanup, operator identity, and audit retention.
3. Complete pull-base and live remote coverage manifests, including unknown
   plugin/custom-table/generated resources as hard blockers.
4. Storage-boundary guarded writes for every supported DB and filesystem
   mutation kind.
5. A durable production journal with kill-at-every-boundary recovery tests.
6. Reviewed conflict-resolution artifacts that preserve remote evidence and
   force fresh revalidation before retry.
7. WordPress graph identity and reference rewriting, or explicit blocking for
   graph-mutating pushes.
8. Plugin semantic driver contracts with at least one real plugin proof and a
   conservative fallback for unknown plugin state.
9. Production audit/redaction schemas with retention and operator reports.
10. A release suite and CI gate that runs the safety-critical unit,
    Playground, auth, storage, recovery, plugin, graph, redaction, and
    performance checks.

Until then, the project is a strong lab for the right invariants, not
production-grade source-site push support.
