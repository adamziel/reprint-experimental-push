# Conservative Source-Notes Comparison

This note is intentionally narrow: it records what the source notes support and
what they do not support for production push wording.

Treat the three upstream families separately: Reprint supports staged pull and
export sequencing ideas, ZS-Sync supports scanner/resource batching ideas, and
ForkPress supports audit and recovery vocabulary. None of them, by themselves,
prove this branch's live push executor, stale-drift rejection, or remote-
preserving retry behavior.

These notes are snapshots of previously observed upstream behavior, not
current upstream proof. They only become current proof if this branch
reverified the exact cited revision or worktree and the exact live mutation
boundary for the same claim. If either the exact upstream state or the exact
live boundary is missing, the note is historical context only and cannot be
used to claim that the live executor, retry path, or manual-review flow is
safe.

A route-shaped smoke, package mount, live-looking hash, lab-shaped route
smoke, copied executor output, or matching `finalMatchesLocal` result does
not fill that gap. Neither does a later manual-resolution label unless the
preserved remote stayed auditable, the stale rejection point is recorded,
the fresh retry scope was rebuilt from live hashes on this branch for that
same boundary, and any later-discovered plugin-owned surface got its own
preserve / reject / retry cycle instead of being folded into the earlier
approval.
That also means a stale manual-review artifact stays audit evidence only
unless the remote was preserved for audit, the stale approval was rejected
before mutation, the retry rebuilt scope from fresh live hashes, and any
later-discovered plugin-owned surface was handled as a separate boundary.
Reprint, ZS-Sync, and ForkPress each fail for a different missing proof:
Reprint does not prove preserved-remote push safety, production auth/session
lifecycle, graph identity, or plugin-driver coverage on this branch; ZS-Sync
does not prove plugin-owned surface coverage, graph identity, or identity-
remap safety; and ForkPress does not prove stale-review artifacts stay audit-
only after drift or that plugin-driver coverage can be inferred from audit
vocabulary alone.
In other words: a named feature family is not enough. The branch must be able
to point to the exact upstream commit or worktree state and the exact live
mutation boundary that was exercised here, or the comparison stays historical
context even if it sounds current.

## Must-Happen-Before Production Wording

Before this branch can use a Reprint, ZS-Sync, or ForkPress comparison as
production wording, it must also show all of the following on the same live
boundary:

- the preserved remote stayed inspectable after rejection and is still usable
  for audit;
- the stale approval or manual-review artifact was rejected before the first
  write and cannot widen to a different row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface;
- every touched surface was classified old, new, or blocked before retry
  started, including any partial file, DB, or plugin side effect;
- any create-time identity remap was either backed by live identity evidence
  at apply time or hard-blocked before mutation;
- every plugin-owned surface outside the allowlist was enumerated or blocked
  before write, including late-discovered tables, cron rows, runtime
  registries, generated files, caches, serialized blobs, and plugin-owned
  files; and
- any later-discovered plugin-owned surface or remapped create target was
  treated as a new boundary with its own preserve / reject / retry cycle
  instead of inheriting the earlier approval.

## Reprint

What it proves:

- Reprint already has a pull pipeline with staged phases, resumability, and
  export-side resource helpers.
- The repo here can borrow the idea of staged execution and resumable work.
- The note can justify transport sequencing ideas only, not write safety,
  audit durability, or retry authority on a live source site.
- It does not prove that a lab route, copied mount, or fixture-shaped replay
  is safe for production push support unless this branch reverified the exact
  live mutation boundary and preserved remote here.

What it does not prove:

- It does not prove a live source mutation boundary for push.
- It does not prove stale remote drift rejection at apply time.
- It does not prove a stale approval stays auditable while being unusable as
  authority after drift, or that it cannot be widened to unrelated rows,
  files, or plugin-owned surfaces on retry.
- It does not prove a stale manual-review artifact stays audit-visible but
  unusable as retry authority after drift, or that a later-discovered
  plugin-owned surface cannot inherit that artifact by shape alone.
- It does not prove a create-time identity remap or alias event is safe
  without a fresh live decision at the same write boundary.
- It does not prove identity remapping on create, plugin-owned allowlist
  coverage, or partial file/DB/plugin side-effect classification.
- It does not prove plugin data traps are safe just because a fixture-owned
  option, row, or route matches the expected shape.
- It does not prove hidden plugin-owned state outside the allowlist is safe
  just because the route family or package layout matches a known upstream
  shape.
- It does not prove a stale manual-review artifact can remain auditable while
  being unusable as authority after drift, or that a retry must rebuild scope
  from fresh live hashes instead of inheriting the old decision.
- It does not prove a later-discovered plugin-owned surface or remapped create
  target can inherit the earlier preserved remote or review note just because
  the route family or package mount stayed the same.
- It does not prove production auth, replay cleanup, TLS policy, or audit
  retention for push.

## ZS-Sync

What it proves:

- ZS-Sync shows a scanner/resource model for detecting changes and batching
  them.
- It can inform the planning side of a push design.
- The note can justify discovery and batching ideas only, not live mutation,
  conflict policy, or durable recovery.
- It does not prove that scanner coverage in a fixture or lab route implies
  the live executor saw the same plugin-owned surface list, remap case, or
  stale-approval boundary.
- It does not prove create-time identity remap safety just because the same
  scanner or batching pattern appears in a source note.

What it does not prove:

- It does not prove source-site mutation.
- It does not prove atomicity, crash recovery, or conflict policy for a live
  push write path.
- It does not prove plugin semantic ownership, create-time remap handling, or
  the durable classification of partial side effects.
- It does not prove unknown plugin-owned state is discovered consistently
  enough to block unsafe writes before mutation, or that a post-write
  discovery is treated as a new boundary instead of backfilled into the
  earlier approval.

## ForkPress

What it proves:

- ForkPress documents stronger audit and crash-consistency ideas than a plain
  copy-and-replay design.
- It is a useful source for invariants around merge auditability and recovery
  state.
- The note can justify review vocabulary only, not a production executor or
  a safe manual-resolution lifecycle.
- It does not prove that a readable review artifact from a lab-shaped route
  can authorize retry on the live boundary without preserved-remote
  evidence, stale-rejection evidence, and a fresh live-hash retry scope.
- It does not prove plugin data traps are safe just because the same review
  vocabulary, route family, or package mount appears in a note; hidden plugin
  state discovered after the first write still needs its own preserve / reject
  / retry cycle.
- It does not prove a later-discovered plugin-owned surface can be promoted to
  success by reusing a prior review artifact; that later boundary needs its own
  live decision and cannot inherit the earlier boundary's authority.

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
- It does not prove plugin-owned surfaces hidden behind the same route family
  are safe to enumerate by fixture shape alone, including late-discovered
  tables, cron rows, runtime registries, serialized blobs, caches, and plugin
  files; those surfaces need their own live boundary proof or block.
- It does not prove a remapped create target stays covered when the live write
  boundary moves to a different row, file, or relationship-bearing record.

## Rule For Production Claims

A production-grade push claim may cite these notes only as historical or
design context unless the exact upstream revision or worktree state was
reverified and the same live write boundary was exercised in this repo.
If the claim only shows a route-shaped smoke, package mount, or
`finalMatchesLocal` result, the note stays historical context and cannot
stand in for live proof.
If the claim does not also name a drifted remote that was preserved for
audit, the stale authority rejection point, and the fresh retry scope built
from new live hashes, then the comparison is still only design context even
when the route or fixture replay looks production-shaped.
If the claim does not name the exact upstream revision or worktree state and
the exact live mutation boundary, it is not production wording.
If the only apparent match is the same route family, package layout, or
reviewer wording, that is still historical context only; shape similarity
does not prove the live executor, preserved remote, or retry authority on
this branch.
If the claim only reuses a lab-shaped route, fixture mount, or compatibility
URL, that is still not current proof, because the same shape can be served by
a copied or fixture-backed executor instead of the live write path.
If the comparison note leaves any plugin-owned surface implicit instead of
enumerated, or if it depends on a lab-shaped route to infer live ownership, it
still fails as proof for production push wording.
Without that revalidation, the notes cannot backfill missing proof for:

- live remote drift rejection,
- stale approval expiry,
- create-time remap or alias handling,
- plugin-owned allowlist coverage,
- partial file/DB/plugin side-effect classification,
- stale manual-review artifact reuse,
- hidden plugin-owned surfaces or plugin-owned data traps,
- or remote-preserving retry behavior.

Production-grade wording also needs the source-note comparison itself to say
whether the cited Reprint, ZS-Sync, or ForkPress state was reverified at the
same live write boundary. If it was not, the note remains design context,
never current proof, even if the upstream feature vocabulary or route family
looks identical.

A source-note comparison by itself is never enough to claim the live retry
path is safe, auditable, or production-ready. It cannot be used to prove a
lab route, fixture replay, or package mount is the real production executor.
If the claim cannot show the exact live request path, preserved remote state,
and stale-authority rejection at the current write boundary, the comparison
remains context only. If the claim cannot also name the exact upstream
revision or worktree state that was reverified, it still cannot be promoted
from context to proof.
Readable manual-review wording has the same limit: it only stays audit-only
if the preserved remote is inspectable, the stale artifact was rejected
before mutation, the fresh retry scope was rebuilt from live hashes on this
branch, and any later-discovered plugin-owned surface got its own separate
preserve / reject / retry cycle. Otherwise the comparison note is still
historical context, even if the label says "manual resolution."
That prohibition also covers "manual resolution" wording: a readable stale
artifact, a matching route family, or a copied-lab mount does not become
retry authority unless the preserved remote is auditable, the stale artifact
was rejected before mutation, and a fresh retry artifact was recorded from
current live hashes on this branch. A later-discovered plugin-owned surface or
remapped create target cannot inherit that authority without its own preserve
/ reject / retry cycle.
Even when the exact upstream revision or worktree state is named, the note
still stays historical unless this branch re-ran the same live drift case at
the same live mutation boundary and preserved the remote for audit. Matching
feature names, route shape, or package layout do not upgrade the note into
current proof.
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
rejection point, fresh live hashes used to rebuild scope, and separate
classification for any later plugin-owned surface that appeared after the
first write.
If the first write already committed and a later plugin-owned surface only
appears afterward, that later surface is a new boundary, not a continuation of
the earlier success story. The comparison stays historical unless it shows a
preserved remote, a separate rejection or classification point for the later
surface, and a fresh retry scope for that later boundary.
Proof does not transfer from the first boundary to the later one: a matching
route family, package layout, or reviewer phrase cannot authorize a later
row, file, relationship-bearing record, remapped create target, or
plugin-owned surface. The later boundary needs its own live evidence on this
branch.
That also covers any live-looking hash emitted by a fixture-backed or
copied-lab path behind a production-shaped mount: the hash may confirm the
route answered, but it still does not prove the live mutation executor ran.

Release-barrier summary:

- Reprint, ZS-Sync, and ForkPress notes are comparison evidence only unless
  the exact upstream revision or worktree state is named and reverified.
- A matching feature family, route shape, or package mount is still only
  compatibility evidence unless this branch reran the same drifted live
  boundary.
- Route shape, package mount shape, and `finalMatchesLocal` are compatibility
  evidence only unless the same live mutation boundary was exercised against a
  drifted remote.
- A readable manual-review artifact is audit evidence only until it is shown
  unusable as retry authority after drift.
- A release gate must fail closed and record the exact rejection reason for
  every missing proof item; "manual resolution" or "comparison passed" by
  itself is not enough.
- A live-looking hash from a fixture-backed or copied-lab path never proves
  the live executor ran.
- Reprint, ZS-Sync, and ForkPress notes never become current proof just
  because their feature names match the current design; the cited upstream
  state must be reverified at the same live mutation boundary.

Release gate for this comparison note:

- name the exact upstream commit hash or worktree state for each cited note;
- name the exact live mutation boundary exercised on this branch;
- state what the cited upstream state does not prove here, especially for
  remote drift, create-time remap, plugin-owned allowlists, partial side
  effects, and stale manual-review artifacts; and
- reject any claim that only has route shape, package shape, or
  `finalMatchesLocal` evidence.
- A late-discovered plugin-owned surface is a separate boundary; a source note
  for the first write cannot authorize it unless this branch preserved the
  remote, classified the later surface, and rebuilt retry scope from fresh
  live hashes.
