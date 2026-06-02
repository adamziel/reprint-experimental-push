# AO Graph Identity Blogmeta Evidence

Date: 2026-06-02

## What Changed

The planner now rewrites composite WordPress meta row resource IDs when the
owning scalar reference is rewritten through a proven identity map. The generic
meta-row path covers `postmeta`, `commentmeta`, `termmeta`, `usermeta`,
`sitemeta`, and `blogmeta` row IDs shaped like:

```text
<owner_field>:<id>:meta_key:<key>
```

The focused RPP-0901 proof covers `wp_blogmeta.blog_id`. A local
`wp_blogs` source row can map to an equivalent remote `wp_blogs` target row
through an explicit `wordpress-graph-identity-map` contract. A dependent
`wp_blogmeta` row whose resource key is `blog_id:<source>:meta_key:<key>` is
planned at `blog_id:<target>:meta_key:<key>`, its payload `blog_id` is rewritten
to the remote target ID, and apply carries the row through under a live-remote
precondition.

Apply rewrite validation now extracts target primary IDs by WordPress table
suffix rather than exact table name. That keeps payload-target binding
consistent for prefixed tables and multisite global targets such as
`wp_blogs.blog_id` and `wp_site.id`.

Forged ready plans that keep valid contract hashes but change the rewritten
`blog_id` payload refuse before mutation with
`WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH`.

Stale explicit maps remain fail-closed. When the remote target blog no longer
matches the mapped local source blog after identity rewriting, the source blog
and dependent blogmeta row both stop as `stale-wordpress-graph-identity` with
hash-only target evidence.

## PHP Production Boundary

The PHP snapshot exporter now includes fixture-marked multisite topology rows
from the network base-prefix tables:

- `wp_site` rows for referenced networks.
- `wp_blogs` rows as read-only identity targets.
- `wp_blogmeta` rows with composite IDs shaped as
  `blog_id:<id>:meta_key:<key>`.

The writable PHP surface remains intentionally narrower than the exported
identity context. `wp_blogs` mutations are refused as unsupported network-row
mutations; blog creation, deletion, and lifecycle updates are not modeled as
row writes. `wp_blogmeta` accepts only allowlisted fixture keys and validates
the row ID against the payload `blog_id` and `meta_key`.

Production-shaped apply uses a storage boundary for `wp_blogmeta`: existing
rows update through a single-statement compare-and-swap against the physical
network `blogmeta` row and parent fixture marker, while absent rows require a
MySQL named lock before verifying the parent fixture marker and zero matching
rows. Deletes and duplicate physical rows remain refused.

The snapshot-hashes route advertises the same boundary. `wp_blogs`, `wp_site`,
`wp_sitemeta`, `wp_blog_versions`, and `wp_registration_log` are read-only
network identity resources. `wp_blogmeta` advertises guarded `put`, not generic
`delete`.

## Verification

Focused checks:

```bash
php -l scripts/playground/snapshot-lib.php
php -l scripts/playground/push-remote-lib.php
php -l scripts/playground/push-remote-rest-plugin.php
node --test test/playground-snapshot-lib.test.js
node --test test/production-snapshot-hashes-route.test.js
node --test test/rpp-0584-production-apply-route-v5.test.js
node --check src/planner.js
node --check src/apply.js
node --check test/rpp-0901-blogmeta-blog-id-reference-v6.test.js
node --test test/rpp-0901-blogmeta-blog-id-reference-v6.test.js
node --test test/wordpress-graph-contracts.test.js
```

The focused tests passed with the PHP snapshot/apply, route metadata,
production apply-route source, blogmeta graph rewrite, and graph contract
suites all green.

## Caveat

This proves explicit identity-map rewriting for a declared scalar multisite
reference and its composite row key, plus a narrow PHP production-shaped
storage boundary for allowlisted blogmeta rows. It does not infer blog identity
from domains, paths, or content, and it does not make unsupported multisite,
blog lifecycle, or plugin-owned graph surfaces safe without explicit contracts.
