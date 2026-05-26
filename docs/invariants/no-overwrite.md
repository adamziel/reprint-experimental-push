# No Overwrite Invariants

The planner compares the pulled base, the edited local snapshot, and the live
remote snapshot. It may only produce mutations that can be rechecked against
the live remote immediately before apply.

## May Apply Automatically

- Local creates, updates, deletions, and file type changes when the same remote
  resource still hashes exactly like the pull base and the file topology check
  proves no live remote ancestor or descendant would be hidden. A local delete
  or type swap can only proceed automatically when any affected remote
  descendant is also an unchanged base resource that is being deleted in the
  same plan.
- Independent local changes while other remote-only resources changed.
- Remote-only plugin metadata and file changes are preserved while unrelated
  local mutations on other resources are still eligible for planning.
- Local deletions remain auto-applicable only when the deleted resource still
  matches the pull base on the live remote. Remote-only changes to unrelated
  plugin metadata or plugin files do not relax that precondition.
- Remote-only plugin metadata or file changes do not block unrelated local file
  or row deletions when those deletions still satisfy the live remote hash
  check.
- Remote-only plugin metadata or file changes do not block a live-preconditioned
  delete or type swap when matching independent edits or type swaps are also
  already in sync. The planner must keep the matching resources `already-in-sync`
  and preserve the plugin drift as `keep-remote`.
- When a plan mixes a live-preconditioned deletion with matching independent
  edits or type swaps, the matching resources stay `already-in-sync` and the
  deletion remains the only automatic mutation.
- When a plan mixes a live-preconditioned deletion with a matching
  independent edit and a matching file type swap, the matching resources stay
  `already-in-sync` and unrelated remote-only plugin drift still stays
  `keep-remote`.
- The same mixed deletion/edit/type-swap boundary still holds if the remote
  side removed that plugin entirely; the unrelated deletion remains the only
  mutation and the removed plugin stays preserved as `keep-remote` evidence.
- When a plan mixes a live-preconditioned type swap with matching independent
  deletions or edits, the matching resources stay `already-in-sync` and the
  type swap remains the only automatic mutation.
- Matching independent edits where local and remote changed a resource to the
  same hash, including creations, deletions, file edits, type swaps, and
  plugin context changes; these produce `already-in-sync` decisions, not
  mutations.
- Matching independent row deletions are treated the same way: if local and
  remote independently deleted the same row, the planner records
  `already-in-sync` and preserves any unrelated remote-only plugin drift.
- A live-preconditioned delete can still apply when matching independent edit,
  type swap, or row delete resources already match the live remote; the
  unrelated remote-only plugin drift stays `keep-remote`.
- Matching independent file type swaps that land on the same hash; these also
  produce `already-in-sync` decisions, not mutations.
- Remote-only plugin changes remain preserved even when those matching
  independent edits or file type swaps are also present elsewhere in the plan.
- Plugin installs or data updates whose declared dependencies are already on
  the expected post-apply remote, or are installed by the same plan.
- Plugin metadata or plugin file mutations only when the rest of that plugin's
  live remote context still matches the pull base, or local independently
  matches the live remote context. Plugin context means the plugin metadata
  resource plus files under that plugin's directory.
- Plugin-owned data updates only when the owning plugin context in local
  matches the live remote context, or the live remote plugin files and metadata
  still match the pull base. Owner plugin context means plugin metadata plus
  files under that plugin's directory.
- Plugin-owned deletions only when the owning plugin context still matches the
  live remote context, or the local side independently matches the live remote
  owner context. Remote-only plugin drift still stays `keep-remote`.
- Reference-bearing WordPress graph rows only when each referenced target is
  present on the live remote and either that target did not drift since the
  pull base or local has independently reached the same target hash as the live
  remote. This is a narrow stale-reference guard, not a proof of general
  identity remapping.

Every automatic mutation still needs a live remote precondition bound to the
mutation id, resource key, and the remote hash seen during planning.

Every automatic mutation must include a precondition tied to the mutation id,
the resource key, the live remote hash observed during planning, and the
`checkedAgainst: live-remote` marker.

## Must Preserve

- Any remote-only resource change when local still matches the pull base.
- Remote-only plugin metadata, plugin files, activation state, and removals.
- Remote-only plugin removals are preserved just like other remote-only plugin
  changes when local does not touch that plugin.
- Remote-only plugin context changes when local wants to mutate another file or
  metadata resource for the same plugin. The planner must preserve the remote
  plugin context and refuse the stale local plugin mutation.
- Remote-only plugin context changes must not block unrelated local mutations
  on different resources when those mutations still satisfy the live remote
  precondition rule.
- Remote-only owner plugin context changes when local wants to mutate data owned
  by that plugin. The planner must preserve the remote plugin context and refuse
  the stale plugin-owned data mutation.
- Remote-only plugin drift does not block an unrelated plugin-owned delete when
  the owning plugin context is still healthy and the delete carries its own
  live remote precondition.
- Remote descendants that would be hidden by a local file deletion or type swap
  unless the plan also proves the descendant is an unchanged base resource
  being deleted.
- Remote-only plugin metadata and plugin files when local deletes or updates an
  ordinary non-plugin resource. Those remote-only plugin changes remain
  `keep-remote` decisions.
- Remote-only plugin removals behave the same way as other remote-only plugin
  drift when local mutations touch unrelated ordinary resources. The planner
  must preserve the remote plugin removal while still auto-applying only the
  safe unrelated mutation.
- Remote-only plugin removals also stay preserved when a live-preconditioned
  delete or type swap is mixed with matching independent edits or type swaps.
  The removal stays `keep-remote`, and the matching resources stay
  `already-in-sync`.
- Unsafe file topology mutations are not emitted once a stop condition is
  found. Independent mutations may remain in the conflicted plan as
  hash-preconditioned audit evidence, but apply must refuse the whole non-ready
  plan.
- Conflict evidence must identify resources, hashes, change kinds, presence,
  and file types, but not raw file bodies, row contents, option values, or
  plugin configuration payloads.
- When a conflict stops the plan, unrelated safe mutations may remain as
  hash-preconditioned evidence, but they still do not authorize the conflicted
  resource to apply.
- Atomic dependency evidence must keep only normalized plugin names, version
  requirements, hash requirements, and activation requirements. Raw dependency
  payload fields from push intents are not copied into blockers or
  atomic-group dependency summaries.
- WordPress graph identity blocker evidence must keep relationship keys, source
  and target resource keys, target hashes, and change kinds only. It must not
  copy raw post content, postmeta values, term payloads, serialized blocks, menu
  payloads, GUID values, option values, or raw row contents.
- Remote-only plugin removals, metadata changes, and file changes are preserved
  the same way as other remote-only plugin context changes. Local edits to
  unrelated resources may still proceed if their own live remote preconditions
  are satisfied.
- Matching independent deletions and edits stay in sync even when remote-only
  plugin drift is present elsewhere in the plan; the plugin drift remains
  `keep-remote` and does not relax the live precondition for the actual
  mutation.
- Safe preservation of unrelated remote-only plugin drift does not relax the
  live-precondition rule for a deletion, edit, or type swap. The mutation is
  still only eligible if its own live remote hash check is present.
- If local still touches a plugin's files or plugin-owned data after that plugin
  was removed remotely, the planner must stop rather than infer harmless drift.

## Must Preserve Live Evidence

- The remote hash observed during planning for every mutation that remains
  eligible.
- The unchanged remote resource behind a `keep-remote` decision.
- The related remote resource named by a conflict or blocker.
- The independent local mutation evidence for any plan that becomes conflicted,
  so long as the mutation itself was still safe to compute before the stop
  condition was discovered.

## Must Stop

- Local and remote changed the same resource to different hashes.
- Local deletion versus remote update, local update versus remote deletion, and
  plugin-owned data changes without a plugin-specific merge policy.
- Plugin-owned deletions without explicit delete support in the plugin-owned
  policy. The planner must stop rather than assume a stale plugin-owned row
  may be removed safely.
- Plugin metadata or plugin file changes when another live remote context
  resource for that plugin changed since the pull base and local does not match
  that live owner context.
- Plugin-owned data changes when the live remote owner plugin files or metadata
  changed since the pull base and local does not match that live owner context.
- Plugin-owned deletions when the owning plugin context is stale, even if the
  rest of the plan only contains unrelated remote-only plugin drift. The
  planner must preserve the remote plugin changes and stop on the stale
  plugin-owned delete.
- Plugin-owned deletions remain blocked even with explicit delete opt-in when
  the remote removed the owning plugin and the local plan still touches that
  owner context. The stale owner context wins over the unrelated safe edit.
- Plugin-owned deletions when the owning plugin context no longer matches the
  live remote context, even if unrelated remote-only plugin drift is present.
- Plugin-owned deletions keep blocking when the owner plugin was removed
  remotely and the local plan opts into delete support for that row. Delete
  support does not override the stale owner-context stop.
- Unrelated remote-only plugin drift does not make a stale plugin-context
  mutation safe. If local touches the same plugin's files or plugin-owned data,
  stop.
- Plugin-owned data changes whose declared driver does not match the resource
  table, such as `wp-option` for a `wp_postmeta` row.
- WordPress graph mutations that reference a graph target whose live remote
  hash changed since the pull base while local does not match that live remote
  target hash. This includes stale local `wp_postmeta.post_id` writes pointing
  at a post identity created on the remote after pull.
- WordPress graph mutations that reference a graph target absent from the live
  remote. Creating new target identities and rewriting relationship rows in the
  same plan remains blocked until an identity-map/rewrite proof exists.
- WordPress revision graph rows. The planner must stop on `post_type =
  revision` instead of pretending revision history is a regular post resource.
- WordPress navigation menu item rows. The planner must stop on
  `post_type = nav_menu_item` instead of treating menu items as ordinary posts.
- WordPress post-parent graph rows. The planner must stop when `post_parent`
  points at a missing live remote post identity and must still preserve any
  unrelated remote-only plugin drift in the conflict evidence.
- File topology conflicts where applying a local file or type change would
  require overwriting, removing, or hiding a live remote ancestor or descendant.
  The conflicting file mutation and its precondition must be suppressed rather
  than left as an apply candidate.
- A file delete that the remote turned into a directory remains blocked even
  if an unrelated file delete is already matching the live remote and remote
  plugin drift is otherwise safe to keep.
- File topology conflicts remain blocked even when other resources are already
  `already-in-sync` and unrelated remote-only plugin drift is preserved. The
  planner must still stop on the hidden file mutation and keep the evidence
  bounded.
- Safe preservation of unrelated remote-only plugin drift does not authorize a
  stale plugin-context mutation. If the local plan touches the same plugin's
  files or plugin-owned data, the planner must stop instead of assuming the
  remote plugin drift is harmless.
- Remote-only plugin removal does not make a stale local plugin-file or
  plugin-owned-data mutation safe. If the local plan still touches that plugin,
  stop.
- Local file deletions and type swaps when the remote resource changed since
  pull and local does not independently match the live remote hash.
- Atomic groups with missing plugin dependencies after considering the expected
  post-apply remote state and planned plugin mutations.
- Any internally generated mutation that lacks a matching live remote
  precondition.
- Any forged ready plan that is missing the mutation's live remote precondition
  or that points at a different resource hash than the one observed during
  planning.
- Any mutation whose target hash drifts after dry-run or initial apply
  validation but before that specific mutation write.
- Any supported fixture DB update whose stored row columns or required fixture
  ownership marker drift after the JIT hash check but before the guarded SQL
  `UPDATE`.
- Any supported existing fixture file update whose live file storage hash
  drifts after the JIT hash check but before the guarded file rename.

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

The storage-boundary file write smoke adds a narrow guarded filesystem proof
after the JIT hash passes. Accepted fixture upload file updates and creates
compare the live file bytes/hash against the storage value observed after JIT,
write the planned content to a temp file in the same directory, then rename
after the boundary comparison. Accepted fixture upload file deletes compare the
same storage value before unlinking. The positive smoke covers an existing
fixture upload file update, a fixture upload file create, and a fixture upload
file delete with `storageGuard.outcome: applied`.

If the file drifts after JIT but before update, create, or delete, apply
returns `PRECONDITION_FAILED`, preserves the drifted file state, writes no
`mutation-applied` for the failed file, writes no later mutations, and writes
no `apply-committed`. Same key/body replay is non-mutating with no fresh
mutation work; same key/different body remains an idempotency conflict.

The file `storageGuard` evidence is hash-only: boundary
`filesystem-compare-rename` for update/create or `filesystem-compare-unlink`
for delete, driver, operation, logical fixture path, compared fields, expected
resource/storage hashes, actual/planned storage hashes, physical path hash, and
outcome. It does not include raw file contents or absolute host paths.

This is lab no-overwrite evidence, not production DB or filesystem durability,
production Reprint HTTP mutation, generic MySQL/InnoDB or filesystem
compare-and-swap proof, storage `fsync`, transactions, locking, rollback,
arbitrary file guarding, plugin activation storage guarding, or arbitrary
plugin/custom-table semantic safety. The code path supports named fixture
plugin file update paths, but the standalone file smoke exercises upload-file
update/create/delete only.
