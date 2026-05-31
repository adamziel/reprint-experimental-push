# RPP-0346 comment parent thread reference generated evidence, variant 3

Date: 2026-05-31
Lane: RPP-0346 comment parent thread reference generated coverage, variant 3
Checklist item: RPP-0346 - Add generated coverage for comment parent thread reference, variant 3.

## Scope

This slice adds deterministic local generated-harness evidence for WordPress
comment thread references stored in `wp_comments.comment_parent`. It does not
change production release status, release verifier code, public release gates,
or the final release posture. Final release remains `NO-GO`.

## Evidence added

- `scripts/harness/generated-push-cases.js` adds the
  `commentParentThreadReferenceVariant3` target without changing the 620-case
  roster or 62 scenario-family distribution.
- The target tags 30 generated support-only cases across all 10 tiers: 10
  stable parent identity proofs, 10 ready comment identity-map rewrite cases,
  and 10 stale parent drift cases.
- Stable cases keep the parent comment identical across base, local, and
  remote, plan only the child reply, and prove no graph rewrite is needed.
- Ready identity-map cases map a local `wp_comments` parent row to an
  equivalent remote parent row through `meta.wordpressGraphIdentityMap`,
  preserve the remote parent, and rewrite the child reply's `comment_parent`
  to the proven remote ID.
- Stale cases keep the target parent in base/local, drift it remotely, and
  require the dependent child reply to fail closed as
  `stale-wordpress-graph-identity` before apply.
- `test/generated-push-harness.test.js` recounts the target coverage, proves
  stable parent identity, proves identity-map decisions and rewrite metadata,
  verifies stale apply refusal leaves the remote digest unchanged, and asserts
  generated evidence stays hash-only without raw comment payloads.

## Observed target shape

```json
{
  "target": "commentParentThreadReferenceVariant3",
  "totalCases": 30,
  "statuses": {
    "blocked": 10,
    "ready": 20
  },
  "perTier": {
    "0": 3,
    "1": 3,
    "2": 3,
    "3": 3,
    "4": 3,
    "5": 3,
    "6": 3,
    "7": 3,
    "8": 3,
    "9": 3
  },
  "stableRelationship": "wp_comments.comment_parent",
  "identityMapSourceDecision": "map-local-identity-to-remote",
  "identityMapTargetDecision": "keep-remote",
  "staleRefusal": "PLAN_NOT_READY",
  "releaseGate": "NO-GO"
}
```

The focused generated proof serializes resource keys, IDs, relationship names,
status counts, decision names, refusal codes, stable identity booleans, and
SHA-256 hashes only. Raw generated comment payloads are intentionally excluded
from the evidence envelope.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0346 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0343|RPP-0344|RPP-0345|RPP-0346|RPP-0347' test/generated-push-harness.test.js
node --test test/rpp-0326-comment-parent-thread-reference-v2.test.js test/rpp-0366-comment-parent-thread-reference-v4.test.js test/rpp-0386-comment-parent-thread-reference-release-verifier-v5.test.js
node --test --test-name-pattern='same-plan comment|comment parent|comment_parent|comment-parent|RPP-0306' test/push-planner.test.js
npm run test:generated-push-harness
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0346-comment-parent-thread-reference-v3.md
git diff --check
git diff --cached --check
```

Observed local result during implementation: syntax checks exited 0; the
focused RPP-0346 generated-harness command passed 1 subtest with 0 failures;
the adjacent RPP-0343/RPP-0344/RPP-0345/RPP-0346/RPP-0347 generated graph
command passed 5 subtests with 0 failures; the focused RPP-0326/RPP-0366/
RPP-0386 comment-parent lineage command passed 7 subtests with 0 failures; the
adjacent RPP-0306 planner lineage command passed 4 subtests with 0 failures;
the full generated harness passed 99 subtests with 0 failures; the scoped
artifact redaction scan returned `"ok": true`; and the diff whitespace checks
exited 0.

## Release posture

This is local generated support evidence only. Final release remains `NO-GO`;
integration should keep this as graph-identity support evidence until a
separate release lane supplies production-backed proof.
