# AO graph identity evidence

Date: 2026-05-28
Lane: graph-identity

## Implemented evidence

- Added explicit WordPress graph identity-map handling in the planner. Local rows with exporter/importer identity-map metadata are only mapped to a different remote row when the remote row exists, the same local numeric row is absent on remote, and the local/remote rows are equivalent after identity rewriting.
- Rewrites dependent graph references to proven remote IDs, including page/post parent references, postmeta `post_id` composite row IDs, comment `comment_post_ID`, term relationship `object_id`/`term_taxonomy_id` composite row IDs, and termmeta `term_id`.
- Keeps unsupported or ambiguous identity maps fail-closed with hash-only `stale-wordpress-graph-identity` blockers. Dependent rows that point at an unusable map inherit the target blocker instead of being planned.
- Adds a local production proof shape for unsupported custom taxonomy references (`product_cat`) so custom/plugin taxonomy rows fail closed with hash-only blocker evidence instead of being treated as release-ready graph movement.
- Adds fail-closed post GUID and `post_type` + `post_name` collision detection when a local post would duplicate a different remote post without an explicit proven identity map.
- Extends graph mapping inventory output with machine-readable identity-map capabilities and collision guard surfaces.

## Verification commands

- `node --test test/push-planner.test.js` — passed (87 tests).
- `node --test test/graph-mapping-inventory.test.js` — passed (2 tests).
- `node --test test/generated-push-harness.test.js` — passed (1 generated harness test covering 300+ cases).
- `npm run bench:graph-mapping-inventory` — passed and emitted `identityMapCapabilities` with explicit map table suffixes and fail-closed collision surfaces.

RPP-0311 focused worker verification:

- `node --test test/local-production-complex-site-proof.test.js` — passed (15 tests), including the custom taxonomy fail-closed local production proof shape.
- `node --test test/push-planner.test.js` — passed (88 tests) with planner coverage asserting unsupported custom taxonomy blockers are hash-only and avoid exposing raw private term values.

A full `npm test` run was attempted for broader signal, but unrelated existing failures appeared in authenticated HTTP push client and playground snapshot/plugin-driver tests before the run was stopped; the focused graph-identity checks above passed.

## RPP items with new evidence

- RPP-0301 / RPP-0321: post/page `post_parent` references are now rewritten through an explicit identity map to a proven remote parent row.
- RPP-0304 / RPP-0324: postmeta `post_id` references and `post_id:<id>:meta_key:<key>` row IDs are rewritten to the mapped remote post ID.
- RPP-0305 / RPP-0325: comment `comment_post_ID` references are rewritten to mapped remote post identities.
- RPP-0312 / RPP-0332: termmeta `term_id` references are rewritten to mapped remote term identities.
- RPP-0313 / RPP-0333 and RPP-0314 / RPP-0334: term relationship `object_id` and `term_taxonomy_id` references, including compound row IDs, are rewritten to mapped remote post/taxonomy identities.
- RPP-0311: unsupported custom taxonomy references such as `product_cat` remain fail-closed unless an explicit safe identity surface/driver is added; planner and local production proof evidence assert hash-only blockers and blocked release movement.
- RPP-0318: GUID and slug collision handling now fails closed without explicit identity-map evidence.
- RPP-0319 / RPP-0320: cross-table create/reference batches can carry an importer/exporter identity map while preserving remote target rows and recording hash-only rewrite evidence.

## Remaining unmapped graph surfaces

Custom or plugin-owned taxonomies are still treated as unsupported WordPress graph surfaces by default. The planner may detect the raw term row, but term taxonomy and relationship references block release movement with hash-only `stale-wordpress-graph-identity` evidence until an explicit identity map or plugin driver proves the taxonomy semantics and rewrite rules.
