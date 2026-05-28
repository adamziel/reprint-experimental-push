# AO graph identity evidence

Date: 2026-05-28
Lane: graph-identity

## Implemented evidence

- Added explicit WordPress graph identity-map handling in the planner. Local rows with exporter/importer identity-map metadata are only mapped to a different remote row when the remote row exists, the same local numeric row is absent on remote, and the local/remote rows are equivalent after identity rewriting.
- Rewrites dependent graph references to proven remote IDs, including page/post parent references, postmeta `post_id` composite row IDs, comment `comment_post_ID`, term relationship `object_id`/`term_taxonomy_id` composite row IDs, and termmeta `term_id`.
- Keeps unsupported or ambiguous identity maps fail-closed with hash-only `stale-wordpress-graph-identity` blockers. Dependent rows that point at an unusable map inherit the target blocker instead of being planned.
- Adds fail-closed post GUID and `post_type` + `post_name` collision detection when a local post would duplicate a different remote post without an explicit proven identity map.
- Extends graph mapping inventory output with machine-readable identity-map capabilities and collision guard surfaces.
- Adds local-production verifier evidence for the category `wp_term_taxonomy.term_id` reference: the planner proof records that `row:["wp_term_taxonomy","term_taxonomy_id:72911"]` carries `term_id:72901` to the ready mutation payload, and the release-evidence parser now fails closed unless that same mutation has a live precondition, appears in apply-time revalidation, and the post-apply snapshot matches the local target surface.

## Verification commands

- `node --test test/push-planner.test.js` — passed (87 tests).
- `node --test test/graph-mapping-inventory.test.js` — passed (2 tests).
- `node --test test/generated-push-harness.test.js` — passed (5 generated harness tests covering 300+ cases).
- `npm run bench:graph-mapping-inventory` — passed and emitted `identityMapCapabilities` with explicit map table suffixes and fail-closed collision surfaces.
- `node --check scripts/playground/local-production-complex-site-proof.js` and `node --check test/local-production-complex-site-proof.test.js` — passed for the RPP-0309 local-production verifier proof changes.
- `node --test test/local-production-complex-site-proof.test.js` — passed (15 tests), including the release-evidence checks that category term taxonomy references carry through apply revalidation/final local match and fail closed when the term reference is altered.

A full `npm test` run was attempted for broader signal, but unrelated existing failures appeared in authenticated HTTP push client and playground snapshot/plugin-driver tests before the run was stopped; the focused graph-identity checks above passed.

## RPP items with new evidence

- RPP-0301 / RPP-0321: post/page `post_parent` references are now rewritten through an explicit identity map to a proven remote parent row.
- RPP-0304 / RPP-0324: postmeta `post_id` references and `post_id:<id>:meta_key:<key>` row IDs are rewritten to the mapped remote post ID.
- RPP-0305 / RPP-0325: comment `comment_post_ID` references are rewritten to mapped remote post identities.
- RPP-0309: category `wp_term_taxonomy.term_id` reference evidence now records the planned term-taxonomy row value, verifies it still points at `term_id:72901`, and requires the local-production release verifier summary to carry that mutation through live-precondition, apply-revalidation, and final local-match evidence. The focused unit proof was run in this branch; the long-running Playground verifier command remains the operational proof command when the local production topology is available.
- RPP-0312 / RPP-0332: termmeta `term_id` references are rewritten to mapped remote term identities.
- RPP-0313 / RPP-0333 and RPP-0314 / RPP-0334: term relationship `object_id` and `term_taxonomy_id` references, including compound row IDs, are rewritten to mapped remote post/taxonomy identities.
- RPP-0318: GUID and slug collision handling now fails closed without explicit identity-map evidence.
- RPP-0319 / RPP-0320: cross-table create/reference batches can carry an importer/exporter identity map while preserving remote target rows and recording hash-only rewrite evidence.
