# RPP-0235 keep-remote decision, variant 2

Date: 2026-05-30
Lane: RPP-0235 keep-remote decision, variant 2
Release status: NO-GO until integration accepts the local commit.

## Claim

Remote-only file, plugin metadata, and row updates remain `keep-remote`
decisions when an independent local mutation is ready. The ready plan emits no
mutation or live-remote precondition for those remote-only resources, serialized
proof evidence includes only resource keys, states, counts, and hashes, and
apply preserves the live remote resources while writing the independent local
mutation.

## Evidence added

- `test/rpp-0235-keep-remote-decision-v2.test.js` builds a focused ready plan
  with one local theme-file mutation plus three remote-only resources:
  `file:index.php`, `plugin:forms`, and `row:["wp_posts","ID:1"]`.
- The proof asserts each remote-only resource is a deterministic
  `keep-remote` decision with `localChange: unchanged`, `remoteChange: update`,
  valid base/remote hashes, no mutation, and no precondition.
- The proof replays planning with cloned inputs and compares the hash-only
  evidence envelope so the decision counts and decision metadata are stable.
- The proof applies the plan and checks the local mutation is written while the
  remote-only file, plugin metadata, and row hashes/values stay at the live
  remote values.
- The proof serializes only hash/resource/count metadata, adds a proof hash, and
  asserts private local and remote fixture strings are absent from both the
  serialized evidence and individual decision records.

## Commands

```sh
node --check test/rpp-0235-keep-remote-decision-v2.test.js
node --test test/rpp-0235-keep-remote-decision-v2.test.js
node --test --test-name-pattern='RPP-0215|RPP-0235' test/push-planner.test.js test/rpp-0235-keep-remote-decision-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0235-keep-remote-decision-v2.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
node --test test/artifact-redaction-scan.test.js
node --test test/checklist-completion-lint.test.js
git diff --check
```

Caveat: executable ready plans still carry the local mutation payload needed for
apply. This evidence is limited to the focused hash-only proof envelope and
`keep-remote` decision records, and the regression asserts those serialized
surfaces omit private fixture values.
