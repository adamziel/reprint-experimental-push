# RPP-0803 external WordPress topology evidence

Date: 2026-05-29

## Scope

RPP-0803 variant 1 adds a local-only external WordPress topology proof. The proof does not open sockets, start servers, publish progress, or use remote tunnels. It validates the operator-supplied topology variables before any release verifier or mutation command can consume them.

The checked topology variables are:

- `REPRINT_PUSH_SOURCE_URL`
- `REPRINT_PUSH_LOCAL_URL`
- `REPRINT_PUSH_REMOTE_CHANGED_URL`
- optional `REPRINT_PUSH_REMOTE_URL` source alias
- optional per-route source overrides for preflight, dry-run, apply, journal, and recovery inspection

## Implemented contract

`scripts/playground/external-wordpress-topology-proof.mjs` emits a JSON proof and a final bracketed status marker. The proof records sanitized, normalized URL identities and hash metadata for source, local edited, and remote changed roles. It keeps credential values out of the artifact and records only credential-presence booleans.

The local identity checks are fail-closed:

- source, local edited, and remote changed URLs must all be present and parse as absolute `http` or `https` URLs
- the three role URLs must normalize to distinct identities
- `REPRINT_PUSH_REMOTE_URL`, when configured, must normalize to the same identity as the source URL
- per-route source URL overrides must normalize to the same source identity
- URL userinfo, query strings, and fragments are rejected so topology artifacts do not carry secret-shaped URL parts
- known tunnel hostnames are rejected
- loopback URLs are accepted only on the sandbox-provided `8080` ingress
- packaged-fallback environment flags are rejected

The proof intentionally reports `readyForReleaseMovement: false`; it covers the RPP-0803 URL capture and identity contract only. Live credentials, route receipts, durable journal behavior, and mutation receipts remain separate gates.

## Focused validation

Commands run:

```sh
node --check scripts/playground/external-wordpress-topology-proof.mjs
node --test test/external-wordpress-topology-proof.test.js
```

Observed result: syntax check exit 0; focused tests exit 0 with 8/8 assertions covering URL capture, missing URL fail-closed behavior, source alias drift, route source drift, duplicate role identity rejection, tunnel rejection, URL-secret rejection, packaged fallback rejection, sandbox `8080` loopback enforcement, normalization, CLI JSON output, and credential redaction.

The success-path CLI proof emits the marker:

```text
[RPP-0803-EXTERNAL-WORDPRESS:TOPOLOGY-OK]
```

The missing/invalid topology path emits the marker:

```text
[RPP-0803-EXTERNAL-WORDPRESS:FAIL-CLOSED]
```

## Residual risks

- This variant performs static local validation only; it does not contact external WordPress hosts.
- The proof does not establish production credentials, route authorization, durable journal storage, or live mutation receipts.
- External host reachability and semantic WordPress import/export evidence remain outside this slice.
