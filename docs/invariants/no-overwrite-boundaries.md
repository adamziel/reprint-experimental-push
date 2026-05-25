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
- Matching independent deletes, edits, and file type swaps may appear
  alongside a live-preconditioned deletion in the same plan; the matching
  resources still stay `already-in-sync` and do not weaken the deletion
  precondition.
- Matching independent deletions, edits, and file type swaps can also appear
  alongside a live-preconditioned deletion; they still stay `already-in-sync`,
  and the remote plugin drift stays preserved.
- Matching independent row deletions, edits, and file type swaps can also
  appear alongside a live-preconditioned row deletion; they still stay
  `already-in-sync`, and the remote plugin drift stays preserved.
- Matching independent row deletions, edits, and file type swaps can also
  appear alongside a live-preconditioned file deletion; they still stay
  `already-in-sync`, and the remote plugin drift stays preserved through
  apply.
- The same rule holds when the plan also includes a matching independent edit
  or file type swap plus unrelated remote-only plugin drift: the safe
  resources stay `already-in-sync`, the plugin drift stays `keep-remote`, and
  the delete still needs its own live remote precondition.
- A live-preconditioned file delete may still apply alongside a matching
  independent edit and file type swap; the matching resources stay
  `already-in-sync`, the delete keeps its own live remote precondition, and
  unrelated remote-only plugin drift stays `keep-remote`.
- The planner can still stop on a plugin-owned mutation while preserving
  unrelated matching independent edits, deletions, and file type swaps as
  `already-in-sync`, and remote-only plugin drift remains `keep-remote`.
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
- File delete conflicts must stop when the live remote changed the same file,
  even if unrelated remote-only plugin drift is present elsewhere; the
  conflict evidence stays redacted and the plugin drift stays preserved.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Plugin-file or plugin-owned-data mutations when the live remote plugin was
  removed and the local side still touches that plugin.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
