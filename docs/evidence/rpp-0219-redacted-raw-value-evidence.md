# RPP-0219 redacted raw value evidence

## Scope

RPP-0219 proves that operator-facing planner, refusal, and recovery-journal
evidence stays useful without carrying raw site values. The executor now uses
the shared evidence redaction helper for in-memory apply journal value fields.

## Focused invariant

The focused fixture in `test/push-planner.test.js` covers two surfaces:

- a row conflict plan whose local and remote row contents differ, and
- a ready apply that is interrupted after staging so its recovery journal is
  returned as refusal evidence.

Expected evidence:

- conflict plan evidence exposes resource keys, reason strings, and stable hash
  metadata, not raw row contents,
- apply refusal details expose the stable refusal code and status only,
- journal entries keep `beforeHash` and `afterHash`,
- journal `beforeValue` and `afterValue` are redacted summaries with digest and
  shape metadata, and
- the remote snapshot remains unchanged on the injected apply failure.

## Verification command

```sh
node --test test/push-planner.test.js
```

Caveat: this is a focused local Node planner/apply evidence proof; release
status remains governed by the broader release gates.
