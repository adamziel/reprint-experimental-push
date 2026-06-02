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

## Verification

Focused checks:

```bash
node --check src/planner.js
node --check src/apply.js
node --check test/rpp-0901-blogmeta-blog-id-reference-v6.test.js
node --test test/rpp-0901-blogmeta-blog-id-reference-v6.test.js
```

The focused test passed with 3 subtests and 0 failures.

## Caveat

This proves explicit identity-map rewriting for a declared scalar multisite
reference and its composite row key. It does not infer blog identity from
domains, paths, or content, and it does not make unsupported multisite or
plugin-owned graph surfaces safe without explicit contracts.
