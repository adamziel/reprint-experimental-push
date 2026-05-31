# RPP-0536 same-key same-body replay, variant 2

Date: 2026-05-31

Status: local support-only proof. Final release remains **NO-GO** until the
same behavior is backed by a checked production endpoint and release boundary.

## Claim

Reusing the same idempotency key with the same authenticated request body must
replay the committed apply result without fresh mutation work. Reusing the same
key with a different body must be handled separately as an
`IDEMPOTENCY_KEY_CONFLICT` before any new mutation work.

## Proof Surface

`test/rpp-0536-same-key-same-body-replay-v2.test.js` adds a standalone local
fake-endpoint proof around `runAuthenticatedHttpPush()` with:

- `routeProfile: "production-shaped"`;
- `requireProductionAuthSession: true`;
- `proveDurableJournalBoundary: true`;
- checked journal readback fields shaped like the existing authenticated apply
  and idempotency evidence; and
- hash-only idempotency and request evidence in the support assertions.

## Proven Behavior

The focused test proves:

- the first `/apply` performs the only fresh mutation work;
- the duplicate `/apply` uses the same idempotency key, same push session, same
  receipt hash, and byte-equivalent JSON request body;
- apply and replay share the same signed content hash and push signature, while
  the replay uses a fresh nonce and fresh auth signature;
- replay returns `idempotency.replayed: true`,
  `idempotency.freshMutationWork: false`, and
  `SAME_KEY_SAME_BODY_REPLAY_PROVEN`;
- session/user/receipt binding remains accepted through
  `sessionUserIdentityBinding.ok: true` with receipt binding and session-user
  binding present;
- the later same-key different-body probe keeps the same session and receipt
  but changes the request body, returns `409 IDEMPOTENCY_KEY_CONFLICT`, remains
  hash-only, and leaves the target snapshot unchanged; and
- the checked journal shows exactly one `mutation-applied`, then
  `apply-replayed`, then `idempotency-key-conflict`, with zero applied count on
  replay and conflict rows.

## Boundary

This is intentionally local support evidence. It does not use an external live
production endpoint, remote ingress, or a tunnel. It supports integration by
pinning the authenticated-client contract and the expected evidence shape, but
it does not change the release gate posture by itself.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test test/rpp-0536-same-key-same-body-replay-v2.test.js
node --test test/rpp-0516-same-key-same-body-replay.test.js
node --test test/rpp-0615-same-key-replay-after-rejection.test.js test/rpp-0616-different-body-idempotency-conflict.test.js
node --test --test-name-pattern='same-key|same-body|replay|idempotent signed posts|idempotency key|canonicalizes signed query|committed replays|RPP-0516 authenticated' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0536-same-key-same-body-replay-v2.md
git diff --check
```

Observed result: all listed commands exited 0. The focused RPP-0536 run
reported 1 pass / 0 fail. Adjacent RPP-0516, RPP-0615, and RPP-0616 runs
reported 5 total passes / 0 fail. The authenticated replay/idempotency subset
reported 29 passes / 0 fail. The scoped artifact redaction scan returned
`"ok": true`.
