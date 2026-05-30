# RPP-0516 same-key same-body replay evidence

Date: 2026-05-30

RPP-0516 adds focused authenticated-client evidence and a live-local disposable WordPress REST endpoint proof for same-key same-body replay.

## Scope

- `runAuthenticatedHttpPush()` now records `sameKeySameBodyReplay` after the duplicate `/apply` request.
- The evidence stores hash-only material: idempotency key hash, session hash, submitted request body hash, apply/replay signed content hashes, replay idempotency flags, and replay equivalence.
- A signed replay is proven only when both apply attempts use the same signed content hash, the replay returns `replayed: true`, and `freshMutationWork` is false. When the route echoes the actual request hash, `signedContentHashMatchesSubmittedBody` also pins that content hash to the submitted body hash.
- The focused RPP-0516 fixture asserts the two `/apply` calls carry the same idempotency key, the same parsed request body, and matching `X-Auth-Content-Hash` values.
- `scripts/playground/rpp-0516-same-key-same-body-replay-smoke.mjs` starts a disposable WordPress Playground server with the production-shaped REST routes mounted as mu-plugins, runs the real `/preflight`, `/snapshot`, `/dry-run`, `/apply`, duplicate `/apply`, `/recovery/inspect`, and `/db-journal` path, and asserts the real endpoint emits `SAME_KEY_SAME_BODY_REPLAY_PROVEN`.
- The salvaged local fake-endpoint proof also records hash-only request evidence for signed posts so the same submitted body can be proven without exposing the raw body, idempotency key, session, or credentials.

## Boundary notes

- The endpoint proof is live-local against disposable WordPress Playground, not external production infrastructure.
- Final release status stays NO-GO until the broader live source and release gates provide production-backed observations.
- No raw request body, credential, session token, or idempotency key is written to the evidence artifact; only hashes and booleans are recorded.

## Live-local endpoint proof

Command:

```sh
npm run test:playground:rpp-0516-same-key-same-body-replay
```

Result: exit 0.

Hash-only proof summary:

```json
{
  "ok": true,
  "rpp": "RPP-0516",
  "endpoint": {
    "kind": "disposable WordPress Playground REST endpoint",
    "routeProfile": "production-shaped",
    "namespace": "reprint/v1",
    "routePrefix": "/push",
    "sourceUrlHash": "1a0b6690ce10c43dcc32aea55eebde922d5c948618b12d456618222a8d99580e"
  },
  "sameKeySameBodyReplay": {
    "verdict": "SAME_KEY_SAME_BODY_REPLAY_PROVEN",
    "proved": true,
    "idempotencyKeyHash": "79a39d95ff323b7c12768d8de126cca8dee18b346a848ec42dfe02a297f01c3e",
    "sessionHash": "a4d59739b0a3aedf8d2191937635f5ad5452e6969011071e9343956e36396239",
    "requestBodyHash": "b5a33ba3c28441cb4d742341b7cf862075c5b20ac86aab050bd9bcebbfe4eaa6",
    "applyContentHash": "b5a33ba3c28441cb4d742341b7cf862075c5b20ac86aab050bd9bcebbfe4eaa6",
    "replayContentHash": "b5a33ba3c28441cb4d742341b7cf862075c5b20ac86aab050bd9bcebbfe4eaa6",
    "signedContentHashesMatch": true,
    "signedContentHashMatchesSubmittedBody": true,
    "replayed": true,
    "noFreshMutationWork": true,
    "replayEquivalent": true
  },
  "dbJournal": {
    "rows": 27,
    "mutationApplied": 7,
    "idempotencyOpened": 2,
    "hasApplyReplayed": true
  }
}
```

## Focused validation

- `node --check src/authenticated-http-push-client.js` - exit 0.
- `node --check test/authenticated-http-push-client.test.js` - exit 0.
- `node --check scripts/playground/rpp-0516-same-key-same-body-replay-smoke.mjs` - exit 0.
- `node --check test/rpp-0516-same-key-same-body-replay.test.js` - exit 0.
- `node --test --test-name-pattern '^RPP-0516 authenticated push records same-key same-body replay evidence$' test/authenticated-http-push-client.test.js` - exit 0, 1 subtest.
- `node --test --test-name-pattern '^(authenticated push client (requires an explicit session and idempotency key for mutating requests|signs mutating requests when session and idempotency are present|retries idempotent signed posts after a transient transport failure|retries idempotent signed posts after a transient timeout)|production-shaped authenticated push (accepts replay-equivalent signed request payloads with canonical key order|accepts replay-equivalent committed replays with regenerated nonce and replay code|fails closed when replay (reopens fresh mutation work|changes the idempotency envelope|changes signed request evidence))|RPP-0516 authenticated push records same-key same-body replay evidence)$' test/authenticated-http-push-client.test.js` - exit 0, 10 subtests.
- `node --test test/rpp-0516-same-key-same-body-replay.test.js` - exit 0, 2 subtests.
- `node --test --test-name-pattern='same-key|replay|idempotent signed posts|idempotency key|canonicalizes signed query|committed replays' test/authenticated-http-push-client.test.js` - exit 0, 29 subtests.
- `node --test test/protocol-compatibility.test.js` - exit 0, 8 subtests.
- `node --test test/authenticated-http-push-client.test.js` - exit 0, 135 subtests.
- `npm run test:playground:rpp-0516-same-key-same-body-replay` - exit 0.
  - Focused endpoint result: `SAME_KEY_SAME_BODY_REPLAY_PROVEN`, `signedContentHashesMatch: true`, `signedContentHashMatchesSubmittedBody: true`, `replayed: true`, `noFreshMutationWork: true`, `replayEquivalent: true`, `hasApplyReplayed: true`, `mutationApplied: 7`.
- `npm run test:playground:production-shaped-push` - exit 0.
  - Adjacent endpoint suite result: replay `replayed: true`, replay `freshMutationWork: false`, journal events include `apply-replayed`, and `mutationApplied: 7`.
- `node scripts/release/checklist-completion-lint.mjs` - exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0516-same-key-same-body-replay.md docs/reprint-push-completion-checklist.md` - exit 0.
- `git diff --check` - exit 0.
- `git diff --cached --check` - exit 0.

## Endpoint proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/rpp-0516-same-key-same-body-replay.test.js` | Local fake endpoint proof | Uses the repo's existing `global.fetch` loopback pattern. It verifies two apply calls send identical JSON bodies and idempotency headers with a fresh nonce, then records `sameKeySameBodyReplay.proved: true`. |
| `scripts/playground/push-remote-rest-plugin.php` | Production-shaped route source proof | The test asserts same-request committed replay precedes different-request conflict handling and appends `apply-replayed` with zero applied mutations. |
| `scripts/playground/rpp-0516-same-key-same-body-replay-smoke.mjs` | Live-local WordPress Playground endpoint proof | Runs the mounted production-shaped REST routes through a disposable local WordPress endpoint and records `SAME_KEY_SAME_BODY_REPLAY_PROVEN`. |
| External live production endpoint | Not proved in this slice | No external host, public ingress, or remote tunnel was used. |

## Release status

Release remains **NO-GO** for this slice. The proof is sandbox-local and
fake-endpoint backed; it does not add live external topology, production auth,
or packaged-plugin deployment evidence.

## Residual risks

- Same-key same-body replay is evidenced with local fake endpoint traffic and
  route source assertions plus disposable local WordPress Playground traffic, not an external production URL.
- Durable production journal storage and auth lifecycle proof remain dependent
  on separate live topology and package verification work.
