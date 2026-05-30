# RPP-0274 already-in-sync decision, variant 4

Date: 2026-05-30
Lane: RPP-0274 already-in-sync decision, variant 4
Release status: NO-GO until integration accepts the focused proof.

## Claim

When local and remote independently converge on the same create, delete, or
update state, the planner records `already-in-sync` decisions rather than
mutations. Those decision resources remain free of live-remote preconditions,
and apply must not overwrite later remote drift for them while applying an
unrelated local mutation.

## Focused evidence

- `test/rpp-0274-already-in-sync-decision-v4.test.js` adds
  `RPP-0274 already-in-sync create delete and update decisions stay drift-safe`.
- The fixture covers five synchronized resources: a deleted file, a created
  file, deleted plugin metadata, a created `wp_options` row, and an updated
  `wp_posts` row. An unrelated theme stylesheet edit provides the only planned
  mutation.
- The test asserts the ready plan summary is one mutation and five decisions,
  each synchronized resource has an `already-in-sync` decision with no mutation
  and no live-remote precondition, and the hash-only evidence is deterministic
  across replayed planning inputs.
- Apply is run after post-plan remote drift on all five decision resources. The
  unrelated stylesheet mutation applies, while the drifted decision resources
  keep their pre-apply remote hashes and write no decision-resource durable
  mutation events.
- Forged ready plans that add overlapping mutations for the decision resources
  are refused with `MUTATION_DECISION_RESOURCE_OVERLAP` before durable journal
  events or remote mutation.

## Redaction proof

The test serializes only command, behavior, status, summary, resource keys,
change kinds, and hashes. Assertions prove the evidence envelope, forged
refusal evidence, refusal details, and durable journal event evidence omit the
private fixture payloads, drift values, and forged overwrite values.

## Commands

```sh
node --check test/rpp-0274-already-in-sync-decision-v4.test.js
node --test --test-name-pattern=RPP-0274 test/rpp-0274-already-in-sync-decision-v4.test.js
node --test --test-name-pattern='already-in-sync|RPP-0214|RPP-0234|RPP-0274' test/push-planner.test.js test/rpp-0234-already-in-sync-decision-v2.test.js test/rpp-0274-already-in-sync-decision-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0274-already-in-sync-decision-v4.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is local deterministic Node planner/apply evidence for the
RPP-0274 slice. Release remains gated separately by the broader checklist and
integration evidence.
