No Data Loss Recovery handoff:

- Timestamp: 2026-05-27 11:22:28 CEST (+0200)
- Branch head at handoff: `64ecf6e2c`

What changed:

- Tightened the apply-side production recovery support report in `src/apply.js` so checked durable-journal boundary acceptance now requires the inspected top-level `leaseFence` to surface its own enumerable `storageGuard` marker, instead of trusting only the nested lease-fence contract reconstruction.
- Added a lease-fence identity helper that accepts the surfaced `storageGuard` marker without treating it as identity drift, and used it in the checked-boundary claim/lease comparisons that consume recovery inspection state.
- Added a focused regression in `test/push-planner.test.js` proving the boundary now stays closed when the inspected top-level `leaseFence` omits `storageGuard`, while the positive packaged checked-boundary fixture still passes once it surfaces the marker and explicit claim ids.

Changed files:

- `src/apply.js`
- `test/push-planner.test.js`
- `.lane-output/final.md`

Commands:

- `git status --short --branch`
- `git log --oneline --decorate -8`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,240p' supervision/README.md`
- `sed -n '1,240p' supervision/lanes/no-data-loss-recovery.md`
- `sed -n '1,220p' .lane-output/final.md`
- `sed -n '1,220p' .lane-output/final-loop-20260527-111029.md`
- `sed -n '1,220p' .lane-output/final-loop-20260527-110737.md`
- `grep -R -n "production durable journal partial commits fail closed\\|recovery artifact\\|blocked recovery\\|claimKeyHash\\|writerLease\\|staleClaimRejected\\|restartReadable" src test`
- `sed -n '1380,1495p' src/apply.js`
- `sed -n '1500,1865p' src/apply.js`
- `sed -n '180,320p' src/recovery-journal.js`
- `sed -n '21000,21480p' test/push-planner.test.js`
- `node --input-type=module <<'EOF' ... productionRecoverySupportReport probe ... EOF`
- `node --input-type=module <<'EOF' ... classifyRecoveryJournalClaims probe ... EOF`
- `timeout 60s node --test --test-name-pattern="production recovery support report surfaces a satisfied checked durable-journal boundary when the inspected lease fence matches the packaged production contract|production recovery support report keeps the checked boundary closed when the inspected lease fence omits its own storageGuard marker" test/push-planner.test.js`
- `node --check src/apply.js`
- `git diff --check`
- `git diff -- src/apply.js test/push-planner.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Verification:

- The direct `productionRecoverySupportReport(...)` probe showed the older checked-boundary fixture still failed because the surfaced inspected claim records were missing explicit `claimId` fields; after aligning the focused fixtures, the only remaining difference was the missing top-level `leaseFence.storageGuard` marker.
- `timeout 60s node --test --test-name-pattern="production recovery support report surfaces a satisfied checked durable-journal boundary when the inspected lease fence matches the packaged production contract|production recovery support report keeps the checked boundary closed when the inspected lease fence omits its own storageGuard marker" test/push-planner.test.js` passed `2/2`.
- `node --check src/apply.js` passed.
- `git diff --check` passed.

Push result:

- Pending commit/push from this lane after the handoff file update.

Worktree status:

- `## lane/no-data-loss-recovery-work...origin/lane/no-data-loss-recovery`
- Modified: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`

Next supervisor nudge:

- Have `main:reliable-exec` consume this stricter apply-side checked-boundary rule if its release verifier still accepts durable-journal ownership proof reconstructed from nested lease-fence contracts when the surfaced top-level `leaseFence` never exposes its own `storageGuard`.
- Keep the next reliable-owned pass on the remaining release boundary: production auth/session lifecycle, preserved-remote retry, or deeper production durable-journal semantics beyond this now-aligned top-level lease-fence surface check.
