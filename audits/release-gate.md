# Production Push Release Gate

This checklist is the minimum bar before any doc, PR description, review
comment, status comment, or release note can claim production-grade push
support.

- The claim cites a live write-path proof on the actual request path, not
  only route shape, packaged-plugin mounting, fixture replay, or
  `finalMatchesLocal`.
- A lab-shaped route that only matches ingress, endpoint name, package
  layout, or a live-looking hash is compatibility evidence only; it does
  not prove the production executor ran, the remote was preserved, or stale
  authority failed closed.
- A green lab smoke is never enough unless the same request path was re-run
  against a live remote after drift and the stale attempt failed before any
  mutation.
- A route-shaped or package-shaped smoke never upgrades stale manual review
  into current authority; the claim must show the stale artifact was rejected
  against the fresh live snapshot before any write, not merely still readable
  for audit.
- The claim says whether any comparison to Reprint, ZS-Sync, or ForkPress
  was re-verified against the current upstream commit or worktree state.
- The claim does not treat an unverified Reprint, ZS-Sync, or ForkPress
  comparison as current proof, even if the endpoint path, package layout, or
  expected hash looks production-shaped.
- If the cited upstream commit or worktree state was not re-verified against
  the exact live mutation boundary being claimed, the comparison stays
  historical context only and cannot be promoted into current proof by a
  matching route shape, package layout, or fixture-backed smoke.
- If that upstream comparison was not re-verified, the claim must label it as
  historical context only and must not present it as current proof. A
  comparison note that sounds current but lacks re-verification is still a
  stale assumption about behavior, not evidence for this repo's live write
  path.
- The claim shows a live remote drift case between dry-run and apply, and the
  stale attempt fails closed before any mutation.
- The claim shows the stale manual-review artifact remains readable for audit
  but is unusable for apply after drift, and the next retry starts from fresh
  live hashes rather than inherited approval.
- The claim shows create-time identity remapping is either safely represented
  or hard-blocked before write.
- The claim shows plugin-owned state outside the allowlist is either
  discovered or hard-blocked, including options, custom tables, generated
  files, activation hooks, cron, cache state, and other plugin side effects.
- The claim shows plugin-owned ownership changes are revalidated at apply
  time, not inherited from stale local metadata.
- The claim shows any partial file, DB, or plugin side effect is classified
  durably and that retry starts from fresh evidence rather than reused
  approval.
- The claim shows a manual-resolution artifact remains readable for audit but
  cannot authorize a widened retry after the live snapshot changes.
- The claim includes the exact live hashes, the rejected stale approval, the
  retry scope, and the proof that the remote was preserved for audit.
- The claim includes the exact stale snapshot or hash set that invalidated
  the old approval and the exact replay-safe boundary that prevented reuse.
- The claim includes the exact live snapshot or hash set that invalidated the
  old approval, not just a route-shaped smoke result or a package mount that
  happened to look current.
- The claim identifies the exact reverified upstream revision or worktree for
  any Reprint, ZS-Sync, or ForkPress comparison; otherwise the comparison is
  context only.
- The claim does not rely on route shape, packaged-plugin mounting,
  `finalMatchesLocal`, benchmark models, or source-note comparison language as
  production proof.
- The claim does not treat a lab route shape or fixture-shaped package mount
  as proof of current production safety, even if the path name matches the
  production route.
- The claim does not treat manual resolution as success unless the remote is
  preserved, the stale artifact stays auditable but unusable, and the retry
  rebuilds scope from fresh live hashes before any write.
- The claim does not treat a stale review artifact as current authority even
  if it is still readable, because readability alone does not preserve the
  remote or prove the write path failed closed.

If any item is missing, the wording must stay explicitly lab-backed or
comparison-only.
