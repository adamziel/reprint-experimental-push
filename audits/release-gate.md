# Production Push Release Gate

This checklist is the minimum bar before any doc, PR description, review
comment, status comment, or release note can claim production-grade push
support.

- The claim cites a live write-path proof on the actual request path, not
  only route shape, packaged-plugin mounting, fixture replay, or
  `finalMatchesLocal`.
- The claim says whether any comparison to Reprint, ZS-Sync, or ForkPress
  was re-verified against the current upstream commit or worktree state.
- The claim shows a live remote drift case between dry-run and apply, and the
  stale attempt fails closed before any mutation.
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
- The claim does not rely on route shape, packaged-plugin mounting,
  `finalMatchesLocal`, benchmark models, or source-note comparison language as
  production proof.

If any item is missing, the wording must stay explicitly lab-backed or
comparison-only.
