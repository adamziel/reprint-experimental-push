# Critic Audit

This audit treats the current repository as an executable safety model, not as
production push support. The current evidence is broader than the original
JSON planner: it now includes fixture-scoped Playground source mutation,
authenticated lab HTTP aliases, DB idempotency/journal smokes, process-kill
classification, missing-commit finalization, all-old stale-claim retry,
just-in-time drift refusal, narrow storage-boundary DB/file guards, a forms lab
custom-table driver, and hard-coded fixture plugin install atomicity. That is
still lab evidence. It does not yet prove that an arbitrary live WordPress
source site can be mutated without data loss.

## Current Evidence Boundary

The strongest current proof is that a narrow fixture system refuses many stale,
conflicting, forged, and replayed writes. The proof boundary is also clear:

- The authenticated source-site path is still a local Playground lab namespace,
  not a production Reprint push endpoint with production credential binding,
  TLS deployment requirements, nonce/session cleanup, and durable audit
  retention.
- The DB journal and storage-boundary guards are fixture-scoped local
  Playground/SQLite and host-mount evidence. They are not proof of production
  MySQL/InnoDB locking, filesystem `fsync`, production locks or leases,
  exactly-once writes, rollback, or automatic repair.
- The plugin safety evidence is allowlist-scoped. It proves one fixture forms
  driver and one fixture plugin dependency path; it does not prove arbitrary
  plugin options, serialized state, activation hooks, custom tables, generated
  files, or rollback after plugin side effects.
- The resource model still enumerates files, plugins, and rows. It does not yet
  prove complete WordPress graph identity for posts, postmeta, terms,
  attachments, users, comments, orders, menus, GUIDs, paths, multisite state,
  and serialized references.

Any status language should call the current work "fixture-scoped lab evidence"
or "executable safety model." It should not call it production push support.

## Source Comparison

### Reprint

The source notes describe Reprint pull as resumable, staged, streamed, and
budgeted. The push design borrows the staged shape, but push is a mutation path
and needs stronger proof than pull.

Scenario: a push uploads a plugin file batch and then applies related database
rows, but the process dies after the files are visible and before the database
transaction commits.

Missing proof: there is no Reprint push protocol showing per-chunk compare
preconditions, durable journals, recovery state, rollback or compensation
artifacts, and user-visible audit records for each remote mutation boundary.
The current `applyPlan()` clone-and-return model is not proof of crash safety on
filesystem plus database targets.

Scenario: the authenticated lab CLI pushes through
`/wp-json/reprint-push-lab/v1/authenticated/*` and records DB journal evidence,
then documentation starts treating that as the Reprint push transport.

Missing proof: the route namespace, credential verifier, session store,
response evidence, and replay cleanup are still lab-specific. Reprint production
push needs real endpoint names, exporter credential binding, mutation-scoped
authorization, TLS deployment policy, nonce/session retention cleanup, and
audit records that survive outside the disposable Playground fixture.

### ZS-Sync

The source notes make ZS-Sync useful for scanners, cursors, resource metadata,
and bounded resource fetches. That is input to planning, not a conflict policy
or mutation guarantee.

Scenario: the live source has a plugin custom table, uploaded media variant, or
generated config file that was not included in the remote snapshot used for
planning.

Missing proof: there is no completeness manifest proving that the planner saw
all mutable resources that can be affected by the push. Without a scanner
coverage proof, a `ready` plan may only mean "safe for the resources we happened
to list," not "safe for the source site."

Scenario: a ZS-Sync-style cursor says "scan complete" for known files and core
tables while a plugin stores state in a custom table, scheduled action rows, or
generated upload derivatives that are not registered in the resource provider.

Missing proof: there is no source-site coverage contract that binds scanner
cursors to WordPress core resources, active plugins, mu-plugins, themes,
uploads, generated files, custom tables, and multisite tables. Unknown coverage
must be a blocker, not a degraded ready plan.

### ForkPress

ForkPress has the stronger source-note model for merge auditability: conflict
records, reviewed resolutions, plugin validators, rollback, and crash recovery.
The current design borrows the stop-on-conflict stance, but not the lifecycle.

Scenario: a user manually resolves a row conflict by choosing a local value for
an option that the remote also changed after pull.

Missing proof: "manual resolution" is not success unless the remote value and
both diffs are preserved, the resolution becomes a new auditable plan, the live
remote is revalidated before mutation, and the user can retry or abandon without
losing the remote edit. The current plan records conflict hashes, but it does
not define a reviewed resolution artifact or replay semantics.

Scenario: a fixture plugin install fails during publish or activation and the
lab reports blocked/non-complete recovery, then the project claims plugin
atomicity in the ForkPress sense.

Missing proof: ForkPress-style atomicity requires a durable lifecycle for every
visible boundary: old, new, or blocked with operator artifacts. The fixture
test classifies a hard-coded path; it does not prove rollback, production
recovery, plugin fatal-error containment, or semantic validators for arbitrary
plugin side effects.

## 2026-05-24 Critic Refresh Findings

1. Lab HMAC is not production authorization.

Scenario: a production site enables pull credentials and the same shared secret
or Application Password-shaped credential is accepted for push mutation.

Missing proof: no production credential binding shows that read-only export
secrets cannot mutate, that push sessions are scoped and expired durably, that
nonce replay storage is cleaned without reopening replay windows, or that
operator identity is preserved in long-lived audit records.

2. Storage guards cover a narrow fixture slice only.

Scenario: local pushes a new attachment, deletes an old plugin file, updates
`wp_posts`, inserts postmeta, changes a taxonomy relation, and updates a custom
plugin table while a remote edit lands between JIT hash and the actual write.

Missing proof: current guarded SQL evidence is update-only for selected fixture
rows, and current file evidence covers fixture upload update/create/delete
through local Playground. There is no production guard for arbitrary inserts,
deletes, schema changes, plugin activation writes, MySQL/InnoDB lock behavior,
filesystem `fsync`, symlink handling, arbitrary plugin files, or cross-store
group commit.

3. DB journal success paths do not prove production recovery.

Scenario: PHP dies after a database row is committed, before the file rename
is durable, and before the final journal row is visible to a different process.

Missing proof: the local SQLite/host-mount process-kill smoke proves useful
classification, but not production DB durability, journal table transaction
isolation, shared-host filesystem durability, stale-claim fencing, claim
expiry, cross-process lock behavior, or exactly-once mutation under real
WordPress traffic.

4. All-old stale-claim retry needs a production lease model.

Scenario: an apply request opens a claim, the worker pauses under load, another
worker decides the claim is stale and retries, then the first worker resumes
and writes with old evidence.

Missing proof: the lab retry requires explicit abandonment evidence and validates
old hashes, which is the right direction. Production still needs leases,
fencing tokens, monotonic claim ownership, expiry rules, and tests where two
processes race against the same journal and storage targets.

5. Plugin data allowlists are not semantic validators.

Scenario: a snapshot or push intent declares a `wp-option` or `wp-postmeta`
driver for a plugin-owned serialized value, but the plugin expects internal
version counters, cron rows, cached generated CSS, or custom table records to
change with it.

Missing proof: a driver name and owner marker do not prove semantic closure.
Production needs plugin contracts that parse and validate serialized state,
list side effects, declare related resources, block unsupported deletes, and
run post-apply verification against the active plugin version.

6. Conflict resolution remains undefined after the first stop.

Scenario: a user sees a direct post conflict, manually edits the remote in
wp-admin to reconcile it, and reruns an older ready or conflict plan.

Missing proof: the only acceptable path is to preserve the remote evidence,
force a fresh remote hash listing, create a new reviewed resolution artifact,
and revalidate all preconditions before mutation. The current design does not
define the persisted resolution schema, retry UX, audit report, or stale
manual-confirmation rejection rules.

7. "Non-overlapping" resources can still invalidate each other.

Scenario: local updates a plugin file while remote changes a plugin option, or
local changes a post while remote changes its attachment metadata or taxonomy
term. The resource keys do not directly conflict.

Missing proof: no dependency graph proves these resources are semantically
independent. Production needs graph-level freezing rules, plugin/theme
validators, and partial-apply boundaries that explain which remote-only changes
remain valid after local code or content changes.

8. Redaction is not yet a production audit policy.

Scenario: a blocked recovery artifact for a WooCommerce order, form entry, or
membership plugin row is stored for operator review.

Missing proof: current redaction is fixture and forbidden-key oriented. A
production audit log needs an allowlisted schema, privacy review for plugin
payloads, bounded retention, stable hashes for forensic comparison, and enough
operator-facing detail to retry safely without leaking customer data or secrets.

9. Source notes support the architecture, not the claim.

Scenario: a status page cites Reprint resumability, ZS-Sync cursors, and
ForkPress merge recovery as if their existence proves this push path.

Missing proof: the project must show that those properties exist at the Reprint
push mutation boundary: Reprint-grade resumable chunks with compare
preconditions, ZS-Sync-grade scanner coverage for affected resources, and
ForkPress-grade conflict/recovery artifacts for every production write.

## Hidden Data-Loss Modes

1. Partial remote snapshots can produce false safety.

Scenario: a remote scanner omits `wp_wc_orders`, an upload derivative, or a
plugin-owned option while local plugin files and settings are pushed.

Missing proof: no protocol-level snapshot manifest, cursor, high-water mark, or
coverage hash proves that the remote snapshot is complete for WordPress core,
plugins, themes, uploads, generated files, and custom tables. Production push
must block when resource coverage is unknown.

2. Compare-before-apply is not enough for live concurrent writes.

Scenario: an editor updates a post, a customer places an order, or cron mutates
an option after precondition validation but before the production executor
writes its mutation.

Missing proof: no per-resource compare-and-swap is shown inside the same remote
transaction or atomic filesystem write that performs the mutation. A separate
"validate, then write" sequence still has a race on a live site.

3. Cross-store atomicity is only modeled in memory.

Scenario: a plugin install changes PHP files, `active_plugins`, plugin options,
rewrite rules, and custom tables. The file write succeeds, the database write
fails, and the site boots with an incompatible plugin state.

Missing proof: no durable group journal proves old/new/blocked recovery across
filesystem and database. A production design needs a visible recovery artifact
for every interrupted group and must not report success after a partial apply.

4. Plugin dependency closure is under-specified.

Scenario: an atomic group requires `payments`; local has `plugin:payments`, but
the group does not include all payment plugin files, activation side effects,
schema rows, options, or dependency version constraints.

Missing proof: the planner does not prove that a dependency is fully present on
the remote or fully included in the same atomic group. Production support needs
group closure over plugin files, metadata, options, custom tables, activation
hooks, and version requirements.

5. Plugin-owned data detection is too weak.

Scenario: a plugin stores settings as PHP-serialized strings in `wp_options`,
uses unmarked custom tables, writes post meta, or stores JSON blobs without a
`__pluginOwner` marker.

Missing proof: current ownership classification depends on synthetic markers or
plugin file paths. Production push needs plugin ownership registries,
validators, or conservative blocking for unknown plugin data. Generic string or
row comparison is not enough for serialized semantic state.

6. Activation hooks and migrations can mutate resources outside the plan.

Scenario: pushing a plugin update runs an activation or upgrade routine that
rewrites options, schedules cron, creates tables, deletes transients, or changes
roles.

Missing proof: no plugin driver contract lists side effects before apply or
records post-apply validation. A plan cannot claim atomicity if code executed by
the push can mutate unplanned resources.

7. Identity and reference remapping are not defined.

Scenario: local creates a post, attachment, term, user, comment, or order using
IDs that collide with remote inserts made since the pull. Serialized content,
post meta, term relationships, GUIDs, and media paths reference those IDs.

Missing proof: there is no ID allocation, remapping, reference graph rewrite, or
referential-integrity validation. Row-level put/delete is not enough for
WordPress data that stores relationships across many tables and serialized
fields.

8. Delete and restore semantics are ambiguous.

Scenario: the remote deleted a post for moderation or legal reasons while the
local site edited the same post. Another case: local deletes a media file while
remote changes metadata for it.

Missing proof: the conflict class says preserve remote and stop, but the design
does not define reviewed restore/delete policies, tombstones, retention windows,
or audit requirements. A later "take local" resolution must preserve the remote
delete record and require explicit revalidation.

9. Environment-specific resources can break the source site.

Scenario: local changes `siteurl`, `home`, salts, SMTP keys, object-cache
configuration, `active_plugins`, cron schedules, or upload paths because the
site was cloned into a local environment.

Missing proof: no denylist or environment-resource policy separates portable
content from source-site runtime configuration and secrets. Production push
must refuse or transform these resources with explicit proof.

10. File hashes ignore WordPress file metadata and binary behavior.

Scenario: a binary upload, executable bit, symlink, `.htaccess`, generated CSS,
or file with platform-specific line endings changes remotely while local has a
different representation.

Missing proof: the JSON model hashes normalized content only. Production needs
canonical file metadata, binary hashing, path normalization, symlink policy, and
safe handling of generated artifacts.

11. Database hash equality is not semantic equality for WordPress.

Scenario: two serialized option strings parse to different effective values
because of PHP serialization lengths, collation, time zones, numeric string
typing, or plugin-specific defaults.

Missing proof: stable JSON hashing is useful for the lab, but production needs
WordPress-aware canonicalization and validators. Equal JSON in the model cannot
be used as evidence that live MySQL or SQLite state is safely mergeable.

12. Remote-only changes can be preserved and still invalidated.

Scenario: the planner preserves a remote-only plugin option, but a local plugin
code push changes the schema expected by that option and the plugin migrates it
on next load.

Missing proof: non-overlapping resource decisions are not enough when code and
data are semantically coupled. Production push needs compatibility checks for
remote-only resources affected by local code changes.

13. Rollback claims need old/new/blocked proof, not best effort.

Scenario: a push writes half of a large upload batch and then the process or
host crashes. On retry, some files match local, some match remote, and some are
temporary staging files.

Missing proof: no recovery scanner classifies each target as old, new, or
blocked with artifacts. Without this, retry can become a blind overwrite or a
silent partial success.

14. Multisite and network state are absent.

Scenario: a network option, blog-specific upload path, user role, or cross-site
table changes locally while another site in the network changes remotely.

Missing proof: no resource model handles multisite table ownership, blog IDs,
network options, shared users, or cross-site references. Production-grade push
cannot assume single-site resource keys.

## Ambiguous Conflict Policy

The current conflict policy is strong only for direct, same-resource divergence:
preserve remote and stop. The policy becomes ambiguous when conflicts span
resource graphs.

Scenario: local changes a post title and featured image; remote changes the
image attachment metadata only. The direct row conflict may be on the attachment
row, but accepting local post changes could still point the remote at a broken
or stale media graph.

Missing proof: conflict records do not describe dependency graphs,
user-reviewable bundles, or safe partial-apply boundaries. A conflict policy
must say which related resources are frozen, which can still apply, and how the
user audits the remote-preserved state before retry.

Scenario: local and remote both install different versions of the same plugin,
or remote updates a dependency while local updates a dependent plugin.

Missing proof: the design has `plugin-conflict` and
`missing-plugin-dependency`, but no policy for version ranges, activation state,
rollback on fatal errors, or plugin-specific merge drivers. "Plugin present" is
not the same as "compatible and safe to activate."

Scenario: a human resolves a conflict outside the push system directly on the
remote site, then reruns apply with an older plan.

Missing proof: the old plan should fail preconditions, and the UI/CLI must guide
the user to replan from current remote evidence. The design needs to make this
the only accepted path, not allow stale manual confirmations to bypass
preconditions.

## False Reliability Claims To Avoid

- Do not call the applicator production-atomic. It is atomic for an in-memory
  cloned JSON object only.
- Do not claim "no data loss" beyond the listed planner scenarios. The current
  evidence does not cover incomplete scans, live WordPress concurrency, process
  death after durable writes, plugin side effects, or ID remapping.
- Do not treat a `ready` plan as a guarantee of apply success. It means the
  modeled remote matched the modeled preconditions at planning time; production
  apply must still revalidate at each durable mutation boundary.
- Do not treat "manual resolution" as completion unless the remote version is
  preserved, the resolution is auditable, and retry starts from a fresh plan
  against the current remote.
- Do not score three-way guarded push as production-grade reliability until the
  ForkPress-style audit and crash-consistency lifecycle exists.

## Required Before Production-Grade Push Support

1. Define the Reprint push protocol extension.

It must include capability negotiation, authentication and authorization,
schema/version checks, snapshot coverage manifests, resource budgets, chunk
boundaries, idempotency keys, and explicit mutation preconditions.

2. Prove complete and conservative resource discovery.

Use scanner metadata and cursors in the spirit of ZS-Sync, but require a
manifest that covers files, core tables, plugin tables, uploads, themes,
mu-plugins, generated artifacts, and multisite state. Unknown coverage must
block push.

3. Implement durable apply journals and recovery states.

Every mutation group needs a journal that can prove old, new, or blocked after
crash. Recovery must preserve the remote, expose artifacts to the user, and make
retry safe.

4. Move compare-and-swap into the mutation primitive.

Preconditions must be checked in the same transaction, lock, or atomic write
path that mutates the remote. A pre-apply validation pass is not sufficient for
live sites.

5. Define atomic group closure.

A plugin, theme, or feature bundle must include all coupled files, metadata,
database rows, custom tables, activation side effects, and dependencies, or the
planner must block it.

6. Add plugin validator and driver contracts.

Plugin-owned data must be handled by explicit validators or drivers when
available. Unknown plugin state should default to preserve-remote-and-stop, not
generic row merge.

7. Build identity remapping and reference validation.

The system needs deterministic handling for posts, attachments, terms, users,
comments, orders, GUIDs, paths, and serialized references before it can safely
push newly created entities.

8. Create a reviewed conflict-resolution lifecycle.

Conflict resolution must produce a new plan with preserved remote evidence,
human-readable diffs, explicit selected actions, revalidation against the live
remote, and retry/abort semantics.

9. Add environment-resource policy.

Site-local configuration, secrets, URLs, cache settings, cron, runtime files,
and generated resources need denylist, transform, or validator rules before
being eligible for push.

10. Prove behavior on real WordPress targets.

Add Docker or Playground coverage for MySQL and SQLite, filesystem mutations,
large upload chunks, plugin installs and updates, activation failures,
concurrent remote edits, cron/object-cache interactions, and kill-process
failpoints at every durable boundary.

11. Promote lab auth and idempotency into a production contract.

The production endpoint must prove push-scoped credentials, read-only export
secret rejection, TLS requirements, nonce/session persistence and cleanup,
idempotency claim fencing, stale-claim leases and expiry, same-key replay,
different-body conflict refusal, and operator identity in durable audit logs.

12. Define a production redaction and audit schema.

Conflict, dry-run, journal, and recovery artifacts must be hash-rich but
payload-safe by construction. The schema must cover core content, media, user
data, orders, form submissions, plugin rows, options, secrets, and filesystem
paths without relying on ad hoc forbidden-key checks.

13. Keep public status language narrow.

The project can currently claim a JSON snapshot safety model with scenario
tests and fixture-scoped local Playground evidence. It should not claim
production-grade push, production atomicity, or general no-data-loss behavior
until the items above are implemented and tested.
