# AO release artifact redaction scan evidence

Date: 2026-05-28
Lane: artifact-redaction-current-tree
Primary checklist evidence: RPP-0219, RPP-0908, RPP-0928, RPP-0948

## What changed

- Added `scripts/release/artifact-redaction-scan.mjs`, a standalone fail-closed scanner for release and evidence artifacts.
- The scanner accepts one or more files or directories, walks directories recursively, and reports scanned text, JSON, Markdown, log, and HTML artifacts in deterministic path order.
- The scanner emits stable JSON with `ok`, `scannedFiles`, `rejectedFiles`, and `allowedHashEvidence` fields.
- Rejections include stable reason codes, line/column locations, and previews that redact the matched value before writing JSON.
- Hash-only evidence is allowed and counted when it is labelled as hash, digest, checksum, or fingerprint metadata.
- Cautious operator docs are allowed when they use placeholders such as `<production-application-password>` instead of raw values.
- Documented sandbox URL examples are limited to loopback on port 8080 and the current Docker-only service names used by `docs/evidence/ao-docker-local-production.md`.

## Fail-closed checks

The scanner rejects artifacts that contain:

| Reason code | Rejected material |
| --- | --- |
| `RAW_HTTP_URL` | Raw non-sandbox `http` or `https` site URLs. |
| `CREDENTIAL_VALUE` | Application-password-shaped credential values. |
| `TOKEN_VALUE` | Bearer/basic/JWT/prefixed token-looking values. |
| `COOKIE_VALUE` | Cookie headers or cookie assignment values. |
| `SERIALIZED_PRIVATE_OPTION` | Serialized option payloads containing private keys, private notes, operator notes, auth tokens, app passwords, client secrets, API keys, or password fields. |
| `SECRET_LIKE_KEY` | Explicit secret-like key/value pairs whose value is not redacted, placeholder-only, boolean/null presence metadata, or hash-only metadata. |

Operational fail-closed codes also cover missing input paths, unsupported artifact extensions, non-file directory entries, binary text artifacts, and read failures.

## Current-tree evidence scan

The focused test suite and manual verification scan the current evidence/reporting paths:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
```

Observed current-tree status: pass with `ok: true`, 31 scanned files, 0 rejected files, and 0 hash-only metadata entries in those docs.

The scan includes the Docker local-production evidence doc, the current audit docs, and `progress.html`. It intentionally does not wire this scanner into the central release gates in this lane; an integrator can run the command above as a standalone release artifact check.

## Verification fixtures

`test/artifact-redaction-scan.test.js` creates temporary on-disk fixtures for:

- nested directory traversal with JSON, Markdown, and HTML artifacts;
- allowed loopback examples, Docker-only sandbox service examples, placeholders, and cautious redaction prose;
- allowed hash-only metadata, including a secret-named hash key;
- each fail-closed reason code listed above;
- CLI JSON output and nonzero exit behavior;
- current-tree scanning of `docs/evidence`, `audits`, and `progress.html`.

## Focused verification

```sh
node --check scripts/release/artifact-redaction-scan.mjs
node --test test/artifact-redaction-scan.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
git diff --check
```

Expected status: all commands pass. The focused test file currently contains 10 tests.

## Checklist evidence claimed

| RPP item | Evidence added |
| --- | --- |
| RPP-0219 | Redacted raw value evidence now has a reusable scanner and fixture tests proving rejected previews do not echo matched values. |
| RPP-0908 | Privacy/redaction review has a standalone gateable command that exits nonzero when release or evidence artifacts contain raw private material. |
| RPP-0928 | Variant-2 proof coverage is represented by fixture tests for raw URL, credential, token, cookie, serialized private option, and explicit secret key failures. |
| RPP-0948 | Generated-style coverage evidence is represented by deterministic fixture generation over nested directories and multiple artifact formats plus current-tree evidence/report scanning. |
