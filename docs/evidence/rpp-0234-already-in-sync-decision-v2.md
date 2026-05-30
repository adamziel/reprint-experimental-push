# RPP-0234 already-in-sync decision, variant 2

Date: 2026-05-30
Lane: RPP-0234 already-in-sync decision, variant 2
Release status: NO-GO until integration accepts the focused proof.

## Claim

When local and remote independently reach identical file, plugin metadata, or
row content, the planner records `already-in-sync` decisions only. Those
decision resources must not receive mutations or live-remote preconditions, and
apply must not overwrite later remote values for those resources while applying
an unrelated local mutation.

## Focused evidence

- `test/rpp-0234-already-in-sync-decision-v2.test.js` adds
  `RPP-0234 already-in-sync resources emit no mutations and reject forged overwrites`.
- The fixture creates three `already-in-sync` resources: `file:index.php`,
  `plugin:forms`, and `row:["wp_posts","ID:1"]`, plus one unrelated local file
  mutation.
- The test asserts the plan summary is ready with one mutation and three
  decisions, and that each `already-in-sync` resource has no mutation and no
  live-remote precondition.
- Apply is run after post-plan remote drift on the decision resources. The
  unrelated local mutation applies, while all drifted decision resources remain
  remote-preserved.
- Forged ready plans that add a file, plugin, or row mutation overlapping an
  `already-in-sync` decision are refused with
  `MUTATION_DECISION_RESOURCE_OVERLAP` before durable journal events or remote
  mutation.

## Redaction proof

The test builds a hash-only proof envelope from command, behavior, status,
summary, decision hashes, mutation resource keys, and precondition resource keys.
Assertions prove the envelope, forged refusal evidence, refusal details, and
durable journal event evidence omit the private fixture values and forged
overwrite payloads.

## Commands

```sh
node --test --test-name-pattern=RPP-0234 test/rpp-0234-already-in-sync-decision-v2.test.js
node --test --test-name-pattern='already-in-sync|RPP-0214|RPP-0234' test/push-planner.test.js test/rpp-0234-already-in-sync-decision-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0234-already-in-sync-decision-v2.md
git diff --check
```

Caveat: this is local deterministic Node planner/apply evidence for the
RPP-0234 slice. Release remains gated separately by the broader checklist and
integration evidence.
