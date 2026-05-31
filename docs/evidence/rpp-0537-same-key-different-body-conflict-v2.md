# RPP-0537 same-key different-body conflict, variant 2

Date: 2026-05-31

Status: local support-only proof. Final release remains **NO-GO** until this
behavior is covered by the checked production release boundary.

## Claim

Reusing an idempotency key with a different authenticated apply body must fail
as `IDEMPOTENCY_KEY_CONFLICT` before fresh mutation work starts for that body.
The conflict evidence must expose hashes only, not the raw idempotency key or
raw request body.

## Proof Surface

`test/rpp-0537-same-key-different-body-conflict-v2.test.js` adds:

- a route-order check matching the RPP-0517 pattern, proving the
  different-request check runs before opening a new idempotency claim or
  entering journaled mutation work; and
- a production-shaped fake endpoint proof matching the RPP-0536 authenticated
  replay pattern around `runAuthenticatedHttpPush()`.

## Proven Behavior

The focused proof drives one session and one idempotency key through apply,
same-body replay, and then a different-body conflict probe. It asserts:

- apply and replay submit byte-equivalent JSON bodies with the same signed
  content hash and push signature;
- the conflict probe keeps the same session, idempotency key, and receipt but
  submits a different canonical body;
- the conflict response is `409 IDEMPOTENCY_KEY_CONFLICT`, has
  `idempotency.conflict: true`, `idempotency.freshMutationWork: false`, and
  `status: "conflict"`;
- conflict evidence carries `idempotencyKeyHash`, `requestHash`, the original
  `conflictingRequestHash`, and zero `mutationEventCounts`;
- target snapshot state is unchanged after the conflict and still matches the
  already-applied local state; and
- the checked journal records exactly one `mutation-applied`, then
  `apply-replayed`, then `idempotency-key-conflict` with `appliedCount: 0`.

## Boundary

This is intentionally local support evidence. It does not use remote ingress,
tunnels, dashboards, or an external live WordPress target. It strengthens the
authenticated-client and route contract evidence, but it does not change final
release posture.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0537-same-key-different-body-conflict-v2.test.js
node --test test/rpp-0537-same-key-different-body-conflict-v2.test.js
node --test --test-name-pattern='RPP-0517 authenticated apply rejects bad auth before JSON parsing or mutation setup' test/rpp-0517-same-key-different-body-conflict.test.js
node --test test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test test/rpp-0615-same-key-replay-after-rejection.test.js test/rpp-0616-different-body-idempotency-conflict.test.js
node --test --test-name-pattern='same-key|same-body|different-body|conflict|replay|idempotency key|RPP-0516 authenticated|RPP-0517' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0537-same-key-different-body-conflict-v2.md
git diff --check
git diff --cached --check
```

Observed passing results:

- RPP-0537 syntax: exit 0.
- Focused RPP-0537 proof: exit 0, 1 pass / 0 fail.
- RPP-0517 non-listener route-order/auth subtest: exit 0, 1 pass / 0 fail.
- RPP-0536 adjacent same-key replay proof: exit 0, 1 pass / 0 fail.
- RPP-0615/RPP-0616 adjacent replay/conflict recovery proofs: exit 0, 2 pass / 0 fail.
- Scoped authenticated idempotency/replay subset: exit 0, 1 pass / 0 fail.
- Artifact redaction scan for this evidence file: exit 0, `"ok": true`.
- `git diff --check`: exit 0.
- `git diff --cached --check`: exit 0, with no staged files because staging was
  blocked by the read-only Git metadata path shown below.

The full RPP-0517 adjacent live Playground test was attempted and blocked by
the sandbox loopback bind restriction, not by a proof assertion:

```text
$ node test/rpp-0517-same-key-different-body-conflict.test.js
TAP version 13
# Subtest: RPP-0517 authenticated apply rejects bad auth before JSON parsing or mutation setup
ok 1 - RPP-0517 authenticated apply rejects bad auth before JSON parsing or mutation setup
  ---
  duration_ms: 2.409832
  type: 'test'
  ...
# Subtest: RPP-0517 production-shaped apply rejects same-key different-body conflict on a live URL
not ok 2 - RPP-0517 production-shaped apply rejects same-key different-body conflict on a live URL
  ---
  duration_ms: 10.617211
  type: 'test'
  location: '/tmp/reprint-rpp-workers-20260527/rpp-537/test/rpp-0517-same-key-different-body-conflict.test.js:89:1'
  failureType: 'testCodeFailure'
  error: 'listen EPERM: operation not permitted 127.0.0.1'
  code: 'EPERM'
  stack: |-
    Server.setupListenHandle [as _listen2] (node:net:1918:21)
    listenInCluster (node:net:1997:12)
    node:net:2206:7
    process.processTicksAndRejections (node:internal/process/task_queues:90:21)
  ...
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 25.794309
```

Staging and local commit could not complete without escalated filesystem
permissions because the linked worktree Git metadata path is read-only:

```text
$ git add test/rpp-0537-same-key-different-body-conflict-v2.test.js docs/evidence/rpp-0537-same-key-different-body-conflict-v2.md
fatal: Unable to create '/home/claude/reprint-experimental-push/.git/worktrees/rpp-537/index.lock': Read-only file system
```
