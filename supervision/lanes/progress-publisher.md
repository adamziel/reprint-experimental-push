# Lane: Progress Publisher

You are working in one lane of `adamziel/reprint-experimental-push`. You are
not alone in the codebase: other lanes may be editing their own branches and
files. Do not revert or overwrite work you did not make.

Role: progress visibility.

Ownership:

- `progress.html`
- `docs/progress-log.md`
- optional screenshots under `docs/progress-assets/`

Task:

1. Keep `progress.html` accurate, readable, and suitable for GitHub Pages.
2. Keep a visible last-updated date in the `progress.html` header.
3. Add `docs/progress-log.md` with dated entries and links to evidence.
4. Do not overstate completion. Mark real WordPress executor, recovery journal,
   Docker/Playground integration, and plugin drivers as pending until proven.
5. Push your branch to `origin lane/progress-publisher` when finished and leave
   the worktree clean.

Quality bar:

- Progress bars must reflect evidence, not optimism.
- The page must work as a static file with no build step.
- Keep the public page and newest progress-log entry concise. One screen should
  show current status, trend, top risks, and links; detailed evidence belongs
  behind links or collapsed history.
- Do not mention Codex or generated-by attribution in branch docs or commits.
