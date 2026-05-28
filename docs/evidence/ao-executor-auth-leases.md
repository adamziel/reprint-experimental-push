# AO executor-auth-leases evidence

Date: 2026-05-28
Lane: `executor-auth-leases`
Primary range: RPP-0501 through RPP-0535

## Implemented evidence

- Added an opt-in `readOnlyInspectRequests` executor mode and lower-level `readOnly: true` signing option for session-bound journal/recovery inspect requests.
  - Read-only inspect signing rejects `X-Reprint-Push-Idempotency-Key` when the read-only contract is requested.
  - Read-only journal/recovery inspect requests require a valid push session.
  - Existing legacy idempotency-bound mode remains available for current production-shaped fixtures until the server-side route enforces the idempotency-free read-only rule.
- Re-signed retry attempts now receive the attempt number in the signing closure; fixed-nonce retry tests prove the retry path regenerates a nonce for the second signed attempt.
- Added HMAC canonical query proof for signed inspect reads: equivalent query order signs to the same push signature after decode/sort/encode canonicalization.
- Expanded protocol fixtures to pin the read-only inspect auth contract, signed retry nonce contract, and checked lease/fencing fields for journal/recovery inspect proof.
- Documented the auth floor and retry semantics in `docs/protocol.md`.

## Focused verification

Passed:

```sh
node --test --test-name-pattern '^authenticated push client (signs recovery inspect as a read-only|rejects mutating|signs journal inspect reads without|canonicalizes signed query|retries read-only)' test/authenticated-http-push-client.test.js
node --test --test-name-pattern '^authenticated push client (signs mutating requests|retries idempotent signed posts)' test/authenticated-http-push-client.test.js
node --check src/authenticated-http-push-client.js
node -e "for (const f of ['fixtures/protocol/push-auth-session-fencing-contract.json','fixtures/protocol/push-production-executor-flow-contract.json']) { JSON.parse(require('node:fs').readFileSync(f,'utf8')); console.log(f + ' ok'); }"
```

Additional check run:

```sh
node --test test/authenticated-http-push-client.test.js
```

That broader file-level run currently fails in existing production-shaped scenario tests outside this lane's new assertions (for example lifecycle drift and preserved-remote retry ordering expectations after test 52). The five new read-only/signed-retry/canonicalization assertions above pass in isolation.

## RPP items with new evidence

- RPP-0505 / RPP-0525: journal inspect contract now has idempotency-free read-only signing fixtures and focused client coverage.
- RPP-0506 / RPP-0526: recovery inspect contract now has session-bound read-only signing fixtures and focused client coverage.
- RPP-0512 / RPP-0532: request signature canonicalization now has direct HMAC query-order coverage.
- RPP-0513 / RPP-0533: signed retry now proves fresh nonce regeneration for retry attempts, preserving nonce replay-store safety.
- RPP-0515 / RPP-0535: mutating idempotency remains required, while read-only inspect mode rejects mutating idempotency keys.
