# No Overwrite Invariants

The planner compares the pulled base, the edited local snapshot, and the live
remote snapshot. It may only produce mutations that can be rechecked against
the live remote immediately before apply.

## May Apply Automatically

- Local creates, updates, deletions, and file type changes when the same remote
  resource still hashes exactly like the pull base.
- Independent local changes while other remote-only resources changed.
- Matching independent edits where local and remote changed a resource to the
  same hash; these produce `already-in-sync` decisions, not mutations.
- Plugin installs or data updates whose declared dependencies are already on
  the expected post-apply remote, or are installed by the same plan.

Every automatic mutation must include a precondition tied to the mutation id,
the resource key, the live remote hash observed during planning, and the
`checkedAgainst: live-remote` marker.

## Must Preserve

- Any remote-only resource change when local still matches the pull base.
- Remote-only plugin metadata, plugin files, activation state, and removals.
- Remote descendants that would be hidden by a local file type swap unless the
  plan also proves the descendant is an unchanged base resource being deleted.
- Conflict evidence must identify resources, hashes, change kinds, presence,
  and file types, but not raw file bodies, row contents, option values, or
  plugin configuration payloads.

## Must Stop

- Local and remote changed the same resource to different hashes.
- Local deletion versus remote update, local update versus remote deletion, and
  plugin-owned data changes without a plugin-specific merge policy.
- File topology conflicts where applying a local file or type change would
  require overwriting or hiding a live remote ancestor or descendant.
- Atomic groups with missing plugin dependencies after considering the expected
  post-apply remote state and planned plugin mutations.
- Any internally generated mutation that lacks a matching live remote
  precondition.
- Any mutation whose target hash drifts after dry-run or initial apply
  validation but before that specific mutation write.
- Any supported fixture DB update whose stored row columns or required fixture
  ownership marker drift after the JIT hash check but before the guarded SQL
  `UPDATE`.

Stopping means the plan status is `conflict` or `blocked`; apply must refuse
the plan and leave the remote snapshot unchanged.

## Just-In-Time Apply Evidence

The lab apply path now re-hashes each mutation's own resource immediately
before the write. The comparison uses that mutation's bound precondition hash;
it does not reuse the earlier dry-run snapshot, receipt, or accepted
precondition list as liveness proof. If the pre-write live hash differs, apply
returns `PRECONDITION_FAILED`, preserves the drifted value, writes no
`mutation-applied` event for that mutation, writes no later mutations, and
writes no `apply-committed`.

The DB journal records hash-only evidence for this boundary:
`preWriteExpectedHash`, `preWriteActualHash`, `preconditionCheck`, mutation
metadata, and recovery counts/targets. A same-key/body retry after a rejected
mid-apply drift replays the rejection with no fresh mutation work; same
key/different body remains an idempotency conflict.

There is one fixture-scoped staged plugin allowance for atomic activation:
`preconditionCheck: same-apply-staged` is permitted only when an
activation-style plugin mutation planned `active: true`, the live plugin hash
matches that same planned value with `active` forced false, and
`preWriteStagingProof` points to an earlier same-apply plugin file mutation
covered by the declared ready atomic group. Forged mutation-local group ids,
missing declared group coverage, and planned inactive plugin mutations must not
use this exception.

The storage-boundary DB update smoke adds a narrow guarded SQL write proof
after the JIT hash passes. Existing fixture row update mutations in `wp_posts`,
allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact
fixture `wp_reprint_push_forms_lab` positive rows use one
`$wpdb->query($wpdb->prepare(...))` `UPDATE` whose `WHERE` compares expected
stored columns. For posts and postmeta parent ownership, marker-empty drift is
also checked at the SQL boundary. A zero-row guarded update is stale-at-write:
apply returns `PRECONDITION_FAILED`, preserves the drifted or absent target,
writes no `mutation-applied` for the failed target, writes no later mutations,
and writes no `apply-committed`.

The `storageGuard` evidence is hash-only: boundary, driver, logical and
physical table, operation, compared column names, expected resource and storage
hashes, rows affected, outcome, and SQL shape hash. It does not include raw SQL
values, post content, option values, meta values, forms payloads, snapshots, or
plugin payloads.

This is lab no-overwrite evidence, not production DB durability, production
Reprint HTTP mutation, generic MySQL/InnoDB compare-and-swap proof,
transactions, locking, rollback, inserts/deletes/files/plugin activation
storage guarding, or arbitrary plugin/custom-table semantic safety.
