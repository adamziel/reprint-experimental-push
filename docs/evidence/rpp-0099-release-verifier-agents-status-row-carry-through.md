# RPP-0099 release verifier .agents status row carry-through

Evidence toward `RPP-0099` release verifier `.agents/RELEASE_GATES.md` status row carry-through.

- Command: `umask 0022 && node --test test/release-verifier-agents-status-row-carry-through-focused-regression.test.js test/release-gate-agents-status-row-focused-regression.test.js test/release-gates-status-row.test.js test/release-gate-status-row-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js`
- Observed status: `pass`; tests: `37/37`; negative code: `AGENTS_RELEASE_GATES_ROW_REQUIRED`; positive release status: `NO-GO`.
- Scenario matrix: `dishonest-release-verdict` fails closed at `19/20`; generated `0/4` row passes the row gate and leaves release movement held only by provenance.
- Scope: focused test and evidence note only. No shared release-verifier implementation file changed.
- Coverage: the focused regression runs the release verifier fail-closed path, carries the verifier marker and checked command alongside parsed `.agents/RELEASE_GATES.md` row evidence into `check-release-gates`, and records negative/positive row scenarios without touching `.agents/RELEASE_GATES.md`, `progress.html`, or the checklist.
- Residual risk: this is bounded verifier-shaped carry-through coverage; final release movement still depends on operator production evidence provenance and integrator validation.
