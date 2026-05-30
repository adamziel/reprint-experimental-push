# RPP-0252 remoteBeforeHash correctness, variant 3

Date: 2026-05-30
Lane: RPP-0252 remoteBeforeHash correctness, variant 3
Release status: NO-GO until integration accepts the local commit.

## Claim

Generated ready-plan mutations keep `remoteBeforeHash` bound to the generated
live remote resource and to the matching live-remote precondition. The executor
rejects both forged hash attempts and stale remote resources before any
`target-planned` or mutation journal evidence and before any remote mutation.

## Evidence added

- Added `test/rpp-0252-remote-before-hash-correctness-v3.test.js`.
- The test imports the deterministic generated push harness cases and selects
  one ready mutation for each generated remote-before-hash shape:
  resource type, action, change kind, and row table when present.
- Local generated matrix summary from the focused proof:
  - generated cases: 620;
  - statuses: 345 ready, 201 conflict, 74 blocked;
  - generated mutations/preconditions: 8,515 / 8,515;
  - ready mutation pool: 6,233 mutations across 344 ready cases;
  - selected rejection matrix: 23 shapes across file, row, and plugin resources;
  - selected families: `atomic-plugin-stack-ready`, `file-type-swap-ready`,
    `large-ready-plan-tier`, `plugin-owned-custom-table-changes`,
    `remote-only-plugin-metadata`, `same-independent-content`,
    `same-plan-comment-graph`, `same-plan-post-author-graph`,
    `same-plan-taxonomy-graph`, `supported-plugin-usermeta`,
    `wp-postmeta-create-update-delete-ready`, and
    `wp-users-usermeta-graph-ready`.
- For every selected shape, the test asserts:
  - `mutation.remoteBeforeHash` equals `resourceHash(generatedRemote, resource)`;
  - the matching precondition is checked against `live-remote` and has the same
    expected hash;
  - a forged but well-formed SHA-256 replacement for both fields is refused with
    `PRECONDITION_FAILED` and leaves the remote unchanged;
  - a stale generated remote resource is refused with `PRECONDITION_FAILED` and
    leaves the stale remote unchanged;
  - durable journal events contain no `target-planned` or mutation event before
    refusal.
- Hash-only proof envelopes include resource keys, codes, SHA-256 hashes, and
  journal event types. The stale fixture includes private-looking marker values,
  and the test asserts those markers are absent from serialized proof evidence.

## Validation

```sh
node --check test/rpp-0252-remote-before-hash-correctness-v3.test.js
node --test test/rpp-0252-remote-before-hash-correctness-v3.test.js
node --test --test-name-pattern=RPP-0212 test/push-planner.test.js
node --test test/rpp-0232-remote-before-hash-correctness-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0252-remote-before-hash-correctness-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local result for each command above: exit 0.

Caveat: this is deterministic local generated-harness proof. Release remains
held until the integration lane reviews and accepts the local commit.
