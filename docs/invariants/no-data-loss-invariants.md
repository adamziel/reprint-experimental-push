# No Data Loss Invariants

This note summarizes the planner's no-overwrite contract.

## May Apply Automatically

- Local changes when the live remote resource still matches the pull base.
- Matching independent edits, including creates, updates, deletes, and file
  type swaps that end on the same hash.
- Matching independent deletes, restores, and file type swaps can coexist with
  a live-preconditioned delete while remote-only plugin drift stays preserved.
- Matching independent file deletes, row edits, and file type swaps can coexist
  with a live-preconditioned file delete while remote-only plugin drift stays
  preserved.
- Every automatic mutation must still carry a live remote precondition bound to
  the mutation id, resource key, and the hash observed during planning.
- A live-preconditioned mutation may share a plan with matching independent
  resources as long as each emitted mutation keeps its own live remote
  precondition.
- Remote-only plugin metadata, plugin files, activation state, and removals
  stay preserved while unrelated safe mutations apply.
- Remote-only plugin metadata, plugin files, activation state, and removals
  stay preserved even when a live-preconditioned file delete is mixed with a
  matching independent row edit and a matching file type swap.
- Matching independent deletes, edits, file type swaps, and restores may
  still be applied automatically when each emitted mutation has its own
  live remote precondition and remote-only plugin drift remains preserved.
- Matching independent deletions can coexist with a live-preconditioned
  delete and matching independent edits or file type swaps when each matching
  resource independently reaches the live remote hash.
- A live-preconditioned delete may coexist with matching independent edits
  and matching independent file type swaps when each matching resource also
  reaches the live remote hash.
- A live-preconditioned delete may coexist with a matching independent row
  restore, edit, or file type swap when each matching resource independently
  reaches the live remote hash and plugin drift remains preserved.
- A plugin-owned delete may coexist with a matching independent edit while
  remote-only plugin drift stays preserved and the delete keeps its own live
  remote precondition.
- A plugin-owned delete may coexist with a matching independent edit and file
  type swap while remote-only plugin drift stays preserved and the delete keeps
  its own live remote precondition.
- A plugin-owned delete may still be blocked when the owning plugin was
  removed remotely, even if a matching independent delete, edit, or file type
  swap is already in sync and remote-only plugin drift is preserved.
- A plugin-owned delete must stop when the driver metadata is missing, even if
  matching independent deletes, edits, or file type swaps already match the
  live remote and unrelated remote-only plugin drift is present.
- A stale plugin-owned delete must stop even when a matching independent edit
  is already in sync and remote-only plugin drift is present elsewhere.
- A stale plugin-owned delete must stop even when a matching independent
  restore is already in sync and remote-only plugin drift is present elsewhere.
- A plugin-owned delete must stop when the live plugin owner context drifted,
  even if unrelated matching edits and remote-only plugin drift are present.
- Matching independent file type swaps stay `already-in-sync` when they end on
  the same hash as the live remote, even if a separate delete is the only
  emitted mutation.
- Matching independent file deletions, edits, and file type swaps may also
  coexist with a live-preconditioned delete while remote-only plugin drift or
  removals stay preserved.
- Matching independent row deletions and file type swaps may also coexist
  with a live-preconditioned delete while remote-only plugin drift stays
  preserved.

## Must Preserve

- Any remote-only change the local side does not touch.
- Remote descendants that would be hidden by a local delete or file type swap.
- Bounded conflict and blocker evidence: enough to audit the stop reason,
  never raw file bodies, row contents, plugin payloads, or other secret values.
- A local file type swap that would hide a live remote descendant must stop
  as a `file-topology-conflict`, even when unrelated remote-only plugin drift
  is present.
- Even when an unrelated change is safe to apply, topology-sensitive deletes and
  file type swaps must stop if they would hide a live remote descendant.
- The planner must keep matching independent resources `already-in-sync` even
  when a separate delete is live-preconditioned and remote-only plugin drift is
  present.
- If the matching descendant is also deleted locally, the planner may only
  proceed when that descendant still matches the live remote hash; any remote
  drift on the descendant keeps the parent delete or type swap blocked.
- Conflict and blocker evidence without raw file bodies, row contents, plugin
  payloads, or other secret values.
- Conflict evidence should stay bounded to the local change kind plus the live
  remote outcome; it must not expand into raw descendant bytes or plugin data.
- Independent resources that already match the remote hash should stay
  `already-in-sync` instead of being rewritten as mutations.
- File-topology conflicts should name the related descendant or ancestor path
  and stop the unsafe delete or type swap without exposing file contents.
- File-topology conflicts for a file type swap should stay bounded to the
  descendant path and local change kind while unrelated matching edits and
  remote-only plugin drift remain preserved.
- Plugin-owned deletes should preserve unrelated matching edits and remote-only
  plugin drift instead of widening into unrelated overwrites.

## Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Local delete or file type swap when it would hide a live remote descendant.
- Local row delete or file type swap when a matching independent resource has
  not independently reached the live remote hash.
- Plugin-owned or plugin-context mutations when the required live remote plugin
  context drifted and the local side did not independently match it.
- Unsupported plugin-owned resources when the planner cannot establish a
  matching driver policy or ownership proof for the live resource.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
- Any local change that would overwrite remote-only plugin drift instead of
  preserving it as `keep-remote` or a blocked stale context.
