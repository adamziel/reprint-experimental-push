# RPP-0516 same-key same-body replay evidence

RPP-0516 adds focused authenticated-client evidence toward same-key same-body replay. The live endpoint checklist item remains unchecked because this branch does not add a real endpoint run against a live URL.

## Scope

- `runAuthenticatedHttpPush()` now records `sameKeySameBodyReplay` after the duplicate `/apply` request.
- The evidence stores hash-only material: idempotency key hash, session hash, submitted request body hash, apply/replay signed content hashes, replay idempotency flags, and replay equivalence.
- A signed replay is proven only when both apply attempts use the same signed content hash, the replay returns `replayed: true`, and `freshMutationWork` is false. When the route echoes the actual request hash, `signedContentHashMatchesSubmittedBody` also pins that content hash to the submitted body hash.
- The focused RPP-0516 fixture asserts the two `/apply` calls carry the same idempotency key, the same parsed request body, and matching `X-Auth-Content-Hash` values.

## Boundary notes

- This is mocked authenticated-client evidence, not live production endpoint evidence.
- Final release status stays NO-GO until the live source and real endpoint release gates provide production-backed observations.
- No raw request body, credential, session token, or idempotency key is written to the evidence artifact; only hashes and booleans are recorded.

## Focused validation

- `node --check src/authenticated-http-push-client.js` - exit 0.
- `node --check test/authenticated-http-push-client.test.js` - exit 0.
- `node --test --test-name-pattern '^RPP-0516 authenticated push records same-key same-body replay evidence$' test/authenticated-http-push-client.test.js` - exit 0, 1 subtest.
- `node --test --test-name-pattern '^(authenticated push client (requires an explicit session and idempotency key for mutating requests|signs mutating requests when session and idempotency are present|retries idempotent signed posts after a transient transport failure|retries idempotent signed posts after a transient timeout)|production-shaped authenticated push (accepts replay-equivalent signed request payloads with canonical key order|accepts replay-equivalent committed replays with regenerated nonce and replay code|fails closed when replay (reopens fresh mutation work|changes the idempotency envelope|changes signed request evidence))|RPP-0516 authenticated push records same-key same-body replay evidence)$' test/authenticated-http-push-client.test.js` - exit 0, 10 subtests.
- `node --test test/authenticated-http-push-client.test.js` - exit 0, 129 subtests.
- `node scripts/release/checklist-completion-lint.mjs` - exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0516-same-key-same-body-replay.md docs/reprint-push-completion-checklist.md` - exit 0.
- `git diff --check` - exit 0.
