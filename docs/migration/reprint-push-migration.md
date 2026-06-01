# Reprint Push Migration Support Guide

Date: 2026-06-01
Variant: RPP-0916 migration docs variant 1
Scope: support-only migration documentation

This guide documents the migration support posture for Reprint Push journal
schema migration work. It is an operator reference for existing support
evidence, not a release approval record. It does not add production-backed
migration proof, does not authorize production mutation, and does not move any
release gate. Final release remains `NO-GO` until production-backed migration
proof exists for the same release envelope.

Related evidence: [RPP-0916 migration docs evidence](../evidence/rpp-0916-migration-docs.md).

## Release Boundary

- Current status: `NO-GO`.
- This document is support-only and evidence-indexing only.
- The documented migration surface is the recovery journal schema path. It is
  not a general WordPress content, option, media, user, order, or plugin data
  migration plan.
- Sandbox SQLite and file-backed proofs are useful regression support, but they
  are not production-backed migration proof.
- Production release movement requires separately captured production-backed
  migration proof showing the migration ran against the approved production
  storage boundary, survived restart/readback, preserved row counts and hashes,
  and passed redaction review.

## Migration Contract

Before treating a migrated journal as release evidence, the operator must have
all of the following in a redacted packet:

- source and target identity hashes bound to the same release envelope;
- migration command transcript with start and end timestamps;
- pre-migration schema summary and row-count digest;
- strict pre-migration readback result or explicit fail-closed reason;
- migration summary with changed row counts, preserved row counts, and schema
  version summary;
- post-migration strict readback after close and reopen;
- recovery classification as `old-remote`, `fully-updated-remote`, or
  `blocked-recovery`;
- artifact redaction scan result over every migration artifact;
- audit command and commit anchors listed in this document and the evidence
  file;
- final release posture explicitly retained as `NO-GO` unless separate
  production-backed release evidence closes it.

If any item is missing, ambiguous, stale, or not tied to the same release
envelope, the migration evidence is support-only and the release remains
`NO-GO`.

## Operator Flow

1. Inventory the journal storage boundary with metadata only. Do not capture
   raw row bodies, site content, credentials, cookies, private paths, or live
   service configuration.
2. Run strict readback before migration. Unsupported legacy rows must fail
   closed before the migration is allowed to repair schema metadata.
3. Run the migration only in an approved support or production-gated context.
   This RPP-0916 document does not provide that production approval.
4. Close and reopen the storage boundary, then run strict readback again.
5. Classify recovery state using the same inspected journal path. Unknown
   state, drift outside the before/after envelope, or missing terminal evidence
   becomes `blocked-recovery`.
6. Record exact audit commands, exact validation commands, commit anchors, and
   redaction scan results.
7. Keep release status at `NO-GO` unless separate production-backed migration
   proof is present and the release gate is intentionally moved by the release
   process.

## Stop Conditions

Stop and preserve artifacts without release movement when any of these occur:

- production-backed migration proof is absent;
- command transcript is missing or not bound to the current release envelope;
- pre-migration or post-migration row counts are missing;
- strict readback does not fail closed before migration when legacy state is
  expected;
- strict readback does not pass after migration and restart;
- recovery state is outside `old-remote`, `fully-updated-remote`, or
  `blocked-recovery`;
- raw values, credentials, cookies, private paths, or live service
  configuration appear in the artifact packet;
- a remote tunnel, non-approved ingress path, dashboard, tag, pull request, or
  release-gate status change would be required to continue.

## Audit Commands

These local audit commands were used to anchor the support-only migration docs
to existing commits. They are evidence-index commands only and do not prove
production migration readiness.

```bash
git show -s --format='%h%x09%H%x09%s' HEAD
git log --oneline --decorate -12
git log --oneline --all --grep='migration\|migrate\|schema' -30
git log --oneline --all --grep='RPP-0601\|RPP-0621\|RPP-0641\|RPP-0661\|RPP-0681' -20
```

## Commit Anchors

| Commit | Subject | Support purpose |
| --- | --- | --- |
| `e73be8def` | Merge published progress page state | Current branch head observed before RPP-0916 support docs. |
| `525258ec1` | docs: publish progress page | Observed origin main reference during the audit. |
| `15924c879` | docs: refresh progress for RPP-0911 integration | Recent integration context without release movement by this slice. |
| `173a16387` | Merge branch 'session/rpp-911' into lane/evidence-integration-20260527 | Recent support evidence merge context. |
| `5df68c6cc` | Add RPP-0681 journal schema migration release proof | Latest journal schema migration support proof anchor. |
| `cbc259b3b` | Add RPP-0661 journal table schema migration proof | Prior SQLite journal table schema migration proof anchor. |
| `e5145c196` | Add RPP-0641 journal schema migration coverage | Variant 3 journal schema migration coverage anchor. |
| `eb2c86d94` | Add RPP-0621 journal schema migration proof | Variant 2 partially migrated journal proof anchor. |
| `fcb99733b` | feat: add SQLite recovery journal migration proof | RPP-0601 SQLite migration surface anchor. |
| `46656bc4d` | feat: add recovery journal schema migration proof | Original file-backed journal schema migration support anchor. |

## Command To Commit Links

| Command | Commit anchors |
| --- | --- |
| `git show -s --format='%h%x09%H%x09%s' HEAD` | `e73be8def` |
| `git log --oneline --decorate -12` | `e73be8def`, `525258ec1`, `15924c879`, `173a16387` |
| `git log --oneline --all --grep='migration\|migrate\|schema' -30` | `5df68c6cc`, `cbc259b3b`, `e5145c196`, `fcb99733b`, `46656bc4d` |
| `git log --oneline --all --grep='RPP-0601\|RPP-0621\|RPP-0641\|RPP-0661\|RPP-0681' -20` | `5df68c6cc`, `cbc259b3b`, `e5145c196`, `eb2c86d94` |

## Validation Commands

Focused validation for this slice:

```bash
node --check test/rpp-0916-migration-docs.test.js
node --test --test-name-pattern RPP-0916 test/rpp-0916-migration-docs.test.js
node scripts/release/artifact-redaction-scan.mjs docs/migration/reprint-push-migration.md docs/evidence/rpp-0916-migration-docs.md
git diff --check
```

## Integration Recommendation

Integrate as support-only migration documentation and audit evidence. Do not
move checklist, progress, release-gate, status, tag, pull request, or final
release state from this slice. Final release remains `NO-GO` without
production-backed migration proof.
