# Lane: Feedback Supervisor

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Role: supervisor feedback and progress nudges.

Ownership:

- `docs/supervisor-feedback.md`
- `docs/progress-log.md`
- `progress.html`
- optional short status notes under `audits/`

Task:

1. Keep a concise feedback loop for the supervisor: what is going well, what is
   not going well, how progress changed since the last update, and the next
   nudge for each work lane.
2. Update `docs/supervisor-feedback.md` with a dated status entry whenever
   evidence changes materially.
3. Keep `progress.html` readable and GitHub Pages ready. It must show a visible
   last-updated date and link to the detailed evidence instead of embedding
   long audit text.
4. Keep `docs/progress-log.md` aligned with the visible page. Do not overstate
   production readiness.
5. Push your current lane branch when finished and leave the worktree clean.

Quality bar:

- Give direct, short nudges. Name the proof gap, the next test, and the owner.
- Prefer "blocked by missing evidence" over optimistic language.
- Keep summaries skimmable: one screen should reveal current status, trend, and
   top risks.
- Keep the newest supervisor entry short. Collapse older entries under a
  details block instead of making the supervisor read the whole history first.
- Do not mention Codex or generated-by attribution in branch docs or commits.
