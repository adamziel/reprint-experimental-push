# No Data Loss Invariants

The push planner must preserve remote-only state unless it has a live remote precondition and a validated reason to mutate the resource.

## May apply automatically

- Local ordinary edits when the live remote still matches the pull base.
- Local deletions and file type swaps when the live remote still matches the pull base.
- Matching independent edits, deletions, and file type swaps when both sides reached the same result.
- Matching independent restores can coexist with an unrelated deletion; the restore stays `already-in-sync`, the deletion still needs its own live remote precondition, and remote-only plugin drift remains preserved.
- Matching independent row restores can coexist with an unrelated deletion; the restore stays `already-in-sync`, the deletion still needs its own live remote precondition, and remote-only plugin drift remains preserved.
- Ordinary local mutations that are unrelated to remote-only plugin drift.
- Remote-only plugin removals do not weaken the live-remote precondition for an unrelated local deletion, even when matching independent edits or file type swaps are also present.
- When a remote-only plugin removal is present alongside an unrelated deletion plus matching independent edits or file type swaps, the matching resources stay `already-in-sync` and the unrelated deletion still needs its own live-remote precondition.
- The same boundary holds when the mixed local changes include a live-preconditioned delete plus matching independent edits and file type swaps; remote-only plugin drift stays preserved and does not widen the overwrite scope.
- Remote-only plugin removals can coexist with a live-preconditioned ordinary delete, matching independent file edit, and matching file type swap without widening the overwrite boundary.
- Remote-only plugin removals can also coexist with a live-preconditioned ordinary delete, matching independent edit, and matching file type swap without widening the overwrite boundary.
- Remote-only plugin removals can also coexist with a live-preconditioned row delete, matching independent file edit, and matching file type swap without widening the overwrite boundary.
- Remote-only plugin drift can coexist with a live-preconditioned file delete, matching independent edit, and matching file type swap without widening the overwrite boundary.
- In all of those mixed cases, the remote-only plugin removal stays `keep-remote`; it never grants extra overwrite permission to the unrelated mutation.

## Must preserve

- Remote-only plugin metadata and plugin files.
- Matching remote changes that the local branch did not author.
- Evidence for conflicts and blockers without leaking resource contents.
- The live remote state for every resource that is not targeted by a validated mutation.
- Any remote-only plugin drift that the local plan does not directly target.

## Must stop

- Local mutations that would overwrite a remote edit on the same resource.
- Deletions or file type swaps that would hide remote-only descendants.
- Plugin-owned data changes when owner context or dependency evidence is stale.
- Any mutation that lacks a live remote precondition.
- Any plan that assumes remote plugin removal makes a stale plugin-context mutation safe.
- Any plan that assumes remote plugin removal makes an unrelated local mutation safe without its own live-remote precondition.
