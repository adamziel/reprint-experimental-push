# RPP-0236 blocked plan apply refusal, variant 2

Date: 2026-05-30
Lane: RPP-0236 blocked plan apply refusal, variant 2
Release status: NO-GO until integration accepts the focused proof.

## Claim

Blocked plans must fail before any apply-side mutation boundary. The executor
must return stable `PLAN_NOT_READY` evidence, write no durable journal events,
and leave the remote snapshot unchanged even when the blocked plan also carries
otherwise valid independent mutations.

## Focused evidence

- `test/rpp-0236-blocked-plan-apply-refusal-v2.test.js` adds
  `RPP-0236 focused blocked plan refuses apply before mutation with hash-only evidence`.
- The fixture plans one independent local file mutation plus one unsupported
  plugin-owned option row edit.
- The unsupported option row emits an `unsupported-plugin-owned-resource`
  blocker with `UNKNOWN_PLUGIN_OWNED_RESOURCE` and hash-only refusal evidence.
- The blocked row emits no mutation and no live-remote precondition; the
  independent file mutation keeps a one-to-one live-remote precondition.
- `applyPlan()` rejects with `PLAN_NOT_READY`, records no durable journal
  events, reports zero applied mutations, and leaves the remote hash unchanged.

## Generated evidence

- The same test file adds
  `RPP-0236 generated blocked plans all refuse apply before mutation`.
- It iterates the generated push harness, filters every `blocked` generated
  plan, and proves each one has blocker evidence, no conflicts, and one
  live-remote precondition per planned mutation.
- Each generated blocked plan is applied against a cloned remote with a trapped
  durable journal. Every fixture rejects with `PLAN_NOT_READY`, records zero
  journal events, reports zero applied mutations, and preserves the remote hash.
- The generated proof also verifies deterministic replay and aggregates blocker
  classes, fixture families, planned mutations, and refusal hashes only.

## Redaction proof

The test builds hash-only proof envelopes from resource keys, status, summary
counts, blocker classes, SHA-256 hashes, refusal codes, and refusal detail
hashes. Assertions reject raw focused private fixture values and generated raw
content markers in the serialized evidence.

## Commands

```sh
node --test --test-name-pattern=RPP-0236 test/rpp-0236-blocked-plan-apply-refusal-v2.test.js
node --test --test-name-pattern='RPP-0216|RPP-0240' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0236-blocked-plan-apply-refusal-v2.md
git diff --check
```

Caveat: this is deterministic local Node planner/apply evidence for the
RPP-0236 slice. Release remains gated separately by the broader checklist and
integration evidence.
