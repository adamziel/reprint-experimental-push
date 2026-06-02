# Progress Surface Refresh

This repo-local workflow refreshes `progress.html` and
`docs/evidence/ao-progress-report.md` during active work. It uses only local
commands inside the sandbox. It does not start a public tunnel, publish to a
remote branch, or assume any long-running remote network service.

## One-Shot Refresh

```sh
npm run refresh:progress-surface
```

The refresh command reads:

- `node scripts/release/check-release-gates.mjs --scope final-release`
- `node scripts/harness/generated-push-cases.js`
- `docs/reprint-push-completion-checklist.md`

Then it rewrites the progress report and page with the current local snapshot.

## Active Work Loop

```sh
npm run refresh:progress-surface:watch
```

The watch command repeats the same local refresh every `600000` ms, roughly
10 minutes. Stop it with Ctrl-C. To use a different cadence:

```sh
node scripts/release/refresh-progress-surface.mjs --watch --interval-ms 300000
```

For unattended local refreshes, use the managed watcher. It records a PID and
log under `.tmp/` so stale loops can be inspected and stopped cleanly:

```sh
npm run refresh:progress-surface:watch:start
npm run refresh:progress-surface:watch:status
npm run refresh:progress-surface:watch:stop
```

## Validation

```sh
npm run check:progress-surface
node --test test/progress-surface-refresh.test.js
node --test test/progress-html-release-timestamp.test.js test/release-gate-progress-release-timestamp-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md
node --check scripts/release/refresh-progress-surface.mjs
node --check scripts/release/manage-progress-surface-watch.mjs
git diff --check -- progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md scripts/release/refresh-progress-surface.mjs scripts/release/manage-progress-surface-watch.mjs test/progress-surface-refresh.test.js package.json
```

`npm run publish:progress-page:dry-run` is still the separate publish-readiness
proof. Run it only when the refreshed page should be checked against the Pages
publish workflow.
