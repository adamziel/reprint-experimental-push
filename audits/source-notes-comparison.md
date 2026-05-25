# Conservative Source-Notes Comparison

This note is intentionally narrow: it records what the source notes support and
what they do not support for production push wording.

These notes are snapshots of previously observed upstream behavior, not
current upstream proof. They only become current proof if this branch
reverified the exact cited revision or worktree and the exact live mutation
boundary for the same claim. If either the exact upstream state or the exact
live boundary is missing, the note is historical context only and cannot be
used to claim that the live executor, retry path, or manual-review flow is
safe. A route-shaped smoke, package mount, or live-looking hash does not fill
that gap.
In other words: a named feature family is not enough. The branch must be able
to point to the exact upstream commit or worktree state and the exact live
mutation boundary that was exercised here, or the comparison stays historical
context even if it sounds current.

## Reprint

What it proves:

- Reprint already has a pull pipeline with staged phases, resumability, and
  export-side resource helpers.
- The repo here can borrow the idea of staged execution and resumable work.

What it does not prove:

- It does not prove a live source mutation boundary for push.
- It does not prove stale remote drift rejection at apply time.
- It does not prove a stale approval stays auditable while being unusable as
  authority after drift, or that it cannot be widened to unrelated rows,
  files, or plugin-owned surfaces on retry.
- It does not prove a stale manual-review artifact stays audit-visible but
  unusable as retry authority after drift.
- It does not prove identity remapping on create, plugin-owned allowlist
  coverage, or partial file/DB/plugin side-effect classification.
- It does not prove plugin data traps are safe just because a fixture-owned
  option, row, or route matches the expected shape.
- It does not prove a stale manual-review artifact can remain auditable while
  being unusable as authority after drift, or that a retry must rebuild scope
  from fresh live hashes instead of inheriting the old decision.
- It does not prove production auth, replay cleanup, TLS policy, or audit
  retention for push.

## ZS-Sync

What it proves:

- ZS-Sync shows a scanner/resource model for detecting changes and batching
  them.
- It can inform the planning side of a push design.

What it does not prove:

- It does not prove source-site mutation.
- It does not prove atomicity, crash recovery, or conflict policy for a live
  push write path.
- It does not prove plugin semantic ownership, create-time remap handling, or
  the durable classification of partial side effects.
- It does not prove unknown plugin-owned state is discovered consistently
  enough to block unsafe writes before mutation.

## ForkPress

What it proves:

- ForkPress documents stronger audit and crash-consistency ideas than a plain
  copy-and-replay design.
- It is a useful source for invariants around merge auditability and recovery
  state.

What it does not prove:

- It does not prove this repo's live write boundary.
- It does not prove that route-shape, package layout, or lab fixtures are
  sufficient for production push support.
- It does not prove plugin-owned state outside the allowlist is blocked when
  the same data path is hidden behind a valid-looking lab route.
- It does not prove that unknown plugin-owned state discovered after drift can
  be widened into success by stale local metadata, cached ownership, or a
  copied-lab mount.
- It does not prove a create-time remap, alias, or renumber event is safe just
  because the route looks production-shaped or the package mount matches.
- It does not prove the exact current upstream state unless the cited upstream
  revision or worktree was reverified at the same live mutation boundary.

## Rule For Production Claims

A production-grade push claim may cite these notes only as historical or
design context unless the exact upstream revision or worktree state was
reverified and the same live write boundary was exercised in this repo.
If the claim only shows a route-shaped smoke, package mount, or
`finalMatchesLocal` result, the note stays historical context and cannot
stand in for live proof.
If the claim does not name the exact upstream revision or worktree state and
the exact live mutation boundary, it is not production wording.
Without that revalidation, the notes cannot backfill missing proof for:

- live remote drift rejection,
- stale approval expiry,
- create-time remap or alias handling,
- plugin-owned allowlist coverage,
- partial file/DB/plugin side-effect classification,
- stale manual-review artifact reuse,
- or remote-preserving retry behavior.

Production-grade wording also needs the source-note comparison itself to say
whether the cited Reprint, ZS-Sync, or ForkPress state was reverified at the
same live write boundary. If it was not, the note remains design context,
never current proof.

A source-note comparison by itself is never enough to claim the live retry
path is safe, auditable, or production-ready. It cannot be used to prove a
lab route, fixture replay, or package mount is the real production executor.
If the claim cannot show the exact live request path, preserved remote state,
and stale-authority rejection at the current write boundary, the comparison
remains context only. If the claim cannot also name the exact upstream
revision or worktree state that was reverified, it still cannot be promoted
from context to proof.
It also cannot be used to claim production safety for a manual-resolution
flow unless the remote was preserved for audit, the stale approval was
rejected before mutation, and the retry rebuilt scope from fresh live hashes
instead of reusing the old decision.
It also cannot be used to claim that manual resolution was successful unless
the remote was preserved for audit, the stale approval was rejected before
mutation, and the retry rebuilt scope from fresh live hashes instead of
reusing the old decision.
If the claim also cannot show a preserved-remote retry after drift, then
"manual resolution" is still only an unresolved conflict label, not proof
that the comparison maps to safe production behavior.
If the same comparison is then reused to justify a stale manual-review
artifact, the claim still fails unless the artifact is rejected before write,
the remote is preserved for audit, and the next retry rebuilds scope from
fresh live hashes instead of inheriting old approval.
The comparison also does not prove that partial file, DB, or plugin side
effects were classified durably; a matching route name or package mount can
still hide a mixed-write failure that needs fresh live evidence on retry.
If the comparison does not also pin the exact upstream commit hash or
worktree state that was reverified, it stays historical context even when the
feature name matches and the route shape looks production-shaped.
That rule also applies to manual resolution: if the remote was not preserved,
the stale artifact was not rejected before mutation, and the next retry did
not start from fresh live hashes, the comparison stays historical context and
does not become retry authority.
Manual-review artifacts, route-shape smokes, and `finalMatchesLocal` results
stay in the same bucket: useful for lab review, but not retry authority and
not proof that the cited upstream note maps to current production behavior.
If a manual-review artifact is still readable after drift but has not been
rejected before write, that readability is audit evidence only, not proof of a
safe retry. The retry proof must show the preserved remote, the stale artifact
rejection point, and fresh live hashes used to rebuild scope.
That also covers any live-looking hash emitted by a fixture-backed or
copied-lab path behind a production-shaped mount: the hash may confirm the
route answered, but it still does not prove the live mutation executor ran.

Release-barrier summary:

- Reprint, ZS-Sync, and ForkPress notes are comparison evidence only unless
  the exact upstream revision or worktree state is named and reverified.
- Route shape, package mount shape, and `finalMatchesLocal` are compatibility
  evidence only unless the same live mutation boundary was exercised against a
  drifted remote.
- A readable manual-review artifact is audit evidence only until it is shown
  unusable as retry authority after drift.
- A live-looking hash from a fixture-backed or copied-lab path never proves
  the live executor ran.
- Reprint, ZS-Sync, and ForkPress notes never become current proof just
  because their feature names match the current design; the cited upstream
  state must be reverified at the same live mutation boundary.
