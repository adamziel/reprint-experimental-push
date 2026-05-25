# Conservative Source-Notes Comparison

This note is intentionally narrow: it records what the source notes support and
what they do not support for production push wording.

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
Without that revalidation, the notes cannot backfill missing proof for:

- live remote drift rejection,
- stale approval expiry,
- create-time remap or alias handling,
- plugin-owned allowlist coverage,
- partial file/DB/plugin side-effect classification,
- stale manual-review artifact reuse,
- or remote-preserving retry behavior.

A source-note comparison by itself is never enough to claim the live retry
path is safe, auditable, or production-ready. It cannot be used to prove a
lab route, fixture replay, or package mount is the real production executor.
If the claim cannot show the exact live request path, preserved remote state,
and stale-authority rejection at the current write boundary, the comparison
remains context only.
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
safe retry.
That also covers any live-looking hash emitted by a fixture-backed or
copied-lab path behind a production-shaped mount: the hash may confirm the
route answered, but it still does not prove the live mutation executor ran.
