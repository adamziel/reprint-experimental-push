# Apply Journal Recovery States

The current recovery slices are lab evidence, not production durable recovery.
The Playground lab uses a bounded option journal to classify a failed apply
without storing raw before/after values. The JSON-model lab also has a
file-backed append-only JSONL journal with monotonic sequences and `fsync`
evidence after each append. A newer local-only Playground REST slice adds a
fixture-scoped DB table journal for apply idempotency. These slices are not
production WordPress recovery: they do not prove production durability, do not
include process-kill tests, and do not auto-repair a partial remote.

The production design target is a durable artifact that separates a safe retry
from an unsafe partial push. A failed apply must leave the system classifiable
as only one of these states:

- `old-remote`: no remote mutation was committed. The journal records the plan,
  before/after hashes, and the last completed boundary so the push can be
  retried after revalidating preconditions.
- `fully-updated-remote`: every planned mutation is present on the remote. A
  completed journal may be replayed, but replay must not reapply mutations.
- `blocked-recovery`: the remote may be partial, drifted, or otherwise
  ambiguous. The journal and observed remote snapshot are required artifacts,
  and automated retry must stop until recovery is resolved.

Any production partial remote mutation without a `blocked-recovery` artifact is
a release blocker.

## Boundaries

The current lab journal records these apply boundaries:

- `opened`: preconditions matched and the journal has before/after values.
- `staging`: at least one mutation was staged into the candidate remote.
- `staged`: every mutation was staged, but dependency validation has not
  completed.
- `dependencies-validated`: staged content satisfies atomic group dependencies.
- `committing`: mutations are being committed to the remote target.
- `completed`: all mutations were committed.
- `blocked`: commit did not finish cleanly and recovery requires inspection.

Completed replay validates that current remote resources still match the
journaled after hashes. If any resource drifted after completion, replay blocks
instead of resurrecting stale local data.

## Current Playground Lab Evidence

`npm run test:playground:recovery` verifies the lab failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
fail-after-2 scenario the PHP protocol reports
`LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations,
leaving `2 new` targets and `6 old` targets. CLI inspect and
`GET /recovery/inspect` classify the remote as `blocked-recovery`, with target
states reported as old, new, or blocked-unknown, and a retry refuses with
`PRECONDITION_FAILED`.

The journal records planned recovery entries, `mutation-applied`,
`apply-failed`, `recovery-required`, and current hashes without raw values. This
is enough to prove the lab classification path, but it is still not a durable
production journal, not process-kill/`fsync` proof, and not an automated repair
mechanism.

## Current File-Backed JSONL Evidence

`npm run test:recovery:file-journal` verifies the JSON-model file-backed
recovery journal in `src/recovery-journal.js` and restart-style inspection in
`src/recovery-inspect.js`. The journal is append-only JSONL. Each record has a
monotonic sequence number and carries `fsync` evidence, and the writer calls
`fs.fsyncSync()` after each append.

The smoke covers these restart-style states:

- failure before mutation inspects as `old-remote`;
- fail-after-2 inspects as `blocked-recovery` with `2 new`, `6 old`, and
  `0` unknown targets;
- retry over the partial remote refuses with `PRECONDITION_FAILED` and does not
  change the remote;
- completed replay applies `0` additional mutations and inspects as fully
  updated or already committed;
- drift outside the journaled before/after hashes reports
  `blockedUnknown > 0`;
- journal files contain no raw fixture fields/data.

This is stronger than the earlier in-memory-only recovery model, but it is
still JSON-model lab evidence. It is not the production WordPress DB table
journal, not process-kill proof, and not a production repair policy. Journal
paths must be unique or reset intentionally because opening a plan recovery
journal defaults to `truncate`. The raw-value guard is based on forbidden keys
and fixture strings, not a complete allowlist schema for every production
record shape.

## Current DB Journal Idempotency Evidence

`npm run test:playground:db-journal-idempotency` verifies a fixture-scoped
DB-native apply journal over the local-only Playground REST path. This DB
journal is separate from the bounded `wp_options` lab journal exposed through
legacy `GET /journal`; `/journal` still exists for the option-backed evidence.

`POST /apply` requires `X-Reprint-Push-Idempotency-Key`. A missing key returns
`400 MISSING_IDEMPOTENCY_KEY` before mutation. With a key, the table
`wp_reprint_push_lab_push_journal` records `idempotency-opened`,
`apply-started`, per-mutation `mutation-applied`, `apply-committed`,
`apply-replayed`, and conflict evidence.

The verified replay behavior is idempotent for the fixture batch: same key plus
same body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`,
does no fresh mutation work, adds no extra per-mutation events, and leaves the
snapshot unchanged. Same key plus a different body returns
`409 IDEMPOTENCY_KEY_CONFLICT` before mutation.

This is useful DB-table shape evidence, but it is not production durable
recovery. It does not prove process-kill safety, storage-level crash behavior,
or the concurrency race for duplicate first applies with the same idempotency
key. Redaction is checked through forbidden keys and fixture values, not by a
formal sanitizer for arbitrary future journal messages.
