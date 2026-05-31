# RPP-0295 Keep-Remote Decision Release Verifier V5 Evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof Surface

- Adds `test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for the `keep-remote`
  merge invariant.
- Builds a focused ready fixture with one independent local file mutation and
  five remote-only resources that must remain `keep-remote`: updated file,
  created file, deleted plugin metadata, deleted `wp_options` row, and updated
  `wp_posts` row.
- Verifies each `keep-remote` resource is decision-only: unchanged local hash,
  changed remote hash, no planned mutation, and no live-remote precondition.
- Applies the ready plan after live remote drift on every decision resource.
  The independent mutation applies, while all drifted decision resources keep
  their remote hashes and write no target or mutation durable journal events.
- Exercises release-verifier refusal paths: stale replay fails with
  `PRECONDITION_FAILED` before target or mutation journal evidence, and forged
  ready plans that add overlapping mutations fail with
  `MUTATION_DECISION_RESOURCE_OVERLAP` before remote mutation.
- Replays all 620 deterministic generated harness cases and confirms the
  existing keep-remote surface remains decision-only across 1,575 decisions in
  533 cases.
- Keeps support evidence hash-only: the envelope records command, caveat,
  statuses, counts, resource keys, change kinds, journal event types, error
  codes, and sha256 hashes while rejecting raw fixture payloads and raw row
  fields from serialized proof evidence.

## Progress Log Entry

Command: `node --test test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js`

Caveat: Local deterministic Node focused release-verifier support proof; release remains gated separately.

No shared harness, checklist, progress log, or progress page files were edited.

## Focused Verification Observed Locally

```sh
node --check test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js
node --test test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js
node --test test/rpp-0235-keep-remote-decision-v2.test.js test/rpp-0255-keep-remote-decision-v3.test.js test/rpp-0275-keep-remote-decision-v4.test.js test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0215|RPP-0235|RPP-0255|RPP-0275|RPP-0295|keep-remote' test/push-planner.test.js test/rpp-0235-keep-remote-decision-v2.test.js test/rpp-0255-keep-remote-decision-v3.test.js test/rpp-0275-keep-remote-decision-v4.test.js test/rpp-0295-keep-remote-decision-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0295-keep-remote-decision-release-verifier-v5.md
node --test test/artifact-redaction-scan.test.js
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0295
test reported 2 subtests ok, 0 failed. The adjacent keep-remote file slice
reported 5 subtests ok, 0 failed, and the focused keep-remote planner pattern
reported 7 subtests ok, 0 failed. The scoped artifact redaction scan returned
`"ok": true` for the new evidence doc, the artifact redaction regression suite
reported 10 subtests ok, 0 failed, and `git diff --check` passed.

## Release Posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update shared progress surfaces, and
does not replace the broader release checklist or CI evidence.
