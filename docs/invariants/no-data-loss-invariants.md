# No Data Loss Invariants

This note summarizes the planner's no-overwrite contract.

## May Apply Automatically

- Local changes when the live remote resource still matches the pull base.
- Matching independent edits, including creates, updates, deletes, and file
  type swaps that end on the same hash.
- A live-preconditioned mutation may share a plan with matching independent
  resources as long as each emitted mutation keeps its own live remote
  precondition.
- Remote-only plugin metadata, plugin files, activation state, and removals
  stay preserved while unrelated safe mutations apply.

## Must Preserve

- Any remote-only change the local side does not touch.
- Remote descendants that would be hidden by a local delete or file type swap.
- Conflict and blocker evidence without raw file bodies, row contents, plugin
  payloads, or other secret values.
- Independent resources that already match the remote hash should stay
  `already-in-sync` instead of being rewritten as mutations.

## Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Plugin-owned or plugin-context mutations when the required live remote plugin
  context drifted and the local side did not independently match it.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.

