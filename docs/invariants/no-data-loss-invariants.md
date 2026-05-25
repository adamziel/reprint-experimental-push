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
  independent restore, edit, and file type swap, while unrelated remote-only
  plugin drift remains `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent file delete, edit, and file type swap, while unrelated
  remote-only plugin drift remains `keep-remote`.
- A file delete that would hide a live remote descendant must still stop
  even when a matching independent delete, edit, and file type swap are
  already in sync and remote-only plugin drift is present; the matching
  resources stay `already-in-sync`, the plugin drift stays `keep-remote`,
  and the conflict evidence stays bounded.
- A live-preconditioned file delete may still coexist with a matching
  independent restore, edit, and file type swap while unrelated remote-only
  plugin drift and removals both remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent edit and file type swap while unrelated remote-only plugin
  metadata and files remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent edit and a matching plugin-owned resource while remote-only
  plugin drift remains `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent edit and file type swap while remote-only plugin removals
  remain `keep-remote`.
- An allowed plugin-owned delete may still coexist with matching independent
  edits and a matching file type swap while unrelated remote-only plugin
  drift on another plugin remains `keep-remote`.
- A ready delete plan at the live release boundary may still preserve late
  remote-only plugin drift after planning while preserving a matching
  independent edit and bounded evidence.
- A ready delete plan at the live release boundary may still preserve a
  remote-only plugin removal and refuse late plugin drift on re-apply while
  keeping the delete precondition live and bounded.
- A ready delete plan at the live release boundary may still preserve
  remote-only plugin removals and refuse late removal drift on re-apply while
  keeping the delete precondition live and bounded.
- A ready delete plan at the live release boundary may still preserve a
  matching independent delete while remote-only plugin drift remains
  `keep-remote` and late drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent delete and a matching file type swap while remote-
  only plugin drift remains `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent delete, edit, file type swap, and remote-only plugin
  removals while late plugin drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent create and a matching plugin-owned resource while
  remote-only plugin drift remains `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent delete, edit, and file type swap while remote-only
  plugin removals remain `keep-remote` and late plugin drift is refused on
  re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit while remote-only plugin removals remain
  `keep-remote` and late removal drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent row delete while remote-only plugin removals remain
  `keep-remote` and late removal drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit and matching independent file type swap while
  remote-only plugin changes remain `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit and a matching plugin-owned resource while
  remote-only plugin drift remains `keep-remote` and late drift is refused
  on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit, a matching file type swap, and a matching
  plugin-owned resource while remote-only plugin changes remain
  `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent delete, a matching file type swap, and a matching
  plugin-owned resource while remote-only plugin changes remain
  `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent file type swap and a matching plugin-owned resource
  while remote-only plugin changes remain `keep-remote` and late plugin
  drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit and remote-only plugin removals while late
  drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve same-
  remote graph identity and remote-only plugin removals after apply
  revalidation while a matching independent edit stays `already-in-sync`.
- A ready delete plan at the live release boundary may still preserve a
  matching plugin-owned resource, a matching file type swap, and remote-only
  plugin removals while late drift is refused on re-apply.
- A live-preconditioned file delete may still coexist with a matching
  independent create while unrelated remote-only plugin metadata and files
  remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent restore while remote-only plugin removals remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent restore and matching independent edit while remote-only plugin
  removals remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent file type swap and matching independent row delete while
  unrelated remote-only plugin metadata and files remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent delete, file type swap, and plugin-owned resource while
  remote-only plugin changes remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent row delete, edit, and file type swap while unrelated
  remote-only plugin metadata and files remain `keep-remote`.
- At the live release boundary, a ready delete plan may still preserve
  same-remote graph identity, matching independent deletes or edits, and
  plugin-owned resources while remote-only plugin drift remains `keep-remote`
  and late drift is refused on re-apply.
- A live-preconditioned directory delete may still coexist with a matching
  descendant delete while unrelated remote-only plugin drift remains
  `keep-remote`.
- A live-preconditioned file delete may still coexist with matching
  independent delete, edit, and file type swap while remote-only plugin
  removals remain `keep-remote`.
- A live-preconditioned file delete may still coexist with a matching
  independent file delete, edit, and file type swap while remote-only plugin
  drift remains `keep-remote`.
- A ready delete plan may still preserve remote-only plugin removals at the
  live release boundary while same-remote graph identity stays intact and
  late removal drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit and remote-only plugin removals while late
  removal drift is refused on re-apply.
- A ready delete plan at the live release boundary may still preserve a
  matching independent create and a matching file type swap while
  remote-only plugin changes remain `keep-remote`.
- A ready delete plan at the live release boundary may still preserve a
  matching independent edit, a matching plugin-owned resource, and
  remote-only plugin removals while late removal drift is refused on
  re-apply.
- A live-preconditioned file delete and file type swap may still coexist with
  a matching independent edit while unrelated remote-only plugin changes stay
  `keep-remote`.
- A live-preconditioned file delete and file type swap may still coexist with
  a matching independent edit while remote-only plugin removals stay
  `keep-remote`.
- A live-preconditioned file type swap may still coexist with a matching
  independent edit while unrelated remote-only plugin metadata and files
  remain `keep-remote`.
- A live-preconditioned file type swap may still coexist with a matching
  independent edit and restore while unrelated remote-only plugin drift
  remains `keep-remote`.
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
- A local file delete must still stop when the remote independently type
  swaps the same path, even if a matching independent edit and unrelated
  remote-only plugin drift are present; the matching edit stays
  `already-in-sync`, the plugin drift stays `keep-remote`, and the conflict
  evidence stays bounded.
- A mixed ready plan must still fail closed when one mutation loses its live
  remote precondition, even if a matching independent edit and a file type
  swap remain safe in the same plan; the remote stays unchanged and the
  missing precondition evidence stays bounded.
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
- A live-preconditioned directory delete may coexist with a matching
  independent edit and matching descendant delete, but the remote-only plugin
  drift must still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with matching independent
  restores, edits, and file type swaps, but the remote-only plugin drift must
  still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with a matching independent
  create, but the remote-only plugin drift must still remain untouched and
  observable as `keep-remote`.
- A live-preconditioned file delete and file type swap may coexist with a
  matching independent edit, but the remote-only plugin changes must still
  remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete and file type swap may coexist with a
  matching independent edit while remote-only plugin drift remains
  `keep-remote`, and each mutation keeps a live remote precondition.
- A live-preconditioned file delete may coexist with a matching independent
  file type swap and matching independent row delete, but the remote-only
  plugin drift must still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with a matching independent
  row delete, edit, and file type swap, but the remote-only plugin drift must
  still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with matching independent
  delete, edit, and file type swap, but the remote-only plugin removals must
  still remain untouched and observable as `keep-remote`.
- A live-preconditioned file delete may coexist with matching independent row
  delete, edit, and file type swap while remote-only plugin drift remains
  `keep-remote`.
- A live-preconditioned file type swap may coexist with a matching
  independent edit and matching independent row delete while remote-only
  plugin drift remains `keep-remote`.

## Must Stop

- Same-resource local and remote changes that diverge to different hashes.
- Local delete or file type swap when the live remote resource drifted and the
  local side did not independently reach the live remote hash.
- Any local delete or file type swap that would overwrite a remote-only
  plugin change instead of preserving it.
- A forged live-preconditioned delete must still stop if the live remote
  precondition is stripped before apply, even when matching independent edits
  still stay `already-in-sync` and remote-only plugin drift stays untouched.
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
- Any apply path that would need to guess whether a local delete, restore, or
  file type swap can overwrite a live remote change.
