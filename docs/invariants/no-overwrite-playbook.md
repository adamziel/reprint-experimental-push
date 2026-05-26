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
- A live-preconditioned unrelated mutation may still apply while a plugin-owned
  row stays `already-in-sync` and remote-only plugin metadata or files remain
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
- A live-preconditioned delete may still apply alongside a matching
  independent edit and matching file type swap while unrelated remote-only
  plugin metadata or files stay preserved through apply.
- A live-preconditioned delete may still apply alongside a matching
  independent edit and file type swap while remote-only plugin metadata and
  files stay preserved through apply.
- An allowed plugin-owned delete may still apply alongside matching
  independent edits and a matching file type swap while unrelated
  remote-only plugin drift on another plugin stays preserved through apply.
- A live-preconditioned delete may still apply alongside matching independent
  delete, edit, and file type swap resources; the matching resources stay
  `already-in-sync`, the delete keeps its own live remote precondition, and
  unrelated remote-only plugin drift stays preserved through apply.
- The same rule still holds when the remote side has unrelated plugin drift
  in both its metadata and plugin files: the delete keeps its own live remote
  precondition, the matching edit and file type swap stay
  `already-in-sync`, and the plugin drift stays preserved through apply.
- A live-preconditioned delete may still apply alongside a matching restore;
  the restore stays `already-in-sync`, the delete keeps its own live remote
  precondition, and unrelated remote-only plugin drift stays preserved through
  apply.
- A directory delete must stop when it would hide a live remote descendant,
  even if unrelated remote-only plugin drift is present.
- A file delete must stop when it would hide a live remote descendant, even if
  unrelated remote-only plugin drift is present.
- A file delete must also stop when the hidden live remote descendant is a
  special file entry, even if unrelated remote-only plugin drift is present.
- The same delete rule also holds when the matching resource is a restored file
  and a file type swap appears in the same plan; both matching resources stay
  `already-in-sync` and remote-only plugin drift remains preserved.
- A file type swap that would hide a live remote descendant must still stop
  even when the remote side has already removed an unrelated plugin; the
  unrelated plugin removal stays `keep-remote` and the file-topology evidence
  stays bounded.
- The same file type swap stop condition also holds when the unrelated plugin
  was removed entirely and a matching independent edit remains
  `already-in-sync`.
- The same file type swap stop condition also holds when the unrelated plugin
  was removed entirely and matching independent edit and row delete resources
  remain `already-in-sync`.
- Local mutations on unrelated resources while remote-only plugin metadata,
  plugin files, or plugin removals are preserved.
- Local delete or file type swap only if it preserves remote-only plugin
  drift rather than overwriting it.
- Local file type swap must still stop when it would hide a live remote
  descendant, even if the remote side already removed an unrelated plugin and
  a matching independent edit is present.
- Plugin-context and plugin-owned data mutations only when their required live
  remote plugin context still matches the pull base or the local side
  independently matches the live remote context.
- Plugin-owned deletes only when the owning plugin context still matches the
  live remote context, or the local side independently matches that live
  remote owner context.
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
- File-topology conflict evidence should identify the related descendant or
  ancestor path and stop the unsafe mutation without exposing file contents.
- File-topology conflict evidence must remain bounded even when unrelated
  remote-only plugin removals are present.

## Must Stop

- Same-resource local/remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Local delete or file type swap when it would hide a live remote descendant.
- Plugin-owned deletions when the owner context is stale and the local side did
  not independently match the live remote context.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Plugin-owned deletions when the owning plugin context no longer matches the
  live remote context, even if unrelated remote-only plugin drift is present.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
