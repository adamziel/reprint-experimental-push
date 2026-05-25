# Production Push Release Gate

This checklist is the minimum bar before any doc, PR description, review
comment, status comment, or release note can claim production-grade push
support. If any item is missing, the wording must stay explicitly lab-backed
or comparison-only.

- The claim cites a live write-path proof on the actual request path, and
  treats route shape, packaged-plugin mounting, fixture replay, and
  `finalMatchesLocal` as compatibility evidence only.
- The same request path was re-run against a live remote after drift, and the
  stale attempt failed before any mutation.
- The claim names the exact stale remote hash set, the rejected approval, the
  retry scope, and the proof that the remote was preserved for audit.
- The claim shows the stale manual-review artifact remains readable for audit
  but is unusable for apply after drift, and server-side rejection forces the
  next retry to start from fresh live hashes rather than inherited approval.
  The audit trail must show the rejected artifact stayed auditable, but could
  not be widened into a new row, file, relationship-bearing record, or
  plugin-owned surface. A readable stale artifact is not a valid retry token.
- The claim shows live remote drift between dry-run and apply failed closed
  before the first write, not after the executor had already modified a row,
  file, or plugin-owned surface.
- The claim shows create-time identity remapping is either safely represented
  or hard-blocked before write.
- The claim shows identity remapping or aliasing on create cannot silently
  renumber, reassign, or copy a target record into a different remote
  identity without a live remap proof.
- The claim shows plugin-owned state outside the allowlist is either discovered
  or hard-blocked, including options, custom tables, generated files, activation
  hooks, cron, cache state, and other plugin side effects.
- The claim shows plugin data traps are not being mistaken for success just
  because a fixture-owned option or table row matches the expected shape while
  the real plugin also owns custom tables, serialized counters, cron rows,
  generated assets, runtime registries, or external side effects.
- The claim names the exact plugin-owned surface exercised and shows the
  apply-time revalidation result for that surface, or it says the surface was
  blocked. A matching fixture row by itself is not evidence that the broader
  plugin-owned graph is safe.
- The claim shows unknown plugin-owned state is not being widened into a
  success case through fallback behavior, stale metadata, or a copied-lab
  route that happens to hit the same URL shape.
- The claim shows plugin-owned allowlist gaps fail closed at apply time even
  when the route looks valid and a local fixture row would otherwise pass.
- The claim shows plugin-owned ownership changes are revalidated at apply time,
  not inherited from stale local metadata.
- The claim shows a plugin data trap cannot pass as success when a fixture-owned
  option or table row matches while the real plugin also depends on custom
  tables, serialized counters, cron rows, generated CSS, roles/caps, activation
  hooks, migrations, runtime registries, or external side effects outside the
  allowlist.
- The claim shows any partial file, DB, or plugin side effect is classified
  durably and that retry starts from fresh evidence rather than reused approval.
- The claim shows partial file, DB, or plugin side effects do not leave an
  implied success state just because one store committed; mixed writes need
  old/new/blocked evidence for the whole path.
- The claim shows a stale manual-review artifact cannot be widened into a
  different row, file, relationship-bearing record, or plugin-owned surface
  after drift; if it can be reused that way, the push is not production-safe.
- The claim shows the same live write path rejected stale authority before
  mutation, and that a route-shaped smoke or packaged-plugin mount only counts
  as compatibility evidence if it exercised that exact boundary on a drifted
  remote.
- The claim includes the failure classification for any partial file, DB, or
  plugin side effect and shows recovery cannot silently widen the old approval
  to unrelated rows, files, relationship-bearing records, or plugin-owned
  surfaces.
- The claim includes the rejection reason for any unknown plugin-owned state
  and shows the blocked scope stayed auditable without becoming writable through
  fallback behavior.
- Any comparison to Reprint, ZS-Sync, or ForkPress must say whether it was
  re-verified against the current upstream commit or worktree state.
- If that comparison was not re-verified at the exact live write boundary, or
  the branch cannot name the exact upstream revision or worktree state, the
  comparison is historical context only.
- A source-note comparison never becomes current proof by itself; the claim
  must name the exact upstream revision or worktree state, the exact live
  mutation boundary, and the exact stale remote-drift case that failed closed.
- The claim does not rely on route shape, packaged-plugin mounting,
  `finalMatchesLocal`, benchmark models, or source-note comparison language as
  production proof unless the same live write boundary was reverified against a
  drifted remote.
- The claim does not treat a fixture-backed or copied-lab mount as production
  proof, even if it returns live-looking hashes through a production-shaped
  route.
- The claim does not let a route-shape smoke, packaged-plugin mount, or
  `finalMatchesLocal` result stand in for live remote drift rejection, stale
  approval expiry, create-time remap handling, plugin-owned allowlist
  coverage, or partial side-effect classification.
- The claim does not treat a plugin-owned fixture row or option as proof that
  broader plugin-owned surfaces were safe if custom tables, generated files,
  cron, caches, or runtime registries were not revalidated live.
- The claim does not let source-note comparisons backfill missing live proof
  for drift rejection, create-time remap, plugin ownership, partial
  side-effect classification, or stale approval expiry unless the same live
  write boundary was reverified at the exact upstream revision or worktree
  state.
- The claim does not let a stale manual-review artifact become retry authority
  just because it is readable; if it can be reused against a new row, file,
  relationship-bearing record, or plugin-owned surface, the claim is not
  production-safe.
- The claim includes the exact upstream revision or worktree state for any
  Reprint, ZS-Sync, or ForkPress comparison, and says whether that state was
  reverified at the same live write boundary. If not, the comparison is
  historical context only.
- The claim does not let Reprint, ZS-Sync, or ForkPress notes imply current
  upstream reliability unless the exact upstream revision or worktree state was
  reverified and the live mutation boundary was exercised in this repo.
- The claim does not let a comparison note, manual review artifact, or live
  looking hash stand in for proof that the remote stayed preserved, the stale
  authority was rejected before mutation, and the retry rebuilt scope from
  fresh live hashes.
- The claim does not treat matching route shape plus a green lab smoke as
  evidence of production safety if the underlying path never revalidated the
  live remote or the hidden plugin-owned surface at apply time.
- The claim does not treat manual resolution as success unless the remote is
  preserved, the stale artifact stays auditable but unusable, and server-side
  rejection forces the retry to rebuild scope from fresh live hashes before
  any write. "Manual resolution later" is still a failure state until the
  rejected snapshot cannot be reused as authority.
- The claim does not treat a stale manual-review artifact as a reusable
  decision token for a new row, file, relationship-bearing record, or
  plugin-owned surface after remote drift.
- The claim does not treat "manual resolution later" as a success state unless
  the preserved remote is still auditable, the stale artifact cannot authorize
  a retry, and the next attempt starts from fresh live evidence rather than the
  old approval.
- The claim does not let a stale approval be widened to a different row, file,
  relationship-bearing record, or plugin-owned surface on retry.
- The claim does not treat a production claim as valid if the proof set omits
  the create-time remap decision, the plugin-owned allowlist decision, or the
  partial side-effect classification for the exercised write path.

If any item is missing, the wording must stay explicitly lab-backed or
comparison-only.

Extra blocker for this lane: a route, mount, or hash coming from a
fixture-backed or copied-lab path still does not count as production proof.
If the path behind the mount was not the live mutation executor, the claim
must stay lab-backed even when the response looks current.
