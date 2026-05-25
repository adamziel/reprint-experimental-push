# No Overwrite Boundaries

This note is the short form of the planner policy in
[No Overwrite Invariants](no-overwrite.md).

## Planner May Apply Automatically

- Local creates, updates, deletions, and file type swaps when the live remote
  still matches the pull base and the file topology check says no remote
  ancestor or descendant would be hidden.
- Matching independent edits, including deletes, file edits, and file type
  swaps that end on the same hash.
- Matching independent edits may appear alongside a live-preconditioned
  deletion in the same plan; the matching resources still stay
  `already-in-sync` and do not weaken the deletion precondition.
- Local mutations on unrelated resources while remote-only plugin metadata,
  plugin files, or plugin removals are preserved.
- Remote-only plugin drift stays preserved when the local plan also contains
  unrelated matching independent edits or file type swaps.
- Plugin-context and plugin-owned data mutations only when their required live
  remote plugin context still matches the pull base or the local side
  independently matches the live remote context.
- If the live remote removed the owning plugin, any local plugin-owned data
  mutation for that plugin must stop.
- A local mutation that still touches a remotely removed plugin's files or
  plugin-owned data must stop.

Every automatic mutation still needs a live remote precondition bound to the
mutation id, the resource key, the remote hash observed during planning, and
`checkedAgainst: live-remote`.

## Planner Must Preserve

- Any remote-only change the local side does not touch.
- Remote-only plugin metadata, plugin files, activation state, and removals.
- Remote descendants that would be hidden by a local delete or type swap.
- Conflict and blocker evidence without raw file bodies, row contents, option
  values, or plugin payloads.

## Planner Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Plugin-file or plugin-owned-data mutations when the live remote plugin was
  removed and the local side still touches that plugin.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
