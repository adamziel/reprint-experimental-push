# No Overwrite Summary

This lane's planner policy is intentionally narrow:

## May Apply Automatically

- Local creates, updates, deletions, and file type changes when the live remote
  still matches the pull base for that resource and the file-topology checks
  prove no live remote ancestor or descendant would be hidden.
- Independent local changes while other remote-only resources changed.
- Matching independent edits, including matching deletions, where local and
  remote reached the same content or the same absent state.
- Plugin installs or data updates when the declared dependencies are already
  satisfied on the live remote or are installed by the same plan.
- Plugin metadata or plugin file mutations when the rest of that plugin's live
  remote context still matches the pull base, or when local independently
  matches the live remote context.
- Plugin-owned data updates when the owning plugin context in local matches the
  live remote context, or when the live remote plugin context still matches the
  pull base.
- Plugin-owned deletions when the owning plugin context still matches the live
  remote context, or when the local side independently matches the live remote
  owner context.

Every automatic mutation must carry a live-remote precondition that matches the
mutation id, resource key, and remote hash observed during planning.

## Must Preserve

- Any remote-only resource change when local still matches the pull base.
- Remote-only plugin metadata, plugin files, activation state, and removals.
- Remote descendants that would be hidden by a local file deletion or type
  swap, unless the plan also proves the descendant is an unchanged base
  resource being deleted.
- Conflict evidence must stay hash-based and structural. It may identify
  resources, hashes, change kinds, presence, and file types, but not raw file
  bodies, row contents, option values, or plugin payloads.

## Must Stop

- Local and remote changed the same resource to different hashes.
- Local deletion versus remote update, and local update versus remote deletion.
- Plugin metadata or plugin file changes when another live remote context
  resource for that plugin changed since the pull base and local does not match
  that live owner context.
- Plugin-owned data changes when the live remote owner plugin files or metadata
  changed since the pull base and local does not match that live owner context.
- File topology conflicts where a local deletion or type swap would overwrite,
  remove, or hide a live remote ancestor or descendant.
- Plugin-owned deletions when the owning plugin context no longer matches the
  live remote context, even if unrelated remote-only plugin drift is present.
- Any mutation that lacks a matching live remote precondition.

Stopping means the planner returns `conflict` or `blocked`, and apply must
refuse the plan without changing the remote snapshot.
