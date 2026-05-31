# RPP-0245 local file type swap versus remote descendant, variant 3

Date: 2026-05-31
Lane: RPP-0245 local file type swap versus remote descendant, variant 3
Checklist item: RPP-0245 - Add generated coverage for local file type swap
versus remote descendant, variant 3.

## Invariant

A local directory-to-file type swap must fail closed when the live remote has
created a descendant below the original directory. Generated coverage must show
both sides of the surface: ready type swaps when the remote still matches the
base directory, and conflict cases when a live remote descendant exists.

## Focused generated proof

Focused test:
`RPP-0245 generated local file type-swap evidence is hash-only and deterministic`

Command:

```sh
node --test test/rpp-0245-local-file-type-swap-remote-descendant-v3.test.js
```

Caveat: Generated local/model evidence only; release remains gated separately.

The focused proof reuses the deterministic generated file type-swap harness
surface and adds an explicit `fileTypeSwapConflictVariant3` target. The
generated target shape is:

```json
{
  "family": "file-type-swap-conflict-variant3",
  "total": 20,
  "perTier": {
    "0": 2,
    "1": 2,
    "2": 2,
    "3": 2,
    "4": 2,
    "5": 2,
    "6": 2,
    "7": 2,
    "8": 2,
    "9": 2
  },
  "statuses": {
    "conflict": 10,
    "ready": 10
  }
}
```

Assertions prove:

- every tier has one ready type-swap case and one non-ready remote-descendant
  conflict case;
- ready evidence emits a directory-to-file `put` mutation with a live-remote
  precondition, applies to the local file hash, preserves unplanned remote
  resources, and rejects stale replay before mutation;
- non-ready evidence reports a `file-topology-conflict`, emits no mutation or
  precondition for the unsafe type swap, keeps the live remote descendant as
  `keep-remote`, emits no descendant mutation/precondition, and refuses apply
  with `PLAN_NOT_READY` while the remote digest is unchanged; and
- serialized proof evidence contains command, caveat, resource keys, counts,
  refusal codes, and SHA-256 hashes only.

## Progress log entry

The progress log records the focused command and caveat:

```sh
node --test test/rpp-0245-local-file-type-swap-remote-descendant-v3.test.js
```

Caveat: Generated local/model evidence only; release remains gated separately.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0245-local-file-type-swap-remote-descendant-v3.test.js
node --test test/rpp-0245-local-file-type-swap-remote-descendant-v3.test.js
node --test --test-name-pattern='RPP-0103|RPP-0123|RPP-0163' test/generated-push-harness.test.js
node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js test/rpp-0265-local-file-type-swap-remote-descendant-v4.test.js test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0245-local-file-type-swap-remote-descendant-v3.md docs/generated-push-harness.md docs/progress-log.md
git diff --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0245 test
reported three subtests ok and zero failures.

## Release note

Evidence scope is deterministic local generated-harness coverage. Production
release verification remains gated separately.
