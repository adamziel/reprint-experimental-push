# Lane: No Data Loss Recovery

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Priority: no data loss.

Ownership:

- `src/apply.js`
- additive tests in `test/push-planner.test.js`
- optional new docs under `docs/recovery/`

Task:

1. Extend the atomic apply model toward durable journals and recovery states.
2. Add tests for failure before mutation, after staging, after dependency
   validation, and replaying a completed plan.
3. Define the acceptable post-failure states: old remote, fully updated remote,
   or blocked recovery state with artifacts.
4. Push your branch to `origin lane/no-data-loss-recovery` when finished and
   leave the worktree clean.

Quality bar:

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying must not duplicate inserts or resurrect stale local data.
- Do not mention Codex or generated-by attribution in branch docs or commits.

