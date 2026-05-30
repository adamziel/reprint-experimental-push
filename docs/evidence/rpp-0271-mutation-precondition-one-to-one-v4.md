# RPP-0271 mutation/precondition one-to-one mapping v4

Status: focused and generated Node proofs validated locally on 2026-05-30 for variant 4. Release remains gated by the broader integration lane.

## Proof surface

- Focused ready fixture covers a mixed mutation set: file update, file create, file delete, core row update, and an allowlisted plugin-owned option row update.
- Focused conflict fixture proves an independent safe mutation keeps its single `live-remote` precondition while the conflicted row emits neither a mutation nor a precondition.
- Focused blocked atomic fixture proves atomic propagation blockers can reference emitted grouped mutations without creating extra preconditions, and the blocked plugin-owned row emits neither a mutation nor a precondition.
- Generated fixture proof replays the deterministic generated harness cases and asserts every mutation id maps to exactly one precondition with the same resource key, resource object, remote-before hash, live remote hash, and `live-remote` marker.
- Ready focused stale replay drifts a planned row after dry run and confirms `PRECONDITION_FAILED` occurs before any remote mutation.

## Validation

```sh
node --check test/rpp-0271-mutation-precondition-one-to-one-v4.test.js
node --test test/rpp-0271-mutation-precondition-one-to-one-v4.test.js
```

Result: 2 tests passed. The generated proof covered `DEFAULT_GENERATED_PUSH_CASES` deterministic fixtures and required ready, conflict, blocked, non-ready-with-safe-mutation, and high-mutation cases.

## Caveat

This is local deterministic Node evidence over focused and generated fixtures. It does not publish progress or change release status by itself.
