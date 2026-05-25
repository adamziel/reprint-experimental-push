# No Data Loss Invariants

The push planner may apply local changes automatically only when the live
remote still matches the pull base for that resource and the mutation can be
guarded by a live remote precondition.

What it may apply automatically:

- Local file and row updates when the remote resource is unchanged.
- Local file and row deletions when the remote resource is unchanged.
- File topology-safe type swaps when the planner can prove they do not hide
  live remote descendants.
- Independent changes that already match between local and remote, which are
  recorded as `already-in-sync` rather than rewritten.
- Ready delete plans may still include matching independent edits, deletes,
  restores, type swaps, and plugin-owned resources, provided the delete keeps
  its own live remote precondition.

What it must preserve:

- Any remote-only drift, including plugin metadata and plugin-owned files that
  were changed only on the remote.
- Any live remote descendant that would be hidden by a local delete or type
  swap.
- Any resource with ambiguous or unsupported ownership evidence.
- Remote-only plugin removals, metadata, and files when an unrelated local
  delete still has a valid live remote precondition.

What it must stop on:

- Conflicts where local and remote both changed the same resource differently.
- Deletes or type swaps that would erase remote-only descendants.
- Plugin-owned data when the planner cannot prove the owner, driver, or live
  remote plugin evidence is safe.
- Any proposed mutation that cannot be paired with a live remote precondition.
- Any mutation that would hide a descendant or weaken the no-overwrite
  boundary by guessing at stale plugin ownership.
