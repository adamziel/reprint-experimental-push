# RPP-0280 atomic group blocker propagation, variant 4

Status: focused regression proof added for variant 4. Release remains NO-GO.

## Claim

Atomic groups must not allow otherwise valid sibling mutations to apply when
any resource-level or group-level blocker makes the group non-ready. The
planner must propagate the source blocker ids to every grouped mutation, keep
the evidence hash-only, and the executor must reject the blocked plan before
durable journal writes or mutation callbacks.

## Focused fixture

`test/rpp-0280-atomic-group-blocker-propagation-v4.test.js` builds one atomic
plugin-install intent with:

- an independent `index.php` file mutation,
- a dependent plugin file mutation,
- dependent plugin metadata mutation,
- an unsupported plugin-owned option row that creates a resource-level blocker,
  and
- a missing live plugin dependency that creates a group-level blocker.

The test proves the plan and atomic group are `blocked`, the unsupported row
does not emit a mutation or precondition, and all three grouped mutations carry
`atomic-group-blocker-propagation` blockers. Each propagated blocker references
both source blocker ids and binds to the matching mutation id and resource key.

## Evidence discipline

The proof envelope serializes only status, summary counts, resource keys,
mutation ids, dependency requirement metadata, refusal codes, and SHA-256
hashes. It asserts the serialized evidence does not contain fixture-private
file contents, option values, or dependency token data.

## Progress log

Command:

```sh
node --test test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
```

Caveat: Focused local Node planner/apply proof only; release remains gated
separately.

## Validation commands

```sh
node --check test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node --test test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node --test --test-name-pattern='RPP-0220|RPP-0240|RPP-0280|atomic group' test/push-planner.test.js test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0280-atomic-group-blocker-propagation-v4.md
git diff --check
```

Caveat: these are deterministic local planner/apply checks for the RPP-0280
slice. Broader integration and release evidence remain governed by the release
gates.
