# No Data Loss Invariants

The planner may auto-apply a change only when it can prove the live remote state
still matches the precondition for that mutation.

It may apply automatically when:

- the local resource differs from base, the remote resource still matches base,
  and the mutation keeps a live remote hash precondition
- a local and remote change converge to the same ordinary resource content
- a live-preconditioned delete is refused instead of guessed when the same file
  also changed remotely
- matching file deletions, file restores, row deletes, row restores, and file
  type swaps are preserved as already-in-sync instead of being re-written
- matching file and row deletions that converge on the same hash are preserved
  as already-in-sync instead of being re-written
- matching row restores and file type swaps can stay already-in-sync beside a
  live-preconditioned row delete when the remote state still matches the shared
  content hash
- a live-preconditioned delete can still apply when matching independent
  restores and file type swaps converge on the same hash
- a remote-only change is unrelated to the local mutation set and can be
  preserved as `keep-remote`
- a supported plugin-owned delete has a live remote precondition and unrelated
  deletes, restores, edits, or file type swaps still converge safely
- a mutation is refused instead of guessed when the planner cannot prove the
  live remote state, resource ownership, or file topology is safe to change

It must preserve:

- independent matches for deletes, restores, edits, and file type swaps even
  when unrelated remote-only plugin drift is present
- remote-only plugin metadata and plugin-owned content that the local change does
  not own
- matching independent edits, deletes, restores, and file type swaps that land
  on the same hash on both sides
- a live-preconditioned delete can still stop cleanly when another resource
  conflicts, while unrelated matching edits and file type swaps remain
  preserved
- an explicitly allowed plugin-owned delete can still apply only behind a live
  remote precondition while unrelated matching edits, type swaps, and
  remote-only plugin drift remain preserved
- a same-file delete conflict can stop while unrelated matching deletes,
  restores, edits, type swaps, and remote-only plugin removals remain preserved
- a file type swap that would hide a live remote descendant must stop even if
  matching independent deletes and edits remain already-in-sync and unrelated
  plugin drift is preserved
- a file type swap can stop while a separate matching delete still remains in
  the plan behind a live remote precondition and matching edits or restores stay
  already-in-sync
- remote-only plugin drift while a plugin-owned delete is safely preconditioned
- matching independent deletes, edits, restores, and file type swaps even when
  a separate mutation is rejected for a live remote conflict
- bounded conflict evidence that explains why a resource stopped without
  leaking raw payloads

It must stop when:

- a mutation would overwrite a live remote change without a live precondition
- a same-file local delete conflict is discovered and the planner cannot prove
  the remote state is safe to overwrite
- a local delete, restore, or type swap would hide a live remote descendant
- a local delete conflicts with a live remote same-file edit
- a file or directory topology change would hide a live remote descendant
- plugin-owned data lacks the ownership context needed to prove the mutation is
  safe
- a plugin-owned delete cannot prove the live remote state and its owner context
  are still safe to mutate
- planner evidence would need to expose more than the bounded audit context
