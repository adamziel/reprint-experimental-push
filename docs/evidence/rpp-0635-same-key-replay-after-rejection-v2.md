# RPP-0635 same-key replay after rejection, variant 2

Status: proven for the recovery release-proof surface.

## Scope

RPP-0635 proves the checked recovery path preserves a rejected apply result under the same idempotency key. The proof stays in the recovery journal and idempotency evidence surface:

- `test/recovery-journal.test.js` now asserts the same-key rejected replay shape used by the live apply-revalidation proof.
- `scripts/playground/production-shaped-live-release-verify-lib.js` reports `sameKeyRejectedReplay` in the durable recovery journal GATE-2 proof when rejected-replay evidence is present.
- `docs/reprint-push-completion-checklist.md` marks RPP-0635 complete.

## Proven behavior

The focused test builds the same release-verifier evidence shape as the checked live path:

- initial apply is rejected with status 412 and `PRECONDITION_FAILED`;
- replaying the same request under the same idempotency key returns the same rejected result;
- the replay is flagged as `replayed: true` and `freshMutationWork: false`;
- the target surface is unchanged across rejection replay;
- journal ordering proves `apply-rejected` precedes `apply-replayed`;
- no mutation is applied before the failure and no commit event is present;
- GATE-2 remains on the same release boundary with `gateStatus: "proven"`.

## Validation

Commands run for this slice:

```sh
node --test --test-name-pattern 'RPP-0635' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
npm run test:recovery:file-journal
timeout 30s node --test --test-name-pattern 'durable recovery journal release proof' test/production-shaped-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0635-same-key-replay-after-rejection-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed results:

- Focused RPP-0635 recovery journal test: exit 0, 1/1 subtest passed.
- Full recovery journal suite: exit 0, 29/29 subtests passed.
- File-journal restart smoke: exit 0; old-remote, blocked-recovery, completed replay no-op, drift, and stale-claim fence scenarios passed.
- Adjacent durable release-proof unit: exit 0, 1/1 subtest passed.
- Checklist lint: `"ok": true`.
- Scoped artifact redaction scan: `"ok": true`, no rejected files.
- `git diff --check` and `git diff --cached --check`: exit 0.
