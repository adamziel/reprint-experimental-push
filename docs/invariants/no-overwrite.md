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

Stopping means the plan status is `conflict` or `blocked`; apply must refuse
the plan and leave the remote snapshot unchanged.
