# RPP-0359 cross-table create batch mapping v3 evidence

Date: 2026-05-31
Lane: RPP-0359 cross-table create batch mapping, variant 3
Checklist item: RPP-0359 - Add generated coverage for cross-table create batch mapping, variant 3.

## Scope

This slice adds focused generated-style coverage for the graph-identity
cross-table create batch target. It changes only:

- `test/rpp-0359-cross-table-create-batch-mapping-v3.test.js`
- `docs/evidence/rpp-0359-cross-table-create-batch-mapping-v3.md`

It does not modify planner/apply behavior, generated harness sources,
local-production verifier helpers, release scripts, checklist state, progress
surfaces, or adjacent RPP-0339/RPP-0379 files.

## Proof surface

The RPP-0359 test builds a deterministic source/local/remote fixture for the
local-production post/postmeta target:

```json
{
  "target": "crossTableCreateBatchMappingVariant3",
  "family": "cross-table-create-batch-mapping-v3",
  "postResourceKey": "row:[\"wp_posts\",\"ID:71701\"]",
  "postmetaResourceKey": "row:[\"wp_postmeta\",\"post_id:71701:meta_key:reprint_push_postmeta_post_fixture\"]",
  "relationship": "wp_postmeta.post_id"
}
```

The ready case requires the planner to emit exactly the `wp_posts` create and
the dependent `wp_postmeta` create in one ready plan. It applies that plan to
the remote snapshot, then wraps the same real plan mutations in the
local-production release-verifier summary shape and feeds it to
`buildComplexSiteReleaseEvidence()` with `postmetaPostGraph` required.

The verifier proof must show that both batch resources:

- are carried in the release plan;
- have live-remote preconditions matching base and remote-before hashes;
- appear in before-first-mutation apply revalidation; and
- hash-match local after apply.

The fail-closed case swaps only the dependent postmeta resource key out of
apply revalidation while preserving the verified count. The local-production
evidence returns `ok:false` specifically because the target is not carried
through apply.

The stale replay case mutates the live remote for both generated target rows
after planning. Apply refuses with `PRECONDITION_FAILED` before mutation and
the remote hash stays unchanged.

## Hash-only evidence

The persisted support envelope is limited to resource keys, relationship edge
metadata, booleans, counters, release caveats, and hashes:

```json
{
  "target": "crossTableCreateBatchMappingVariant3",
  "family": "cross-table-create-batch-mapping-v3",
  "evidenceScope": "local-production-verifier-carry-through",
  "generation": {
    "caseId": "rpp-0359-generated-ready-cross-table-create-batch",
    "deterministic": true,
    "fixtureHash": "sha256:<64 lowercase hex>"
  },
  "batch": {
    "resourceKeys": [
      "row:[\"wp_posts\",\"ID:71701\"]",
      "row:[\"wp_postmeta\",\"post_id:71701:meta_key:reprint_push_postmeta_post_fixture\"]"
    ],
    "tables": ["wp_postmeta", "wp_posts"],
    "createMutationCount": 2
  },
  "referenceEdges": [
    {
      "relationshipKey": "wp_postmeta.post_id",
      "relationshipType": "postmeta-post",
      "sourceResourceKey": "row:[\"wp_postmeta\",\"post_id:71701:meta_key:reprint_push_postmeta_post_fixture\"]",
      "targetResourceKey": "row:[\"wp_posts\",\"ID:71701\"]",
      "preserved": true
    }
  ],
  "hashes": {
    "post": {
      "base": "<64 lowercase hex>",
      "remoteBefore": "<64 lowercase hex>",
      "precondition": "<64 lowercase hex>",
      "local": "<64 lowercase hex>",
      "applied": "<64 lowercase hex>"
    },
    "postmeta": {
      "base": "<64 lowercase hex>",
      "remoteBefore": "<64 lowercase hex>",
      "precondition": "<64 lowercase hex>",
      "local": "<64 lowercase hex>",
      "applied": "<64 lowercase hex>"
    },
    "receipt": "<64 lowercase hex>"
  },
  "staleReplay": {
    "code": "PRECONDITION_FAILED",
    "failedBeforeMutation": true,
    "remoteHashBefore": "<64 lowercase hex>",
    "remoteHashAfter": "<64 lowercase hex>",
    "detailsHash": "sha256:<64 lowercase hex>"
  },
  "release": {
    "productionBacked": false,
    "finalRecommendation": "NO-GO",
    "caveat": "local-production-verifier-evidence-only"
  },
  "proofHash": "sha256:<64 lowercase hex>"
}
```

The test asserts the serialized verifier/carry-through evidence omits the
private generated post title, slug, post content, postmeta payload, and stale
remote payload markers. Raw row payloads remain outside the persisted evidence
envelope.

## Validation commands

```sh
node --check test/rpp-0359-cross-table-create-batch-mapping-v3.test.js
node --test --test-name-pattern RPP-0359 test/rpp-0359-cross-table-create-batch-mapping-v3.test.js
node --test --test-name-pattern RPP-0379 test/rpp-0379-cross-table-create-batch-mapping-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0359-cross-table-create-batch-mapping-v3.md
git diff --check
git diff --cached --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0359 test reported 3 subtests, 0 failures; the adjacent RPP-0379 test
reported 2 subtests, 0 failures; the scoped artifact redaction scan passed; and
both whitespace diff checks passed.

## Release posture

This is local-production verifier carry-through evidence only. It is not a live
external production release run, does not publish release artifacts, and does
not satisfy the final production evidence boundary. Final release remains
`NO-GO` until separate checked production evidence satisfies the broader release
gate set.
