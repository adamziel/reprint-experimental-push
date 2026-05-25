# Production Push Release Gate

This checklist is the minimum bar before any doc, PR description, review
comment, status comment, or release note can claim production-grade push
support.

- The claim cites a live write-path proof on the actual request path, not
  only route shape, packaged-plugin mounting, fixture replay, or
  `finalMatchesLocal`.
- The claim says whether any comparison to Reprint, ZS-Sync, or ForkPress
  was re-verified against the current upstream commit or worktree state.
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
- The claim shows any partial file, DB, or plugin side effect is classified
  durably and that retry starts from fresh evidence rather than reused
  approval.
- The claim shows a manual-resolution artifact remains readable for audit but
  cannot authorize a widened retry after the live snapshot changes.
- The claim includes the exact live hashes, the rejected stale approval, the
  retry scope, and the proof that the remote was preserved for audit.
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
