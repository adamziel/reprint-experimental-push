# Lane: Reliable Executor

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Priority: reliable.

Ownership:

- `docs/protocol.md`
- `docs/executor.md`
- optional fixtures under `fixtures/protocol/`

Task:

1. Design the real Reprint push protocol extension: preflight, remote snapshot
   hash listing, dry-run plan upload, mutation batch apply, journal inspect,
   and recovery.
2. Include how this maps to the existing Reprint exporter/importer pull
   pipeline.
3. Define Docker or Playground test topology for one remote and one local site.
4. Push your branch to `origin lane/reliable-executor` when finished and leave
   the worktree clean.

Quality bar:

- Remote liveness means dry-run and apply are separate; apply must revalidate.
- Authentication must be at least as strict as current Reprint HMAC usage.
- Do not mention Codex or generated-by attribution in branch docs or commits.

