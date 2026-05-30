# RPP-0232 remoteBeforeHash correctness, variant 2

Date: 2026-05-30
Lane: RPP-0232 remoteBeforeHash correctness, variant 2
Release status: NO-GO until integration accepts the local commit.

## Claim

Ready mutations carry a `remoteBeforeHash` that matches the exact observed
remote resource covered by their live-remote precondition. The executor refuses
forged or stale attempts before any target-planned or mutation journal evidence
and before any remote mutation.

## Evidence added

- `test/rpp-0232-remote-before-hash-correctness-v2.test.js` builds a focused
  mixed ready plan with a file mutation, a core `wp_posts` row mutation, and an
  allowlisted plugin-owned `wp_options` mutation.
- The planner proof loops over every mutation and asserts:
  - `mutation.remoteBeforeHash === resourceHash(observedRemote, mutation.resource)`;
  - the matching precondition is checked against `live-remote` and has the same
    observed remote hash;
  - the local mutation payload hash is different, proving the field was not
    derived from local plan payloads.
- The forged-plan proof loops over every mutation, rewrites both the mutation
  `remoteBeforeHash` and matching precondition to the local payload hash, and
  asserts `PRECONDITION_FAILED` with the actual hash recomputed from the
  observed remote.
- The stale-remote proof loops over every mutation, drifts that specific remote
  resource, and asserts `PRECONDITION_FAILED` with no remote mutation and no
  `target-planned` or mutation durable-journal events.
- Each proof serializes only hash/resource/error-code evidence and asserts the
  private fixture values are absent.

## Commands

```sh
node --check test/rpp-0232-remote-before-hash-correctness-v2.test.js
node --test test/rpp-0232-remote-before-hash-correctness-v2.test.js
node --test --test-name-pattern=RPP-0212 test/push-planner.test.js
node --test test/local-hash-correctness-rpp-0213.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0232-remote-before-hash-correctness-v2.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
git diff --check
```

Caveat: executable ready plans still include mutation payloads. This evidence
only serializes hash-only proof envelopes and refusal details, and the focused
regression asserts private fixture payloads are absent from that serialized
evidence.
