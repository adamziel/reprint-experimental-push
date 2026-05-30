# RPP-0339 cross-table create batch mapping v2 evidence

Date: 2026-05-30
Lane: RPP-0339 cross-table create batch mapping, variant 2
Checklist item: RPP-0339 - Prove cross-table create batch mapping, variant 2.

## Scope

This is a focused local-production verifier carry-through proof for a same-plan
cross-table create batch. It adds only the RPP-0339 focused test and this
evidence note. It does not change planner, apply, local-production helper,
generated harness, release scripts, checklist state, progress surfaces, or
adjacent RPP-0319/RPP-0379/RPP-0399 files.

## Proof surface

`test/rpp-0339-cross-table-create-batch-mapping-v2.test.js` builds a ready
local-production-shaped source/local/remote fixture where the local snapshot
creates both sides of the post/postmeta graph in one plan:

```json
{
  "postResourceKey": "row:[\"wp_posts\",\"ID:71701\"]",
  "postmetaResourceKey": "row:[\"wp_postmeta\",\"post_id:71701:meta_key:reprint_push_postmeta_post_fixture\"]",
  "relationship": "wp_postmeta.post_id"
}
```

The positive test applies the ready plan to the remote snapshot, wraps the same
real plan mutations in the local-production release-verifier summary shape, and
feeds that summary through `buildComplexSiteReleaseEvidence()` with
`postmetaPostGraph` required. The proof requires the batch to:

- plan exactly the `wp_posts` create and dependent `wp_postmeta` create;
- keep the dependent row pointed at `post_id:71701` with the scoped meta key;
- attach live-remote preconditions whose hashes match each mutation base and
  remote-before hash;
- include both resource keys in apply-time revalidation before the first
  mutation; and
- hash-match local after apply.

The negative test replaces only the dependent postmeta resource key in
apply-time revalidation while preserving the verifier count. The verifier
evidence then returns `ok:false`, while the planned create batch, postmeta
reference, live preconditions, and applied local hashes remain true. This proves
variant 2 fails closed specifically when the target is not carried through
apply.

## Hash-only evidence

The persisted RPP-0339 carry-through envelope is limited to resource keys,
numeric IDs, the reference edge, boolean invariants, 64-character hashes, a
proof hash, and release caveats:

```json
{
  "target": "crossTableCreateBatchMappingVariant2",
  "evidenceScope": "local-production-verifier-carry-through",
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
  "release": {
    "productionBacked": false,
    "finalRecommendation": "NO-GO",
    "caveat": "local-production-verifier-evidence-only"
  },
  "proofHash": "sha256:<64 lowercase hex>"
}
```

The focused assertions scan the serialized verifier/carry-through evidence for
private fixture post title, slug, post content, and postmeta payload markers.
Raw row payloads remain outside the persisted evidence envelope.

## Validation commands

```sh
node --check test/rpp-0339-cross-table-create-batch-mapping-v2.test.js
node --test test/rpp-0339-cross-table-create-batch-mapping-v2.test.js
node --test test/rpp-0379-cross-table-create-batch-mapping-v4.test.js test/rpp-0399-cross-table-create-batch-release-verifier-v5.test.js
node --test test/local-production-complex-site-proof.test.js test/rpp-0384-postmeta-post-id-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0339-cross-table-create-batch-mapping-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0339 test reported 2 subtests, 0 failures; the adjacent RPP-0379/RPP-0399
cross-table run reported 5 subtests, 0 failures; and the adjacent
local-production/RPP-0384 verifier run reported 23 subtests, 0 failures. The
scoped artifact redaction scan and whitespace diff check are recorded in this
worktree validation.

## Release posture

This lane is local-production verifier carry-through evidence only. It is not a
live external production release run, does not publish release artifacts, and
does not satisfy the final production evidence boundary. Final release remains
`NO-GO` until separate checked production evidence satisfies the broader release
gate set.
