# RPP-0366 comment parent thread reference v4 evidence

Date: 2026-05-30
Lane: RPP-0366 comment parent thread reference, variant 4
Checklist item: RPP-0366 — Add focused regression coverage for comment parent thread reference, variant 4.

## Scope

This slice adds local focused planner/apply regression coverage for
`wp_comments.comment_parent`. It validates existing graph-identity behavior only:
no production source, generated harness, auth, recovery, storage, release
verifier, release artifact, or progress-surface files were edited.

## Proof surface

`test/rpp-0366-comment-parent-thread-reference-v4.test.js` proves two parent
thread target paths:

- Stable target: a new child comment whose `comment_parent` points at an
  unchanged parent comment plans one child mutation, emits one live-remote
  precondition, carries no graph rewrite, applies with the original parent ID,
  and records only target hashes in the focused proof envelope.
- Explicit identity-map target: a local parent comment mapped to an equivalent
  remote parent comment is preserved as `map-local-identity-to-remote`; the
  child comment is planned with `comment_parent` rewritten to the remote parent
  ID, and the emitted `comment-parent` rewrite evidence contains source/target
  resource keys plus SHA-256 hashes only.

Both focused proof envelopes assert that raw comment fixture payload markers are
absent from the hash-only evidence. This is local regression evidence and does
not claim production-backed release proof.

Deterministic target shape observed locally:

```json
{
  "stableParent": {
    "relationshipKey": "wp_comments.comment_parent",
    "status": "ready",
    "mutations": 1,
    "rewriteCount": 0,
    "targetRemoteIdentity": "stable-hash-match",
    "liveRemotePrecondition": true
  },
  "mappedParent": {
    "relationshipKey": "wp_comments.comment_parent",
    "status": "ready",
    "sourceDecision": "map-local-identity-to-remote",
    "targetDecision": "keep-remote",
    "rewriteType": "comment-parent",
    "rewrittenParentId": 46611,
    "rewriteEvidence": "hash-only"
  },
  "evidenceScope": "local-focused",
  "productionBacked": false
}
```

## Focused verification observed locally

```sh
node --check test/rpp-0366-comment-parent-thread-reference-v4.test.js
node --test test/rpp-0366-comment-parent-thread-reference-v4.test.js
node --test --test-name-pattern 'same-plan comment|comment parent|comment_parent|comment-parent|RPP-0306' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0366-comment-parent-thread-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed result in this lane: the focused RPP-0366 test reported 2 subtests ok,
the adjacent comment-parent planner slice reported 4 subtests ok, checklist lint
returned `"ok": true`, the scoped artifact redaction scan returned `"ok": true`,
and both unstaged and staged diff checks exited 0.

## Release posture

This remains local focused graph-identity regression evidence only. Keep broader
release promotion gated on the separate production-backed release evidence.
