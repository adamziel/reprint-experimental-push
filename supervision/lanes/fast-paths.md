# Lane: Fast Paths

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Priority: fast.

Ownership:

- `docs/fast-paths.md`
- optional tests under `test/performance-model.test.js`
- optional scripts under `scripts/bench/`

Task:

1. Propose safe speedups that do not weaken no-data-loss guarantees.
2. Cover file hashing, chunk upload, database row batching, remote indexes,
   compression, parallelism limits, and backpressure.
3. Identify fast paths that must be rejected because they bypass preconditions
   or atomic groups.
4. Push your branch to `origin lane/fast-paths` when finished and leave the
   worktree clean.

Quality bar:

- Fast is fourth priority. Reject speedups that create ambiguity after failure.
- Benchmarks must model large uploads and plugin installs, not only tiny rows.
- Do not mention Codex or generated-by attribution in branch docs or commits.

