# RPP-0413 owner context stale plugin file refusal evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for stale owner plugin file
context. It covers planner refusal before mutation, executor refusal when a
ready plan is replayed against a drifted owner plugin file, and the safe path
where a local production-shaped plugin-owned row carries one real mutation
through apply.

## Proof surface

`test/plugin-owner-context-file-refusal.test.js` now proves:

- a local plugin-owned `wp_options` update is blocked before mutation when the
  live remote owner plugin file has changed since the pull base;
- a plugin metadata update is blocked by the same stale owner plugin file
  context;
- a normal allowed plugin-owned row update remains ready and applies when the
  owner plugin file context matches; and
- the RPP-0413 local production-shaped proof plans exactly one `wp_postmeta`
  mutation with a `production-backed` plugin-driver policy, applies that one
  mutation when the owner plugin file matches, then refuses the same ready plan
  against a remote whose owner plugin file drifted.

The stale refusal evidence is hash-only: it records resource keys, change kinds,
and SHA-256 hashes for the owner plugin file context without serializing row
values or plugin file contents. The executor assertion keeps the stale remote
snapshot byte-for-byte unchanged after the refusal.

## Focused verification observed locally

```sh
node --test test/plugin-owner-context-file-refusal.test.js
node --test test/plugin-owner-context-metadata-refusal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0413-owner-context-stale-plugin-file-refusal.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused stale plugin file test
reported 4 subtests ok, 0 failed. The adjacent owner-context metadata/file
executor regression test reported 5 subtests ok, 0 failed. Checklist lint
returned `"ok": true`; the scoped artifact redaction scan for the touched docs
returned `"ok": true`.

## Release posture

This is local production-shaped plugin-driver evidence only. It does not update
`progress.html` and does not claim live external production release readiness.
