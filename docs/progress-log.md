# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-28 - Gate, Recovery, Chunk, Plugin, Audit, Graph, Auth, and Supervision Hold Refresh

- Last update: 2026-05-28 03:22 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527` at
  `25c667cd4` (`Refresh AO supervision handoff`).
- New integrated release-gate evidence: `ab0340786` extends
  [docs/evidence/ao-release-gates.md](evidence/ao-release-gates.md) and
  [test/release-gates.test.js](../test/release-gates.test.js) so the first 20
  modeled gates now have 11 focused tests, including missing/failed auth,
  route, read-only, operator-proof, timestamp, status-row, and nonzero
  `verify:release` failure evidence.
- New integrated recovery evidence:
  [docs/evidence/ao-journal-recovery.md](evidence/ao-journal-recovery.md),
  [src/recovery-journal.js](../src/recovery-journal.js),
  [src/recovery-inspect.js](../src/recovery-inspect.js), and
  [test/recovery-journal.test.js](../test/recovery-journal.test.js).
  Recovery journals now have deterministic paged restart readback,
  claim-scoped stale lease identity, append-only same-claim retry evidence, and
  a fail-closed guard that refuses `journal-completed` after incomplete apply.
- New integrated chunking evidence:
  [docs/evidence/ao-chunking-benchmark.md](evidence/ao-chunking-benchmark.md),
  [scripts/bench/guarded-executor-benchmark.js](../scripts/bench/guarded-executor-benchmark.js),
  [test/guarded-executor-benchmark.test.js](../test/guarded-executor-benchmark.test.js),
  and [docs/fast-paths.md](fast-paths.md). The benchmark names 10 rollout
  safety gates before throughput; 7 pass in the lab model and 3 remain blocked
  for production storage receipts, production row batch execution, and
  production atomic group commit evidence.
- New integrated plugin-driver evidence:
  [docs/evidence/ao-plugin-driver.md](evidence/ao-plugin-driver.md) records
  exact owner/driver/table binding for the production release-state row plus
  fail-closed guards for arbitrary custom tables, serialized plugin-owned
  options, direct activation/update, and direct `active_plugins` mutation.
- New integrated audit evidence:
  [docs/evidence/ao-independent-audit.md](evidence/ao-independent-audit.md),
  [docs/evidence/ao-critic.md](evidence/ao-critic.md),
  [audits/ao-independent-audit-20260528.md](../audits/ao-independent-audit-20260528.md),
  and [audits/ao-critic-20260528.md](../audits/ao-critic-20260528.md). The
  audits keep release at no-go, cite the fail-closed `verify:release` posture,
  missing repo-local CI workflow, and red broader-suite/auth/plugin/snapshot
  risks.
- New integrated graph evidence:
  [docs/evidence/ao-graph-identity.md](evidence/ao-graph-identity.md),
  [src/planner.js](../src/planner.js),
  [scripts/bench/graph-mapping-inventory.js](../scripts/bench/graph-mapping-inventory.js),
  [test/push-planner.test.js](../test/push-planner.test.js), and
  [test/graph-mapping-inventory.test.js](../test/graph-mapping-inventory.test.js)
  add explicit identity-map rewrites and fail-closed collision handling for a
  defined WordPress graph slice.
- New integrated executor auth/lease evidence:
  [docs/evidence/ao-executor-auth-leases.md](evidence/ao-executor-auth-leases.md),
  [src/authenticated-http-push-client.js](../src/authenticated-http-push-client.js),
  [test/authenticated-http-push-client.test.js](../test/authenticated-http-push-client.test.js),
  [docs/protocol.md](protocol.md), and protocol fixtures prove idempotency-free
  signed read-only journal/recovery inspect requests, canonical signed query
  ordering, fresh retry nonces, and idempotency-bound mutation paths. The
  evidence doc keeps broader authenticated-client production-shaped failures as
  blockers rather than readiness evidence.
- New integrated supervision evidence:
  [docs/evidence/ao-supervision-handoff.md](evidence/ao-supervision-handoff.md)
  now records the live `rpp-10` through `rpp-21` team, retired stale
  `rpp-1` through `rpp-9` panes after pushed branch verification, and reiterates
  no AO lifecycle helpers/no remote tunnels for this sandbox.
- RPP evidence carried by the integrated commits includes `RPP-0008` through
  `RPP-0020`, `RPP-0301`, `RPP-0304`, `RPP-0305`, `RPP-0312`, `RPP-0313`,
  `RPP-0314`, `RPP-0318`, `RPP-0319`, `RPP-0320`, `RPP-0321`, `RPP-0324`,
  `RPP-0325`, `RPP-0332`, `RPP-0333`, `RPP-0334`, `RPP-0402`, `RPP-0403`,
  `RPP-0404`, `RPP-0408`, `RPP-0409`, `RPP-0410`, `RPP-0412`, `RPP-0422`,
  `RPP-0423`, `RPP-0424`, `RPP-0428`, `RPP-0429`, `RPP-0430`,
  `RPP-0432`, `RPP-0505`, `RPP-0506`, `RPP-0512`,
  `RPP-0513`, `RPP-0515`, `RPP-0525`, `RPP-0526`, `RPP-0532`, `RPP-0533`,
  `RPP-0535`, `RPP-0603`, `RPP-0604`, `RPP-0606`, `RPP-0614`,
  `RPP-0618`, `RPP-0619`,
  `RPP-0623`, `RPP-0624`, `RPP-0626`, `RPP-0634`, `RPP-0706`, `RPP-0707`,
  `RPP-0708`, `RPP-0720`, `RPP-0726`, `RPP-0727`, `RPP-0728`, `RPP-0901`
  through `RPP-0915`, `RPP-0921` through `RPP-0924`, `RPP-0926`, `RPP-0932`,
  `RPP-0933`, and supervision-handoff evidence for the current active roster.
- Progress-reporter verification passed:
  `node --test test/release-gates.test.js`,
  `node --test test/recovery-journal.test.js`,
  `npm run test:recovery:file-journal`, and
  `node --test test/guarded-executor-benchmark.test.js`,
  `node --test test/graph-mapping-inventory.test.js test/generated-push-harness.test.js`,
  `node --test test/push-planner.test.js`, targeted read-only authenticated-client checks,
  `node --check src/authenticated-http-push-client.js`, and protocol fixture JSON parsing.
- Checked results: release-gate evaluator 11 pass / 0 fail; recovery journal
  tests 21 pass / 0 fail; file-journal restart smoke kept fail-after-2 in
  `blocked-recovery` with 6 old / 2 new targets, replay applied 0 extra
  mutations, and drift exposed 1 blocked-unknown target; guarded benchmark
  tests 6 pass / 0 fail; graph inventory/generated harness checks 3 pass / 0 fail;
  push planner checks 87 pass / 0 fail; targeted auth read-only inspect checks,
  source syntax check, and protocol fixture JSON parsing passed.
- Active AO roster from tmux: developer lanes `rpp-10` through `rpp-14` are
  working on Docker/local production, rollback repair, release CI gates,
  evidence redaction, and protocol compatibility; `rpp-15` is the critic;
  `rpp-16` is this progress reporter; `rpp-17` through `rpp-21` are active
  integration/route/operator-proof workers; `rpp-orchestrator` remains visible.
  Remaining branch-local outputs are `rpp-9` prior progress evidence and
  `rpp-18` evidence coverage manifest `56a1e533b`; `rpp-1` through `rpp-8` are
  represented by integrated commits listed above.
- Release posture: final release remains held. The new commits improve gate
  precision, local recovery boundaries, benchmark safety gates, plugin-driver
  support guards, audit visibility, graph identity mapping, read-only auth inspect coverage,
  and supervision freshness, but
  Docker/external WordPress durability, production credential lifecycle,
  broader graph/plugin-driver semantics, rollback/repair completion, production
  chunk receipts/executors, redaction, protocol compatibility, required CI
  gates, broader production auth lifecycle fixes, and red-suite fixes still
  require production-backed evidence.
- Percent movement: no final readiness movement. This is integrated hardening
  and progress-report freshness, not final production proof.

## 2026-05-28 - Release Gate Evaluator and AO Progress Hold

- Last update: 2026-05-28 03:02 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527` at
  `243dfe777` (`Add fail-closed release gate evaluator`).
- New release-gate evidence:
  [src/release-gates.js](../src/release-gates.js),
  [test/release-gates.test.js](../test/release-gates.test.js), and
  [docs/evidence/ao-release-gates.md](evidence/ao-release-gates.md).
- What changed: `evaluateReleaseGates()` now emits a machine-readable
  `releaseMovement`, `candidateMovement`, exact per-gate evidence objects, and
  a tmux-friendly bracketed status marker. The first 20 release-gate foundation
  items now have executable evaluator coverage rather than stale percentages.
- Verification passed:
  `node --check src/release-gates.js`,
  `node --test test/release-gates.test.js`, and `git diff --check`.
- Checked test result: 8 pass / 0 fail in `test/release-gates.test.js`.
- Release posture: the evaluator can report `candidate-for-review` for complete
  local candidate evidence, but final `releaseMovement.allowed` remains `false`
  until every gate is backed by `final-release` evidence. This keeps Docker or
  external WordPress, production credential lifecycle, durable journal, broader
  graph/plugin coverage, rollback/repair, and benchmark rollout as required
  work.
- AO supervision update:
  [docs/evidence/ao-supervision-handoff.md](evidence/ao-supervision-handoff.md)
  now records the tmux-visible AO team and the no-helper operating rule:
  supervise with tmux/process/git inspection and bounded `ao spawn`, not
  hanging AO lifecycle helpers.
- Progress report:
  [docs/evidence/ao-progress-report.md](evidence/ao-progress-report.md) records
  the current no-go decision and separates integrated proof from unintegrated
  worker output.
- Percent movement: no final readiness movement. This is stronger release-gate
  machinery and operator evidence, not production release proof.

## 2026-05-28 - 1000-Item Completion Checklist

- Last update: 2026-05-28 02:43 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New tracker:
  `docs/reprint-push-completion-checklist.md`.
- Checklist shape: exactly 1000 unchecked items, `RPP-0001` through
  `RPP-1000`, ordered from near-term release-gate foundation work through
  farthest release/operations work.
- Near-to-far sections:
  - `RPP-0001` through `RPP-0100`: release gate foundation;
  - `RPP-0101` through `RPP-0200`: generated harness expansion;
  - `RPP-0201` through `RPP-0300`: planner no-data-loss invariants;
  - `RPP-0301` through `RPP-0400`: WordPress graph identity mapping;
  - `RPP-0401` through `RPP-0500`: plugin-driver ownership boundary;
  - `RPP-0501` through `RPP-0600`: production executor and auth protocol;
  - `RPP-0601` through `RPP-0700`: durable journal and recovery;
  - `RPP-0701` through `RPP-0800`: storage, chunking, and performance;
  - `RPP-0801` through `RPP-0900`: production topology and integrations;
  - `RPP-0901` through `RPP-1000`: audit, release, and operations.
- Completion rule: an item is not complete until the named success evidence is
  present in repository files, command output, tmux proof, release gate status,
  or production run cited by the progress report. The checklist explicitly
  warns against marking items done from intent, design notes, or too-narrow
  fixtures.
- Team supervision: the next tmux-visible worker lanes are being started from
  this checklist, one slice at a time, with separate worktrees and branches so
  they can make progress without overwriting the integration branch.
- Verification:
  `rg -c '^- \\[ \\] RPP-[0-9]{4}' docs/reprint-push-completion-checklist.md`
  returned `1000`.

## 2026-05-28 - Generated Push Harness

- Last update: 2026-05-28 02:35 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command: `npm run test:generated-push-harness`.
- New harness: `scripts/harness/generated-push-cases.js` generates 360
  deterministic Reprint push cases by default, with a hard minimum of 300.
  The generator spans 10 complexity tiers and 24 scenario families, then adds
  seeded variation instead of storing exact-shaped fixture outputs.
- Coverage from the checked summary command:
  - 360 total cases;
  - statuses: 203 ready, 129 conflict, 28 blocked;
  - 36 cases in every tier from 0 through 9;
  - tier-9 still includes 16 ready/apply cases;
  - max resource count 69, max mutation count 44;
  - max ready resource count 66, max ready mutation count 43;
  - totals across all cases: 5008 planned mutations, 312 conflicts,
    375 blockers, and 929 decisions.
- Scenario surfaces include local edits, remote-only edits, independent merge,
  same independent content, deletes, delete/edit conflicts, file topology
  conflicts, supported and unsupported plugin-owned data, plugin owner-context
  drift, supported forms-lab custom-table rows, forms-lab delete refusal,
  atomic plugin install ready and missing-dependency paths, same-plan
  post-parent, taxonomy, comment, and usermeta graph closures, and stale graph
  references.
- General invariants checked for every generated case:
  plan summary counts match actual arrays; every mutation has a matching
  live-remote precondition and hash; ready plans apply only planned local
  values while preserving every unplanned remote resource; ready plans reject
  stale remotes before mutation; non-ready plans refuse apply and leave the
  remote unchanged; conflicts and blockers do not still carry mutations for
  the same blocked/conflicted resource; plugin-owned mutations carry explicit
  owner and driver evidence.
- Focused checks passed:
  `node --check scripts/harness/generated-push-cases.js`,
  `npm run test:generated-push-harness`,
  `node scripts/harness/generated-push-cases.js`, and `git diff --check`.
- Caveat: this is a pure generated model harness. It is intentionally broad,
  reusable, and fast, but it does not replace the live local production,
  Docker/external WordPress, auth/session, durable journal, or plugin-driver
  release-boundary proofs.
- Percent movement: merge invariants move from 71% to 72%; independent
  evidence moves from 72% to 74%. Recovery boundaries stay at 60%, reliable
  executor/protocol stays at 75%, and fast path/chunking stays at 37%.

## 2026-05-28 - Local Plugin Driver Release Evidence

- Last update: 2026-05-28 02:24 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:plugin-driver`
  passed in tmux window `main:plugin-driver-local-proof` with
  `[PLUGIN_DRIVER_LOCAL_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof now extracts a
  production-owned release-state plugin driver boundary for
  `row:["wp_reprint_push_release_state","state_id:1"]`. The proof records the
  exact owner `reprint-push`, driver `reprint-push-release-state`, custom
  table `wp_reprint_push_release_state`, plugin-owned allowlist entry,
  live-remote precondition, remote-drift conflict evidence, and apply-time
  revalidation.
- Planner evidence: the ready plan had 22 mutations, 22 live-remote
  preconditions, 0 blockers, and mutation families `file: 3`,
  `row:wp_options: 1`, `row:wp_postmeta: 5`, `row:wp_posts: 12`, and
  `row:wp_reprint_push_release_state: 1`. The remote-drift plan still failed
  closed with 9 preserve-remote conflicts.
- Plugin-driver evidence: the source release-state row hashed to
  `66e0ed254af87dc8528a54ef2f51f7a61d48b6f515d52e7959f31ff23b320549`,
  the local edited row hashed to
  `5a646c3411196965f91b027b8906486a47ee26b7d2ab5e82265c9e2b21fab9ba`,
  and the remote changed row hashed to
  `c5928d13e184cf03c37734c60271610918deb14fc97afad5313131255e3d3ab9`.
  The checked invariants prove the allowlist owner/driver match is exact,
  mutation `mutation-22` is driver-owned, the precondition is checked against
  the live remote and matches the source/base/remote-before hash, remote drift
  fails closed as `plugin-data-conflict`, direct `active_plugins` mutation is
  absent, unowned option mutation is absent, and the custom-table mutation is
  driver-owned.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `6b2e4ade17525e5d1c08e99f4f745257a41a19cba2e1cf5c8819e323bf337b13`,
  reported 74 durable DB-journal rows, `mutationApplied: 22`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 22`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK`, replay equivalence, and
  `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 22 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing with
  previous claim identity, 22/22 fully updated recovery inspect, and blocked
  apply-time revalidation state with `old: 21`, `new: 0`,
  `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:plugin-driver`.
- Caveat: this is local Playground loopback evidence for one
  production-owned release-state plugin-driver row. It does not prove arbitrary
  plugin semantics, arbitrary custom tables, plugin activation/update flows,
  rollback, Docker/external WordPress durability, or the final live production
  source boundary.
- Percent movement: merge invariants move from 70% to 71%; reliable
  executor/protocol moves from 73% to 75%; independent evidence moves from 70%
  to 72%. Recovery boundaries stay at 60%, and fast path/chunking stays at
  37%.

## 2026-05-28 - Plugin Driver Boundary Test Hardening

- Last update: 2026-05-28 02:13 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- Code change: the production-shaped proof tests now include a reusable
  plugin-driver proof fixture and three additional GATE-4 guard cases.
- New executable support evidence:
  - unknown plugin-owned custom-table data blocks before mutation with
    `unsupported-plugin-owned-resource`;
  - plugin-driver boundary proof rejects an allowlist entry whose owner and
    driver do not exactly match the production boundary;
  - direct `active_plugins` mutation and unowned serialized option mutation
    both fail the production plugin-driver boundary summary.
- Focused checks passed:
  `node --check test/production-shaped-proof.test.js`,
  `node --test --test-name-pattern "production plugin-driver boundary" test/production-shaped-proof.test.js`,
  and `git diff --check`.
- Caveat: this is support test coverage on the production-shaped proof
  summarizer and planner. It does not prove a live external WordPress
  plugin-owned mutation, arbitrary plugin semantics, activation/update flows,
  rollback, or Docker/external production durability.
- Percent movement: merge invariants move from 69% to 70%; reliable
  executor/protocol moves from 72% to 73%; independent evidence moves from 69%
  to 70%. Recovery boundaries stay at 60%, and fast path/chunking stays at
  37%.

## 2026-05-28 - Comment Graph Evidence And Journal Claim Readback

- Last update: 2026-05-28 02:06 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:comment-graph`
  passed in tmux window `main:comment-graph-proof4` with
  `[COMMENT_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a same-plan comment graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF=1`. The fixture
  creates a parent comment `row:["wp_comments","comment_ID:72801"]`, child
  comment `row:["wp_comments","comment_ID:72802"]`, and marker commentmeta
  row `row:["wp_commentmeta","meta_id:72811"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local comment parent, 1 local comment child, and 1 local commentmeta
  row. The ready plan had 25 mutations, 25 live-remote preconditions,
  0 blockers, and mutation families `file: 3`, `row:wp_commentmeta: 1`,
  `row:wp_comments: 2`, `row:wp_options: 1`, `row:wp_postmeta: 5`,
  `row:wp_posts: 12`, and `row:wp_reprint_push_release_state: 1`.
- Comment graph evidence: the parent comment references the fixture post, the
  child comment references the same-plan parent comment, the commentmeta row
  references the same-plan child comment, all three resources were planned
  with live preconditions, and `staleGraphBlockers: 0`. The remote-drift plan
  still failed closed with 9 preserve-remote conflicts and 3 blockers.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `a617629dfc086d29ffbbf907a425e54a90f6ca231d4de8c73dad3d39827018af`,
  reported 83 durable DB journal rows, `mutationApplied: 25`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 25`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 25 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing with
  previous claim id `psh_3547ecddfc8152e839d96b43bf2`, 25/25 fully updated
  recovery inspect, and blocked apply-time revalidation state with `old: 24`,
  `new: 0`, `blockedUnknown: 1`.
- Journal hardening: the 25-mutation run exposed that stale retry proof could
  lose the previous claim identity when a thinner recovery-inspect journal was
  selected. The checked JS durable-journal contract now requires previous
  claim identity whenever stale-claim rejection is asserted, checked recovery
  journal readback uses the 500-row window and can fetch the previous claim row
  by cursor, the release proof builder selects the strongest journal evidence
  candidate, and the authenticated client requests a 370-row first journal
  window for 25-mutation plans.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `node --check scripts/playground/production-shaped-live-release-verify-lib.js`,
  `node --check src/authenticated-http-push-client.js`,
  `node --check src/recovery-journal.js`,
  `php -l scripts/playground/snapshot-lib.php`,
  `php -l scripts/playground/push-db-journal-lib.php`,
  `php -l scripts/playground/push-remote-rest-plugin.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "comment|commentmeta|post parent|same-plan post|graph closure|featured image|taxonomy" test/push-planner.test.js`,
  `node --test --test-name-pattern "db journal proof requires the checked durable-journal contract|db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `node --test --test-name-pattern "checked durable journal" test/recovery-journal.test.js`,
  `node --test --test-name-pattern "durable recovery journal release proof" test/production-shaped-proof.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:comment-graph`.
- Caveat: this closes one local Playground same-plan comment/commentmeta
  fixture with stable fixture identities. It does not prove general WordPress
  identity rewriting for arbitrary comments, comment authors, comment
  moderation state, threaded comment imports, GUIDs, menus, serialized blocks,
  production importer/exporter identity maps, Docker/external WordPress
  durability, rollback, or general plugin-driver correctness.
- Percent movement: merge invariants move from 66% to 69%; recovery
  boundaries move from 58% to 60%; reliable executor/protocol moves from 71%
  to 72%; independent evidence moves from 67% to 69%. Fast path/chunking stays
  at 37% because this proof adds graph and journal correctness, not a new
  transfer benchmark.

## 2026-05-28 - Post Parent Graph Evidence

- Last update: 2026-05-28 01:37 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:post-parent-graph`
  passed in tmux window `main:post-parent-graph-proof` with
  `[POST_PARENT_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a same-plan `post_parent` graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF=1`. The
  fixture creates a local-only parent page
  `row:["wp_posts","ID:71801"]` and child page
  `row:["wp_posts","ID:71802"]`, where the child row's `post_parent` points at
  the same-plan parent row.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local post-parent graph parent, and 1 local post-parent graph child.
  The ready plan had 24 mutations, 24 live-remote preconditions, 0 blockers,
  and mutation families `file: 3`, `row:wp_options: 1`,
  `row:wp_postmeta: 5`, `row:wp_posts: 14`, and
  `row:wp_reprint_push_release_state: 1`.
- Graph evidence: the parent and child post resources were both planned with
  live preconditions, `childReferencesParent: true`, and
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `23d0f2068a5cff0b6ef62b4b3b40919e938f8d7d47d0a41198414cc3f1f6ddef`,
  reported 80 durable DB journal rows, `mutationApplied: 24`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 24`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 24 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 24/24
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 23`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "post parent|same-plan post|graph closure|featured image|taxonomy" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:post-parent-graph`.
- Caveat: this closes one local Playground same-plan `post_parent` fixture with
  stable fixture identities. It does not prove general WordPress identity
  rewriting for arbitrary parent/child pages, arbitrary attachments, GUIDs,
  menus, serialized blocks, custom taxonomies, production importer/exporter
  identity maps, external WordPress durability, rollback, or general
  plugin-driver correctness.
- Percent movement: merge invariants move from 64% to 66%; reliable
  executor/protocol stays at 71%; independent evidence moves from 66% to 67%.
  Recovery boundaries stay at 58%, and fast path/chunking stays at 37% because
  this proof adds graph coverage, not external crash durability or a larger
  transfer benchmark.

## 2026-05-28 - Taxonomy Graph Evidence

- Last update: 2026-05-28 01:20 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:taxonomy-graph`
  passed in tmux window `main:taxonomy-graph-proof` with
  `[TAXONOMY_GRAPH_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a category taxonomy graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF=1`. The fixture
  creates a local-only term row `row:["wp_terms","term_id:72901"]`, term
  taxonomy row `row:["wp_term_taxonomy","term_taxonomy_id:72911"]`, post-term
  relationship row
  `row:["wp_term_relationships","object_id:71001|term_taxonomy_id:72911"]`,
  and marker termmeta row `row:["wp_termmeta","meta_id:72921"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local taxonomy term, 1 local term taxonomy, 1 local term
  relationship, and 1 local termmeta row. The ready plan had 26 mutations,
  26 live-remote preconditions, 0 blockers, and mutation families `file: 3`,
  `row:wp_options: 1`, `row:wp_postmeta: 5`, `row:wp_posts: 12`,
  `row:wp_reprint_push_release_state: 1`, `row:wp_term_relationships: 1`,
  `row:wp_term_taxonomy: 1`, `row:wp_termmeta: 1`, and `row:wp_terms: 1`.
- Taxonomy graph evidence: the term, term taxonomy, relationship, and termmeta
  resources were all planned with live preconditions, and the planner reported
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts and 1 blocker.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `59a91092bc6b928fb8e2e25a2ea6151018af15525b5aea7f05cc475e545b9d93`,
  reported 88 durable DB journal rows, `mutationApplied: 26`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 26`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 26 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 26/26
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 25`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `php -l scripts/playground/snapshot-lib.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "featured image|taxonomy|termmeta|term relationship|same-plan post|graph closure|menu item graph|postmeta references" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:taxonomy-graph`.
- Caveat: this closes one local Playground category taxonomy fixture with
  stable fixture identities. It does not prove general WordPress identity
  rewriting for arbitrary terms, term splitting, custom taxonomies, GUIDs,
  menus, serialized blocks, `post_parent`, production importer/exporter
  identity maps, external WordPress durability, rollback, or general
  plugin-driver correctness.
- Percent movement: merge invariants move from 61% to 64%; reliable
  executor/protocol moves from 70% to 71%; independent evidence moves from 64%
  to 66%. Recovery boundaries stay at 58%, and fast path/chunking stays at 37%
  because this proof adds graph coverage, not external crash durability or a
  larger transfer benchmark.

## 2026-05-28 - Featured Image Graph Evidence

- Last update: 2026-05-28 01:08 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:graph`
  passed in tmux window `main:graph-featured-proof` with
  `[GRAPH_FEATURED_PROOF_STATUS:0]`.
- Code change: the Brewcommerce-derived local production proof can now opt into
  a featured-image attachment graph fixture through
  `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF=1`. The fixture creates a
  local-only attachment row `row:["wp_posts","ID:71901"]` and matching
  `_thumbnail_id` postmeta row
  `row:["wp_postmeta","post_id:71001:meta_key:_thumbnail_id"]`.
- Planner evidence: the graph-enabled topology reported 12 complex posts,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 local featured image attachment, and 1 local featured image meta row.
  The ready plan had 24 mutations, 24 live-remote preconditions, 0 blockers,
  and mutation families `file: 3`, `row:wp_options: 1`,
  `row:wp_postmeta: 6`, `row:wp_posts: 13`, and
  `row:wp_reprint_push_release_state: 1`.
- Graph evidence: the attachment resource and `_thumbnail_id` resource were
  both planned with live preconditions, and the planner reported
  `staleGraphBlockers: 0`. The remote-drift plan still failed closed with
  9 preserve-remote conflicts and 2 blockers.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `3dfc96ccc1a4688078cc53a624de366dd4aa11e797b33e90ad83476b85e1c00b`,
  reported 80 durable DB journal rows, `mutationApplied: 24`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 24`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, replay/retry,
  replay equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery and retry evidence on the same release verifier path includes
  same-key/body replay with 24 mutation events, same-key/different-body
  `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, stale-owner fencing, 24/24
  fully updated recovery inspect, and blocked apply-time revalidation state
  with `old: 23`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `php -l scripts/playground/snapshot-lib.php`,
  `npm run test:playground:local-production-complex-site-proof`,
  `node --test --test-name-pattern "featured image|postmeta references|same-plan post|graph closure|taxonomy|menu item graph|post author|comment|link owner" test/push-planner.test.js`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:graph`.
- Caveat: this closes one local Playground featured-image attachment graph
  surface with stable fixture identities. It does not prove general WordPress
  identity rewriting for arbitrary attachments, GUIDs, menus, terms,
  serialized blocks, production importer/exporter identity maps, external
  WordPress durability, rollback, or general plugin-driver correctness.
- Percent movement: merge invariants move from 58% to 61%; reliable
  executor/protocol moves from 69% to 70%; independent evidence moves from 62%
  to 64%. Recovery boundaries stay at 58%, and fast path/chunking stays at 37%
  because this proof adds graph coverage, not external crash durability or a
  larger transfer benchmark.

## 2026-05-28 - Paged Journal Restart Evidence

- Last update: 2026-05-28 00:59 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run test:playground:db-journal-process-kill`
  passed in tmux window `main:journal-restart-pages` with
  `[JOURNAL_RESTART_PAGES_STATUS:0]`.
- Code change: the local process-kill smoke now builds the crash plan from a
  live host-mounted Playground `/snapshot` response, waits for the DB journal
  to cross the restart readback page size before sending `SIGKILL`, and then
  verifies paged DB-journal readback after restart and after exact retry.
- Recovery evidence: after the restart and after retry, the smoke read
  `/db-journal` with `limit=10` cursor pages until the oldest sequence was
  reached. Both readbacks were complete and non-truncated, crossed 10 pages,
  recovered 99 rows, and covered sequences 1 through 99.
- Crash evidence: the kill happened after the DB journal had at least 11 rows,
  while the apply was in flight. The restarted site reported no false
  `apply-committed` state, classified 160 planned targets as `32 new`,
  `128 old`, `0 blockedUnknown`, and exposed `blocked-recovery` without using
  the legacy option journal for classification.
- Retry evidence: exact same key/body retry returned
  `409 RECOVERY_BLOCKED`, left the target snapshot unchanged, preserved the
  same old/new classifications, and did not overwrite the partial state.
- Focused checks passed:
  `node --check scripts/playground/db-journal-process-kill-smoke.mjs`,
  `git diff --check`, and
  `npm run test:playground:db-journal-process-kill`.
- Caveat: this is still local Playground SQLite/host-mount hard-kill evidence.
  It does not prove Docker/external WordPress crash durability, storage
  `fsync`, generic MySQL/InnoDB behavior, rollback, broader graph recovery, or
  arbitrary plugin-driver safety.
- Percent movement: recovery boundaries move from 55% to 58%; reliable
  executor/protocol moves from 68% to 69%; fast path and chunking moves from
  36% to 37%; independent evidence moves from 60% to 62%. Merge invariants stay
  at 58% because this proof strengthens recovery readback, not new graph
  identity coverage.

## 2026-05-28 - Journal Pages Complex-Site Evidence

- Last update: 2026-05-28 00:49 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:journal-pages`
  passed in tmux window `main:journal-pages-proof` with
  `[JOURNAL_PAGES_PROOF_FINAL_STATUS:0]`.
- Code change: the DB-journal REST surface now supports paged readback with
  `beforeSequence`/`beforeCursor`, keeps page metadata, and allows up to 500
  rows per DB-journal page. The authenticated push client now reads the first
  mutation-sized journal page and follows older pages until the reported
  journal `rowCount` is covered or the page cap is hit.
- Release-client guardrail: a paginated DB-journal proof is rejected if the
  readback is incomplete or truncated. The same work also fixed signed retry
  behavior so retried authenticated requests regenerate their nonce while
  preserving the idempotency key and body.
- Unit regression: the focused authenticated client test now fakes a 602-row
  durable journal and verifies three readback requests:
  `?limit=80`, `?limit=500&beforeSequence=523`, and
  `?limit=500&beforeSequence=23`. It asserts 602 recovered rows,
  600 `mutation-applied` events, `readbackPages: 3`,
  `paginationComplete: true`, and `paginationTruncated: false`.
- Planner evidence: the journal-pages command expanded the local production
  topology to 180 complex posts per site, 182 exported posts per site,
  5 complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab
  rows, 1 release-state row, and 12 plugin-owned allowlist entries. The ready
  plan had 190 mutations and 190 live-remote preconditions. The remote-drift
  plan still failed closed with 9 `preserve-remote-and-stop` conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `2b533a363d288706575ae2772edd54aa51a150aa97c96b436d36f64ced3222dd`,
  reported 580 durable DB journal rows, `mutationApplied: 190`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 190`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session and durable journal, replay
  equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery evidence now includes same-key/body replay with 190 mutation
  events, same-key/different-body conflict before mutation, stale-owner
  fencing, 190/190 fully updated recovery inspect, and blocked apply-time
  revalidation state with `old: 189`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check src/authenticated-http-push-client.js`,
  `node --check scripts/playground/production-shaped-release-verify.mjs`,
  `node --check scripts/playground/production-shaped-live-release-verify.mjs`,
  `php -l scripts/playground/push-remote-rest-plugin.php`,
  `php -l scripts/playground/push-db-journal-lib.php`,
  `node --test --test-name-pattern "retries idempotent signed posts|paginates durable db journal readback|db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:journal-pages`.
- Caveat: this is still local Playground loopback WordPress evidence. It does
  not prove Docker/external restart behavior, external crash durability,
  rollback, broader WordPress graph surfaces, or arbitrary plugin-driver
  correctness.
- Percent movement: merge invariants move from 57% to 58%; recovery boundaries
  move from 50% to 55%; reliable executor/protocol moves from 64% to 68%;
  fast path and chunking moves from 30% to 36% because the proof now crosses
  more than one durable journal page; independent evidence moves from 56% to
  60%.

## 2026-05-28 - Journal Window Complex-Site Evidence

- Last update: 2026-05-28 00:16 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- New checked command:
  `npm run verify:release:local-production:complex-site:journal-window`
  passed in tmux window `main:journal-window-proof`.
- Code change: the authenticated release client now sizes the
  `/db-journal` readback window from the planned mutation count instead of
  always requesting `limit=80`. The local WordPress journal endpoint already
  accepted up to 500 rows; the verifier now requests enough rows for the
  checked mutation set.
- Dense-shape verifier change: the complex local production proof can now be
  expanded with `REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT`. The journal
  window command uses 25 complex posts, yielding a 35-mutation ready plan.
- Planner evidence: 27 exported posts per site, 25 complex posts, 5 complex
  form-schema postmeta rows, 3 complex upload files, 4 forms-lab rows,
  1 release-state row, and 12 plugin-owned allowlist entries. The ready plan
  had 35 mutations and 35 live-remote preconditions. The remote-drift plan
  still failed closed with 9 `preserve-remote-and-stop` conflicts.
- Release evidence: the verifier exited `0`, emitted dry-run receipt
  `449044f7c65c27d27679eaee7c1ecf4b270b484444c1a2550dc1cc034f11d15f`,
  reported 115 durable DB journal rows, `mutationApplied: 35`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `applyRevalidationVerifiedCount: 35`, `AUTH_SESSION_BOUNDARY_OK`,
  `LIVE_RELEASE_BOUNDARY_OK` for auth session and durable journal, replay
  equivalence, and `releaseMovement.gates: candidate-for-review`.
- Recovery evidence now includes same-key/body replay with 35 mutation events,
  same-key/different-body conflict before mutation, stale-owner fencing,
  35/35 fully updated recovery inspect, and blocked apply-time revalidation
  state with `old: 34`, `new: 0`, `blockedUnknown: 1`.
- Focused checks passed:
  `node --check src/authenticated-http-push-client.js`,
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `node --test --test-name-pattern "db journal readback window scales" test/authenticated-http-push-client.test.js`,
  `npm run test:playground:local-production-complex-site-proof`,
  `git diff --check`, and
  `npm run verify:release:local-production:complex-site:journal-window`.
- Broad-suite caveat: the large
  `node --test test/authenticated-http-push-client.test.js` run still reports
  existing release-boundary expectation failures outside the journal-window
  regression; the focused regression added here passes.
- Caveat: this is still local Playground loopback WordPress evidence. It does
  not prove Docker/external restart behavior, external crash durability,
  rollback, broader WordPress graph surfaces, or general plugin-driver proof.
- Percent movement: merge invariants move from 55% to 57%; recovery boundaries
  move from 46% to 50%; reliable executor/protocol moves from 61% to 64%;
  fast path and chunking moves from 24% to 30% because the previously rejected
  35-mutation journal-window run is now accepted; independent evidence moves
  from 53% to 56%.

## 2026-05-28 - Complex Local Production Evidence

- Last update: 2026-05-28 00:03 CEST.
- Current complex-site lane:
  `lane/complex-site-local-production-20260527`.
- Full Brewcommerce/WooCommerce import attempt:

  ```bash
  REPRINT_PUSH_LOCAL_PRODUCTION_FULL_BREWCOMMERCE=1 \
  REPRINT_PUSH_LOCAL_PROD_STARTUP_TIMEOUT_MS=120000 \
  NODE_NO_WARNINGS=1 \
  timeout 240s node ./scripts/playground/local-production-release-verify.mjs
  ```

  It booted all four local Playground WordPress sites, then failed closed in the
  checked release verifier with `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`
  because the live source auth/session preflight read timed out. This is not
  accepted release evidence.
- New bounded proof command:
  `npm run verify:release:local-production:complex-site` passed.
- Complex-site planner evidence: the Brewcommerce-derived local topology now
  seeds 14 exported posts per site, including 12 complex fixture posts, 5
  complex form-schema postmeta rows, 3 complex upload files, 4 forms-lab rows,
  1 release-state row, and 12 plugin-owned allowlist entries. The ready plan
  has 22 mutations and 22 live-remote preconditions. The remote-drift plan
  fails closed with 9 conflicts, all `preserve-remote-and-stop`.
- Complex-site release evidence: the checked verifier applied 22 mutations,
  emitted dry-run receipt
  `e43b5f22433929fbea204fb0cd7e4d8ad8ce7a031badea3b89377416614804f6`,
  reported 74 durable DB journal rows, `mutationApplied: 22`,
  `applyCommitted: true`, `checkedAccepted: true`,
  `AUTH_SESSION_BOUNDARY_OK`, `LIVE_RELEASE_BOUNDARY_OK` for auth session and
  durable journal, replay equivalence, and
  `releaseMovement.gates: candidate-for-review`.
- Guardrail learned during implementation: a larger 35-mutation dense run
  correctly failed closed because the current DB-journal readback window only
  retained 25 mutation-applied events. The accepted proof is therefore bounded
  to 22 mutations until journal pagination/receipt windows are expanded.
- Targeted checks passed:
  `node --check scripts/playground/local-production-complex-site-proof.js`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `npm run test:playground:local-production-complex-site-proof`, and
  `npm run verify:release:local-production:complex-site`.
- Caveat: this remains local Playground production-shaped evidence. Docker or
  external WordPress, external crash durability, rollback, broader WordPress
  graph surfaces, and general plugin-driver proof still block final release
  readiness.
- Percent movement: merge invariants move from 54% to 55%; recovery boundaries
  move from 45% to 46%; reliable executor/protocol moves from 60% to 61%;
  fast path and chunking moves from 20% to 24% because there is now a bounded
  complex-site receipt/journal proof, not a large chunk proof; independent
  evidence moves from 51% to 53%.

## 2026-05-27 - Runtime And Graph Identity Evidence

- Last update: 2026-05-27 23:39 CEST.
- Integrated evidence branch: `lane/evidence-integration-20260527`.
- Runtime capability proof: `origin/lane/runtime-proof-feasibility-20260527`
  adds
  [scripts/playground/runtime-capability-proof.mjs](../scripts/playground/runtime-capability-proof.mjs),
  its focused test, and
  [docs/audits/runtime-capability-proof-20260527.md](audits/runtime-capability-proof-20260527.md).
  In this sandbox the proof exits `1` with `DOCKER_RUNTIME_UNAVAILABLE`,
  records `npm run verify:release:local-production` as the closest checked
  local substitute, and prints the exact external `REPRINT_PUSH_* npm run
  verify:release` command required on a Docker or external WordPress host.
- Graph identity proof:
  `origin/lane/graph-identity-local-durable-20260527` maps the real Playground
  post/postmeta author graph identity that had blocked the push protocol smoke.
  The snapshot exporter now includes stable author identity rows as graph
  targets, while user mutation remains unsupported. Menu/navigation graph
  surfaces remain fail-closed.
- Graph proof commands passed in `main:graph-id-proof`:
  `php -l scripts/playground/snapshot-lib.php`,
  `node --test test/push-planner.test.js`,
  `node --test test/graph-mapping-inventory.test.js`,
  `npm run test:playground:push-protocol`, and `git diff --check`. The protocol
  smoke reported an 8-mutation ready plan and no `wp_users` mutation.
- Broad-suite caveat: `npm test` still reports existing unrelated failures in
  production-auth/package/snapshot areas. The focused graph planner and
  protocol evidence above passed.
- Percent movement: merge invariants move from 48% to 54%; reliable
  executor/protocol moves from 58% to 60% because the runtime blocker is now
  executable and fail-closed; independent evidence moves from 44% to 51%.
  Recovery boundaries stay 45%, and fast path stays 20%.
- Remaining release blockers: Docker or external WordPress proof, real
  crash/restart durability outside Playground, general plugin-driver ownership,
  broader WordPress graph surfaces, rollback, and large-site chunk benchmarks.

## 2026-05-27 - Durable Local Production Journal Proof

- Last update: 2026-05-27 23:22 CEST.
- Current durable proof branch:
  `lane/durable-journal-local-production-20260527`.
- New proof: `npm run verify:release:local-production` passed in the
  `main:durable-proof2` tmux window and printed `DURABLE_PROOF_STATUS:0`.
- Release movement: the live local topology now reports
  `releaseMovement.allowed: true`, `gates: candidate-for-review`, and
  `reason: checked live source/local/changed topology passed without packaged
  fallback`.
- Durable journal boundary: the checked live path reports
  `LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, and
  replay/retry. The accepted DB journal includes `ownsJournal: true`,
  `restartReadable: true`, `productionAdapter: wpdb-single-statement-cas`,
  `writerLease.storageGuard: wpdb-single-statement-cas`, and
  `leaseFence.storageGuard: wpdb-single-statement-cas`.
- Code evidence:
  [scripts/playground/push-db-journal-lib.php](../scripts/playground/push-db-journal-lib.php)
  now carries the `leaseFence.storageGuard` contract through the checked PHP
  journal summary, and
  [test/authenticated-http-push-client.test.js](../test/authenticated-http-push-client.test.js)
  keeps the strict JS client proof closed unless that guard is present.
- Targeted checks passed:
  `php -l scripts/playground/push-db-journal-lib.php`,
  `node --check scripts/playground/local-production-release-verify.mjs`,
  `git diff --check -- scripts/playground/push-db-journal-lib.php test/authenticated-http-push-client.test.js`,
  `node --test test/recovery-journal.test.js`, and
  `node --test --test-name-pattern='db journal proof requires the checked durable-journal contract when explicitly requested' test/authenticated-http-push-client.test.js`.
- Caveat: this is still local Playground production-shaped evidence. Docker is
  not installed in the sandbox, and final release readiness still needs the
  same proof on Docker or external WordPress plus graph identity mapping and
  general plugin-driver coverage.
- Percent movement: recovery boundaries move from 36% to 45%; reliable
  executor/protocol moves from 51% to 58%; independent evidence moves from 38%
  to 44%; merge invariants get a small local-proof bump from 47% to 48%; fast
  path remains 20%.

## 2026-05-27 - Local Production Topology Proof

- Last update: 2026-05-27 19:26 CEST.
- Current local-production proof head: `540723dc8` (`Add local production
  release topology proof`) on `origin/lane/local-production-topology-20260527`.
- New proof: `npm run verify:release:local-production` passed in the
  `main:local-prod-proof` tmux window after rebasing onto
  `origin/supervisor/release-boundary-consolidated-20260527`; the shell
  reported `POST_REBASE_LAST_STATUS:0`.
- Topology: the harness boots four live loopback WordPress sites derived from
  the Brewcommerce blueprint assets: source, remote-changed, local-edited, and
  apply-revalidation-source. Docker is unavailable in this sandbox, so this is
  local Playground production-shaped evidence, not Docker evidence.
- Boundary improvement: the checked release path now has auth-session source
  readback for the local production source URL, durable-journal evidence
  preservation, and apply-time revalidation that rejects a production-owned
  `wp_reprint_push_release_state` row drift before mutation with
  `PRECONDITION_FAILED`.
- Code evidence:
  [scripts/playground/local-production-release-verify.mjs](../scripts/playground/local-production-release-verify.mjs),
  [scripts/playground/snapshot-lib.php](../scripts/playground/snapshot-lib.php),
  [scripts/playground/production-shaped-apply-revalidation-smoke.mjs](../scripts/playground/production-shaped-apply-revalidation-smoke.mjs),
  and [src/authenticated-http-push-client.js](../src/authenticated-http-push-client.js).
- Gate posture: release movement remains closed at `0/4`. The run still reports
  durable production journal storage as the remaining boundary, and graph
  identity/general plugin-driver proof still need independent audit.
- Cleanup: stale `/tmp/reprint-local-production-release-*` topology directories
  from failed runs were removed after confirming no Playground processes were
  active.

## 2026-05-26 - Release Journal Smoke Update

- Last update: 2026-05-26 11:58 CEST.
- Current reliable head: `998e856f` (`Surface replay equivalence in release verify`).
- New proof: the checked release verifier now surfaces top-level
  `replayEquivalence` evidence, and the focused release-proof test passed under
  `timeout 90s`.
- Trend: release-verify visibility improved, but the release gate remains
  closed at `0/4` because production auth/session lifecycle and durable journal
  ownership are still blocked.
- Audit note: the current head is `998e856f`; older head references in history
  are historical only and should not be published as current.
- Next nudge: keep the next proof tied to the audit decision and the next
  production-boundary auth/session, journal, or replay evidence.
- Public page: [progress.html](../progress.html) now reflects the current head
  and the replay-equivalence boundary in the visible summary.

## 2026-05-25 - Current Supervisor Snapshot

- Last update: 2026-05-25 00:47 CEST.
- Status: `89` Node tests pass after supervised lane merges.
- New proof: planner coverage now covers independent delete/edit cases; recovery
  keeps a concise acceptable-state contract; fast-path docs and tests pin
  hashing, chunking, row batching, and rejected shortcuts; protocol docs keep
  journal and recovery semantics tight; critic and objective audits match the
  evidence.
- Trend: no-data-loss, recovery, fast-path, reliable-executor, and audit lanes
  improved inside lab/model scope. Production readiness is still blocked.
- Supervision: next-proof fast-path, critic, and reliable-executor outputs were
  reviewed and integrated. The same-plan graph worker remains active and
  unmerged; the stale progress-publisher output was rejected because it used a
  future timestamp and heavy screenshot assets.
- Blocker: production credential lifecycle, durable storage, leases/fencing,
  full WordPress graph identity mapping, Docker/full Playground integration,
  and arbitrary plugin drivers remain unproven.
- Next nudge: keep production gates blocked until a worker proves production
  auth/session/journal internals and graph identity mapping.
- Public page: [progress.html](../progress.html) carries the visible update
  date and keeps details behind links.

<details>
<summary>Earlier progress entries</summary>

## 2026-05-24 - Integrated Feedback And Verification Refresh

- Integrated the feedback supervisor progress refresh into `main`.
  [progress.html](../progress.html) now shows a visible "Last updated:
  May 24, 2026" marker, a short supervisor feedback panel, and concise lane
  summaries.
- Fresh post-merge verification passed: `npm test` reported `64` Node scenarios,
  and the no-server Playground, authenticated CLI/HTTP push, file-journal
  recovery, storage-guarded DB/file write, DB process-kill, missing-commit
  finalization, stale-claim retry, forms table, and plugin atomic-install smokes
  all passed.
- Production readiness is unchanged. The next useful proof is still a
  production-shaped Reprint endpoint/auth/audit/recovery contract.

## 2026-05-24 - Progress Publisher Verification Refresh

- `npm test` passed in the integrated tree with `64` Node scenarios. Evidence:
  [package.json](../package.json),
  [test/push-planner.test.js](../test/push-planner.test.js),
  [test/recovery-journal.test.js](../test/recovery-journal.test.js), and
  [test/performance-model.test.js](../test/performance-model.test.js).
- `npm run test:playground` passed in this lane. Its three no-server
  Playground legs verified snapshot planning, guarded apply, and fixture
  protocol behavior. The plan leg reported the expected row, file, and
  plugin-data conflict classes; the apply leg verified eight fixture mutations;
  the protocol leg verified dry-run receipts, receipt mismatch refusal, stale
  precondition refusal, and conflict refusal. Evidence:
  [docs/playground-topology.md](playground-topology.md),
  [scripts/playground/plan-from-blueprints.mjs](../scripts/playground/plan-from-blueprints.mjs),
  [scripts/playground/apply-ready-plan.mjs](../scripts/playground/apply-ready-plan.mjs), and
  [scripts/playground/push-protocol-smoke.mjs](../scripts/playground/push-protocol-smoke.mjs).
- [progress.html](../progress.html) now separates the currently verified slice
  from linked standalone local-server lab evidence. It keeps percentages flat
  because the production gates did not move in this pass.
- Explicit pending gates remain: real WordPress push executor, production
  recovery journal, Docker/full Playground integration beyond disposable
  fixtures, and arbitrary plugin drivers. Current Playground proof is useful
  fixture evidence, not a production executor or recovery claim.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 42 Node test scenarios covering the deterministic JSON
  snapshot planner, applicator, and file-backed recovery journal. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js) and
  [test/performance-model.test.js](../test/performance-model.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, dependency version/hash
  checks, stale remote dependency blocking, and precondition hashes. Evidence:
  [src/planner.js](../src/planner.js).
- The current applicator validates preconditions, stages mutations, rejects
  non-ready plans, and returns in-memory lab journal/recovery evidence for old
  remote, fully updated remote, and blocked recovery cases. Evidence:
  [src/apply.js](../src/apply.js) and
  [docs/recovery/apply-journal.md](recovery/apply-journal.md).
- `scripts/playground/smoke-blueprints.sh` passed with three no-server
  WordPress Playground blueprints for remote base, local edited, and remote
  changed fixture states. Evidence:
  [docs/playground-topology.md](playground-topology.md).
- `npm run test:playground` passed. It mounts this repository into three
  Playground runtimes, exports real WordPress posts/options/files with
  [scripts/playground/export-site-snapshot.php](../scripts/playground/export-site-snapshot.php),
  and asserts the planner sees the expected row, file, and plugin-data
  conflicts plus local-only mutations and remote-only preservation.
- Protocol, executor, fast-path, objective-audit, and critic documents have
  landed from supervised lanes. Evidence: [docs/protocol.md](protocol.md),
  [docs/executor.md](executor.md), [docs/fast-paths.md](fast-paths.md),
  [audits/objective-audit.md](../audits/objective-audit.md), and
  [audits/critic.md](../audits/critic.md).
- The page at [progress.html](../progress.html) reports this as a safety model,
  not a production WordPress transport.

## 2026-05-24 - Lab Recovery Inspection Slice

- `npm run test:playground:recovery` passed as a standalone local-only
  Playground recovery harness against a server bound to `127.0.0.1`.
- The harness verifies the PHP protocol failpoint
  `REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
  fail-after-2 case, apply returns `LAB_INJECTED_APPLY_FAILURE` after two
  successful whole-resource mutations.
- The bounded option journal records planned recovery entries,
  `mutation-applied`, `apply-failed`, `recovery-required`, and current hashes
  without raw values. CLI inspect and REST `GET /recovery/inspect` classify the
  target as `blocked-recovery`, with `2 new` targets and `6 old` targets; retry
  refuses with `PRECONDITION_FAILED`.
- This is lab recovery inspection evidence only. It is not a durable production
  recovery journal, not a hard-kill or `fsync` path, and not auto-repair.
  Evidence: [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - File-Backed JSONL Recovery Journal Slice

- `npm run test:recovery:file-journal` passed as a JSON-model restart smoke for
  file-backed recovery journal evidence.
- `src/recovery-journal.js` writes append-only JSONL records with monotonic
  sequences and `fsync` evidence after each append; `src/recovery-inspect.js`
  performs restart-style inspection over the persisted journal plus the current
  JSON snapshot.
- The smoke verifies old-remote before mutation; fail-after-2
  `blocked-recovery` with `2 new`, `6 old`, and `0` unknown targets; retry
  refusal with `PRECONDITION_FAILED` and no remote change; completed replay
  applying `0` additional mutations; drift outside before/after hashes with
  `blockedUnknown > 0`; and journal files with no raw fixture fields/data.
- Caveats remain explicit: this is JSON-model lab evidence, not production
  WordPress recovery. It does not replace a production DB table journal or
  the local Playground process-kill smoke. Journal paths must be unique or
  reset intentionally because opening a plan recovery journal defaults to
  `truncate`, and raw-value prevention is forbidden-key/fixture-string based
  rather than a full allowlist schema. Evidence:
  [docs/recovery/apply-journal.md](recovery/apply-journal.md) and
  [docs/playground-topology.md](playground-topology.md).

## 2026-05-24 - Playground Guarded Apply Target

- `npm run test:playground` passed as a two-leg Playground harness: first it
  exported real WordPress Playground snapshots and asserted conflict planning,
  then it created a separate ready plan with `remote=base`, applied it inside a
  fresh Playground source site, and verified WordPress-visible posts, options,
  and files after the apply.
- The apply leg reports `status: ready` and verifies the exact ready mutations,
  including shared and local-only upload files, plugin-owned options, edited
  shared/local-only posts, and the allowlisted forms fixture resources.
- This target remains lab-scoped. It does not claim production Reprint HTTP
  source mutation support; the real HTTP transport/source mutation endpoint is
  still a pending proof gate.

## 2026-05-24 - Playground Fixture Protocol Smoke

- `npm run test:playground` now includes
  `scripts/playground/push-protocol-smoke.mjs`, which mounts the lab-only
  `scripts/playground/push-remote-endpoint.php` and
  `scripts/playground/push-remote-lib.php` files into no-server Playground.
- The smoke proves dry-run is read-only by same-process WordPress before/after
  readback, applies a ready fixture plan with a supplied dry-run receipt,
  verifies eight fixture mutations and hashes, rejects missing receipts with
  `MISSING_DRY_RUN_RECEIPT`, rejects tampered receipts with
  `RECEIPT_MISMATCH`, rejects stale apply with `PRECONDITION_FAILED`, and
  preserves the drifted remote fixture.
- Conflict dry-run and apply both refuse with `PLAN_NOT_READY` and return audit
  evidence for row, file, and plugin-data conflict classes.
- Receipts are bound to the plan fingerprint/hash, mutation and precondition
  sets, ordered resource keys, and dry-run actual hashes. The PHP endpoint
  records bounded fixture-scoped lab journal/audit option events for dry-run,
  apply, stale, non-ready, missing-receipt, and mismatch outcomes. This remains
  fixture-scoped lab evidence, not durable production journaling. Production
  Reprint HTTP source mutation support remains pending.

## 2026-05-24 - Local-Only Playground REST Lab Slice

- `npm run test:playground:http-push` passed as a standalone harness that
  starts disposable WordPress Playground servers bound only to `127.0.0.1` and
  exercises real HTTP against a local lab REST namespace,
  `reprint-push-lab/v1`.
- The lab routes are `GET /snapshot`, `GET /journal`, `POST /dry-run`, and
  `POST /apply`. The script verifies namespace discovery, snapshot readback,
  journal readback, dry-run read-only behavior, missing receipt refusal with
  `428 MISSING_DRY_RUN_RECEIPT`, dry-run receipt creation, and successful apply
  of the eight expected fixture mutations.
- Negative HTTP-style cases are also covered: tampered receipts fail with
  `409 RECEIPT_MISMATCH`, stale remote state fails with
  `412 PRECONDITION_FAILED`, and conflict dry-run/apply fail with
  `409 PLAN_NOT_READY` while reporting row, file, and plugin-data conflict
  classes.
- This is still lab-only and fixture-scoped. The REST plugin is public only
  because it is mounted into local disposable Playground. It does not prove
  production auth, sessions, nonce checks, signed receipts, durable journals,
  crash recovery, or production source mutation. The script is intentionally
  outside `npm run test:playground` because it starts real servers and takes
  around two minutes.

## 2026-05-24 - Authenticated Local Playground Source Mutation Slice

- `npm run test:playground:authenticated-http-push` passed as a standalone
  local-only Playground REST harness for authenticated source-site mutation
  evidence under `/wp-json/reprint-push-lab/v1/authenticated/*`.
- The authenticated aliases use Basic-auth-shaped WordPress Application
  Password credentials for bootstrapped Playground users and require
  `manage_options`. Playground fallback caveat: core Application Password auth
  did not establish `/wp-json/wp/v2/users/me` in this local Playground run, so
  the lab route validates stored hashed app-password entries, sets the current
  WordPress user, and then runs the capability check.
- Preflight returns identity, capability, scope, session, expiry, and journal
  evidence. Authenticated dry-run is read-only by authenticated snapshot
  comparison and mints auth-bound receipts.
- Authenticated apply validates receipt scope, expiry, identity, session,
  route/request binding, and request body binding before DB idempotency claim
  and mutation; requires `X-Reprint-Push-Idempotency-Key`; applies over real
  local HTTP; and verifies the source changes through a fresh authenticated
  snapshot.
- Negative proof covers missing, bad, and malformed auth; insufficient
  capability; forged `reprint_push_lab_auth` query/body/header values;
  `AUTH_RECEIPT_MISMATCH` for tampered or wrong-identity receipts;
  `AUTH_RECEIPT_EXPIRED` for expired receipts; missing idempotency key; stale
  remote no-data-loss with no idempotency claim; and replay with zero fresh
  mutation work.
- Public legacy lab routes remain intentionally public for old smokes. This
  authenticated evidence applies only to `/authenticated/*` and remains
  authenticated local Playground source-site mutation evidence, not production
  Reprint auth.
- The same smoke now requires lab HMAC/signed requests for
  `/authenticated/preflight`, `/authenticated/dry-run`, and
  `/authenticated/apply`, with signature verification before JSON parsing,
  receipt validation, idempotency lookup/claim, journal writes, or mutation.
  `X-Auth-Content-Hash` is SHA-256 over raw request body bytes,
  `X-Auth-Signature` covers nonce/timestamp/content hash, and
  `X-Reprint-Push-Signature` binds method, actual path, canonical query,
  content hash, server-minted session, and idempotency key.
- Preflight mints short-lived lab push sessions; dry-run/apply require the
  session plus `X-Reprint-Push-Idempotency-Key`. Nonce replay rejects before
  idempotency replay, while replay with a fresh nonce/signature performs zero
  fresh mutation work.
- New negative signature proof covers unsigned, malformed, bad hash, body
  changed after signing, stale/future timestamp, wrong method/path/query, wrong
  session, idempotency mismatch, public-route signature attempts, and nonce
  replay. Positive proof covers signed preflight, dry-run, apply, and replay.
- Caveats remain explicit: this is lab HMAC evidence only. Public legacy lab
  routes remain public/mutable; HMAC applies only to `/authenticated/*`
  aliases. Responses expose stable hash evidence such as
  credential/signing-key hashes for lab proof, not a production response
  contract. No production TLS deployment, nonce/replay store cleanup,
  production session handling, real exporter credential binding, durable
  production audit records, or full production push exists yet.

## 2026-05-24 - DB Journal Idempotency Slice

- `npm run test:playground:db-journal-idempotency` passed as a standalone
  local-only Playground REST harness for DB-native apply journal and
  idempotency behavior.
- `POST /apply` now requires `X-Reprint-Push-Idempotency-Key`; missing keys
  return `400 MISSING_IDEMPOTENCY_KEY` before mutation.
- The table `wp_reprint_push_lab_push_journal` records DB-native events:
  `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`
  before each target write, per-mutation `mutation-applied` after observed hash
  calculation, `apply-committed`, `apply-replayed`, and conflict evidence.
  Compact mutation evidence stores hashes/metadata only: mutation
  order/id/resource key/type, before hash, planned after hash, observed hash,
  phase/status, and request/plan/receipt/idempotency hashes.
- Same key plus same body returns `BATCH_ALREADY_COMMITTED` with
  `idempotency.replayed: true`, performs no fresh mutation work, writes no
  extra per-mutation events, and leaves the snapshot unchanged. Same key plus a
  different body returns `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- The same harness now covers concurrent duplicate first applies. The unique
  `claim_key_hash` column opens exactly one `idempotency-opened` claim before
  mutation; concurrent same-key/same-body requests produce exactly one fresh
  mutation executor, and the duplicate returns safe in-progress/retry/replay
  behavior without mutation. Concurrent same-key/different-body requests reject
  the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation.
- This DB journal is separate from the legacy `wp_options` lab journal read by
  `GET /journal`; the legacy `/journal` route still exists. Caveats remain:
  fixture-scoped local Playground evidence only, no production durability, and
  redaction checks are key-based plus fixture-value smoke checks rather than a
  full sanitizer for arbitrary future messages.

## 2026-05-24 - DB Journal Process-Kill Smoke

- `npm run test:playground:db-journal-process-kill` passed as a local-only
  Playground SQLite/host-mount process-kill smoke.
- The harness starts a localhost Playground server against a host-mounted
  WordPress directory, begins a DB-journaled REST apply, waits for
  `idempotency-opened` and `apply-started`, sends a real `SIGKILL` to the
  Playground server process group, and restarts against the same mount.
- After restart, DB opened/started rows and target data persist, the DB journal
  does not falsely report `apply-committed` or replay, live target hashes are
  explainable as old/new from DB planned evidence plus live hashes, recovery
  inspection returns non-mutating `RECOVERY_BLOCKED`, and retry over the same
  key is blocked without overwriting the partial state. This path no longer
  relies on the legacy option journal for recovery classification.
- Caveats remain: this is local Playground lab evidence, not production
  durability, storage `fsync`, rollback, exactly-once production writes,
  arbitrary plugin data safety, or full MySQL/InnoDB behavior.

## 2026-05-24 - DB Journal Missing-Commit Finalization Smoke

- `npm run test:playground:db-journal-missing-commit-finalization` passed as a
  local-only Playground smoke for DB-native missing-commit finalization.
- The smoke uses a deterministic lab hook to apply fixture target writes and DB
  mutation evidence while omitting the terminal `apply-committed` row. It then
  verifies every live target hash is already at the planned after hash.
- Before finalization, the same idempotency key with a different body still
  rejects with `409 IDEMPOTENCY_KEY_CONFLICT` and does not mutate or finalize.
- Replaying the same key/body returns `BATCH_RECOVERY_FINALIZED`, appends the
  missing commit row, reports `fully-updated-remote`, performs zero fresh
  mutation work, and does not add new mutation rows. A later replay returns
  `BATCH_ALREADY_COMMITTED`.
- Residual risks remain explicit: this is Playground/local DB lab evidence only
  and not proof of production durability, storage `fsync`, rollback,
  exactly-once production writes, arbitrary plugin data safety, or full
  MySQL/InnoDB behavior. Tests mostly count mutation evidence rows rather than
  deeply asserting every observed hash, and production auth, live source
  mutation, and full push remain pending.

## 2026-05-24 - DB Journal All-Old Stale-Claim Retry Smoke

- `npm run test:playground:db-journal-stale-claim-all-old` passed as a
  local-only Playground SQLite/host-mount lab smoke for deterministic all-old
  stale-claim safe retry.
- The first lab hook writes `idempotency-opened`, `apply-started`, and
  `stale-claim-abandoned`, then returns
  `LAB_SIMULATED_STALE_CLAIM_ALL_OLD` with no mutation rows, no terminal row,
  and no target mutation.
- Same idempotency key with a different body still returns
  `409 IDEMPOTENCY_KEY_CONFLICT` before retry work.
- Exact same key/body retry requires abandonment evidence tied to the started
  row being retried, validated started targets, zero mutation evidence, and all
  live target hashes at old values. It then appends the derived unique
  `stale-claim-retry-started`, performs exactly one fresh mutation set,
  commits, and later replays as `BATCH_ALREADY_COMMITTED`.
- The smoke also proves the derived retry-claim guard: when that retry claim
  already exists before retry `apply-started` or mutation, a later exact retry
  returns `IDEMPOTENCY_KEY_IN_PROGRESS` and does not mutate.
- The retry-start negative proves a retry `apply-started` without matching
  abandonment evidence blocks with `RECOVERY_BLOCKED` instead of reusing older
  abandonment evidence.
- Residual risks remain explicit: this is lab evidence only, not production
  DB durability, storage `fsync`, rollback, exactly-once production writes,
  MySQL/InnoDB behavior, cross-process/shared-DB lock proof, stale-claim
  leases/fencing/claim expiry, arbitrary production repair, or production retry
  policy.

## 2026-05-24 - Supervisor Feedback Loop And Concise Progress Page

- Added a dedicated `feedback-supervisor` lane and
  `scripts/supervision/start-feedback-session.sh` so a separate session can
  keep nudging the supervisor on what is going well, what is not, progress
  deltas, and the next proof gap.
- Added [supervisor feedback](supervisor-feedback.md) with a dated short status
  entry. The current nudge is to prioritize a production-shaped source-site
  mutation slice: authenticated dry-run, one guarded DB row, one guarded file,
  DB journal, replay, and conflict refusal.
- Updated [progress.html](../progress.html) to show a prominent visible
  "Last updated: May 24, 2026" marker and to move detailed proof text into
  linked Markdown docs. The page now has a short supervisor feedback panel and
  shorter lane summaries.
- This is a visibility/process improvement only. It does not change the core
  production proof status: production Reprint HTTP mutation, production auth,
  durable production journal, and arbitrary plugin data safety are still
  pending.

## 2026-05-24 - Plugin-Owned Forms Fixture Slice

- A verified fixture-scoped plugin-owned data slice now covers nested
  `reprint_push_forms_fixture` option data, fixture-marked parent posts with
  `_reprint_push_forms_schema` postmeta, exact
  `wp_reprint_push_forms_lab` custom-table rows through driver
  `fixture-forms-lab-table`, and detection-only
  `reprint-push-forms-fixture` plugin metadata.
- Snapshot/apply is intentionally allowlist-based. Safe apply covers only the
  allowlisted option, the allowlisted postmeta key when the parent post is
  fixture-marked, and the exact forms lab table driver with owner `forms`,
  positive `id:N`, explicit policy, unchanged active
  `reprint-push-forms-fixture` evidence, precondition hashes, exact PHP
  table/column/payload validation, delete blocked, idempotent replay with zero
  fresh mutation work, and redacted hash-only journal/recovery evidence. Plugin
  metadata is exported/detected but not applied.
- The planner requires an explicit row driver policy for plugin-owned rows.
  Unknown plugin-owned custom-table rows block as
  `unsupported-plugin-owned-resource`. Conflict evidence exposes hashes and
  resource evidence, not raw plugin values.
- The smokes verify eight exact ready mutations for the base apply path, one
  exact forms lab table mutation in `npm run test:playground:forms-lab-table`,
  and detection-only plugin metadata is not a ready mutation. Caveat: this is
  still not a claim about arbitrary production plugin semantics; real plugin
  activation, generic custom-table drivers, recovery, auth/session/nonce proof,
  and production source mutation remain pending.

## 2026-05-24 - Playground Fixture Plugin Install Atomicity Slice

- `npm run test:playground:plugin-atomic-install` is the standalone local-only
  Playground REST smoke for hard-coded fixture plugin install atomicity.
- Positive proof: the base/remote fixture lacks the atomic fixture plugins; the
  local fixture includes `reprint-push-atomic-dependency-fixture`,
  `reprint-push-atomic-dependent-fixture`, and
  `reprint_push_atomic_fixture_data` in the same atomic group. Apply activates
  both fixture plugins, writes only the exact fixture plugin file/resource
  allowlist plus allowlisted plugin-owned option data, and WordPress-visible
  readback verifies versions, activation state, plugin files, and option data.
  Replay with the same idempotency key/body returns
  `BATCH_ALREADY_COMMITTED`, performs zero fresh mutation work, and adds no
  fresh mutation events.
- Negative proof: missing dependency, dependency outside group, incompatible
  version, hash mismatch, activation requirement mismatch, remote dependency
  drift, stale precondition, stale live-remote dependency evidence, forged
  ready plans omitting dependency mutation/`atomicGroups`/dependency
  requirements, and row-only plugin-owned data bypass attempts all reject
  before mutation or preserve/classify safely. The row-only bypass is rejected
  as `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`.
- Executor-side validation now runs in JavaScript and PHP before mutation or
  preconditions where relevant. The lab keeps an exact fixture plugin file
  allowlist; arbitrary plugin files, direct `active_plugins` row mutation,
  custom tables outside the exact forms lab driver, and arbitrary plugin-owned
  data remain blocked.
- Failure injection remains classification evidence, not rollback. A
  before-commit failure preserves the old remote. During-publish and activation
  failures classify blocked recovery and prevent fresh retry mutation work.
- Caveat: this is hard-coded Playground fixture plugin install atomicity
  evidence only. It is not arbitrary production plugin installation/update,
  production activation support, production rollback, plugin semantic drivers,
  generic custom-table drivers, arbitrary plugin-owned data safety, or production
  durability/auth proof.

## 2026-05-24 - Lab JIT Pre-Write Drift Guard Slice

- `npm run test:playground:mid-apply-drift` passed as a standalone local-only
  Playground REST smoke for the just-in-time per-mutation pre-write check.
- The smoke drifts one target after dry-run and after initial apply validation,
  but after that mutation's `mutation-prepared` event and before its write.
  The PHP apply path re-hashes that mutation's own target immediately before
  `reprint_push_apply_resource()`, returns `412 PRECONDITION_FAILED`, preserves
  the drifted value, writes no `mutation-applied` event for the failed mutation,
  writes no later mutations, and writes no `apply-committed`.
- DB journal evidence is hash-only: `preWriteExpectedHash`,
  `preWriteActualHash`, `preconditionCheck`, mutation metadata, recovery counts,
  and redacted recovery targets. Same key/body replay after the rejected JIT
  failure returns the rejected result with `idempotency.replayed: true` and no
  fresh mutation work; same key/different body remains
  `409 IDEMPOTENCY_KEY_CONFLICT`; recovery inspect is non-mutating.
- `npm run test:playground:plugin-atomic-install` now also verifies the
  positive `same-apply-staged` plugin activation proof and negative staged
  shortcut cases. The inactive staged plugin hash is accepted only when the
  planned plugin value is activation-style (`active: true`), an earlier
  same-apply fixture plugin file mutation already applied, and the declared
  ready atomic group covers both mutations by `mutationIds` and `resources`.
  Forged mutation-local group ids without declared coverage and planned
  inactive plugin mutations reject before activation/commit.
- `npm run test:playground:db-journal-idempotency` passed after the smoke's
  different-body concurrency request was made deterministic by waiting for the
  winning idempotency claim before sending the conflicting request. `npm test`
  now passes with 64 Node test scenarios.
- Caveats remain explicit: this is lab-scoped JIT pre-write evidence, not
  storage-level compare-and-swap, locking, production DB durability, rollback,
  production Reprint push, generic plugin/custom-table safety, or arbitrary
  production plugin install/update/activation support.

## 2026-05-24 - Storage-Boundary Guarded DB Update Slice

- `npm run test:playground:storage-guarded-db-write` passed as a standalone
  local-only Playground/SQLite smoke for fixture-scoped update-only guarded DB
  row writes.
- The existing JIT pre-write resource hash still runs first. After it passes,
  supported update mutations use one guarded
  `$wpdb->query($wpdb->prepare(...))` SQL `UPDATE` with `WHERE` predicates over
  the expected storage representation observed after JIT.
- Positive coverage exists for existing fixture `wp_posts` rows, allowlisted
  `wp_options` rows, allowlisted single-row `wp_postmeta` rows, and exact
  positive-id `wp_reprint_push_forms_lab` fixture rows.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary, driver, logical table, physical table, operation,
  compared column names, expected resource hash, expected storage hash, rows
  affected, outcome, and SQL shape hash. It does not include raw SQL values,
  post content, option values, meta values, forms payloads, snapshots, or
  plugin payloads.
- Drift after JIT but before SQL fails closed with
  `PRECONDITION_FAILED`, including value drift for each supported table,
  marker-empty ownership drift for posts/postmeta parents, and absent/delete
  drift. The drifted target is preserved, the guarded write reports rows
  affected `0` and outcome `stale-at-write`, no `mutation-applied` is written
  for the failed target, no later mutations run, and no `apply-committed` is
  written.
- Same key/body replay after a storage-boundary rejection is non-mutating with
  no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`. Failure/recovery evidence keeps the JIT proof
  (`preWriteActualHash === expectedHash`) while using the fresh post-failure
  current hash for actual/observed/recovery state.
- Caveats remain explicit: this is local Playground/SQLite fixture evidence
  only. It is not production DB durability, production Reprint HTTP mutation,
  generic MySQL/InnoDB CAS proof, transactions, locking, rollback,
  inserts/deletes/files/plugin activation storage guarding, arbitrary
  plugin/custom-table semantic safety, or a production crash/fsync proof.

## 2026-05-24 - Storage-Boundary Guarded Fixture File Write Slice

- `npm run test:playground:storage-guarded-file-write` passed as a standalone
  local-only Playground smoke for fixture-scoped upload file update, create,
  and delete writes.
- The existing JIT pre-write resource hash still runs first. In the standalone
  smoke, fixture upload-file update/create mutations compare live file
  bytes/hash against the storage value observed after JIT, write planned
  content to a temp file in the same directory, and rename after the boundary
  comparison. Fixture upload-file deletes compare the same storage value before
  unlinking.
- Positive coverage exists for an existing fixture upload file update, a
  fixture upload file create, and a fixture upload file delete with
  `storageGuard` outcome `applied`. The code path also supports named fixture
  plugin file update paths, but this standalone smoke exercises upload-file
  update/create/delete only.
- Drift after JIT but before update, create, or delete fails closed with
  `PRECONDITION_FAILED`. The drifted file state is preserved, no
  `mutation-applied` is written for the failed file, no later mutations run,
  and no `apply-committed` is written.
- Same key/body replay after a storage-boundary file rejection is non-mutating
  with no fresh mutation work, and same key/different body returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- Hash-only evidence is returned in responses and DB journal rows as
  `storageGuard`: boundary `filesystem-compare-rename` for update/create or
  `filesystem-compare-unlink` for delete, driver, operation, logical fixture
  path, compared fields, expected resource/storage hashes, actual/planned
  storage hashes, physical path hash, and outcome. It does not expose raw file
  contents or absolute host paths.
- Caveats remain explicit: this is local Playground fixture evidence only. It
  is not production filesystem durability, storage `fsync`, a production
  filesystem CAS/lock, rollback, arbitrary file guarding, production Reprint
  HTTP mutation, generic WordPress filesystem safety proof, or a production
  crash proof.

## 2026-05-24 - Authenticated CLI Push Smoke

- `npm run test:playground:authenticated-cli-push` passed as a standalone
  local-only Playground smoke for the `reprint-push-lab push-authenticated`
  command.
- The command fetches a source snapshot over the authenticated lab REST route,
  builds the three-way push plan from `base` and `local` snapshot files, signs
  preflight/dry-run/apply requests, and applies with an idempotency key.
- Positive proof covers a non-mutating dry-run, then an apply of the eight
  current fixture mutations with DB journal `apply-committed` evidence and a
  final source snapshot matching the local fixture surface.
- Negative proof covers a changed source site: the CLI reports
  `PLAN_NOT_READY_LOCALLY` with conflict evidence and does not call dry-run or
  apply.
- Live-source drift proof covers the source changing after the CLI fetches its
  snapshot but before dry-run. A lab-only post-snapshot drift hook changes a
  fixture post title; the CLI-built plan is locally `ready`, authenticated
  dry-run returns `412 PRECONDITION_FAILED`, apply is not called, and the
  concurrent source change is preserved.
- The authenticated CLI client now retries transient socket failures only for
  unsigned read-only GET routes without side-effect lab query parameters and
  sends `Connection: close`; signed requests remain single-shot so nonce replay
  protections are not weakened.
- Caveat: this makes the lab source-site flow usable from the CLI, but it still
  targets the lab endpoint. It is not a production Reprint endpoint, production
  credential binding, or production durability proof.

## 2026-05-24 - Supervisor Feedback Refresh

- The feedback supervisor lane pushed
  `origin/lane/feedback-supervisor` with a refreshed dated status entry,
  concise blocked-by-evidence language, and audit links.
- The main progress page now folds that feedback into the CLI push update:
  reliable executor moved up in the lab, while production endpoint/auth/journal
  claims remain blocked.

## 2026-05-24 - Supervisor Evidence Checkpoint

- The current checkpoint found no newer merged executable evidence after the
  authenticated CLI push smoke and feedback refresh. The visible trend is
  therefore flat, not a readiness increase.
- [progress.html](../progress.html) keeps the current status to a concise
  one-screen summary with a visible May 24, 2026 update date and links to the
  detailed evidence instead of embedding long audit text.
- [supervisor feedback](supervisor-feedback.md) now names the next nudge per
  lane: production-shaped Reprint endpoint/auth/audit proof for reliable
  executor, WordPress graph identity for invariants, production crash-boundary
  durability for recovery, real plugin validator coverage for plugin data,
  executable chunking benchmarks for fast paths, and live-integration re-audit
  for audit lanes.
- Production readiness is unchanged. The repository still lacks a production
  Reprint source-site mutation endpoint, production credential binding,
  nonce/session cleanup proof, durable production audit/recovery records,
  production filesystem/DB durability proof, and arbitrary plugin data safety.

## 2026-05-24 - Status By Area

| Area | Progress | What changed | Next proof |
| --- | ---: | --- | --- |
| Merge invariants | 42% | Planner/apply tests, Playground snapshots, fixture plugin/data checks, unsafe topology mutation suppression, stale owner-plugin context blocking, JIT drift refusal, and storage-boundary DB/file guards are passing. | Production resource identity, semantic preservation, and storage-level guards over real WordPress data. |
| Recovery boundaries | 27% | DB journal idempotency, process-kill, missing-commit finalization, all-old stale-claim retry, durable old-remote retry evidence, durable replay envelopes, journal-write failure recovery artifacts, and stale-at-write refusal are lab/model-proved. | Production DB journal durability, `fsync`/locking/leases/fencing, and crash-boundary behavior. |
| Reliable executor and protocol | 40% | Lab preflight, dry-run receipts, signed auth routes, idempotency, replay, conflict refusal, hash-only guard evidence, authenticated CLI push, post-snapshot drift refusal, production transport binding docs, production-shaped route smoke, packaged-plugin route activation, and signed session/nonce cleanup evidence exist. | Production auth/TLS/session/nonce lifecycle, real exporter credentials, durable audit records, leases/fencing, and arbitrary plugin drivers. |
| Fast path and chunking | 17% | Performance model now records safe fast-path proof obligations for each speedup area, plus staged chunks, group finalization, idempotency, missing receipts, pressure budgets, and rejected unsafe shortcuts. | Transfer benchmarks, streaming/chunking implementation, and large-site runtime evidence. |
| Independent evidence and critique | 30% | Objective audit, critic production gate, source notes, and supervisor feedback were refreshed against the production-shaped/package evidence. | External review against live integration behavior. |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress push executor: still pending. A real source site must be
  mutated through the intended production-shaped Reprint protocol and verified
  after apply, with persisted executor state and no lab-only route assumptions.
- Production recovery journal: still pending. Lab JSONL/DB journals prove
  useful slices, but not production DB durability, `fsync`, locks, leases,
  rollback, or exactly-once writes.
- Docker/full Playground integration: still pending. No-server and localhost
  Playground fixtures prove useful WordPress-facing behavior, but Docker is
  unavailable in this sandbox and the full integration path is not production
  proof.
- Plugin drivers: still pending. Current safety is limited to allowlisted
  fixture data, one forms custom-table driver, detection-only plugin metadata,
  and hard-coded fixture plugin install atomicity; arbitrary plugin-owned
  options, postmeta, custom tables, activation hooks, and rollback are not
  solved.

</details>
