# AO operator proof status evidence

Date: 2026-05-28
Lane: operator-proof-status
Primary checklist evidence: RPP-0016, RPP-0017, RPP-0018, RPP-0020

## What changed

`scripts/release/operator-proof-status.mjs` is a local-only release evidence
status utility. It reads release/evidence JSON from a file or stdin, validates
that the operator-facing proof is complete, then writes:

1. stable machine-readable JSON, and
2. a final bracketed stdout marker:
   - `[RPP-OPERATOR-PROOF:READY]`
   - `[RPP-OPERATOR-PROOF:BLOCKED:<REASON_CODE>]`

The script does not contact external services. It only parses the JSON supplied
to it and fails closed when release evidence is incomplete or contradictory.

## Required evidence

The utility requires these local evidence fields:

- release timestamp (`releaseTimestamp`, `generatedAt`, or equivalent ISO field),
- `releaseMovement.allowed` with the release gate summary,
- source, local, and remote URL evidence supplied as redacted URLs or sha256
  hashes; safe raw http(s) URLs may be accepted but are emitted only as
  redacted/hash evidence,
- verification command result with command and integer `exitCode`, and
- when blocked, a nonzero verification failure reason code.

Raw secret-looking values fail closed. Findings report only JSON paths and keys;
the raw value is never echoed in stdout or stderr.

## Usage

From a file:

```sh
node scripts/release/operator-proof-status.mjs release-evidence.json
```

From stdin:

```sh
cat release-evidence.json | node scripts/release/operator-proof-status.mjs -
```

The utility exits `0` only for `READY`. `BLOCKED` and fail-closed evidence exit
nonzero so release automation cannot accidentally pass through a held proof.

## Fail-closed reason codes covered by focused tests

- `MISSING_RELEASE_TIMESTAMP`
- `MISSING_RELEASE_MOVEMENT_SUMMARY`
- `MISSING_SOURCE_URL_EVIDENCE`, `MISSING_LOCAL_URL_EVIDENCE`, or
  `MISSING_REMOTE_URL_EVIDENCE`
- `RAW_SECRET_VALUE`
- `MISSING_VERIFICATION_RESULT`
- `MISSING_BLOCKED_FAILURE_REASON`
- `INCONSISTENT_READY_BLOCKED_EVIDENCE`

## Focused verification

```sh
node --check scripts/release/operator-proof-status.mjs
node --test test/operator-proof-status.test.js
git diff --check
```

The tests exercise ready and blocked operator markers, both file and stdin input,
URL redaction/hash output, and every fail-closed reason above.

## RPP evidence mapping

| RPP item | Evidence added |
| --- | --- |
| RPP-0016 | Validates and emits a machine-readable `releaseMovement` allowed/denied summary in the status JSON. |
| RPP-0017 | Emits a final bracketed stdout marker with stable ready/blocked reason code semantics. |
| RPP-0018 | Requires an ISO release timestamp before any ready marker can be emitted. |
| RPP-0020 | Requires blocked evidence to include a nonzero verification command failure reason. |
