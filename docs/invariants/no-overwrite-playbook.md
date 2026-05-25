# No Overwrite Playbook

This is the short operational version of the planner invariant policy.

## May Apply Automatically

- Local creates, updates, deletions, and file type swaps when the live remote
  resource still matches the pull base and the topology check does not hide a
  remote ancestor or descendant.
- Matching independent edits, including matching deletions, file edits, and
  file type swaps.
- Matching independent deletions, edits, and file type swaps may coexist with a
  live-preconditioned delete in the same plan while remote-only plugin drift is
  preserved through apply.
- The same rule still holds when the remote side has removed the plugin
  entirely; the planner keeps that removal preserved and does not weaken the
  unrelated delete precondition.
- Matching independent edits may coexist with a live-preconditioned deletion
  while remote-only plugin drift remains preserved in the same plan.
- A live-preconditioned delete may still apply alongside a matching
  independent edit and file type swap; the matching resources stay
  `already-in-sync`, the delete keeps its own live remote precondition, and
  unrelated remote-only plugin drift stays preserved through apply.
- Local mutations on unrelated resources while remote-only plugin metadata,
  plugin files, or plugin removals are preserved.
- Plugin-context and plugin-owned data mutations only when their required live
  remote plugin context still matches the pull base or the local side
  independently matches the live remote context.
- Unsupported plugin-owned resources must stop even when unrelated remote-only
  plugin drift is present; the blocker stays scoped to the owned resource and
  the remote drift remains preserved.

## Must Preserve

- Any remote-only change the local side does not touch.
- Remote-only plugin metadata, plugin files, plugin activation state, and
  plugin removals.
- Remote descendants that would be hidden by a local delete or type swap.
- Conflict and blocker evidence without raw file bodies, row contents, or
  plugin payload values.
- Preserve matched independent resources in `already-in-sync` state rather than
  converting them into mutations when a separate live-preconditioned delete is
  present.

## Must Stop

- Same-resource local/remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Plugin-owned deletions when the owner context is stale and the local side did
  not independently match the live remote context.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
