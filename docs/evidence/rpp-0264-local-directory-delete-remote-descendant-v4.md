# RPP-0264 local directory delete versus remote descendant, variant 4

Lane: RPP-0264 local directory delete versus remote descendant create, variant 4
Checklist item: RPP-0264 — Add focused regression coverage for local directory
delete versus remote descendant create, variant 4.

## Scenario

A local push deletes a directory that existed in the pull base while the live
remote creates a descendant under that directory. The focused fixture also
includes an unrelated local file edit so the planner must retain independent
mutation audit evidence without allowing any mutation to run while the topology
conflict is present.

## Focused evidence

Focused test:
`RPP-0264 local directory delete versus remote descendant create variant 4
refuses before mutation with hash-only evidence`

Command:

```sh
node --test test/rpp-0264-local-directory-delete-remote-descendant-v4.test.js
```

The regression asserts:

- the plan is `conflict`;
- the unsafe directory delete is classified as `file-topology-conflict`;
- the unsafe directory delete emits no mutation or live remote precondition;
- the live remote descendant remains a `keep-remote` decision and emits no
  mutation or precondition;
- the unrelated local file mutation remains hash-preconditioned for audit;
- `applyPlan()` refuses with `PLAN_NOT_READY` before any durable journal event
  or remote snapshot mutation; and
- serialized proof evidence contains resource keys, counts, and SHA-256 hashes
  without the fixture payload strings.

## Validation commands

Syntax check:

```sh
node --check test/rpp-0264-local-directory-delete-remote-descendant-v4.test.js
```

Observed result: exited 0.

Focused test:

```sh
node --test test/rpp-0264-local-directory-delete-remote-descendant-v4.test.js
```

Observed result: 1 subtest, 0 failures.

Adjacent directory descendant checks:

```sh
node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js
node --test --test-name-pattern='RPP-0204|RPP-0224' test/push-planner.test.js
node --test --test-name-pattern='RPP-0142|RPP-0162' test/generated-push-harness.test.js
```

Observed result: variant 3 focused check ran 1 subtest with 0 failures;
push-planner adjacent rows ran 2 subtests with 0 failures; generated adjacent
rows ran 2 subtests with 0 failures.

Checklist and artifact hygiene:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0264-local-directory-delete-remote-descendant-v4.md docs/reprint-push-completion-checklist.md docs/scenario-matrix.md
git diff --check
git diff --cached --check
```

Observed result: checklist lint reported `"ok": true`; artifact redaction scan
reported `"ok": true`; both diff checks exited 0.

## Release note

Evidence scope is local focused planner/apply regression coverage. Production
release verification remains gated separately.
