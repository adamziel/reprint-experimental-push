# Critic Audit

This audit treats the current repository as an executable safety model, not as
production push support. The JSON planner proves useful local invariants:
three-way comparison, remote preconditions, direct conflict refusal, and a
staged in-memory apply. It does not yet prove that a live WordPress source site
can be mutated without data loss.

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

11. Keep public status language narrow.

The project can currently claim a JSON snapshot safety model with scenario
tests. It should not claim production-grade push, production atomicity, or
general no-data-loss behavior until the items above are implemented and tested.
