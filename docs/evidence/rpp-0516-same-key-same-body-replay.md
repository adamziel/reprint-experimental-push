# RPP-0516 same-key same-body replay evidence

Date: 2026-05-30

## Scope

RPP-0516 adds focused executor-auth evidence for replaying the same apply
request body with the same idempotency key.

- The authenticated executor summary now records a hash-only
  `sameKeySameBodyReplay` block for the first apply and replay pair.
- Signed request summaries carry request content, idempotency-key, and canonical
  request hashes so the executor can prove same body/key replay without exposing
  the raw body, idempotency key, session, or credentials.
- The replay proof requires matching request content hashes, matching
  idempotency-key hashes, matching canonical request evidence, a replay response,
  no fresh mutation work on replay, and replay-equivalent response evidence.
- The focused source assertion pins the production-shaped apply route behavior:
  a committed row for the same request hash returns replay evidence before
  different-body conflict handling or a new mutation claim.

## Endpoint proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/rpp-0516-same-key-same-body-replay.test.js` | Local fake endpoint proof | Uses the repo's existing `global.fetch` loopback pattern. It verifies two apply calls send identical JSON bodies and idempotency headers with a fresh nonce, then records `sameKeySameBodyReplay.proven: true`. |
| `scripts/playground/push-remote-rest-plugin.php` | Production-shaped route source proof | The test asserts same-request committed replay precedes different-request conflict handling and appends `apply-replayed` with zero applied mutations. |
| External live production endpoint | Not proved in this worker | No external host, public ingress, or remote tunnel was used. |

## Validation observed

```sh
node --check src/authenticated-http-push-client.js test/rpp-0516-same-key-same-body-replay.test.js
node --test test/rpp-0516-same-key-same-body-replay.test.js
node --test --test-name-pattern='same-key|replay|idempotent signed posts|idempotency key|canonicalizes signed query|committed replays' test/authenticated-http-push-client.test.js
node --test test/protocol-compatibility.test.js
node --test test/authenticated-http-push-client.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0516-same-key-same-body-replay.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: each command exited 0. The focused RPP-0516 test reported 2
subtests ok. The adjacent authenticated replay/idempotency slice reported 27
subtests ok. The protocol compatibility test reported 8 subtests ok. The full
authenticated HTTP push client file reported 131 subtests ok. Checklist lint
returned `ok: true`, and the scoped redaction scan returned `ok: true`.

## Release status

Release remains **NO-GO** for this slice. The proof is sandbox-local and
fake-endpoint backed; it does not add live external topology, production auth,
or packaged-plugin deployment evidence.

## Residual risks

- Same-key same-body replay is evidenced with local fake endpoint traffic and
  route source assertions, not an external production URL.
- Durable production journal storage and auth lifecycle proof remain dependent
  on separate live topology and package verification work.
