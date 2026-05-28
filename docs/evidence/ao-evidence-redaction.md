# AO evidence-redaction evidence

Date: 2026-05-28
Lane: evidence-redaction
Primary checklist range: RPP-0209, RPP-0219, RPP-0229, RPP-0239

## What changed

- Added `src/evidence-redaction.js`, a reusable redaction and assertion helper for release evidence and recovery journal records.
- Release gate output now passes every gate evidence object through `redactEvidence()` before it is frozen or copied into `releaseMovement.missingEvidence`.
- Recovery journals now use the same assertion policy before appending and while reading JSONL records, so manually injected raw payloads block readback instead of becoming trusted evidence.
- Redaction replaces raw values with hash-only descriptors: redaction marker, reason, value type, SHA-256 digest, and size/count metadata. Existing hash fields such as `beforeHash`, `afterHash`, `observedHash`, `contentHash`, and `hashes` remain readable.

## Covered leak classes

| Leak class | Evidence behavior |
| --- | --- |
| Nested raw site values | Keys such as `value`, `beforeValue`, `afterValue`, `content`, `data`, `payload`, and serialized value variants are redacted or rejected at any nesting depth. |
| Auth/session tokens | Authorization headers, cookies, session/token/nonce/password/secret credential fields, credential query strings, and URLs with embedded credentials are redacted. |
| Serialized option-like payloads | PHP serialized values and JSON strings carrying option/meta/post private value keys are redacted even when they appear under generic fields such as `observed`. |
| Hash metadata | `beforeHash`, `afterHash`, `observedHash`, `contentHash`, `hashes`, `digest`, `checksum`, and `sha256` metadata are preserved for operator debugging. |

## Focused verification

```sh
node --check src/evidence-redaction.js src/release-gates.js src/recovery-journal.js
node --test test/evidence-redaction.test.js test/release-gates.test.js test/recovery-journal.test.js
git diff --check
```

Expected proof points:

- Redacted release-gate evidence does not contain the raw serialized option text or session token supplied by the test fixture.
- Journal append rejects nested raw values and session tokens before a JSONL line is written.
- Journal readback marks a manually injected serialized option payload as blocked with `JOURNAL_RAW_VALUE_FIELD`.
- Hash-only journal and release metadata remains intact and restart-readable.
