# RPP-0275 keep-remote decision, variant 4

Date: 2026-05-30
Lane: RPP-0275 keep-remote decision, variant 4
Release status: NO-GO until integration accepts the focused proof.

## Claim

Remote-only create, delete, and update changes remain `keep-remote` decisions
when an independent local mutation is ready. Those decision resources emit no
mutation or live-remote precondition, apply preserves later live remote drift
for them, and forged ready plans cannot add overlapping mutations for the same
resources.

## Focused evidence

- `test/rpp-0275-keep-remote-decision-v4.test.js` adds
  `RPP-0275 keep-remote create delete and update decisions stay drift-safe`.
- The fixture covers five remote-only resources: an updated `index.php`, a
  created upload file, deleted `forms` plugin metadata, a deleted `wp_options`
  row, and an updated `wp_posts` row. An unrelated theme stylesheet edit is the
  only planned mutation.
- The test asserts a ready plan with one mutation and five `keep-remote`
  decisions, deterministic hash-only evidence across replayed planning inputs,
  and exactly one live-remote precondition for the independent mutation.
- Apply runs after post-plan remote drift on every decision resource. The
  stylesheet mutation applies, while all drifted decision resources keep their
  pre-apply remote hashes and write no decision-resource durable mutation
  events.
- Forged ready plans that add overlapping mutations for the keep-remote
  resources are refused with `MUTATION_DECISION_RESOURCE_OVERLAP` before durable
  journal events or remote mutation.

## Redaction proof

The test serializes only command, caveat, status, summary, resource keys,
change kinds, states, counts, and hashes. Assertions prove the evidence
envelope, individual decision records, forged refusal evidence, and refusal
details omit the private local payloads, remote-only payloads, post-plan drift
values, and forged overwrite values.

## Progress log

Command: `node --test test/rpp-0275-keep-remote-decision-v4.test.js`

Caveat: Focused local deterministic planner/apply evidence only; release
remains gated separately by broader integration evidence and checklist review.

## Commands

```sh
node --check test/rpp-0275-keep-remote-decision-v4.test.js
node --test test/rpp-0275-keep-remote-decision-v4.test.js
node --test --test-name-pattern='RPP-0215|RPP-0235|RPP-0275|keep-remote' test/push-planner.test.js test/rpp-0235-keep-remote-decision-v2.test.js test/rpp-0275-keep-remote-decision-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0275-keep-remote-decision-v4.md
git diff --check
```
