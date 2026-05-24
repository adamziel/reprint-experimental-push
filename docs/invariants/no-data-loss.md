# No Data Loss Invariants

The push planner must preserve remote-only state unless it has a live remote precondition and a validated reason to mutate the resource.

## May apply automatically

- Local ordinary edits when the live remote still matches the pull base.
- Local deletions and file type swaps when the live remote still matches the pull base.
- Matching independent edits, deletions, and file type swaps when both sides reached the same result.
- Ordinary local mutations that are unrelated to remote-only plugin drift.
- Remote-only plugin removals do not weaken the live-remote precondition for an unrelated local deletion, even when matching independent edits or file type swaps are also present.
- When a remote-only plugin removal is present alongside an unrelated deletion plus matching independent edits or file type swaps, the matching resources stay `already-in-sync` and the unrelated deletion still needs its own live-remote precondition.

## Must preserve

- Remote-only plugin metadata and plugin files.
- Matching remote changes that the local branch did not author.
- Evidence for conflicts and blockers without leaking resource contents.
- The live remote state for every resource that is not targeted by a validated mutation.

## Must stop

- Local mutations that would overwrite a remote edit on the same resource.
- Deletions or file type swaps that would hide remote-only descendants.
- Plugin-owned data changes when owner context or dependency evidence is stale.
- Any mutation that lacks a live remote precondition.
- Any plan that assumes remote plugin removal makes a stale plugin-context mutation safe.
