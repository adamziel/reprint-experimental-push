# RPP-0579 credential rotation behavior, variant 4

Date: 2026-05-31

Status: local generated executor/auth support evidence only. Final release
remains **NO-GO** until the same behavior is proven against a checked
production-owned boundary with production-owned access material.

## Claim

Apply revalidates the live source before mutation. Rotated or invalidated
access material fails before mutation executor entry, while the accepted support
path records live-source revalidation before the first mutation event.

## Hash-Only Proof Record

- testArtifactHash: c0fa9720bd76da43c5e60a8739d9205fd08cf67271a330f9474ff4822edd7494
- proofClassHash: 0b983b9671769fd30fd9e27f80c5a612182ff4716966e11d9ac7da4bac0a0b10
- credentialBindingProofHash: 5f22a99e6132bb066f68117ad26022ca643098595fe68ba5af6f4cb13394864e
- invalidatedRejectProofHash: f4d67bfe50c61c9c92c5e9f3b119ed7c656ba352245bf99cac3d409e0dedc10e
- rotatedRejectProofHash: db670d0ce0af5fb4310f7a2c8c74d345f9cd98119f46a073553428eea1708538
- acceptedRevalidationProofHash: c9a25731f9bb465d13c0f14b4a70470f60d8392ce7334b78d7f073b27e24e5ff
- orderingProofHash: 7a52d57fb787a727ce3dd2f2a8d7e89161a47f57c2572e58b61b7ec2597ffeb0
- noMutationBeforeRejectProofHash: 1206619d02721506915fd26e80518f6701b6c4f4308af53b5542d29d87fb3817
- releaseGateHash: c2ac338c247e52ccdfec07a29625d47d90d1c45bc89696175acf273c05313da0

## Proven Behavior

- Invalidated access material returns an auth failure before mutation executor
  entry and before mutation application.
- Rotated same-user access material returns a signed-session binding failure
  before mutation executor entry and before mutation application.
- The accepted path records apply start, live-source revalidation, mutation
  executor entry, first mutation, and commit in that order.
- Accepted support evidence reports the before-first-mutation phase, live-remote
  check target, verified count equal to mutation count, and hash-only bindings
  for credential, user, session, receipt, plan, request, source, preconditions,
  mutation set, and journal cursor material.

## Boundary

This is support-only generated evidence. It does not claim production
durability, external endpoint coverage, or release readiness. The release gate
remains **NO-GO** until executor/auth credential rotation and before-mutation
live-source revalidation are checked on the production boundary.

## Validation

Raw command strings and artifact locations are omitted from this evidence
record. Each command is recorded by SHA-256 of the exact local command string.

| index | commandHash | result |
| --- | --- | --- |
| 1 | 8ff602c438e4f285c5f2277264c033f16bb1025edfde5fe98500d014714d08df | exit 0 |
| 2 | a9e0858c52ec1e8146dd8a99cd75c7691a2b4459186db464bebfa1bb34835c8b | exit 0; 2 pass / 0 fail |
| 3 | 13bbae39072c69425531224533c176391e1f76bf116618880d9b2421e90ef9c0 | exit 0; 2 pass / 0 fail |
| 4 | 093047a92517527859a4f8a9b9029118ca780369f837fb19b332d3bba3d6e779 | exit 0; 2 pass / 0 fail |
| 5 | ada8beefd555a619da53e6dd67cc71a18ce54fe92c88e5c9c74d905a33d781ba | exit 0; 2 pass / 0 fail |
| 6 | 59231f255eb2311fe27f0c0513f272383fee28a33f5165f4639914839a8ad977 | exit 0; ok true |
| 7 | 466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b | exit 0 |
| 8 | 3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd | exit 0 |
