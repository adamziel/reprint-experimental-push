# RPP-0244 local directory delete versus remote descendant create, variant 3

Date: 2026-05-30
Lane: RPP-0244 local directory delete versus remote descendant create, variant 3
Checklist item: RPP-0244 — Add generated coverage for local directory delete versus remote descendant create, variant 3.

## Invariant

A local directory delete must fail closed when the live remote created a
previously absent descendant below that directory. Generated coverage must show
both halves of the target surface: ready deletes when the remote has no new
descendant, and conflict cases when the remote descendant exists. The conflict
path must emit no mutation or precondition for the unsafe delete, must keep the
remote descendant, and must refuse apply before mutating the remote snapshot.

## Scenario matrix row

The scenario matrix now names the behavior and focused command:

```sh
node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js
```

Focused test: `RPP-0244 local directory delete versus remote descendant create
variant 3 has generated coverage and hash-only proof`.

## Focused generated proof

The focused test reuses the deterministic generated push harness rather than
rewriting shared harness fixtures. It verifies the existing
`directoryDescendantConflictVariant3` target coverage and recounts every case
with the `directory-descendant-v3` tag.

Observed deterministic target shape:

```json
{
  "family": "directory-descendant-conflict-variant3",
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

- the generated target has one ready and one non-ready case in every tier;
- ready selected evidence plans a directory delete mutation paired with a
  live-remote precondition, applies it, preserves unplanned remote data, and
  rejects stale replay before mutation;
- non-ready selected evidence reports a `file-topology-conflict`, emits no
  mutation or precondition for the unsafe directory delete, records the remote
  descendant as `keep-remote`, emits no descendant mutation/precondition, and
  refuses apply with `PLAN_NOT_READY` while the remote digest is unchanged; and
- serialized proof evidence contains resource keys, counts, refusal codes, and
  hashes only, with no generated remote descendant payload.

## Validation commands

```sh
node --check test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js
node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js
```

Observed focused result: 1 subtest, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
