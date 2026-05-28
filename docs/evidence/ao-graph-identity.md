# AO graph identity evidence

Date: 2026-05-28
Lane: graph-identity

## Implemented evidence

- Added explicit WordPress graph identity-map handling in the planner. Local rows with exporter/importer identity-map metadata are only mapped to a different remote row when the remote row exists, the same local numeric row is absent on remote, and the local/remote rows are equivalent after identity rewriting.
- Rewrites dependent graph references to proven remote IDs, including page/post parent references, postmeta `post_id` composite row IDs, comment `comment_post_ID`, term relationship `object_id`/`term_taxonomy_id` composite row IDs, and termmeta `term_id`.
- Keeps unsupported or ambiguous identity maps fail-closed with hash-only `stale-wordpress-graph-identity` blockers. Dependent rows that point at an unusable map inherit the target blocker instead of being planned.
- Adds fail-closed post GUID and `post_type` + `post_name` collision detection when a local post would duplicate a different remote post without an explicit proven identity map.
- Extends graph mapping inventory output with machine-readable identity-map capabilities and collision guard surfaces.
- Adds local-production verifier evidence for the core `post_tag` taxonomy surface: the planner proof records same-plan `wp_terms`, `wp_term_taxonomy`, and `wp_term_relationships` resources for `row:["wp_term_taxonomy","term_taxonomy_id:72941"]`, and the release-evidence parser now fails closed unless that mutation remains `taxonomy: "post_tag"`, has a live precondition, appears in apply-time revalidation, and the post-apply snapshot matches the local target surface.
- Adds a local-production proof for importer/exporter `pushIdentityMap` metadata carried by the immutable base package: exported local source rows map to imported remote targets, dependent child post and postmeta rows rewrite to the remote target, stale imported targets fail closed, and evidence records only map/provenance hashes, resource keys, and rewrite hashes.
- Adds generated-harness evidence for `wp_comments.user_id` author references: same-plan user/comment creates remain ready with stale replay rejection, while a comment that points at a remotely drifted user fails closed as `stale-wordpress-graph-identity` with hash-only target evidence.

## Verification commands

- `node --check scripts/playground/local-production-complex-site-proof.js`, `node --check scripts/docker/production-complex-site-harness.mjs`, `node --check test/local-production-complex-site-proof.test.js`, and `node --check test/push-planner.test.js` — passed for the RPP-0310 proof changes.
- `node --test test/local-production-complex-site-proof.test.js` — passed (18 tests), including post_tag release-evidence carry-through, fail-closed mutation checks, and importer/exporter identity-map proof.
- `node --test test/push-planner.test.js` — passed (101 tests), including same-plan `post_tag` taxonomy closure and explicit identity-map reference rewriting.
- `node --test test/graph-mapping-inventory.test.js` — passed (2 tests).
- `node --test test/local-production-complex-site-proof.test.js test/push-planner.test.js test/graph-mapping-inventory.test.js` — passed (121 tests), including the importer/exporter identity-map proof.
- `node --test test/generated-push-harness.test.js` — passed (11 generated harness tests covering 300+ cases, including comment-user ready and stale graph target coverage).
- `npm run bench:graph-mapping-inventory` — passed and emitted `identityMapCapabilities` with explicit map table suffixes and fail-closed collision surfaces.

A full `npm test` run was attempted for broader signal, but unrelated existing failures appeared in authenticated HTTP push client and playground snapshot/plugin-driver tests before the run was stopped; the focused graph-identity checks above passed.

## Remaining unmapped or fail-closed WordPress surfaces

- Supported core post-object taxonomy surfaces are `category`, `post_tag`, and `post_format`; RPP-0310 adds local-production release evidence for `post_tag` specifically.
- `nav_menu` taxonomy, custom/plugin taxonomy rows such as `product_cat`, menu item graph metadata, and unsupported post graph rows such as `nav_menu_item`, `revision`, and `wp_navigation` remain intentionally unmapped until an explicit owner/driver or identity-map proof exists.
- Importer/exporter identity maps remain bounded to explicit `pushIdentityMap` entries whose remote target rows are present and equivalent after identity rewriting; stale or non-equivalent imported targets stay blocked, and release remains NO-GO until required production observations are integrated.
- Those unmapped surfaces continue to stop as `stale-wordpress-graph-identity` blockers with hash-only change evidence; the existing planner tests assert private term names/slugs are not leaked in blocker JSON for unsupported taxonomy surfaces.

## RPP items with new evidence

- RPP-0301 / RPP-0321: post/page `post_parent` references are now rewritten through an explicit identity map to a proven remote parent row.
- RPP-0304 / RPP-0324: postmeta `post_id` references and `post_id:<id>:meta_key:<key>` row IDs are rewritten to the mapped remote post ID.
- RPP-0305 / RPP-0325: comment `comment_post_ID` references are rewritten to mapped remote post identities.
- RPP-0310: core `post_tag` taxonomy rows are now covered by local-production planner/release evidence, while unsupported taxonomy surfaces remain documented as fail-closed with hash-only evidence.
- RPP-0312 / RPP-0332: termmeta `term_id` references are rewritten to mapped remote term identities.
- RPP-0313 / RPP-0333 and RPP-0314 / RPP-0334: term relationship `object_id` and `term_taxonomy_id` references, including compound row IDs, are rewritten to mapped remote post/taxonomy identities.
- RPP-0318: GUID and slug collision handling now fails closed without explicit identity-map evidence.
- RPP-0319 / RPP-0320: cross-table create/reference batches can carry an importer/exporter identity map while preserving remote target rows and recording hash-only rewrite evidence.
- RPP-0340: production importer/exporter identity-map proof covers immutable-base `pushIdentityMap` metadata, dependent row rewrites, stale-target fail-closed behavior, and hash-only provenance evidence.
- RPP-0347 evidence note: generated comment user references include ready same-plan creates and stale user drift cases with hash-only blocker evidence.
