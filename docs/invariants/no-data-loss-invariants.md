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
- A live-preconditioned file delete may still coexist with a matching
  independent edit and file type swap while unrelated remote-only plugin
  metadata and files remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent create while unrelated remote-only plugin metadata and files
  remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent file type swap and matching independent row delete while
  unrelated remote-only plugin metadata and files remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent row delete, edit, and file type swap while unrelated
  remote-only plugin metadata and files remain `keep-remote`.
- A live-preconditioned file delete and file type swap may still coexist with
  a matching independent edit while unrelated remote-only plugin changes stay
  `keep-remote`.
- A live-preconditioned file type swap may still coexist with a matching
  independent edit while unrelated remote-only plugin metadata and files
  remain `keep-remote`.
- A plugin-owned delete may still coexist with matching independent edits and
  unrelated remote-only plugin removals, as long as the delete keeps its live
  remote hash check and the removed plugin stays preserved as `keep-remote`.
- Live-preconditioned file deletes and file type swaps may coexist in the same
  plan with matching independent edits when each mutation keeps its own live
  remote hash check and unrelated remote-only plugin drift stays `keep-remote`.
- Live-preconditioned file deletes and file type swaps may still coexist when
  the remote side removed an unrelated plugin entirely and a matching
  independent edit stays `already-in-sync`.
- A file type swap that would hide a live remote descendant must still stop
  even when the remote side removed an unrelated plugin; the unrelated plugin
  removal stays `keep-remote` and the file-topology evidence stays bounded.
- A file delete that would hide a live remote descendant must still stop even
  when an unrelated matching edit and remote-only plugin drift are present;
  the matching edit stays `already-in-sync`, the plugin drift stays
  `keep-remote`, and the conflict evidence stays bounded.
- The same file type swap stop rule also holds when the remote side removed
  the unrelated plugin entirely and a matching independent edit stays
  `already-in-sync`.
- The same file type swap stop rule also holds when the remote side removed
  the unrelated plugin entirely and a matching independent edit plus matching
  independent row delete stay `already-in-sync`.

## Must Preserve

- Any remote-only change the local side does not touch, including plugin
  removals.
- Remote descendants that would be hidden by a local delete or file type
  swap.
- File-topology evidence must stay bounded even when unrelated remote-only
  plugin removals are present.
- Conflict and blocker evidence without raw file bodies, row contents, option
  values, or plugin payloads.
- If the planner ever flags a missing live-remote precondition, the blocker
  should still expose only resource keys and hashes, not raw resource values.
- Matched independent resources in `already-in-sync` state rather than
  converting them into mutations when another resource in the same plan needs
  a live remote precondition.
- Mixed mutation plans must still prove each mutation against the live remote
  hash before apply, even when a matching independent edit and unrelated
  remote-only plugin drift are present.
- A live-preconditioned file delete may coexist with matching independent
  edits, file type swaps, and row edits, but the remote-only plugin drift must
  still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with a matching independent
  create, but the remote-only plugin drift must still remain untouched and
  observable as `keep-remote`.
- A live-preconditioned file delete and file type swap may coexist with a
  matching independent edit, but the remote-only plugin changes must still
  remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with a matching independent
  file type swap and matching independent row delete, but the remote-only
  plugin drift must still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with a matching independent
  row delete, edit, and file type swap, but the remote-only plugin drift must
  still remain untouched and observable as `keep-remote`.

## Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Any local delete or file type swap that would overwrite a remote-only
  plugin change instead of preserving it.
- Any local delete that would hide a live remote descendant.
- Any file type swap that would hide a live remote descendant, even when the
  remote side has already removed an unrelated plugin.
- The same file type swap stop condition still holds when that unrelated
  plugin was removed entirely and matching independent edits are present.
- Plugin-context or plugin-owned data mutations when the relevant live remote
  plugin context drifted and the local side did not independently match it.
- Plugin-owned deletions when the owner context is stale or missing.
- Any mutation that lacks a live remote precondition bound to the mutation id,
  resource key, and remote hash observed during planning.
