# Production Push Release Gate

This checklist is the minimum bar before any doc, PR description, review
comment, status comment, or release note can claim production-grade push
support. If any item is missing, the wording must stay explicitly lab-backed
or comparison-only.

- The claim cites a live write-path proof on the actual request path, and
  treats route shape, packaged-plugin mounting, fixture replay, and
  `finalMatchesLocal` as compatibility evidence only.
- The proof names the exact live write boundary, the exact stale remote case,
  and the exact preserved remote hash set that was rejected before mutation.
- The claim does not treat a readable review artifact or source-note
  comparison as current proof unless the same live boundary was revalidated on
  this branch.
- The same request path was re-run against a live remote after drift, and the
  stale attempt failed before any mutation.
- The claim names the exact stale remote hash set, the rejected approval, the
  retry scope, the fresh retry artifact, and the proof that the remote was
  preserved for audit.
- The claim shows the stale manual-review artifact remains readable for audit
  but is unusable for apply after drift, and server-side rejection forces the
  next retry to start from fresh live hashes rather than inherited approval.
  The proof must include the fresh retry artifact, not only the stale reject.
  The audit trail must show the rejected artifact stayed auditable, but could
  not be widened into a new row, file, relationship-bearing record, or
  plugin-owned surface. A readable stale artifact is not a valid retry token.
  A stale artifact or comparison note cannot become retry authority for a
  different row, file, relationship-bearing record, or plugin-owned surface.
  "Manual resolution later" is not success unless the preserved remote, the
  stale rejection point, and the fresh retry artifact are all visible on the
  same live write boundary.
  This includes late-discovered plugin-owned surfaces such as a hidden custom
  table, generated file, cron row, runtime registry entry, or serialized blob;
  if the stale artifact can still authorize any one of those, the claim is not
  production-grade.
  "Manual resolution later" is not a success state until the remote-preserving
  reject, the audit-only artifact, and the fresh-scope retry are all visible on
  the same live write boundary.
- The claim shows a stale review artifact never becomes current authority for
  any other live object after drift, including a remapped create target, a
  different row, a file, a relationship-bearing record, or a plugin-owned
  surface. If the artifact can be reused as retry authority for anything the
  original approval did not explicitly cover, the claim is not production-safe.
- The claim shows manual resolution never becomes current authority just
  because the artifact is readable, the route looks production-shaped, or the
  package mount is live; the remote must stay preserved, and the retry must
  rebuild from fresh live evidence.
- The claim shows live remote drift between dry-run and apply failed closed
  before the first write, not after the executor had already modified a row,
  file, or plugin-owned surface.
- The claim shows live remote drift was revalidated at the apply boundary with
  a preserved remote, not inferred from a green fixture replay, route-shape
  smoke, or `finalMatchesLocal` result.
- The claim shows create-time identity remapping is either safely represented
  or hard-blocked before write.
- The claim shows identity remapping or aliasing on create cannot silently
  renumber, reassign, or copy a target record into a different remote
  identity without a live remap proof.
- The claim shows create-time identity remapping either blocks before write or
  records the remap with live identity evidence; a fixture that keeps the same
  ID does not prove the live remote cannot renumber, alias, or reassign.
- The claim shows plugin-owned state outside the allowlist is either discovered
  or hard-blocked, including options, custom tables, generated files, activation
  hooks, cron, cache state, runtime registries, serialized blobs, and other
  plugin side effects.
- The claim shows plugin-owned state outside the allowlist is either enumerated
  live or blocked, including hidden custom tables, generated files, cron rows,
  runtime registries, serialized blobs, and other plugin-owned side effects.
- The claim shows plugin data traps are not being mistaken for success just
  because a fixture-owned option or table row matches the expected shape while
  the real plugin also owns custom tables, serialized counters, cron rows,
  generated assets, runtime registries, or external side effects.
- The claim shows the allowlist decision was made against live plugin state,
  not inferred from a fixture row whose narrow shape hides other owned plugin
  surfaces.
- The claim shows plugin data traps cannot pass as success because one fixture
  row or option matched while the real plugin also owns other state outside
  the allowlist.
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
- The claim shows any partial file, DB, or plugin side effect is durably
  classified and that retry starts from fresh evidence rather than inherited
  approval.
- The claim shows partial file, DB, or plugin side effects do not leave an
  implied success state just because one store committed; mixed writes need
  old/new/blocked evidence for the whole path.
- The claim shows conflict policy is explicit for any late-discovered
  plugin-owned surface: the remaining work must be named old, new, or blocked,
  and a blocked late surface cannot be recast as a successful second phase on
  the same live write boundary.
- The claim shows a stale manual-review artifact cannot be widened into a
  different row, file, relationship-bearing record, or plugin-owned surface
  after drift; if it can be reused that way, the push is not production-safe.
- The claim shows the stale review artifact is audit-only after drift and is
  not treated as current write authority, retry permission, or a substitute
  for a fresh live snapshot.
- The claim shows the same live write path rejected stale authority before
  mutation, and that a route-shaped smoke or packaged-plugin mount only counts
  as compatibility evidence if it exercised that exact boundary on a drifted
  remote and the audit names the preserved remote, stale rejection point, and
  fresh retry scope.
- The claim includes the failure classification for any partial file, DB, or
  plugin side effect and shows recovery cannot silently widen the old approval
  to unrelated rows, files, relationship-bearing records, or plugin-owned
  surfaces.
- The claim includes the rejection reason for any unknown plugin-owned state
  and shows the blocked scope stayed auditable without becoming writable through
  fallback behavior.
- The claim names the hidden plugin-owned surfaces it considered, including
  runtime registries, generated assets, external side effects, and any late
  custom-table or serialized-blob discovery; if those surfaces were not
  enumerated live, they must be blocked.
- Any comparison to Reprint, ZS-Sync, or ForkPress must name the exact
  upstream commit or worktree state and say whether that exact state was
  re-verified.
- If that comparison was not re-verified at the exact live write boundary, or
  the branch cannot name the exact upstream revision or worktree state, the
  comparison is historical context only.
- A source-note comparison never becomes current proof or retry authority by
  itself; the claim must name the exact upstream revision or worktree state,
  the exact live mutation boundary, and the exact stale remote-drift case that
  failed closed. If the comparison cannot also prove the late-discovered
  plugin-owned surface stayed blocked or separately classified, it remains
  historical context only.
- The claim does not rely on route shape, packaged-plugin mounting,
  `finalMatchesLocal`, benchmark models, or source-note comparison language as
  production proof unless the same live write boundary was reverified against a
  drifted remote.
- The claim does not let a lab route, copied mount, or fixture hash become a
  proxy for the live executor, even if the endpoint path matches production.
- The claim does not let a comparison note become current proof unless it
  names the exact upstream revision or worktree state, the exact live
  mutation boundary, the preserved remote, and the stale-authority rejection
  case.
- The claim does not treat a fixture-backed or copied-lab mount as production
  proof, even if it returns live-looking hashes through a production-shaped
  route.
- The claim does not treat a green hash, endpoint match, or `finalMatchesLocal`
  result from a copied-lab or fixture-backed path as proof that the live
  mutation executor ran.
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
- The claim does not let a source-note comparison or readable review artifact
  become retry authority for any new object after drift.
- The claim does not let a stale manual-review artifact become retry authority
  just because it is readable; if it can be reused against a new row, file,
  relationship-bearing record, or plugin-owned surface, the claim is not
  production-safe.
- The claim does not let "manual resolution later" count as success unless the
  remote was preserved, the stale artifact stayed unusable, and the next retry
  rebuilt scope from fresh live evidence and is recorded as a distinct fresh
  retry artifact.
- The claim does not let "manual resolution later" stand in for success unless
  the remote was preserved for audit, the stale artifact stayed unusable, and
  the retry rebuilt scope from fresh live evidence on the same live write
  boundary.
- The claim does not let a blocked late-discovered plugin-owned surface be
  recast as a successful manual resolution, a compatibility pass, or a
  harmless second phase unless the preserved remote, the blocked surface, and
  the fresh retry scope are all named separately.
- The claim includes the exact upstream revision or worktree state for any
  Reprint, ZS-Sync, or ForkPress comparison, and says whether that exact
  state was reverified at the same live write boundary. If not, the
  comparison is historical context only.
- The claim does not let a source-note comparison imply production safety
  unless the exact upstream revision or worktree state and the exact live
  mutation boundary are both named and reverified.
- The claim does not let Reprint, ZS-Sync, or ForkPress notes imply current
  upstream reliability unless the exact upstream revision or worktree state was
  reverified and the live mutation boundary was exercised in this repo.
- The claim does not let any comparison note, manual review artifact, or
  live-looking hash stand in for proof that a live remote drifted, the stale
  authority was rejected before mutation, and the retry rebuilt scope from
  fresh live hashes.
- The claim does not let a comparison note, manual review artifact, or live
  looking hash stand in for proof that the remote stayed preserved, the stale
  authority was rejected before mutation, and the retry rebuilt scope from
  fresh live hashes.
- The claim does not treat matching route shape plus a green lab smoke as
  evidence of production safety if the underlying path never revalidated the
  live remote or the hidden plugin-owned surface at apply time.
- The claim does not treat live-looking hashes from a route-shaped smoke as
  proof of current authority unless the same evidence set also shows the
  rejected approval, preserved remote, and fresh retry scope.
- The claim does not treat manual resolution as success unless the remote is
  preserved, the stale artifact stays auditable but unusable, server-side
  rejection forces the retry to rebuild scope from fresh live hashes before
  any write, and the proof names the same live write boundary that drifted.
  "Manual resolution later" is still a failure state until the rejected
  snapshot cannot be reused as authority.
- The claim does not omit the exact upstream revision or worktree state when
  citing Reprint, ZS-Sync, or ForkPress; if that state is not named and
  reverified at the same live boundary, the comparison stays historical only.
- The claim does not treat a stale manual-review artifact as a reusable
  decision token for a new row, file, relationship-bearing record, or
  plugin-owned surface after remote drift.
- The claim does not treat a stale manual-review artifact as current authority
  merely because it stayed readable, matched the route shape, or was attached
  to a packaged-plugin smoke.
- The claim does not treat "manual resolution later" as a success state unless
  the preserved remote is still auditable, the stale artifact cannot authorize
  a retry, the next attempt starts from fresh live evidence rather than the
  old approval, and the claim names the same live write boundary that was
  revalidated.
- The claim does not let a stale approval be widened to a different row, file,
  relationship-bearing record, or plugin-owned surface on retry.
- The claim does not let a late-discovered plugin-owned surface be reclassified
  as success, compatibility, or a harmless second phase if the first write
  already happened against a different surface set.
- The claim does not let a source-note comparison become current proof unless
  the same live write boundary was reverified on this branch at the cited
  upstream state; otherwise it stays historical context only.
- The claim does not treat a production claim as valid if the proof set omits
  the create-time remap decision, the plugin-owned allowlist decision, or the
  partial side-effect classification for the exercised write path.

Release go/no-go scenarios:

- Live drift after dry-run is a hard failure unless the stale approval is
  rejected before mutation, the remote remains preserved for audit, and the
  retry scope is rebuilt from fresh live evidence.
- Create-time identity remapping is a hard failure unless the live boundary
  proves a safe remap or a hard block before mutation. A fixture that keeps
  the same ID does not prove the live remote cannot renumber or reassign.
- Unknown plugin-owned state is a hard failure unless apply-time revalidation
  either enumerates the surface or blocks it. Matching a fixture row, option,
  or generated file does not prove the rest of the plugin-owned graph is safe.
- Partial file, DB, or plugin side effects are a hard failure unless the
  failure is durably classified and the next retry starts from fresh live
  evidence rather than inherited approval.
- A readable stale manual-review artifact is audit evidence only after drift.
  It is not retry authority unless the proof shows it cannot widen to another
  row, file, relationship-bearing record, or plugin-owned surface.
- A successful manual-review claim must also name the exact rejection point and
  the exact fresh-live retry scope, not just the fact that the artifact stayed
  readable.
- A manual-resolution claim must also preserve the remote, reject the stale
  artifact before mutation, and record a distinct fresh retry artifact from
  current live hashes; if any of those are missing, the claim is not
  production-grade.
- Reprint, ZS-Sync, or ForkPress comparisons are historical context only
  unless the exact upstream revision or worktree state and the exact live
  write boundary were reverified.

If any item is missing, the wording must stay explicitly lab-backed or
comparison-only.

Extra blocker for this lane: a route, mount, or hash coming from a
fixture-backed or copied-lab path still does not count as production proof.
If the path behind the mount was not the live mutation executor, the claim
must stay lab-backed even when the response looks current.
