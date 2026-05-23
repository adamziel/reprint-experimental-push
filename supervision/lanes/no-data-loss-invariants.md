# Lane: No Data Loss Invariants

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Priority: no data loss.

Ownership:

- `src/planner.js`
- additive tests in `test/push-planner.test.js`
- `docs/scenario-matrix.md`
- optional new docs under `docs/invariants/`

Task:

1. Strengthen the base/local/remote planner around no-overwrite invariants.
2. Add scenario tests for deletions, file type swaps, matching independent
   edits, and remote-only plugin changes.
3. Document what the planner may apply automatically, what it must preserve,
   and what it must stop on.
4. Push your branch to `origin lane/no-data-loss-invariants` when finished and
   leave the worktree clean.

Quality bar:

- Prefer refusing to push over guessing.
- Every mutation needs a live remote precondition.
- Conflicts must expose enough evidence for audit without leaking secrets.
- Do not mention Codex or generated-by attribution in branch docs or commits.

