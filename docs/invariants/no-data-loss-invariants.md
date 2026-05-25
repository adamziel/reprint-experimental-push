# No Data Loss Invariants

This note captures the planner boundary in plain language.

## May Apply Automatically

- Local creates, updates, deletes, and file type swaps when the live remote
  still matches the pull base.
- Matching independent edits, deletes, restores, and file type swaps.
- A live-preconditioned mutation may still coexist with matching independent
  resources in the same plan, as long as each mutation keeps its own live
  remote hash check.
- Remote-only plugin metadata, plugin files, activation state, and removals
  stay preserved as `keep-remote` when the local side does not touch them.
- A live-preconditioned file delete may still coexist with a matching
  independent file type swap and any unrelated matching row edit, with the
  safe resources remaining `already-in-sync` and remote-only plugin drift
  remaining `keep-remote`.

## Must Preserve

- Any remote-only change the local side does not touch, including plugin
  removals.
- Remote descendants that would be hidden by a local delete or file type
  swap.
- Conflict and blocker evidence without raw file bodies, row contents, option
  values, or plugin payloads.
- Matched independent resources in `already-in-sync` state rather than
  converting them into mutations when another resource in the same plan needs
  a live remote precondition.

## Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Any local delete or file type swap that would overwrite a remote-only
  plugin change instead of preserving it.
- Any local delete that would hide a live remote descendant.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Plugin-owned deletions when the owner context is stale or missing.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
