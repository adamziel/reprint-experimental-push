# RPP-0276 blocked plan apply refusal, variant 4

Status: focused regression proof added for variant 4. Release remains NO-GO.

## Claim

Blocked plans must be rejected before any apply-side mutation boundary. The
executor must return stable `PLAN_NOT_READY` evidence, skip durable journal
writes, avoid mutation callbacks, and leave the remote snapshot unchanged even
when the blocked plan also carries an otherwise valid independent mutation.

## Focused fixture

`test/rpp-0276-blocked-plan-apply-refusal-v4.test.js` adds
`RPP-0276 focused blocked plan refuses before independent mutation and journal writes`.
The fixture changes `wp_options.active_plugins` directly while also changing an
independent `index.php` file. The planner emits one
`unsupported-active-plugins-direct-mutation` blocker for the direct activation
row edit and one file mutation with a matching live-remote precondition.

Applying the blocked plan rejects with `PLAN_NOT_READY`, records zero durable
journal events, invokes zero mutation callbacks, reports zero applied mutations,
and preserves the remote hash.

## Generated fixture sweep

The same file adds
`RPP-0276 generated blocked fixtures all refuse before mutation and journal writes`.
It iterates the generated push harness, filters every `blocked` generated plan,
and proves each blocked fixture has blocker evidence, no conflicts, and one
live-remote precondition per planned mutation. Each apply attempt is run against
a cloned remote with a trapped durable journal and mutation callback; all
fixtures reject with `PLAN_NOT_READY` before remote mutation or journal writes.

## Evidence discipline

The proof envelopes serialize only status, summary counts, resource keys,
blocker classes, SHA-256 hashes, refusal codes, refusal detail hashes, and
aggregate counts. Assertions reject raw focused fixture values and generated raw
content markers from serialized evidence.

## Validation commands

```sh
node --check test/rpp-0276-blocked-plan-apply-refusal-v4.test.js
node --test test/rpp-0276-blocked-plan-apply-refusal-v4.test.js
node --test --test-name-pattern='RPP-0216|RPP-0236' test/push-planner.test.js test/rpp-0236-blocked-plan-apply-refusal-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0276-blocked-plan-apply-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is deterministic local Node planner/apply evidence for the
RPP-0276 slice. Broader release approval remains gated separately by the full
checklist and integration evidence.
