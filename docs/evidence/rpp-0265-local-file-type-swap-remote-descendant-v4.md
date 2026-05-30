# RPP-0265 local file type swap versus remote descendant, variant 4

Date: 2026-05-30
Lane: RPP-0265 local file type swap versus remote descendant, variant 4
Checklist item: RPP-0265 — Add focused regression coverage for local file type
swap versus remote descendant, variant 4.

## Scenario

A local push replaces a directory from the pull base with a regular file while
the live remote creates a descendant under that same directory. The focused
fixture also includes an unrelated local file edit so the planner must retain
independent mutation audit evidence without allowing any mutation to run while
the topology conflict is present.

## Focused evidence

Focused test:
`RPP-0265 local file type swap versus remote descendant variant 4 refuses before
mutation with hash-only evidence`

Command:

```sh
node --test test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js
```

The regression asserts:

- the plan is `conflict`;
- the unsafe directory-to-file swap is classified as `file-topology-conflict`;
- the unsafe type swap emits no mutation or live remote precondition;
- the live remote descendant remains a `keep-remote` decision and emits no
  mutation or precondition;
- the unrelated local file mutation remains hash-preconditioned for audit;
- `applyPlan()` refuses with `PLAN_NOT_READY` before any durable journal event
  or remote snapshot mutation; and
- serialized proof evidence contains the command, caveat, resource keys,
  counts, and SHA-256 hashes without the fixture payload strings.

## Progress log entry

Command recorded for the lane:

```sh
node --test test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js
```

Caveat: focused local Node planner/apply proof only; release remains gated
separately.

## Validation commands

Syntax check:

```sh
node --check test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js
```

Focused test:

```sh
node --test test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js
```

Adjacent planner coverage:

```sh
node --test --test-name-pattern='RPP-0205|RPP-0225|RPP-0265|file type swap' test/push-planner.test.js test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js
```

Artifact hygiene:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0265-local-file-type-swap-remote-descendant-v4.md docs/scenario-matrix.md
git diff --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0265 test
reported one subtest ok and zero failures; the adjacent planner command ran the
RPP-0205, RPP-0225, and RPP-0265 file-type-swap coverage with zero failures.
The scoped artifact redaction scan returned `"ok": true`.

## Release note

Evidence scope is local focused planner/apply regression coverage. Production
release verification remains gated separately.
