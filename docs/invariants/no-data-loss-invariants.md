# No Data Loss Invariants

The planner may auto-apply a change only when it can prove the live remote state
still matches the precondition for that mutation.

It may apply automatically when:

- the local resource differs from base, the remote resource still matches base,
  and the mutation keeps a live remote hash precondition
- a local and remote change converge to the same ordinary resource content
- a remote-only change is unrelated to the local mutation set and can be
  preserved as `keep-remote`

It must preserve:

- remote-only plugin metadata and plugin-owned content that the local change does
  not own
- matching independent edits, deletes, restores, and file type swaps that land
  on the same hash on both sides
- bounded conflict evidence that explains why a resource stopped without
  leaking raw payloads

It must stop when:

- a mutation would overwrite a live remote change without a live precondition
- a file or directory topology change would hide a live remote descendant
- plugin-owned data lacks the ownership context needed to prove the mutation is
  safe
- planner evidence would need to expose more than the bounded audit context
