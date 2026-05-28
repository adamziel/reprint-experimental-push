# AO critic evidence: plugin-driver/generated-harness queue — 2026-05-28

Snapshot time: 2026-05-28 06:12 CEST
Critic branch: `session/rpp-37`
Audited lane: `origin/lane/evidence-integration-20260527` at `67d50f384`
Checklist posture: 110 checked / 890 open; final release remains **NO-GO**.
Detailed audit: `audits/ao-critic-plugin-harness-queue-20260528.md`

## Evidence summary

- `RPP-0421` is now integrated on the lane via `78323671d`, but its raw worker
  ref `e9c94906d` is superseded and behind current lane. The evidence is focused
  driver registration API support in `test/playground-snapshot-lib.test.js`, not
  broad production-backed plugin-driver semantics.
- The true `RPP-0415` remote-plugin-removal candidate
  `origin/session/rpp-32-rpp-0415-remote-plugin-removal-refusal` is behind lane
  by 24 commits and has a `src/planner.js` merge conflict. Skip raw integration
  until it is restacked from `67d50f384`.
- The other `RPP-0415` ref, plugin activation hook effects at `cbf5a1a85`, does
  not match the checklist row title and should be re-scoped before checklist
  movement.
- `RPP-0425` and `RPP-0426` both edit only `test/push-planner.test.js`; pairwise
  merge-tree reports `changed in both`. Treat them as local planner support
  unless additional production-shaped evidence is added.
- `RPP-0427` was local dirty work in `rpp-32` at snapshot time, mixing
  `src/apply.js`, planner tests, generated-harness files, and an untracked
  evidence doc. It is not integrated evidence.
- `RPP-0431` had no origin ref at snapshot time and the local branch was still
  based on `3bd9dc676`, behind lane by 2.
- `RPP-0115`, `RPP-0116`, `RPP-0117`, and local `RPP-0118` all overlap in
  `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`,
  and `test/generated-push-harness.test.js`; pairwise merge-tree probes report
  `changed in both`. They need one current-lane aggregation pass.
- Extracted candidate docs and the active `RPP-0427` evidence doc reported
  artifact redaction `ok: true`, 0 rejected files.

## Follow-up owners

- Plugin-driver integrator: restack true `RPP-0415` from `67d50f384`, resolving
  `src/planner.js` against current plugin-driver guards.
- `rpp-34`/plugin-driver owner: combine or order `RPP-0425` and `RPP-0426` in
  `test/push-planner.test.js`, and keep production-backed wording out unless new
  proof is added.
- `rpp-32`: split `RPP-0427` plugin-driver edits from generated-harness edits,
  then scan and push only a coherent branch.
- Generated-harness integrator: rebuild `RPP-0115`/`RPP-0116`/`RPP-0117`/`RPP-0118`
  cases from current lane, then rerun the generated harness focused test and
  checklist lint.
- Progress reporter: keep release posture **NO-GO** and avoid counting
  branch-local work or raw superseded refs as integrated evidence.
