# RPP-0251 mutation/precondition one-to-one mapping, variant 3

Date: 2026-05-30
Lane: RPP-0251 mutation/precondition one-to-one mapping, variant 3
Release status: NO-GO until integration accepts the local commit.

## Claim

Every emitted mutation maps to exactly one `live-remote` precondition, and every
precondition maps back to one emitted mutation. The proof covers focused ready,
conflict, and blocked atomic fixtures plus every deterministic generated harness
case.

## Evidence added

- `test/rpp-0251-mutation-precondition-one-to-one-v3.test.js` builds focused
  fixtures for a ready mixed file/row/plugin-owned-option plan, a conflict plan
  with one independent safe mutation, and a blocked atomic plan that suppresses
  the unsafe plugin-owned option mutation.
- The focused proof asserts mutation ids are unique, precondition mutation ids
  are unique, each precondition references an emitted mutation, resource keys and
  resource objects match, `expectedHash` equals `remoteBeforeHash`, and the hash
  equals the live remote resource hash.
- The generated proof applies the same invariant to all deterministic generated
  cases, replays the evidence collection, checks ready/conflict/blocked coverage,
  requires both ready and non-ready cases with planned mutations, and records a
  deterministic proof digest.

## Commands

```sh
node --check test/rpp-0251-mutation-precondition-one-to-one-v3.test.js
node --test test/rpp-0251-mutation-precondition-one-to-one-v3.test.js
```

Caveat: this is a local deterministic Node proof for the merge invariant. Release
acceptance remains gated by the broader checklist and integration validation.
