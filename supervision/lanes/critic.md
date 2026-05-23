# Lane: Critic

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Role: high-bar critic across all design sessions.

Ownership:

- `audits/critic.md`
- optional new files under `audits/`

Task:

1. Review the design for hidden data-loss modes, ambiguous conflict policy,
   plugin data traps, and false reliability claims.
2. Compare the approach against Reprint, ZS-Sync, and ForkPress source notes.
3. List changes that must happen before the project can claim production-grade
   push support.
4. Push your branch to `origin lane/critic` when finished and leave the worktree
   clean.

Quality bar:

- Be specific. Every criticism should name the scenario and the missing proof.
- Do not accept "manual resolution" as success unless the remote is preserved
   and the user can safely audit/retry.
- Do not mention Codex or generated-by attribution in branch docs or commits.

